'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildCatalog}=require('../sales/catalog'),{run}=require('../sales/pipeline');
const snapshot=require('./fixtures/company-snapshot.json'),images=require('../product_images/index.json');
const catalog=buildCatalog(snapshot,images);
test('all 89 catalog identities follow the same open/status/formula rules in final LINE payload',async()=>{
 let count=0,remote=0;
 for(const p of catalog.products.values()) {
  const answer=await run(p.canonical_name+' คือสารอะไร',{catalog,generate:async()=>{remote++;throw Error('lookup must be deterministic')}});
  assert.equal(answer.failures.length,0,p.product_id);
  const text=answer.messages.map(m=>m.text).join('');
  if(p.open)assert.ok(text.includes(p.common_name_th),p.product_id+' exact company formula');
  else assert.ok(!text.includes(p.canonical_name),p.product_id+' closed name must not leak');
  count++;
 }
 assert.equal(count,89);assert.equal(remote,0);
});
test('every product changes to closed safely without editing any name-based guard',async()=>{
 for(const p of catalog.products.values()) {
  const changed=JSON.parse(JSON.stringify(snapshot)),row=changed.master.find(r=>r[0]===p.product_id);
  row[14]='ยังไม่เปิด';
  const closed=buildCatalog(changed,images);
  const r=await run(p.canonical_name+' คือสารอะไร',{catalog:closed,generate:async()=>{throw Error('closed must be deterministic')}});
  assert.ok(!r.messages.map(m=>m.text).join('').includes(p.canonical_name),p.product_id);
 }
});
