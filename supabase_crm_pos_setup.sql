-- ============================================================
-- น้องลัดดา LINE bridge — Supabase setup (CRM v2.9 + POS link v3.0) — รันซ้ำได้ (idempotent)
-- วิธีใช้: Supabase Dashboard (โปรเจกต์ POS-FARMER) -> SQL Editor -> New query -> วางทั้งหมด -> Run
-- ทำอะไรบ้าง:
--   1) สร้างตาราง crm_customers (โปรไฟล์ลูกค้า LINE) + crm_notes (บันทึกติดตาม) ถ้ายังไม่มี
--   2) เพิ่ม column pos_* ใน crm_customers สำหรับเก็บผลการผูกกับรายชื่อ POS
--   3) เพิ่ม column line_user_id ในตาราง customers (POS) เพื่อให้ bridge เขียน LINE userId กลับ
--      (เป็น column ใหม่ค่าว่าง ไม่กระทบข้อมูล/แอป POS เดิม)
-- ============================================================

-- 1) CRM tables
create table if not exists public.crm_customers (
  line_user_id   text primary key,
  display_name   text,
  picture_url    text,
  real_name      text,
  phone          text,
  province       text,
  district       text,
  crops          text,
  farm_rai       numeric,
  shop           text,
  status         text default 'new',              -- new | interested | quoted | customer | inactive
  tags           text[] default '{}',
  note           text,
  auto           jsonb default '{}'::jsonb,        -- ข้อมูลที่ระบบดึงจากแชท (phone, province, crops, pos_*)
  first_seen_at  timestamptz default now(),
  last_chat_at   timestamptz,
  updated_at     timestamptz default now()
);

create table if not exists public.crm_notes (
  id           bigserial primary key,
  line_user_id text not null references public.crm_customers(line_user_id) on delete cascade,
  text         text not null,
  by_admin     text default 'admin',              -- admin | system
  created_at   timestamptz default now()
);

create index if not exists crm_notes_user_idx        on public.crm_notes (line_user_id, created_at desc);
create index if not exists crm_customers_updated_idx on public.crm_customers (updated_at desc);
create index if not exists crm_customers_phone_idx   on public.crm_customers (phone);

alter table public.crm_customers enable row level security;
alter table public.crm_notes     enable row level security;
-- (ไม่มี policy ให้ anon: คนที่มีแค่ anon key อ่าน/เขียนไม่ได้ — bridge ใช้ service_role key)

-- 2) POS link columns
alter table public.crm_customers
  add column if not exists pos_id         text,          -- id ของแถวในตาราง customers (POS)
  add column if not exists pos_name       text,          -- ชื่อใน POS ตอนผูก
  add column if not exists pos_linked_at  timestamptz,
  add column if not exists pos_link_by    text,          -- auto | admin
  add column if not exists pos_candidates jsonb default '[]'::jsonb;  -- รายชื่อที่น่าจะใช่ รอแอดมินยืนยัน
create index if not exists crm_customers_pos_idx on public.crm_customers (pos_id);

-- 3) ให้ตาราง POS เก็บ LINE userId (bridge เขียนให้อัตโนมัติเมื่อผูกสำเร็จ / ล้างเมื่อยกเลิกผูก)
alter table public.customers add column if not exists line_user_id text;
create index if not exists customers_line_user_idx on public.customers (line_user_id);
create index if not exists customers_phone_idx     on public.customers (phone);
