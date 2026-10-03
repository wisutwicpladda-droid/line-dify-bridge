'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const snapshot = require('./fixtures/company-snapshot.json');
const { identities } = require('../product_identity');
const { guardUnreleasedProducts, UNAVAILABLE } = require('../unreleased_guard');
const { compactResponse } = require('../response_compactor');
const { renderMessages, batches } = require('../line_renderer');
test('closed alias and missing status fail closed', () => {
  const ids = identities(snapshot.master);
  assert.equal(ids.resolve('คริซ่า').product_id, 'P0006');
  for (const name of ['คริซ่า', 'คริซ่า (ไม่มีรูป)', '"คริซ่า"']) assert.equal(guardUnreleasedProducts('แนะนำ '+name, snapshot.master), UNAVAILABLE);
  assert.equal(guardUnreleasedProducts('แนะนำยา', []), UNAVAILABLE);
});
test('final LINE payload preserves all content through multiple batches', () => {
  const answer = ('ข้อมูลประกอบสำหรับเกษตรกร\n'.repeat(1200)) + '\nยังแยกโรคจากน้ำขังไม่ได้ ห้ามผสมสารเอง\nอัตราต้องยืนยันจากบริษัท\nน้ำลดหรือยังคะ และรากมีสีอะไรคะ';
  const payload = renderMessages(compactResponse(answer, 'ช่วยหน่อย'));
  assert.equal(payload.map(x=>x.text).join(''), answer);
  assert.ok(payload.length > 5); assert.ok(payload.every(x=>x.text.length<=4900));
  assert.equal(batches(payload).flat().map(x=>x.text).join(''),answer);
});
test('concentration variants not merged', () => {
  const ids=identities(snapshot.master), a=ids.resolve('โบร์แลน'), b=ids.resolve('โบร์แลน 2.85');
  assert.ok(a && b); assert.notEqual(a.product_id,b.product_id);
  assert.deepEqual(ids.mentions('ขอรูปโบร์แลน 2.85').map(p=>p.product_id),[b.product_id]);
});

