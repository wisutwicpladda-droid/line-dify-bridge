'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const prompt = fs.readFileSync(path.join(root, 'work', 'main_prompt_p88.txt'), 'utf8');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'line_qa_cases.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const id of ['LINE-01', 'LINE-02', 'LINE-03', 'LINE-04', 'LINE-05']) {
  assert(cases.some((item) => item.id === id), 'ขาดเคส LINE QA: ' + id);
}
assert(bridge.includes('uploadLineImageToDify'), 'LINE QA ต้องผ่านเส้นทางอัปโหลดภาพจริง');
assert(bridge.includes('ภาพสวัสดี คำอวยพร วันในสัปดาห์ มีม หรือภาพแชร์ทั่วไป'), 'LINE image route ยังไม่แยกภาพสวัสดี');
assert(prompt.includes('ตรวจตัวเลือกที่ตรงกับปัญหาจากลำดับ Strategy ภายในทีละลำดับ'), 'LINE QA ยังไม่มี Strategy-first rule');
assert(prompt.includes('สินค้าที่ระบุว่ายังไม่เปิด รอเปิด ปิด หรือไม่พร้อมจำหน่าย ห้ามแนะนำ'), 'LINE QA ยังไม่มีกติกาสินค้ายังไม่เปิด');
assert(prompt.includes('ถ้าถามสินค้าคู่แข่ง ให้ค้นชื่อสินค้านั้นก่อนเพื่อยืนยันสูตร'), 'LINE QA ยังไม่มี competitor verification rule');
assert(prompt.includes('ถามอายุหรือระยะพืชก่อนเลือกสินค้าตัวสุดท้าย'), 'LINE QA ยังไม่มี plant-age gate');

console.log('PASS: LINE QA fixture covers rice weeds, Strategy ordering, unreleased products, competitor comparison and greeting images');
