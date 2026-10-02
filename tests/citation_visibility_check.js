'use strict';

const { stripVisibleCitations } = require('../citation_visibility');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cases = [
  {
    input: 'อาการนี้อาจเกิดจากเพลี้ยไฟค่ะ [cite: 1]',
    expected: 'อาการนี้อาจเกิดจากเพลี้ยไฟค่ะ'
  },
  {
    input: 'ควรสำรวจใต้ใบก่อนนะคะ\n\nแหล่งอ้างอิง:\n- กรมส่งเสริมการเกษตร: https://example.org/source',
    expected: 'ควรสำรวจใต้ใบก่อนนะคะ'
  },
  {
    input: 'ข้อมูลเพิ่มเติม [citation 1] และ [cite: 2, 3] ค่ะ',
    expected: 'ข้อมูลเพิ่มเติม และ ค่ะ'
  },
  {
    input: 'คำตอบปกติ ไม่มี citation และไม่มีลิงก์ค่ะ',
    expected: 'คำตอบปกติ ไม่มี citation และไม่มีลิงก์ค่ะ'
  }
];

for (const c of cases) assert(stripVisibleCitations(c.input) === c.expected, `ผลลัพธ์ไม่ตรง: ${c.input}`);
for (const c of cases) {
  const output = stripVisibleCitations(c.input);
  assert(!/\[\s*(?:cite|citation)\b|แหล่งอ้างอิง|https?:\/\//i.test(output), `ยังมี citation หลุด: ${output}`);
}

console.log(`PASS: citation visibility guard ${cases.length} cases`);
