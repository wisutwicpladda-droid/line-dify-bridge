'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const snapshot=require('./fixtures/company-snapshot.json'),images=require('../product_images/index.json');
const {buildCatalog}=require('../sales/catalog'),catalog=buildCatalog(snapshot,images);
const {run}=require('../sales/pipeline'),{extract,result}=require('../sales/router');
const {EventLedger}=require('../sales/event_ledger');
const {StagingKnowledgeSync}=require('../sales/knowledge_sync');
const {imageRequest,imagePlan}=require('../sales/images');
test('new crop does not inherit previous age/product/target',()=>{
 const prev=extract('ข้าว 10 วัน หญ้าข้าวนก ใช้แกนเตอร์ไหม',catalog);
 const ctx=extract('มะม่วงใบเหลือง',catalog,prev);
 assert.equal(ctx.age_days,undefined);assert.equal(ctx.target,null);assert.equal(ctx.product_ids.length,0);
});
test('duplicate event is suppressed; redelivery of an unseen event can be processed',()=>{
 const x=new EventLedger();assert.equal(x.claim('a'),true);assert.equal(x.claim('a'),false);
 const recovered=new EventLedger(x.snapshot());assert.equal(recovered.claim('a'),false);assert.equal(recovered.claim('new-redelivery'),true);
});
test('a stale KB never calls generation, but exact latest catalog fact remains fast',async()=>{
 let calls=0;const opts={catalog,strictKnowledgeVersion:true,knowledgeRelease:{status:'ready',catalogVersion:'old'},generate:async()=>{calls++;}};
 const deep=await run('ทุเรียนใบเหลือง',opts);assert.equal(deep.metrics.route,'knowledge_not_ready');
 const fast=await run('ไบเตอร์คือสารอะไร',opts);assert.equal(fast.metrics.route,'fast');assert.equal(calls,0);
});
test('current registration without trusted provenance cannot reach LINE',async()=>{
 const r=await run('ไบเตอร์ขึ้นทะเบียนทุเรียนไหม',{catalog,generate:async()=>result('ขึ้นทะเบียนแน่นอนค่ะ','regulatory')});
 assert.ok(r.failures.includes('current_fact_requires_verified_evidence'));
 assert.ok(!r.messages[0].text.includes('แน่นอน'));
});
test('month-based usage is never compared as if its number meant days',()=>{
 const {stageMatch}=require('../sales/candidates');
 assert.equal(stageMatch('1-2 เดือน',{age_days:60,age_months:2}),'match');
 assert.equal(stageMatch('1-2 เดือน',{age_days:2}),'unknown');
 assert.equal(stageMatch('7-12 วัน และกักน้ำไว้อีก 20-30 วัน',{age_days:25}),'mismatch');
});
test('unknown product named as a recommendation cannot escape metadata checks',async()=>{
 const r=await run('แนะนำยา',{catalog,generate:async()=>result('แนะนำ "สินค้าสมมุติที่ไม่มีจริง"','product')});
 assert.ok(r.failures.includes('unknown_named_product'));assert.ok(!r.messages[0].text.includes('สินค้าสมมุติ'));
});
test('image dedup uses product ID and explicit requests can resend',()=>{
 const req=imageRequest('ขอรูปเลกาซี20',catalog);assert.deepEqual(req.ids,['P0013']);
 const args={catalog,response:{image_product_ids:['P0013']},publicUrl:'https://staging.invalid',sent:{P0013:Date.now()}};
 assert.equal(imagePlan({...args,query:'ขอบคุณ'}).images.length,0);
 assert.equal(imagePlan({...args,query:'ขอรูปอีกที'}).images[0].originalContentUrl,'https://staging.invalid/img/p/p010.png');
});
test('isolated KB sync waits for indexing completion, versions release, preserves model settings',async()=>{
 const calls=[];let polls=0;
 const sync=new StagingKnowledgeSync({enabled:true,pause:async()=>{},api:async(method,path,body)=>{
  calls.push({method,path,body});
  if(method==='POST')return{status:200,data:{batch:'b'}};
  if(path.includes('indexing-status'))return{status:200,data:{data:[{id:'doc',indexing_status:++polls===2?'completed':'indexing'}]}};
  return {status:200,data:{data:[{id:'doc',name:'ICP-STAGING-20261003.md',enabled:true}]}};
 }});
 const st=await sync.sync({catalogVersion:'fixture',text:'fixture'});
 assert.equal(st.status,'ready');assert.equal(st.catalogVersion,'fixture');assert.equal(polls,2);
 assert.deepEqual(Object.keys(calls.find(x=>x.method==='POST').body).sort(),['name','text']);
});
test('failed indexing or stale index job cannot be promoted',async()=>{
 for(const complete of [false,true]){
 const sync=new StagingKnowledgeSync({enabled:true,pause:async()=>{},api:async(method,path)=>method==='POST'?{status:200,data:{batch:'b'}}:
  path.includes('indexing-status')?{status:200,data:{data:[{id:'doc',indexing_status:complete?'completed':'error'}]}}:
  {status:200,data:{data:[{id:'doc',name:'ICP-STAGING-20261003.md',enabled:true}]}}});
 assert.equal((await sync.sync({catalogVersion:'fixture',text:'x',isCurrent:()=>false})).status,'unavailable');
 }
});
