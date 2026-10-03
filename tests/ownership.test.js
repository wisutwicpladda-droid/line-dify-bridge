'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const o=require('../conversation_ownership'),{deliver}=require('../delivery');
test('admin takeover while model pending drops final LINE payload',async()=>{
  const s={},t=o.beginTurn(s),payloads=[];
  let finish;const pending=new Promise(r=>finish=r);
  const work=(async()=>{await pending;return deliver({content:'คำตอบเก่า',canSend:()=>o.canSend(s,t),reply:async p=>{payloads.push(p);return true},push:async()=>true});})();
  o.transition(s,'HUMAN_ACTIVE',{actor:'admin'});finish();
  assert.equal((await work).status,'dropped_stale');assert.equal(payloads.length,0);
});
test('takeover between batches prevents remaining messages',async()=>{
  const s={},t=o.beginTurn(s),out=[];
  const r=await deliver({content:Array(12).fill('ข้อความ'),canSend:()=>o.canSend(s,t),
    reply:async p=>{out.push(...p);o.transition(s,'HUMAN_ACTIVE',{actor:'admin'});return true},push:async p=>{out.push(...p);return true}});
  assert.equal(r.status,'dropped_stale');assert.equal(out.length,5);
});
test('human ownership does not expire and explicit admin summary is required',()=>{
  const s={mutedUntil:Date.now()+1};o.ensure(s);const t=o.beginTurn(s);s.mutedUntil=0;
  assert.equal(o.canSend(s,t),false);
  assert.throws(()=>o.transition(s,'BOT_RESUME',{actor:'customer',summary:''}));
  assert.throws(()=>o.transition(s,'BOT_RESUME',{actor:'admin'}));
  o.transition(s,'BOT_RESUME',{actor:'admin',summary:'แอดมินยืนยันให้ตรวจแปลงก่อน'});
  assert.equal(o.canSend(s,o.ticket(s)),true);
});

