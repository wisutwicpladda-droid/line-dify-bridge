'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildCatalog}=require('../sales/catalog'),catalog=buildCatalog(require('./fixtures/company-snapshot.json'),require('../product_images/index.json'));
const {prepare,run}=require('../sales/pipeline'),{result,extract}=require('../sales/router');
const {validateResponse,finalPayload,repairTypes}=require('../sales/contracts');
const {EvidenceProvider,compatible,shouldSearch,sourceTier}=require('../sales/external_evidence');
const {selectCandidates,stageMatch}=require('../sales/candidates');
const {learningEvent,evaluationExport,EVENT_TYPES}=require('../sales/foundation');
const {harness}=require('./helpers/bridge_harness');
test('contract validates every array element, primary scalar and handoff enum',()=>{
 const w=prepare('ไบเตอร์คือสารอะไร',{catalog});
 for(const k of ['warnings_required','question_required','rate_refs','evidence_refs','product_ids_recommended','image_product_ids'])
  assert.ok(validateResponse(result('ตรวจสอบค่ะ','product',{[k]:[{}]}),w).includes('invalid_'+k));
 assert.ok(validateResponse(result('ตรวจสอบค่ะ','product',{primary_product_id:3}),w).includes('invalid_primary'));
 assert.ok(validateResponse(result('ตรวจสอบค่ะ','product',{handoff_action:'sell_now'}),w).includes('invalid_handoff'));
});
test('repair is restricted to empty containers and cannot invent missing fields or IDs',()=>{
 const r=repairTypes(result('ตรวจสอบค่ะ','product',{question_required:null,uncertainty:null}));assert.deepEqual(r.question_required,[]);assert.equal(r.uncertainty,'');
 assert.equal(repairTypes({}).answer_text,undefined);
 assert.ok(finalPayload('raw prose',prepare('ทุเรียนใบเหลือง',{catalog})).failures.includes('invalid_json'));
});
test('invalid output fallback preserves mandatory flowering/harvest warnings',()=>{
 for(const q of ['ทุเรียนช่วงดอกบาน มีเพลี้ยไฟ','ทุเรียนอีก 7 วันจะเก็บเกี่ยว ฉีดเพลี้ยไฟได้ไหม']) {
  const w=prepare(q,{catalog}),f=finalPayload('not json',w);for(const v of w.requiredWarnings)assert.ok(f.messages.map(m=>m.text).join('').includes(v));
 }
});
test('human state rejects even otherwise valid facts at validator and delivery boundary',()=>{
 for(const state of ['HUMAN_ACTIVE','HUMAN_REQUESTED','BOT_ASSIST_ONLY'])assert.equal(finalPayload(result('คำตอบ','product'),prepare('ไบเตอร์คือสารอะไร',{catalog,ownership:{state}})).messages.length,0);
});
test('rate references are restricted to actual prepared scope, not all company usage',()=>{
 const w=prepare('นาแดน-จี 170 ไร่ใช้กี่กระสอบ',{catalog});
 const wrong=[...catalog.products.values()].flatMap(p=>p.usage).find(u=>u.rate_verified&&!w.prepared.allowed_rates.some(x=>x.ref===u.ref));
 assert.ok(validateResponse(result('ยังต้องตรวจค่ะ','rate',{rate_refs:[wrong.ref]}),w).includes('rate_outside_prepared_scope'));
});
test('pending PHI/flowering risk cannot select a primary; harvest days are not plant age',()=>{
 for(const q of ['ทุเรียนช่วงดอกบาน มีเพลี้ยไฟ','อีก 7 วันจะเก็บเกี่ยวทุเรียน ฉีดเพลี้ยไฟได้ไหม']) {
  const w=prepare(q,{catalog});assert.equal(w.candidates.primary_product_id,null);assert.ok(w.requiredWarnings.length);
  if(w.context.near_harvest)assert.equal(w.context.age_days,undefined);
 }
});
test('diagnosis uncertainty blocks an active chemical recommendation without product metadata',()=>{
 const w=prepare('ทุเรียนใบเหลือง',{catalog});const f=finalPayload(result('ใช้เมทาแลกซิลราดโคนค่ะ','symptom'),w);
 assert.ok(f.failures.includes('diagnosis_gate'));assert.ok(!f.messages[0].text.includes('เมทาแลกซิล'));
});
test('source ranking, formulation and concentration never collapse incompatible products',()=>{
 assert.equal(sourceTier('https://www.doa.go.th/test'),1);assert.equal(sourceTier('https://doa.go.th.evil.example/test'),99);
 assert.equal(sourceTier('http://www.doa.go.th/test'),99);
 const records=require('../sales/evidence_sources.json');assert.equal(compatible(records[0],catalog.products.get('P0070')),true);
 assert.equal(compatible(records[1],catalog.products.get('P0029')),false);
 assert.equal(compatible({...records[0],concentration:['25%']},catalog.products.get('P0070')),false);
});
test('PHI numbers cannot bypass provenance in a known-problem followup',()=>{
 const w=prepare('อีก 7 วันจะเก็บเกี่ยวทุเรียน ฉีดกำจัดเพลี้ยไฟได้ไหม',{catalog});
 const r=result('สารส่วนใหญ่มีระยะหยุดพ่นก่อนเก็บเกี่ยว (PHI) ประมาณ 7–14 วันขึ้นไป '+w.requiredWarnings.join(' '),'known_problem',{warnings_required:w.requiredWarnings});
 const f=finalPayload(r,w);assert.ok(f.failures.includes('unverified_phi_claim'));assert.ok(f.failures.includes('uncertainty_lost'));assert.ok(!f.response.answer_text.includes('7–14'));
});
test('recommendation metadata cannot bypass unresolved selection by omitting primary ID',()=>{
 const w=prepare('ข้าว 10 วัน มีหญ้าข้าวนก ใช้อะไรดี',{catalog});
 const r=result('แนะนำ "แกนเตอร์" ค่ะ '+w.requiredWarnings.join(' '),'known_problem',{product_ids_recommended:['P0034'],warnings_required:w.requiredWarnings});
 assert.ok(finalPayload(r,w).failures.includes('missing_primary_decision'));
 const unresolved={...w,candidates:{...w.candidates,primary_product_id:null}};
 assert.ok(finalPayload(r,unresolved).failures.includes('candidate_decision_unresolved'));
});
test('active evidence is not proof that an ICP product is or is not registered',()=>{
 const w=prepare('ข้าวโพดมีเพลี้ยกระโดดท้องขาว ใช้ไพรซีนได้ไหม',{catalog});
 for(const claim of ['ยังไม่มีการขึ้นทะเบียนสำหรับข้าวโพด','มีการขึ้นทะเบียนแล้ว','ข้อมูลทะเบียนและคำแนะนำการใช้ของบริษัทปัจจุบันได้รับการรับรองเฉพาะในนาข้าว']){
  const f=finalPayload(result(claim,'product'),w);assert.ok(f.failures.includes('unverified_product_label_claim'));assert.ok(f.response.answer_text.includes('ยังตรวจยืนยันทะเบียน'));
 }
});

