'use strict';

const assert = require('assert');
const { guardUnreleasedProducts, productRowsNotOpen } = require('../unreleased_guard');

const master = [
  ['id', 'name', '', '', '', '', '', '', '', '', '', '', '', '', 'status'],
  ['p-open', 'สินค้าที่เปิดแล้ว', '', '', '', '', '', '', '', '', '', '', '', '', 'ขายได้แล้ว'],
  ['p-future', 'คริซ่า', '', '', '', '', '', '', '', '', '', '', '', '', 'เดือนธันวาคม'],
  ['p-closed', 'สินค้าปิด', '', '', '', '', '', '', '', '', '', '', '', '', 'ปิด']
];

assert.deepStrictEqual(productRowsNotOpen(master), ['สินค้าปิด', 'คริซ่า'].sort((a, b) => b.length - a.length));
const answer = guardUnreleasedProducts('แนะนำ "คริซ่า" ได้ครับ\nถ้าต้องการตัวที่เปิดขายแล้ว ลองถามตามปัญหาได้เลย', master);
assert(!answer.includes('คริซ่า'), 'ห้ามชื่อสินค้าที่ยังไม่เปิดหลุดในคำตอบ');
assert(answer.includes('ตัวที่เปิดขายแล้ว'), 'ต้องคงคำแนะนำที่ปลอดภัยไว้');
const oneLine = guardUnreleasedProducts('คริซ่ามีสารสำคัญอะไร ใช้อัตราเท่าไร', master);
assert(!oneLine.includes('คริซ่า'), 'ห้ามเปิดเผยรายละเอียดสินค้าที่ยังไม่เปิด');
assert(oneLine.includes('เปิดจำหน่ายแล้ว'), 'ต้องมีคำตอบ fallback เมื่อทั้งบรรทัดเป็นสินค้าไม่เปิด');
console.log('PASS: unreleased product guard hides month-status and closed products');
