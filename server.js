// ============================================================
// LINE OA <-> Dify Bridge (Node.js สำหรับ Railway) — v3.4
// บอท "น้องลัดดา ICPL LINE Chatbot"
//
// จุดเด่น:
//  1. ตอบ ack ให้ LINE ทันที (กัน timeout/redelivery storm)
//  2. Reply ก่อน ถ้า token หมดอายุ -> fallback เป็น Push
//  3. จำบทสนทนาต่อเนื่องผ่าน Dify conversations API (ไม่ต้องมี DB)
//  4. หน้าแอดมิน /admin ดีไซน์แบบ LINE OA Manager + ปุ่ม ⏸/▶ หยุด/เปิดบอทรายแชท
//  5. แชทเก่าเก็บถาวรลงดิสก์ (Railway Volume ที่ /data) — redeploy แล้วไม่หาย
//     + Real-time: แชทใหม่เด้งขึ้นเองทันทีผ่าน SSE ไม่ต้องกด refresh
//  6. ช่องพิมพ์ตอบลูกค้าจากหน้าแอดมินได้เลย (ส่งในนาม OA ผ่าน Push API)
//     ⚠️ ข้อความที่แอดมินส่งจากหน้านี้ใช้โควต้า Push รายเดือนของ LINE OA
//        (บอทตอบเองใช้ Reply API ไม่กินโควต้า) ถ้าจะคุยยาวๆ ใช้ LINE OA Manager ตามเดิม
//  7. v2.6: ดึงประวัติสนทนาเก่า (ลูกค้า↔บอท) กลับมาจาก Dify อัตโนมัติ
//     - ตอนบูท: เติมประวัติเก่าให้ทุกแชทที่รู้จัก + แชทจาก SEED_USER_IDS
//     - ลูกค้า(เก่า)ทักครั้งแรก: ประวัติเดิมทั้งหมดโผล่ตามมาเองใน 1-2 วิ
//     - หมายเหตุ: ข้อความที่แอดมินเคยพิมพ์ใน LINE OA Manager ดึงไม่ได้ (LINE ไม่มี API)
//  8. v2.8: ธง "📞 รอติดต่อกลับ" ในหน้าแอดมิน — ติดให้เองเมื่อ
//     (ก) บอทรับปากลูกค้าว่าจะให้เจ้าหน้าที่/แอดมินติดต่อกลับ หรือส่งเรื่องต่อให้แล้ว
//     (ข) ลูกค้าทิ้งเบอร์โทรไว้ในแชท (เก็บชื่อ+เบอร์โชว์ให้แอดมินเลย)
//     (ค) ลูกค้าพิมพ์ขอคุยกับแอดมิน
//     แชทที่รอติดต่อกลับเด้งขึ้นบนสุด (พื้นแดง) แอดมินกด "✓ ติดต่อแล้ว" เมื่อจัดการเสร็จ
//     + แจ้งเตือนเข้า LINE แอดมินได้ (ตั้ง ADMIN_NOTIFY_IDS) และแสดงจำนวนใน title หน้าเว็บ
//  9. v2.9: CRM-lite ในหน้าแอดมิน — ปุ่ม 👤 โปรไฟล์ ในแต่ละแชท: ชื่อจริง เบอร์ จังหวัด/อำเภอ พืชที่ปลูก
//     จำนวนไร่ ร้านที่ซื้อประจำ สถานะ (ใหม่/สนใจ/เสนอราคา/ซื้อแล้ว/เงียบ) แท็ก โน้ต + บันทึกการติดตาม
//     ระบบเติมให้เองจากแชท: เบอร์ จังหวัด พืชที่พูดถึง + โชว์ผู้ดูแลเขต ME/MR ตามจังหวัด
//     ช่องค้นหาในลิสต์ (ชื่อ/เบอร์/แท็ก/จังหวัด) + ส่งออก CSV เปิดใน Excel
//     เก็บใน Supabase ถ้าตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY (ตาราง crm_customers, crm_notes)
//     ไม่ตั้งก็ทำงานได้ โดยเก็บใน state file บน Volume
// 10. v3.0: เชื่อมรายชื่อเกษตรกรจากระบบ POS (ตารางใน Supabase โปรเจกต์เดียวกัน เช่น customers)
//     - โหลดรายชื่อ POS เข้าหน่วยความจำ (รีเฟรชทุก POS_REFRESH_MIN นาที) + เดา column ให้เอง (id/ชื่อ/เบอร์/จังหวัด/อำเภอ)
//     - เมื่อรู้เบอร์ของแชท LINE (ลูกค้าพิมพ์ในแชท / แอดมินกรอก) -> ค้นใน POS ด้วยเบอร์ที่ normalize แล้ว
//       เบอร์ตรง 1 คน + ชื่อสอดคล้อง (ชื่อจริง/ชื่อ LINE/ข้อความที่พิมพ์เบอร์มา) -> ผูกอัตโนมัติ ใส่ชื่อ/จังหวัดจาก POS + แท็ก "ลูกค้า POS"
//       เบอร์ตรงหลายคน หรือชื่อไม่สอดคล้อง -> โชว์ "รายชื่อที่น่าจะใช่" ในแผง CRM ให้แอดมินกดผูกเอง
//     - แอดมินค้นหาชื่อ/เบอร์ใน POS แล้วกดผูก/ยกเลิกผูกได้ · ถ้าตาราง POS มี column line_user_id ระบบเขียน LINE userId กลับให้
//     - ต้องเพิ่ม column pos_* ใน crm_customers (ดูไฟล์ supabase_crm_pos_setup.sql) ถ้ายังไม่เพิ่ม ระบบยังทำงาน (เก็บในเครื่อง)
// 11. v3.1: ลงทะเบียนลูกค้าใหม่ผ่านแชท (REGISTER=on ค่าเริ่ม) — ลูกค้าแอดเพื่อน/ทักครั้งแรก บอทขอ ชื่อ-นามสกุล -> เบอร์โทร -> จังหวัด
//     ก่อนตอบคำถาม (คำถามแรกที่ค้างไว้จะตอบให้ทันทีหลังลงทะเบียน) พิมพ์มาครบในข้อความเดียวก็จบเลย
//     เสร็จแล้ว: เบอร์ตรงกับ POS + ชื่อสอดคล้อง -> ผูกอัตโนมัติ · ไม่พบใน POS -> สร้างแถวใหม่ในตาราง customers ให้เลย
//     (พร้อม name/phone/province/first_name/last_name/line_user_id — POS ไม่ต้องเพิ่มลูกค้าซ้ำ) · เบอร์ตรงแต่ชื่อไม่ตรง -> ให้แอดมินยืนยัน
//     แอดมินกด "✓ ถือว่าลงทะเบียนแล้ว" / "➕ สร้างใน POS" ในแผงโปรไฟล์ได้ · REGISTER=soft ถามตอนแอดเพื่อนแต่ไม่บังคับ · off ปิด
//     v3.2: ลูกค้าพิมพ์ "ลงทะเบียน" เพื่อเริ่มเอง (ทุกโหมด) / "แก้ไขข้อมูล" เพื่ออัปเดตชื่อ-เบอร์-จังหวัด (อัปเดตแถว POS ที่ผูกอยู่ให้ด้วย)
//     แอดมินกด "📣 เชิญลูกค้าเก่าที่ยังไม่ลงทะเบียน" ส่ง Push ชวนลงทะเบียนทีเดียวทุกแชท (หรือรายแชท) — ลูกค้าตอบกลับแล้วบอทเดินขั้นตอนต่อเอง
// 12. v3.3: ฟอร์มลงทะเบียนแบบ LIFF (หน้าเว็บในแอป LINE) ที่ /liff — ตั้ง LIFF_ID แล้วระบบสลับเป็นโหมดฟอร์มอัตโนมัติ (REG_UI=liff)
//     ลูกค้าแอดเพื่อน/ทักครั้งแรก -> บอทส่งข้อความ+ปุ่ม "📝 ลงทะเบียนสมาชิก" เปิดฟอร์ม (ชื่อ เบอร์ จังหวัด อำเภอ พืชที่ปลูก ประเภท + PDPA)
//     ฟอร์มยืนยันตัวตนด้วย token ของ LIFF กับ LINE (ID token ผ่าน LINE_LOGIN_CHANNEL_ID หรือ access token) จึงรู้ userId แน่นอน
//     บันทึกลง CRM + ผูก/สร้างใน POS เหมือนเดิม -> ส่งข้อความยืนยันเข้าแชท (ผ่าน liff.sendMessages ไม่กินโควต้า / สำรองด้วย Push)
//     คำถามแรกที่ค้างไว้จะตอบให้ทันทีหลังลงทะเบียน · "แก้ไขข้อมูล" เปิดฟอร์มเดิมแก้ได้ · "ลงทะเบียนผ่านแชท" = ใช้แบบถามในแชทแทน (สำรอง)
//     v3.4: หน้าฟอร์มตามดีไซน์ "ICP Ladda Member App" (Claude Design) — ไฟล์ liff.html (วางคู่ server.js) : เพศ / ชื่อ-นามสกุล /
//     เบอร์ 10 ช่อง / จังหวัด-อำเภอ-ตำบล แบบเลือกต่อเนื่องจาก thai_locations.json (77 จังหวัด 930 อำเภอ 7,452 ตำบล — kongvut/thai-province-data, MIT)
//     / พืชที่ปลูก + พื้นที่ (ไร่/งาน) แยกรายพืช / PDPA -> หน้าสำเร็จโชว์ที่อยู่ พื้นที่ปลูก ทีม ME/MR ประจำเขต (กดโทรได้)
//     ข้อมูลลง CRM (real_name, phone, province, district, crops, farm_rai, auto.subdistrict, auto.reg.{gender,first_name,last_name,areas})
//     และตาราง POS (name, first_name, last_name, gender, phone, province, district, subdistrict, entity_type, line_user_id)
//     *** ต้อง deploy 3 ไฟล์คู่กัน: server.js, liff.html, thai_locations.json ***
// 12. ไม่ใช้ dependency ใดๆ (Node built-in ล้วน)
//
// ENV ที่ต้องตั้งใน Railway -> Variables:
//  LINE_CHANNEL_SECRET        จาก LINE Developers -> Basic settings
//  LINE_CHANNEL_ACCESS_TOKEN  จาก LINE Developers -> Messaging API
//  DIFY_API_KEY               จาก Dify -> แอปน้องลัดดา -> API Access (app-...)
//  ADMIN_KEY                  รหัสผ่านหน้าแอดมิน (อังกฤษ/ตัวเลข)
//  MUTE_MINUTES               (ไม่บังคับ) นาทีที่บอทเงียบเมื่อลูกค้าขอแอดมิน ค่าเริ่ม 60
//  STATE_DIR                  (ไม่บังคับ) โฟลเดอร์เก็บไฟล์ถาวร ค่าเริ่ม /data
//                             *** ต้อง Attach Volume ใน Railway ที่ mount path /data
//                                 ไม่งั้นไฟล์หายตอน redeploy (ระบบยังทำงานได้ แค่ไม่ถาวร)
//  SEED_USER_IDS              (ไม่บังคับ) LINE userId คั่นด้วย , เพื่อดึงลูกค้าเก่า
//                             เข้าลิสต์พร้อมประวัติทันทีตอนบูท (ใส่ครั้งเดียวพอ)
//  ADMIN_NOTIFY_IDS           (ไม่บังคับ) LINE userId ของแอดมิน คั่นด้วย , — เมื่อมีลูกค้า
//                             รอติดต่อกลับ ระบบจะ Push แจ้งเตือนเข้า LINE แอดมินทันที
//                             (ใช้โควต้า Push 1 ข้อความ/คน/ครั้ง) ดู userId ตัวเองได้จากหน้า /admin
//  SUPABASE_URL               (ไม่บังคับ) https://xxxx.supabase.co  — เปิดใช้ CRM บน Supabase
//  SUPABASE_SERVICE_KEY       (ไม่บังคับ) service_role key ของโปรเจกต์ (เก็บฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามใส่ในหน้าเว็บ)
//  POS_TABLE                  (ไม่บังคับ) ชื่อตารางเกษตรกรจาก POS ใน Supabase เดียวกัน เช่น customers -> เปิดระบบจับคู่ POS
//  POS_COL_ID / POS_COL_NAME / POS_COL_PHONE / POS_COL_PROVINCE / POS_COL_DISTRICT / POS_COL_LINE / POS_COL_EXTRA
//                             (ไม่บังคับ) ระบุชื่อ column เองถ้าระบบเดาไม่ถูก (NAME ใช้ + ต่อหลาย column เช่น first_name+last_name,
//                             PHONE/EXTRA คั่นด้วย , ได้) — POS_COL_LINE = column ที่ให้เขียน LINE userId กลับ (ค่าเริ่ม line_user_id ถ้ามี)
//  POS_REFRESH_MIN            (ไม่บังคับ) นาทีต่อการรีเฟรชรายชื่อ POS ค่าเริ่ม 15
//  POS_INSERT_DEFAULTS        (ไม่บังคับ) JSON ค่าเพิ่มเติมตอนสร้างลูกค้าใหม่ใน POS เช่น {"type":"retail","customer_tier":"General"}
//  REGISTER                   (ไม่บังคับ) on (ค่าเริ่ม) = บังคับลงทะเบียน ชื่อ/เบอร์/จังหวัด ก่อนบอทตอบ · soft = ถามแต่ไม่บังคับ · off = ปิด
//  LIFF_ID                    (ไม่บังคับ) LIFF ID จาก LINE Developers (LINE Login channel ใน provider เดียวกับบอท -> LIFF -> Endpoint URL = https://<โดเมนนี้>/liff)
//                             ตั้งแล้ว = ลงทะเบียนผ่านฟอร์มในแอป LINE แทนการถามในแชท
//  LINE_LOGIN_CHANNEL_ID      (แนะนำ) Channel ID ของ LINE Login channel นั้น — ใช้ตรวจ ID token / กัน token จาก channel อื่น
//  REG_UI                     (ไม่บังคับ) liff | chat — บังคับรูปแบบ (ค่าเริ่ม: liff ถ้ามี LIFF_ID ไม่งั้น chat)
//  PORT                       Railway ตั้งให้อัตโนมัติ
// ============================================================

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const pathmod = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const CH_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CH_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const DIFY_KEY = process.env.DIFY_API_KEY || '';
const ADMIN_KEY = (process.env.ADMIN_KEY || '').trim();
const MUTE_MINUTES = Math.max(1, parseInt(process.env.MUTE_MINUTES || '60', 10) || 60);
const RAILWAY_VOL = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const STATE_DIR = process.env.STATE_DIR || RAILWAY_VOL || '/data';
const HAS_VOLUME = !!RAILWAY_VOL && STATE_DIR.startsWith(RAILWAY_VOL); // ถาวรจริงเฉพาะเมื่อ Railway Attach Volume แล้ว (Railway ตั้ง RAILWAY_VOLUME_MOUNT_PATH ให้เอง) และ STATE_DIR ชี้เข้า Volume นั้น
const DIFY_BASE = 'https://api.dify.ai/v1';
const LINE_API = (process.env.LINE_API_BASE || 'https://api.line.me').replace(/\/+$/, ''); // override ได้เฉพาะตอนเทส
const FOREVER = 8640000000000000;
const HIST_MAX = 200;
const ADMIN_NOTIFY_IDS = (process.env.ADMIN_NOTIFY_IDS || '').split(/[\s,]+/).filter((x) => /^U[0-9a-f]{32}$/.test(x));
const PUBLIC_URL = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '');
// CRM: เชื่อม Supabase (ถ้าตั้งค่า) ไม่งั้นเก็บใน state file บน Volume
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const SB_ON = !!(SB_URL && SB_KEY);
// POS link (v3.0): ตารางเกษตรกรจาก POS ใน Supabase เดียวกัน (รองรับ schema.table; ค่าเริ่ม public)
const POS_TABLE_RAW = (process.env.POS_TABLE || '').trim().replace(/^public\./, '');
const POS_SCHEMA = POS_TABLE_RAW.includes('.') ? POS_TABLE_RAW.split('.')[0] : '';
const POS_TABLE = POS_TABLE_RAW.includes('.') ? POS_TABLE_RAW.split('.').slice(1).join('.') : POS_TABLE_RAW;
const POS_ON = SB_ON && !!POS_TABLE;
const POS_COLS_ENV = { id: process.env.POS_COL_ID, name: process.env.POS_COL_NAME, phone: process.env.POS_COL_PHONE, province: process.env.POS_COL_PROVINCE, district: process.env.POS_COL_DISTRICT, line: process.env.POS_COL_LINE, extra: process.env.POS_COL_EXTRA };
const POS_REFRESH_MIN = Math.max(1, parseInt(process.env.POS_REFRESH_MIN || '15', 10) || 15);
let POS_INSERT_DEFAULTS = {};
try { POS_INSERT_DEFAULTS = JSON.parse(process.env.POS_INSERT_DEFAULTS || '{}') || {}; } catch (_) { console.log('[pos] POS_INSERT_DEFAULTS ไม่ใช่ JSON ที่ถูกต้อง — ข้าม'); }
// ลงทะเบียนลูกค้าใหม่ (v3.1): on = บังคับกรอก ชื่อ/เบอร์/จังหวัด ก่อนบอทตอบ · soft = ถามตอนแอดเพื่อน แต่ไม่บังคับ · off = ปิด
const REG_MODE = ['on', 'soft', 'off'].includes((process.env.REGISTER || 'on').trim().toLowerCase()) ? (process.env.REGISTER || 'on').trim().toLowerCase() : 'on';
// LIFF (v3.3): ฟอร์มลงทะเบียนในแอป LINE — ตั้ง LIFF_ID (จาก LINE Developers -> LINE Login channel ใน provider เดียวกับบอท -> LIFF)
const LIFF_ID = (process.env.LIFF_ID || '').trim();
const LINE_LOGIN_CHANNEL_ID = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim(); // ใช้ตรวจ ID token (แนะนำ)
const REG_UI = ['liff', 'chat'].includes((process.env.REG_UI || '').trim().toLowerCase()) ? (process.env.REG_UI || '').trim().toLowerCase() : (LIFF_ID ? 'liff' : 'chat');
const LIFF_URL = LIFF_ID ? 'https://liff.line.me/' + LIFF_ID : '';

// ---------- ทะเบียนแชท + สถานะ + ประวัติ ----------
const sessions = new Map(); // id -> {name,pic,type,lastText,lastAt,mutedUntil,handoff,history,bf,cb,cbDone,cbCount}
// cb = { at, src:'bot'|'phone'|'kw'|'admin', topic, contact, note }  ธง "รอติดต่อกลับ" (null = ไม่มี)
const crm = new Map();      // line_user_id -> โปรไฟล์ CRM (real_name, phone, province, district, crops, farm_rai, shop, status, tags[], note, auto{}, first_seen_at, last_chat_at, updated_at)
const crmNotes = new Map(); // line_user_id -> [{id, text, by_admin, created_at}] (บันทึกการติดตาม) — ใช้เมื่อไม่มี Supabase หรือเป็นแคช

// ---------- Persistence (เก็บถาวรลงดิสก์ ถ้ามี Volume) ----------
const STATE_FILE = pathmod.join(STATE_DIR, 'nladda-state.json');
let canWrite = false;   // เขียนดิสก์ได้ (เซฟกันแครชได้ แต่ redeploy อาจหาย)
let persistOK = false;  // ถาวรจริง = เขียนได้ + มี Volume ต่ออยู่จริง
let dirty = false;
let saveTimer = null;

function initPersist() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(pathmod.join(STATE_DIR, '.write-test'), 'ok');
    fs.unlinkSync(pathmod.join(STATE_DIR, '.write-test'));
    canWrite = true;
  } catch (e) {
    canWrite = false;
    console.log(`[persist] เขียน ${STATE_DIR} ไม่ได้ (${e.code})`);
  }
  persistOK = canWrite && HAS_VOLUME;
  if (!persistOK) {
    console.log(`[persist] NOT PERMANENT — ${canWrite ? 'ยังไม่ได้ Attach Volume ใน Railway (คลิกขวาที่ service -> Attach Volume)' : 'ดิสก์เขียนไม่ได้'} — แชทจะหายเมื่อ redeploy`);
  } else {
    console.log(`[persist] ON — volume at ${STATE_DIR}`);
  }
  if (!canWrite) return;
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (raw && Array.isArray(raw.sessions)) {
        for (const [id, s] of raw.sessions) {
          if (!id || !s) continue;
          if (s.name === '…') s.name = '';
          if (!Array.isArray(s.history)) s.history = [];
          sessions.set(id, {
            name: s.name || '', pic: s.pic || '', type: s.type || 'user',
            lastText: s.lastText || '', lastAt: s.lastAt || 0,
            mutedUntil: s.mutedUntil || 0, handoff: !!s.handoff,
            history: s.history.slice(-HIST_MAX), bf: !!s.bf,
            cb: (s.cb && typeof s.cb === 'object') ? s.cb : null,
            cbDone: (s.cbDone && typeof s.cbDone === 'object') ? s.cbDone : null,
            cbCount: s.cbCount || 0,
            reg: (s.reg && typeof s.reg === 'object' && s.reg.step) ? s.reg : null, // ลงทะเบียนค้างอยู่ -> ถามต่อจากขั้นเดิม
            regPending: s.regPending || '', regInvitedAt: s.regInvitedAt || 0
          });
        }
        console.log(`[persist] loaded ${sessions.size} chats from disk`);
      }
      if (raw && Array.isArray(raw.crm)) {
        for (const [id, c] of raw.crm) if (id && c && typeof c === 'object') crm.set(id, c);
        console.log(`[persist] loaded ${crm.size} CRM profiles from disk`);
      }
      if (raw && Array.isArray(raw.crmNotes)) {
        for (const [id, arr] of raw.crmNotes) if (id && Array.isArray(arr)) crmNotes.set(id, arr.slice(-200));
      }
    }
  } catch (e) { console.log('[persist] load error:', e.message); }
}

function stateJson() {
  return JSON.stringify({ v: 2, savedAt: Date.now(), sessions: [...sessions.entries()], crm: [...crm.entries()], crmNotes: [...crmNotes.entries()] });
}

function saveNow() {
  if (!canWrite || !dirty) return;
  dirty = false;
  const data = stateJson();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFile(tmp, data, (err) => {
    if (err) { console.log('[persist] write error:', err.message); return; }
    fs.rename(tmp, STATE_FILE, (err2) => {
      if (err2) console.log('[persist] rename error:', err2.message);
    });
  });
}

function markDirty() {
  dirty = true;
  if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 3000);
}

process.on('SIGTERM', () => {
  try {
    if (canWrite && dirty) {
      fs.writeFileSync(STATE_FILE, stateJson());
    }
  } catch (_) {}
  process.exit(0);
});

// ---------- Real-time (SSE) ----------
const sseClients = new Set();
const sseTokens = new Map(); // token -> expiry
let bcTimer = null;

function broadcast() {
  if (bcTimer) return;
  bcTimer = setTimeout(() => {
    bcTimer = null;
    for (const res of sseClients) {
      try { res.write('data: u\n\n'); } catch (_) { sseClients.delete(res); }
    }
  }, 250);
}

setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': hb\n\n'); } catch (_) { sseClients.delete(res); }
  }
  const now = Date.now();
  for (const [t, exp] of sseTokens) if (exp < now) sseTokens.delete(t);
}, 25000);

function touchSession(id, type, text) {
  let s = sessions.get(id);
  if (!s) {
    s = { name: '', pic: '', type, lastText: '', lastAt: 0, mutedUntil: 0, handoff: false, history: [], bf: false, cb: null, cbDone: null, cbCount: 0, reg: null, regPending: '', regInvitedAt: 0 };
    sessions.set(id, s);
    if (sessions.size > 500) {
      let oldestId = null, oldestAt = Infinity;
      for (const [k, v] of sessions) if (v.lastAt < oldestAt) { oldestAt = v.lastAt; oldestId = k; }
      if (oldestId && oldestId !== id) sessions.delete(oldestId);
    }
  }
  if (text != null && text !== '') s.lastText = String(text).slice(0, 120);
  s.lastAt = Date.now();
  return s;
}

function pushHist(s, role, text) {
  s.history.push({ r: role, t: String(text).slice(0, 600), at: Date.now() });
  if (s.history.length > HIST_MAX) s.history.splice(0, s.history.length - HIST_MAX);
  markDirty();
  broadcast();
}

function fetchProfile(s, userId) {
  if (s.name || s.type !== 'user' || !userId || userId === 'unknown') return;
  s.name = '…';
  request('GET', LINE_API + '/v2/bot/profile/' + encodeURIComponent(userId), {
    Authorization: 'Bearer ' + CH_TOKEN
  }).then((r) => {
    if (r.status === 200 && r.data) {
      s.name = String(r.data.displayName || '').slice(0, 60);
      s.pic = String(r.data.pictureUrl || '').slice(0, 500);
      markDirty();
      broadcast();
      if (crm.has(userId)) crmTouch(userId, s, ''); // ชื่อ LINE มาทีหลัง -> อัปเดตใน CRM
    } else { s.name = ''; }
  }).catch(() => { s.name = ''; });
}

