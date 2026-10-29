'use strict';

// v3.55 (29 Oct 2026): ค่าใช้จ่าย AI สำหรับหน้า 💰 ในเว็บแอดมิน (cost.js)
// ราคาตั้งต้น gemini-3.8-flash: ขาเข้า $0.75 ขาออก $3.75 ต่อ 1 ล้าน token ถึง 31 ธ.ค. 2569 แล้วเป็น 2 เท่า
const assert = require('assert');
const { createCost } = require('../cost');

const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-7, (msg || 'value') + ': got ' + a + ', want ' + b);
const llm = (title, inTok, outTok, extra) => Object.assign({ title, type: 'llm', status: 'succeeded', model: 'gemini-3.8-flash', inTok, outTok, tokens: inTok + outTok, difyUsd: 0, extraUsd: 0 }, extra || {});
const http = (title, status, extra) => Object.assign({ title, type: 'http-request', status: status || 'succeeded', model: '', inTok: 0, outTok: 0, tokens: 0, difyUsd: 0, extraUsd: 0 }, extra || {});

let clock = Date.parse('2026-10-29T03:00:00Z'); // 10:00 เวลาไทย
const c = createCost({ now: () => clock, env: {} });

// 1) คำถามข้อความ: Jev + โหนดดึงชีท (ไม่มีค่าใช้จ่าย) + Gemini 3 ขั้น
let rec = c.record({ sid: 'Uaaa', kind: 'text', q: 'หนอนกินใบข้าวโพด   ใช้ยาอะไรดี', nodes: [
  http('Jev (OpenRouter)'),
  http('อ่าน Google Sheets สินค้า/วิธีใช้'),
  llm('Gemini วิเคราะห์บริบทและคำค้น', 3000, 600),
  llm('Gemini คัดสินค้าจาก KB + ชีท', 30000, 2000, { tokens: 34000 }), // token คิด (thinking) 2,000 ไม่ได้รวมใน completion
  llm('Gemini สรุปคำตอบ', 16000, 3000, { model: '' }) // Dify ไม่บอกชื่อโมเดล ใช้ราคาโมเดลหลัก
] });
// วิเคราะห์ 0.00225+0.00225 · คัดสินค้า 0.0225+0.015 (ขาออก 4,000) · สรุป 0.012+0.01125 · Jev 0.00007
near(rec.u, 0.0045 + 0.0375 + 0.02325 + 0.00007, 'text turn USD');
assert.strictEqual(rec.it.length, 4, 'โหนดดึงชีทไม่มีค่าใช้จ่าย ต้องไม่อยู่ในรายการ');
assert.strictEqual(rec.it.find((i) => /คัดสินค้า/.test(i.n)).o, 4000, 'token ที่ใช้คิดต้องนับเป็นขาออก');
assert.strictEqual(rec.q, 'หนอนกินใบข้าวโพด ใช้ยาอะไรดี');
assert.strictEqual(rec.s, 0);

// 2) รูป + ค้นเว็บ และ Dify ลองใหม่ (โหนดเดียวกันรัน 2 ครั้ง คิดเงินทั้ง 2 ครั้ง)
clock += 3600000;
rec = c.record({ sid: 'Ubbb', kind: 'image', q: '', nodes: [
  llm('External Search (Gemini + Google Search)', 20000, 4000),
  llm('Gemini สรุปคำตอบ', 10000, 2000),
  llm('Gemini สรุปคำตอบ', 10000, 2000)
] });
near(rec.u, 0.03 + 0.03, 'image turn USD');
assert.strictEqual(rec.s, 1, 'ขั้นค้นเว็บต้องนับ 1 ครั้ง');
assert.strictEqual(rec.it.find((i) => /สรุป/.test(i.n)).r, 2);
assert.strictEqual(rec.it.find((i) => /External/.test(i.n)).c, 'search');

// 3) เสียง: ถอดเสียงนับแยก (ไม่นับเป็นคำตอบ) แล้วคำตอบรอบนั้นมีค่าอ่านเสียง
const stt = c.record({ sid: 'Uccc', kind: 'voice', turn: false, stt: { sec: 4, credits: '1' } });
near(stt.u, 4 / 3600 * 0.22, 'STT USD');
assert.strictEqual(stt.n, 0);
rec = c.record({ sid: 'Uccc', kind: 'voice', q: 'แกนเตอร์ใช้ยังไง', nodes: [llm('Gemini สรุปคำตอบ', 10000, 2000)], tts: { chars: 500, credits: '500' } });
near(rec.u, 0.015 + 0.04, 'voice turn USD (Gemini + TTS 500 ตัวอักษร)');

