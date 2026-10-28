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

// v3.50 (28 Oct 2026): ตรวจเนื้อหาที่เคยหลุดถึงลูกค้า -> notices
const longA = 'ช่วยแก้ไขปัญหาข้าวออกรวงไม่สม่ำเสมอ เนื่องจากอากาศหนาวจัด ช่วยสร้างเกสร';
const longB = 'ออกฤทธิ์แบบดูดซึม เคลื่อนที่ไปตามท่อน้ำท่ออาหาร ยับยั้งการสร้างผนังเซลล์';
const longC = 'กระตุ้นการแตกกอและสร้างรากใหม่ ใช้ได้ทุกระยะของข้าว ฟื้นต้นหลังเครียด';
const phyto = 'มีความเสี่ยงต่อความเป็นพิษ อ้อยพันธุ์ขอนแก่น 3 ควรระวังการพ่นช่วงอ้อยเล็ก';
const m2 = [
  master[0],
  ['P010', 'ชุดเขียว ', 'Biostimulants', 'สาหร่าย', 'SEAWEED EXTRACT 50% + PROTEIN HYDROLYSATE 40%', 'Biostimulants', '', longA, '', longB, longC, '', '', 'Natural', 'ขาย'],
  ['P011', 'ชุดทอง\r', 'Biostimulants', 'เดกซ์โทรส', 'DEXTROSE MONOHYDRATE 20% + PROTEIN HYDROLYSATE 40%', 'Biostimulants', '', longA, '', longB, longC, '', '', 'Natural', 'ขาย'],
  ['P012', 'ยาหญ้า ก', 'Herbicide', 'อะทราซีน 90% WG', 'ATRAZINE 90% WG', 'C1', '', 'สููตรเม็ดละลายง่าย', '', 'C1 : PSII', 'กลไกการออกฤทธิ์: อะมีทรีนยับยั้งการสังเคราะห์แสง', phyto, '', 'Expand', 'ขาย'],
  ['P013', 'ยาหญ้า ข', 'Herbicide', 'อะมีทริน 80% WG', 'AMETRYN 80% WG', 'C1', '', 'ปลอดภัยต่ออ้อยมากกว่าสารกลุ่มอะทราซีน', '', 'C1 : PSII', 'กลไกการออกฤทธิ์: อะมีทรีนยับยั้งการสังเคราะห์แสง', phyto, '', 'Expand', 'ขาย'],
  ['P014', 'ยารา ค', 'Fungicide', 'ฟอสอีทิล-อะลูมิเนียม 80% WG', 'FOSETYL-ALUMINIUM 80% WG', '33', '', 'ป้องกันรากเน่าโคนเน่า', '', '33', 'ดูดซึมขึ้นลง', phyto, '', 'Natural', 'ขาย'],
  ['P015', 'ยาแมลง ง', 'Insecticide', 'พิริมิฟอส-เมทิล 50% EC', 'PIRIMIPHOS-METHYL 50% EC', '1B', '', 'กำจัดแมลงได้หลายชนิด', '', '1B', 'สัมผัสตาย', '', '', 'Standard', 'ขาย']
];
const u2 = [
  usage[0],
  ['U010', 'P015', '', 'นาข้าว', 'นาหว่านแห้ง', 'แมลง', 'เพลี้ยแป้ง ด้วงงวงข้าว และแมลงในบ้านเรือนหรืออาคารสถานที่ เช่น ยุง แมลงสาบ', 'ทุกระยะ', '', '', '', '20', '30'],
  ['U011', 'P015', '', 'ไม้ผล', 'มะม่วง', 'แมลง', 'เพลี้ยแป้ง ยุง', 'ทุกระยะ', '', '', '', '20', '30'],
  ['U012', 'P012', '', 'พืชไร่', 'อ้อย', 'วัชพืช', 'เพลี้ี้ยไฟ', 'ทุกระยะ', '', '', '', '20', '30'],
  ['U013', 'P013', '', 'พืชไร่', 'หอมแบ่ง', 'แมลง', 'หนอนแมลงวันชอนใบ', 'ทุกระยะ', '', '', '', '20', '30']
];
const n = validateProductData(m2, u2, {}).notices;
const has = (prefix) => n.some((x) => x.key.startsWith(prefix));
const line = (prefix) => (n.find((x) => x.key.startsWith(prefix)) || {}).line || '';
assert(has('name-space:P010') && has('name-space:P011'), 'ชื่อสินค้าที่มีช่องว่างหรือตัวขึ้นบรรทัดเกินต้องถูกแจ้ง');
assert(line('name-space:P011').includes('"ชุดทอง"'), 'ข้อความแจ้งต้องแสดงชื่อที่ตัดช่องว่างแล้ว');
assert(has('dup-copy:P010,P011'), 'ข้อความจุดเด่น/กลไก/ลักษณะการออกฤทธิ์ที่ซ้ำกันทั้งชุดระหว่างสินค้าคนละสารต้องถูกแจ้ง');
assert(!has('dup-copy:P012,P013'), 'สินค้ากลุ่มกลไกเดียวกัน (รหัสสารจริง) ใช้คำอธิบายร่วมกันได้');
assert(line('dup-category:11').startsWith('ยารา ค (Fungicide)'), 'ข้อความเดียวกันระหว่างสินค้าคนละประเภทต้องชี้ตัวที่ต่างประเภท: ' + line('dup-category:11'));
assert(has('foreign-ai:P012:10') && line('foreign-ai:P012:10').includes('อะมีทริน'), 'ยาอะทราซีนที่เขียนว่าอะมีทรีนต้องถูกแจ้ง');
assert(!has('foreign-ai:P013'), 'การเทียบกับสารอื่น ("มากกว่าสารกลุ่มอะทราซีน") และสารของตัวเองไม่นับ');
assert(has('thai:P012:7') && has('thai:U012:target'), 'คำสะกดผิดแบบสระซ้อน (สููตร, เพลี้ี้ย) ต้องถูกแจ้ง');
assert(has('household:P015') && line('household:P015').includes('นาหว่านแห้ง, มะม่วง'), 'แมลงในบ้านในแถวพืชต้องถูกแจ้งรวมต่อสินค้า');
assert(!has('household:P013'), 'หนอนแมลงวันชอนใบเป็นศัตรูพืช ไม่ใช่แมลงในบ้าน');
assert(validateProductData(m2, u2, {}).errors.every((x) => /ไม่มีข้อมูลพืช/.test(x)), 'notices ต้องไม่กลายเป็น error (error ที่เหลือคือสินค้าทดสอบที่ไม่มีแถววิธีใช้)');
assert.deepStrictEqual(validateProductData(master, usage, { 'สินค้าครบ': 'complete.png' }).notices, [], 'ข้อมูลปกติต้องไม่มี notice');

console.log('PASS: product master validation checks identity, Strategy, status, usage completeness and copied/misspelled content');