// ---------- HTTP helper ----------
function request(method, url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttp = u.protocol === 'http:';
    const body = bodyObj == null ? null : (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)); // string = ส่งดิบ (เช่น form-urlencoded)
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttp ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        body ? { 'Content-Length': Buffer.byteLength(body) } : {},
        headers || {}
      ),
      timeout: 180000
    };
    const req = (isHttp ? http : https).request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(d); } catch (_) { parsed = d; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ---------- ดึงประวัติเก่าจาก Dify (backfill) ----------
async function backfillFromDify(id, s) {
  try {
    const rc = await request('GET', `${DIFY_BASE}/conversations?user=${encodeURIComponent(id)}&limit=20`, {
      Authorization: `Bearer ${DIFY_KEY}`
    });
    if (rc.status !== 200 || !rc.data || !Array.isArray(rc.data.data)) {
      console.log(`[backfill] ${id.slice(0, 8)} conv list failed (${rc.status})`);
      return;
    }
    const convs = rc.data.data.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, 5);
    const entries = [];
    for (const c of convs) {
      const rm = await request('GET', `${DIFY_BASE}/messages?user=${encodeURIComponent(id)}&conversation_id=${encodeURIComponent(c.id)}&limit=100`, {
        Authorization: `Bearer ${DIFY_KEY}`
      });
      if (rm.status === 200 && rm.data && Array.isArray(rm.data.data)) {
        for (const m of rm.data.data) {
          const at = (m.created_at || 0) * 1000;
          if (!at) continue;
          if (m.query) entries.push({ r: 'u', t: String(m.query).slice(0, 600), at });
          if (m.answer) entries.push({ r: 'b', t: String(m.answer).slice(0, 600), at: at + 1 });
        }
      }
    }
    entries.sort((a, b) => a.at - b.at);
    // เติมเฉพาะข้อความที่เก่ากว่าที่มีอยู่ (กันซ้ำกับที่ระบบบันทึกสดไว้แล้ว)
    const minAt = s.history.length ? s.history[0].at : Infinity;
    const older = entries.filter((e) => e.at < minAt - 2000);
    if (older.length) s.history = older.concat(s.history).slice(-HIST_MAX);
    if (!s.lastAt && s.history.length) {
      const last = s.history[s.history.length - 1];
      s.lastAt = last.at;
      s.lastText = String(last.t).slice(0, 120);
    }
    s.bf = true;
    markDirty();
    broadcast();
    console.log(`[backfill] ${id.slice(0, 8)} +${older.length} old msgs from ${convs.length} convs`);
  } catch (e) { console.log(`[backfill] ${id.slice(0, 8)} error:`, e.message); }
}

function bootBackfill() {
  // นำเข้าลูกค้าเก่าจาก SEED_USER_IDS (ถ้าตั้งไว้)
  const seeds = (process.env.SEED_USER_IDS || '').split(/[\s,]+/).filter((x) => /^U[0-9a-f]{32}$/.test(x));
  for (const id of seeds) {
    if (!sessions.has(id)) {
      sessions.set(id, { name: '', pic: '', type: 'user', lastText: '', lastAt: 0, mutedUntil: 0, handoff: false, history: [], bf: false, cb: null, cbDone: null, cbCount: 0 });
      fetchProfile(sessions.get(id), id);
    }
  }
  if (seeds.length) console.log(`[backfill] seeded ${seeds.length} user ids`);
  // ไล่เติมประวัติเก่าให้ทุกแชทที่ยังไม่เคยเติม
  const pending = [...sessions.entries()].filter(([, s]) => !s.bf);
  let i = 0;
  const next = () => {
    if (i >= pending.length) return;
    const [id, s] = pending[i++];
    backfillFromDify(id, s).catch(() => {}).then(() => setTimeout(next, 300));
  };
  if (pending.length) console.log(`[backfill] sweeping ${pending.length} chats...`);
  next();
}

// ---------- Dify ----------
async function findConversation(sessionId) {
  try {
    const r = await request('GET', `${DIFY_BASE}/conversations?user=${encodeURIComponent(sessionId)}&limit=1`, {
      Authorization: `Bearer ${DIFY_KEY}`
    });
    if (r.status === 200 && r.data && r.data.data && r.data.data[0]) return r.data.data[0].id || '';
  } catch (e) { console.log('findConversation error:', e.message); }
  return '';
}

async function askDify(sessionId, text) {
  if (process.env.FAKE_DIFY_ANSWER) return process.env.FAKE_DIFY_ANSWER; // สำหรับเทสอัตโนมัติเท่านั้น
  const conversationId = await findConversation(sessionId);
  try {
    const r = await request('POST', `${DIFY_BASE}/chat-messages`, { Authorization: `Bearer ${DIFY_KEY}` }, {
      inputs: {},
      query: text,
      response_mode: 'blocking',
      user: sessionId,
      conversation_id: conversationId,
      auto_generate_name: true
    });
    if (r.status === 200 && r.data && typeof r.data.answer === 'string') return r.data.answer.trim();
    console.log('dify error:', r.status, JSON.stringify(r.data).slice(0, 300));
  } catch (e) { console.log('dify fetch error:', e.message); }
  return '';
}

// ---------- LINE ----------
// text = string หรือ array ของ string (ส่งได้สูงสุด 5 ข้อความต่อ reply/push)
function lineMsgs(text) {
  return (Array.isArray(text) ? text : [text])
    .filter((t) => t != null && (typeof t === 'object' ? !!t.type : String(t).trim()))
    .slice(0, 5)
    .map((t) => (typeof t === 'object' ? t : { type: 'text', text: String(t).slice(0, 4900) }));
}
async function lineReply(replyToken, text) {
  if (!replyToken) return false;
  const messages = lineMsgs(text);
  if (!messages.length) return false;
  try {
    const r = await request('POST', LINE_API + '/v2/bot/message/reply',
      { Authorization: `Bearer ${CH_TOKEN}` },
      { replyToken, messages });
    if (r.status !== 200) console.log('reply error:', r.status, JSON.stringify(r.data).slice(0, 300));
    return r.status === 200;
  } catch (e) { console.log('reply fetch error:', e.message); return false; }
}

async function linePush(to, text) {
  const messages = lineMsgs(text);
  if (!messages.length) return false;
  try {
    const r = await request('POST', LINE_API + '/v2/bot/message/push',
      { Authorization: `Bearer ${CH_TOKEN}` },
      { to, messages });
    if (r.status !== 200) console.log('push error:', r.status, JSON.stringify(r.data).slice(0, 300));
    return r.status === 200;
  } catch (e) { console.log('push fetch error:', e.message); return false; }
}

// ---------- CRM-lite (โปรไฟล์ลูกค้า + แท็ก + โน้ต) : Supabase หรือ state file ----------
const CRM_FIELDS = ['real_name', 'phone', 'province', 'district', 'crops', 'farm_rai', 'shop', 'status', 'tags', 'note'];
const CRM_STATUS = ['new', 'interested', 'quoted', 'customer', 'inactive'];
// จังหวัด -> เขตขาย (จากไฟล์ทีมขาย ME/MR) เพื่อโชว์ผู้ดูแลเขตในโปรไฟล์
const ZONE_OF = {};
[['A01', 'แม่ฮ่องสอน เชียงใหม่ เชียงราย ลำพูน ลำปาง พะเยา ตาก แพร่ น่าน'],
 ['A02', 'นครสวรรค์ พิจิตร พิษณุโลก กำแพงเพชร'],
 ['A03', 'สุพรรณบุรี อ่างทอง ชัยนาท กาญจนบุรี สิงห์บุรี'],
 ['A04', 'นครปฐม ราชบุรี เพชรบุรี นนทบุรี ปทุมธานี สมุทรสาคร สมุทรสงคราม สมุทรปราการ'],
 ['A05', 'ลพบุรี พระนครศรีอยุธยา อยุธยา สระบุรี เพชรบูรณ์'],
 ['A06', 'ประจวบคีรีขันธ์ ชุมพร สุราษฎร์ธานี ระนอง'],
 ['A07', 'นครศรีธรรมราช กระบี่ ภูเก็ต พังงา สตูล ตรัง พัทลุง สงขลา ปัตตานี ยะลา นราธิวาส'],
 ['A08', 'นครราชสีมา โคราช ชัยภูมิ บุรีรัมย์ สุรินทร์ ศรีสะเกษ อุบลราชธานี ยโสธร อำนาจเจริญ ร้อยเอ็ด มหาสารคาม ขอนแก่น กาฬสินธุ์ มุกดาหาร นครพนม สกลนคร อุดรธานี หนองคาย บึงกาฬ หนองบัวลำภู เลย'],
 ['A09', 'ระยอง จันทบุรี ตราด'],
 ['A10', 'ฉะเชิงเทรา ชลบุรี ปราจีนบุรี สระแก้ว นครนายก']].forEach(([z, ps]) => ps.split(' ').forEach((p) => { ZONE_OF[p] = z; }));
const ZONE_TEAM = {
  A01: 'ME กมล ยศอิ (ขนุน) 092-4245391 · MR จิติมา เรืองเพชร (แอ๋ว) 063-2059085',
  A02: 'ME ปทิตตา จันทร์กลิ่น (ผึ้ง) 063-2059071 · MR ศิริพร มณีสวัสดิ์ (แนทตี้) 063-2059072',
  A03: 'ME ดุสิตา จำปาสัก (มุก) 063-2059073 · MR ปนัดภร ไชยสุพัฒน์ (ปาว) 065-9642342',
  A04: 'ME อชิรญาณ์ เวฬุวนารักษ์ (ปอนด์) 063-2059076 · MR พุทธิตา พงษ์ไผ่ขำ (แป้ง) 082-1121691',
  A05: 'ME สุกัญญา ชูประสูติ (เล็ก) 065-5255687 · MR อัฐภิญญา พิมรินทร์ (แพน) 080-0430967',
  A06: 'ME วิลาสินี ขวัญเมือง (เมย์) 063-2059079 · MR ประภัศพรรณ (น้ำหวาน) 063-2059093 / ณัฐวัฒน์ (ไตเติ้ล) 063-2059077 / ภาวินี (เนส) 098-2863444',
  A07: 'ME ชนาภัทร พลูหนัง (อ้อม) 061-2692590 · MR ศตวรรษ (เจมส์) 092-2478766 / ษศกร (โลมา) 065-1193314',
  A08: 'ME ออมสิน เนาว์ประเสริฐ (ก้ง) 063-2059058 · MR วัชรพงศ์ พิลุณร์ (แทนไท) 063-2059078',
  A09: 'ME สุชาดา ราชคม (โบว์) 098-8326952 · MR กัญญารัตน์ (นุ้ย) 080-0430977 / ศิรินาฏ (ปังหวาน) 063-2059082 / ภาณุพงศ์ (ท็อป) 063-2284037 / กาญจนาพร (ลูกเจี๊ยบ) 065-5255690',
  A10: 'ME พิรยา สินสุวรรณ์ (แป้ง) 063-2059063 · MR สุประวีณ์ บุญมี (ปอ) 063-2059068'
};
const PROVINCE_RX = new RegExp('(' + Object.keys(ZONE_OF).sort((a, b) => b.length - a.length).join('|') + ')');
// จังหวัดทั้งหมด (รวมที่ไม่อยู่ในเขตขาย) + ชื่อย่อ -> ชื่อเต็ม สำหรับตรวจตอนลงทะเบียน
const PROVINCE_ALIAS = { 'กรุงเทพ': 'กรุงเทพมหานคร', 'กทม': 'กรุงเทพมหานคร', 'กทม.': 'กรุงเทพมหานคร', 'โคราช': 'นครราชสีมา', 'อยุธยา': 'พระนครศรีอยุธยา', 'อุบล': 'อุบลราชธานี', 'สุราษ': 'สุราษฎร์ธานี', 'สุราษฎร์': 'สุราษฎร์ธานี', 'นครศรี': 'นครศรีธรรมราช', 'ประจวบ': 'ประจวบคีรีขันธ์', 'หนองบัว': 'หนองบัวลำภู', 'ปราจีน': 'ปราจีนบุรี', 'สมุทรสาคร': 'สมุทรสาคร' };
const PROVINCES_ALL = [...new Set(Object.keys(ZONE_OF).concat(['กรุงเทพมหานคร', 'อุตรดิตถ์', 'สุโขทัย', 'อุทัยธานี']).filter((p) => p !== 'โคราช' && p !== 'อยุธยา'))];
const PROVINCE_ALL_RX = new RegExp('(' + PROVINCES_ALL.concat(Object.keys(PROVINCE_ALIAS)).sort((a, b) => b.length - a.length).map((p) => p.replace(/\./g, '\\.')).join('|') + ')');
function provinceOf(text) {
  const m = PROVINCE_ALL_RX.exec(String(text || ''));
  if (!m) return '';
  return PROVINCE_ALIAS[m[1]] || m[1];
}
const CROP_WORDS = ['ทุเรียน', 'นาข้าว', 'ข้าวโพด', 'ข้าว', 'ลำไย', 'มะม่วง', 'ส้ม', 'อ้อย', 'มันสำปะหลัง', 'มัน', 'ปาล์ม', 'ยางพารา', 'พริก', 'หอม', 'กระเทียม', 'คะน้า', 'ผัก', 'มะเขือ', 'ถั่วฝักยาว', 'มังคุด', 'เงาะ', 'ลองกอง', 'กาแฟ', 'มะพร้าว', 'แตง'];

function zoneInfo(province) {
  const m = PROVINCE_RX.exec(province || '');
  const z = m ? ZONE_OF[m[1]] : '';
  return z ? { zone: z, team: ZONE_TEAM[z] } : null;
}

async function sb(method, path, body, extraHeaders) {
  const headers = Object.assign({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, extraHeaders || {});
  return request(method, SB_URL + '/rest/v1' + path, headers, body);
}

function crmGet(id) {
  let c = crm.get(id);
  if (!c) {
    const s = sessions.get(id);
    c = { line_user_id: id, display_name: s ? s.name : '', picture_url: s ? s.pic : '', real_name: '', phone: '', province: '', district: '', crops: '', farm_rai: null, shop: '', status: 'new', tags: [], note: '', auto: {}, first_seen_at: new Date().toISOString(), last_chat_at: null, updated_at: new Date().toISOString() };
    crm.set(id, c);
    markDirty();
    if (SB_ON) sbUpsert(c);
  }
  return c;
}

let sbErrLogged = 0;
// โครงสร้างตารางใน Supabase (จาก OpenAPI ของ PostgREST) -> ใช้เดา column ของตาราง POS และตัด column ที่ crm_customers ยังไม่มี (ยังไม่รัน migration)
let sbSchema = null; // { tables: { name: [cols] }, pk: { name: col } } หรือ null = ไม่รู้
const sbMissing = new Set(); // column ที่ Supabase ตอบว่าไม่มีใน crm_customers -> ตัดออกก่อนส่งครั้งถัดไป
async function sbIntrospect() {
  if (!SB_ON) return null;
  try {
    const r = await sb('GET', '/', null, { Accept: 'application/openapi+json' });
    const defs = r.status < 300 && r.data && typeof r.data === 'object' ? r.data.definitions : null;
    if (!defs || typeof defs !== 'object') return null;
    const out = { tables: {}, pk: {} };
    for (const [t, d] of Object.entries(defs)) {
      const props = (d && d.properties) || {};
      out.tables[t] = Object.keys(props);
      for (const [col, p] of Object.entries(props)) if (p && /<pk\/>/.test(String(p.description || ''))) { out.pk[t] = col; break; }
    }
    sbSchema = out;
    const cc = out.tables.crm_customers;
    if (cc) for (const k of ['pos_id', 'pos_name', 'pos_linked_at', 'pos_link_by', 'pos_candidates']) if (!cc.includes(k)) sbMissing.add(k);
    if (sbMissing.size) console.log('[crm] crm_customers ยังไม่มี column:', [...sbMissing].join(','), '-> รัน supabase_pos_link_setup.sql เพื่อเก็บผล POS ลง Supabase (ตอนนี้เก็บในเครื่อง)');
    return out;
  } catch (e) { return null; }
}
function sbRow(c) {
  const row = Object.assign({}, c, { tags: Array.isArray(c.tags) ? c.tags : [], updated_at: new Date().toISOString() });
  const known = sbSchema && sbSchema.tables.crm_customers;
  for (const k of Object.keys(row)) if ((known && !known.includes(k)) || sbMissing.has(k)) delete row[k];
  return row;
}
function sbUpsert(c) {
  if (!SB_ON) return Promise.resolve(false);
  const send = (tries) => sb('POST', '/crm_customers?on_conflict=line_user_id', [sbRow(c)], { Prefer: 'resolution=merge-duplicates,return=minimal' })
    .then((r) => {
      if (r.status < 300) return true;
      const msg = JSON.stringify(r.data || '');
      const m = /Could not find the '([^']+)' column/.exec(msg); // PGRST204: ยังไม่ได้เพิ่ม column (เช่น pos_id) -> ตัดออกแล้วส่งใหม่
      if (m && !sbMissing.has(m[1]) && tries < 8) { sbMissing.add(m[1]); console.log(`[crm] column '${m[1]}' not in crm_customers — skipping (รัน SQL migration เพื่อเพิ่ม)`); return send(tries + 1); }
      if (sbErrLogged++ < 5) console.log('[crm] supabase upsert failed:', r.status, msg.slice(0, 200));
      return false;
    });
  return send(0).catch((e) => { if (sbErrLogged++ < 5) console.log('[crm] supabase error:', e.message); return false; });
}

