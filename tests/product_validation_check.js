'use strict';

const assert = require('assert');
const { validateProductData } = require('../product_validator');

const master = [
  ['id', 'name', 'category', 'common', 'active', 'moa', 'form', 'selling', '', '', '', '', '', 'strategy', 'status'],
  ['P001', 'สินค้าครบ', 'Herbicide', 'สารคุม', 'สาร A', '', 'EC', 'จุดเด่น', '', '', '', '', '', 'Expand', 'ขาย'],
  ['P002', 'สินค้ารอเปิด', 'Herbicide', 'สารคุม', 'สาร B', '', 'EC', 'จุดเด่น', '', '', '', '', '', 'Natural', 'เดือนสิงหาคม'],
  ['P003', 'สินค้าไม่มีข้อมูล', 'Herbicide', '', '', '', 'EC', '', '', '', '', '', '', '', 'ขาย']
];
const usage = [
  ['id', 'product_id', '', 'crop', 'crop2', 'target_type', 'target', 'stage', '', '', '', 'rate_min', 'rate_max'],
  ['U001', 'P001', '', 'นาข้าว', '', 'วัชพืช', 'หญ้า', '7-12 วัน', '', '', '', '50', '50']
];

const result = validateProductData(master, usage, { 'สินค้าครบ': 'complete.png' });
assert(!result.ok, 'สินค้าเปิดขายที่ไม่มีสาร/Strategy ต้องถูกตรวจพบ');
assert(result.errors.some((x) => x.includes('สินค้าไม่มีข้อมูล')), 'ต้องแจ้งข้อมูลสินค้าที่เปิดขายไม่ครบ');
assert(result.summary.products === 3 && result.summary.openProducts === 2, 'สรุปจำนวนสินค้าไม่ถูกต้อง');

console.log('PASS: product master validation checks identity, Strategy, status and usage completeness');