test('rejected recommendations are not recorded as final recommendation events',async()=>{
 const r=await run('ข้าว 10 วัน มีหญ้าข้าวนก ใช้อะไรดี',{catalog,generate:async()=>result('ใช้ 999 ซีซี ต่อไร่','known_problem',{primary_product_id:'P0034',product_ids_recommended:['P0034']})});
 assert.equal(r.metrics.planned_primary_product_id,'P0034');assert.equal(r.metrics.primary_product_id,null);assert.ok(r.failures.length);
});
test('near-harvest cannot substitute an unverified biological treatment for a chemical',()=>{
 const w=prepare('อีก 7 วันจะเก็บเกี่ยวทุเรียน ฉีดกำจัดเพลี้ยไฟได้ไหม',{catalog});
 const r=result('แนะนำให้ใช้ชีวภัณฑ์ เช่น เชื้อราบิวเวอเรียค่ะ '+w.requiredWarnings.join(' '),'known_problem',{warnings_required:w.requiredWarnings});
 const f=finalPayload(r,w);assert.ok(f.failures.includes('unverified_high_risk_treatment'));assert.ok(!f.response.answer_text.includes('บิวเวอเรีย'));assert.ok(f.response.answer_text.includes(w.requiredWarnings[0]));
});
test('event duration is not crop age and a known flowering/harvest stage is not requested again',()=>{
 const water=prepare('ทุเรียนเพิ่งเป็นหลังน้ำขัง 3 วัน รากดำ',{catalog});
 assert.equal(water.context.age_days,undefined);
 assert.equal(prepare('เพิ่งเป็นหลังน้ำขัง 3 วัน รากดำและมีกลิ่นค่ะ',{catalog,previous:{crop:'ทุเรียน',diagnosis_uncertain:true}}).context.diagnosis_uncertain,true);
 for(const q of ['ทุเรียนช่วงดอกบาน มีเพลี้ยไฟ ใช้อะไรดี','อีก 7 วันจะเก็บเกี่ยวทุเรียน ฉีดกำจัดเพลี้ยไฟได้ไหม']){
  const p=prepare(q,{catalog});assert.ok(!p.requiredQuestions.some(q=>q.includes('อายุเท่าไร')));assert.equal(p.candidates.primary_product_id,null);
 }
});
test('all explicitly listed crop-age windows remain eligible without treating water duration as crop age',()=>{
 const {stageMatch}=require('../sales/candidates');
 const stage='8-10 วันหลังหว่านข้าว และกักน้ำไว้อีกอย่างน้อย 10 วัน 20-25 วันหลังหว่านข้าว และกักน้ำไว้อีกอย่างน้อย 10 วัน';
 assert.equal(stageMatch(stage,{age_days:9}),'match');assert.equal(stageMatch(stage,{age_days:22}),'match');assert.equal(stageMatch(stage,{age_days:15}),'mismatch');
});
test('external provider disabled, unknown source, changed document and outage fail closed',async()=>{
 const ctx={crop:'ข้าวโพด',target:'เพลี้ยกระโดดท้องขาว'};
 assert.equal((await new EvidenceProvider().search(ctx)).status,'disabled');
 const changed=await new EvidenceProvider({enabled:true,fetcher:async()=>({body:Buffer.from('changed')})}).search(ctx);
 assert.equal(changed.evidence.length,0);assert.equal(changed.failures[0].reason,'reviewed_section_missing');
 const edited=await new EvidenceProvider({enabled:true,fetcher:async()=>({body:Buffer.from('การป้องกันกำจัด หมั่นสำรวจ altered content Post navigation')})}).search(ctx);
 assert.equal(edited.evidence.length,0);assert.equal(edited.failures[0].reason,'source_changed_requires_review');
 const failed=await new EvidenceProvider({enabled:true,fetcher:async()=>{throw Error('network unavailable')}}).search(ctx);assert.equal(failed.evidence.length,0);
});
test('company-only fast intents never trigger external search or model',async()=>{
 for(const q of ['สวัสดี','ขอบคุณ','ขอแอดมิน','ไบเตอร์คือสารอะไร','นาแดน-จีขนาดบรรจุ','ขอรูปเลกาซี20','นาแดน-จี 170 ไร่ใช้กี่กระสอบ']) {
  const r=await run(q,{catalog,evidenceProvider:{search(){throw Error('unnecessary search')}},generate(){throw Error('unnecessary model')}});assert.equal(r.metrics.route,'fast');assert.deepEqual(r.failures,[]);
 }
});
test('all six exposure types preserve first aid in real handler final payload, three runs each',async()=>{
 for(const q of ['เผลอกินยาฆ่าแมลง','สูดดมสารแล้วเวียนหัว','ยาฆ่าแมลงกระเด็นเข้าตา','ยาฆ่าหญ้าโดนผิวหนัง','แมวเลียยาฆ่าแมลง','พ่นยาแล้วคลื่นไส้'])for(let n=0;n<3;n++){
  const h=harness({register:'on'});await h.api.handleEvent(h.event(q));const text=h.sent.flat().map(m=>m.text||'').join('');
  assert.ok(text.includes(q.includes('แมว')?'สัตวแพทย์':'1367'));assert.ok(text.includes('อาเจียน'));
  assert.equal(h.calls.filter(c=>c.host==='api.dify.ai').length,0);
 }
});
test('learning supports all required event types and export excludes transcript and customer identity',()=>{
 const events=[...EVENT_TYPES].map(t=>learningEvent(t,{trace_id:'fixture-trace',customer_line_id:'must-not-export',redacted_text:'do-not-export'},{consent:true}));
 const out=evaluationExport(events,{from:'2026-10-01T00:00:00Z',to:'2026-10-31T00:00:00Z'});
 assert.ok(events.some(e=>e.type==='failure'));assert.equal(out.auto_train,false);assert.ok(!JSON.stringify(out).includes('do-not-export'));assert.ok(!JSON.stringify(out).includes('must-not-export'));
 assert.ok(out.rows.every(e=>e.approved_ground_truth===false));
});
