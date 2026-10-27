'use strict';

// v3.36: case 14 Oct 2026 (แกนเตอร์). Dify answered the correct sheet rates, but the
// bridge rate guard cut them because the follow-ups did not match its narrow regex.
const assert = require('assert');
const { asksRate, rateAsked, stripRates } = require('../rate_guard');

const min = 60000;
const now = Date.parse('2026-10-14T02:36:42Z');
const hist = [
  { r: 'u', t: 'ยาฆ่าหญ้าในนาข้าว', at: now - 70 * min },
  { r: 'b', t: '(ตอบ)', at: now - 70 * min },
  { r: 'u', t: 'แกนเตอร์ ใช้ในไร่อะไร', at: now - 2 * min },
  { r: 'b', t: '(ตอบ)', at: now - 2 * min },
  { r: 'u', t: 'ใช้ในนาข้าวยังไง', at: now - min },
  { r: 'b', t: '(ตอบ)', at: now - min },
  { r: 'u', t: 'ทั้งคน ทั้งโดรนค่ะ', at: now }
];

// The two follow-ups in the case ask for the rate.
assert(rateAsked('ใช้ในนาข้าวยังไง', hist.slice(0, 5), now - min), 'ใช้ในนาข้าวยังไง ต้องนับว่าถามอัตรา');
assert(rateAsked('ทั้งคน ทั้งโดรนค่ะ', hist, now), 'ทั้งคน ทั้งโดรนค่ะ ต้องนับว่าถามอัตรา');
for (const q of ['พ่นในสวนทุเรียนอย่างไร', 'ฉีดกับพริกยังไงคะ', 'ไร่ละกี่ขวด', 'ใช้ต่อไร่เท่าไหร่', 'พ่นโดรนได้ไหม', 'วิธีพ่นที่ถูกต้อง']) {
  assert(asksRate(q), q + ' ต้องนับว่าถามอัตรา');
}
// Phrasings that already counted before v3.36 still count.
for (const q of ['อัตราเท่าไหร่', 'ใช้ยังไง', 'ผสมกี่ซีซี', 'พ่น 10 ไร่ใช้กี่ขวด', 'วิธีใช้', 'ขั้นตอนการใช้']) {
  assert(asksRate(q), q + ' ต้องยังนับว่าถามอัตรา');
}
// v3.44-v2 (bot test 27 Oct 2026): colloquial "ใช้ไง" and a quoted dose count as rate questions.
for (const q of ['แก่นเตอร์ ใช้ไง', 'ฉีดไงครับ', 'ฉีดอ้อย เซลล์บอกว่าโบร์แลนต้องใส่ 50 กรัมต่อน้ำ 20 ลิตร จริงไหม', 'ใส่ 2 ฝาพอไหม']) {
  assert(asksRate(q), q + ' ต้องนับว่าถามอัตรา');
}
for (const q of ['ข้าวอายุ 10 วัน ใบเหลือง เป็นอะไร', 'ทุเรียนอายุ 5 ปี ใบไหม้']) {
  assert(!asksRate(q), q + ' ตัวเลขอายุพืชไม่ใช่การถามอัตรา');
}

// A short answer to the bot's clarifying question continues a rate question...
const clarify = [{ r: 'u', t: 'ใช้ยังไงคะ', at: now - 3 * min }, { r: 'b', t: 'ใช้กับพืชอะไรคะ', at: now - 3 * min }, { r: 'u', t: 'ข้าวค่ะ', at: now }];
assert(rateAsked('ข้าวค่ะ', clarify, now), 'คำตอบสั้นต่อจากคำถามอัตรา ต้องนับว่าถาม');
// ...but not after 20 minutes, and not for a long new question.
const stale = [{ r: 'u', t: 'ใช้ยังไงคะ', at: now - 30 * min }, { r: 'u', t: 'ข้าวค่ะ', at: now }];
assert(!rateAsked('ข้าวค่ะ', stale, now), 'เกิน 20 นาทีไม่นับต่อ');
const longQ = 'แล้วถ้าเป็นหนอนกระทู้ข้าวโพดระบาดหนักมากในแปลงที่ปลูกไว้ประมาณสองเดือนจะแนะนำตัวไหนดีคะ';
assert(!rateAsked(longQ, [{ r: 'u', t: 'ใช้ยังไง', at: now - min }, { r: 'u', t: longQ, at: now }], now), 'คำถามใหม่ยาว ๆ ตัดสินจากตัวเอง');

