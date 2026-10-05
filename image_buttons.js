'use strict';

// v3.29: ปุ่มดูรูปสินค้าที่ยังไม่ได้กดต้องอยู่ต่อหลังลูกค้ากดดูรูปทีละตัว
// เช่น คำตอบเสนอ 3 ปุ่ม กดไป 1 -> รูปที่ส่งกลับมีปุ่มอีก 2 กดต่อ -> เหลือ 1
// ถ้าลูกค้าส่งข้อความอื่นที่ไม่ใช่การกดปุ่ม ปุ่มชุดเดิมหมดอายุ ไม่ถูกแนบกลับมาอีก

function rememberButtons(s, names) {
  s.pimgPending = Array.isArray(names) ? names.slice(0, 4) : [];
}

function clearButtons(s) {
  s.pimgPending = [];
}

// fileOf(name) คืนชื่อไฟล์รูปของสินค้า (ใช้ตรวจว่าส่งรูปนั้นไปแล้วหรือยัง)
function remainingButtons(s, fileOf) {
  const sent = s.pimgSent || {};
  const rest = (Array.isArray(s.pimgPending) ? s.pimgPending : [])
    .filter((n) => { const f = fileOf(n); return f && !sent[f]; });
  s.pimgPending = rest;
  return rest;
}

module.exports = { rememberButtons, clearButtons, remainingButtons };
