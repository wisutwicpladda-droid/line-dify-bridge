'use strict';

// v3.37-voice: ตรวจตัวแปลงข้อความเป็นคำอ่านไทย ความยาวไฟล์ mp3 และค่าตั้งต้นของระบบเสียง
const assert = require('assert');
const v = require('../voice');

assert.strictEqual(v.thaiInt('1'), 'หนึ่ง');
assert.strictEqual(v.thaiInt('11'), 'สิบเอ็ด');
assert.strictEqual(v.thaiInt('21'), 'ยี่สิบเอ็ด');
assert.strictEqual(v.thaiInt('101'), 'หนึ่งร้อยเอ็ด');
assert.strictEqual(v.thaiInt('250'), 'สองร้อยห้าสิบ');
assert.strictEqual(v.thaiInt('75000'), 'เจ็ดหมื่นห้าพัน');
assert.strictEqual(v.thaiInt('2000000'), 'สองล้าน');
assert.strictEqual(v.thaiInt('1000001'), 'หนึ่งล้านเอ็ด');
assert.strictEqual(v.thaiNumber('1,250'), 'หนึ่งพันสองร้อยห้าสิบ');
assert.strictEqual(v.thaiNumber('0.25'), 'ศูนย์จุดสองห้า');

const say = (t) => v.speechText(t, 600);
assert.strictEqual(say('ผสม 20-30 ซีซี/น้ำ 20 ลิตร'), 'ผสม ยี่สิบ ถึง สามสิบ ซีซี ต่อ น้ำ ยี่สิบ ลิตร');
assert.strictEqual(say('"แซด-ซีโร่" 50 ซีซีต่อไร่ 😊'), 'แซด-ซีโร่ ห้าสิบ ซีซีต่อไร่');
assert.strictEqual(say('ใช้รวม 1,250 ซีซี (1.25 ลิตร)'), 'ใช้รวม หนึ่งพันสองร้อยห้าสิบ ซีซี หนึ่งจุดสองห้า ลิตร');
assert.strictEqual(say('เกรค 5 เอสซี 20–40 ml'), 'เกรค ห้า เอสซี ยี่สิบ ถึง สี่สิบ มิลลิลิตร');
assert.strictEqual(say('พรีดิคท์ 25% เอฟ'), 'พรีดิคท์ ยี่สิบห้า เปอร์เซ็นต์ เอฟ');
assert.strictEqual(say('โทร 081-234-5678 ได้เลยค่ะ'), 'โทร ศูนย์ แปด หนึ่ง, สอง สาม สี่, ห้า หก เจ็ด แปด ได้เลยค่ะ');
assert.strictEqual(say('ดูรูปที่ https://example.com/a.png ค่ะ'), 'ดูรูปที่ ค่ะ');
assert.strictEqual(say('- ข้อแรก\n\n- ข้อสอง'), 'ข้อแรก\nข้อสอง');
assert.strictEqual(say('พ่นช่วง 8.00 น. ค่ะ'), 'พ่นช่วง แปด นาฬิกา ค่ะ');
const long = v.speechText('คำ '.repeat(400), 200);
assert(long.length <= 200 + 40 && long.endsWith('รายละเอียดเพิ่มเติมอยู่ในข้อความนะคะ'), 'ข้อความยาวต้องตัดและบอกให้อ่านข้อความ');

// mp3 128 kbps 44.1 kHz: เฟรมละ 417 ไบต์ 1,152 ตัวอย่าง -> 100 เฟรม = 2,612 มิลลิวินาที
function fakeMp3(frames, id3) {
  const f = Buffer.alloc(417);
  f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x64;
  const parts = [];
  if (id3) parts.push(Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]), Buffer.alloc(20));
  for (let i = 0; i < frames; i++) parts.push(f);
  return Buffer.concat(parts);
}
assert.strictEqual(v.mp3DurationMs(fakeMp3(100)), 2612);
assert.strictEqual(v.mp3DurationMs(fakeMp3(100, true)), 2612);
assert.strictEqual(v.mp3DurationMs(Buffer.from('not audio')), 0);

const off = v.config({});
assert.strictEqual(off.sttOn, false);
assert.strictEqual(off.ttsOn, false);
const sttOnly = v.config({ ELEVENLABS_API_KEY: 'k' });
assert.strictEqual(sttOnly.sttOn, true);
assert.strictEqual(sttOnly.ttsOn, false, 'ไม่มี voice ID ต้องไม่ตอบเป็นเสียง');
const on = v.config({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'voice1', VOICE_REPLY: 'ALWAYS', VOICE_MAX_CHARS: '50' });
assert.strictEqual(on.ttsOn, true);
assert.strictEqual(on.mode, 'always');
assert.strictEqual(on.maxChars, 100, 'ความยาวต่ำสุด 100 ตัวอักษร');
assert.strictEqual(on.ttsModel, 'eleven_v4');
assert.strictEqual(on.sttModel, 'scribe_v2');
assert.strictEqual(v.config({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'x', VOICE_REPLY: 'off' }).ttsOn, false);

console.log('PASS: voice text normalization, mp3 duration, config');
