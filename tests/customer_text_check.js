'use strict';

// v3.50 (28 Oct 2026): คำภายใน "ในระบบ" และ ME/MR ไม่ถึงลูกค้า
const assert = require('assert');
const { removeSystemWords, stripStaffCode } = require('../customer_text');

// คำตอบจริงจากรอบทดสอบ 28 ต.ค. (p087 พี.เอ็น. 13-0-46, p097 คริซ่า)
assert.strictEqual(removeSystemWords('ส่วนอัตราและวิธีใช้เฉพาะพืช ตอนนี้น้องลัดดายังไม่มีข้อมูลคำแนะนำในระบบ รบกวนสอบถามพนักงานขายเพิ่มเติมนะคะ'),
  'ส่วนอัตราและวิธีใช้เฉพาะพืช ตอนนี้น้องลัดดายังไม่มีข้อมูลคำแนะนำ รบกวนสอบถามพนักงานขายเพิ่มเติมนะคะ');
assert.strictEqual(removeSystemWords('สำหรับข้อมูลด้านการใช้งานและรายละเอียดอื่นๆ ในระบบยังไม่มีข้อมูลระบุไว้ในขณะนี้ค่ะ'),
  'สำหรับข้อมูลด้านการใช้งานและรายละเอียดอื่นๆ ยังไม่มีข้อมูลระบุไว้ในขณะนี้ค่ะ');
assert.strictEqual(removeSystemWords('ไม่พบสินค้าในระบบค่ะ'), 'ไม่พบสินค้าค่ะ');
assert.strictEqual(removeSystemWords('เนื่องจากในแคนตาลูปยังไม่มีอัตราแนะนำเฉพาะในระบบ อัตราการใช้ที่เหมาะสม'), 'เนื่องจากในแคนตาลูปยังไม่มีอัตราแนะนำเฉพาะ อัตราการใช้ที่เหมาะสม');
assert.strictEqual(removeSystemWords('อัตราการไหลในระบบน้ำหยด'), 'อัตราการไหลในระบบน้ำหยด');
assert.strictEqual(removeSystemWords('ในระบบของเรายังไม่มีข้อมูลการใช้กับฝรั่งค่ะ'), 'ยังไม่มีข้อมูลการใช้กับฝรั่งค่ะ');
// ความหมายทางเกษตรต้องอยู่ครบ
for (const keep of ['สารจะเคลื่อนที่ในระบบท่อน้ำของพืช', 'ออกฤทธิ์ในระบบประสาทของแมลง', 'สะสมในระบบรากได้ดี', 'ดูดซึมเข้าในระบบ ทำให้ออกฤทธิ์นาน', 'ใช้กับระบบน้ำหยดได้']) {
  assert.strictEqual(removeSystemWords(keep), keep, keep);
}
assert.strictEqual(removeSystemWords('ไม่มีคำนี้'), 'ไม่มีคำนี้');
assert.strictEqual(stripStaffCode('ME ชนาภัทร พลูหนัง (อ้อม)'), 'ชนาภัทร พลูหนัง (อ้อม)');
assert.strictEqual(stripStaffCode('MR ศตวรรษ (เจมส์)'), 'ศตวรรษ (เจมส์)');
assert.strictEqual(stripStaffCode('ษศกร (โลมา)'), 'ษศกร (โลมา)');
assert.strictEqual(stripStaffCode('MEGA ช็อป'), 'MEGA ช็อป');
console.log('PASS: customer text drops the internal word "ในระบบ" and ME/MR codes but keeps plant-system wording');

// v3.53: คำตอบจริงจากระบบจริง 28 ต.ค. (prod100 p052) มี "นิวเพน (ไม่มีรูป)" ซึ่งเป็นหมายเหตุในชื่อสินค้าของชีท
const { removeInternalNotes } = require('../customer_text');
assert.strictEqual(removeInternalNotes('สำหรับการคุมหญ้าก่อนงอกในพริก น้องลัดดาแนะนำ "นิวเพน (ไม่มีรูป)" และ "ออล์สตาร์" ค่ะ'),
  'สำหรับการคุมหญ้าก่อนงอกในพริก น้องลัดดาแนะนำ "นิวเพน" และ "ออล์สตาร์" ค่ะ');
assert.strictEqual(removeInternalNotes('1. นิวเพน (ไม่มีรูป)\n2. คริซ่า(ไม่มีรูป)'), '1. นิวเพน\n2. คริซ่า');
for (const keep of ['แผลมีขอบ (ไม่มีรูปร่างชัดเจน)', 'ยังไม่มีรูปสินค้านี้ค่ะ', 'ไม่มีคำนี้']) assert.strictEqual(removeInternalNotes(keep), keep, keep);
console.log('PASS: customer text drops the sheet note "(ไม่มีรูป)" from product names');

// v3.50: ข้อความยืนยันลงทะเบียนและหน้า LIFF ไม่มีรหัสเขตและ ME/MR (เดิม "ทีมงานดูแลพื้นที่ของคุณ (เขต A07): ME … · MR …")
const { zoneTeamRows, customerTeam, customerTeamText } = require('../customer_text');
const A07 = { zone: 'A07', team: 'ME ชนาภัทร พลูหนัง (อ้อม) 0612692590 · MR ศตวรรษ (เจมส์) 092-2478766 / ษศกร (โลมา)' };
assert.deepStrictEqual(zoneTeamRows(A07), [
  { name: 'ME ชนาภัทร พลูหนัง (อ้อม)', phone: '061-269-2590' },
  { name: 'MR ศตวรรษ (เจมส์)', phone: '092-247-8766' },
  { name: 'ษศกร (โลมา)', phone: '' }
]);
const team = customerTeam('นครศรีธรรมราช', A07);
assert.strictEqual(team.title, 'พนักงานขายที่ดูแล จ.นครศรีธรรมราช');
assert(!JSON.stringify(team).includes('A07') && !/\bM[ER]\b/.test(JSON.stringify(team)), 'ข้อมูลที่ส่งให้หน้า LIFF ต้องไม่มีรหัสเขตและ ME/MR');
const block = customerTeamText(team);
assert.strictEqual(block, '📍 พนักงานขายที่ดูแล จ.นครศรีธรรมราช\n• ชนาภัทร พลูหนัง (อ้อม) 061-269-2590\n• ศตวรรษ (เจมส์) 092-247-8766\n• ษศกร (โลมา)');
assert.strictEqual(customerTeam('', A07), null);
assert.strictEqual(customerTeam('กรุงเทพมหานคร', null), null);
assert.strictEqual(customerTeamText(null), '');
console.log('PASS: registration and LIFF team lists show "พนักงานขายที่ดูแล จ.<จังหวัด>" without zone codes or ME/MR');
