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

const rate = compactResponse(long, 'มี 20 ไร่ ใช้อัตราเท่าไร', ['แกนเตอร์']);
assert.strictEqual(rate, long, 'rate requests must keep full details');

const short = 'ได้ค่ะ แนะนำบอกอายุพืชก่อน น้องลัดดาจะช่วยเลือกตัวที่ตรงช่วงให้ค่ะ';
assert.strictEqual(compactResponse(short, 'ใช้อะไรดี'), short, 'short replies must remain unchanged');

console.log('PASS: ordinary replies compact while detail requests remain intact');
