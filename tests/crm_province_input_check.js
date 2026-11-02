'use strict';

// v3.30: Dify gets the customer's province as customer_province.
// v3.62 (owner 2 Nov 2026): with registration off the sales team is no longer tied to old member data.
// Only a province the customer typed in this chat within 48 hours is sent; otherwise it is empty and Dify asks first.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert(/inputs: \{ customer_province: difyProvince\(sessionId\) \}/.test(server), 'askDify does not send difyProvince to Dify');

// the real functions from server.js, run against a fake CRM and fake chats
const pick = (re) => { const m = server.match(re); assert(m, 'not found in server.js: ' + re); return m[0]; };
const src = [
  pick(/function crmProvince\(id\) \{[\s\S]*?\n\}/),
  pick(/const CHAT_PROVINCE_MS = [^\n]*/),
  pick(/function chatProvinceOf\(s, now\) \{[\s\S]*?\n\}/),
  pick(/function difyProvince\(id\) \{[\s\S]*?\n\}/),
].join('\n');
const PROVS = ['สุพรรณบุรี', 'ลพบุรี', 'ราชบุรี'];
const provinceOf = (t) => PROVS.find((p) => String(t || '').includes(p)) || '';
const now = Date.now();
const crm = new Map([['U1', { province: 'สุพรรณบุรี' }], ['U2', { province: '' }], ['U3', { province: '  ลพบุรี  ' }], ['U4', { province: 'สุพรรณบุรี' }]]);
const sessions = new Map([
  ['U1', { history: [{ r: 'u', t: 'ข้าวเป็นเพลี้ยกระโดด', at: now - 3600000 }] }],
  ['U4', { history: [{ r: 'u', t: 'อยู่ลพบุรีค่ะ', at: now - 4 * 86400000 }, { r: 'u', t: 'ตอนนี้อยู่ราชบุรี', at: now - 3600000 }, { r: 'b', t: 'พนักงานขาย จ.สุพรรณบุรี', at: now - 60000 }] }],
  ['U5', { history: [{ r: 'u', t: 'อยู่ลพบุรีค่ะ', at: now - 3 * 86400000 }] }],
]);
const make = (mode) => new Function('crm', 'sessions', 'provinceOf', 'REG_MODE', src + '\nreturn difyProvince;')(crm, sessions, provinceOf, mode);

// REGISTER=on/soft: the profile province, as before
const on = make('on');
assert.strictEqual(on('U1'), 'สุพรรณบุรี');
assert.strictEqual(on('U2'), '');
assert.strictEqual(on('U3'), 'ลพบุรี');
assert.strictEqual(on('unknown'), '');
// REGISTER=off: a member's profile province is not sent
const off = make('off');
assert.strictEqual(off('U1'), '', 'old member data must not pick the sales team');
// only what the customer typed within 48 hours, the latest one; the bot's own lines do not count
assert.strictEqual(off('U4'), 'ราชบุรี');
assert.strictEqual(off('U5'), '', 'a province typed 3 days ago is too old');
assert.strictEqual(off('unknown'), '');

console.log('PASS: Dify customer_province (profile province with registration on, only the province typed in chat within 48 h with registration off)');