// 4) ไม่มีรายโหนด ใช้ยอดรวมจาก message_end · มีรายโหนดแล้วไม่นับยอดรวมซ้ำ
rec = c.record({ sid: 'Uddd', kind: 'text', q: 'สวัสดีค่ะ', nodes: [], message: { inTok: 1000, outTok: 100, tokens: 1100, difyUsd: 0.5 } });
assert.strictEqual(rec.it[0].n, 'Dify (รวมทุกขั้น)');
near(rec.u, 0.001125, 'message usage priced by tokens');
rec = c.record({ sid: 'Uddd', kind: 'text', q: 'ขอบคุณค่ะ', nodes: [llm('คำตอบสั้น', 1000, 100)], message: { inTok: 1000, outTok: 100, tokens: 1100 } });
assert.strictEqual(rec.it.length, 1, 'ยอดรวมของข้อความต้องไม่นับซ้ำกับรายโหนด');

// 5) ไม่มีค่าใช้จ่ายเลย = ไม่บันทึก · Jev ที่ล้มไม่คิดเงิน · API ที่บอกราคามาเองใช้ราคานั้น · โมเดลที่ไม่มีในตารางใช้ราคาของ Dify
assert.strictEqual(c.record({ sid: 'Ueee', kind: 'text', nodes: [http('อ่าน Google Sheets สินค้า/วิธีใช้')] }), null);
assert.strictEqual(c.record({ sid: 'Ueee', kind: 'text', nodes: [http('Jev (OpenRouter)', 'exception')] }), null);
rec = c.record({ sid: 'Ueee', kind: 'text', q: 'ทดสอบราคา API', nodes: [http('Jev (OpenRouter)', 'succeeded', { extraUsd: 0.0002 })] });
near(rec.u, 0.0002, 'OpenRouter usage.cost');
rec = c.record({ sid: 'Ueee', kind: 'text', q: 'ค้นข้อมูล', nodes: [{ title: 'ค้น KB', type: 'knowledge-retrieval', status: 'succeeded', model: 'text-embedding-3-large', inTok: 0, outTok: 0, tokens: 60, difyUsd: 0.0000078 }] });
assert.strictEqual(rec.it[0].c, 'kb');
near(rec.u, 0.0000078, 'Dify price for a model outside the price table');

// 6) สรุปวันนี้: นับเฉพาะคำตอบ (ถอดเสียงไม่นับ) รวมเงินทุกอย่าง
const names = { Uaaa: 'สมชาย', Ubbb: 'สมหญิง' };
let s = c.summary({ nameOf: (id) => names[id] || '', hasChat: (id) => id !== 'Ueee' });
assert.strictEqual(s.today.day, '2026-10-29');
assert.strictEqual(s.today.turns, 7);
const totalUsd = 0.06532 + 0.06 + 4 / 3600 * 0.22 + 0.055 + 0.001125 + 0.001125 + 0.0002 + 0.0000078;
near(s.today.usd, totalUsd, 'today USD');
assert.strictEqual(s.today.thb, Math.round(totalUsd * 33.8 * 100) / 100);
assert.strictEqual(s.today.perMsg, Math.round(totalUsd * 33.8 / 7 * 100) / 100);
assert.deepStrictEqual([s.last7.turns, s.last30.turns, s.month.turns, s.month.key, s.prevMonth.turns], [7, 7, 7, '2026-10', 0]);
assert.strictEqual(s.projection, null, 'ยังไม่มีวันที่นับครบทั้งวัน');
assert.deepStrictEqual(Object.keys(s.byKind), ['text', 'image', 'voice']);
assert.deepStrictEqual([s.byKind.text.turns, s.byKind.image.turns, s.byKind.voice.turns], [5, 1, 1]);
assert.strictEqual(s.byKind.voice.thb, Math.round((0.055 + 4 / 3600 * 0.22) * 33.8 * 100) / 100, 'ค่าถอดเสียงรวมอยู่ในข้อความเสียง');
assert.strictEqual(s.items[0].label, 'Gemini สรุปคำตอบ', 'ขั้นที่ใช้เงินมากที่สุดต้องอยู่บนสุด');
assert.strictEqual(s.items[0].runs, 4);
assert.strictEqual(s.items[0].avgIn, 11500);
const shares = s.items.reduce((a, i) => a + i.share, 0);
assert(Math.abs(shares - 100) < 1, 'สัดส่วนรวมต้องประมาณ 100%: ' + shares);
assert(s.items.some((i) => i.label === 'ElevenLabs ถอดข้อความเสียง' && i.avgSec === 4 && i.credits === 1));
assert(s.items.some((i) => i.label === 'ElevenLabs อ่านคำตอบเป็นเสียง' && i.avgChars === 500 && i.credits === 500));
assert.strictEqual(s.search.month, 1);
assert.strictEqual(s.search.overThb, 0);
assert.strictEqual(s.daily.length, 30);
assert.strictEqual(s.daily[29].day, '2026-10-29');
assert(s.daily[29].groups.search > 0 && s.daily[29].groups.voice > 0 && s.daily[29].groups.ai > 0 && s.daily[29].groups.other > 0);
assert.strictEqual(s.topTurns[0].sid, 'Uaaa');
assert.strictEqual(s.topTurns[0].name, 'สมชาย');
assert.strictEqual(s.topTurns[0].steps[0].label, 'Gemini คัดสินค้าจาก KB + ชีท');
assert.strictEqual(s.topTurns[1].search, true);
assert.strictEqual(s.topTurns.find((x) => x.sid === 'Ueee').chat, false, 'แชทที่ไม่มีในระบบกดเปิดไม่ได้');
assert.strictEqual(s.topChats[0].sid, 'Uaaa');
assert.strictEqual(s.topChats.find((x) => x.sid === 'Uccc').turns, 1, 'ถอดเสียงไม่นับเป็นข้อความของแชท');
assert.strictEqual(s.prices.models[0].next.from, '2027-01-01');

