'use strict';

// v3.38 (FB-04, FB-11): short requests for the sales team are answered from the
// team table; questions that only mention the sales team still go to Dify.
const assert = require('assert');
const { teamAsk, provinceAnswer } = require('../team_ask');

const PROVINCE_RX = /(ราชบุรี|สมุทรปราการ|พระนครศรีอยุธยา|อยุธยา|สุพรรณบุรี)/;
const ALIAS = { 'อยุธยา': 'พระนครศรีอยุธยา' };
const provinceOf = (t) => { const m = PROVINCE_RX.exec(t); return m ? (ALIAS[m[1]] || m[1]) : ''; };
const ask = (t) => teamAsk(t, provinceOf, PROVINCE_RX);
const answer = (t) => provinceAnswer(t, provinceOf, PROVINCE_RX);

// wording seen in LINE chats on 21-24 Oct
assert.deepStrictEqual(ask('ขอเบอทีมขาย'), { province: '' });
assert.deepStrictEqual(ask('ทีมงานในพื้นที่ของฉัน'), { province: '' });
assert.deepStrictEqual(ask('ขอเบอร์ทีมขายหน่อยค่ะ'), { province: '' });
assert.deepStrictEqual(ask('ขอเบอร์ทีมขายราชบุรีหน่อยค่ะ'), { province: 'ราชบุรี' });
assert.deepStrictEqual(ask('ติดต่อเซลล์ได้ทางไหนคะ'), { province: '' });
assert.deepStrictEqual(ask('อยากได้เบอร์โทรเจ้าหน้าที่ในพื้นที่ค่ะ'), { province: '' });
assert.deepStrictEqual(ask('ขอไลน์ทีมขายเขตอยุธยาด้วยครับ'), { province: 'พระนครศรีอยุธยา' });
assert.deepStrictEqual(ask('อยากคุยกับทีมขาย'), { province: '' });
assert.deepStrictEqual(ask('ขอเบอร์ทีมขายปทุมค่ะ'), { province: 'ปทุมธานี' });
assert.deepStrictEqual(ask('ทีมขายสุพรรณบุรี'), { province: 'สุพรรณบุรี' });

// product questions that mention the sales team stay with Dify
assert.strictEqual(ask('ทีมขายแนะนำให้ใช้พรีดิคท์ในทุเรียน ได้ไหม'), null);
assert.strictEqual(ask('สอบถามทีมขายเรื่องราคาโมเวนทัส'), null);
assert.strictEqual(ask('หนอนกินใบข้าวโพดใช้อะไรดี'), null);

// the customer's reply after the bot asked for the province
assert.strictEqual(answer('ราชบุรีค่ะ'), 'ราชบุรี');
assert.strictEqual(answer('อยู่ จ.อยุธยา ครับ'), 'พระนครศรีอยุธยา');
assert.strictEqual(answer('ปากน้ำ'), 'สมุทรปราการ');
assert.strictEqual(answer('ปากน้ำโพค่ะ'), 'นครสวรรค์');
assert.strictEqual(answer('สุพรรณ'), 'สุพรรณบุรี');
assert.strictEqual(answer('กาญค่ะ'), 'กาญจนบุรี');
assert.strictEqual(answer('ทุเรียนใบไหม้ใช้อะไรดีคะ'), '');
assert.strictEqual(answer('ราชบุรีปลูกทุเรียนได้ผลดีไหมคะ ช่วยแนะนำปุ๋ย'), '');

console.log('PASS: sales team requests are answered from the team table; product questions still go to Dify');
