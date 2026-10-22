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
assert(!stripRates(inlineReply).text.includes('200'), 'อัตราในประโยคต้องถูกตัด');

// P-72 regression: a Markdown set rate is removed as a whole line.
const p72 = stripRates('**พ่นด้วยคน:** ขวดละ 50+50 ซีซี ต่อน้ำ 20 ลิตร\nพ่นให้ทั่วแปลง');
assert(!p72.text.includes('50+'), 'ห้ามเหลือ 50+');
assert(p72.text.includes('พ่นให้ทั่วแปลง'), 'ต้องคงบรรทัดอื่นไว้');

assert.strictEqual(stripRates('สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ').removed, 0, 'ไม่มีอัตรา ไม่ต้องแก้');
console.log('PASS: rate guard keeps rates for rate follow-ups and still cuts unasked rates');