// 7) เก็บลงไฟล์ state แล้วโหลดคืนได้ครบ ค่าที่เสียหรือผิดรูปแบบต้องไม่ล้างข้อมูลเดิม
const c2 = createCost({ now: () => clock, env: {} });
assert.strictEqual(c2.load(JSON.parse(JSON.stringify(c.dump()))), true);
assert.deepStrictEqual(c2.summary({ nameOf: (id) => names[id] || '', hasChat: (id) => id !== 'Ueee' }), s);
assert.strictEqual(c2.load({ v: 9 }), false);
assert.strictEqual(c2.load('broken'), false);
assert.strictEqual(c2.summary().today.turns, 7);

// 8) ราคาตามวันที่บันทึก (เวลาไทย): 23:30 คืนวันที่ 31 ธ.ค. 2569 ราคาเดิม 00:30 วันที่ 1 ม.ค. 2570 ราคาใหม่
let t3 = Date.parse('2026-12-31T16:30:00Z');
const c3 = createCost({ now: () => t3, env: {} });
near(c3.record({ sid: 'U1', nodes: [llm('Gemini สรุปคำตอบ', 1000000, 0)] }).u, 0.75, 'old price');
t3 = Date.parse('2026-12-31T17:30:00Z');
near(c3.record({ sid: 'U1', nodes: [llm('Gemini สรุปคำตอบ', 1000000, 0)] }).u, 1.5, 'new price from 1 Jan 2027');
assert.strictEqual(c3.summary().month.key, '2027-01');
assert.strictEqual(c3.summary().prevMonth.turns, 1);

// 9) ประมาณการต่อเดือนจากวันที่นับครบทั้งวัน (ไม่รวมวันแรกและวันนี้) และยอดเมื่อราคาใหม่มีผล
let t4 = Date.parse('2026-10-20T03:00:00Z');
const c4 = createCost({ now: () => t4, env: {} });
for (let d = 0; d < 5; d++) { c4.record({ sid: 'U' + d, nodes: [llm('Gemini สรุปคำตอบ', 100000, 20000)] }); t4 += 86400000; } // วันละ $0.15 วันที่ 20-24
s = c4.summary(); // วันที่ 25 · วันเต็มคือ 21-24
assert.strictEqual(s.projection.days, 4);
assert.strictEqual(s.projection.perDay, Math.round(0.15 * 33.8 * 100) / 100);
assert.strictEqual(s.projection.month, Math.round(0.15 * 30 * 33.8 * 100) / 100);
assert.strictEqual(s.projection.next.from, '2027-01-01');
assert.strictEqual(s.projection.next.month, Math.round(0.3 * 30 * 33.8 * 100) / 100, 'ราคาใหม่ 2 เท่า');

