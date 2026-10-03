'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {harness}=require('./helpers/bridge_harness');
test('real Bridge handlers: greeting and lookup bypass remote LLM and preserve rate through final LINE transport',async()=>{
  const h=harness();await h.api.refreshProductMaster();
  await h.api.handleEvent(h.event('สวัสดีค่ะ'));
  await h.api.handleEvent(h.event('ไบเตอร์ คือสารอะไร'));
  await h.api.handleEvent(h.event('นาแดน-จี 170 ไร่ ใช้อัตราเท่าไร'));
  const texts=h.sent.flat().filter(m=>m.type==='text').map(m=>m.text).join('\n');
  assert.ok(texts.includes('ไบเฟนทริน'));assert.ok(texts.includes('34 กระสอบ'));assert.ok(texts.includes('57 กระสอบ'));
  assert.equal(h.calls.filter(x=>x.host==='api.dify.ai').length,0);
});
test('real Bridge image request Legacy maps only to yellow box product ID',async()=>{
  const h=harness();await h.api.refreshProductMaster();await h.api.handleEvent(h.event('ขอรูปเลกาซี20'));
  const images=h.sent.flat().filter(m=>m.type==='image');
  assert.equal(images.length,1);assert.ok(images[0].originalContentUrl.endsWith('/p010.png'));
});
test('real Bridge exposure works before registration and never calls model',async()=>{
  const h=harness({register:'on'});await h.api.refreshProductMaster();await h.api.handleEvent(h.event('ยาฆ่าแมลงเข้าตา'));
  assert.ok(h.sent.flat().some(m=>m.text?.includes('1669')));
  assert.ok(!h.sent.flat().some(m=>m.text?.includes('ลงทะเบียน')));
  assert.equal(h.calls.filter(x=>x.host==='api.dify.ai').length,0);
});
test('real Bridge ownership blocks all customer sends while admin active',async()=>{
  const h=harness();await h.api.refreshProductMaster();await h.api.handleEvent(h.event('สวัสดีค่ะ'));
  const s=h.api.sessions.get('staging-only-user');require('../conversation_ownership').transition(s,'HUMAN_ACTIVE',{actor:'admin'});
  const before=h.sent.length;await h.api.handleEvent(h.event('ไบเตอร์คือสารอะไร'));assert.equal(h.sent.length,before);
});
test('real webhook HMAC rejects invalid signature without side effects',()=>{
  const h=harness(),req=new EventEmitter();req.method='POST';req.url='/webhook';req.headers={'x-line-signature':'invalid'};
  let status;h.http()(req,{writeHead(s){status=s},end(){}});
  req.emit('data',Buffer.from('{"events":[]}'));req.emit('end');assert.equal(status,401);assert.equal(h.sent.length,0);
});

