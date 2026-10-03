'use strict';
const assert=require('assert'),{compactResponse}=require('../response_compactor');
const text='ข้อมูลประกอบ\\n'.repeat(150)+'ยังแยกโรคไม่ได้ ห้ามผสมสารเอง\\nน้ำลดหรือยังคะ';
assert.equal(compactResponse(text,'ช่วยหน่อย'),text);
console.log('PASS: no semantic content removed');