// Questions that do not ask for a rate.
for (const q of ['ยาฆ่าหญ้าในนาข้าว', 'แกนเตอร์ ใช้ในไร่อะไร', 'หนอนเต็มสวนผัก ใช้ยาอะไรดี', 'ใบเหลืองเป็นโรคอะไร']) {
  assert(!rateAsked(q, [{ r: 'u', t: q, at: now }], now), q + ' ไม่ได้ถามอัตรา');
}

// When not asked, the rates are still removed, including the orphan "…ดังนี้ค่ะ" intro.
const listReply = [
  'การใช้ "แกนเตอร์" ในนาข้าว มีอัตราดังนี้ค่ะ',
  '- พ่นด้วยคน: ใช้ 200-250 ซีซี ต่อน้ำ 40 ลิตร ต่อ 1 ไร่',
  '- พ่นด้วยโดรน: ใช้ 200-250 ซีซี ต่อน้ำ 5 ลิตร ต่อ 1 ไร่',
  'ข้อควรระวัง: ห้ามพ่นจี้หรือพ่นซ้ำเพราะอาจทำให้ข้าวยุบหรือตายได้'
].join('\n');
const cutList = stripRates(listReply);
assert(cutList.removed >= 2, 'ต้องตัดบรรทัดอัตรา');
assert(!cutList.text.includes('200-250'), 'ห้ามเหลือตัวเลขอัตรา');
assert(!cutList.text.includes('ดังนี้'), 'ห้ามเหลือหัวข้อ ดังนี้ ที่ไม่มีอะไรตามมา');
assert(cutList.text.includes('ข้อควรระวัง'), 'ต้องคงข้อควรระวังไว้');

const inlineReply = '"แกนเตอร์" โดยพ่นด้วยคนใช้อัตรา 200-250 ซีซี ต่อน้ำ 40 ลิตรต่อไร่ หรือพ่นด้วยโดรนใช้อัตรา 200-250 ซีซี ต่อน้ำ 5 ลิตรต่อไร่ค่ะ';
// v3.46: an answer that is only the rate sentence keeps it (cutting would leave nothing to read)...
assert.strictEqual(stripRates(inlineReply).removed, 0, 'คำตอบที่มีแต่อัตรา ต้องคงไว้');
// ...and with more to say, the whole rate clause goes, not just the numbers (screenshot 27 Oct:
// '"แกนเตอร์" โดยพ่นด้วยคน ต่อไร่ หรือพ่นด้วยโดรน ต่อไร่ค่ะ').
const inlinePlus = stripRates(inlineReply + ' ข้อควรระวังคือห้ามพ่นจี้หรือพ่นซ้ำเพราะอาจทำให้ข้าวยุบได้ค่ะ');
assert(inlinePlus.removed >= 2, 'ต้องนับว่าตัดอัตรา');
assert(!/\d/.test(inlinePlus.text), 'ห้ามเหลือตัวเลขอัตรา: ' + inlinePlus.text);
assert(!/ต่อไร่|พ่นด้วยคน|พ่นด้วยโดรน/.test(inlinePlus.text), 'ห้ามเหลือเศษประโยคอัตรา: ' + inlinePlus.text);
assert(inlinePlus.text.includes('"แกนเตอร์"') && inlinePlus.text.includes('ข้อควรระวัง'), inlinePlus.text);

