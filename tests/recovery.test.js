'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const recovery=require('../sales/recovery'),state=require('../sales/recovery_state'),ownership=require('../conversation_ownership');
const {buildCatalog}=require('../sales/catalog'),{harness}=require('./helpers/bridge_harness');
const catalog=buildCatalog(require('./fixtures/company-snapshot.json'));
function envelope(p,{text='ขอทราบรายละเอียดที่ต้องการเพิ่มค่ะ',updates=[],action={type:'none',explicit:false,source_refs:[]},recommended=[],claims=[],primary=null,...semantic}={}) {
  return {contract_version:'recovery-v1',trace_id:p.trace_id,semantic:{intent:'conversation',user_goal:'respond to latest',requires_redecision:false,rate_requested:false,image_requested:false,search_product_ids:[],needs_retrieval:false,retrieval_query:'',action,
    case_delta:{base_revision:p.state.revision,case_action:'continue',case_id:p.state.active_case_id,source_refs:[],updates},...semantic},
    response:{answer_template:text,recommended,primary_product_id:primary,image_product_ids:[],claim_refs:claims,questions:[]},decision:{candidate_assessment:[]},
    audit:{segments:text.split(/(\[\[fact:[^\]]+\]\]|\[\[handoff_ack\]\])/).filter(Boolean).map(text=>({text,kind:text.startsWith('[[fact:')?'fact':text==='[[handoff_ack]]'?'action':text.includes('ซีซี')?'dose':'conversation'})),limitations_visible:false}};
}
const source=p=>[{message_id:p.current_message.id,quote:p.current_message.text}];
const update=(p,field,value)=>({field,value,source_refs:source(p)});
test('recovery delegates all natural turns including complete recommendation, comparison, correction and handoff wording',async()=>{
  for(const query of ['ข้าวอายุ30วันยืนยันโรคไหม้แล้ว','เทียบสองตัวที่พูดถึง','ข้อมูลเมื่อกี้ผิด','คำว่าแอดมินในประกาศหมายถึงใคร']) {
    let called=0;
    const r=await recovery.run(query,{catalog,generate:async input=>{called++;const p=JSON.parse(input.prepared_context);return {answer:envelope(p,{text:'อธิบายตามความหมายล่าสุดค่ะ'}),conversation_id:'native-1'};}});
    assert.equal(called,1);assert.equal(r.response.answer_text,'อธิบายตามความหมายล่าสุดค่ะ');assert.equal(r.safe_fallback,false);
    assert.equal(r.conversation_id,'native-1');assert.deepEqual(r.response.question_required,[]);
  }
});
test('whole raw messages retain long tail and report bounded omissions',()=>{
  const long='ก'.repeat(900)+'ข้อแก้ไขที่ท้ายข้อความ';
  const h=state.boundedHistory([{id:'a',r:'u',t:long},{id:'b',r:'b',t:'ตอบ'}]);
  assert.equal(h.messages[0].text,long);
  const bounded=state.boundedHistory([{t:'a'.repeat(50)},{t:'b'.repeat(50)}],{maxChars:60});
  assert.equal(bounded.messages.length,1);assert.equal(bounded.omitted_messages,1);assert.equal(bounded.messages[0].text.length,50);
});
test('provenanced null/false corrections replace stale values and new cases start empty',()=>{
  const p=recovery.prepare('แก้ข้อมูลของแปลงนี้ค่ะ',{catalog});
  let delta=envelope(p,{updates:[update(p,'crop','นาข้าว'),update(p,'near_harvest',true)]}).semantic.case_delta;
  const first=state.applyDelta(p.state,delta,p);p.state=first;
  delta={...delta,base_revision:first.revision,updates:[update(p,'crop',null),update(p,'near_harvest',false)]};
  const corrected=state.applyDelta(first,delta,p);
  assert.equal(corrected.cases['case-1'].fields.crop.value,null);assert.equal(corrected.cases['case-1'].fields.near_harvest.value,false);
  p.state=corrected;delta={base_revision:corrected.revision,case_action:'new',case_id:'case-other',source_refs:source(p),updates:[]};
  const next=state.applyDelta(corrected,delta,p);assert.deepEqual(next.cases['case-other'].fields,{});assert.ok(next.cases['case-1']);
  assert.throws(()=>state.applyDelta(next,{...delta,base_revision:next.revision,case_action:'switch',case_id:'case-missing'},p),/unknown_case/);
});
test('forged and stale provenance cannot rewrite canonical state',()=>{
  const p=recovery.prepare('ข้อมูลใหม่',{catalog});const e=envelope(p,{updates:[{field:'crop',value:'นาข้าว',source_refs:[{message_id:'invented',quote:'ข้อมูลใหม่'}]}]});
  assert.deepEqual(recovery.validate(e,p,{catalog}).failures,['state_provenance']);
  e.semantic.case_delta.base_revision=88;assert.deepEqual(recovery.validate(e,p,{catalog}).failures,['state_revision_conflict']);
});
test('company fact slots preserve arbitrary AI prose; free fabricated rate and closed IDs fail',()=>{
  const p=recovery.prepare('ขนาดสินค้า',{catalog});const fact=Object.values(p.tools.claims).find(c=>c.field==='package');
  const r=recovery.validate(envelope(p,{text:'ตอบเฉพาะขนาดที่ถามนะคะ '+`[[fact:${fact.id}]]`,claims:[fact.id]}),p,{catalog});
  assert.deepEqual(r.failures,[]);assert.equal(r.response.answer_text,'ตอบเฉพาะขนาดที่ถามนะคะ '+fact.text);
  assert.ok(recovery.validate(envelope(p,{text:'ให้ใช้ 999 ซีซี ต่อน้ำหนึ่งถังค่ะ'}),p,{catalog}).failures.includes('unverified_prose_dose'));
  const bad=envelope(p);bad.response.image_product_ids=['unknown'];assert.ok(recovery.validate(bad,p,{catalog}).failures.includes('closed_unknown_product'));
});
test('one evidence repair preserves new prose and never substitutes legacy plan or questions',async()=>{
  let n=0;
  const r=await recovery.run('คำถามต่อ',{catalog,generate:async input=>{
    const p=JSON.parse(input.prepared_context);n++;
    if(n===1)return {answer:envelope(p,{text:'ใช้ 987 ซีซี ค่ะ'}),conversation_id:'repair-conversation'};
    assert.ok(p.repair.failures.includes('unverified_prose_dose'));assert.equal(input.conversation_id,'repair-conversation');
    return {answer:envelope(p,{text:'ข้อมูลที่แก้ทำให้ต้องพิจารณาใหม่ค่ะ'}),conversation_id:'repair-conversation'};
  }});
  assert.equal(n,2);assert.equal(r.response.answer_text,'ข้อมูลที่แก้ทำให้ต้องพิจารณาใหม่ค่ะ');assert.deepEqual(r.response.question_required,[]);
});
test('semantic exposure uses critical stop while arbitrary customer words never bypass AI',async()=>{
  const r=await recovery.run('รายละเอียดอาการในรอบนี้',{catalog,generate:async input=>{const p=JSON.parse(input.prepared_context);return {answer:envelope(p,{updates:[update(p,'exposure',true)],text:'ตรวจอาการค่ะ'})};}});
  assert.ok(r.response.answer_text.includes('1367'));assert.equal(r.metrics.attempts.length,1);
});
test('native conversation and state commit are app/release scoped and ownership stale-safe',()=>{
  const session={};ownership.beginTurn(session);const opts={appId:'staging',releaseId:'r1'};
  const snap=state.snapshot(session,opts);
  assert.equal(state.commit(session,snap,{context:{...snap.state,revision:1},conversation_id:'a'}),true);
  assert.equal(state.snapshot(session,opts).conversation_id,'a');
  assert.equal(state.snapshot(session,{...opts,releaseId:'r2'}).conversation_id,'');
  const stale=state.snapshot(session,opts);ownership.transition(session,'HUMAN_ACTIVE',{actor:'admin'});
  assert.equal(state.commit(session,stale,{context:{...stale.state,revision:2},conversation_id:'stale'}),false);
  assert.equal(session.recovery.conversation_id,'a');
  ownership.transition(session,'BOT_RESUME',{actor:'admin',summary:'สรุปใหม่ที่มีเนื้อหา'});ownership.beginTurn(session);
  assert.equal(state.snapshot(session,opts).conversation_id,'');assert.equal(state.snapshot(session,opts).state.revision,1);
});
test('every direct bot-active edge and whitespace resume is rejected',()=>{
  for(const human of ['HUMAN_REQUESTED','HUMAN_ACTIVE','BOT_ASSIST_ONLY']) {
    const s={};ownership.ensure(s);ownership.transition(s,human,{actor:'admin'});
    assert.throws(()=>ownership.transition(s,'BOT_ACTIVE',{actor:'admin',expectedVersion:s.ownership.version}),/legal_resume_required/);
    for(const summary of ['', ' \n\t '])assert.throws(()=>ownership.transition(s,'BOT_RESUME',{actor:'admin',summary}),/resume_summary_required/);
    ownership.transition(s,'BOT_RESUME',{actor:'admin',summary:'สรุปใหม่'});
    assert.throws(()=>ownership.transition(s,'BOT_ACTIVE',{actor:'admin'}),/legal_resume_required/);
    assert.equal(ownership.canSend(s,ownership.beginTurn(s)),true);
  }
});
test('actual handler sends persisted conversation ID, avoids keyword handoff and keeps long history',async()=>{
  const requests=[];
  const h=harness({recovery:true,onGenerate:async payload=>{requests.push(payload);const p=JSON.parse(payload.inputs.prepared_context);return {answer:JSON.stringify(envelope(p,{text:'คำตอบจาก AI ค่ะ'})),conversation_id:'native-session'};}});
  await h.api.refreshProductMaster();
  const long='ก'.repeat(850)+'ไม่ได้ขอให้คุยกับแอดมิน';
  await h.api.handleEvent(h.event(long));await h.api.handleEvent(h.event('เล่าต่อ'));
  assert.equal(requests.length,2);assert.equal(requests[0].conversation_id,'');assert.equal(requests[1].conversation_id,'native-session');
  assert.ok(JSON.parse(requests[1].inputs.prepared_context).history.messages.some(m=>m.text===long));
  const s=h.api.sessions.get('staging-only-user');assert.equal(s.ownership.state,'BOT_ACTIVE');assert.equal(s.recovery.state.revision,2);
  assert.ok(JSON.parse(h.api.stateJson()).sessions[0][1].recovery.conversation_id==='native-session');
});
test('actual handler applies only sourced explicit structured handoff before acknowledgment',async()=>{
  const h=harness({recovery:true,onGenerate:async payload=>{const p=JSON.parse(payload.inputs.prepared_context);return {answer:JSON.stringify(envelope(p,{text:'[[handoff_ack]]',action:{type:'handoff',explicit:true,source_refs:source(p)}})),conversation_id:'native'};}});
  await h.api.refreshProductMaster();await h.api.handleEvent(h.event('ต้องการให้คนช่วยตอบตอนนี้'));
  const s=h.api.sessions.get('staging-only-user');assert.equal(s.ownership.state,'HUMAN_REQUESTED');assert.ok(s.cb);
  assert.ok(h.sent.flat().some(m=>m.text?.includes('รับเรื่องให้ทีมงานแล้ว')));
  const before=h.sent.length;await h.api.handleEvent(h.event('ถามอีกครั้ง'));assert.equal(h.sent.length,before);
});
test('actual handler late generation after takeover cannot write ID/state or send',async()=>{
  let started,release;const entering=new Promise(r=>started=r),waiting=new Promise(r=>release=r);
  const h=harness({recovery:true,onGenerate:async payload=>{started();await waiting;return {answer:JSON.stringify(envelope(JSON.parse(payload.inputs.prepared_context))),conversation_id:'late-id'};}});
  await h.api.refreshProductMaster();const pending=h.api.handleEvent(h.event('คำถามที่ต้องใช้ AI'));await entering;
  const s=h.api.sessions.get('staging-only-user');ownership.transition(s,'HUMAN_ACTIVE',{actor:'admin'});release();await pending;
  assert.equal(s.recovery,undefined);assert.equal(h.sent.length,0);
});
test('rapid overlapping handler turns commit only newest ID/state',async()=>{
  let entered,release;const start=new Promise(r=>entered=r),wait=new Promise(r=>release=r);let n=0;
  const inputs=[];
  const h=harness({recovery:true,onGenerate:async payload=>{inputs.push(payload.conversation_id);const seq=++n;if(seq===1){entered();await wait;}const p=JSON.parse(payload.inputs.prepared_context);return {answer:JSON.stringify(envelope(p,{text:'คำตอบรอบ '+seq})),conversation_id:'id-'+seq};}});
  const existing={history:[]};ownership.ensure(existing);h.api.sessions.set('staging-only-user',existing);
  const snap=state.snapshot(existing,{appId:'ed28c981-1c94-4547-9003-aefa5e98aaf4'});
  state.commit(existing,snap,{context:snap.state,conversation_id:'existing-native'});
  await h.api.refreshProductMaster();const first=h.api.handleEvent(h.event('รอบแรก'));await start;
  await h.api.handleEvent(h.event('แก้ในรอบสอง'));release();await first;
  const s=h.api.sessions.get('staging-only-user');assert.equal(s.recovery.conversation_id,'id-2');assert.equal(h.sent.length,1);assert.ok(h.sent[0][0].text.includes('2'));
  assert.deepEqual(inputs,['existing-native',''],'overlap must not let a late remote answer contaminate the accepted native conversation');
});
module.exports={envelope,source,update};

