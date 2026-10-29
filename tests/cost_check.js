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

console.log('PASS: cost tracking prices every Dify node, web search, Jev and ElevenLabs voice, totals by day/month/step/kind/chat, projects the month and the 2027 price, survives restarts and reads Railway price overrides');
