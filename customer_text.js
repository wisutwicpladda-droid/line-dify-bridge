'use strict';

// v3.50 (28 Oct 2026): ข้อความที่ลูกค้าเห็น
// 1) "ในระบบ" เป็นคำภายใน (เช่น "ยังไม่มีข้อมูลคำแนะนำในระบบ", "ในระบบยังไม่มีข้อมูล") ตัดออกจากคำตอบของ Dify
//    ตัดเฉพาะเมื่อพูดถึงข้อมูล/คำแนะนำ หรือขึ้นต้นประโยคว่ายังไม่มี คำอย่าง "ในระบบราก" "ในระบบท่อน้ำ" "ในระบบประสาท" ยังอยู่
// 2) รายชื่อพนักงานขายที่ลูกค้าเห็นไม่มีรหัสตำแหน่ง ME/MR (เจ้าของตัดสิน 27 ต.ค. 2569)
// 3) v3.53: หมายเหตุภายใน "(ไม่มีรูป)" ในชื่อสินค้าของชีท (นิวเพน) หลุดไปในคำตอบคุมหญ้าพริกและหอมแบ่ง ตัดออก

const SYSTEM_WORD_END = '(?=$|[\\s.,!?)\\]"\'”]|ค่ะ|คะ|นะ|ครับ|เลย|ตอนนี้|ขณะนี้|แล้ว|ด้วย|เท่านั้น|ยัง|ไม่|จึง|แต่|และ|หรือ|ซึ่ง|ที่|โดย|ให้|เพื่อ)';
const SYSTEM_OWNER = '(?:ของ(?:เรา|บริษัท|น้องลัดดา|ลัดดา))?';
const SYSTEM_WORD_DATA_RX = new RegExp('(ข้อมูล|คำแนะนำ|รายละเอียด|รายการ|รายชื่อ|สินค้า)([^\\n]{0,20}?)ในระบบ' + SYSTEM_OWNER + SYSTEM_WORD_END, 'g');
const SYSTEM_WORD_LEAD_RX = new RegExp('ในระบบ' + SYSTEM_OWNER + '(?=\\s*(?:ยัง|ไม่มี|ไม่พบ))', 'g');

function removeSystemWords(text) {
  const s = String(text == null ? '' : text);
  if (!s.includes('ในระบบ')) return s;
  return s.replace(SYSTEM_WORD_DATA_RX, '$1$2').replace(SYSTEM_WORD_LEAD_RX, '')
    .replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?)])/g, '$1');
}

// v3.53: "นิวเพน (ไม่มีรูป)" -> "นิวเพน" ส่วนข้อความอย่าง "(ไม่มีรูปร่างชัดเจน)" ไม่โดนตัด
const INTERNAL_NOTE_RX = /[ \t]*\(\s*ไม่มีรูป\s*\)/g;
function removeInternalNotes(text) {
  const s = String(text == null ? '' : text);
  return s.includes('ไม่มีรูป') ? s.replace(INTERNAL_NOTE_RX, '') : s;
}

function stripStaffCode(name) {
  return String(name == null ? '' : name).replace(/^\s*M[ER]\b\s*/, '');
}

// ทีมงานประจำเขต -> แถว {name, phone} (จากสตริง ZONE_TEAM เช่น "ME ชื่อ 061-xxx-xxxx · MR ชื่อ 092-xxx-xxxx / ชื่อ")
function zoneTeamRows(z) {
  if (!z || !z.team) return [];
  const rows = [];
  for (const seg of String(z.team).split(' · ')) {
    for (const item of seg.split(' / ')) {
      const m = /^(.*?)\s*(\d[\d-]{7,12})\s*$/.exec(item.trim());
      if (!m) { const n = item.trim(); if (n) rows.push({ name: n, phone: '' }); continue; } // ยังไม่มีเบอร์ -> โชว์ชื่ออย่างเดียว
      const d = m[2].replace(/\D/g, '');
      rows.push({ name: m[1].trim(), phone: d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : m[2] });
    }
  }
  return rows;
}

// v3.50: ทีมขายที่ลูกค้าเห็น (ข้อความยืนยันลงทะเบียน หน้า LIFF) หัวข้อ "พนักงานขายที่ดูแล จ.<จังหวัด>" ไม่มีรหัสเขตและ ME/MR
function customerTeam(province, zone) {
  const prov = String(province || '').trim();
  if (!prov || !zone || !zone.team) return null;
  return { province: prov, title: 'พนักงานขายที่ดูแล จ.' + prov, rows: zoneTeamRows(zone).map((r) => ({ name: stripStaffCode(r.name), phone: r.phone })) };
}
function customerTeamText(team) {
  if (!team || !team.rows.length) return '';
  return '📍 ' + team.title + '\n' + team.rows.map((r) => '• ' + r.name + (r.phone ? ' ' + r.phone : '')).join('\n');
}

module.exports = { removeSystemWords, removeInternalNotes, stripStaffCode, zoneTeamRows, customerTeam, customerTeamText };
