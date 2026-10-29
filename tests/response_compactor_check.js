'use strict';

const assert = require('assert');
const { compactResponse, ORDINARY_MAX } = require('../response_compactor');

const long = [
  'อาการนี้น่าจะเป็นเพลี้ยไฟค่ะ',
  'ลองพลิกดูยอดอ่อนและใต้ใบ ถ้ามีรอยเงินหรือจุดดำให้ยืนยันเพิ่ม',
  'สินค้าที่ตรงคือ "แกนเตอร์" เพราะมีสารที่ใช้จัดการแมลงกลุ่มนี้',
  'ควรสำรวจซ้ำหลายต้นและปรับวิธีตามระยะพืช',
  'ตอนนี้พบมากที่ยอดหรือดอกคะ',
  'ถ้าพบในดอกให้แจ้งระยะดอกเพิ่มเติมนะคะ',
  'ถ้าพบหลายต้นให้แยกดูว่าระบาดเป็นหย่อมหรือกระจายทั้งแปลง',
  'อย่าเพิ่งผสมหลายตัวจนกว่าจะยืนยันชนิดแมลงและระยะพืชให้ชัดเจนค่ะ',
  'หากอาการยังไม่ตรงกัน ให้จดระยะที่เริ่มพบ อวัยวะที่เสียหาย และจำนวนต้นที่เป็นไว้ก่อนค่ะ'
].join('\n');
const concise = compactResponse(long, 'ใช้อะไรดี', ['แกนเตอร์']);
assert(concise.length < long.length, 'ordinary reply should be compacted');
assert(concise.includes('แกนเตอร์'), 'product line must survive compaction');
assert(concise.length <= ORDINARY_MAX * 1.45, 'compacted reply should remain short');

const structured = 'อาการนี้น่าจะเป็นโรคค่ะ\nแนวทางแก้ไขเบื้องต้น:\n1. ตัดส่วนที่เป็นโรคออก\n2. ลดความชื้นในแปลง';
assert.strictEqual(compactResponse(structured, 'มีปัญหาในแปลงไหม'), structured, 'structured treatment steps must not be truncated');

const rate = compactResponse(long, 'มี 20 ไร่ ใช้อัตราเท่าไร', ['แกนเตอร์']);
assert.strictEqual(rate, long, 'rate requests must keep full details');

const short = 'ได้ค่ะ แนะนำบอกอายุพืชก่อน น้องลัดดาจะช่วยเลือกตัวที่ตรงช่วงให้ค่ะ';
assert.strictEqual(compactResponse(short, 'ใช้อะไรดี'), short, 'short replies must remain unchanged');

// v3.44-v2: mixing questions, two questions in one message, and lists of products stay whole.
assert.strictEqual(compactResponse(long, 'ยาร้อนผสมยาเย็นถังเดียวกันได้มั้ย', ['แกนเตอร์']), long, 'mixing advice must stay whole');
assert.strictEqual(compactResponse(long, 'มีอทราซีนไหม จะใช้ตอนอ้อยอายุกี่เดือน', ['แกนเตอร์']), long, 'two questions must both be answered');
const twoProducts = long.replace('ควรสำรวจซ้ำหลายต้น', 'หรือ "ไฮซีส" ก็ใช้ได้ ควรสำรวจซ้ำหลายต้น');
assert.strictEqual(compactResponse(twoProducts, 'ใช้อะไรดี', ['แกนเตอร์', 'ไฮซีส']), twoProducts, 'a list of product options must stay whole');

// v3.54: the first answer states the rate (owner, 29 Oct 2026). A reply with a rate is not shortened,
// even when the rate sits in a sentence without the product name.
const withRate = long.replace('ควรสำรวจซ้ำหลายต้น', 'ใช้ 20-30 ซีซี ต่อน้ำ 20 ลิตร ควรสำรวจซ้ำหลายต้น');
assert.strictEqual(compactResponse(withRate, 'ใช้อะไรดี', ['แกนเตอร์']), withRate, 'a reply that gives a rate must stay whole');
const perRai = long.replace('ควรสำรวจซ้ำหลายต้น', 'ใช้ 100 กรัม/ไร่ ควรสำรวจซ้ำหลายต้น');
assert.strictEqual(compactResponse(perRai, 'ใช้อะไรดี', ['แกนเตอร์']), perRai, 'a per-rai rate must stay whole');

console.log('PASS: ordinary replies compact while detail requests remain intact');
