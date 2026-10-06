'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PHONE_RX, leadInterest, shouldSend, buildCard, cleanName, teamLines } = require('../leads');

const now = Date.parse('2026-10-06T00:26:14Z');
const names = ['แกนเตอร์', 'โมเดิน 50', 'ไบเตอร์'];
const productsOf = (t) => names.filter((n) => t.includes(n));
const h = (r, t, minsAgo) => ({ r, t, at: now - minsAgo * 60000 });

// เคสจริง 6 ต.ค.: ขอชื่อพนักงาน -> ลพบุรี -> บ้านหมี่ + เบอร์
const hist = [
  h('u', 'ถ้าช่วงทุเรียนทำใบใช้อะไรดีสุดครับ', 60),
  h('b', 'ช่วงทำใบ แนะนำ "โมเดิน 50" หรือ "ไบเตอร์" ค่ะ', 59),
  h('u', 'ขอชิิอพนักงานในพ้นที่', 3),
  h('b', 'ไม่ทราบว่าแปลงอยู่จังหวัดใดคะ', 3),
  h('u', 'ลพบุรีครับ', 1),
  h('u', 'บ้านหมี่ครับ 0659897781', 0),
];
const info = leadInterest(hist, productsOf, now);
assert.strictEqual(info.interested, true);
assert.strictEqual(info.keyword, true);
assert.deepStrictEqual(info.products, ['โมเดิน 50', 'ไบเตอร์']);
assert.strictEqual(info.questions[info.questions.length - 1], 'บ้านหมี่ครับ 0659897781');
assert.strictEqual(PHONE_RX.exec('บ้านหมี่ครับ 0659897781')[0], '0659897781');

// ทิ้งเบอร์แต่ไม่มีบริบทซื้อหรือสินค้า -> ไม่ส่งเข้ากลุ่ม
const plain = leadInterest([h('u', 'สวัสดีครับ', 2), h('u', '0812345678', 0)], productsOf, now);
assert.strictEqual(plain.interested, false);

// ข้อความเก่ากว่า 48 ชม. ไม่นับ
const old = leadInterest([h('u', 'อยากซื้อแกนเตอร์', 60 * 50), h('u', '0812345678', 0)], productsOf, now);
assert.strictEqual(old.interested, false);

// กันส่งซ้ำ: เบอร์เดิมภายใน 24 ชม. ไม่ส่ง, เบอร์ใหม่ส่ง, เกิน 24 ชม. ส่งได้
assert.strictEqual(shouldSend({}, '0659897781', now), true);
assert.strictEqual(shouldSend({ lead: { phone: '0659897781', at: now - 3600000 } }, '0659897781', now), false);
assert.strictEqual(shouldSend({ lead: { phone: '0659897781', at: now - 3600000 } }, '0811111111', now), true);
assert.strictEqual(shouldSend({ lead: { phone: '0659897781', at: now - 25 * 3600000 } }, '0659897781', now), true);

const card = buildCard({ name: 'สมชาย', phone: '0659897781', phoneNote: 'บ้านหมี่ครับ', province: 'ลพบุรี', zone: 'A05',
  crops: 'ทุเรียน', products: info.products, questions: info.questions, promised: true,
  team: 'ME สุกัญญา (เล็ก) 065-5255687 · MR อัฐภิญญา (แพน) 080-0430967', at: now, adminUrl: 'https://example/admin' });
for (const part of ['• โทร: 0659897781', '• จังหวัด: จ.ลพบุรี (เขต A05)', '🧴 สินค้าที่คุยถึง\n• โมเดิน 50\n• ไบเตอร์',
  '4. บ้านหมี่ครับ 0659897781', '• ME สุกัญญา (เล็ก) 065-5255687\n• MR อัฐภิญญา (แพน) 080-0430967', '06/10 07:26 น.', 'บอทแจ้งลูกค้าแล้ว']) {
  assert(card.includes(part), 'การ์ดเคสขาด: ' + part);
}
assert(!card.includes('ข้อความตอนให้เบอร์'), 'ข้อความตอนให้เบอร์ซ้ำกับข้อความล่าสุด');
assert(!card.includes('ในแชทลูกค้าพิมพ์ว่าอยู่'), 'จังหวัดเดียวกันไม่ต้องแสดงซ้ำ');

// ทีมเขตแยกคนละบรรทัด, MR หลายคนได้ role ทุกคน
assert.deepStrictEqual(teamLines('ME ก (เมย์) 063-1 · MR ข (น้ำหวาน) 063-2 / ค (ไตเติ้ล) 063-3'),
  ['ME ก (เมย์) 063-1', 'MR ข (น้ำหวาน) 063-2', 'MR ค (ไตเติ้ล) 063-3']);
// ชื่อที่ encoding เสีย (U+FFFD) ใช้ชื่อ LINE แทน
assert.strictEqual(cleanName('วิส\uFFFD\uFFFDธิ์', '…', 'Wisut'), 'Wisut');
// จังหวัดในแชทต่างจากจังหวัดที่ลงทะเบียน -> แสดงทั้งสองอย่าง
const moved = buildCard({ name: 'ก', phone: '0812345678', province: 'ชุมพร', zone: 'A06', chatProvince: 'ลพบุรี', chatZone: 'A05', at: now });
assert(moved.includes('• จังหวัด: จ.ชุมพร (เขต A06)\n• ในแชทลูกค้าพิมพ์ว่าอยู่: จ.ลพบุรี (เขต A05)'), 'ไม่แสดงจังหวัดจากแชท');
assert(moved.includes('ยังไม่ทราบเขต'), 'ไม่มีทีม ต้องบอกให้แอดมินกระจายเคส');

// server.js: ส่งเคสหลังอัปเดต CRM, เงียบในกลุ่มรับเคส, log groupId ตอน OA เข้ากลุ่ม, จำสถานะส่งแล้วข้ามการ restart
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert(server.includes('maybeSendLead(sessionId, s, leadPhone[0])'), 'ยังไม่ส่งเคสเมื่อลูกค้าทิ้งเบอร์');
assert(server.includes('LEAD_TARGETS.includes(pushTarget)'), 'บอทยังตอบแชทในกลุ่มรับเคส');
assert(server.includes("ev.type === 'join'"), 'ยังไม่ log groupId ตอน OA เข้ากลุ่ม');
assert(server.includes('lead: (s.lead && typeof s.lead'), 'สถานะเคสที่ส่งแล้วยังหายหลัง restart');
assert(server.includes('linePush(to, card, LEAD_LINE_TOKEN)'), 'การ์ดเคสยังไม่ส่งผ่าน OA แจ้งเตือนแยก');
assert(server.includes('leads.cleanName(c.real_name, s.name, c.display_name)'), 'ชื่อลูกค้าที่ encoding เสียยังหลุดเข้าการ์ด');

console.log('PASS: sales lead cards — interest detection, 48h window, 24h dedup, card fields, group silence');
