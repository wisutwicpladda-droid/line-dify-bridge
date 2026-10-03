'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildCatalog}=require('../sales/catalog'),snapshot=require('./fixtures/company-snapshot.json');
const catalog=buildCatalog(snapshot,require('../product_images/index.json'));
const {prepare,run}=require('../sales/pipeline'),{finalPayload}=require('../sales/contracts');
const {defaultPlan}=require('../sales/claims'),{extract,result}=require('../sales/router');
const {EvidenceProvider,shouldSearch}=require('../sales/external_evidence');
const {groundingLeads,verifyReviewedClaims,Discovery}=require('../sales/evidence_discovery');
const {verifyStaging,audienceAllowed}=require('../sales/staging_identity');
const noModel=async()=>{throw Error('unexpected model call');};

test('comparison after pest recommendation keeps both requested ingredients, not prior primary recommendation',async()=>{
 const first=await run('ข้าว 10 วัน มีหญ้าข้าวนก ใช้อะไรดี',{catalog,generate:noModel});
 const compared=await run('แกนเตอร์กับอนิลการ์ดต่างกันอย่างไร',{catalog,previous:first.context,generate:noModel});
 assert.equal(compared.metrics.intent,'comparison');
 assert.equal(compared.metrics.route,'structured');
 for(const id of compared.context.product_ids)assert.ok(compared.response.answer_text.includes(catalog.products.get(id).common_name_th));
 assert.equal(compared.context.product_ids.length,2);
 assert.ok(compared.response.answer_text.startsWith('จุดต่างจากข้อมูลบริษัท'));
 assert.equal(compared.response.primary_product_id,null);
});
test('every open catalog ingredient answer is question-scoped, source-backed, zero model calls',async()=>{
 for(const p of catalog.products.values()){
  const r=await run(p.canonical_name+' คือสารอะไร',{catalog,generate:noModel});
  assert.equal(r.failures.length,0,p.canonical_name+': '+r.failures);
  if(p.open){assert.ok(r.response.answer_text.includes(p.common_name_th),p.canonical_name);assert.ok(r.response.claim_refs?.length);assert.ok(r.prepared.allowed_product_claims.every(c=>c.field==='active_ingredient'&&c.source_ref&&c.product_id===p.product_id));}
  else assert.ok(!r.response.answer_text.includes(p.canonical_name));
  assert.equal(r.metrics.route,'fast');assert.equal(r.metrics.query_llm_planned,false);
 }
});
test('raw prose cannot leak unsupported company/PHI/pollinator claims even with valid answer_plan',()=>{
 const w=prepare('ทุเรียนช่วงดอกบาน มีเพลี้ยไฟ',{catalog});
 const raw={answer_plan:defaultPlan(w),answer_text:'ไบเตอร์ปลอดภัยต่อผึ้ง ใช้ทุกระยะ PHI 1 วัน ขึ้นทะเบียนแล้ว ใช้ 999 ซีซี'};
 const r=finalPayload(raw,w);assert.equal(r.prose_removed,true);assert.equal(r.failures.length,0);
 assert.ok(!/999|PHI 1|ปลอดภัยต่อผึ้ง|ขึ้นทะเบียนแล้ว/.test(r.response.answer_text));
 for(const x of w.requiredWarnings)assert.ok(r.response.answer_text.includes(x));
});
test('unlisted claims and answered-question references cannot pass the constrained renderer',()=>{
 const w=prepare('ทุเรียนรากดำและมีกลิ่น น้ำลดแล้ว',{catalog});
 for(const changed of [{claim_refs:['invented']},{question_ids:['root_color']},{guidance_ids:['spray_unknown']}]){
  const r=finalPayload({answer_plan:{...defaultPlan(w),...changed}},w);assert.ok(r.failures.length);assert.ok(r.safe_fallback);assert.ok(!r.response.answer_text.includes('รากเปลี่ยนเป็นสีอะไร'));
 }
});
test('three-turn followup preserves answered water/root/onset facts and asks only missing fields',async()=>{
 let previous={};const outputs=[];
 for(const q of ['ทุเรียนเหี่ยวหลังน้ำขัง','เพิ่งเป็นหลังน้ำขัง 3 วัน รากดำและมีกลิ่น','น้ำลดแล้ว เป็นบางต้น ไม่ได้พ่นยา ยังไม่ได้ใส่ปุ๋ย']){
  const r=await run(q,{catalog,previous,generate:async({prepared_context})=>({answer_plan:defaultPlan(prepare(q,{catalog,previous}))})});previous=r.context;outputs.push(r);
 }
 assert.equal(previous.facts.values.root_color.value,'ดำ');assert.ok(previous.facts.values.root_smell);assert.ok(previous.facts.values.onset);
 assert.ok(previous.facts.values.water_condition.value.includes('น้ำลดแล้ว'));
 assert.ok(!outputs[2].prepared.question_options.some(q=>['water_condition','root_color','root_smell','onset','distribution','recent_spray','recent_fertilizer'].includes(q.field)));
});
test('contradiction asks only changed fact and crop change resets irrelevant facts',()=>{
 const first=extract('ทุเรียนรากดำและมีกลิ่น',catalog);
 const next=prepare('รากขาวค่ะ',{catalog,previous:first});
 assert.deepEqual(next.prepared.question_options.map(q=>q.id),['confirm_root_color']);
 const corrected=extract('แก้ไข รากขาวค่ะ',catalog,next.context);assert.equal(corrected.facts.values.root_color.value,'ขาว');
 const drained=extract('น้ำลดแล้ว',catalog,first),history=extract('เพิ่งเป็นหลังน้ำขัง 3 วัน รากดำและมีกลิ่น',catalog,drained);
 assert.equal(history.facts.values.water_condition.value,'น้ำลดแล้ว/ไม่มีน้ำขัง');
 const changed=extract('ข้าว 10 วัน หญ้าข้าวนก',catalog,first);assert.equal(changed.facts.values.root_color,undefined);
});
test('approved alias comparison and ambiguity are deterministic; no dangerous fuzzy alias',async()=>{
 assert.equal(catalog.index.resolve('อนิลการ์ด').product_id,'P0081');assert.equal(catalog.index.resolve('อนิลกาาด'),null);
 const r=await run('แกนเตอร์กับอนิลการ์ดต่างกันอย่างไร',{catalog,generate:noModel});assert.equal(r.failures.length,0);assert.equal(r.metrics.route,'structured');
 assert.ok(r.response.answer_text.includes('อะนิลการ์ด'));assert.ok(r.response.answer_text.includes('แกนเตอร์'));
 const amb=buildCatalog(snapshot,{}, {P0034:['ชื่อซ้ำ'],P0081:['ชื่อซ้ำ']});
 const a=await run('ชื่อซ้ำคือสารอะไร',{catalog:amb,generate:noModel});assert.ok(a.response.answer_text.includes('มากกว่าหนึ่งรายการ'));assert.equal(a.response.primary_product_id,null);
});
test('unknown spelling is queued as unreviewed hash, not auto-trained or fuzzy-resolved',async()=>{
 const r=await run('ยาชื่อ อนิลกาาด',{catalog,generate:async()=>result('น้องลัดดาขอชื่อบนฉลากเพิ่มเติมค่ะ','general_agriculture')});
 assert.equal(r.metrics.alias_review.auto_apply,false);assert.equal(r.metrics.alias_review.spelling_hash.length,64);assert.equal(r.metrics.alias_review.product_name_token,'อนิลกาาด');assert.ok(!JSON.stringify(r.metrics.alias_review).includes('ยาชื่อ'));
});
test('persona checks bot text while preserving quoted customer ครับ',()=>{
 const w=prepare('IPM คืออะไร',{catalog});
 assert.ok(finalPayload(result('ได้ครับ','general_agriculture'),w).failures.includes('persona_mismatch'));
 const r=finalPayload(result('คุณแจ้งว่า "อยากรู้ครับ" น้องลัดดาขออธิบายค่ะ','general_agriculture'),w);assert.equal(r.failures.length,0);assert.ok(r.response.answer_text.includes('ครับ'));
});
test('company package/status/features/ingredient never route to web',()=>{
 for(const q of ['ไบเตอร์ขนาดอะไร','ไบเตอร์สถานะขาย','ไบเตอร์จุดเด่นอะไร','ไบเตอร์คือสารอะไร']){const w=prepare(q,{catalog});assert.equal(shouldSearch(w.context,w.candidates),false);}
});
test('concurrent source fetches deduplicate, cache and absolute deadline bounds stalled fetchers',async()=>{
 let calls=0;const p=new EvidenceProvider({enabled:true,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {body:Buffer.from('source')};}});
 const a=await Promise.all([p.source('reviewed'),p.source('reviewed'),p.source('reviewed')]);assert.equal(calls,1);assert.equal(a[0],a[1]);await p.source('reviewed');assert.equal(calls,1);
 const stuck=new EvidenceProvider({enabled:true,deadlineMs:25,fetcher:()=>new Promise(()=>{})});const start=Date.now();await assert.rejects(stuck.source('reviewed'),/absolute_deadline/);assert.ok(Date.now()-start<500);assert.equal(stuck.inflight.size,0);
});
test('grounding metadata is unverified discovery, missing snippet/source does not become evidence',async()=>{
 const c={crop:'ทุเรียน',target:'เพลี้ยไฟ'};const leads=groundingLeads({groundingChunks:[{web:{uri:'https://www.doa.go.th/example',title:'official'}}],groundingSupports:[{groundingChunkIndices:[0],segment:{text:'source excerpt'}}]},c);
 assert.equal(leads.length,1);assert.equal(leads[0].verified,false);assert.equal(leads[0].query_fingerprint.length,64);
 assert.equal(groundingLeads({groundingChunks:[{web:{uri:'https://www.doa.go.th/example',title:'official'}}]},c).length,0);
 assert.equal((await new Discovery().search(c)).feature_enabled,false);
});
test('contradictory verified sources fail closed instead of majority/model guessing',()=>{
 const e={evidence_id:'a',verified:true,document_hash:'hash',source_ref:'p1',claim:'permitted',claim_type:'registration',active_ingredient:'a',formulation:'SC',concentration:['5%'],crop:'ข้าว',target:'เพลี้ยไฟ',jurisdiction:'TH',retrieved_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),source_url:'https://www.doa.go.th/example'};
 const out=verifyReviewedClaims([e,{...e,evidence_id:'b',claim:'not permitted'}]);assert.equal(out.status,'conflict');assert.equal(out.evidence.length,0);assert.equal(out.conflicts.length,2);
});
test('startup refuses mismatched bot/app/catalog/KB/replicas before serving and restricts test audience',async()=>{
 const env={AI_SALES_ENVIRONMENT:'staging',AI_SALES_DIFY_APP_ID:'ed28c981-1c94-4547-9003-aefa5e98aaf4',AI_SALES_REPLICAS:'1',AI_SALES_EXPECTED_LINE_ID:'@test',AI_SALES_TESTER_IDS:'tester',AI_SALES_EXPECTED_CATALOG_VERSION:catalog.version};
 const opts={env,catalog,knowledge:{status:'ready',catalogVersion:catalog.version},lineInfo:async()=>({status:200,data:{basicId:'@test'}}),difyInfo:async()=>({status:200,data:{name:'น้องลัดดา AI Sales STAGING 20261003'}})};
 assert.equal((await verifyStaging(opts)).verified,true);
 for(const key of ['AI_SALES_ENVIRONMENT','AI_SALES_DIFY_APP_ID','AI_SALES_REPLICAS','AI_SALES_EXPECTED_LINE_ID','AI_SALES_EXPECTED_CATALOG_VERSION'])await assert.rejects(verifyStaging({...opts,env:{...env,[key]:'wrong'}}));
 await assert.rejects(verifyStaging({...opts,knowledge:{status:'ready',catalogVersion:'old'}}));
 await assert.rejects(verifyStaging({...opts,difyInfo:async()=>({status:200,data:{name:'production'}})}));
 assert.ok(audienceAllowed(env,{type:'user',userId:'tester'}));assert.ok(!audienceAllowed(env,{type:'group',userId:'tester'}));assert.ok(!audienceAllowed(env,{type:'user',userId:'customer'}));
});