async function crmLoadFromSupabase() {
  if (!SB_ON) return;
  try {
    let from = 0, total = 0;
    while (true) {
      const r = await sb('GET', '/crm_customers?select=*&order=updated_at.desc', null, { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' });
      if (r.status >= 300 || !Array.isArray(r.data)) { console.log('[crm] supabase load failed:', r.status, JSON.stringify(r.data).slice(0, 200)); return; }
      for (const row of r.data) {
        if (!row.line_user_id) continue;
        const local = crm.get(row.line_user_id);
        // Supabase เป็นแหล่งจริง แต่ถ้าเครื่องมีข้อมูลใหม่กว่า (แก้ตอน Supabase ล่ม) ให้ดันขึ้นแทน
        if (local && local.updated_at && row.updated_at && local.updated_at > row.updated_at) { sbUpsert(local); continue; }
        const merged = Object.assign({}, row, { tags: Array.isArray(row.tags) ? row.tags : [], auto: row.auto || {} });
        // ถ้า Supabase ยังไม่มี column pos_* (ยังไม่รัน migration) อย่าให้ผลการผูก POS ที่เก็บในเครื่องหาย
        if (local) for (const k of ['pos_id', 'pos_name', 'pos_linked_at', 'pos_link_by', 'pos_candidates']) if (!(k in row) && local[k] !== undefined) merged[k] = local[k];
        crm.set(row.line_user_id, merged);
      }
      total += r.data.length;
      if (r.data.length < 1000) break;
      from += 1000;
    }
    console.log(`[crm] loaded ${total} profiles from Supabase`);
    markDirty();
  } catch (e) { console.log('[crm] supabase load error:', e.message); }
}

// อัปเดตข้อมูลอัตโนมัติจากแชท (ชื่อ LINE, เวลาแชทล่าสุด, เบอร์/จังหวัด/พืชที่ลูกค้าพิมพ์)
function crmTouch(id, s, userText) {
  if (!id || id === 'unknown' || (s && s.type !== 'user')) return;
  const c = crmGet(id);
  let changed = false;
  if (s && s.name && s.name !== '…' && c.display_name !== s.name) { c.display_name = s.name; c.picture_url = s.pic || ''; changed = true; }
  const nowIso = new Date().toISOString();
  if (!c.last_chat_at || (Date.now() - Date.parse(c.last_chat_at)) > 5 * 60000) { c.last_chat_at = nowIso; changed = true; }
  if (userText) {
    c.auto = c.auto || {};
    const pm = PHONE_RX.exec(userText);
    if (pm && c.auto.phone !== pm[0]) {
      c.auto.phone = pm[0]; if (!c.phone) c.phone = pm[0].replace(/[- ]/g, ''); changed = true;
      // ข้อความที่พิมพ์เบอร์มา (ตัดเบอร์ออก) มักมีชื่อลูกค้า -> ใช้เทียบชื่อกับ POS
      const ctx = userText.replace(new RegExp(PHONE_RX.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
      if (ctx) c.auto.phone_ctx = ctx.slice(0, 80);
    }
    const prm = PROVINCE_RX.exec(userText);
    if (prm && c.auto.province !== prm[1]) { c.auto.province = prm[1]; if (!c.province) c.province = prm[1]; changed = true; }
    const found = CROP_WORDS.filter((w) => userText.includes(w)).map((w) => (w === 'นาข้าว' ? 'ข้าว' : w === 'มัน' ? 'มันสำปะหลัง' : w));
    if (found.length) {
      const set = new Set((c.auto.crops || '').split(',').map((x) => x.trim()).filter(Boolean));
      const before = set.size;
      found.forEach((w) => set.add(w));
      if (set.size !== before) { c.auto.crops = [...set].slice(0, 12).join(','); changed = true; }
    }
  }
  if (changed) { c.updated_at = nowIso; markDirty(); if (SB_ON) sbUpsert(c); }
  if (POS_ON && !c.pos_id) posMatch(id); // มีเบอร์/ชื่อใหม่ -> ลองจับคู่กับ POS
}

function crmUpdate(id, fields) {
  const c = crmGet(id);
  const before = (c.phone || '') + '|' + (c.real_name || '');
  for (const k of CRM_FIELDS) {
    if (!(k in fields)) continue;
    let v = fields[k];
    if (k === 'tags') v = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : String(v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
    else if (k === 'farm_rai') { v = v === '' || v == null ? null : Number(v); if (v != null && !isFinite(v)) v = null; }
    else if (k === 'status') v = CRM_STATUS.includes(v) ? v : 'new';
    else v = String(v == null ? '' : v).slice(0, k === 'note' ? 2000 : 200);
    c[k] = v;
  }
  c.updated_at = new Date().toISOString();
  // แอดมินกรอก ชื่อ+เบอร์+จังหวัด ครบ = ถือว่าลงทะเบียนแล้ว (บอทจะไม่ถามลูกค้าซ้ำ)
  if (!regDone(c) && c.real_name && c.phone && c.province) {
    c.auto = c.auto || {};
    c.auto.reg = { done_at: c.updated_at, source: 'admin', name: c.real_name, phone: normPhone(c.phone) || c.phone, province: c.province };
    const s = sessions.get(id);
    if (s && s.reg) { s.reg = null; }
  }
  markDirty();
  broadcast();
  if (POS_ON && !c.pos_id && before !== (c.phone || '') + '|' + (c.real_name || '')) posMatch(id); // แอดมินกรอกเบอร์/ชื่อ -> จับคู่ POS
  return SB_ON ? sbUpsert(c) : Promise.resolve(true);
}

async function crmAddNote(id, text, by) {
  crmGet(id);
  const note = { id: Date.now(), line_user_id: id, text: String(text).slice(0, 2000), by_admin: by || 'admin', created_at: new Date().toISOString() };
  if (SB_ON) {
    const r = await sb('POST', '/crm_notes', [{ line_user_id: id, text: note.text, by_admin: note.by_admin }], { Prefer: 'return=representation' }).catch((e) => ({ status: 599, data: e.message }));
    if (r.status < 300 && Array.isArray(r.data) && r.data[0]) Object.assign(note, r.data[0]);
    else if (sbErrLogged++ < 5) console.log('[crm] note insert failed:', r.status, JSON.stringify(r.data).slice(0, 200));
  }
  const arr = crmNotes.get(id) || [];
  arr.push(note);
  crmNotes.set(id, arr.slice(-200));
  markDirty();
  return note;
}

async function crmListNotes(id) {
  if (SB_ON) {
    const r = await sb('GET', `/crm_notes?line_user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`).catch(() => ({ status: 599 }));
    if (r.status < 300 && Array.isArray(r.data)) { crmNotes.set(id, r.data.slice().reverse()); return r.data; }
  }
  return (crmNotes.get(id) || []).slice().reverse();
}

function crmSummary(id) {
  const c = crm.get(id);
  if (!c) return null;
  return { real_name: c.real_name || '', phone: c.phone || '', province: c.province || '', status: c.status || 'new', tags: c.tags || [], crops: c.crops || (c.auto && c.auto.crops) || '', pos: c.pos_id ? (c.pos_name || String(c.pos_id)) : '', posc: Array.isArray(c.pos_candidates) ? c.pos_candidates.length : 0 };
}

function csvCell(v) {
  const s = v == null ? '' : (Array.isArray(v) ? v.join('|') : String(v));
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ---------- POS link (v3.0): จับคู่แชท LINE กับรายชื่อเกษตรกรจาก POS ----------
const pos = { cols: null, rows: [], byPhone: new Map(), byId: new Map(), loadedAt: 0, error: '', loading: null, source: '', refreshes: 0 };
const POS_HEADERS = POS_SCHEMA && POS_SCHEMA !== 'public' ? { 'Accept-Profile': POS_SCHEMA, 'Content-Profile': POS_SCHEMA } : {};
// คำนำหน้า/คำเรียก/คำเติมที่ไม่ใช่ตัวชื่อ (ตัดทิ้งก่อนเทียบชื่อ)
const NAME_PREFIX_RX = /^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|ดร\.|คุณ|ลุง|ป้า|น้า|อา|พี่|ตา|ยาย|พ่อ|แม่|ครู|หมอ|ชื่อ|ผม|ดิฉัน|หนู|เรา|mr\.?|mrs\.?|ms\.?|miss|khun|k\.)\s*/i;
const NAME_STOP = new Set(['ค่ะ', 'คะ', 'ครับ', 'คับ', 'จ้า', 'จ้ะ', 'นะ', 'นะคะ', 'นะครับ', 'ชื่อ', 'เบอร์', 'โทร', 'ติดต่อ', 'ผม', 'ดิฉัน', 'หนู', 'พี่', 'คุณ', 'ร้าน', 'สวน', 'ไร่', 'นา', 'เกษตร', 'เกษตรกร', 'ไลน์', 'line', 'the', 'and', 'ที่', 'อยู่', 'จาก', 'ของ', 'ปลูก', 'ขอ', 'ให้', 'กลับ', 'ด้วย', 'หน่อย', 'ครับผม', 'สวัสดี', 'สวัสดีค่ะ', 'สวัสดีครับ', 'ทุเรียน', 'ข้าว', 'อ้อย', 'มัน']);

// เบอร์โทร -> ตัวเลขล้วน ขึ้นต้น 0 (9-10 หลัก): 081-234-5678 / +66812345678 / 812345678 (เลขนำหน้าหายเพราะเก็บเป็นตัวเลข) -> 0812345678
function normPhone(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('66') && d.length >= 11) d = '0' + d.slice(2);
  else if (d.length === 9 && d[0] !== '0') d = '0' + d;
  if (d.length < 9 || d.length > 10 || d[0] !== '0') return '';
  return d;
}
// ดึงเบอร์ทั้งหมดจากข้อความ/ช่องเบอร์ (รองรับหลายเบอร์คั่นด้วย , / ;)
function phonesOf(v) {
  const s = String(v == null ? '' : v);
  const out = new Set();
  const m = s.match(/(?:\+?66|0)[\d\-\s.]{7,14}\d/g) || [];
  for (const x of m) { const p = normPhone(x); if (p) out.add(p); }
  if (!out.size) { const p = normPhone(s); if (p) out.add(p); }
  return [...out];
}
function normName(v) {
  let s = String(v == null ? '' : v).toLowerCase().replace(/[\d\-+()]{6,}/g, ' ');   // ตัดเบอร์โทรที่ปนมา
  s = s.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();       // ตัดอีโมจิ/สัญลักษณ์
  let prev;
  do { prev = s; s = s.replace(NAME_PREFIX_RX, ''); } while (s !== prev && s);
  return s;
}
function nameTokens(v) {
  return normName(v).split(' ').map((t) => { let x = t, p; do { p = x; x = x.replace(NAME_PREFIX_RX, ''); } while (x !== p && x); return x; }).filter((t) => t.length >= 2 && !NAME_STOP.has(t));
}
// "ชื่อสอดคล้อง" = ชื่อฝั่ง LINE (ชื่อจริงที่แอดมินกรอก / ชื่อ LINE / ข้อความที่พิมพ์เบอร์มา) มีคำร่วมกับชื่อใน POS หรือเป็นส่วนของกันและกัน
function nameConsistent(hints, posNames) {
  const targets = (Array.isArray(posNames) ? posNames : [posNames]).map(normName).filter((x) => x.length >= 2);
  if (!targets.length) return false;
  for (const h of hints || []) {
    const hn = normName(h);
    if (!hn || hn.length < 2) continue;
    for (const pn of targets) {
      if (pn === hn || (hn.length >= 3 && pn.includes(hn)) || (pn.length >= 3 && hn.includes(pn))) return true;
      const pt = new Set(pn.split(' '));
      for (const t of nameTokens(hn)) if (pt.has(t) || (t.length >= 3 && pn.includes(t))) return true;
      for (const t of nameTokens(pn)) if (t.length >= 3 && hn.includes(t)) return true;
    }
  }
  return false;
}

// เดา column ของตาราง POS: env > OpenAPI (รู้ primary key) > แถวตัวอย่าง
async function posDetectCols() {
  const envList = (v) => String(v || '').split(/[+,\s]+/).map((x) => x.trim()).filter(Boolean);
  let cols = null, pk = '';
  if (!POS_SCHEMA && sbSchema && sbSchema.tables[POS_TABLE]) { cols = sbSchema.tables[POS_TABLE]; pk = sbSchema.pk[POS_TABLE] || ''; pos.source = 'openapi'; }
  else {
    const r = await sb('GET', `/${POS_TABLE}?select=*&limit=1`, null, POS_HEADERS);
    if (r.status >= 300 || !Array.isArray(r.data)) { pos.error = `อ่านตาราง ${POS_TABLE_RAW} ไม่ได้ (${r.status}): ${JSON.stringify(r.data).slice(0, 140)}`; return null; }
    cols = r.data[0] ? Object.keys(r.data[0]) : [];
    pos.source = 'sample';
    if (!cols.length) { pos.error = `ตาราง ${POS_TABLE_RAW} ยังไม่มีข้อมูล จึงเดา column ไม่ได้ (ตั้ง POS_COL_* เอง)`; }
  }
  const has = (c) => !!c && (cols.includes(c) || !cols.length);
  const pick = (rxs, exclude) => { for (const rx of rxs) { const k = cols.find((c) => rx.test(c) && !(exclude || []).includes(c)); if (k) return k; } return ''; };
  const idc = envList(POS_COLS_ENV.id)[0] || pk || pick([/^id$/i, /^(customer|farmer|member|cust|client|pos|user)_?(id|code|no|uuid)$/i, /_id$/i, /^(code|no|uuid)$/i]) || cols[0] || 'id';
  let nameCols = envList(POS_COLS_ENV.name).filter(has);
  if (!nameCols.length) {
    const one = pick([/^(full_?name|fullname|customer_?name|farmer_?name|cust_?name|member_?name|client_?name|name|display_?name|ชื่อ(-นามสกุล|นามสกุล|_?สกุล)?)$/i]);
    if (one) nameCols = [one];
    else {
      const f = pick([/^(first_?name|fname|firstname|ชื่อ)$/i]), l = pick([/^(last_?name|lname|lastname|surname|นามสกุล)$/i]);
      if (f) nameCols = l ? [f, l] : [f];
      else { const any = pick([/name/i], [idc]); if (any) nameCols = [any]; }
    }
  }
  // ชื่ออื่นๆ ที่ใช้เทียบเพิ่ม (เช่น first_name+last_name, legacy_name, nickname)
  const alt = [];
  const f2 = pick([/^(first_?name|fname|firstname)$/i]), l2 = pick([/^(last_?name|lname|lastname|surname)$/i]);
  if (f2 && !nameCols.includes(f2)) alt.push(l2 ? [f2, l2] : [f2]);
  for (const c of cols) if (/^(legacy_?name|nick_?name|nickname|alias|shop_?name|store_?name|company|ชื่อเล่น)$/i.test(c) && !nameCols.includes(c)) alt.push([c]);
  let phoneCols = envList(POS_COLS_ENV.phone).filter(has);
  if (!phoneCols.length) phoneCols = cols.filter((c) => /phone|tel|mobile|เบอร์|โทร/i.test(c) && !/(country|type|verified|ext|code)/i.test(c)).slice(0, 3);
  const provc = envList(POS_COLS_ENV.province)[0] || pick([/^(province|province_?name|prov|จังหวัด)$/i, /province|จังหวัด/i]);
  const distc = envList(POS_COLS_ENV.district)[0] || pick([/^(district|amphoe|amphur|district_?name|อำเภอ)$/i, /^(?!sub)(?!.*sub_?district).*(district|amphoe|amphur|อำเภอ)/i]);
  const subdc = pick([/^(sub_?district|subdistrict_?name|sub_?district_?name|tambon|tambol|ตำบล)$/i]);
  const genc = pick([/^(gender|sex)$/i]);
  const linec = envList(POS_COLS_ENV.line)[0] || pick([/^(line_?user_?id|line_?uid|line_?id|lineid)$/i]);
  let extra = envList(POS_COLS_ENV.extra).filter(has);
  if (!extra.length) extra = cols.filter((c) => /^(customer_?tier|tier|customer_?type|type|group|segment|grade|level|entity_?type)$/i.test(c)).slice(0, 3);
  pos.cols = { id: idc, name: nameCols, alt, phone: phoneCols, province: has(provc) ? provc : '', district: has(distc) ? distc : '', subd: has(subdc) ? subdc : '', gender: has(genc) ? genc : '', line: has(linec) ? linec : '', extra, all: cols };
  if (!pos.cols.phone.length) pos.error = `หา column เบอร์โทรในตาราง ${POS_TABLE_RAW} ไม่เจอ (ตั้ง POS_COL_PHONE) — column ที่มี: ${cols.join(', ').slice(0, 200)}`;
  else if (!pos.cols.name.length) pos.error = `หา column ชื่อในตาราง ${POS_TABLE_RAW} ไม่เจอ (ตั้ง POS_COL_NAME) — column ที่มี: ${cols.join(', ').slice(0, 200)}`;
  else pos.error = '';
  console.log('[pos] columns:', JSON.stringify(Object.assign({}, pos.cols, { all: undefined })), pos.error ? '⚠️ ' + pos.error : '');
  return pos.cols;
}

function posRecOf(row) {
  const k = pos.cols;
  const str = (v) => (v == null ? '' : String(v)).trim();
  const join = (arr) => arr.map((c) => str(row[c])).filter(Boolean).join(' ').trim();
  const name = join(k.name);
  const names = [name].concat(k.alt.map(join)).filter(Boolean);
  const phones = [...new Set(k.phone.flatMap((c) => phonesOf(row[c])))];
  const extra = {};
  for (const c of k.extra) if (str(row[c])) extra[c] = str(row[c]).slice(0, 60);
  return { id: str(row[k.id]), name: name.slice(0, 120), names, nnames: names.map(normName), phones, province: k.province ? str(row[k.province]).slice(0, 60) : '', district: k.district ? str(row[k.district]).slice(0, 60) : '', line: k.line ? str(row[k.line]) : undefined, extra };
}

async function posRefresh() {
  if (!POS_ON) return false;
  if (pos.loading) return pos.loading;
  pos.loading = (async () => {
    try {
      if (!pos.cols || !pos.cols.phone.length || !pos.cols.name.length) await posDetectCols();
      if (!pos.cols || !pos.cols.phone.length || !pos.cols.name.length) return false;
      const k = pos.cols;
      const want = [...new Set([k.id, ...k.name, ...k.alt.flat(), ...k.phone, k.province, k.district, k.subd, k.line, ...k.extra].filter(Boolean))];
      const sel = want.every((c) => /^[A-Za-z0-9_]+$/.test(c)) ? want.join(',') : '*';
      const rows = [];
      let from = 0;
      while (true) {
        const r = await sb('GET', `/${POS_TABLE}?select=${sel}`, null, Object.assign({ Range: `${from}-${from + 999}`, 'Range-Unit': 'items' }, POS_HEADERS));
        if (r.status >= 300 || !Array.isArray(r.data)) { pos.error = `โหลดรายชื่อ POS ไม่สำเร็จ (${r.status}): ${JSON.stringify(r.data).slice(0, 140)}`; console.log('[pos]', pos.error); return false; }
        rows.push(...r.data);
        if (r.data.length < 1000 || from > 500000) break;
        from += 1000;
      }
      const byPhone = new Map(), byId = new Map(), list = [];
      for (const row of rows) {
        const rec = posRecOf(row);
        if (!rec.id) continue;
        list.push(rec);
        byId.set(rec.id, rec);
        for (const p of rec.phones) { const arr = byPhone.get(p) || []; arr.push(rec); byPhone.set(p, arr); }
      }
      pos.rows = list; pos.byPhone = byPhone; pos.byId = byId; pos.loadedAt = Date.now(); pos.error = ''; pos.refreshes++;
      console.log(`[pos] loaded ${list.length} farmers from ${POS_TABLE_RAW} (${byPhone.size} phones indexed, writeback=${k.line ? k.line : 'off'})`);
      posRematchAll();
      broadcast();
      posSyncRegistered().catch((e) => console.log('[pos] sync registered error:', e.message));
      return true;
    } catch (e) { pos.error = 'โหลดรายชื่อ POS ผิดพลาด: ' + e.message; console.log('[pos]', pos.error); return false; }
    finally { pos.loading = null; }
  })();
  return pos.loading;
}

function posBrief(rec, hints) {
  return { id: rec.id, name: rec.name, phone: rec.phones[0] || '', province: rec.province, district: rec.district, extra: rec.extra, ok: nameConsistent(hints || [], rec.names) };
}
function posHints(c, s) {
  const arr = [c.real_name, s && s.reg && s.reg.data && s.reg.data.name, c.auto && c.auto.reg && c.auto.reg.name, (s && s.name && s.name !== '…') ? s.name : (c.display_name || ''), c.auto && c.auto.phone_ctx, s && s.cb && s.cb.contact, s && s.cbDone && s.cbDone.contact];
  return arr.filter((x) => x && String(x).trim()).map(String);
}
function posPhonesOfChat(c, s) {
  const out = new Set();
  for (const v of [c.phone, c.auto && c.auto.phone, s && s.cb && s.cb.contact, s && s.cbDone && s.cbDone.contact]) for (const p of phonesOf(v)) out.add(p);
  return [...out];
}
function posSetCandidates(c, list) {
  const cur = JSON.stringify(c.pos_candidates || []);
  if (cur === JSON.stringify(list)) return false;
  c.pos_candidates = list;
  c.updated_at = new Date().toISOString();
  markDirty();
  broadcast();
  if (SB_ON) sbUpsert(c);
  return true;
}
// จับคู่ 1 แชท: เบอร์ตรง + ชื่อสอดคล้อง 1 คน -> ผูกอัตโนมัติ; ไม่ชัด -> เก็บ candidates ให้แอดมินยืนยัน
function posMatch(id, opts) {
  if (!POS_ON || !pos.rows.length) return null;
  const c = crm.get(id);
  if (!c || c.pos_id) return null;
  const s = sessions.get(id);
  const phones = posPhonesOfChat(c, s);
  if (!phones.length) { posSetCandidates(c, []); return null; }
  const seen = new Set(), cands = [];
  for (const p of phones) for (const rec of (pos.byPhone.get(p) || [])) if (!seen.has(rec.id)) { seen.add(rec.id); cands.push(rec); }
  if (!cands.length) { posSetCandidates(c, []); return null; }
  const hints = posHints(c, s);
  const skip = new Set((c.auto && c.auto.pos_unlinked) || []);
  const consistent = cands.filter((r) => nameConsistent(hints, r.names));
  // ผูกอัตโนมัติเฉพาะเมื่อ "ชื่อสอดคล้อง" มีคนเดียวในบรรดาคนที่เบอร์ตรง (ถ้าสอดคล้อง 2 คนขึ้นไป เช่น พี่น้องนามสกุลเดียวกัน = ไม่ชัด ให้แอดมินเลือก)
  if (consistent.length === 1 && !skip.has(consistent[0].id) && !(opts && opts.noAuto)) { posLink(id, consistent[0], 'auto'); return { linked: posBrief(consistent[0], hints) }; }
  const ordered = consistent.concat(cands.filter((r) => !consistent.includes(r))).slice(0, 8).map((r) => posBrief(r, hints));
  posSetCandidates(c, ordered);
  return { candidates: ordered };
}
function posRematchAll() {
  let linked = 0, cand = 0;
  for (const id of crm.keys()) {
    const r = posMatch(id);
    if (r && r.linked) linked++; else if (r && r.candidates && r.candidates.length) cand++;
  }
  if (linked || cand) console.log(`[pos] rematch: auto-linked ${linked}, waiting confirm ${cand}`);
}
async function posWriteBack(rec, lineUserId) {
  const k = pos.cols;
  if (!k || !k.line || !rec) return 'nocol';
  if (lineUserId && rec.line === lineUserId) return 'ok'; // ค่าใน POS ตรงอยู่แล้ว (เช่น เพิ่งสร้างแถวพร้อม line_user_id)
  try {
    const path = `/${POS_TABLE}?${encodeURIComponent(k.id)}=eq.${encodeURIComponent(rec.id)}` + (lineUserId === null ? `&${encodeURIComponent(k.line)}=eq.${encodeURIComponent(rec.line || '')}` : '');
    const r = await sb('PATCH', path, { [k.line]: lineUserId }, Object.assign({ Prefer: 'return=minimal' }, POS_HEADERS));
    if (r.status < 300) { rec.line = lineUserId || ''; return 'ok'; }
    console.log('[pos] writeback failed:', r.status, JSON.stringify(r.data).slice(0, 160));
    return 'fail';
  } catch (e) { console.log('[pos] writeback error:', e.message); return 'fail'; }
}
function posLink(id, rec, by) {
  const c = crmGet(id);
  const now = new Date().toISOString();
  c.pos_id = rec.id; c.pos_name = rec.name; c.pos_linked_at = now; c.pos_link_by = by; c.pos_candidates = [];
  c.auto = c.auto || {};
  const filled = {}; // ช่องที่ระบบเติมให้จาก POS (ถ้ายกเลิกผูก จะล้างคืนเฉพาะช่องที่ยังเป็นค่าจาก POS)
  if (!c.real_name && rec.name) { c.real_name = rec.name.slice(0, 200); filled.real_name = c.real_name; }
  if (!c.phone && rec.phones[0]) { c.phone = rec.phones[0]; filled.phone = c.phone; }
  if (!c.province && rec.province) { c.province = rec.province.slice(0, 200); filled.province = c.province; }
  if (!c.district && rec.district) { c.district = rec.district.slice(0, 200); filled.district = c.district; }
  c.auto.pos_filled = filled;
  c.tags = Array.isArray(c.tags) ? c.tags : [];
  if (!c.tags.includes('ลูกค้า POS')) c.tags.push('ลูกค้า POS');
  c.auto.pos_wb = pos.cols && pos.cols.line ? 'pending' : 'nocol';
  c.updated_at = now;
  markDirty();
  broadcast();
  if (SB_ON) sbUpsert(c);
  const detail = [rec.phones[0], rec.province].filter(Boolean).join(' · ');
  crmAddNote(id, (by === 'auto' ? '🔗 ระบบผูกกับ POS อัตโนมัติ: ' : '🔗 แอดมินผูกกับ POS: ') + rec.name + (detail ? ' (' + detail + ')' : '') + (by === 'auto' ? ' — เบอร์ตรง+ชื่อสอดคล้อง' : ''), by === 'auto' ? 'system' : 'admin').catch(() => {});
  console.log(`[pos] ${id.slice(0, 8)} linked -> ${rec.id} (${rec.name}) by=${by}`);
  posWriteBack(rec, id).then((st) => { if (c.auto.pos_wb !== st) { c.auto.pos_wb = st; markDirty(); if (SB_ON) sbUpsert(c); } });
}
function posUnlink(id) {
  const c = crm.get(id);
  if (!c || !c.pos_id) return false;
  const rec = pos.byId.get(String(c.pos_id));
  const oldId = String(c.pos_id), oldName = c.pos_name || '';
  c.auto = c.auto || {};
  c.auto.pos_unlinked = [...new Set([...(c.auto.pos_unlinked || []), oldId])].slice(-10); // กันระบบผูกซ้ำคนเดิมโดยอัตโนมัติ
  const filled = c.auto.pos_filled || {};
  for (const k of Object.keys(filled)) if (c[k] === filled[k]) c[k] = ''; // ล้างค่าที่ระบบเติมจาก POS (ถ้าแอดมินแก้เองแล้วจะไม่แตะ)
  delete c.auto.pos_filled;
  c.pos_id = null; c.pos_name = ''; c.pos_linked_at = null; c.pos_link_by = null;
  c.tags = (c.tags || []).filter((t) => t !== 'ลูกค้า POS');
  delete c.auto.pos_wb;
  c.updated_at = new Date().toISOString();
  markDirty();
  broadcast();
  if (SB_ON) sbUpsert(c);
  crmAddNote(id, '↩️ ยกเลิกการผูกกับ POS: ' + oldName, 'admin').catch(() => {});
  if (rec) posWriteBack(rec, null).catch(() => {});
  posMatch(id, { noAuto: true });
  return true;
}
function posSearch(qraw) {
  const q = String(qraw || '').trim();
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  const linkedBy = new Map();
  for (const [lid, c] of crm) if (c.pos_id) linkedBy.set(String(c.pos_id), lid);
  const out = [];
  if (digits.length >= 4 && digits.length >= q.length * 0.6) {
    const exact = normPhone(q);
    for (const rec of pos.rows) {
      if (rec.phones.some((p) => (exact && p === exact) || p.includes(digits))) out.push(rec);
      if (out.length >= 20) break;
    }
  } else {
    const nq = normName(q);
    if (!nq) return [];
    for (const rec of pos.rows) {
      if (rec.nnames.some((n) => n.includes(nq))) out.push(rec);
      if (out.length >= 20) break;
    }
  }
  return out.map((rec) => Object.assign(posBrief(rec, []), { linked_to: linkedBy.get(rec.id) || null }));
}
function posStatus() {
  const linked = [...crm.values()].filter((c) => c.pos_id).length;
  const waiting = [...crm.values()].filter((c) => !c.pos_id && Array.isArray(c.pos_candidates) && c.pos_candidates.length).length;
  return { on: POS_ON, table: POS_TABLE_RAW || '', rows: pos.rows.length, loadedAt: pos.loadedAt, error: pos.error, source: pos.source, cols: pos.cols ? { id: pos.cols.id, name: pos.cols.name, phone: pos.cols.phone, province: pos.cols.province, district: pos.cols.district, line: pos.cols.line, extra: pos.cols.extra, alt: pos.cols.alt } : null, writeback: !!(pos.cols && pos.cols.line), linked, waiting, refreshMin: POS_REFRESH_MIN, sbMissing: [...sbMissing] };
}
function posInfoFor(c) {
  const rec = c.pos_id ? pos.byId.get(String(c.pos_id)) : null;
  return {
    on: POS_ON,
    linked: c.pos_id ? (rec ? posBrief(rec, []) : { id: String(c.pos_id), name: c.pos_name || '', phone: '', province: '', district: '', extra: {} }) : null,
    link_by: c.pos_link_by || null, linked_at: c.pos_linked_at || null, writeback: (c.auto && c.auto.pos_wb) || null,
    candidates: (!c.pos_id && Array.isArray(c.pos_candidates)) ? c.pos_candidates : [],
    phones: posPhonesOfChat(c, sessions.get(c.line_user_id)),
    status: POS_ON ? { rows: pos.rows.length, error: pos.error, loadedAt: pos.loadedAt, writebackCol: !!(pos.cols && pos.cols.line) } : null
  };
}

// สร้างรายชื่อใหม่ในตาราง POS จากโปรไฟล์ CRM (ลูกค้าลงทะเบียนผ่านแชท / แอดมินกด) แล้วผูกทันที
const SHOP_NAME_RX = /^(ร้าน|บริษัท|บจก|บจ\.|บมจ|หจก|ห้าง|สหกรณ์|กลุ่ม|วิสาหกิจ|สวน|ไร่|ฟาร์ม|โรงงาน|ศูนย์)/;
async function posCreate(id, by) {
  const c = crm.get(id);
  if (!POS_ON) return { ok: false, err: 'POS link ปิดอยู่' };
  if (!pos.cols || !pos.cols.name.length) { if (!pos.loading) posRefresh().catch(() => {}); return { ok: false, err: 'ยังโหลดโครงสร้างตาราง POS ไม่เสร็จ ลองใหม่อีกครั้ง' }; }
  if (!c) return { ok: false, err: 'ไม่พบโปรไฟล์' };
  if (c.pos_id) return { ok: false, err: 'ผูกกับ POS อยู่แล้ว' };
  const name = String(c.real_name || '').trim().slice(0, 120);
  if (!name) return { ok: false, err: 'ต้องมีชื่อจริงก่อน (กรอกในโปรไฟล์)' };
  const phone = normPhone(c.phone) || normPhone(c.auto && c.auto.phone) || '';
  const k = pos.cols;
  const row = {};
  const shopLike = SHOP_NAME_RX.test(name) || !!(c.auto && c.auto.reg && c.auto.reg.type === 'shop');
  const bare = name.replace(NAME_PREFIX_RX, '').trim();
  const parts = bare.split(/\s+/).filter(Boolean);
  if (k.name.length >= 2) { row[k.name[0]] = parts[0] || name; row[k.name[1]] = parts.slice(1).join(' ') || null; }
  else row[k.name[0]] = name;
  if (k.phone[0] && phone) row[k.phone[0]] = phone;
  if (k.province && c.province) row[k.province] = String(c.province).slice(0, 60);
  if (k.district && c.district) row[k.district] = String(c.district).slice(0, 60);
  if (k.subd && c.auto && c.auto.subdistrict) row[k.subd] = String(c.auto.subdistrict).slice(0, 60);
  if (k.line) row[k.line] = id;
  const reg = (c.auto && c.auto.reg) || {};
  const pair = k.alt.find((a) => a.length === 2);
  if (pair && k.name.length === 1 && !shopLike) {
    if (reg.first_name) { row[pair[0]] = reg.first_name; if (reg.last_name) row[pair[1]] = reg.last_name; }
    else if (parts.length) { row[pair[0]] = parts[0]; if (parts.length > 1) row[pair[1]] = parts.slice(1).join(' '); }
  }
  if (k.gender && !shopLike && (reg.gender === 'male' || reg.gender === 'female')) row[k.gender] = reg.gender;
  if (k.all.includes('entity_type') && !('entity_type' in POS_INSERT_DEFAULTS)) row.entity_type = shopLike ? 'organization' : 'person';
  for (const [kk, v] of Object.entries(POS_INSERT_DEFAULTS)) if (k.all.includes(kk)) row[kk] = v;
  try {
    const r = await sb('POST', `/${POS_TABLE}?select=*`, [row], Object.assign({ Prefer: 'return=representation' }, POS_HEADERS));
    if (r.status < 300 && Array.isArray(r.data) && r.data[0]) {
      const rec = posRecOf(r.data[0]);
      if (!rec.id) return { ok: false, err: 'สร้างแล้วแต่ไม่ได้ id กลับมา' };
      pos.rows.push(rec); pos.byId.set(rec.id, rec);
      for (const p of rec.phones) { const arr = pos.byPhone.get(p) || []; arr.push(rec); pos.byPhone.set(p, arr); }
      if (k.line) rec.line = id;
      c.auto = c.auto || {}; delete c.auto.pos_create_err;
      posLink(id, rec, by || 'reg');
      console.log(`[pos] ${id.slice(0, 8)} created in POS -> ${rec.id} (${rec.name}) by=${by || 'reg'}`);
      return { ok: true, rec: posBrief(rec, []) };
    }
    const err = `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`;
    c.auto = c.auto || {}; c.auto.pos_create_err = err.slice(0, 200); markDirty();
    console.log('[pos] create failed:', err);
    return { ok: false, err: 'สร้างรายชื่อใน POS ไม่สำเร็จ: ' + err };
  } catch (e) { c.auto = c.auto || {}; c.auto.pos_create_err = e.message; markDirty(); return { ok: false, err: 'สร้างรายชื่อใน POS ผิดพลาด: ' + e.message }; }
}
// หลังโหลดรายชื่อ POS: ลูกค้าที่ลงทะเบียนแล้วแต่ยังไม่มีใน POS (ไม่มีเบอร์ตรง/ไม่มีรายชื่อรอยืนยัน) -> สร้างให้ (ลองไม่เกิน 3 ครั้ง)
async function posSyncRegistered() {
  if (!POS_ON || !pos.cols) return;
  let n = 0;
  for (const [id, c] of crm) {
    const reg = c.auto && c.auto.reg;
    if (!reg || !reg.done_at || c.pos_id || !c.real_name) continue;
    if (Array.isArray(c.pos_candidates) && c.pos_candidates.length) continue; // รอแอดมินยืนยัน
    if ((reg.pos_tries || 0) >= 3) continue;
    reg.pos_tries = (reg.pos_tries || 0) + 1;
    const r = await posCreate(id, 'reg');
    if (r.ok) n++;
  }
  if (n) console.log(`[pos] created ${n} registered customer(s) in POS`);
}

// ---------- ลงทะเบียนลูกค้าใหม่ผ่านแชท (v3.1): ชื่อ-นามสกุล -> เบอร์โทร -> จังหวัด ----------
// s.reg = { step:'name'|'phone'|'province', data:{name,phone,province}, tries:{}, pending:'คำถามแรก', at }
const REG_QUESTION_RX = /[?？]|ไหม|มั้ย|อะไร|ยังไง|อย่างไร|เท่าไหร่|เท่าไร|กี่|ที่ไหน|ทำไม|แนะนำ|ราคา|ช่วย|ใช้กับ|ฉีด|พ่น|กำจัด|หนอน|เพลี้ย|โรค|ยา|ปุ๋ย|วัชพืช|หญ้า|สินค้า|โปร/;
const REG_GREET_RX = /^(สวัสดี|หวัดดี|ดีค่ะ|ดีครับ|hello|hi|hey|ครับ|ค่ะ|คะ|จ้า|โย่|ฮัลโหล|สนใจ|ขอ)/i;
const REG_LEAD_RX = /^(สวัสดีครับ|สวัสดีค่ะ|สวัสดี|ผมชื่อ|ฉันชื่อ|ดิฉันชื่อ|หนูชื่อ|เราชื่อ|ชื่อว่า|ชื่อคือ|ชื่อ|ผม|ดิฉัน|หนู|เรา|คือ|คุณ)\s*/;
const REG_TAIL_RX = /\s*(นะครับ|นะคะ|ครับผม|ครับ|ค่ะ|คะ|ค่า|นะ|จ้า|จ้ะ|เลย|น้า|งับ|คับ)+$/;
const REG_WORD_RX = /(^|\s)(ชื่อ|นามสกุล|เบอร์โทร|เบอร์|โทร|โทรศัพท์|จังหวัด|จ\.|อยู่ที่|อยู่|ที่|ปลูก|ทำนา|ทำสวน|เกษตรกร|บ้าน|อำเภอ|ตำบล)(?=\s|$)/g;
function regClean(str) {
  let s = String(str || '').replace(/[^\p{L}\p{M}\p{N}\s.]/gu, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) s = s.replace(REG_LEAD_RX, '').replace(REG_TAIL_RX, '').trim();
  s = s.replace(REG_WORD_RX, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) s = s.replace(REG_LEAD_RX, '').replace(REG_TAIL_RX, '').trim();
  return s;
}
function regDone(c) { return !!(c && (c.pos_id || (c.auto && c.auto.reg && c.auto.reg.done_at))); }
function regNeeded(c) { return REG_MODE === 'on' && !regDone(c); }
function regStart(s, pendingText, opts) {
  s.reg = { step: 'name', data: {}, tries: {}, pending: '', at: Date.now(), update: !!(opts && opts.update), invited: !!(opts && opts.invited) };
  const t = String(pendingText || '').trim();
  if (t && t.length >= 6 && !REG_GREET_RX.test(t) && REG_QUESTION_RX.test(t)) s.reg.pending = t.slice(0, 500);
  markDirty();
}
// คำสั่งจากลูกค้า: "ลงทะเบียน/สมัคร" (เริ่มลงทะเบียน) และ "แก้ไขข้อมูล" (อัปเดตข้อมูลที่ลงทะเบียนไว้)
const REG_CMD_RX = /^(ขอ|อยาก)?(ลงทะเบียน|สมัครสมาชิก|สมัคร|register)(สมาชิก|ใหม่|ด้วย|หน่อย|เลย|ค่ะ|ครับ|คะ|จ้า|นะ|ค่า)*[\s.!]*$/i;
const REG_EDIT_RX = /^(ขอ|อยาก)?(แก้ไขข้อมูล|แก้ข้อมูล|อัปเดตข้อมูล|อัพเดทข้อมูล|เปลี่ยนเบอร์|แก้ไขการลงทะเบียน|แก้ทะเบียน|เปลี่ยนข้อมูล)(ส่วนตัว|ลงทะเบียน|โทร|ใหม่|ด้วย|หน่อย|เลย|ค่ะ|ครับ|คะ|จ้า|นะ|ค่า)*[\s.!]*$/i;
function regCmd(t) { const x = String(t || '').trim(); return REG_CMD_RX.test(x) ? 'register' : (REG_EDIT_RX.test(x) ? 'edit' : ''); }
function regSummaryText(c) {
  const r = (c && c.auto && c.auto.reg) || {};
  const name = c.real_name || r.name || '-', phone = c.phone || r.phone || '-', prov = c.province || r.province || '-';
  return `ชื่อ ${name} · เบอร์ ${phone} · จ.${prov}`;
}
// ข้อความเชิญลงทะเบียน (Push ถึงลูกค้าเก่าที่ยังไม่ลงทะเบียน)
function regInviteMsg(s) {
  return 'สวัสดีค่ะ 🙏 น้องลัดดา ผู้ช่วยจาก ICP Ladda ขอรบกวนคุณลูกค้าลงทะเบียนสั้นๆ 3 ข้อ เพื่อให้ทีมงานในพื้นที่ดูแลได้ตรงจุด และรับข่าวสาร/โปรโมชั่นตรงพื้นที่นะคะ (ไม่ถึงนาทีค่ะ)\n\n' + regPrompt('name', s) + '\n(พิมพ์ตอบข้อความนี้ได้เลยค่ะ)';
}
async function regInvite(id) {
  const s = sessions.get(id);
  const c = crmGet(id);
  if (!s || s.type !== 'user') return { ok: false, err: 'ไม่ใช่แชทลูกค้า' };
  if (regDone(c)) return { ok: false, err: 'ลงทะเบียนแล้ว' };
  c.auto = c.auto || {}; c.auto.reg_asked = true;
  s.regInvitedAt = Date.now();
  let msg;
  if (REG_UI === 'liff' && LIFF_URL) { msg = liffButtonMsg('invite'); }
  else { regStart(s, '', { invited: true }); s.reg.invitedAt = Date.now(); msg = regInviteMsg(s); }
  const ok = await linePush(id, msg);
  if (ok) { const ht = Array.isArray(msg) ? msg[0] : msg; pushHist(s, 'b', ht); s.lastText = String(ht).slice(0, 120); }
  markDirty(); broadcast();
  console.log(`[reg] invite ${id.slice(0, 8)} -> ${ok ? 'sent' : 'FAILED'}`);
  return { ok, err: ok ? undefined : 'ส่ง Push ไม่สำเร็จ (ลูกค้าบล็อก OA / โควต้า / token)' };
}
function regUnregisteredIds() {
  const out = [];
  for (const [id, s] of sessions) if (s.type === 'user' && id !== 'unknown' && !regDone(crm.get(id))) out.push(id);
  return out;
}
function regParse(text) {
  const raw = String(text || '').trim();
  const phones = phonesOf(raw);
  const province = provinceOf(raw);
  let rest = raw.replace(new RegExp(PHONE_RX.source, 'g'), ' ').replace(/(\+?66)?[\d\-\s]{9,}/g, ' ');
  if (province) rest = rest.replace(PROVINCE_ALL_RX, ' ');
  return { phone: phones[0] || '', province, name: regClean(rest) };
}
function regNameOk(n) { return n && n.length >= 2 && n.length <= 60 && /\p{L}/u.test(n) && !REG_QUESTION_RX.test(n) && !REG_CMD_RX.test(n) && !REG_EDIT_RX.test(n) && !/^(ข้าม|ไม่|ไม่มี|ไม่สะดวก|ไม่บอก|ไม่รู้)$/.test(n); }
function regPrompt(step, s) {
  const d = s.reg.data;
  if (step === 'name') return '1️⃣ ขอทราบชื่อ-นามสกุลของคุณลูกค้าค่ะ (พิมพ์ตอบได้เลย เช่น สมชาย ใจดี)';
  if (step === 'phone') return (d.name ? `ขอบคุณค่ะ คุณ${d.name} 😊\n` : '') + '2️⃣ ขอเบอร์โทรศัพท์ที่ติดต่อได้ค่ะ (ตัวเลข 10 หลัก เช่น 0812345678)';
  return '3️⃣ อยู่จังหวัดอะไรคะ (พิมพ์ชื่อจังหวัด เช่น จันทบุรี, ขอนแก่น)';
}
function regWelcome(s, c) {
  if (s.reg && s.reg.update) return 'ได้เลยค่ะ มาอัปเดตข้อมูลกันนะคะ ✍️' + (c ? '\n(ข้อมูลเดิม: ' + regSummaryText(c) + ')' : '') + '\nพิมพ์ตอบทีละข้อ หรือพิมพ์ครบในข้อความเดียวก็ได้ค่ะ\n\n' + regPrompt('name', s);
  return 'สวัสดีค่ะ 🙏 น้องลัดดา ผู้ช่วยจาก ICP Ladda ยินดีต้อนรับค่ะ 🌾\nก่อนเริ่มใช้งาน ขอข้อมูลสั้นๆ 3 อย่าง เพื่อให้ทีมงานในพื้นที่ดูแลคุณลูกค้าได้ตรงจุดนะคะ (ไม่ถึงนาทีค่ะ)\n\n' + regPrompt('name', s)
    + (s.reg.pending ? '\n\n(คำถามเรื่อง “' + s.reg.pending.slice(0, 40) + (s.reg.pending.length > 40 ? '…' : '') + '” น้องลัดดาจะตอบให้ทันทีหลังลงทะเบียนเสร็จค่ะ)' : '');
}
// คืนค่า { replies:[...], done:bool }
function regHandle(id, s, c, text) {
  const r = s.reg;
  const d = r.data;
  const p = regParse(text);
  const step = r.step;
  const invalid = [];
  // รับข้อมูลทุกช่องที่จับได้จากข้อความ (พิมพ์มาทีเดียวครบก็จบเลย)
  if (p.phone && !d.phone) d.phone = p.phone;
  if (p.province && !d.province) d.province = p.province;
  if (step === 'name') {
    if (regNameOk(p.name) && !d.name) d.name = p.name.slice(0, 60);
    else if (!d.name) { r.tries.name = (r.tries.name || 0) + 1; if (r.tries.name >= 3 && p.name && p.name.length >= 2) d.name = p.name.slice(0, 60); else invalid.push('name'); }
  } else if (step === 'phone') {
    if (!p.phone && !d.phone) {
      r.tries.phone = (r.tries.phone || 0) + 1;
      if (/^ข้าม$/.test(String(text).trim()) && r.tries.phone >= 2) d.phone = '-';
      else invalid.push('phone');
    }
  } else if (step === 'province') {
    if (!p.province && !d.province) {
      r.tries.province = (r.tries.province || 0) + 1;
      const t = p.name;
      if (r.tries.province >= 2 && t && t.length <= 40 && /\p{L}/u.test(t)) d.province = t; // ยอมรับข้อความที่พิมพ์ (แอดมินแก้ทีหลังได้)
      else invalid.push('province');
    }
    if (!d.name && regNameOk(p.name)) d.name = p.name.slice(0, 60);
  }
  if (invalid.length) {
    const msg = step === 'name'
      ? (REG_QUESTION_RX.test(String(text)) ? 'น้องลัดดาขอทราบชื่อ-นามสกุลก่อนนะคะ (พิมพ์เฉพาะชื่อค่ะ เช่น สมชาย ใจดี) แล้วจะรีบตอบคำถามให้ทันทีค่ะ 😊' : 'ขอชื่อ-นามสกุลของคุณลูกค้าค่ะ (พิมพ์เฉพาะชื่อ เช่น สมชาย ใจดี)')
      : step === 'phone'
        ? ('เบอร์โทรยังไม่ถูกต้องค่ะ พิมพ์เป็นตัวเลข 9-10 หลัก เช่น 0812345678' + (r.tries.phone >= 2 ? '\n(ถ้าไม่สะดวกให้เบอร์ พิมพ์ว่า ข้าม ได้ค่ะ)' : ''))
        : 'ยังไม่พบชื่อจังหวัดค่ะ ลองพิมพ์ใหม่อีกครั้ง เช่น ขอนแก่น, จันทบุรี, นครสวรรค์';
    if (step === 'name' && !r.pending && REG_QUESTION_RX.test(String(text)) && String(text).length >= 6) r.pending = String(text).slice(0, 500);
    markDirty();
    return { replies: [msg], done: false, invalid: true };
  }
  // ขั้นต่อไปที่ยังขาด
  const next = !d.name ? 'name' : (!d.phone ? 'phone' : (!d.province ? 'province' : ''));
  if (next) { r.step = next; markDirty(); return { replies: [regPrompt(next, s)], done: false }; }
  return { replies: [], done: true };
}
// อัปเดตแถวใน POS (เช่น ลูกค้าเปลี่ยนเบอร์/จังหวัดตอน "แก้ไขข้อมูล") + ปรับดัชนีในหน่วยความจำ
async function posUpdateRow(rec, fields) {
  const k = pos.cols;
  if (!POS_ON || !k || !rec) return false;
  const body = {};
  if (fields.phone !== undefined && k.phone[0]) body[k.phone[0]] = fields.phone || null;
  if (fields.province !== undefined && k.province) body[k.province] = fields.province || null;
  if (fields.name !== undefined && k.name.length === 1) body[k.name[0]] = fields.name;
  if (!Object.keys(body).length) return false;
  try {
    const r = await sb('PATCH', `/${POS_TABLE}?${encodeURIComponent(k.id)}=eq.${encodeURIComponent(rec.id)}`, body, Object.assign({ Prefer: 'return=minimal' }, POS_HEADERS));
    if (r.status >= 300) { console.log('[pos] update failed:', r.status, JSON.stringify(r.data).slice(0, 160)); return false; }
    if (fields.phone !== undefined) {
      for (const p of rec.phones) { const arr = (pos.byPhone.get(p) || []).filter((x) => x !== rec); if (arr.length) pos.byPhone.set(p, arr); else pos.byPhone.delete(p); }
      rec.phones = phonesOf(fields.phone);
      for (const p of rec.phones) { const arr = pos.byPhone.get(p) || []; arr.push(rec); pos.byPhone.set(p, arr); }
    }
    if (fields.province !== undefined) rec.province = fields.province || '';
    if (fields.name !== undefined && k.name.length === 1) { rec.name = fields.name; rec.names[0] = fields.name; rec.nnames[0] = normName(fields.name); }
    return true;
  } catch (e) { console.log('[pos] update error:', e.message); return false; }
}
// บันทึกผลการลงทะเบียน (ใช้ร่วมกันทั้งแชท wizard และฟอร์ม LIFF): d = {name, phone, province, district?, crops?, type?}
// opts = { update:bool, source:'chat'|'liff' }  คืน { doneMsg, posNote, zone }
async function regApply(id, c, d, opts) {
  const isUpdate = !!(opts && opts.update);
  const source = (opts && opts.source) || 'chat';
  const phone = d.phone && d.phone !== '-' ? d.phone : '';
  c.auto = c.auto || {};
  const oldPhone = c.phone || '', oldProv = c.province || '';
  if (isUpdate || !c.real_name || (c.auto.pos_filled && c.auto.pos_filled.real_name === c.real_name)) c.real_name = d.name;
  if (phone) { c.phone = phone; c.auto.phone = isUpdate ? phone : (c.auto.phone || phone); }
  if (d.province && (isUpdate || !c.province)) c.province = d.province;
  if (d.district && (isUpdate || !c.district)) c.district = String(d.district).slice(0, 60);
  if (d.crops && (isUpdate || !c.crops)) c.crops = String(d.crops).slice(0, 200);
  if (d.subdistrict) c.auto.subdistrict = String(d.subdistrict).slice(0, 60);
  if (d.farm_rai != null && isFinite(d.farm_rai)) c.farm_rai = d.farm_rai;
  c.auto.reg = { done_at: new Date().toISOString(), source: isUpdate ? source + '-update' : source, name: d.name, phone, province: d.province || '', type: d.type || '',
    first_name: d.first_name || '', last_name: d.last_name || '', gender: d.gender || '', subdistrict: d.subdistrict || '', areas: Array.isArray(d.areas) ? d.areas.slice(0, 20) : undefined, area_line: d.area_line || '' };
  c.updated_at = new Date().toISOString();
  markDirty();
  broadcast();
  if (SB_ON) sbUpsert(c);
  const via = source === 'liff' ? 'ฟอร์ม LIFF' : 'แชท';
  crmAddNote(id, `📝 ลูกค้า${isUpdate ? 'อัปเดตข้อมูล' : 'ลงทะเบียน'}ผ่าน${via}: ${d.name}${phone ? ' · ' + phone : ''}${d.province ? ' · ' + d.province : ''}${d.district ? ' อ.' + d.district : ''}${d.crops ? ' · ' + d.crops : ''}`, 'system').catch(() => {});
  let posNote = '';
  if (POS_ON) {
    if (!pos.rows.length && !pos.loading) posRefresh().catch(() => {});
    if (c.pos_id) {
      posNote = isUpdate ? '' : 'พบข้อมูลของคุณในระบบสมาชิกของเราแล้ว ✅';
      if (isUpdate) { // ผูก POS อยู่แล้ว -> อัปเดตเบอร์/จังหวัดในแถว POS ให้ตรงกัน
        const rec = pos.byId.get(String(c.pos_id));
        const fields = {};
        if (phone && phone !== oldPhone) fields.phone = phone;
        if (d.province && d.province !== oldProv) fields.province = d.province;
        if (rec && Object.keys(fields).length) { const okU = await posUpdateRow(rec, fields); if (okU) posNote = 'อัปเดตข้อมูลสมาชิกในระบบเรียบร้อยแล้ว ✅'; }
      }
    } else {
      const m = phone ? posMatch(id) : null;
      if (m && m.linked) posNote = 'พบข้อมูลของคุณในระบบสมาชิกของเราแล้ว ✅';
      else if (m && m.candidates && m.candidates.length) posNote = ''; // เบอร์ตรงกับรายชื่ออื่น -> ให้แอดมินยืนยัน (ไม่สร้างซ้ำ)
      else if (pos.cols) { const r = await posCreate(id, 'reg'); if (r.ok) posNote = 'บันทึกข้อมูลสมาชิกเรียบร้อยแล้ว ✅'; }
    }
  }
  const z = zoneInfo(c.province || d.province || '');
  const zoneLine = z ? `\nทีมงานดูแลพื้นที่ของคุณ (เขต ${z.zone}): ${z.team}` : '';
  const addressLine = [d.subdistrict ? 'ต.' + d.subdistrict : '', d.district ? 'อ.' + d.district : '', d.province ? 'จ.' + d.province : ''].filter(Boolean).join(' ');
  const areaPart = d.area_line ? ' · พื้นที่ปลูก ' + d.area_line : '';
  const addrPart = (d.district || d.subdistrict) ? (addressLine ? '\n' + addressLine : '') : (d.province ? ' จ.' + d.province : '');
  const doneMsg = (isUpdate ? `✅ อัปเดตข้อมูลเรียบร้อยค่ะ (${regSummaryText(c)}) 🙏` : `✅ ลงทะเบียนเรียบร้อยค่ะ ขอบคุณคุณ${d.name}${addrPart}${areaPart} 🙏`) + `${posNote ? '\n' + posNote : ''}${zoneLine}\n\nสอบถามเรื่องสินค้า โรค แมลง วัชพืช หรือขอคำแนะนำได้เลยนะคะ 🌾`;
  const s = sessions.get(id);
  if (s && s.reg) { s.reg = null; markDirty(); }
  console.log(`[reg] ${id.slice(0, 8)} ${isUpdate ? 'updated' : 'registered'} via ${source}: ${d.name} / ${phone || '-'} / ${d.province || '-'}`);
  return { doneMsg, posNote, zone: z, addressLine };
}
async function regFinish(id, s, c) {
  const pending = s.reg.pending;
  const r = await regApply(id, c, s.reg.data, { update: !!s.reg.update, source: 'chat' });
  return { doneMsg: r.doneMsg, pending };
}
function regInfo(s, c) {
  const reg = c && c.auto && c.auto.reg;
  return { mode: REG_MODE, ui: REG_UI, done: regDone(c), done_at: reg ? reg.done_at : null, source: reg ? reg.source : (c && c.pos_id ? 'pos' : null), data: reg || null, inProgress: !!(s && s.reg), step: s && s.reg ? s.reg.step : null, needed: regNeeded(c) };
}

// ---------- LIFF (v3.3): ฟอร์มลงทะเบียนในแอป LINE ----------
// ข้อความแบบปุ่มเปิดฟอร์ม LIFF (text + buttons template) — kind: welcome | gate | invite | edit | again | done
function liffButtonMsg(kind, extra) {
  const url = LIFF_URL;
  const fallback = '\n(ถ้าเปิดฟอร์มไม่ได้ พิมพ์ "ลงทะเบียนผ่านแชท" ได้ค่ะ)';
  let text, label = '📝 ลงทะเบียนสมาชิก', btnText = 'กดปุ่มเพื่อกรอกฟอร์มลงทะเบียน (ไม่ถึงนาที)';
  if (kind === 'welcome') text = 'สวัสดีค่ะ 🙏 น้องลัดดา ผู้ช่วยจาก ICP Ladda ยินดีต้อนรับค่ะ 🌾\nก่อนเริ่มใช้งาน รบกวนลงทะเบียนสมาชิกสั้นๆ (ชื่อ เบอร์ จังหวัด) เพื่อให้ทีมงานในพื้นที่ดูแลคุณลูกค้าได้ตรงจุดนะคะ กดปุ่มด้านล่างได้เลยค่ะ' + fallback;
  else if (kind === 'gate') text = 'ก่อนเริ่มใช้งาน น้องลัดดาขอรบกวนคุณลูกค้าลงทะเบียนสมาชิกสั้นๆ ก่อนนะคะ (ไม่ถึงนาทีค่ะ) กดปุ่มด้านล่างเพื่อกรอกฟอร์ม' + (extra && extra.pending ? '\n\n(คำถามเรื่อง “' + String(extra.pending).slice(0, 40) + (String(extra.pending).length > 40 ? '…' : '') + '” น้องลัดดาจะตอบให้ทันทีหลังลงทะเบียนเสร็จค่ะ)' : '') + fallback;
  else if (kind === 'invite') text = 'สวัสดีค่ะ 🙏 น้องลัดดา ผู้ช่วยจาก ICP Ladda ขอรบกวนคุณลูกค้าลงทะเบียนสมาชิกสั้นๆ (ชื่อ เบอร์ จังหวัด) เพื่อให้ทีมงานในพื้นที่ดูแลได้ตรงจุด และรับข่าวสาร/โปรโมชั่นตรงพื้นที่นะคะ กดปุ่มด้านล่างได้เลยค่ะ' + fallback;
  else if (kind === 'edit') { text = 'แก้ไขข้อมูลสมาชิกได้ที่ฟอร์มด้านล่างค่ะ ✍️' + (extra && extra.summary ? '\n(ข้อมูลเดิม: ' + extra.summary + ')' : ''); label = '✏️ แก้ไขข้อมูลสมาชิก'; btnText = 'กดปุ่มเพื่อเปิดฟอร์มแก้ไขข้อมูล'; }
  else if (kind === 'again') text = 'ยังลงทะเบียนไม่เสร็จค่ะ 😊 กดปุ่มด้านล่างเพื่อกรอกฟอร์มได้เลย' + fallback;
  else text = 'ลงทะเบียนสมาชิกได้ที่ปุ่มด้านล่างค่ะ' + fallback;
  return [text, { type: 'template', altText: (kind === 'edit' ? 'แก้ไขข้อมูลสมาชิก: ' : 'ลงทะเบียนสมาชิก: ') + url, template: { type: 'buttons', text: btnText.slice(0, 160), actions: [{ type: 'uri', label: label.slice(0, 20), uri: url }] } }];
}
// ตรวจ token จาก LIFF กับ LINE: ID token (ต้องมี LINE_LOGIN_CHANNEL_ID) หรือ access token (+ ดึงโปรไฟล์) -> { userId, name, picture }
async function liffVerify(idToken, accessToken) {
  try {
    if (idToken && LINE_LOGIN_CHANNEL_ID) {
      const r = await request('POST', LINE_API + '/oauth2/v2.1/verify', { 'Content-Type': 'application/x-www-form-urlencoded' },
        'id_token=' + encodeURIComponent(idToken) + '&client_id=' + encodeURIComponent(LINE_LOGIN_CHANNEL_ID));
      if (r.status === 200 && r.data && r.data.sub) return { userId: String(r.data.sub), name: r.data.name || '', picture: r.data.picture || '', via: 'id_token' };
      console.log('[liff] id_token verify failed:', r.status, JSON.stringify(r.data).slice(0, 160));
    }
    if (accessToken) {
      const v = await request('GET', LINE_API + '/oauth2/v2.1/verify?access_token=' + encodeURIComponent(accessToken));
      if (v.status !== 200 || !v.data) { console.log('[liff] access_token verify failed:', v.status); return null; }
      if (LINE_LOGIN_CHANNEL_ID && String(v.data.client_id) !== LINE_LOGIN_CHANNEL_ID) { console.log('[liff] access_token client_id mismatch'); return null; }
      const p = await request('GET', LINE_API + '/v2/profile', { Authorization: 'Bearer ' + accessToken });
      if (p.status === 200 && p.data && p.data.userId) return { userId: String(p.data.userId), name: p.data.displayName || '', picture: p.data.pictureUrl || '', via: 'access_token' };
      console.log('[liff] profile failed:', p.status);
    }
  } catch (e) { console.log('[liff] verify error:', e.message); }
  return null;
}
function liffProfileFor(id, c, s) {
  const z = zoneInfo(c.province || '');
  return {
    real_name: c.real_name || '', phone: c.phone || (c.auto && c.auto.phone) || '', province: c.province || (c.auto && c.auto.province) || '', district: c.district || '',
    subdistrict: (c.auto && c.auto.subdistrict) || '', farm_rai: c.farm_rai == null ? null : c.farm_rai,
    crops: c.crops || (c.auto && c.auto.crops) || '', type: (c.auto && c.auto.reg && c.auto.reg.type) || '',
    registered: regDone(c), reg: regInfo(s, c), pos: c.pos_id ? { linked: true, name: c.pos_name || '' } : { linked: false }, zone: z ? Object.assign({}, z, { rows: zoneTeamRows(z) }) : null
  };
}
// รับข้อมูลจากฟอร์ม -> ตรวจ -> บันทึก (regApply) -> คืนข้อความยืนยัน
async function liffRegister(who, body) {
  const id = who.userId;
  const first = String(body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const last = String(body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const name = (first || last) ? (first + ' ' + last).trim() : String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const gender = body.gender === 'male' || body.gender === 'female' ? body.gender : '';
  const phone = normPhone(body.phone);
  const province = provinceOf(String(body.province || '')) || String(body.province || '').trim().slice(0, 60);
  const district = String(body.district || '').trim().replace(/^(อ\.|อำเภอ|เขต)\s*/, '').slice(0, 60);
  const subdistrict = String(body.subdistrict || '').trim().replace(/^(ต\.|ตำบล|แขวง)\s*/, '').slice(0, 60);
  // พืช: [{name, rai, ngan}] หรือ ['ชื่อ', ...] หรือ 'ชื่อ, ชื่อ'
  let areas = [];
  const rawCrops = Array.isArray(body.crops) ? body.crops : String(body.crops || '').split(',');
  for (const it of rawCrops.slice(0, 20)) {
    if (it && typeof it === 'object') { const n = String(it.name || '').trim().slice(0, 40); if (n) areas.push({ name: n, rai: String(it.rai == null ? '' : it.rai).replace(/[^\d.]/g, '').slice(0, 8), ngan: String(it.ngan == null ? '' : it.ngan).replace(/[^\d.]/g, '').slice(0, 8) }); }
    else { const n = String(it || '').trim().slice(0, 40); if (n) areas.push({ name: n, rai: '', ngan: '' }); }
  }
  const crops = areas.map((a) => a.name).join(', ');
  const areaLine = areas.some((a) => a.rai || a.ngan) ? areas.map((a) => a.name + ' ' + (a.rai || '0') + ' ไร่' + (a.ngan ? ' ' + a.ngan + ' งาน' : '')).join(' · ') : '';
  const totalRai = areas.reduce((sum, a) => sum + (parseFloat(a.rai) || 0) + (parseFloat(a.ngan) || 0) / 4, 0);
  const type = body.type === 'shop' ? 'shop' : (body.type === 'farmer' ? 'farmer' : (SHOP_NAME_RX.test(name) ? 'shop' : ''));
  const errors = {};
  if (name.length < 2) errors.name = 'กรุณากรอกชื่อ-นามสกุล';
  if (!phone) errors.phone = 'เบอร์โทรไม่ถูกต้อง (ตัวเลข 9-10 หลัก)';
  if (!province) errors.province = 'กรุณาเลือกจังหวัด';
  if (!body.consent) errors.consent = 'กรุณายืนยันการยินยอมให้เก็บข้อมูล';
  if (Object.keys(errors).length) return { ok: false, errors };
  const s = touchSession(id, 'user', '(ลงทะเบียนผ่านฟอร์ม LIFF)');
  const c = crmGet(id);
  if (!s.name && who.name) { s.name = who.name.slice(0, 60); s.pic = (who.picture || '').slice(0, 500); }
  else fetchProfile(s, id);
  if (!c.display_name && who.name) { c.display_name = who.name.slice(0, 60); c.picture_url = who.picture || ''; }
  const wasDone = regDone(c);
  const r = await regApply(id, c, { name, phone, province, district, crops, type, first_name: first, last_name: last, gender, subdistrict, areas, area_line: areaLine, farm_rai: areas.length ? Math.round(totalRai * 100) / 100 : null }, { update: wasDone, source: 'liff' });
  c.auto.reg.msg = r.doneMsg.slice(0, 1500);
  c.auto.reg.confirmed = false;
  markDirty();
  const zone = r.zone ? Object.assign({}, r.zone, { rows: zoneTeamRows(r.zone) }) : null;
  return { ok: true, doneMsg: r.doneMsg, posNote: r.posNote, zone, updated: wasDone, fullName: name, addressLine: r.addressLine, areaLine, profile: liffProfileFor(id, c, s) };
}
// หลังลงทะเบียนผ่าน LIFF: ส่งข้อความยืนยันเข้าแชท (ครั้งเดียว) — ใช้เมื่อหน้า LIFF ส่งข้อความในนามลูกค้าไม่ได้ (Push 1 ข้อความ)
async function liffConfirmPush(id) {
  const c = crm.get(id);
  const s = sessions.get(id);
  if (!c || !c.auto || !c.auto.reg || !c.auto.reg.msg) return { ok: false, err: 'ยังไม่ได้ลงทะเบียน' };
  if (c.auto.reg.confirmed) return { ok: true, already: true };
  const msgs = [c.auto.reg.msg];
  if (s && s.regPending) { const ans = await askDify(id, s.regPending); if (ans) msgs.push(ans.slice(0, 4900)); s.regPending = ''; }
  const ok = await linePush(id, msgs);
  if (ok) { c.auto.reg.confirmed = true; if (s) { for (const m of msgs) pushHist(s, 'b', m); s.lastText = String(msgs[0]).slice(0, 120); s.lastAt = Date.now(); } markDirty(); broadcast(); }
  return { ok };
}
// หน้า LIFF (liff.html วางคู่กับ server.js) + ข้อมูลจังหวัด/อำเภอ/ตำบล (thai_locations.json — จาก kongvut/thai-province-data, MIT)
let liffHtmlCache = null;
function liffPage() {
  if (liffHtmlCache === null) {
    try { liffHtmlCache = fs.readFileSync(pathmod.join(__dirname, 'liff.html'), 'utf8'); }
    catch (e) { liffHtmlCache = ''; console.log('[liff] liff.html not found next to server.js:', e.message); }
  }
  const html = liffHtmlCache || '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:sans-serif;padding:24px;line-height:1.6">⚠️ ไม่พบไฟล์ liff.html บนเซิร์ฟเวอร์ (ต้องอัปโหลด liff.html คู่กับ server.js แล้ว Redeploy)</body></html>';
  return html.replace('__LIFF_ID__', LIFF_ID.replace(/[^\w-]/g, '')).replace('__PROVINCES__', JSON.stringify(PROVINCES_ALL));
}
let locBuf = null, locGz = null, locTried = false;
function loadLocations() {
  if (locTried) return;
  locTried = true;
  try {
    locBuf = fs.readFileSync(pathmod.join(__dirname, 'thai_locations.json'));
    JSON.parse(locBuf.toString('utf8'));
    locGz = zlib.gzipSync(locBuf);
    console.log(`[liff] locations loaded (${locBuf.length} bytes, gzip ${locGz.length})`);
  } catch (e) { locBuf = null; locGz = null; console.log('[liff] thai_locations.json ไม่พร้อม (' + e.message + ') — ฟอร์มจะใช้ช่องพิมพ์อำเภอ/ตำบลแทน'); }
}
// ทีมงานประจำเขต -> แถว {name, phone} สำหรับหน้า LIFF (จากสตริง ZONE_TEAM)
function zoneTeamRows(z) {
  if (!z || !z.team) return [];
  const rows = [];
  for (const seg of String(z.team).split(' · ')) {
    for (const item of seg.split(' / ')) {
      const m = /^(.*?)\s*(\d[\d-]{7,12})\s*$/.exec(item.trim());
      if (!m) continue;
      const d = m[2].replace(/\D/g, '');
      rows.push({ name: m[1].trim(), phone: d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : m[2] });
    }
  }
  return rows;
}
function readJson(body) { try { return JSON.parse(body.toString('utf8')) || {}; } catch (_) { return {}; } }
async function handleLiff(req, res, path, body) {
  if (req.method === 'GET' && (path === '/liff' || path === '/liff/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(liffPage());
  }
  if (req.method === 'GET' && path === '/liff/config') return sendJson(res, 200, { ok: true, liffId: LIFF_ID, url: LIFF_URL, on: REG_UI === 'liff' });
  if (req.method === 'GET' && path === '/liff/locations.json') {
    loadLocations();
    if (!locBuf) return sendJson(res, 404, { ok: false, error: 'locations not available' });
    const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }, gz ? { 'Content-Encoding': 'gzip' } : {}));
    return res.end(gz ? locGz : locBuf);
  }
  if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'not found' });
  const data = readJson(body);
  const who = await liffVerify(data.idToken, data.accessToken);
  if (!who) return sendJson(res, 401, { ok: false, error: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ (token ไม่ถูกต้อง/หมดอายุ หรือ LINE Login channel ไม่ตรง)' });
  if (path === '/liff/me') {
    const c = crmGet(who.userId);
    const s = sessions.get(who.userId);
    return sendJson(res, 200, { ok: true, name: who.name, profile: liffProfileFor(who.userId, c, s) });
  }
  if (path === '/liff/register') {
    const r = await liffRegister(who, data);
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  if (path === '/liff/confirm') {
    const r = await liffConfirmPush(who.userId);
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  return sendJson(res, 404, { ok: false, error: 'not found' });
}

// ---------- ธง "รอติดต่อกลับ" (callback) ----------
// (ก) บอทรับปาก: "ติดต่อกลับ / โทรกลับ / ส่งเรื่องให้…แล้ว / ประสาน…แล้ว / เจ้าหน้าที่จะรีบติดต่อ ฯลฯ"
const CB_BOT_RX = /ติดต่อกลับ|โทรกลับ|(ส่งเรื่อง|ส่งต่อ|ประสาน|แจ้ง|บันทึกข้อมูล)[^\n]{0,40}?(เรียบร้อย|ให้แล้ว|แล้วนะ|แล้วค่ะ|แล้วจ้ะ)|(เจ้าหน้าที่|ทีมงาน|แอดมิน|ฝ่ายขาย|พี่ ?ๆ|ผู้แทน)[^\n]{0,24}?จะ(รีบ)?(ติดต่อ|โทร|เข้ามา|ตอบ|ประสาน)/;
// (ข) ลูกค้าทิ้งเบอร์โทร (มือถือ 10 หลัก / บ้าน 9 หลัก มีหรือไม่มีขีด/ช่องว่างก็ได้)
const PHONE_RX = /(?<!\d)0\d{1,2}[- ]?\d{3}[- ]?\d{3,4}(?!\d)/;

function lastUserText(s) {
  for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].r === 'u') return s.history[i].t;
  return '';
}

function flagCallback(id, s, src, extra) {
  const isNew = !s.cb;
  if (isNew) {
    s.cb = { at: Date.now(), src, topic: String(lastUserText(s)).slice(0, 120), contact: '', note: '' };
    s.cbCount = (s.cbCount || 0) + 1;
  }
  if (extra && extra.note && !s.cb.note) s.cb.note = String(extra.note).slice(0, 160);
  if (extra && extra.contact) s.cb.contact = String(extra.contact).slice(0, 80);
  if (extra && extra.topic && !s.cb.topic) s.cb.topic = String(extra.topic).slice(0, 120);
  markDirty();
  broadcast();
  console.log(`[callback] ${id.slice(0, 8)} src=${src} new=${isNew} contact=${s.cb.contact ? 'yes' : 'no'}`);
  if (isNew || (extra && extra.contact)) notifyAdmins(id, s, isNew);
}

function clearCallback(s) {
  if (!s.cb) return;
  s.cbDone = Object.assign({}, s.cb, { doneAt: Date.now() });
  s.cb = null;
  markDirty();
  broadcast();
}

function detectBotPromise(id, s, text) {
  const m = CB_BOT_RX.exec(String(text || ''));
  if (!m) return;
  const i = Math.max(0, m.index - 40);
  flagCallback(id, s, 'bot', { note: String(text).slice(i, m.index + 80).replace(/\s+/g, ' ') });
}

function detectPhone(id, s, text) {
  const m = PHONE_RX.exec(String(text || ''));
  if (!m) return;
  flagCallback(id, s, 'phone', { contact: String(text).trim().slice(0, 80), topic: lastUserText(s) });
}

function notifyAdmins(id, s, isNew) {
  if (!ADMIN_NOTIFY_IDS.length) return;
  const name = (s.name && s.name !== '…') ? s.name : id.slice(0, 10) + '…';
  const msg = (isNew ? '🔔 ลูกค้ารอติดต่อกลับ' : '📞 ลูกค้าทิ้งเบอร์ติดต่อแล้ว')
    + `\nลูกค้า: ${name}`
    + (s.cb.topic ? `\nเรื่อง: ${s.cb.topic.slice(0, 100)}` : '')
    + (s.cb.contact ? `\nติดต่อ: ${s.cb.contact}` : '\nติดต่อ: (ยังไม่ได้ทิ้งเบอร์)')
    + (PUBLIC_URL ? `\nเปิดหน้าแอดมิน: ${PUBLIC_URL}/admin` : '');
  for (const to of ADMIN_NOTIFY_IDS) {
    if (to === id) continue;
    linePush(to, msg).catch(() => {});
  }
}

// opts.system = ข้อความระบบของ bridge เอง (เช่น แบบฟอร์มลงทะเบียน) -> ไม่ต้องตรวจ "บอทรับปากติดต่อกลับ" (ตรวจเฉพาะคำตอบจาก Dify)
async function sendAnswer(s, ev, fallbackTo, text, opts) {
  const arr = (Array.isArray(text) ? text : [text]).filter((t) => t != null && (typeof t === 'object' ? !!t.type : String(t).trim()));
  const skip = opts && opts.system === true ? arr.length : (opts && typeof opts.system === 'number' ? opts.system : 0);
  arr.forEach((t, i) => { const ht = typeof t === 'object' ? (t.altText || '(ข้อความแบบปุ่ม)') : t; pushHist(s, 'b', ht); if (i >= skip) detectBotPromise(fallbackTo || 'unknown', s, ht); });
  const ok = await lineReply(ev.replyToken, arr);
  if (!ok && fallbackTo && fallbackTo !== 'unknown') {
    const pushed = await linePush(fallbackTo, text);
    console.log(`[send] reply=failed push=${pushed}`);
  } else {
    console.log(`[send] reply=${ok}`);
  }
}

// ---------- คีย์เวิร์ดปิด/เปิดเสียง ----------
const MUTE_WORDS = ['คุยกับแอดมิน', 'ติดต่อแอดมิน', 'ขอสายแอดมิน', 'ขอแอดมิน', 'แอดมินตอบ', 'ต่อแอดมิน', 'หาแอดมิน'];
const UNMUTE_WORDS = ['คุยกับบอท', 'คุยกับน้องลัดดา', 'เปิดบอท', '/bot'];

function wantsAdmin(t) {
  const x = (t || '').trim();
  return x === 'แอดมิน' || x === 'admin' || MUTE_WORDS.some((w) => x.includes(w));
}
function wantsBot(t) {
  const x = (t || '').trim();
  return UNMUTE_WORDS.some((w) => x.includes(w));
}

// ---------- Event processing ----------
async function handleEvent(ev) {
  if (ev.deliveryContext && ev.deliveryContext.isRedelivery) return;

  const src = ev.source || {};
  const userId = src.userId || 'unknown';
  const sessionId = src.groupId || src.roomId || userId;
  const stype = src.groupId ? 'group' : (src.roomId ? 'room' : 'user');
  const pushTarget = src.groupId || src.roomId || userId;

  // ลูกค้าแอดเพื่อน (follow) -> ทักทาย + เริ่มลงทะเบียน (ถ้ายังไม่เคย)
  if (ev.type === 'follow') {
    if (stype !== 'user' || userId === 'unknown') return;
    const s = touchSession(sessionId, stype, '(เพิ่มเพื่อน)');
    fetchProfile(s, userId);
    const c = crmGet(sessionId);
    crmTouch(sessionId, s, '');
    if (regNeeded(c) || (REG_MODE === 'soft' && !regDone(c))) {
      c.auto = c.auto || {}; c.auto.reg_asked = true;
      if (REG_UI === 'liff' && LIFF_URL) {
        console.log(`[follow] ${sessionId.slice(0, 8)} -> LIFF register button`);
        await sendAnswer(s, ev, pushTarget, liffButtonMsg('welcome'), { system: true });
      } else {
        if (!s.reg) regStart(s, '');
        console.log(`[follow] ${sessionId.slice(0, 8)} -> registration prompt`);
        await sendAnswer(s, ev, pushTarget, regWelcome(s), { system: true });
      }
    } else {
      await sendAnswer(s, ev, pushTarget, 'ยินดีต้อนรับกลับมาค่ะ 🙏 น้องลัดดาพร้อมตอบเรื่องสินค้า โรค แมลง วัชพืช ได้เลยนะคะ 🌾', { system: true });
    }
    return;
  }
  if (ev.type !== 'message' || !ev.message) return;

  let text = null;
  if (ev.message.type === 'text') text = ev.message.text;
  else if (ev.message.type === 'sticker') text = '(ผู้ใช้ส่งสติกเกอร์มา ทักทายกลับสั้นๆ อย่างเป็นมิตร)';
  else return;

  const shown = ev.message.type === 'text' ? text : '(สติกเกอร์)';
  const s = touchSession(sessionId, stype, shown);
  const isNewChat = s.history.length === 0 && !s.bf;
  pushHist(s, 'u', shown);
  fetchProfile(s, userId);
  // ลูกค้าทิ้งเบอร์ -> ธงรอติดต่อกลับ + เก็บเบอร์ (ยกเว้นตอนกำลังตอบแบบฟอร์มลงทะเบียน — เบอร์นั้นไม่ใช่การขอให้โทรกลับ)
  const inReg = stype === 'user' && REG_MODE === 'on' && (!!s.reg || regNeeded(crmGet(sessionId)));
  if (ev.message.type === 'text' && !inReg) detectPhone(sessionId, s, text);
  if (stype === 'user') crmTouch(sessionId, s, ev.message.type === 'text' ? text : ''); // CRM: อัปเดตโปรไฟล์อัตโนมัติ
  // ลูกค้าเก่าทักครั้งแรกหลังระบบใหม่ -> ดึงประวัติเดิมจาก Dify ตามมาให้เอง
  if (isNewChat) setTimeout(() => backfillFromDify(sessionId, s).catch(() => {}), 50);

  const now = Date.now();

  if (s.mutedUntil && s.mutedUntil <= now) { s.mutedUntil = 0; s.handoff = false; markDirty(); broadcast(); }

  if (ev.message.type === 'text') {
    if (wantsBot(text)) {
      s.mutedUntil = 0;
      s.handoff = false;
      if (s.cb && s.cb.src === 'kw') clearCallback(s); // ลูกค้ากลับมาคุยกับบอทเอง = ไม่รอแอดมินแล้ว
      console.log(`[unmute-kw] ${sessionId.slice(0, 8)}`);
      await sendAnswer(s, ev, pushTarget, 'น้องลัดดากลับมาแล้วค่ะ 😊 สอบถามเรื่องสินค้าได้เลยนะคะ');
      return;
    }
    if (wantsAdmin(text)) {
      s.mutedUntil = now + MUTE_MINUTES * 60000;
      s.handoff = true;
      flagCallback(sessionId, s, 'kw', { note: 'ลูกค้าพิมพ์ขอคุยกับแอดมิน', topic: text });
      console.log(`[mute-kw] ${sessionId.slice(0, 8)} for ${MUTE_MINUTES}m (handoff)`);
      await sendAnswer(s, ev, pushTarget,
        `รับทราบค่ะ เดี๋ยวแอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ 🙏\n\n(น้องลัดดาขอพักการตอบแชทนี้ ${MUTE_MINUTES} นาที ถ้าต้องการคุยกับน้องลัดดาต่อ พิมพ์ "คุยกับบอท" ได้เลยค่ะ)`);
      return;
    }
  }

  if (s.mutedUntil > now) {
    console.log(`[muted] ${sessionId.slice(0, 8)} skip: ${String(text).slice(0, 40)}`);
    return;
  }

  // ลงทะเบียนก่อนใช้งาน (REGISTER=on): ยังไม่ลงทะเบียน -> ถาม ชื่อ/เบอร์/จังหวัด ก่อน แล้วค่อยตอบคำถามที่ค้างไว้
  // + คำสั่ง "ลงทะเบียน" (ทุกโหมด) และ "แก้ไขข้อมูล" (อัปเดตข้อมูลที่ลงทะเบียนไว้)
  if (stype === 'user') {
    const c = crmGet(sessionId);
    const liffOn = REG_UI === 'liff' && !!LIFF_URL;
    let cmd = ev.message.type === 'text' ? regCmd(text) : '';
    // ลูกค้ากด "ลงทะเบียนเรียบร้อยแล้ว ✅" จากหน้า LIFF (liff.sendMessages) -> ตอบยืนยัน + ตอบคำถามที่ค้างไว้ (ใช้ Reply ไม่กินโควต้า)
    if (ev.message.type === 'text' && /^ลงทะเบียนเรียบร้อยแล้ว/.test(text.trim()) && regDone(c)) {
      c.auto = c.auto || {};
      const msgs = [(c.auto.reg && c.auto.reg.msg) || `✅ ลงทะเบียนเรียบร้อยค่ะ ขอบคุณค่ะ 🙏 (${regSummaryText(c)})\n\nสอบถามเรื่องสินค้า โรค แมลง วัชพืช ได้เลยนะคะ 🌾`];
      if (s.regPending) { const ans = await askDify(sessionId, s.regPending); if (ans) msgs.push(ans.slice(0, 4900)); s.regPending = ''; }
      if (c.auto.reg) c.auto.reg.confirmed = true;
      markDirty();
      await sendAnswer(s, ev, pushTarget, msgs, { system: 1 });
      return;
    }
    // "ลงทะเบียนผ่านแชท" = ขอกรอกในแชทแทนฟอร์ม (สำรองเมื่อเปิด LIFF ไม่ได้)
    if (ev.message.type === 'text' && /^(ขอ)?(ลงทะเบียน|สมัคร)(ผ่าน|ใน|ทาง)แชท/.test(text.trim())) {
      if (regDone(c)) cmd = 'edit';
      else { regStart(s, ''); c.auto = c.auto || {}; c.auto.reg_asked = true; console.log(`[reg] ${sessionId.slice(0, 8)} chat fallback`); await sendAnswer(s, ev, pushTarget, regWelcome(s), { system: true }); return; }
    }
    if (cmd === 'register' && regDone(c)) {
      if (liffOn) { await sendAnswer(s, ev, pushTarget, [`คุณลูกค้าลงทะเบียนไว้แล้วค่ะ 🙏 (${regSummaryText(c)})`].concat(liffButtonMsg('edit')), { system: true }); return; }
      await sendAnswer(s, ev, pushTarget, `คุณลูกค้าลงทะเบียนไว้แล้วค่ะ 🙏 (${regSummaryText(c)})\nถ้าต้องการแก้ไข พิมพ์ว่า "แก้ไขข้อมูล" ได้เลยค่ะ`, { system: true });
      return;
    }
    if (cmd === 'register' && s.reg) { await sendAnswer(s, ev, pushTarget, 'กำลังลงทะเบียนอยู่ค่ะ 😊\n' + regPrompt(s.reg.step, s), { system: true }); return; }
    if ((cmd === 'edit' || cmd === 'register') && liffOn && !s.reg) {
      c.auto = c.auto || {}; c.auto.reg_asked = true;
      console.log(`[reg] ${sessionId.slice(0, 8)} ${cmd} -> LIFF button`);
      await sendAnswer(s, ev, pushTarget, liffButtonMsg(cmd === 'edit' ? 'edit' : 'gate', { summary: regSummaryText(c) }), { system: true });
      return;
    }
    if (cmd === 'edit' || cmd === 'register') {
      const upd = cmd === 'edit' && regDone(c);
      regStart(s, '', { update: upd });
      c.auto = c.auto || {}; c.auto.reg_asked = true;
      console.log(`[reg] ${sessionId.slice(0, 8)} ${upd ? 'update' : 'start'} by keyword`);
      await sendAnswer(s, ev, pushTarget, regWelcome(s, c), { system: true });
      return;
    }
    if (s.reg || regNeeded(c)) {
      const isText = ev.message.type === 'text';
      const forced = REG_MODE === 'on' && !(s.reg && s.reg.update); // โหมดบังคับ (ยกเว้นตอนแก้ไขข้อมูล = ไม่บังคับ)
      if (!s.reg && liffOn) {
        // โหมด LIFF: ส่งปุ่มเปิดฟอร์ม (จำคำถามแรกไว้ ตอบให้หลังลงทะเบียน) — ส่งซ้ำไม่เกินทุก 2 นาทีเพื่อไม่รบกวน
        const t = isText ? String(text).trim() : '';
        if (t && t.length >= 6 && !REG_GREET_RX.test(t) && REG_QUESTION_RX.test(t)) s.regPending = t.slice(0, 500);
        c.auto = c.auto || {}; c.auto.reg_asked = true;
        const recent = s.regGateAt && Date.now() - s.regGateAt < 120000;
        s.regGateAt = Date.now();
        markDirty();
        console.log(`[reg] ${sessionId.slice(0, 8)} gate -> LIFF button (pending=${s.regPending ? 'yes' : 'no'})`);
        await sendAnswer(s, ev, pushTarget, recent ? liffButtonMsg('again') : liffButtonMsg('gate', { pending: s.regPending }), { system: true });
        return;
      }
      if (!s.reg) {
        regStart(s, isText ? text : '');
        console.log(`[reg] ${sessionId.slice(0, 8)} start (pending=${s.reg.pending ? 'yes' : 'no'})`);
        await sendAnswer(s, ev, pushTarget, regWelcome(s), { system: true });
        return;
      }
      if (!isText) { if (forced) { await sendAnswer(s, ev, pushTarget, regPrompt(s.reg.step, s), { system: true }); return; } }
      else {
        const h = regHandle(sessionId, s, c, text);
        if (!h.done) {
          if (forced || !h.invalid) { await sendAnswer(s, ev, pushTarget, h.replies, { system: true }); return; }
          s.reg = null; markDirty(); // ไม่บังคับ: ลูกค้าไม่ตอบคำถามลงทะเบียน -> เลิกถาม ตอบคำถามปกติ (ระบบยังเก็บเบอร์/จังหวัดจากแชทให้เอง)
        } else {
          const fin = await regFinish(sessionId, s, c);
          const msgs = [fin.doneMsg];
          if (fin.pending) {
            const ans = await askDify(sessionId, fin.pending);
            if (ans) msgs.push(ans.slice(0, 4900));
          }
          await sendAnswer(s, ev, pushTarget, msgs, { system: 1 }); // ข้อความแรก = ระบบ, ข้อความถัดไป = คำตอบ Dify
          return;
        }
      }
    }
  }

  console.log(`[msg] ${sessionId.slice(0, 8)}...: ${text.slice(0, 60)}`);

  let answer = await askDify(sessionId, text);
  if (!answer) answer = 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้งนะคะ 🙏';
  const msgs = [answer.slice(0, 4900)];
  // REGISTER=soft: ทักครั้งแรก -> ตอบคำถามก่อน แล้วขอข้อมูลต่อท้าย 1 ครั้ง (ไม่บังคับ; ถ้าลูกค้าตอบชื่อมา wizard จะเดินต่อ)
  if (stype === 'user' && REG_MODE === 'soft') {
    const c = crmGet(sessionId);
    c.auto = c.auto || {};
    if (!regDone(c) && !s.reg && !c.auto.reg_asked) {
      c.auto.reg_asked = true;
      if (REG_UI === 'liff' && LIFF_URL) { msgs.push(...liffButtonMsg('invite')); }
      else { regStart(s, ''); msgs.push('📝 ถ้าสะดวก น้องลัดดาขอข้อมูลสั้นๆ เพื่อให้ทีมงานในพื้นที่ดูแลได้ตรงจุดนะคะ\n' + regPrompt('name', s)); }
      markDirty();
    }
  }
  await sendAnswer(s, ev, pushTarget, msgs);
}

// ---------- หน้าแอดมิน (ดีไซน์แบบ LINE OA Manager) ----------
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>น้องลัดดา — ควบคุมบอท</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #e9ebee; color: #1f2329; }
  button { font-family: inherit; cursor: pointer; border: 0; }

  .login-wrap { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .login-card { background: #fff; border-radius: 14px; padding: 28px 24px; width: 100%; max-width: 380px; box-shadow: 0 6px 24px rgba(0,0,0,.08); text-align: center; }
  .login-card .logo { font-size: 40px; margin-bottom: 8px; }
  .login-card h1 { font-size: 17px; margin-bottom: 2px; }
  .login-card .sub { color: #8a95a1; font-size: 12.5px; margin-bottom: 18px; }
  .login-card input { width: 100%; padding: 12px 14px; border: 1px solid #d8dde3; border-radius: 10px; font-size: 15px; background: #fff; color: #1f2329; }
  .login-card .go { width: 100%; margin-top: 12px; padding: 12px; border-radius: 10px; background: #06c755; color: #fff; font-size: 15px; font-weight: 600; }
  #err { color: #e5484d; font-size: 13px; margin-top: 10px; display: none; }

  .app { display: none; height: 100dvh; max-width: 1280px; margin: 0 auto; background: #fff; box-shadow: 0 0 24px rgba(0,0,0,.06); }
  .app.on { display: flex; }

  .side { width: 340px; flex: none; border-right: 1px solid #e3e6ea; display: flex; flex-direction: column; background: #fff; }
  .side-head { padding: 13px 16px; border-bottom: 1px solid #e3e6ea; display: flex; align-items: center; justify-content: space-between; }
  .side-head b { font-size: 16px; }
  .cnt { display: inline-block; background: #06c755; color: #fff; font-size: 11px; border-radius: 99px; padding: 1px 7px; margin-left: 6px; vertical-align: 2px; }
  .live { font-size: 10.5px; color: #0a9a4a; margin-left: 8px; }
  .live.off { color: #d33a41; }
  .rf { background: #f1f3f5; color: #55606b; border-radius: 8px; padding: 6px 10px; font-size: 14px; }
  .items { flex: 1; overflow-y: auto; }
  .item { display: flex; gap: 10px; padding: 11px 14px; cursor: pointer; border-bottom: 1px solid #f4f5f7; align-items: center; }
  .item:hover { background: #f7f9fb; }
  .item.sel { background: #eef4fb; }
  .item.ho { background: #fff6e8; }
  .item.ho.sel { background: #ffefd6; }
  .item.cb { background: #fdeeee; }
  .item.cb.sel { background: #fadcdc; }
  .ilast.cbtxt { color: #c62828; font-weight: 600; }
  .cnt.red { background: #d33a41; }
  .cbbar { display: none; padding: 9px 16px; background: #fdeeee; border-bottom: 1px solid #f5c6c6; font-size: 12.5px; color: #8a1f24; line-height: 1.6; }
  .cbbar.on { display: block; }
  .cbbar b { color: #c62828; }
  .cbbtn { border-radius: 9px; padding: 9px 12px; font-size: 12.5px; font-weight: 700; flex: none; margin-right: 6px; }
  .cbbtn.done { background: #c62828; color: #fff; }
  .cbbtn.set { background: #f1f3f5; color: #55606b; }
  .srch { padding: 8px 12px; border-bottom: 1px solid #eef0f2; }
  .srch input { width: 100%; padding: 8px 12px; border: 1px solid #e3e6ea; border-radius: 10px; font-size: 13px; background: #f7f9fb; color: #1f2329; outline: none; }
  .srch input:focus { border-color: #06c755; background: #fff; }
  .itag { display: inline-block; font-size: 10px; border-radius: 6px; padding: 0 5px; margin-left: 4px; background: #eef4fb; color: #3b6db3; vertical-align: 1px; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .itag.st-customer { background: #e6f9ee; color: #0a9a4a; }
  .itag.st-quoted { background: #fff1dd; color: #d97706; }
  .itag.st-interested { background: #eef4fb; color: #3b6db3; }
  .itag.st-inactive { background: #f1f3f5; color: #98a2ad; }
  .crmbtn { border-radius: 9px; padding: 9px 12px; font-size: 12.5px; font-weight: 700; flex: none; margin-right: 6px; background: #eef4fb; color: #2f5fa3; }
  .crmbtn.on { background: #2f5fa3; color: #fff; }
  .body { flex: 1; min-height: 0; display: flex; }
  .msgs { flex: 1; overflow-y: auto; padding: 18px 18px 24px; background: #fff; }
  .crm { width: 330px; flex: none; border-left: 1px solid #e3e6ea; overflow-y: auto; background: #fbfcfd; display: none; padding: 12px 14px 20px; font-size: 12.5px; }
  .crm.on { display: block; }
  .crm h4 { font-size: 12px; color: #55606b; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: .3px; }
  .crm h4:first-child { margin-top: 0; }
  .crm label { display: block; font-size: 11px; color: #8a95a1; margin: 7px 0 2px; }
  .crm input, .crm select, .crm textarea { width: 100%; padding: 7px 9px; border: 1px solid #dfe3e8; border-radius: 8px; font-size: 13px; font-family: inherit; background: #fff; color: #1f2329; outline: none; }
  .crm input:focus, .crm select:focus, .crm textarea:focus { border-color: #06c755; }
  .crm textarea { resize: vertical; min-height: 56px; }
  .crm .row2 { display: flex; gap: 8px; }
  .crm .row2 > div { flex: 1; min-width: 0; }
  .crm .auto { background: #fff; border: 1px dashed #dfe3e8; border-radius: 8px; padding: 8px 10px; color: #55606b; line-height: 1.7; }
  .crm .auto b { color: #1f2329; }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
  .tag { background: #eef4fb; color: #2f5fa3; border-radius: 99px; padding: 2px 8px; font-size: 11.5px; cursor: pointer; border: 1px solid transparent; }
  .tag.on { background: #2f5fa3; color: #fff; }
  .tag.x::after { content: ' ✕'; opacity: .6; }
  .crm .savebtn { width: 100%; margin-top: 10px; padding: 9px; border-radius: 9px; background: #06c755; color: #fff; font-weight: 700; font-size: 13.5px; }
  .crm .savebtn:disabled { opacity: .5; }
  .crm .saved { font-size: 11px; color: #0a9a4a; margin-top: 4px; min-height: 14px; }
  .notes { margin-top: 6px; }
  .note { background: #fff; border: 1px solid #eef0f2; border-radius: 8px; padding: 6px 9px; margin-bottom: 6px; }
  .note .nt { font-size: 10.5px; color: #98a2ad; margin-bottom: 2px; }
  .noteadd { display: flex; gap: 6px; margin-top: 6px; }
  .noteadd input { flex: 1; }
  .noteadd button { border-radius: 8px; padding: 0 12px; background: #2f5fa3; color: #fff; font-weight: 700; }
  .exp { font-size: 11px; color: #3b6db3; cursor: pointer; text-decoration: underline; }
  .itag.pos { background: #e6f9ee; color: #0a9a4a; }
  .itag.posc { background: #fff1dd; color: #d97706; }
  .pill.pos { background: #e6f9ee; color: #0a9a4a; }
  .cand { background: #fff; border: 1px solid #eef0f2; border-radius: 8px; padding: 6px 9px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
  .cand.ok { border-color: #bfe8cd; background: #f3fcf6; }
  .cand .ci { flex: 1; min-width: 0; line-height: 1.5; }
  .cand .ci small { color: #8a95a1; font-size: 10.5px; }
  .okc { color: #0a9a4a; font-size: 10.5px; font-weight: 700; }
  .lnk { border-radius: 8px; padding: 6px 11px; background: #2f5fa3; color: #fff; font-weight: 700; font-size: 12px; flex: none; }
  .lnk.dis { background: #cfd8e3; }
  .unl { font-size: 11px; color: #d33a41; cursor: pointer; text-decoration: underline; margin-left: 6px; }
  .posbox { background: #e6f9ee; border: 1px solid #bfe8cd; border-radius: 8px; padding: 8px 10px; line-height: 1.7; }
  .posbox b { color: #0a6b34; }
  .av { width: 46px; height: 46px; border-radius: 50%; flex: none; background: #cfd8e3; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 19px; font-weight: 600; position: relative; overflow: visible; }
  .av img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
  .stdot { position: absolute; right: -3px; bottom: -3px; font-size: 14px; line-height: 1; filter: drop-shadow(0 0 1px #fff); }
  .icol { flex: 1; min-width: 0; }
  .irow1 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .iname { font-weight: 600; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .itime { font-size: 11px; color: #98a2ad; flex: none; }
  .ilast { font-size: 12.5px; color: #8a95a1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
  .ilast.hotxt { color: #d97706; font-weight: 600; }
  .side-note { padding: 9px 14px; border-top: 1px solid #eef0f2; font-size: 11px; color: #98a2ad; line-height: 1.7; }
  .empty { text-align: center; color: #98a2ad; padding: 40px 16px; font-size: 13.5px; line-height: 1.8; }

  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: #fff; }
  .chat-head { padding: 9px 16px; border-bottom: 1px solid #e3e6ea; display: none; align-items: center; gap: 11px; background: #fff; }
  .chat-head.on { display: flex; }
  .backbtn { display: none; background: none; font-size: 24px; color: #55606b; padding: 0 6px 2px 0; }
  .av.s { width: 38px; height: 38px; font-size: 16px; }
  .hinfo { flex: 1; min-width: 0; }
  .hname { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hstat { font-size: 11.5px; margin-top: 2px; display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { border-radius: 99px; padding: 1.5px 9px; font-size: 11px; font-weight: 600; }
  .pill.g { background: #e6f9ee; color: #0a9a4a; }
  .pill.r { background: #fdebec; color: #d33a41; }
  .pill.o { background: #fff1dd; color: #d97706; }
  .pill.cb { background: #fdebec; color: #c62828; }
  .tgl { border-radius: 9px; padding: 9px 14px; font-size: 13px; font-weight: 700; flex: none; }
  .tgl.stop { background: #fdebec; color: #d33a41; }
  .tgl.start { background: #06c755; color: #fff; }
  .msgs { flex: 1; overflow-y: auto; padding: 18px 18px 24px; background: #fff; }
  .day { text-align: center; margin: 6px 0 14px; }
  .day span { background: #eef0f3; color: #8a95a1; font-size: 11px; border-radius: 99px; padding: 3px 12px; }
  .mrow { display: flex; margin-bottom: 13px; gap: 8px; align-items: flex-end; }
  .mrow.user { justify-content: flex-start; }
  .mrow.bot { justify-content: flex-end; }
  .mav { width: 30px; height: 30px; border-radius: 50%; background: #cfd8e3; color: #fff; flex: none; display: flex; align-items: center; justify-content: center; font-size: 13px; overflow: hidden; }
  .mav img { width: 100%; height: 100%; object-fit: cover; }
  .bub { max-width: 62%; padding: 9px 13px; border-radius: 15px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .user .bub { background: #f1f2f4; border-top-left-radius: 4px; }
  .bot .bub { background: #cce4ff; border-top-right-radius: 4px; }
  .mtime { font-size: 10.5px; color: #98a2ad; flex: none; padding-bottom: 2px; }
  .bot .bub.ab { background: #d4f5dd; }
  .chat-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #b3bcc5; gap: 10px; }
  .chat-empty .big { font-size: 44px; }
  .composer { display: none; gap: 8px; padding: 10px 14px; border-top: 1px solid #e3e6ea; background: #fff; align-items: flex-end; }
  .composer.on { display: flex; }
  .composer textarea { flex: 1; resize: none; border: 1px solid #d8dde3; border-radius: 18px; padding: 9px 14px; font-size: 14px; font-family: inherit; line-height: 1.45; max-height: 110px; background: #fff; color: #1f2329; outline: none; }
  .composer textarea:focus { border-color: #06c755; }
  .sendbtn { background: #06c755; color: #fff; border-radius: 50%; width: 40px; height: 40px; font-size: 17px; flex: none; }
  .sendbtn:disabled { opacity: .45; cursor: default; }

  @media (max-width: 760px) {
    .app.on { display: block; }
    .side { width: 100%; height: 100dvh; }
    .main { position: fixed; inset: 0; background: #fff; transform: translateX(102%); transition: transform .18s ease; z-index: 5; }
    .main.show { transform: none; }
    .backbtn { display: block; }
    .bub { max-width: 78%; }
    .crm { position: absolute; inset: 0; width: 100%; z-index: 6; }
  }
</style>
</head>
<body>

<div id="login" class="login-wrap">
  <div class="login-card">
    <div class="logo">🤖</div>
    <h1>น้องลัดดา — ควบคุมบอทรายแชท</h1>
    <div class="sub">ใส่รหัสแอดมิน (ADMIN_KEY) เพื่อเข้าใช้งาน</div>
    <input id="key" type="password" placeholder="รหัสแอดมิน" autocomplete="current-password">
    <button class="go" id="loginbtn">เข้าสู่ระบบ</button>
    <div id="err"></div>
  </div>
</div>

<div id="app" class="app">
  <div class="side">
    <div class="side-head">
      <b>แชท<span class="cnt" id="count">0</span><span class="cnt red" id="cbcount" style="display:none" title="ลูกค้ารอติดต่อกลับ">📞 0</span><span class="live off" id="live">● กำลังเชื่อมต่อ…</span></b>
      <button class="rf" id="refreshbtn">⟳</button>
    </div>
    <div class="srch"><input id="q" type="search" placeholder="🔍 ค้นหา ชื่อ / เบอร์ / แท็ก / จังหวัด / พืช"></div>
    <div class="items" id="items"></div>
    <div class="side-note"><span id="ps"></span><span id="sb"></span><span id="posst"></span><span class="exp" id="expbtn">⬇ ส่งออก CRM เป็น CSV/Excel</span> · 📞 แดง = ลูกค้ารอติดต่อกลับ (บอทรับปากว่าจะให้เจ้าหน้าที่ติดต่อ / ลูกค้าทิ้งเบอร์) กด "✓ ติดต่อแล้ว" เมื่อจัดการเสร็จ · 🙋 ส้ม = ลูกค้าขอแอดมิน · 🔇 = บอทหยุดอยู่ · ลูกค้าพิมพ์ "คุยกับแอดมิน" บอทหยุด <span id="mm"></span> นาที / "คุยกับบอท" บอทกลับมา · พิมพ์ตอบจากหน้านี้ = ส่งในนามน้องลัดดา (ใช้โควต้า Push ของ LINE OA)<span id="nt"></span></div>
  </div>
  <div class="main" id="main">
    <div class="chat-head" id="chead">
      <button class="backbtn" id="backbtn">‹</button>
      <div class="av s" id="hav">👤</div>
      <div class="hinfo">
        <div class="hname" id="hname"></div>
        <div class="hstat" id="hstat"></div>
      </div>
      <button class="crmbtn" id="crmbtn">👤 โปรไฟล์</button>
      <button class="cbbtn set" id="cbbtn"></button>
      <button class="tgl stop" id="tglbtn"></button>
    </div>
    <div class="cbbar" id="cbbar"></div>
    <div class="body">
      <div class="msgs" id="msgs">
        <div class="chat-empty"><div class="big">💬</div><div>เลือกแชทจากรายการด้านซ้าย<br>เพื่อดูบทสนทนาและควบคุมบอท</div></div>
      </div>
      <div class="crm" id="crm"></div>
    </div>
    <div class="composer" id="composer">
      <textarea id="ta" rows="1" placeholder="พิมพ์ตอบลูกค้าในนามน้องลัดดา… (Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่)"></textarea>
      <button class="sendbtn" id="sendbtn" title="ส่ง">➤</button>
    </div>
  </div>
</div>

<script>
var KEY = sessionStorage.getItem('nladda_key') || '';
var timer = null;
var sel = null;
var cache = [];
var es = null;
var esRetry = null;
var q = '';
var crmOpen = false;
var crmData = null;
var crmTags = [];
var posOn = false;
var unreg = 0;
var PRESET_TAGS = ['ลูกค้าใหม่', 'ลูกค้าประจำ', 'ตัวแทนจำหน่าย', 'เกษตรกร', 'สนใจสินค้า', 'รอตัดสินใจ', 'ซื้อแล้ว', 'ห้ามรบกวน'];
var STATUS_TH = { new: 'ใหม่', interested: 'สนใจ', quoted: 'เสนอราคาแล้ว', customer: 'ซื้อแล้ว', inactive: 'เงียบ/ไม่สนใจ' };
var COLORS = ['#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1'];

function esc(s) { return String(s || '').replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

function colorOf(id) {
  var n = 0;
  for (var i = 0; i < id.length; i++) n = (n + id.charCodeAt(i)) % COLORS.length;
  return COLORS[n];
}

function hhmm(t) { return new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }).replace(':', '.') + ' น.'; }

function listTime(t) {
  if (!t) return '';
  var d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm(t);
  var y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'เมื่อวาน';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

function dayLabel(t) {
  var d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'วันนี้';
  var y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'เมื่อวาน';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

function avatarHtml(s, cls) {
  var inner;
  if (s.type === 'group') inner = '👥';
  else if (s.pic) inner = '<img src="' + esc(s.pic) + '" alt="">';
  else {
    var ch = (s.name && s.name !== '…') ? s.name.trim().charAt(0) : '👤';
    inner = esc(ch);
  }
  var bg = (s.pic || s.type === 'group') ? '' : ' style="background:' + colorOf(s.id) + '"';
  return '<div class="av ' + (cls || '') + '"' + bg + '>' + inner + '</div>';
}

function dispName(s) { return (s.name && s.name !== '…') ? s.name : (s.id.slice(0, 10) + '…'); }

function login() {
  KEY = document.getElementById('key').value.trim();
  load(true);
}

function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'x-admin-key': KEY, 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(path, opts).then(function(r) {
    if (r.status === 401) throw new Error('รหัสไม่ถูกต้อง');
    if (r.status === 503) throw new Error('ยังไม่ได้ตั้งค่า ADMIN_KEY ใน Railway');
    if (!r.ok) throw new Error('ผิดพลาด (' + r.status + ')');
    return r.json();
  });
}

function setLive(on) {
  var el = document.getElementById('live');
  if (on) { el.className = 'live'; el.textContent = '● เรียลไทม์'; }
  else { el.className = 'live off'; el.textContent = '● กำลังเชื่อมต่อ…'; }
}

function connectStream() {
  if (es) return;
  api('/admin/api/token', { method: 'POST' }).then(function(d) {
    if (es) return;
    es = new EventSource('/admin/api/stream?t=' + encodeURIComponent(d.token));
    es.onopen = function() { setLive(true); };
    es.onmessage = function() { load(); };
    es.onerror = function() {
      setLive(false);
      try { es.close(); } catch (e) {}
      es = null;
      if (!esRetry) esRetry = setTimeout(function() { esRetry = null; connectStream(); }, 5000);
    };
  }).catch(function() {
    if (!esRetry) esRetry = setTimeout(function() { esRetry = null; connectStream(); }, 8000);
  });
}

function load(fromLogin) {
  if (!KEY) return;
  api('/admin/api/list').then(function(d) {
    sessionStorage.setItem('nladda_key', KEY);
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').classList.add('on');
    document.getElementById('mm').textContent = d.muteMinutes;
    document.getElementById('ps').innerHTML = d.persist
      ? '💾 เก็บแชทถาวร: <b style="color:#0a9a4a">เปิด</b> · '
      : '💾 เก็บแชทถาวร: <b style="color:#d33a41">ปิด</b> (ต่อ Volume ที่ /data ใน Railway) · ';
    document.getElementById('nt').textContent = d.notify ? ' · 🔔 แจ้งเตือนเข้า LINE แอดมิน ' + d.notify + ' คน' : ' · 🔔 แจ้งเตือน LINE แอดมิน: ปิด (ตั้ง ADMIN_NOTIFY_IDS ใน Railway)';
    document.getElementById('sb').innerHTML = d.sb
      ? '🗄️ CRM: <b style="color:#0a9a4a">Supabase</b> · '
      : '🗄️ CRM: <b style="color:#d97706">เก็บในเครื่อง</b> (ตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY เพื่อซิงก์) · ';
    var p = d.pos || {};
    posOn = !!p.on;
    document.getElementById('posst').innerHTML = !p.on
      ? '🔗 POS: <b style="color:#98a2ad">ปิด</b> (ตั้ง POS_TABLE) · '
      : (p.error
        ? '🔗 POS: <b style="color:#d33a41">ผิดพลาด</b> <span title="' + esc(p.error) + '">' + esc(String(p.error).slice(0, 60)) + '</span> · '
        : '🔗 POS: <b style="color:#0a9a4a">' + (p.rows || 0).toLocaleString('th-TH') + ' รายชื่อ</b>' + (p.loadedAt ? ' (อัปเดต ' + hhmm(p.loadedAt) + ')' : ' (กำลังโหลด…)') + (p.writeback ? ' · เขียน LINE ID กลับ POS: เปิด' : '') + ' · ');
    unreg = d.unregistered || 0;
    document.getElementById('posst').innerHTML += '📝 ลงทะเบียนลูกค้าใหม่: <b style="color:' + (d.reg === 'on' ? '#0a9a4a' : (d.reg === 'soft' ? '#d97706' : '#98a2ad')) + '">' + (d.reg === 'on' ? 'บังคับ' : (d.reg === 'soft' ? 'ถามแต่ไม่บังคับ' : 'ปิด')) + '</b>' + (d.regUi === 'liff' ? ' <span title="' + esc(d.liffUrl || '') + '">(ฟอร์ม LIFF)</span>' : ' (ถามในแชท)')
      + (unreg ? ' · <span class="exp" id="invbtn" title="ส่งข้อความเชิญลงทะเบียน (Push) ถึงลูกค้าเก่าทุกคนที่ยังไม่ลงทะเบียน">📣 เชิญลูกค้าเก่าที่ยังไม่ลงทะเบียน (' + unreg + ')</span>' : ' · ลงทะเบียนครบทุกแชทแล้ว') + ' · ';
    cache = d.sessions;
    var pend = d.pending || 0;
    var cbEl = document.getElementById('cbcount');
    cbEl.style.display = pend ? 'inline-block' : 'none';
    cbEl.textContent = '📞 ' + pend;
    document.title = (pend ? '(' + pend + ') ' : '') + 'น้องลัดดา — ควบคุมบอท';
    renderList();
    if (sel) { renderHead(); fetchHist(sel); }
    if (!timer) timer = setInterval(load, 20000);
    connectStream();
  }).catch(function(e) {
    if (fromLogin) { var el = document.getElementById('err'); el.style.display = 'block'; el.textContent = e.message; }
    sessionStorage.removeItem('nladda_key');
  });
}

function findSel() {
  for (var i = 0; i < cache.length; i++) if (cache[i].id === sel) return cache[i];
  return null;
}

function matchQ(s) {
  if (!q) return true;
  var c = s.crm || {};
  var hay = [s.name, s.id, s.lastText, c.real_name, c.phone, c.province, c.crops, (c.tags || []).join(' '), STATUS_TH[c.status] || '', s.cb && s.cb.contact, c.pos ? 'pos ' + c.pos : '', c.posc ? 'รอยืนยัน pos' : ''].join(' ').toLowerCase();
  return hay.indexOf(q) !== -1;
}

function crmBadge(s) {
  var c = s.crm;
  if (!c) return '';
  var h = '';
  if (s.reg && s.reg.indexOf('asking:') === 0) h += '<span class="itag posc" title="บอทกำลังถามข้อมูลลงทะเบียน">📝 กำลังลงทะเบียน</span>';
  if (c.pos) h += '<span class="itag pos" title="ผูกกับ POS: ' + esc(c.pos) + '">🔗POS</span>';
  else if (c.posc) h += '<span class="itag posc" title="มีรายชื่อ POS ที่น่าจะใช่ รอแอดมินยืนยัน">🔗?</span>';
  if (c.status && c.status !== 'new') h += '<span class="itag st-' + c.status + '">' + esc(STATUS_TH[c.status] || c.status) + '</span>';
  var tg = (c.tags || []).filter(function(t) { return t !== 'ลูกค้า POS'; }); // แท็ก POS แสดงเป็น 🔗POS แล้ว
  if (tg.length) h += '<span class="itag">' + esc(tg[0]) + (tg.length > 1 ? ' +' + (tg.length - 1) : '') + '</span>';
  return h;
}

function renderList() {
  var now = Date.now();
  document.getElementById('count').textContent = cache.length;
  if (!cache.length) {
    document.getElementById('items').innerHTML = '<div class="empty">ยังไม่มีแชทเข้ามา<br>เมื่อลูกค้าทักไลน์จะเด้งขึ้นที่นี่เอง</div>';
    return;
  }
  var h = '';
  var shown = 0;
  for (var i = 0; i < cache.length; i++) {
    var s = cache[i];
    if (!matchQ(s)) continue;
    shown++;
    var muted = s.mutedUntil > now;
    var isHo = muted && s.handoff;
    var isCb = !!s.cb;
    var dot = isCb ? '<span class="stdot">📞</span>' : (muted ? '<span class="stdot">' + (isHo ? '🙋' : '🔇') + '</span>' : '');
    var av = avatarHtml(s, '').replace('</div>', dot + '</div>');
    var last = isCb
      ? '📞 รอติดต่อกลับ · ' + esc(s.cb.contact || s.cb.topic || s.lastText || '-')
      : (isHo ? '🙋 ขอคุยกับแอดมิน · ' : '') + esc(s.lastText || '-');
    h += '<div class="item' + (s.id === sel ? ' sel' : '') + (isCb ? ' cb' : (isHo ? ' ho' : '')) + '" data-id="' + s.id + '">'
      + av
      + '<div class="icol">'
      + '<div class="irow1"><span class="iname">' + esc((s.crm && s.crm.real_name) || dispName(s)) + crmBadge(s) + '</span><span class="itime">' + listTime(isCb ? s.cb.at : s.lastAt) + '</span></div>'
      + '<div class="ilast' + (isCb ? ' cbtxt' : (isHo ? ' hotxt' : '')) + '">' + last + '</div>'
      + '</div></div>';
  }
  if (!shown) h = '<div class="empty">ไม่พบแชทที่ตรงกับ "' + esc(q) + '"</div>';
  document.getElementById('items').innerHTML = h;
}

// ---------- CRM panel ----------
function crmField(label, id, val, ph) {
  return '<label>' + label + '</label><input id="' + id + '" value="' + esc(val == null ? '' : val) + '" placeholder="' + esc(ph || '') + '">';
}

function renderTags() {
  var el = document.getElementById('cf_tags');
  if (!el) return;
  var h = '';
  var i;
  for (i = 0; i < PRESET_TAGS.length; i++) {
    var on = crmTags.indexOf(PRESET_TAGS[i]) !== -1;
    h += '<span class="tag' + (on ? ' on' : '') + '" data-tag="' + esc(PRESET_TAGS[i]) + '">' + esc(PRESET_TAGS[i]) + '</span>';
  }
  for (i = 0; i < crmTags.length; i++) {
    if (PRESET_TAGS.indexOf(crmTags[i]) === -1) h += '<span class="tag on x" data-tag="' + esc(crmTags[i]) + '">' + esc(crmTags[i]) + '</span>';
  }
  el.innerHTML = h;
}

function renderNotes(notes) {
  var el = document.getElementById('cf_notes');
  if (!el) return;
  if (!notes || !notes.length) { el.innerHTML = '<div class="nt" style="color:#98a2ad;font-size:11px">ยังไม่มีบันทึก</div>'; return; }
  var h = '';
  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    h += '<div class="note"><div class="nt">' + dayLabel(Date.parse(n.created_at)) + ' ' + hhmm(Date.parse(n.created_at)) + '</div>' + esc(n.text) + '</div>';
  }
  el.innerHTML = h;
}

function renderCrm(d) {
  var p = d.profile;
  crmData = d;
  crmTags = (p.tags || []).slice();
  var a = p.auto || {};
  var s = findSel() || {};
  var statusOpts = '';
  var keys = ['new', 'interested', 'quoted', 'customer', 'inactive'];
  for (var i = 0; i < keys.length; i++) statusOpts += '<option value="' + keys[i] + '"' + (p.status === keys[i] ? ' selected' : '') + '>' + STATUS_TH[keys[i]] + '</option>';
  var zone = d.zone ? '<b>เขต ' + esc(d.zone.zone) + '</b> — ' + esc(d.zone.team) : '<span style="color:#98a2ad">ใส่จังหวัดแล้วระบบจะบอกผู้ดูแลเขตให้</span>';
  var rg = d.reg || {};
  var regHtml = '';
  if (rg.mode === 'off') regHtml = '<div class="auto" style="color:#98a2ad;margin-bottom:6px">📝 ระบบลงทะเบียน: ปิด (REGISTER=off)</div>';
  else if (rg.done) regHtml = '<div class="posbox" style="margin-bottom:6px">📝 ลงทะเบียนแล้ว' + (rg.done_at ? ' · ' + dayLabel(Date.parse(rg.done_at)) + ' ' + hhmm(Date.parse(rg.done_at)) : '') + ' · ' + ({ chat: 'ลูกค้ากรอกในแชท', liff: 'ลูกค้ากรอกฟอร์ม LIFF', 'chat-update': 'ลูกค้าอัปเดตในแชท', 'liff-update': 'ลูกค้าอัปเดตผ่านฟอร์ม LIFF', admin: 'แอดมินยืนยัน' }[rg.source] || 'ผูกกับ POS') + (rg.data && rg.data.name ? '<br><small style="color:#55606b">' + esc(rg.data.name) + (rg.data.phone ? ' · ' + esc(rg.data.phone) : '') + (rg.data.province ? ' · ' + esc(rg.data.province) : '') + '</small>' : '') + '<span class="unl" id="cf_regreset" title="ลบสถานะลงทะเบียน บอทจะถามลูกค้าใหม่">↺ ให้ถามใหม่</span></div>';
  else regHtml = '<div class="auto" style="margin-bottom:6px;border-color:#f5c6c6;background:#fff8f8">📝 <b>ยังไม่ลงทะเบียน</b>' + (rg.inProgress ? ' · บอทกำลังถาม: <b>' + ({ name: 'ชื่อ-นามสกุล', phone: 'เบอร์โทร', province: 'จังหวัด' }[rg.step] || rg.step) + '</b>' : (rg.mode === 'on' ? ' · บอทจะถามเมื่อลูกค้าทักครั้งถัดไป' : ' (โหมด soft ไม่บังคับ)')) + '<br><small style="color:#55606b">กรอก ชื่อ+เบอร์+จังหวัด แล้วบันทึก = ลงทะเบียนให้ลูกค้าเอง หรือ </small><span class="unl" id="cf_regdone" style="color:#2f5fa3">✓ ถือว่าลงทะเบียนแล้ว</span> · <span class="unl" id="cf_reginvite" style="color:#2f5fa3" title="ส่งข้อความเชิญลงทะเบียนถึงลูกค้ารายนี้ (Push 1 ข้อความ)">📣 ส่งคำเชิญลงทะเบียน</span></div>';
  var h = ''
    + '<div style="display:flex;justify-content:space-between;align-items:center"><h4>👤 โปรไฟล์ลูกค้า</h4><span class="exp" id="crmclose">✕ ปิด</span></div>'
    + regHtml
    + '<div class="row2"><div>' + crmField('ชื่อจริง / ชื่อที่ใช้เรียก', 'cf_real_name', p.real_name, s.name || '') + '</div><div>' + crmField('เบอร์โทร', 'cf_phone', p.phone, a.phone || '08x-xxx-xxxx') + '</div></div>'
    + '<div class="row2"><div>' + crmField('จังหวัด', 'cf_province', p.province, a.province || '') + '</div><div>' + crmField('อำเภอ', 'cf_district', p.district, '') + '</div></div>'
    + '<div class="row2"><div>' + crmField('พืชที่ปลูก', 'cf_crops', p.crops, a.crops || 'เช่น ทุเรียน, ข้าว') + '</div><div>' + crmField('พื้นที่ (ไร่)', 'cf_farm_rai', p.farm_rai, '') + '</div></div>'
    + crmField('ร้านค้า/ตัวแทนที่ซื้อประจำ', 'cf_shop', p.shop, '')
    + '<label>สถานะ</label><select id="cf_status">' + statusOpts + '</select>'
    + '<label>แท็ก (กดเลือก หรือพิมพ์เพิ่มแล้ว Enter)</label><div class="tags" id="cf_tags"></div><input id="cf_newtag" placeholder="เพิ่มแท็กเอง…" style="margin-top:6px">'
    + '<label>โน้ตสรุป (สิ่งที่ควรรู้เกี่ยวกับลูกค้ารายนี้)</label><textarea id="cf_note">' + esc(p.note || '') + '</textarea>'
    + '<button class="savebtn" id="cf_save">💾 บันทึกโปรไฟล์</button><div class="saved" id="cf_saved"></div>'
    + '<h4>🔗 ระบบ POS (รายชื่อเกษตรกร)</h4><div id="cf_pos"></div>'
    + '<h4>ผู้ดูแลเขต (ME/MR)</h4><div class="auto" id="cf_zone">' + zone + '</div>'
    + '<h4>ข้อมูลอัตโนมัติจากแชท</h4><div class="auto">'
    + 'LINE: ' + esc(s.name || '-') + ' <span style="color:#98a2ad;font-size:10.5px">' + esc(p.line_user_id || '') + '</span><br>'
    + 'ทักครั้งแรก: <b>' + (p.first_seen_at ? dayLabel(Date.parse(p.first_seen_at)) + ' ' + hhmm(Date.parse(p.first_seen_at)) : '-') + '</b> · ล่าสุด: <b>' + (p.last_chat_at ? dayLabel(Date.parse(p.last_chat_at)) + ' ' + hhmm(Date.parse(p.last_chat_at)) : '-') + '</b><br>'
    + 'เบอร์ที่พิมพ์ในแชท: <b>' + esc(a.phone || '-') + '</b> · จังหวัดที่พูดถึง: <b>' + esc(a.province || '-') + '</b><br>'
    + 'พืชที่พูดถึง: <b>' + esc(a.crops || '-') + '</b>'
    + '</div>'
    + '<h4>บันทึกการติดตาม</h4><div class="noteadd"><input id="cf_notein" placeholder="เช่น โทรแล้ว 17/8 ลูกค้าจะสั่ง 2 ลัง"><button id="cf_noteadd">เพิ่ม</button></div><div class="notes" id="cf_notes"></div>';
  document.getElementById('crm').innerHTML = h;
  renderTags();
  renderNotes(d.notes);
  renderPos(d.pos);
}

// ---------- POS link UI ----------
function candHtml(c, showLink) {
  var ex = [];
  if (c.extra) for (var k in c.extra) if (c.extra[k]) ex.push(esc(c.extra[k]));
  var meta = [c.phone ? '📱 ' + esc(c.phone) : '', [c.province, c.district].filter(Boolean).map(esc).join(' / '), ex.join(' · ')].filter(Boolean).join(' · ');
  return '<div class="cand' + (c.ok ? ' ok' : '') + '"><div class="ci"><b>' + esc(c.name || '(ไม่มีชื่อ)') + '</b>' + (c.ok ? ' <span class="okc">✓ ชื่อสอดคล้อง</span>' : '') + (c.linked_to && c.linked_to !== sel ? ' <small style="color:#d97706">(ผูกกับแชทอื่นแล้ว)</small>' : (c.linked_to === sel ? ' <small style="color:#0a9a4a">(ผูกกับแชทนี้)</small>' : ''))
    + (meta ? '<br><small>' + meta + '</small>' : '') + '</div>'
    + (showLink && c.linked_to !== sel ? '<button class="lnk" data-pos="' + esc(c.id) + '">ผูก</button>' : '') + '</div>';
}

function renderPos(p) {
  var el = document.getElementById('cf_pos');
  if (!el) return;
  if (!p || !p.on) { el.innerHTML = '<div class="auto" style="color:#98a2ad">ยังไม่ได้เชื่อมระบบ POS — ตั้งค่า POS_TABLE (ชื่อตารางเกษตรกรใน Supabase เดียวกัน) ใน Railway แล้ว Redeploy</div>'; return; }
  var h = '';
  if (p.status && p.status.error) h += '<div class="auto" style="color:#d33a41;margin-bottom:6px">⚠️ ' + esc(p.status.error) + '</div>';
  if (p.linked) {
    var l = p.linked;
    var meta = [l.phone ? '📱 ' + esc(l.phone) : '', [l.province, l.district].filter(Boolean).map(esc).join(' / ')].filter(Boolean).join(' · ');
    var ex = []; if (l.extra) for (var k in l.extra) if (l.extra[k]) ex.push(esc(l.extra[k]));
    var wb = p.writeback === 'ok' ? ' · ส่ง LINE ID กลับ POS แล้ว ✓' : (p.writeback === 'fail' ? ' · ⚠️ ส่ง LINE ID กลับ POS ไม่สำเร็จ' : (p.writeback === 'nocol' ? '' : ''));
    h += '<div class="posbox">🔗 ผูกกับ POS แล้ว: <b>' + esc(l.name || l.id) + '</b>' + (meta ? '<br>' + meta : '') + (ex.length ? '<br>' + ex.join(' · ') : '')
      + '<br><small style="color:#55606b">' + (p.link_by === 'auto' ? 'ระบบผูกอัตโนมัติ (เบอร์ตรง+ชื่อสอดคล้อง)' : 'แอดมินผูกเอง') + (p.linked_at ? ' · ' + dayLabel(Date.parse(p.linked_at)) + ' ' + hhmm(Date.parse(p.linked_at)) : '') + wb + '</small>'
      + '<span class="unl" id="cf_posunlink">✕ ยกเลิกการผูก</span></div>';
  } else {
    if (p.candidates && p.candidates.length) {
      h += '<div style="font-size:11.5px;color:#55606b;margin-bottom:4px">เบอร์ตรงกับรายชื่อใน POS — กด <b>ผูก</b> คนที่ใช่ (ระบบไม่ผูกให้เองเพราะ' + (p.candidates.length > 1 ? 'มีหลายคนใช้เบอร์นี้' : 'ชื่อยังไม่สอดคล้อง') + ')</div>';
      for (var i = 0; i < p.candidates.length; i++) h += candHtml(p.candidates[i], true);
    } else if (p.phones && p.phones.length) {
      h += '<div class="auto" style="color:#8a95a1">ไม่พบเบอร์ ' + esc(p.phones.join(', ')) + ' ใน POS (' + (p.status ? (p.status.rows || 0).toLocaleString('th-TH') : 0) + ' รายชื่อ) — ค้นหาชื่อด้านล่างเพื่อผูกเอง หรือกดสร้างรายชื่อใหม่</div>';
    } else {
      h += '<div class="auto" style="color:#8a95a1">ยังไม่มีเบอร์โทรของลูกค้ารายนี้ — เมื่อลูกค้าพิมพ์เบอร์ในแชท หรือแอดมินกรอกเบอร์แล้วบันทึก ระบบจะค้นใน POS ให้ทันที</div>';
    }
    var cp = crmData && crmData.profile ? crmData.profile : {};
    var canCreate = !!(cp.real_name && String(cp.real_name).trim());
    h += '<div style="margin-top:8px;display:flex;align-items:center;gap:8px"><button class="lnk' + (canCreate ? '' : ' dis') + '" id="cf_poscreate"' + (canCreate ? '' : ' disabled') + '>➕ สร้างรายชื่อนี้ใน POS</button><small style="color:#8a95a1">' + (canCreate ? 'ใช้ ชื่อจริง/เบอร์/จังหวัด/อำเภอ จากโปรไฟล์ (บันทึกก่อนถ้าเพิ่งแก้)' : 'กรอก "ชื่อจริง" แล้วบันทึกก่อน') + '</small></div>';
    if (cp.auto && cp.auto.pos_create_err) h += '<div style="color:#d33a41;font-size:11px;margin-top:4px">⚠️ ครั้งก่อนสร้างไม่สำเร็จ: ' + esc(cp.auto.pos_create_err) + '</div>';
  }
  h += '<div class="noteadd" style="margin-top:8px"><input id="cf_posq" placeholder="ค้นหาใน POS: ชื่อ หรือ เบอร์โทร"><button id="cf_possearch">ค้นหา</button></div><div id="cf_posres" style="margin-top:6px"></div>';
  el.innerHTML = h;
}

function posCreateUi() {
  if (!sel || !confirm('สร้างรายชื่อลูกค้านี้เป็นแถวใหม่ในตาราง POS (customers) และผูกกับแชทนี้?')) return;
  api('/admin/api/pos/create', { method: 'POST', body: JSON.stringify({ id: sel }) }).then(function() {
    loadCrm(sel);
    load();
  }).catch(function(e) { alert('สร้างไม่สำเร็จ: ' + e.message); });
}

function inviteUi() {
  if (!sel || !confirm('ส่งข้อความเชิญลงทะเบียน (ชื่อ/เบอร์/จังหวัด) ถึงลูกค้ารายนี้ทาง LINE? (ใช้โควต้า Push 1 ข้อความ)')) return;
  api('/admin/api/reg/invite', { method: 'POST', body: JSON.stringify({ id: sel }) }).then(function() {
    loadCrm(sel); load();
  }).catch(function(e) { alert('ส่งไม่สำเร็จ: ' + e.message); });
}

function inviteAllUi() {
  if (!confirm('ส่งข้อความเชิญลงทะเบียนถึงลูกค้าที่ยังไม่ลงทะเบียน ' + unreg + ' แชท ทาง LINE?\\n(ใช้โควต้า Push ' + unreg + ' ข้อความ · คนที่เพิ่งได้รับคำเชิญใน 24 ชม. จะไม่ส่งซ้ำ)')) return;
  var el = document.getElementById('invbtn');
  if (el) el.textContent = '📣 กำลังส่ง…';
  api('/admin/api/reg/invite', { method: 'POST', body: JSON.stringify({ all: true }) }).then(function(d) {
    alert('ส่งคำเชิญแล้ว ' + d.sent + ' แชท' + (d.failed ? ' · ส่งไม่ได้ ' + d.failed + ' แชท (บล็อก OA/โควต้า)' : '') + '\\nเมื่อลูกค้าตอบกลับ บอทจะเดินขั้นตอนลงทะเบียนต่อให้เอง');
    load();
  }).catch(function(e) { alert('ส่งไม่สำเร็จ: ' + e.message); load(); });
}

function regActionUi(action) {
  if (!sel) return;
  if (action === 'reset' && !confirm('ลบสถานะลงทะเบียน แล้วให้บอทถามข้อมูลลูกค้าใหม่ในครั้งถัดไป?')) return;
  api('/admin/api/reg', { method: 'POST', body: JSON.stringify({ id: sel, action: action }) }).then(function() {
    loadCrm(sel);
    load();
  }).catch(function(e) { alert(e.message); });
}

function posSearchUi() {
  var inp = document.getElementById('cf_posq');
  var out = document.getElementById('cf_posres');
  var qq = inp ? inp.value.trim() : '';
  if (!qq || !out) return;
  out.innerHTML = '<div style="color:#98a2ad;font-size:11px">กำลังค้นหา…</div>';
  api('/admin/api/pos/search?q=' + encodeURIComponent(qq)).then(function(d) {
    if (!d.results.length) { out.innerHTML = '<div style="color:#98a2ad;font-size:11px">ไม่พบ "' + esc(qq) + '" ใน POS</div>'; return; }
    var h = '<div style="font-size:11px;color:#8a95a1;margin-bottom:4px">พบ ' + d.results.length + ' รายชื่อ' + (d.results.length >= 20 ? ' (แสดง 20 แรก — พิมพ์ให้เจาะจงขึ้น)' : '') + '</div>';
    for (var i = 0; i < d.results.length; i++) h += candHtml(d.results[i], true);
    out.innerHTML = h;
  }).catch(function(e) { out.innerHTML = '<div style="color:#d33a41;font-size:11px">' + esc(e.message) + '</div>'; });
}

function posLinkUi(posId) {
  if (!sel || !posId) return;
  api('/admin/api/pos/link', { method: 'POST', body: JSON.stringify({ id: sel, pos_id: posId }) }).then(function() {
    loadCrm(sel);
    load();
  }).catch(function(e) { alert('ผูกไม่สำเร็จ: ' + e.message); });
}

function posUnlinkUi() {
  if (!sel || !confirm('ยกเลิกการผูกแชทนี้กับรายชื่อ POS?')) return;
  api('/admin/api/pos/unlink', { method: 'POST', body: JSON.stringify({ id: sel }) }).then(function() {
    loadCrm(sel);
    load();
  }).catch(function(e) { alert('ยกเลิกไม่สำเร็จ: ' + e.message); });
}

function loadCrm(id) {
  if (!id) return;
  api('/admin/api/crm?id=' + encodeURIComponent(id)).then(function(d) {
    if (id !== sel) return;
    renderCrm(d);
  }).catch(function(e) { document.getElementById('crm').innerHTML = '<div class="empty">โหลดโปรไฟล์ไม่ได้: ' + esc(e.message) + '</div>'; });
}

function toggleCrm(force) {
  crmOpen = typeof force === 'boolean' ? force : !crmOpen;
  document.getElementById('crm').className = 'crm' + (crmOpen ? ' on' : '');
  document.getElementById('crmbtn').className = 'crmbtn' + (crmOpen ? ' on' : '');
  if (crmOpen && sel) loadCrm(sel);
}

function saveCrm() {
  if (!sel) return;
  var g = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var body = { id: sel, real_name: g('cf_real_name'), phone: g('cf_phone'), province: g('cf_province'), district: g('cf_district'), crops: g('cf_crops'), farm_rai: g('cf_farm_rai'), shop: g('cf_shop'), status: g('cf_status'), tags: crmTags, note: g('cf_note') };
  var btn = document.getElementById('cf_save');
  btn.disabled = true;
  api('/admin/api/crm', { method: 'POST', body: JSON.stringify(body) }).then(function(d) {
    btn.disabled = false;
    document.getElementById('cf_saved').textContent = '✓ บันทึกแล้ว ' + hhmm(Date.now()) + (crmData && crmData.sb ? (d.synced ? ' · ซิงก์ Supabase แล้ว' : ' · ⚠️ ซิงก์ Supabase ไม่สำเร็จ (เก็บในเครื่องไว้ก่อน)') : ' (เก็บในเครื่อง)');
    var z = document.getElementById('cf_zone');
    if (z) z.innerHTML = d.zone ? '<b>เขต ' + esc(d.zone.zone) + '</b> — ' + esc(d.zone.team) : '<span style="color:#98a2ad">ใส่จังหวัดแล้วระบบจะบอกผู้ดูแลเขตให้</span>';
    load();
  }).catch(function(e) { btn.disabled = false; alert('บันทึกไม่สำเร็จ: ' + e.message); });
}

function addNote() {
  var inp = document.getElementById('cf_notein');
  var t = inp ? inp.value.trim() : '';
  if (!t || !sel) return;
  api('/admin/api/crm/note', { method: 'POST', body: JSON.stringify({ id: sel, text: t }) }).then(function() {
    inp.value = '';
    loadCrm(sel);
  }).catch(function(e) { alert('เพิ่มบันทึกไม่สำเร็จ: ' + e.message); });
}

function exportCsv() {
  fetch('/admin/api/crm/export.csv', { headers: { 'x-admin-key': KEY } }).then(function(r) {
    if (!r.ok) throw new Error('ส่งออกไม่สำเร็จ (' + r.status + ')');
    return r.blob();
  }).then(function(b) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'crm_customers_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }).catch(function(e) { alert(e.message); });
}

function renderHead() {
  var s = findSel();
  if (!s) return;
  var now = Date.now();
  var muted = s.mutedUntil > now;
  var forever = s.mutedUntil >= 8000000000000000;
  document.getElementById('chead').classList.add('on');
  document.getElementById('hav').outerHTML = avatarHtml(s, 's').replace('class="av "', 'class="av s"');
  document.querySelector('#chead .av').id = 'hav';
  document.getElementById('hname').textContent = dispName(s);
  var st = muted
    ? '<span class="pill r">🔇 ' + (forever ? 'บอทหยุดอยู่ · แอดมินตอบ' : 'หยุดถึง ' + hhmm(s.mutedUntil)) + '</span>'
    : '<span class="pill g">🔊 บอทตอบอัตโนมัติ</span>';
  if (muted && s.handoff) st += '<span class="pill o">🙋 ลูกค้าขอแอดมิน</span>';
  if (s.cb) st += '<span class="pill cb">📞 รอติดต่อกลับ</span>';
  if (s.crm && s.crm.pos) st += '<span class="pill pos" title="ผูกกับรายชื่อ POS แล้ว">🔗 POS: ' + esc(s.crm.pos) + '</span>';
  else if (s.crm && s.crm.posc) st += '<span class="pill o" title="มีรายชื่อ POS ที่น่าจะใช่ รอยืนยันในแผงโปรไฟล์">🔗 POS รอยืนยัน</span>';
  document.getElementById('hstat').innerHTML = st;
  var b = document.getElementById('tglbtn');
  if (muted) { b.className = 'tgl start'; b.textContent = '▶ เปิดบอทตอบต่อ'; b.dataset.m = '0'; }
  else { b.className = 'tgl stop'; b.textContent = '⏸ หยุดบอท ตอบเอง'; b.dataset.m = '-1'; }
  var cbb = document.getElementById('cbbtn');
  var bar = document.getElementById('cbbar');
  if (s.cb) {
    cbb.className = 'cbbtn done'; cbb.textContent = '✓ ติดต่อแล้ว'; cbb.dataset.a = 'done';
    var why = s.cb.src === 'phone' ? 'ลูกค้าทิ้งเบอร์ไว้' : (s.cb.src === 'kw' ? 'ลูกค้าพิมพ์ขอคุยกับแอดมิน' : (s.cb.src === 'admin' ? 'แอดมินตั้งธงเอง' : 'บอทรับปากว่าจะให้เจ้าหน้าที่ติดต่อกลับ'));
    bar.className = 'cbbar on';
    bar.innerHTML = '<b>📞 ลูกค้ารอติดต่อกลับ</b> ตั้งแต่ ' + dayLabel(s.cb.at) + ' ' + hhmm(s.cb.at) + ' · ' + esc(why)
      + (s.cb.contact ? ' · <b>ติดต่อ: ' + esc(s.cb.contact) + '</b>' : ' · ยังไม่ได้ทิ้งเบอร์ (ดูในแชท)')
      + (s.cb.topic ? '<br>เรื่อง: ' + esc(s.cb.topic) : '')
      + (s.cb.note && s.cb.src === 'bot' ? '<br>บอทตอบว่า: “' + esc(s.cb.note) + '”' : '');
  } else {
    cbb.className = 'cbbtn set'; cbb.textContent = '📞 ตั้งรอติดต่อกลับ'; cbb.dataset.a = 'set';
    bar.className = 'cbbar'; bar.innerHTML = '';
  }
}

function fetchHist(id) {
  api('/admin/api/history?id=' + encodeURIComponent(id)).then(function(d) {
    if (id !== sel) return;
    var el = document.getElementById('msgs');
    var s = findSel() || { pic: '', name: '', id: id, type: 'user' };
    if (!d.history.length) {
      el.innerHTML = '<div class="chat-empty"><div class="big">🕐</div><div>ยังไม่มีข้อความ</div></div>';
      return;
    }
    var h = '';
    var lastDay = '';
    for (var i = 0; i < d.history.length; i++) {
      var m = d.history[i];
      var dl = dayLabel(m.at);
      if (dl !== lastDay) { h += '<div class="day"><span>' + dl + '</span></div>'; lastDay = dl; }
      if (m.r === 'u') {
        var mav = s.pic ? '<img src="' + esc(s.pic) + '" alt="">' : (s.type === 'group' ? '👥' : '👤');
        h += '<div class="mrow user"><div class="mav">' + mav + '</div><div class="bub">' + esc(m.t) + '</div><div class="mtime">' + hhmm(m.at) + '</div></div>';
      } else {
        var isAdm = m.r === 'a';
        h += '<div class="mrow bot"><div class="mtime">' + (isAdm ? '🧑‍💼 แอดมิน · ' : '🤖 ') + hhmm(m.at) + '</div><div class="bub' + (isAdm ? ' ab' : '') + '">' + esc(m.t) + '</div></div>';
      }
    }
    var atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    var wasFilled = el.dataset.for === id;
    el.innerHTML = h;
    if (!wasFilled || atBottom) el.scrollTop = el.scrollHeight;
    el.dataset.for = id;
  }).catch(function() {});
}

function selectChat(id) {
  sel = id;
  renderList();
  renderHead();
  document.getElementById('msgs').dataset.for = '';
  document.getElementById('msgs').innerHTML = '<div class="chat-empty"><div class="big">⏳</div></div>';
  document.getElementById('composer').classList.add('on');
  fetchHist(id);
  document.getElementById('main').classList.add('show');
  if (crmOpen) loadCrm(id);
}

var sending = false;
function autoGrow() {
  var ta = document.getElementById('ta');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
}
function doSend() {
  var ta = document.getElementById('ta');
  var btn = document.getElementById('sendbtn');
  var t = ta.value.trim();
  if (!t || !sel || sending) return;
  sending = true;
  btn.disabled = true;
  api('/admin/api/send', { method: 'POST', body: JSON.stringify({ id: sel, text: t }) })
    .then(function() {
      ta.value = '';
      autoGrow();
      sending = false;
      btn.disabled = false;
      ta.focus();
      fetchHist(sel);
      load();
    })
    .catch(function() {
      sending = false;
      btn.disabled = false;
      alert('ส่งไม่สำเร็จ — เช็คโควต้า Push รายเดือนของ LINE OA หรือ token');
    });
}

document.getElementById('loginbtn').addEventListener('click', login);
document.getElementById('key').addEventListener('keydown', function(e) { if (e.key === 'Enter') login(); });
document.getElementById('refreshbtn').addEventListener('click', function() { load(); });
document.getElementById('backbtn').addEventListener('click', function() { document.getElementById('main').classList.remove('show'); });

document.getElementById('items').addEventListener('click', function(e) {
  var it = e.target.closest('.item');
  if (it) selectChat(it.getAttribute('data-id'));
});

document.getElementById('tglbtn').addEventListener('click', function() {
  if (!sel) return;
  var m = parseInt(this.dataset.m, 10);
  api('/admin/api/mute', { method: 'POST', body: JSON.stringify({ id: sel, minutes: m }) })
    .then(function() { load(); })
    .catch(function(e) { alert(e.message); });
});

document.getElementById('cbbtn').addEventListener('click', function() {
  if (!sel) return;
  var a = this.dataset.a;
  if (a === 'done' && !confirm('ยืนยันว่าติดต่อลูกค้ารายนี้เรียบร้อยแล้ว?')) return;
  api('/admin/api/callback', { method: 'POST', body: JSON.stringify({ id: sel, action: a }) })
    .then(function() { load(); })
    .catch(function(e) { alert(e.message); });
});

document.getElementById('q').addEventListener('input', function() { q = this.value.trim().toLowerCase(); renderList(); });
document.getElementById('crmbtn').addEventListener('click', function() { toggleCrm(); });
document.getElementById('expbtn').addEventListener('click', exportCsv);
document.getElementById('posst').addEventListener('click', function(e) {
  if (e.target && e.target.id === 'invbtn') inviteAllUi();
});
document.getElementById('crm').addEventListener('click', function(e) {
  var t = e.target;
  if (t.id === 'crmclose') { toggleCrm(false); return; }
  if (t.id === 'cf_save') { saveCrm(); return; }
  if (t.id === 'cf_noteadd') { addNote(); return; }
  if (t.id === 'cf_possearch') { posSearchUi(); return; }
  if (t.id === 'cf_posunlink') { posUnlinkUi(); return; }
  if (t.id === 'cf_poscreate') { if (!t.disabled) posCreateUi(); return; }
  if (t.id === 'cf_regdone') { regActionUi('done'); return; }
  if (t.id === 'cf_regreset') { regActionUi('reset'); return; }
  if (t.id === 'cf_reginvite') { inviteUi(); return; }
  var lk = t.closest ? t.closest('.lnk') : null;
  if (lk) {
    var pid = lk.getAttribute('data-pos');
    var isOther = /ผูกกับแชทอื่นแล้ว/.test(lk.parentNode ? lk.parentNode.textContent : '');
    if (!isOther || confirm('รายชื่อนี้ผูกกับแชทอื่นอยู่แล้ว ต้องการย้ายมาผูกกับแชทนี้แทน?')) posLinkUi(pid);
    return;
  }
  var tg = t.closest ? t.closest('.tag') : null;
  if (tg) {
    var name = tg.getAttribute('data-tag');
    var i = crmTags.indexOf(name);
    if (i === -1) crmTags.push(name); else crmTags.splice(i, 1);
    renderTags();
  }
});
document.getElementById('crm').addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'cf_newtag') {
    e.preventDefault();
    var v = e.target.value.trim();
    if (v && crmTags.indexOf(v) === -1) crmTags.push(v);
    e.target.value = '';
    renderTags();
  } else if (e.target.id === 'cf_notein') { e.preventDefault(); addNote(); }
  else if (e.target.id === 'cf_posq') { e.preventDefault(); posSearchUi(); }
});

document.getElementById('sendbtn').addEventListener('click', doSend);
document.getElementById('ta').addEventListener('input', autoGrow);
document.getElementById('ta').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
});

if (KEY) load();
</script>
</body>
</html>`;

function adminAuthed(req) {
  if (!ADMIN_KEY) return null;
  const k = req.headers['x-admin-key'] || '';
  try {
    return k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
  } catch (_) { return false; }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function handleAdmin(req, res, path, body) {
  // SSE stream ใช้ token (EventSource ตั้ง header เองไม่ได้)
  if (path === '/admin/api/stream' && req.method === 'GET') {
    const t = new URL(req.url, 'http://x').searchParams.get('t') || '';
    const exp = sseTokens.get(t);
    if (!exp || exp < Date.now()) return sendJson(res, 401, { ok: false, error: 'bad token' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  const authed = adminAuthed(req);
  if (authed === null) return sendJson(res, 503, { ok: false, error: 'ADMIN_KEY not set' });
  if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  if (path === '/admin/api/token' && req.method === 'POST') {
    const token = crypto.randomBytes(16).toString('hex');
    sseTokens.set(token, Date.now() + 24 * 3600000);
    if (sseTokens.size > 50) {
      const oldest = sseTokens.keys().next().value;
      sseTokens.delete(oldest);
    }
    return sendJson(res, 200, { ok: true, token });
  }

  if (path === '/admin/api/list' && req.method === 'GET') {
    const now = Date.now();
    const rank = (x) => (x.cb ? 2 : 0) + ((x.handoff && x.mutedUntil > now) ? 1 : 0);
    const list = [...sessions.entries()]
      .map(([id, s]) => ({ id, name: s.name, pic: s.pic, type: s.type, lastText: s.lastText, lastAt: s.lastAt, mutedUntil: s.mutedUntil, handoff: !!s.handoff, cb: s.cb || null, cbDone: s.cbDone || null, crm: crmSummary(id), reg: s.reg ? 'asking:' + s.reg.step : (regDone(crm.get(id)) ? 'done' : 'none') }))
      // ธงรอติดต่อกลับอยู่บนสุด (คนที่รอนานสุดขึ้นก่อน) -> ขอแอดมิน -> ล่าสุดก่อน
      .sort((a, b) => rank(b) - rank(a) || ((a.cb && b.cb) ? a.cb.at - b.cb.at : b.lastAt - a.lastAt))
      .slice(0, 100);
    const pending = [...sessions.values()].filter((s) => s.cb).length;
    const posSt = POS_ON ? { on: true, rows: pos.rows.length, loadedAt: pos.loadedAt, error: pos.error, writeback: !!(pos.cols && pos.cols.line) } : { on: false };
    return sendJson(res, 200, { ok: true, muteMinutes: MUTE_MINUTES, persist: persistOK, notify: ADMIN_NOTIFY_IDS.length, sb: SB_ON, pos: posSt, reg: REG_MODE, regUi: REG_UI, liffUrl: LIFF_URL, unregistered: regUnregisteredIds().length, pending, now, sessions: list });
  }

  // ---- CRM ----
  if (path === '/admin/api/crm' && req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    const c = crmGet(id);
    const s = sessions.get(id);
    crmListNotes(id).then((notes) => sendJson(res, 200, { ok: true, profile: c, notes, zone: zoneInfo(c.province || (c.auto && c.auto.province) || ''), sb: SB_ON, statuses: CRM_STATUS, pos: posInfoFor(c), reg: regInfo(s, c) }))
      .catch(() => sendJson(res, 200, { ok: true, profile: c, notes: [], zone: zoneInfo(c.province || ''), sb: SB_ON, statuses: CRM_STATUS, pos: posInfoFor(c), reg: regInfo(s, c) }));
    return;
  }
  // ---- ลงทะเบียน: action = 'done' (ถือว่าลงทะเบียนแล้ว) | 'reset' (ให้บอทถามใหม่) ----
  if (path === '/admin/api/reg' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    const c = crmGet(id);
    const s = sessions.get(id);
    c.auto = c.auto || {};
    if (data.action === 'done') {
      c.auto.reg = { done_at: new Date().toISOString(), source: 'admin', name: c.real_name || '', phone: normPhone(c.phone) || '', province: c.province || '' };
      if (s.reg) s.reg = null;
    } else if (data.action === 'reset') {
      delete c.auto.reg;
      if (s.reg) s.reg = null;
    } else return sendJson(res, 400, { ok: false, error: 'bad action' });
    c.updated_at = new Date().toISOString();
    markDirty();
    broadcast();
    if (SB_ON) sbUpsert(c);
    console.log(`[admin] ${id.slice(0, 8)} reg ${data.action}`);
    return sendJson(res, 200, { ok: true, reg: regInfo(s, c) });
  }
  // เชิญลงทะเบียน (Push): {id} = แชทเดียว, {all:true} = ทุกแชทลูกค้าที่ยังไม่ลงทะเบียน (ข้ามคนที่เพิ่งเชิญไปใน 24 ชม.)
  if (path === '/admin/api/reg/invite' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    if (data.all === true) {
      const dayAgo = Date.now() - 24 * 3600000;
      const ids = regUnregisteredIds().filter((id) => { const s = sessions.get(id); return !((s.reg && s.reg.invitedAt && s.reg.invitedAt > dayAgo) || (s.regInvitedAt && s.regInvitedAt > dayAgo)); }).slice(0, 300);
      (async () => {
        let sent = 0, failed = 0;
        for (const id of ids) { const r = await regInvite(id); if (r.ok) sent++; else failed++; await new Promise((rs) => setTimeout(rs, 120)); }
        console.log(`[admin] invite all: sent=${sent} failed=${failed}`);
        sendJson(res, 200, { ok: true, total: ids.length, sent, failed, remaining: regUnregisteredIds().length });
      })().catch((e) => sendJson(res, 500, { ok: false, error: e.message }));
      return;
    }
    const id = data.id;
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    regInvite(id).then((r) => sendJson(res, r.ok ? 200 : 400, Object.assign({ ok: r.ok, error: r.err }, r.ok ? { reg: regInfo(sessions.get(id), crmGet(id)) } : {})));
    return;
  }
  if (path === '/admin/api/pos/create' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || (!sessions.has(id) && !crm.has(id))) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    posCreate(id, 'admin').then((r) => {
      const c = crmGet(id);
      console.log(`[admin] ${id.slice(0, 8)} pos create -> ${r.ok ? r.rec.id : 'fail: ' + r.err}`);
      sendJson(res, r.ok ? 200 : 400, Object.assign({ ok: r.ok, error: r.ok ? undefined : r.err }, r.ok ? { pos: posInfoFor(c), profile: c, zone: zoneInfo(c.province || '') } : {}));
    });
    return;
  }

  // ---- POS link ----
  if (path === '/admin/api/pos/status' && req.method === 'GET') return sendJson(res, 200, Object.assign({ ok: true }, posStatus()));
  if (path === '/admin/api/pos/refresh' && req.method === 'POST') {
    if (!POS_ON) return sendJson(res, 400, { ok: false, error: 'POS link ปิดอยู่ (ตั้ง POS_TABLE + SUPABASE_URL + SUPABASE_SERVICE_KEY)' });
    posRefresh().then((okv) => sendJson(res, 200, Object.assign({ ok: true, refreshed: okv }, posStatus())));
    return;
  }
  if (path === '/admin/api/pos/search' && req.method === 'GET') {
    const qq = new URL(req.url, 'http://x').searchParams.get('q') || '';
    return sendJson(res, 200, { ok: true, q: qq, results: POS_ON ? posSearch(qq) : [], on: POS_ON });
  }
  if ((path === '/admin/api/pos/link' || path === '/admin/api/pos/unlink') && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || (!sessions.has(id) && !crm.has(id))) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    if (!POS_ON) return sendJson(res, 400, { ok: false, error: 'POS link ปิดอยู่' });
    if (path === '/admin/api/pos/unlink') {
      const done = posUnlink(id);
      console.log(`[admin] ${id.slice(0, 8)} pos unlink -> ${done}`);
      return sendJson(res, 200, { ok: true, unlinked: done, pos: posInfoFor(crmGet(id)), profile: crmGet(id) });
    }
    const rec = pos.byId.get(String(data.pos_id || ''));
    if (!rec) return sendJson(res, 404, { ok: false, error: 'ไม่พบรายชื่อนี้ใน POS (ลองกดรีเฟรชรายชื่อ)' });
    const c = crmGet(id);
    if (c.pos_id && String(c.pos_id) !== rec.id) posUnlink(id);
    if (String(c.pos_id) !== rec.id) posLink(id, rec, 'admin');
    console.log(`[admin] ${id.slice(0, 8)} pos link -> ${rec.id}`);
    return sendJson(res, 200, { ok: true, pos: posInfoFor(c), profile: c, zone: zoneInfo(c.province || '') });
  }
  if (path === '/admin/api/crm' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    crmUpdate(id, data).then((saved) => {
      const c = crmGet(id);
      console.log(`[crm] ${id.slice(0, 8)} profile updated (sb=${saved})`);
      sendJson(res, 200, { ok: true, profile: c, synced: saved, zone: zoneInfo(c.province || '') });
    });
    return;
  }
  if (path === '/admin/api/crm/note' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    const text = String(data.text || '').trim();
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    if (!text) return sendJson(res, 400, { ok: false, error: 'empty text' });
    crmAddNote(id, text).then((note) => sendJson(res, 200, { ok: true, note }));
    return;
  }
  if (path === '/admin/api/crm/export.csv' && req.method === 'GET') {
    const cols = ['line_user_id', 'display_name', 'real_name', 'phone', 'province', 'district', 'crops', 'farm_rai', 'shop', 'status', 'tags', 'note', 'pos_id', 'pos_name', 'pos_link_by', 'pos_linked_at', 'first_seen_at', 'last_chat_at', 'updated_at'];
    const rows = [cols.join(',')];
    for (const c of crm.values()) rows.push(cols.map((k) => csvCell(k === 'crops' ? (c.crops || (c.auto && c.auto.crops) || '') : c[k])).join(','));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="crm_customers.csv"' });
    return res.end('\uFEFF' + rows.join('\r\n'));
  }

  // ธงรอติดต่อกลับ: action = 'done' (ติดต่อแล้ว) | 'set' (แอดมินตั้งเอง)
  if (path === '/admin/api/callback' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    const s = sessions.get(id);
    if (data.action === 'done') clearCallback(s);
    else if (data.action === 'set') { if (!s.cb) flagCallback(id, s, 'admin', { note: 'แอดมินตั้งธงเอง' }); }
    else return sendJson(res, 400, { ok: false, error: 'bad action' });
    console.log(`[admin] ${id.slice(0, 8)} callback ${data.action}`);
    return sendJson(res, 200, { ok: true, id, cb: s.cb || null });
  }

  if (path === '/admin/api/history' && req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    const s = sessions.get(id);
    if (!s) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    return sendJson(res, 200, { ok: true, id, history: s.history });
  }

  if (path === '/admin/api/mute' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    const s = sessions.get(id);
    const m = data.minutes;
    if (m === 0) { s.mutedUntil = 0; s.handoff = false; }
    else if (m === -1) s.mutedUntil = FOREVER;
    else if (typeof m === 'number' && m > 0) s.mutedUntil = Date.now() + m * 60000;
    else s.mutedUntil = Date.now() + MUTE_MINUTES * 60000;
    markDirty();
    broadcast();
    console.log(`[admin] ${id.slice(0, 8)} mutedUntil=${s.mutedUntil}`);
    return sendJson(res, 200, { ok: true, id, mutedUntil: s.mutedUntil, handoff: !!s.handoff });
  }

  // แอดมินส่งข้อความหาลูกค้าในนาม OA (ใช้ Push API — กินโควต้ารายเดือน)
  if (path === '/admin/api/send' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    const text = String(data.text || '').trim().slice(0, 4900);
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    if (!text) return sendJson(res, 400, { ok: false, error: 'empty text' });
    const s = sessions.get(id);
    linePush(id, text).then((ok) => {
      if (ok) {
        pushHist(s, 'a', text);
        s.lastText = text.slice(0, 120);
        s.lastAt = Date.now();
        markDirty();
        broadcast();
        console.log(`[admin-send] ${id.slice(0, 8)} len=${text.length}`);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 502, { ok: false, error: 'push failed' });
    }).catch(() => sendJson(res, 502, { ok: false, error: 'push failed' }));
    return;
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

// ---------- Server ----------
const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && path === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(ADMIN_HTML);
  }

  // ฟอร์มลงทะเบียน LIFF (สาธารณะ แต่ทุก POST ต้องแนบ token จาก LIFF ที่ตรวจกับ LINE ได้)
  if (path === '/liff' || path.startsWith('/liff/')) {
    if (req.method === 'GET') return handleLiff(req, res, path, Buffer.alloc(0)).catch((e) => sendJson(res, 500, { ok: false, error: e.message }));
    let chunks = [], size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 65536) chunks.push(c); });
    req.on('end', () => handleLiff(req, res, path, Buffer.concat(chunks)).catch((e) => sendJson(res, 500, { ok: false, error: e.message })));
    return;
  }

  if (path.startsWith('/admin/api/')) {
    if (req.method === 'GET') return handleAdmin(req, res, path, Buffer.alloc(0));
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handleAdmin(req, res, path, Buffer.concat(chunks)));
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'line-dify-bridge', version: 3.4, persist: persistOK, chats: sessions.size, callbacks: [...sessions.values()].filter((s) => s.cb).length, crm: crm.size, supabase: SB_ON, pos: POS_ON, posRows: pos.rows.length, posLinked: [...crm.values()].filter((c) => c.pos_id).length, posError: pos.error ? true : false, register: REG_MODE, regUi: REG_UI, liff: !!LIFF_ID, registered: [...crm.values()].filter((c) => regDone(c)).length, registering: [...sessions.values()].filter((s) => s.reg).length, ts: Date.now() }));
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end('Not found'); }

  // LINE webhook
  let chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    const sig = req.headers['x-line-signature'] || '';
    const expected = crypto.createHmac('sha256', CH_SECRET).update(body).digest('base64');
    let valid = false;
    try { valid = sig.length > 0 && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch (_) {}
    if (!valid) { res.writeHead(401); return res.end('Invalid signature'); }

    res.writeHead(200); res.end('OK');

    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) { return; }
    (data.events || []).forEach((ev) => {
      handleEvent(ev).catch((e) => console.log('event error:', e.message));
    });
  });
});

initPersist();
if (SB_ON) {
  console.log('[crm] Supabase ON:', SB_URL);
  sbIntrospect()
    .then(() => crmLoadFromSupabase())
    .then(() => {
      if (!POS_ON) { console.log('[pos] POS link OFF (ตั้ง POS_TABLE เช่น customers เพื่อเปิดระบบจับคู่กับ POS)'); return; }
      console.log(`[pos] POS link ON: table=${POS_TABLE_RAW} refresh=${POS_REFRESH_MIN}m`);
      return posRefresh();
    })
    .catch((e) => console.log('[boot] supabase init error:', e.message));
  if (POS_ON) setInterval(() => { posRefresh().catch(() => {}); }, POS_REFRESH_MIN * 60000);
} else {
  console.log('[crm] Supabase OFF — CRM เก็บใน state file (ตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY เพื่อซิงก์)');
  if (POS_TABLE) console.log('[pos] POS_TABLE ตั้งไว้แต่ยังไม่มี SUPABASE_URL/SUPABASE_SERVICE_KEY -> POS link ปิด');
}
setTimeout(bootBackfill, 3000);
server.listen(PORT, () => console.log(`line-dify-bridge v3.4 (register=${REG_MODE}+pos-link=${POS_ON}+crm+callback-flag+backfill+send+persist=${persistOK}+SSE, notify=${ADMIN_NOTIFY_IDS.length}, supabase=${SB_ON}) running on port ${PORT}`));
