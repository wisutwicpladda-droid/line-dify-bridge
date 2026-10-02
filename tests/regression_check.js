'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const prompt = fs.readFileSync(path.join(root, 'work', 'main_prompt_p86.txt'), 'utf8');
const dsl = fs.readFileSync(path.join(root, 'dify', 'app_b_hybrid_p86.yml'), 'utf8');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'regression_cases.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(cases.length >= 15, 'ต้องมี regression อย่างน้อย 15 เคส แต่พบ ' + cases.length);
const checkNames = new Set(cases.flatMap(function(c) { return c.checks; }));
[
  'company_product', 'active_ingredient', 'general_agriculture', 'pest',
  'no_fabricated_icp', 'competitor_search', 'flowering_risk', 'rate_from_company_data',
  'web_current', 'conversation_context'
].forEach(function(required) {
  assert(checkNames.has(required), 'ขาด coverage: ' + required);
});
['greeting_route', 'complaint_route', 'emergency_route', 'weed_reasoning', 'unreleased_guard'].forEach(function(required) {
  assert(checkNames.has(required), 'ขาด coverage: ' + required);
});
['farmer_first', 'likely_pest', 'beetle_reasoning', 'contact_explanation', 'systemic_explanation', 'direct_answer', 'natural_explanation'].forEach(function(required) {
  assert(checkNames.has(required), 'ขาด critical coverage: ' + required);
});

assert(prompt.includes('ความรู้เกษตรทั่วไปของโมเดล'), 'prompt ยังไม่เปิดความรู้ทั่วไปของโมเดล');
assert(prompt.includes('Google Search Grounding'), 'prompt ยังไม่มี web routing');
assert(prompt.includes('แหล่งอ้างอิง'), 'prompt ยังไม่มีกติกา citation');
assert(prompt.includes('ถ้าลูกค้าไม่ได้ถามอัตรา'), 'prompt ยังมี rate policy ไม่ชัด');
assert(prompt.includes('ready_to_recommend ไม่ใช่ gate'), 'prompt ยังใช้ ready เป็น gate');
assert(prompt.includes('Expand, Skyrocket, Natural, Cosmic-star, Standard'), 'prompt ยังไม่มี internal group guard');
assert(prompt.includes('ปัญหาที่เห็น → สิ่งที่น่าจะเป็น'), 'prompt ยังไม่เป็น farmer-first');
assert(!prompt.includes('ถามต่อไปเรื่อย ๆ ทีละรอบ'), 'prompt ยังมี diagnosis gate แบบ legacy');
assert(!prompt.includes('จนเหลือสาเหตุเดียว'), 'prompt ยังบังคับ confidence 100%');

assert(dsl.includes('intent_guidance'), 'DSL ไม่มี output intent_guidance');
assert(dsl.includes('web_needed'), 'DSL ไม่มี web_needed routing');
assert(dsl.includes('risk'), 'DSL ไม่มี risk intent');
assert(bridge.includes('stripVisibleCitations'), 'bridge ไม่มี visible-citation guard');
assert(bridge.includes('visibleCitations: false'), 'bridge ยังเปิดการแสดง citation');
assert(bridge.includes('RATE_ONLY_WHEN_ASKED'), 'bridge ไม่มี rate guard');

console.log('PASS: regression contract ' + cases.length + ' cases; p86 prompt/DSL and bridge safeguards present');