// v3.46 production bot test 27 Oct 2026 (sim-genx-02, sim-boomer-01): fragments left by the old cut.
const genx02 = 'สำหรับมันสำปะหลังอายุ 2 เดือน ที่มีหญ้าใบแคบขึ้น บริษัทมีแนะนำ 2 ตัวค่ะ ได้แก่ "คลิฟตัน" และ "พรีดิม" ทั้งสองตัวใช้กำจัดวัชพืชใบแคบในมันสำปะหลังได้ อัตราใช้สำหรับคนพ่นคือ 300-400 ซีซี ต่อน้ำ 80 ลิตร พ่นได้ 1 ไร่ (หรือหากใช้โดรน 300-400 ซีซี ต่อไร่) ค่ะ';
const g = stripRates(genx02);
assert(g.removed >= 1 && !/300|พ่นได้ 1 ไร่|\(หรือ|อัตรา/.test(g.text), 'ต้องตัดทั้งช่วงอัตรา: ' + g.text);
assert(g.text.includes('"คลิฟตัน" และ "พรีดิม" ทั้งสองตัวใช้กำจัดวัชพืชใบแคบในมันสำปะหลังได้ค่ะ'), g.text);
const boomer01 = '"แซด-ซีโร่" ใช้กำจัดเพลี้ยกระโดดสีน้ำตาลในนาข้าวได้ค่ะ ฉีดพ่นได้ทุกระยะของข้าว อัตราใช้สำหรับคนพ่นใช้ 50 ซีซี ต่อไร่ หรือหากใช้โดรนพ่นใช้ 50 ซีซี ต่อไร่ค่ะ';
const b = stripRates(boomer01);
assert.strictEqual(b.text, '"แซด-ซีโร่" ใช้กำจัดเพลี้ยกระโดดสีน้ำตาลในนาข้าวได้ค่ะ ฉีดพ่นได้ทุกระยะของข้าวค่ะ');
// Words after the rate that carry their own meaning stay.
const keepsTiming = stripRates('ฉีด "เทอราโน" ป้องกันโรคใบไหม้ได้ค่ะ ใช้ 20 ซีซี ต่อน้ำ 20 ลิตร พ่นซ้ำทุก 7 วันเมื่อพบการระบาดค่ะ');
assert(!keepsTiming.text.includes('20 ซีซี') && keepsTiming.text.includes('พ่นซ้ำทุก 7 วันเมื่อพบการระบาดค่ะ'), keepsTiming.text);

// v3.47 production bot test 28 Oct 2026 (sim-genx-02): connectors and endings left by a cut.
const v347 = [
  ['สำหรับมันสำปะหลังอายุ 2 เดือน แนะนำ "คลิฟตัน" หรือ "พรีดิม"ค่ะ ทั้งสองตัวเป็นสารกำจัดวัชพืชใบแคบที่ใช้ในมันสำปะหลังอายุตั้งแต่ 1 เดือนขึ้นไปได้ โดยใช้อัตรา 100 ซีซีต่อน้ำ 20 ลิตรค่ะ',
    'สำหรับมันสำปะหลังอายุ 2 เดือน แนะนำ "คลิฟตัน" หรือ "พรีดิม"ค่ะ ทั้งสองตัวเป็นสารกำจัดวัชพืชใบแคบที่ใช้ในมันสำปะหลังอายุตั้งแต่ 1 เดือนขึ้นไปได้ค่ะ'],
  ['แกนเตอร์ใช้ในนาข้าวอายุ 7-12 วันได้ค่ะ อัตราใช้ 50 ซีซีต่อไร่ค่ะ ข้อควรระวัง: ห้ามพ่นซ้ำ',
    'แกนเตอร์ใช้ในนาข้าวอายุ 7-12 วันได้ค่ะ ข้อควรระวัง: ห้ามพ่นซ้ำ'],
  ['ใช้กำจัดวัชพืชใบแคบ ใบกว้าง และกกได้ค่ะ ส่วนการใช้โดรนอยู่ที่ 50 ซีซีต่อไร่ค่ะ ข้อควรระวัง: ห้ามพ่นจี้',
    'ใช้กำจัดวัชพืชใบแคบ ใบกว้าง และกกได้ค่ะ ข้อควรระวัง: ห้ามพ่นจี้'],
  ['แนะนำ "ไฮซีส" ค่ะ ปริมาณที่ใช้คือ 20 ซีซีต่อน้ำ 20 ลิตรค่ะ ควรพ่นช่วงเย็น', 'แนะนำ "ไฮซีส"ค่ะ ควรพ่นช่วงเย็น'],
  ['แนะนำ "ก็อปกัน (สีเขียว)" ค่ะ อัตรา 30 กรัมต่อไร่ หรือ 40 กรัมต่อไร่ ทั้งนี้เนื่องจากเป็นผักที่เก็บเกี่ยวเร็ว ควรเว้นระยะก่อนเก็บเกี่ยว',
    'แนะนำ "ก็อปกัน (สีเขียว)"ค่ะ ทั้งนี้เนื่องจากเป็นผักที่เก็บเกี่ยวเร็ว ควรเว้นระยะก่อนเก็บเกี่ยว'],
  // "หรือ" between two products stays; only the rates go.
  ['แนะนำ "กะรัต 35" ใช้ 20 ซีซีต่อน้ำ 20 ลิตร หรือ "ไบเตอร์" 30 ซีซีต่อน้ำ 20 ลิตรค่ะ', 'แนะนำ "กะรัต 35" หรือ "ไบเตอร์"ค่ะ'],
  // A rate sentence opening the line takes its ending with it.
  ['อัตรา 50 ซีซีต่อไร่ค่ะ ข้อควรระวัง: ห้ามพ่นจี้หรือพ่นซ้ำเพราะอาจทำให้ข้าวยุบได้', 'ข้อควรระวัง: ห้ามพ่นจี้หรือพ่นซ้ำเพราะอาจทำให้ข้าวยุบได้'],
  // Brackets stay balanced: ")" closing the sentence before the cut, and a rate inside brackets.
  ['สำหรับข้าวอายุ 7-12 วันหลังหว่าน (ข้าวอายุ 10 วันใช้ได้ค่ะ) แนะนำ 200 ซีซีต่อไร่ ข้อควรระวัง: ห้ามพ่นจี้หรือพ่นซ้ำค่ะ',
    'สำหรับข้าวอายุ 7-12 วันหลังหว่าน (ข้าวอายุ 10 วันใช้ได้ค่ะ) ข้อควรระวัง: ห้ามพ่นจี้หรือพ่นซ้ำค่ะ'],
  ['แนะนำ "ไฮซีส" ค่ะ (อัตรา 20 ซีซีต่อน้ำ 20 ลิตร) พ่นทุก 7 วันค่ะ', 'แนะนำ "ไฮซีส"ค่ะ พ่นทุก 7 วันค่ะ'],
  // คะน้า/คะแนน are words, not endings: they keep their space and are never merged.
  ['ใช้ในผักกาดได้ค่ะ คะน้าก็ใช้ได้ อัตรา 20 ซีซีต่อน้ำ 20 ลิตร พ่นทุก 7 วันค่ะ', 'ใช้ในผักกาดได้ค่ะ คะน้าก็ใช้ได้ พ่นทุก 7 วันค่ะ']
];
for (const [inp, want] of v347) assert.strictEqual(stripRates(inp).text, want);

// P-72 regression: a Markdown set rate is removed as a whole line.
const p72 = stripRates('**พ่นด้วยคน:** ขวดละ 50+50 ซีซี ต่อน้ำ 20 ลิตร\nพ่นให้ทั่วแปลง');
assert(!p72.text.includes('50+'), 'ห้ามเหลือ 50+');
assert(p72.text.includes('พ่นให้ทั่วแปลง'), 'ต้องคงบรรทัดอื่นไว้');

assert.strictEqual(stripRates('สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ').removed, 0, 'ไม่มีอัตรา ไม่ต้องแก้');
console.log('PASS: rate guard keeps rates for rate follow-ups and still cuts unasked rates');
