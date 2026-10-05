'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { rememberButtons, clearButtons, remainingButtons } = require('../image_buttons');

const files = { 'โมเดิน 50': 'p001.png', 'ไบเตอร์': 'p002.png', 'ไฮซีส': 'p003.png' };
const fileOf = (n) => files[n];
const s = { pimgSent: {} };

// คำตอบเสนอ 3 ปุ่ม
rememberButtons(s, ['โมเดิน 50', 'ไบเตอร์', 'ไฮซีส']);
// กดดูรูปตัวแรก: bridge บันทึกว่าส่งรูปแล้ว ปุ่มที่เหลือต้องเป็นอีก 2 ตัว
s.pimgSent['p001.png'] = Date.now();
assert.deepStrictEqual(remainingButtons(s, fileOf), ['ไบเตอร์', 'ไฮซีส']);
// กดตัวที่สอง: เหลือ 1
s.pimgSent['p002.png'] = Date.now();
assert.deepStrictEqual(remainingButtons(s, fileOf), ['ไฮซีส']);
// กดตัวสุดท้าย: ไม่มีปุ่ม
s.pimgSent['p003.png'] = Date.now();
assert.deepStrictEqual(remainingButtons(s, fileOf), []);

// ถามเรื่องอื่นหลังมีปุ่มค้าง: ปุ่มชุดเดิมต้องหมดอายุ
const s2 = { pimgSent: {} };
rememberButtons(s2, ['โมเดิน 50', 'ไบเตอร์']);
clearButtons(s2);
s2.pimgSent['p001.png'] = Date.now();
assert.deepStrictEqual(remainingButtons(s2, fileOf), []);

// session เก่าที่ยังไม่มี pimgPending ต้องไม่ error
assert.deepStrictEqual(remainingButtons({}, fileOf), []);

// server.js ต้องต่อ logic นี้ทั้งตอนเสนอปุ่ม ตอนกดดูรูป และตอนลูกค้าถามเรื่องใหม่
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert(server.includes('imageButtons.rememberButtons(s, buttons)'), 'pimgPlan ยังไม่จำปุ่มที่เสนอ');
assert(/pimgAttachButtons\(tapImgs, imageButtons\.remainingButtons\(s/.test(server), 'การกดดูรูปยังไม่แนบปุ่มที่เหลือ');
assert(server.includes('imageButtons.clearButtons(s)'), 'ข้อความใหม่ยังไม่ล้างปุ่มชุดเดิม');

console.log('PASS: image buttons persist 3 -> 2 -> 1 -> 0 and expire on a new question');
