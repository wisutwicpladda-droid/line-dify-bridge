'use strict';

const assert = require('assert');
const { buildText } = require('../kb_sync');

const master = [
  ['id', 'name', 'category', 'common', 'ai', 'moa', 'form', 'selling', 'absorb', 'mech', 'act', 'phyto', 'prec', 'strategy', 'status'],
  ['P1', 'สินค้าที่เปิดแล้ว', 'กำจัดวัชพืช', '', 'สาร A', '', '', '', '', '', '', '', '', 'Standard', 'ขายได้แล้ว'],
  ['P2', 'คริซ่า', 'กำจัดวัชพืช', '', 'Tricyclazole', '', '', '', '', '', '', '', '', 'Natural', 'เดือนธันวาคม']
];
const usage = [
  ['id', 'product_id', 'group', 'crop', 'crop2', 'target_type', 'target', 'stage', 'eq', 'method', 'how', 'rmin', 'rmax', 'unit', 'bval', 'bunit', 'cov', 'cunit', 'note', 'dnote'],
  ['U1', 'P1', '', 'ข้าว', '', 'วัชพืช', 'หญ้า', 'ก่อนงอก', 'คน', '', '', 1, 1, 'กรัม/ไร่', '', '', '', '', '', ''],
  ['U2', 'P2', '', 'ข้าว', '', 'วัชพืช', 'ข้าวดีด', 'ก่อนงอก', 'คน', '', '', 1, 1, 'กรัม/ไร่', '', '', '', '', '', '']
];
const packages = [['id', 'product_id', 'x', 'type', 'value', 'unit', 'note']];
const built = buildText(master, usage, packages);
assert.strictEqual(built.products, 1, 'KB ต้องสร้างบล็อกเฉพาะสินค้าที่เปิดขาย');
assert(built.text.includes('สินค้าที่เปิดแล้ว'), 'ต้องเก็บสินค้าที่เปิดขาย');
assert(!built.text.includes('คริซ่า'), 'KB ต้องไม่ใส่ชื่อสินค้าที่รอเปิด');
assert.strictEqual(built.status['คริซ่า'], 'เดือนธันวาคม', 'ต้องเก็บสถานะไว้ตรวจสอบภายใน');
console.log('PASS: KB build excludes products without explicit open-sale status');