// 10) ค่าใน Railway: อัตราแลกเปลี่ยน ราคาที่แก้เอง โควตาค้นเว็บ และ JSON ที่อ่านไม่ได้
const c5 = createCost({ now: () => clock, env: { COST_USD_THB: '35', COST_PRICES: '{"models":{"gemini-3.8-flash":[{"in":1,"out":2}]},"searchFreePerMonth":1,"ttsUsdPer1kChars":0.1}' } });
assert.strictEqual(c5.error, '');
near(c5.record({ sid: 'U1', kind: 'voice', nodes: [llm('Gemini สรุปคำตอบ', 1000000, 1000000)], tts: { chars: 1000 } }).u, 3.1, 'custom prices');
c5.record({ sid: 'U1', nodes: [llm('External Search (Gemini + Google Search)', 10, 10)] });
c5.record({ sid: 'U1', nodes: [llm('External Search (Gemini + Google Search)', 10, 10)] });
s = c5.summary();
assert.strictEqual(s.search.month, 2);
assert.strictEqual(s.search.overThb, Math.round(0.014 * 35 * 100) / 100, 'ค้นเว็บเกินโควตาฟรี 1 ครั้ง');
near(s.month.usd, 3.1 + 2 * (10 + 20) / 1e6 + 0.014, 'month total includes the search overage');
assert.strictEqual(s.prices.usdThb, 35);
assert.strictEqual(s.prices.models[0].next, null, 'ราคาที่แก้เองไม่มีราคาถัดไป');
const c6 = createCost({ now: () => clock, env: { COST_PRICES: '{not json' } });
assert(/COST_PRICES/.test(c6.error));
near(c6.record({ sid: 'U1', nodes: [llm('Gemini สรุปคำตอบ', 1000000, 0)] }).u, 0.75, 'bad JSON keeps the default prices');

// 11) จำกัดขนาด: รายละเอียดคำตอบล่าสุด 400 ครั้ง สรุปรายวัน 400 วัน
let t7 = Date.parse('2025-01-01T03:00:00Z');
const c7 = createCost({ now: () => t7, env: {} });
for (let i = 0; i < 420; i++) { c7.record({ sid: 'U' + (i % 5), nodes: [llm('Gemini สรุปคำตอบ', 100, 10)] }); t7 += 86400000; }
const d7 = c7.dump();
assert.strictEqual(d7.recent.length, 400);
assert.strictEqual(Object.keys(d7.days).length, 400);
assert(Object.keys(d7.chats).length <= 3);

