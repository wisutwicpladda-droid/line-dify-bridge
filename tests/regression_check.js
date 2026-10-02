'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const prompt = fs.readFileSync(path.join(root, 'work', 'main_prompt_p77.txt'), 'utf8');
const dsl = fs.readFileSync(path.join(root, 'dify', 'app_b_hybrid_p77.yml'), 'utf8');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'regression_cases.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(cases.length === 10, 'ต้องมี regression 10 เคส แต่พบ ' + cases.length);
const checkNames = new Set(cases.flatMap(function(c) { return c.checks; }));
[
  'company_product', 'active_ingredient', 'general_agriculture', 'pest',
  'no_fabricated_icp', 'competitor_search', 'flowering_risk', 'rate_from_company_data',
  'web_current', 'conversation_context'
].forEach(function(required) {
  assert(checkNames.has(required), 'ขาด coverage: ' + required);
});

assert(prompt.includes('ความรู้ทั่วไปของโมเดลช่วยอธิบายได้'), 'prompt ยังไม่เปิดความรู้ทั่วไปของโมเดล');
assert(prompt.includes('Google Search Grounding'), 'prompt ยังไม่มี web routing');
assert(prompt.includes('แหล่งอ้างอิง'), 'prompt ยังไม่มีกติกา citation');
assert(prompt.includes('อัตราใช้ อัตราส่วน ปริมาณน้ำ จำนวนไร่ และจำนวนบรรจุ ให้แสดงเมื่อผู้ใช้ถามเท่านั้น'), 'prompt ยังมี rate policy ไม่ชัด');
assert(prompt.includes('intent checklist'), 'prompt ยังไม่รับ intent checklist');
assert(prompt.includes('Expand, Skyrocket, Natural, Cosmic-star หรือ Standard'), 'prompt ยังไม่มี internal group guard');

assert(dsl.includes('intent_guidance'), 'DSL ไม่มี output intent_guidance');
assert(dsl.includes('web_needed'), 'DSL ไม่มี web_needed routing');
assert(dsl.includes('risk'), 'DSL ไม่มี risk intent');
assert(bridge.includes('extractDifySources'), 'bridge ไม่มี source extraction');
assert(bridge.includes('appendDifyCitations'), 'bridge ไม่มี citation forwarding');
assert(bridge.includes('RATE_ONLY_WHEN_ASKED'), 'bridge ไม่มี rate guard');
assert(bridge.includes('retriever_resources'), 'bridge ต้องระบุและกัน retriever_resources ไม่ให้ถูกเปิดเผย');

console.log('PASS: regression contract 10 cases; p77 prompt/DSL and bridge safeguards present');
