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

assert(cases.length >= 42, 'p111 ต้องมี regression อย่างน้อย 42 เคส แต่พบ ' + cases.length);
const byId = new Map(cases.map((c) => [c.id, c]));
for (const id of [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]) assert(byId.has(id), 'ขาด p88 case ' + id);

assert(prompt.includes('ผู้ช่วยแนะนำสินค้าและช่วยแก้ปัญหา'), 'p88 ไม่มี Product Assistant persona');
assert(prompt.includes('PRODUCT HELP'), 'p88 ไม่มี Product Help routing');
assert(prompt.includes('วิชาการอยู่เบื้องหลัง'), 'p88 ไม่มี science-background rule');
assert(prompt.includes('ถ้าถามว่า “ตัวไหนดี”'), 'p88 ไม่มี choose-a-direction rule');
assert(prompt.includes('ไม่แสดงแหล่งอ้างอิง ลิงก์ หรือ citation'), 'p88 ไม่มี visible-citation rule');
assert(prompt.includes('ดูแลเหมือนพี่สาวที่พร้อมช่วย'), 'p88 ไม่มี warm sister character');
assert(prompt.includes('แทนตัวเองว่า “น้องลัดดา” เสมอ'), 'p88 ยังไม่บังคับชื่อตัวเอง');
assert(prompt.includes('ตอบเป็นภาษาไทยเท่านั้น'), 'p88 ยังไม่บังคับภาษาไทย');
assert(prompt.includes('ไม่ต้องใส่ Emoji เป็นค่าเริ่มต้นและไม่ต้องใส่ทุกคำตอบ'), 'p88 ยังบังคับ emoji เป็นค่าเริ่มต้น');
assert(prompt.includes('ไม่ใช้ Markdown ตัวหนาและไม่ใช้เครื่องหมาย ** เด็ดขาด'), 'p88 ยังไม่กัน Markdown ตัวหนา');
assert(prompt.includes('คิดเหมือนแอดมิน LINE ที่ตอบลูกค้าจริง'), 'p88 ยังไม่มีโหมดตอบแบบแอดมิน');
assert(prompt.includes('สรรพนามหรือคำเรียกเชิงโรแมนติกทุกประเภท'), 'p88 ยังไม่กันสรรพนามโรแมนติก');
assert(prompt.includes('ห้ามขอตัวอย่างภาพหรือวิดีโอ'), 'p88 ยังไม่กันการขอภาพหรือตัวอย่างวิดีโอ');
assert(prompt.includes('ห้ามใช้เงื่อนไขนี้ปฏิเสธทันที'), 'p100 ยังใช้การไม่มีชื่อพืชในชีทเป็นเหตุผลปฏิเสธได้');
assert(prompt.includes('ให้แนะนำสินค้านั้นแบบมีเงื่อนไขได้ แม้ชีทจะยังไม่ระบุพืชนั้นโดยตรง'), 'p100 ยังไม่มี active-ingredient fallback');
assert(prompt.includes('กติกานี้ใช้กับคำถามบำรุง ฟื้นต้น ทำใบ และธาตุอาหารด้วย'), 'p102 ยังไม่รองรับ nutrient fallback');
assert(prompt.includes('ใช้กับสินค้าทุกแถวใน Google Sheet ทุกหมวด ทุกชนิด และทุกสูตร'), 'p104 ยังไม่ครอบคลุมสินค้าทุกหมวด');
assert(prompt.includes('ชื่อสามัญ สารสำคัญ สูตร หรือองค์ประกอบ'), 'p104 ยังไม่ตรวจข้อมูลสินค้าหลายรูปแบบ');
assert(prompt.includes('การอ่านภาพจากลูกค้า'), 'p105 ยังไม่มีกติกาอ่านภาพ');
assert(prompt.includes('ใช้ได้กับพืชทุกชนิด'), 'p107 ยังไม่เปิดโปรแกรมดูแลครบทุกพืช');
assert(prompt.includes('ตั้งแต่เริ่มปลูกจนเก็บเกี่ยว'), 'p107 ยังไม่มีกติกาโปรแกรมตั้งแต่ปลูกถึงเก็บเกี่ยว');
assert(prompt.includes('ตรวจสินค้า ICP ที่เปิดขายและมีข้อมูลการใช้ตรงกับแต่ละช่วงให้ครบทุกตัว'), 'p107 ยังไม่ตรวจสินค้าครบทุกช่วงพืช');
assert(prompt.includes('ตรวจ “ข้าวดีด/ข้าวแดง” และวัชพืชในนาข้าวเป็นประเด็นแรก'), 'p108 ยังไม่กำหนดข้าวดีดเป็นประเด็นแรกของโปรแกรมข้าว');
assert(prompt.includes('ถ้าสถานะไม่ระบุชัดว่า “ขาย” “ขายได้แล้ว” “ขายแล้ว” “เปิดขายแล้ว” หรือ “พร้อมจำหน่าย” ให้ถือว่ายังไม่เปิด'), 'p109 ยังไม่กันสินค้าที่มีสถานะเดือนเปิดตัวและไม่รองรับสถานะขาย');
assert(prompt.includes('ก่อนแนะนำสินค้าทุกครั้ง ให้ตรวจตัวเลือกที่ตรงกับปัญหาจากลำดับ Strategy ภายในทีละลำดับ'), 'p111 ยังไม่กำหนด Strategy-first selection');
assert(prompt.includes('ห้ามข้ามสินค้าที่ตรงในลำดับสูงกว่าไปเลือกสินค้าลำดับต่ำกว่า'), 'p111 ยังไม่กันการข้ามลำดับ Strategy');
assert(dsl.includes('ข้าวดีด ข้าวแดง วัชพืชในนาข้าว ก่อนงอก หลังงอก ระยะพืช'), 'p108 retrieval ยังไม่ค้นข้าวดีดและข้าวแดง');
assert(dsl.includes('สินค้า ICP Ladda บำรุง ธาตุอาหาร สารเสริม'), 'p102 retrieval query ยังไม่ดึงสินค้าบำรุง');
assert(dsl.includes('สินค้า ICP Ladda รายการสินค้าทั้งหมด') && dsl.includes('สูตร องค์ประกอบ') && dsl.includes('จุดเด่น') && dsl.includes('ลำดับแนะนำภายใน'), 'p111 retrieval query ยังไม่ดึงลำดับ Strategy');
assert(prompt.includes('คำว่า “ยังไม่มีสินค้า ICP ที่ตรง” ใช้ได้เฉพาะเมื่อ'), 'p100 ยังไม่มีเงื่อนไขการปฏิเสธที่ชัดเจน');
assert(dsl.includes('สินค้า ICP') && dsl.includes('สารสำคัญ'), 'p100 retrieval query ยังไม่ดึงสินค้าโดยสารสำคัญ');
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
assert(byId.get(33).expected.max_sentences === 2, 'case 33 ต้องตอบไม่เกิน 2 ประโยค');
assert(byId.get(33).expected.max_chars === 220, 'case 33 ต้องมีงบ 220 ตัวอักษร');
assert(byId.get(34).expected.max_sentences === 3, 'case 34 ต้องตอบไม่เกิน 3 ประโยค');
assert(byId.get(34).expected.max_chars === 350, 'case 34 ต้องมีงบ 350 ตัวอักษร');

console.log('PASS: p88 character/product-first contract ' + cases.length + ' cases; persona, tone, response strategy and settings verified');
