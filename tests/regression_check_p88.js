'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const prompt = fs.readFileSync(path.join(root, 'work', 'main_prompt_p88.txt'), 'utf8');
const dsl = fs.readFileSync(path.join(root, 'dify', 'app_b_hybrid_p88.yml'), 'utf8');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'regression_cases.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(cases.length >= 31, 'p88 ต้องมี regression อย่างน้อย 31 เคส แต่พบ ' + cases.length);
const byId = new Map(cases.map((c) => [c.id, c]));
for (const id of [25, 26, 27, 28, 29, 30, 31]) assert(byId.has(id), 'ขาด p88 case ' + id);

assert(prompt.includes('ผู้ช่วยแนะนำสินค้าและช่วยแก้ปัญหา'), 'p88 ไม่มี Product Assistant persona');
assert(prompt.includes('PRODUCT HELP'), 'p88 ไม่มี Product Help routing');
assert(prompt.includes('วิชาการอยู่เบื้องหลัง'), 'p88 ไม่มี science-background rule');
assert(prompt.includes('ถ้าถามว่า “ตัวไหนดี”'), 'p88 ไม่มี choose-a-direction rule');
assert(prompt.includes('ไม่แสดงแหล่งอ้างอิง ลิงก์ หรือ citation'), 'p88 ไม่มี visible-citation rule');
assert(prompt.includes('ดูแลเหมือนพี่สาวที่พร้อมช่วย'), 'p88 ไม่มี warm sister character');
assert(prompt.includes('ไม่ hard sell ไม่โฆษณาเกินจริง'), 'p88 ไม่มี no-hard-sell rule');
assert(prompt.includes('ถ้ายังไม่แน่ใจ ลองเช็กเพิ่มตรงนี้ก่อนนะคะ'), 'p88 ไม่มี caring customer language');
assert(prompt.includes('ถ้าถามกว้าง ให้คุยเหมือนเพื่อนคู่คิด'), 'p88 ไม่มี friend-like broad-question rule');
assert(prompt.includes('ไม่แสดงแหล่งอ้างอิง ลิงก์ หรือ citation'), 'p88 ยังไม่ได้ซ่อนแหล่งอ้างอิงจากลูกค้า');
assert(prompt.includes('marker เช่น [cite: 1]'), 'p88 ไม่มี citation-marker guard');
assert(!prompt.includes('ใส่แหล่งอ้างอิงท้ายคำตอบ'), 'p88 ยังสั่งให้แสดงแหล่งอ้างอิง');
for (const phrase of ['ตามหลักวิชาการ', 'สารดังกล่าวจัดอยู่ใน', 'จากข้อมูลทางวิชาการ']) {
  assert(prompt.includes(phrase), 'p88 ไม่มี academic phrase suppression: ' + phrase);
}
assert(!prompt.includes('คุณคือ “นักวิชาการเกษตร”'), 'p88 ยังมี persona เดิมที่ขัดกัน');

const persona = prompt.indexOf('ผู้ช่วยแนะนำสินค้าและช่วยแก้ปัญหา');
const product = prompt.indexOf('PRODUCT HELP');
const science = prompt.indexOf('วิชาการอยู่เบื้องหลัง');
assert(persona >= 0 && product > persona && science > product, 'ลำดับ persona/product/science ไม่ถูกต้อง');

assert(dsl.includes('p88 product-first LINE responses'), 'DSL ไม่ใช่ p88');
assert(dsl.includes('PRODUCT HELP'), 'DSL ไม่มี Product Help routing');
assert(dsl.includes('thinking_level: Low'), 'Main LLM settings ไม่คง thinking level ที่ตรวจแล้ว');
assert(!dsl.includes('max_tokens'), 'ห้ามใช้ max_tokens เป็นวิธีหลักของ p88');

for (const id of [25, 26, 27]) {
  const expected = byId.get(id).expected || {};
  assert(Number.isInteger(expected.max_sentences), 'case ' + id + ' ไม่มี max_sentences');
  assert(Number.isInteger(expected.max_chars), 'case ' + id + ' ไม่มี max_chars');
}
assert(byId.get(25).expected.forbid.includes('Xanthomonas citri'), 'case 25 ต้องกันชื่อละตินโดยค่าเริ่มต้น');
assert(byId.get(28).expected.allow_technical === true, 'case 28 ต้องเปิด technical detail เมื่อถามตรง ๆ');
for (const id of [29, 30, 31]) {
  const expected = byId.get(id).expected || {};
  assert(Number.isInteger(expected.max_sentences), 'case ' + id + ' ไม่มี max_sentences');
  assert(Number.isInteger(expected.max_chars), 'case ' + id + ' ไม่มี max_chars');
}

console.log('PASS: p88 character/product-first contract ' + cases.length + ' cases; persona, tone, response strategy and settings verified');
