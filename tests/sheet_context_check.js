'use strict';

const assert = require('assert');
const { buildVerifiedUsageContext } = require('../sheet_context');

const master = [
  ['id', 'name', '', 'common', 'ai', 'moa', '', 'selling', '', '', '', 'phyto', 'precautions', '', 'status'],
  ['p-corn', 'ตัวคุมข้าวโพด', '', 'สารคุม', 'สาร A', 'กลุ่ม 1', '', 'จุดเด่น', '', '', '', '', '', '', 'ขายได้แล้ว'],
  ['p-rice', 'ตัวคุมนาข้าว', '', 'สารคุม', 'สาร B', 'กลุ่ม 2', '', 'จุดเด่น', '', '', '', '', '', '', 'ขายได้แล้ว'],
  ['p-closed', 'สินค้าปิด', '', 'สารคุม', 'สาร C', 'กลุ่ม 3', '', 'จุดเด่น', '', '', '', '', '', '', 'ปิด'],
];

const usage = [
  ['id', 'product_id', '', 'crop', 'crop2', 'target_type', 'target', 'stage'],
  ['u1', 'p-corn', '', 'ข้าวโพด', '', 'วัชพืช', 'วัชพืชก่อนงอก', 'ก่อนปลูก/เริ่มงอก'],
  ['u2', 'p-corn', '', 'ข้าวโพด', '', 'แมลง', 'หนอน', 'เจริญเติบโต'],
  ['u3', 'p-corn', '', 'ข้าวโพด', '', 'โรค', 'โรคใบ', 'ออกดอก/สร้างฝัก'],
  ['u4', 'p-rice', '', 'ข้าว', '', 'วัชพืช', 'หญ้า', 'หลังงอก'],
  ['u5', 'p-closed', '', 'ข้าวโพด', '', 'แมลง', 'หนอน', 'ก่อนเก็บเกี่ยว'],
];

const result = buildVerifiedUsageContext('ขอโปรแกรมดูแลข้าวโพดตั้งแต่เริ่มปลูกจนเก็บเกี่ยว', master, usage, { 'ตัวคุมข้าวโพด': 1 });
assert(result.includes('ตัวคุมข้าวโพด'), 'ต้องแนบสินค้าของพืชที่ถาม');
assert(result.includes('ก่อนปลูก/เริ่มงอก'), 'ต้องแนบช่วงเริ่มต้น');
assert(result.includes('เจริญเติบโต'), 'ต้องแนบช่วงเจริญเติบโต');
assert(result.includes('ออกดอก/สร้างฝัก'), 'ต้องแนบช่วงออกดอกหรือสร้างผล');
assert(!result.includes('ตัวคุมนาข้าว'), 'ห้ามดึงข้อมูลของพืชอื่น');
assert(!result.includes('สินค้าปิด'), 'ห้ามดึงสินค้าที่ปิด');

console.log('PASS: lifecycle sheet context includes all verified crop stages and open products');
