'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const snapshot=require('./fixtures/company-snapshot.json'),images=require('../product_images/index.json');
const {buildCatalog,CatalogStore,companyFacts}=require('../sales/catalog');
const {selectCandidates,stageMatch}=require('../sales/candidates');
const {extract,result,fastAnswer,boundedContext}=require('../sales/router');
const {run,prepare}=require('../sales/pipeline');
const {finalPayload}=require('../sales/contracts');
const {OptionalClassifier}=require('../sales/optional_classifier');
const {stageKnowledge}=require('../sales/knowledge_release');
const {dealerReferral,preference,learningEvent}=require('../sales/foundation');
const catalog=buildCatalog(snapshot,images),p=id=>catalog.products.get(id);
const checked=(r,context={},extra={})=>finalPayload(r,{catalog,context:{intent:'general',product_ids:[],...context},...extra});
test('01 symptom uncertainty survives final payload and forbids chemical recommendation',()=>{
  const ctx=extract('ทุเรียนใบเหลือง โคนเน่า',catalog);assert.equal(ctx.diagnosis_uncertain,true);
  const out=checked(result('แนะนำ "ไบเตอร์"','symptom',{product_ids_recommended:['P0062']}),ctx);
  assert.ok(out.failures.includes('diagnosis_gate'));assert.ok(!out.messages[0].text.includes('ไบเตอร์'));
});
test('02 beetle ambiguity requests external analysis, no automatic insecticide choice',()=>{
  const w=prepare('แมลงปีกแข็งในทุเรียนช่วงดอกใช้สารอะไร',{catalog});
  assert.equal(w.context.needs_web,true);assert.equal(w.candidates.primary_product_id,null);
});
test('03 insufficient symptoms permit multiple discriminating questions',()=>{
  const q=['น้ำขังหรือไม่คะ','เริ่มเป็นส่วนไหนคะ'];const out=checked(result('ยังต้องแยกสาเหตุค่ะ '+q.join(' '),'symptom',{question_required:q}),{diagnosis_uncertain:true},{requiredQuestions:q});
  assert.equal(out.failures.length,0);assert.ok(out.messages[0].text.includes(q[1]));
});
test('04 known pest does not fabricate symptoms or restart diagnosis',()=>{
  const ctx=extract('เพลี้ยไฟลงทุเรียน ใช้อะไร',catalog);assert.equal(ctx.intent,'known_problem');assert.equal(ctx.target,'เพลี้ยไฟ');assert.equal(ctx.diagnosis_uncertain,false);
});
test('05 missing age considers all intervals and blocks final choice',()=>{
  const c=selectCandidates(catalog,{crop:'ข้าว',target:'หญ้าข้าวนก'});
  assert.equal(c.primary_product_id,null);assert.ok(c.pending.length>1);
  assert.equal(stageMatch('7-12 วัน',{age_days:25}),'mismatch');
});
test('06 unknown inventory is never claimed available',()=>{
  assert.equal(dealerReferral({active:true,verified_at:'2026-10-03',dealer_id:'test'},null).stock,'unknown');
  assert.equal(dealerReferral(null).available,false);
});
test('07 closed product leakage blocked in final LINE payload for aliases and images',()=>{
  for(const name of ['คริซ่า','คริซ่า (ไม่มีรูป)'])for(let i=0;i<3;i++){
    const out=checked(result(name+' ใช้ได้','product',{image_product_ids:['P0006']}));assert.ok(out.failures.length);assert.ok(!out.messages[0].text.includes(name));
  }
});
test('08 suitable candidates sorted by business priority independent of prose',()=>{
  const cases=[{crop:'ข้าว',target:'หญ้าข้าวนก',age_days:10},{crop:'ข้าว',target:'ข้าวดีด',age_days:9},{crop:'ทุเรียน',target:'เพลี้ยไฟ',stage:'ทุกระยะ'}];
  for(const ctx of cases){const c=selectCandidates(catalog,ctx);assert.ok(c.eligible.length);assert.equal(c.eligible[0].rank,Math.min(...c.eligible.map(x=>x.rank)));}
  const grass=selectCandidates(catalog,cases[0]);assert.equal(grass.eligible[0].product_id,'P0034');
});
test('09 missing crop can produce evidence-based conditional candidates for nutrition too',()=>{
  const prod=[...catalog.products.values()].find(p=>p.canonical_name==='บอมส์ ไวท์');
  const e={id:'ev1',verified:true,scope:'active_ingredient',source:'https://example.edu/evidence',retrieved_at:'2026-10-03',claim:'TEST FIXTURE ONLY',active_ingredient:prod.active_ingredient,formulation:prod.physical_form,crop:'พืชทดสอบ',target:'ทดสอบ',confidence:'high'};
  assert.ok(selectCandidates(catalog,{crop:'พืชทดสอบ',target:'ทดสอบ'},[e]).conditional.some(p=>p.product_id===prod.product_id));
  assert.equal(selectCandidates(catalog,{crop:'พืชทดสอบ',target:'ทดสอบ'},[e]).primary_product_id,null);
  const reviewed={...e,stage:'all',stage_verified:true,safety_reviewed:true};
  assert.equal(selectCandidates(catalog,{crop:'พืชทดสอบ',target:'ทดสอบ'},[reviewed]).primary_product_id,prod.product_id);
});
test('10 evidence formula/target mismatch cannot become candidate',()=>{
  const e={verified:true,scope:'active_ingredient',source:'https://example.edu',retrieved_at:'2026-10-03',claim:'fixture',active_ingredient:'wrong',formulation:'น้ำ',crop:'พืชทดสอบ',target:'ทดสอบ',confidence:'high'};
  assert.equal(selectCandidates(catalog,{crop:'พืชทดสอบ',target:'ทดสอบ'},[e]).conditional.length,0);
});
test('11 fabricated company rate blocked even with real usage reference',()=>{
  const prod=[...catalog.products.values()].find(p=>p.usage.some(u=>u.rate_verified)),u=prod.usage.find(u=>u.rate_verified);
  const out=checked(result('ใช้ 99999 ซีซี ต่อ 20 ลิตร','rate',{rate_refs:[u.ref]}),{intent:'rate',rate_requested:true,product_ids:[prod.product_id],query:'อัตรา'});
  assert.ok(out.failures.includes('dose_not_deterministically_verified'));
});
test('12 conflicting or stale sources cannot replace current status',()=>{
  const out=checked(result('แนะนำคริซ่า ตามข้อมูลเก่า','known_problem',{product_ids_recommended:['P0006']}));
  assert.ok(out.failures.includes('closed_unknown_product'));
});
test('13 competitor uses web route without invented product identity',()=>{assert.equal(extract('มียาคล้ายหมาแดงไหม',catalog).intent,'competitor');});
test('14 ambiguous/unknown brand is not fuzzy-replaced',()=>{assert.equal(catalog.index.resolve('โมเวนโต้'),null);assert.ok(catalog.index.resolve('โมเวนทัส'));});
test('15 comparison is separate from symptom diagnosis',()=>{assert.equal(extract('ไบเตอร์ ต่างจาก โมเดิน 50 อย่างไร',catalog).intent,'comparison');});
test('16 handoff request has explicit action and no sales content',()=>{const r=fastAnswer(extract('ขอคุยกับแอดมิน',catalog),catalog);assert.equal(r.handoff_action,'request');assert.equal(r.product_ids_recommended.length,0);});
test('18 greeting avoids all remote calls',async()=>{let calls=0;const r=await run('สวัสดีค่ะ',{catalog,generate:async()=>{calls++;}});assert.equal(calls,0);assert.equal(r.metrics.route,'fast');});
test('19 followup retains product and rate intent',()=>{const first=extract('โมเดิน 50 ใช้อัตราเท่าไร',catalog);const next=extract('แล้วน้ำ 200 ลิตรล่ะ',catalog,first);assert.deepEqual(next.product_ids,first.product_ids);assert.equal(next.rate_requested,true);});
test('20 required warnings and questions cannot disappear',()=>{
  const out=checked(result('ใช้ได้ค่ะ','known_problem'),{},{requiredWarnings:['ห้ามผสมเอง'],requiredQuestions:['อายุเท่าไรคะ']});
  assert.ok(out.failures.includes('warning_lost'));assert.ok(out.failures.includes('question_lost'));
});
test('21 dealer contract requires active verified record, separate stock',()=>{assert.equal(dealerReferral({active:false,verified_at:'x'}).available,false);});
test('22 Jev 401 is not retried and opens circuit until config changed',async()=>{
  let n=0;const j=new OptionalClassifier({enabled:true,call:async()=>{n++;return{status:401}}});
  assert.equal((await j.classify('input','fallback')).status,'auth_error');
  assert.equal((await j.classify('input','fallback')).status,'circuit_open');assert.equal(n,1);
});
test('23 unavailable KB/company catalog does not invent product facts',async()=>{
  const r=await run('ไบเตอร์คืออะไร',{catalog:null,generate:async()=>result('แนะนำคริซ่า','product',{product_ids_recommended:['P0006']})});
  assert.ok(r.failures.includes('catalog_unavailable'));
});
test('24 unavailable grounding falls back without registration/PHI claims',async()=>{
  const r=await run('ทะเบียนล่าสุด PHI เท่าไร',{catalog,generate:async()=>{throw Error('offline')}});
  assert.ok(r.response.answer_text.includes('ยังตรวจข้อมูล'));assert.equal(r.response.evidence_refs.length,0);
});
test('25 failed refresh retains last good until explicit max age',()=>{
  const s=new CatalogStore({maxAgeMs:100});s.promote(snapshot,images);const v=s.current.version;
  assert.throws(()=>s.promote({master:[],usage:[],packages:[]},images));assert.equal(s.current.version,v);
  assert.equal(s.get(s.current.loaded_at+101),null);
});
test('26 bounded history excludes injected catalog blobs',()=>{
  const h=Array.from({length:30},()=>({r:'u',t:'[ข้อมูลตรวจสอบภายใน]'+ 'x'.repeat(25000)}));
  assert.equal(boundedContext(h).recent.length,0);
});
test('27 rate basis preserved, no plus sign or guessed unit',async()=>{
  const r=await run('นาแดน-จี 170 ไร่ ใช้อัตราเท่าไร',{catalog,generate:async()=>{throw Error('unexpected')}});
  assert.ok(!/50\+/.test(r.response.answer_text));assert.equal(r.failures.length,0);
  assert.ok(r.messages[0].text.includes('34 กระสอบ'));assert.ok(r.messages[0].text.includes('57 กระสอบ'));
  assert.ok(r.messages[0].text.includes('3–5 กิโลกรัม ต่อ 1 ไร่'));
});
test('28 canonical image files are tied to same product ID',()=>{assert.deepEqual(p('P0062').images,['p080.png']);assert.deepEqual(p('P0013').images,['p010.png']);});
test('29 exposure bypasses remote generation and all product recommendations',async()=>{const r=await run('ยาฆ่าแมลงเข้าตา',{catalog:null,generate:async()=>{throw Error('must not call')}});assert.equal(r.metrics.route,'fast');assert.ok(r.messages[0].text.includes('1669'));});
test('30 current registration routes search',()=>{assert.equal(extract('ไบเตอร์ขึ้นทะเบียนทุเรียนไหม',catalog).needs_web,true);});
test('31 indexing must complete before promotion; shared live KB rejected',async()=>{
  let n=0;await assert.rejects(()=>stageKnowledge({datasetId:'af225749-33cc-4f0a-ae49-934ada9af79f'}));
  await assert.rejects(()=>stageKnowledge({datasetId:'staging',upload:async()=>({documentId:'1'}),status:async()=>({status:'error'}),promote:async()=>n++}));
  assert.equal(n,0);
});
test('32 internal groups and injected rates do not reach final LINE',()=>{
  const r=checked(result('Expand ใช้ 999 ซีซี ต่อไร่','known_problem'));assert.ok(r.failures.includes('internal_or_format_leak'));assert.ok(!r.messages[0].text.includes('Expand'));
});
test('communication preference never infers age/generation; learning is not approved ground truth',()=>{
  assert.throws(()=>preference('short'));assert.equal(preference('short',{source:'customer_explicit',explicit:true}).explicit,true);
  const e=learningEvent('admin_correction',{trace_id:'test',redacted_text:'text'});assert.equal(e.approved_ground_truth,false);assert.equal(e.redacted_text,undefined);
});
