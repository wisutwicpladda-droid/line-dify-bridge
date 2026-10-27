'use strict';

// v3.45-v2: เลย/แพร่/ตาก are also everyday words; the bridge must not turn "เต็มเลยค่ะ" into จ.เลย
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { provinceMatch, PROVINCE_WORDS } = require('../province_match');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const block = server.slice(server.indexOf('const ZONE_OF = {};'), server.indexOf('const ZONE_TEAM'));
const ZONE_OF = {};
new Function('ZONE_OF', block.replace('const ZONE_OF = {};', ''))(ZONE_OF);
assert(Object.keys(ZONE_OF).length > 60, 'zone list not found in server.js');
const RX = new RegExp('(' + Object.keys(ZONE_OF).sort((a, b) => b.length - a.length).join('|') + ')');

const cases = [
  // customer messages from tests/bot cases: none of them gives a province
  ['ผักสลัดกรีนโอ๊คไฮโดรฯ เพลี้ยอ่อนเต็มเลยค่ะ 😭 ใช้ตัวไหนได้บ้าง อัตราด้วยน้า', ''],
  ['ตกลงถัง20ลิตรใส่กี่ซีซี บอกตัวเลขมาเลยลุงคิดไม่เป็น', ''],
  ['จันท์ค่ะ อ.ท่าใหม่ มีร้านตัวแทนแถวนั้นมั้ย ขอชื่อร้านเลยได้ป่าว', ''],
  ['ฉีดยาของลัดดาไปแล้วข้าวตายหมดเลย จะให้บริษัทรับผิดชอบยังไง', ''],
  ['ยังเป็นอยู่เลยค่ะ', ''],
  ['โรคนี้แพร่ระบาดเร็วไหม', ''],
  ['ตากแดดไว้ 2 วันแล้วค่อยพ่น', ''],
  ['อัตราด้วยค่ะ', ''],
  ['ใช้ปุ๋ยตราดาวร่วมได้ไหม', ''],
  ['ปุ๋ยตราดอกบัว', ''],
  // real provinces
  ['อ.ตากใบ จ.นราธิวาส', 'นราธิวาส'],
  ['อยู่ตราดค่ะ', 'ตราด'],
  ['สวนทุเรียน จ.ตราด อัตราเท่าไหร่', 'ตราด'],
  ['อยู่ จ.เลย ค่ะ', 'เลย'],
  ['จังหวัดแพร่ครับ', 'แพร่'],
  ['เลยค่ะ', 'เลย'],
  ['อยู่เลยค่ะ', 'เลย'],
  ['อยู่ตากค่ะ', 'ตาก'],
  ['แพร่', 'แพร่'],
  ['สวนอยู่ขอนแก่น เพลี้ยเต็มเลย', 'ขอนแก่น'],
  ['ได้เลยค่ะ อยู่ราชบุรี', 'ราชบุรี'],
  ['', ''],
];
for (const [t, want] of cases) assert.strictEqual(provinceMatch(RX, t), want, JSON.stringify(t));
assert.deepStrictEqual([...PROVINCE_WORDS].sort(), ['ตาก', 'เลย', 'แพร่'].sort());

// server.js uses the filter both for provinceOf (team requests, registration, lead cards) and the CRM guess
assert(/function provinceOf\(text\) \{\s*const p = provinceMatch\(PROVINCE_ALL_RX, text\);/.test(server), 'provinceOf does not use provinceMatch');
assert(/const prov = provinceMatch\(PROVINCE_RX, userText\);/.test(server), 'crmTouch still guesses with PROVINCE_RX.exec');
assert(!/PROVINCE_RX\.exec\(userText\)/.test(server));
assert(/const provRaw = provinceMatch\(PROVINCE_ALL_RX, raw\);/.test(server), 'regParse does not use provinceMatch');
assert(/'จันท์': 'จันทบุรี'/.test(server), 'short name จันท์ missing');

// old guesses are cleared once: only unregistered profiles whose province came from the old guess
const src = server.match(/function crmClearWordProvinces\(\) \{[\s\S]*?\r?\n\}/)[0];
const crm = new Map([
  ['U1', { province: 'เลย', auto: { province: 'เลย' } }],                          // old guess -> cleared
  ['U2', { province: 'เลย', auto: { province: 'เลย', province_v345: 1 } }],       // typed จ.เลย after the fix -> kept
  ['U3', { province: 'เลย', auto: { province: 'เลย', reg: { done_at: 'x' } } }],  // registered -> kept
  ['U4', { province: 'ขอนแก่น', auto: { province: 'แพร่' } }],                     // province set elsewhere -> kept
  ['U5', { province: 'ราชบุรี', auto: { province: 'ราชบุรี' } }],                   // not a word province -> kept
  ['U6', { province: '', auto: { province: 'ตาก' } }],                              // guess only in auto -> cleared
]);
let dirty = 0;
const regDone = (c) => !!(c && (c.pos_id || (c.auto && c.auto.reg && c.auto.reg.done_at)));
const clear = new Function('crm', 'PROVINCE_WORDS', 'regDone', 'SB_ON', 'sbUpsert', 'markDirty', src + '; return crmClearWordProvinces;')(
  crm, PROVINCE_WORDS, regDone, false, () => { throw new Error('no Supabase on this test'); }, () => { dirty++; });
const origLog = console.log; console.log = () => {};
const n = clear();
console.log = origLog;
assert.strictEqual(n, 2);
assert.strictEqual(crm.get('U1').province, ''); assert.strictEqual(crm.get('U1').auto.province, undefined);
assert.strictEqual(crm.get('U2').province, 'เลย');
assert.strictEqual(crm.get('U3').province, 'เลย');
assert.strictEqual(crm.get('U4').province, 'ขอนแก่น');
assert.strictEqual(crm.get('U5').province, 'ราชบุรี');
assert.strictEqual(crm.get('U6').auto.province, undefined);
assert.strictEqual(dirty, 1);
assert.strictEqual(clear(), 0, 'second run must change nothing');
assert(/crmClearWordProvinces\(\);/.test(server.slice(server.indexOf('async function crmLoadFromSupabase'))), 'cleanup not called after the Supabase load');

console.log('PASS: เลย/แพร่/ตาก count as provinces only with จ./จังหวัด or as the whole reply; old guesses cleared once');

