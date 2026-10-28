'use strict';

// v3.50 (28 Oct 2026): สถิติคุณภาพคำตอบสำหรับงานตรวจรายวัน
const assert = require('assert');
const { createQuality } = require('../quality');

let clock = Date.parse('2026-10-28T10:00:00Z');
const q = createQuality({ now: () => clock });
q.record({ kind: 'text', ms: 25000, ok: true });
q.record({ kind: 'image', ms: 101000, ok: true, issues: ['Gemini วิเคราะห์บริบทและคำค้น (exception)'] });
q.record({ kind: 'image', ms: 45000, ok: false, fallback: 'no-answer', issues: ['จัดข้อมูลสินค้า/วิธีใช้ (failed)'], retries: ['จัดข้อมูลสินค้า/วิธีใช้'] });
q.record({ kind: 'voice', ms: 30000, ok: true, userText: 'ห้ามเก็บ', userId: 'Uxxx' });
let s = q.summary(24);
assert.strictEqual(s.turns, 4);
assert.strictEqual(s.fallbacks, 1);
assert.strictEqual(s.slowOver60s, 1);
assert.strictEqual(s.withNodeIssues, 2);
assert.deepStrictEqual(s.nodeIssues, { 'Gemini วิเคราะห์บริบทและคำค้น (exception)': 1, 'จัดข้อมูลสินค้า/วิธีใช้ (failed)': 1 });
assert.deepStrictEqual(s.nodeRetries, { 'จัดข้อมูลสินค้า/วิธีใช้': 1 });
assert.deepStrictEqual(s.byKind.image, { turns: 2, fallbacks: 1, slowOver60s: 1, withNodeIssues: 2 });
assert.strictEqual(s.lastProblems.length, 2);
assert.strictEqual(s.seconds.max, 101);
assert(!JSON.stringify(q.dump()).includes('ห้ามเก็บ') && !JSON.stringify(q.dump()).includes('Uxxx'), 'ห้ามเก็บข้อความหรือ userId ของลูกค้า');

// เก็บ/โหลดจากไฟล์ state ได้ และนับเฉพาะ 24 ชม. ล่าสุด
const q2 = createQuality({ now: () => clock });
q2.load(JSON.parse(JSON.stringify(q.dump())));
assert.strictEqual(q2.summary(24).turns, 4);
clock += 25 * 3600000;
q2.record({ kind: 'text', ms: 20000, ok: true });
s = q2.summary(24);
assert.strictEqual(s.turns, 1);
assert.strictEqual(s.fallbacks, 0);
assert.deepStrictEqual(s.lastProblems, []);
q2.load('not an array');
assert.strictEqual(q2.summary(24).turns, 1, 'ค่าที่ไม่ใช่ list ต้องไม่ล้างข้อมูลเดิม');
console.log('PASS: quality summary counts fallbacks, slow answers and Dify node issues per 24 hours without customer text');
