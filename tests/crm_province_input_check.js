'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert(/inputs: \{ customer_province: crmProvince\(sessionId\) \}/.test(server), 'askDify ยังไม่ส่งจังหวัดจาก CRM เข้า Dify');

// ดึงฟังก์ชันจริงจาก server.js มาทดสอบกับ CRM จำลอง
const src = server.match(/function crmProvince\(id\) \{[\s\S]*?\n\}/)[0];
const crm = new Map([
  ['U1', { province: 'สุพรรณบุรี' }],
  ['U2', { province: '' }],
  ['U3', { province: '  ลพบุรี  ' }],
]);
const crmProvince = new Function('crm', src + '; return crmProvince;')(crm);
assert.strictEqual(crmProvince('U1'), 'สุพรรณบุรี');
assert.strictEqual(crmProvince('U2'), '');
assert.strictEqual(crmProvince('U3'), 'ลพบุรี');
assert.strictEqual(crmProvince('unknown'), '');

console.log('PASS: Dify receives customer_province from CRM profile (empty when unknown)');