// 12) v3.56 ที่มาของค่าใช้จ่าย: บันทึกของแอปนี้ + บันทึกที่ V.2 และชุดทดสอบส่งมา (กันนับซ้ำด้วย id) + ยอดย้อนหลังจาก Dify
let t8 = Date.parse('2026-10-29T09:00:00Z');
const main = createCost({ now: () => t8, env: {} });
const own1 = main.record({ sid: 'Ureal', kind: 'text', q: 'ลูกค้าจริงถาม', nodes: [llm('Gemini สรุปคำตอบ', 100000, 20000)] });
assert(/^[a-f0-9]{16}$/.test(own1.id), 'บันทึกต้องมี id สำหรับกันนับซ้ำ');
assert.deepStrictEqual([own1.a, own1.sr], ['บอทจริง', 'line']);
let t9 = t8;
const v2 = createCost({ now: () => t9, env: { COST_APP: 'V.2' } });
const v2rec = v2.record({ sid: 'Uv2user', kind: 'voice', q: 'ทดสอบเสียงบน V.2', nodes: [llm('Gemini สรุปคำตอบ', 200000, 40000)] });
const tester = createCost({ now: () => t9, env: { COST_SOURCE: 'test', COST_APP: 'บอทจริง' } });
const testRecs = [1, 2, 3].map((i) => tester.record({ sid: 'Utest' + i, kind: 'text', q: 'ชุดทดสอบข้อ ' + i, nodes: [llm('Gemini คัดสินค้าจาก KB + ชีท', 300000, 10000)] }));
assert.deepStrictEqual([testRecs[0].a, testRecs[0].sr, v2rec.a, v2rec.sr], ['บอทจริง', 'test', 'V.2', 'line']);
const wire = JSON.parse(JSON.stringify([v2rec].concat(testRecs)));
let ing = main.ingest(wire);
assert.deepStrictEqual(ing, { accepted: 4, duplicates: 0, rejected: 0 });
ing = main.ingest(wire); // ส่งซ้ำ (เช่นคิวลองใหม่) ต้องไม่นับซ้ำ
assert.deepStrictEqual(ing, { accepted: 0, duplicates: 4, rejected: 0 });
const bad = [
  Object.assign({}, wire[0], { id: 'aaaaaaaaaaaaaaaa', at: t8 + 3600000 }), // อนาคต
  Object.assign({}, wire[0], { id: 'bbbbbbbbbbbbbbbb', at: t8 - 401 * 86400000 }), // เก่ากว่า 400 วัน
  Object.assign({}, wire[0], { id: 'cccccccccccccccc', it: [] }), // ไม่มีรายการ
  Object.assign({}, wire[0], { id: 'dddddddddddddddd', a: '' }), // ไม่มีชื่อแอป
  'not a record'
];
assert.deepStrictEqual(main.ingest(bad), { accepted: 0, duplicates: 0, rejected: 5 });
s = main.summary({ nameOf: (id) => (id === 'Ureal' ? 'ลูกค้า A' : 'ชื่อที่ไม่ควรเห็น'), hasChat: () => true });
const srcs = Object.fromEntries(s.sources.map((x) => [x.app + '|' + x.src, x]));
assert.deepStrictEqual(Object.keys(srcs).sort(), ['V.2|line', 'บอทจริง|line', 'บอทจริง|test']);
assert.deepStrictEqual([srcs['บอทจริง|line'].turns, srcs['V.2|line'].turns, srcs['บอทจริง|test'].turns], [1, 1, 3]);
assert.strictEqual(srcs['V.2|line'].own, false);
near(srcs['บอทจริง|test'].thb, Math.round(3 * (0.225 + 0.0375) * 33.8 * 100) / 100, 'test source THB');
assert.strictEqual(s.sources[0].src, 'test', 'ที่มาที่ใช้เงินมากที่สุดอยู่บนสุด');
assert.strictEqual(s.today.turns, 5, 'ยอดรวมนับทุกที่มา');
const v2turn = s.topTurns.find((x) => x.app === 'V.2');
assert.deepStrictEqual([v2turn.name, v2turn.chat, v2turn.own, v2turn.kind], ['', false, false, 'voice'], 'แชทของแอปอื่นไม่มีชื่อและกดเปิดไม่ได้');
assert.strictEqual(s.topTurns.find((x) => x.sid === 'Ureal').name, 'ลูกค้า A');
assert.strictEqual(s.topChats.find((x) => x.app === 'V.2').sid, 'Uv2user');
assert.strictEqual(s.topChats.filter((x) => x.sid.startsWith('Utest')).length, 3);
// ยอดย้อนหลังจาก Dify Monitoring
assert.strictEqual(main.setBaseline({ app: 'บอทจริง', from: '2026-10-29', to: '2026-09-29' }).ok, false, 'from ต้องไม่หลัง to');
assert.strictEqual(main.setBaseline({ from: '2026-09-29', to: '2026-10-29' }).ok, false, 'ต้องมีชื่อแอป');
assert.strictEqual(main.setBaseline({ app: 'บอทจริง', from: '2026-09-29', to: '2026-10-29', messages: 1400, tokens: 100000000, usd: 80, note: 'Dify Monitoring' }).ok, true);
assert.strictEqual(main.setBaseline({ app: 'บอทจริง', from: '2026-09-29', to: '2026-10-29', messages: 1451, tokens: 104579000, usd: 88.5268, note: 'Dify Monitoring 30 วัน' }).ok, true);
main.setBaseline({ app: 'V.2', from: '2026-09-29', to: '2026-10-29', messages: 3146, tokens: 188500000, usd: 157.82 });
s = main.summary();
assert.strictEqual(s.baselines.length, 2, 'ช่วงเดิมของแอปเดิมต้องแทนที่ ไม่เพิ่มแถว');
const bApp = s.baselines.find((b) => b.app === 'บอทจริง');
assert.deepStrictEqual([bApp.messages, bApp.thb, bApp.perMsg, bApp.note], [1451, Math.round(88.5268 * 33.8 * 100) / 100, Math.round(88.5268 * 33.8 / 1451 * 100) / 100, 'Dify Monitoring 30 วัน']);
assert.strictEqual(s.last30.turns, 5, 'ยอดย้อนหลังไม่ปนกับยอดรายวัน');
// เก็บ/โหลดแล้ว id ที่รับไปแล้วยังกันนับซ้ำ และยอดย้อนหลังยังอยู่
const main2 = createCost({ now: () => t8, env: {} });
main2.load(JSON.parse(JSON.stringify(main.dump())));
assert.deepStrictEqual(main2.ingest(wire), { accepted: 0, duplicates: 4, rejected: 0 });
assert.deepStrictEqual(main2.summary(), main.summary());
// ไฟล์ state จาก v3.55 (ไม่มีที่มาและ key แชทเป็น sid) โหลดได้ และนับเป็นของแอปนี้
const old = createCost({ now: () => t8, env: { COST_APP: 'V.2' } });
const oldDump = { v: 1, since: t8, days: { '2026-10-29': { n: 1, k: { text: 1 }, ku: { text: 0.06 }, u: 0.06, it: { 'ai|Gemini สรุปคำตอบ|gemini-3.8-flash': { n: 'Gemini สรุปคำตอบ', c: 'ai', m: 'gemini-3.8-flash', u: 0.06, i: 50000, o: 6000, t: 56000, r: 1 } } } }, recent: [{ at: t8, sid: 'Uold', k: 'text', q: 'เก่า', n: 1, u: 0.06, t: 56000, s: 0, it: [{ n: 'Gemini สรุปคำตอบ', c: 'ai', m: 'gemini-3.8-flash', u: 0.06, i: 50000, o: 6000, t: 56000, r: 1 }] }], chats: { '2026-10': { Uold: [1, 0.06] } } };
assert.strictEqual(old.load(oldDump), true);
s = old.summary({ nameOf: () => 'คนเก่า', hasChat: () => true });
assert.deepStrictEqual(s.sources.map((x) => [x.app, x.src, x.turns]), [['V.2', 'line', 1]]);
assert.deepStrictEqual([s.topChats[0].sid, s.topChats[0].name, s.topChats[0].chat], ['Uold', 'คนเก่า', true]);
assert.deepStrictEqual([s.topTurns[0].app, s.topTurns[0].name], ['V.2', 'คนเก่า']);

