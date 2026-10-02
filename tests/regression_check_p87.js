'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const prompt = fs.readFileSync(path.join(root, 'work', 'main_prompt_p87.txt'), 'utf8');
const dsl = fs.readFileSync(path.join(root, 'dify', 'app_b_hybrid_p87.yml'), 'utf8');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'regression_cases.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(cases.length >= 24, 'p87 ต้องมี regression อย่างน้อย 24 เคส แต่พบ ' + cases.length);
const byId = new Map(cases.map((c) => [c.id, c]));
for (const id of [20, 21, 22, 23, 24]) assert(byId.has(id), 'ขาด response-budget case ' + id);

assert(prompt.includes('งบความยาวของคำตอบ'), 'p87 ไม่มี response budget');
assert(prompt.includes('Progressive') || prompt.includes('ข้อมูลรอง'), 'p87 ไม่มี progressive disclosure');
assert(prompt.includes('ตอบเฉพาะงานของข้อความล่าสุด'), 'p87 ยังไม่บังคับ current-turn focus');
assert(prompt.includes('หนึ่งข้อความควรมีงานหลักเพียงหนึ่งอย่าง'), 'p87 ไม่มี one-turn-one-job');
assert(prompt.includes('โดยไม่ให้ citation กลบคำตอบ'), 'p87 ไม่มี citation budget');
assert(prompt.includes('ความปลอดภัยคน/สัตว์'), 'p87 ไม่มี safety override');
assert(dsl.includes('p87 concise progressive LINE responses'), 'DSL ไม่ใช่ p87');
assert(dsl.includes('งบความยาวของคำตอบ'), 'DSL ไม่มี response budget');
assert(dsl.includes('thinking_level: Low'), 'Main LLM settings ไม่คง thinking level ที่ตรวจแล้ว');
assert(!dsl.includes('max_tokens'), 'ห้ามใช้ max_tokens เป็นวิธีหลักของ p87');

for (const id of [20, 21, 23, 24]) {
  const expected = byId.get(id).expected || {};
  assert(Number.isInteger(expected.max_sentences), 'case ' + id + ' ไม่มี max_sentences');
  assert(Number.isInteger(expected.max_chars), 'case ' + id + ' ไม่มี max_chars');
}
assert(byId.get(22).expected && byId.get(22).expected.allow_longer === true, 'case 22 ต้องอนุญาตรายละเอียดเมื่อผู้ใช้ขอ');

console.log('PASS: p87 response-budget contract ' + cases.length + ' cases; prompt/DSL and completion settings verified');