test('evidence-scoped product discussion and non-diagnostic recommendations do not require a pest checklist',()=>{
  const p=recovery.prepare('สนใจแนวทางบำรุง',{catalog});
  const point=Object.values(p.tools.claims).find(c=>c.field==='selling_point');
  const name=point.product_id+':name';
  const recommendation={product_id:point.product_id,usage_ref:null,mode:'recommendation',basis:{type:'company_product',claim_refs:[point.id]},reason:'AI assessed the product suitability from the actual company property'};
  const e=envelope(p,{text:`แนวทางที่พิจารณาได้ค่ะ [[fact:${name}]]`,claims:[name],recommended:[recommendation],primary:point.product_id});
  e.decision.candidate_assessment=[{product_id:point.product_id,eligible:true,suitability_group:'same-use',reasons:['company property supports this decision']}];
  assert.deepEqual(recovery.validate(e,p,{catalog}).failures,[]);
  e.response.recommended[0]={...recommendation,mode:'conditional_discussion',basis:{type:'conditional_discussion',claim_refs:[name]}};
  e.response.primary_product_id=null;e.audit.limitations_visible=true;
  const r=recovery.validate(e,p,{catalog});assert.deepEqual(r.failures,[]);assert.deepEqual(r.response.product_ids_recommended,[]);assert.deepEqual(r.response.discussed_product_ids,[point.product_id]);
});
test('semantic prose audit blocks unknown company/staff/status claims and accepts ordinary agronomic measurements',()=>{
  const p=recovery.prepare('รายละเอียดทั่วไป',{catalog});
  for(const kind of ['company_claim','staff_claim','status_claim','dose','registration','phi','action_claim']) {
    const e=envelope(p,{text:'a free unsupported assertion'});e.audit.segments=[{text:e.response.answer_template,kind}];
    assert.ok(recovery.validate(e,p,{catalog}).failures.includes('unverified_prose_'+kind));
  }
  const e=envelope(p,{text:'ตรวจความชื้นหน้าดินลึก 5 เซนติเมตรค่ะ'});e.audit.segments[0].kind='general_agronomy';
  assert.deepEqual(recovery.validate(e,p,{catalog}).failures,[]);
  e.audit.segments[0].text='partial';assert.ok(recovery.validate(e,p,{catalog}).failures.includes('prose_audit_coverage'));
});
test('derived area/water quantities use verified units, package ceiling and approved severity labels',()=>{
  const {calculationClaims}=require('../sales/recovery_tools');
  const fields={area_rai:{value:170,source_refs:[{message_id:'m',quote:'170'}]},water_liters:{value:200,source_refs:[{message_id:'m',quote:'200'}]}};
  const claims=Object.values(calculationClaims(catalog,fields));
  const approved=require('../sales/company_overrides.json').severity_rates;
  const area=claims.find(c=>approved[c.product_id]&&c.text.includes('34 กระสอบ')&&c.text.includes('57 กระสอบ'));
  assert.ok(area);assert.equal(area.basis.field,'area_rai');assert.ok(area.text.includes(approved[area.product_id].low_label));assert.ok(area.text.includes(approved[area.product_id].high_label));
  const water=claims.find(c=>c.basis.field==='water_liters');assert.ok(water);
  const row=catalog.products.get(water.product_id).usage.find(u=>u.ref===water.source_ref);
  const expected=Number((Number(row.rate_min)*200/Number(row.rate_basis_value)).toFixed(6));assert.ok(water.text.includes('ใช้ '+expected));
  const onlyArea=calculationClaims(catalog,{area_rai:fields.area_rai});assert.ok(!Object.values(onlyArea).some(c=>c.basis.field==='water_liters'));
  assert.deepEqual(calculationClaims(catalog,{water_liters:{value:-1}}),{});
  const broken=buildCatalog(require('./fixtures/company-snapshot.json'));
  for(const p of broken.products.values())for(const u of p.usage)u.rate_basis_unit='unsupported-unit';
  assert.deepEqual(calculationClaims(broken,fields),{});
});
test('Bridge recomputes calculation token from state and rejects usage/equipment mismatch',()=>{
  const {calculationClaims}=require('../sales/recovery_tools');
  const p=recovery.prepare('ข้อมูลที่ยืนยันสำหรับการคำนวณ',{catalog});
  const u=[...catalog.products.values()].flatMap(product=>product.usage.map(usage=>({product,usage}))).find(x=>x.product.open&&x.usage.rate_verified&&x.usage.rate_basis_unit==='ไร่');
  const updates=[update(p,'crop',u.usage.crop_name||u.usage.crop_group),update(p,'target',u.usage.target_name),update(p,'stage',u.usage.crop_stage),update(p,'equipment',u.usage.application_equipment),update(p,'area_rai',170)];
  const id=u.product.product_id+':calculation:'+u.usage.ref;
  const e=envelope(p,{text:`ผลคำนวณค่ะ [[fact:${id}]]`,claims:[id],updates,rate_requested:true});
  const checked=recovery.validate(e,p,{catalog});assert.deepEqual(checked.failures,[]);
  const derived=calculationClaims(catalog,checked.next.cases['case-1'].fields)[id];assert.equal(checked.response.answer_text,'ผลคำนวณค่ะ '+derived.text);
  e.semantic.case_delta.updates.find(x=>x.field==='equipment').value='wrong equipment';
  assert.ok(recovery.validate(e,p,{catalog}).failures.includes('rate_usage_unresolved'));
});
test('consumed admin summary cannot overwrite a later customer correction',()=>{
  const p=recovery.prepare('ข้อมูลปัจจุบัน',{catalog,ownership:{state:'BOT_ACTIVE',version:5,summary:'ข้อมูลเก่า'}});
  const first=state.applyDelta(p.state,envelope(p,{updates:[update(p,'crop','นาข้าว')]}).semantic.case_delta,p);p.state=first;
  const e=envelope(p,{updates:[{field:'crop',value:'อ้อย',source_refs:[{message_id:p.admin_context.id,quote:'ข้อมูลเก่า'}]}]});
  assert.ok(recovery.validate(e,p,{catalog}).failures.includes('stale_state_source'));
});
test('admin ownership API rejects direct active jump and blank resume under real auth boundary',async()=>{
  const h=harness({recovery:true});const s={history:[]};h.api.sessions.set('owner',s);ownership.transition(s,'HUMAN_ACTIVE',{actor:'admin'});
  for(const body of [{id:'owner',state:'BOT_ACTIVE',version:s.ownership.version},{id:'owner',state:'BOT_RESUME',version:s.ownership.version,summary:' \t'}]) {
    let status;
    h.api.handleAdmin({method:'POST',url:'/admin/api/sales/ownership',headers:{'x-admin-key':'test-fixture-only'}},{writeHead:s=>status=s,end(){}},'/admin/api/sales/ownership',Buffer.from(JSON.stringify(body)));
    assert.equal(status,409);assert.equal(s.ownership.state,'HUMAN_ACTIVE');
  }
});