// 13) v3.57 เลือกดูรายวัน (กราฟรายชั่วโมงเวลาไทย) และรายเดือน (ทุกวันของเดือน) ตารางทุกตารางคิดตามช่วงที่เลือก
let t10 = Date.parse('2026-09-30T02:00:00Z'); // 30 ก.ย. 09:00 เวลาไทย
const cp = createCost({ now: () => t10, env: {} });
cp.record({ sid: 'Usep', kind: 'text', q: 'คำถามเดือนกันยา', nodes: [llm('Gemini สรุปคำตอบ', 100000, 20000)] }); // $0.15
t10 = Date.parse('2026-10-28T23:30:00Z'); // 29 ต.ค. 06:30 เวลาไทย (ยังเป็นวันที่ 28 ตามเวลา UTC)
cp.record({ sid: 'Uoct', kind: 'image', q: 'รูปใบไหม้', nodes: [llm('External Search (Gemini + Google Search)', 20000, 4000)] }); // $0.03
t10 = Date.parse('2026-10-29T07:10:00Z'); // 29 ต.ค. 14:10 เวลาไทย
cp.record({ sid: 'Uoct', kind: 'voice', q: 'ถามด้วยเสียง', nodes: [llm('Gemini สรุปคำตอบ', 10000, 2000)], tts: { chars: 500 } }); // $0.015 + เสียง $0.04
cp.record({ sid: 'Uoct2', kind: 'text', q: 'อีกแชท', nodes: [llm('Gemini สรุปคำตอบ', 1000, 100)] }); // $0.001125
const B = (usd) => Math.round(usd * 33.8 * 100) / 100;
const DAY29 = { type: 'day', key: '2026-10-29' };
let ps = cp.summary({ period: DAY29, nameOf: (id) => (id === 'Uoct' ? 'ลูกค้าตุลา' : ''), hasChat: () => true });
assert.deepStrictEqual([ps.period.type, ps.period.key, ps.period.from, ps.period.to], ['day', '2026-10-29', '2026-10-29', '2026-10-29']);
assert.deepStrictEqual([ps.chart.unit, ps.chart.hasHours, ps.chart.points.length, ps.chart.points[0].key, ps.chart.points[23].key], ['hour', true, 24, '00', '23']);
const hourOf = (hh) => ps.chart.points.find((p) => p.key === hh);
assert.deepStrictEqual([hourOf('06').turns, hourOf('14').turns, hourOf('09').turns, hourOf('23').turns], [1, 2, 0, 0], 'ชั่วโมงต้องเป็นเวลาไทย');
assert.deepStrictEqual([hourOf('06').groups.search, hourOf('14').groups.voice, hourOf('14').groups.ai], [B(0.03), B(0.04), B(0.016125)]);
assert.strictEqual(hourOf('14').thb, B(0.056125));
assert.strictEqual(ps.period.total.turns, 3);
near(ps.period.total.usd, 0.03 + 0.055 + 0.001125, 'day total');
assert.deepStrictEqual([ps.search.period, ps.search.month], [1, 1]);
assert.deepStrictEqual(ps.topTurns.map((x) => x.q), ['ถามด้วยเสียง', 'รูปใบไหม้', 'อีกแชท'], 'คำตอบที่แพงที่สุดของวันที่เลือก');
assert.deepStrictEqual(ps.topChats.map((x) => [x.sid, x.turns]), [['Uoct', 2], ['Uoct2', 1]], 'แชทที่ใช้มากที่สุดของวันที่เลือก');
assert.deepStrictEqual([ps.topChats[0].name, ps.topChats[0].chat], ['ลูกค้าตุลา', true]);
assert.deepStrictEqual([ps.byKind.text.turns, ps.byKind.image.turns, ps.byKind.voice.turns], [1, 1, 1]);
assert.deepStrictEqual(ps.sources.map((x) => x.turns), [3]);
assert(ps.items.every((i) => i.label !== 'Gemini สรุปคำตอบ' || i.runs === 2), 'ตารางขั้นตอนนับเฉพาะวันที่เลือก');
assert.deepStrictEqual([ps.today.turns, ps.month.turns, ps.last30.turns], [3, 3, 4], 'การ์ดภาพรวมไม่เปลี่ยนตามช่วงที่เลือก');
assert.deepStrictEqual(ps.available, { firstDay: '2026-09-30', today: '2026-10-29', months: ['2026-10', '2026-09'] });
ps = cp.summary({ period: { type: 'day', key: '2026-09-30' } });
assert.deepStrictEqual([ps.chart.points.find((p) => p.key === '09').turns, ps.period.total.turns, ps.topTurns[0].sid, ps.topChats[0].sid], [1, 1, 'Usep', 'Usep']);
ps = cp.summary({ period: { type: 'day', key: '2026-10-01' } }); // วันที่ไม่มีข้อมูล
assert.deepStrictEqual([ps.period.type, ps.period.total.turns, ps.items.length, ps.topTurns.length, ps.topChats.length, ps.search.period], ['day', 0, 0, 0, 0, 0]);
// รายเดือน: ทุกวันของเดือน (ก.ย. 30 วัน ต.ค. 31 วัน รวมวันที่ยังมาไม่ถึง)
ps = cp.summary({ period: { type: 'month', key: '2026-09' } });
assert.deepStrictEqual([ps.chart.unit, ps.chart.points.length, ps.chart.points[29].key, ps.chart.points[29].turns, ps.period.from, ps.period.to], ['day', 30, '2026-09-30', 1, '2026-09-01', '2026-09-30']);
assert.deepStrictEqual([ps.period.total.turns, ps.topChats.map((x) => x.sid), ps.topTurns.map((x) => x.sid), ps.search.period], [1, ['Usep'], ['Usep'], 0]);
ps = cp.summary({ period: { type: 'month', key: '2026-10' } });
assert.deepStrictEqual([ps.chart.points.length, ps.chart.points[28].key, ps.chart.points[28].turns, ps.period.total.turns, ps.search.period], [31, '2026-10-29', 3, 3, 1]);
assert.deepStrictEqual(ps.topChats.map((x) => x.sid), ['Uoct', 'Uoct2']);
// ค่าเริ่ม 30 วันล่าสุด (30 ก.ย. - 29 ต.ค.) แชทที่ใช้มากที่สุดรวมยอดรายแชทของแต่ละวัน
ps = cp.summary();
assert.deepStrictEqual([ps.period.type, ps.period.from, ps.period.to, ps.chart.unit, ps.chart.points.length, ps.period.total.turns], ['last30', '2026-09-30', '2026-10-29', 'day', 30, 4]);
assert.deepStrictEqual(ps.chart.points, ps.daily);
assert.deepStrictEqual(ps.topChats.map((x) => [x.sid, x.turns]), [['Usep', 1], ['Uoct', 2], ['Uoct2', 1]]);
assert.strictEqual(ps.topTurns[0].sid, 'Usep');
// วันหรือเดือนในอนาคต หรือรูปแบบผิด = 30 วันล่าสุด
for (const bad of [{ type: 'day', key: '2026-10-30' }, { type: 'month', key: '2026-11' }, { type: 'day', key: '29/10/2026' }, { type: 'week', key: '2026-10-29' }, { type: 'month', key: '2026-10-01' }]) {
  assert.strictEqual(cp.summary({ period: bad }).period.type, 'last30', JSON.stringify(bad));
}
// เก็บแล้วโหลดคืน ทุกช่วงได้ผลเหมือนเดิม
const PERIODS = [undefined, DAY29, { type: 'day', key: '2026-09-30' }, { type: 'month', key: '2026-09' }, { type: 'month', key: '2026-10' }];
const cp2 = createCost({ now: () => t10, env: {} });
assert.strictEqual(cp2.load(JSON.parse(JSON.stringify(cp.dump()))), true);
for (const per of PERIODS) assert.deepStrictEqual(cp2.summary({ period: per }), cp.summary({ period: per }), 'dump/load ' + JSON.stringify(per));
// ไฟล์ state ก่อน v3.57 (ไม่มี h, c, top): สร้างจากคำตอบล่าสุดที่เก็บรายละเอียดไว้ ได้ผลเท่ากับบันทึกแบบใหม่
const pre357 = JSON.parse(JSON.stringify(cp.dump()));
for (const d of Object.values(pre357.days)) { delete d.h; delete d.c; delete d.top; }
const cp3 = createCost({ now: () => t10, env: {} });
assert.strictEqual(cp3.load(pre357), true);
for (const per of PERIODS) assert.deepStrictEqual(cp3.summary({ period: per }), cp.summary({ period: per }), 'backfill ' + JSON.stringify(per));
assert.deepStrictEqual(Object.keys(cp3.dump().days['2026-10-29'].h).sort(), ['06', '14'], 'ยอดรายชั่วโมงที่สร้างต้องเก็บลงไฟล์ด้วย');
// ไม่มีคำตอบเหลือในรายละเอียด: วันนั้นไม่มีรายชั่วโมง แชทที่ใช้มากที่สุดใช้ยอดรายเดือนแทน และคำตอบใหม่เริ่มเก็บรายชั่วโมงต่อ
const bare = JSON.parse(JSON.stringify(pre357));
bare.recent = [];
const cp4 = createCost({ now: () => t10, env: {} });
cp4.load(bare);
ps = cp4.summary({ period: DAY29 });
assert.deepStrictEqual([ps.chart.hasHours, ps.chart.points.every((p) => p.thb === 0), ps.period.total.turns, ps.topTurns.length], [false, true, 3, 0]);
assert.deepStrictEqual(cp4.summary().topChats.map((x) => x.sid), ['Uoct', 'Uoct2'], 'ไม่มียอดรายแชทรายวัน ใช้ยอดของเดือนนี้');
t10 = Date.parse('2026-10-29T08:05:00Z'); // 15:05 เวลาไทย
cp4.record({ sid: 'Unew', kind: 'text', q: 'หลังอัปเดต', nodes: [llm('Gemini สรุปคำตอบ', 1000, 100)] });
ps = cp4.summary({ period: DAY29 });
assert.deepStrictEqual([ps.chart.hasHours, ps.chart.points.find((p) => p.key === '15').turns, ps.chart.points.reduce((a, p) => a + p.turns, 0), ps.period.total.turns], [true, 1, 1, 4], 'กราฟรายชั่วโมงไม่ครบยอดทั้งวัน หน้าแอดมินจะบอกส่วนที่ขาด');
// รายเดือนรวมค่าค้นเว็บส่วนที่เกินโควตาฟรีของเดือนนั้น (c5 ตั้งโควตาฟรี 1 ครั้ง ค้นไป 2 ครั้ง)
const s5 = c5.summary();
const s5m = c5.summary({ period: { type: 'month', key: s5.month.key } });
near(s5m.period.total.usd, s5.month.usd, 'month view includes the search overage');
assert.strictEqual(s5m.search.period, 2);

console.log('PASS: cost tracking prices every Dify node, web search, Jev and ElevenLabs voice, totals by day/month/step/kind/chat and by source (this bot, V.2, test runs), takes forwarded records once, keeps Dify baselines, projects the month and the 2027 price, survives restarts, reads Railway price overrides, and filters by day (hourly, Thai time) or month (every day) with older state files backfilled');
