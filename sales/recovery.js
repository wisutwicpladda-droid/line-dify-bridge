'use strict';
// Recovery semantic authority lives in Dify. This module checks contracts/data, not Thai intent.
const crypto=require('node:crypto');
const {renderMessages}=require('../line_renderer');
const state=require('./recovery_state');
const {verifiedTools,calculationClaims}=require('./recovery_tools');
const {parseResponse}=require('./contracts');
const {stageMatch}=require('./candidates'); // Applied to trusted usage labels + AI state, never to raw user text.
const FALLBACK='น้องลัดดายังตรวจยืนยันคำตอบรอบนี้ไม่ได้ค่ะ รบกวนลองอีกครั้ง หรือแจ้งได้หากต้องการให้ทีมงานช่วยตรวจต่อ';
const EXPOSURE='หยุดสัมผัสสารและขอความช่วยเหลือทันทีค่ะ หากหายใจลำบาก ชัก หรือหมดสติ โทร 1669 และติดต่อศูนย์พิษวิทยา 1367 พร้อมชื่อสารหรือฉลาก ห้ามทำให้อาเจียนเอง';
const HANDOFF_ACK='รับเรื่องให้ทีมงานแล้วค่ะ น้องลัดดาจะพักการตอบระหว่างทีมงานดูแล';
const unique=a=>[...new Set(a)];
function prepare(query,options={}) {
  const history=state.boundedHistory(options.history);
  const last=history.messages.at(-1);
  const current={id:options.messageId||(last?.role==='u'&&last.text===query?last.id:'message-'+crypto.randomUUID()),role:'u',text:String(query)};
  const o=options.ownership||{};
  return {contract_version:state.VERSION,trace_id:options.traceId||crypto.randomUUID(),
    current_message:current,history:{...history,messages:history.messages.filter(m=>m.id!==current.id)},
    state:options.previous?.version===state.VERSION?JSON.parse(JSON.stringify(options.previous)):state.emptyState(),
    admin_context:o.summary?.trim()?{id:'admin-summary-'+o.version,role:'a',text:o.summary,trust:'unverified_admin_context'}:null,
    crm_context:{trust:'derived_hints_not_current_assertions',data:options.crm||{}},
    tools:{...verifiedTools(options),retrieval_available:options.knowledgeRelease?.status==='ready'&&options.knowledgeRelease?.catalogVersion===options.catalog?.version},ownership:{state:o.state||'BOT_ACTIVE',version:o.version||1},
    attachment_context:{count:options.fileCount||0,trust:'unverified_observation_not_company_label'},
    lineage:{contract:state.VERSION,bridge_commit:options.bridgeCommit||null,release_id:options.releaseId||null,
      dify_version:options.difyVersion||null,prompt_version:options.promptVersion||'recovery-v1',
      catalog_version:options.catalog?.version||null,kb_version:options.knowledgeRelease?.catalogVersion||null},
    instructions:{external_discovery:'OFF',company_truth:'tools only; never user/admin/image/RAG',semantic_authority:'Dify',no_auto_training:true}};
}
function validate(raw,prepared,{catalog}={}) {
  const failures=[];let r;
  try{r=parseResponse(raw);}catch{return {failures:['invalid_json']};}
  if(r?.contract_version!==state.VERSION||r.trace_id!==prepared.trace_id)return {failures:['contract_trace_mismatch']};
  const semantic=r.semantic;
  if(!semantic||typeof semantic.intent!=='string'||typeof semantic.user_goal!=='string'||typeof semantic.rate_requested!=='boolean'||typeof semantic.image_requested!=='boolean')return {failures:['invalid_semantic_contract']};
  let next;
  try{next=state.applyDelta(prepared.state,semantic.case_delta,prepared);}catch(e){return {failures:[e.message]};}
  const action=semantic.action;
  if(!action||!['none','handoff'].includes(action.type))failures.push('invalid_action');
  if(action?.type==='handoff'&&(!action.explicit||!state.validateSources(action.source_refs,prepared,{customerOnly:true,currentOnly:true})))failures.push('handoff_requires_explicit_current_customer_source');
  const response=r.response;
  if(!response||typeof response.answer_template!=='string'||!response.answer_template.trim()||response.answer_template.length>24000||
    !Array.isArray(response.recommended)||!Array.isArray(response.image_product_ids)||!Array.isArray(response.claim_refs)||!Array.isArray(response.questions))return {failures:[...failures,'invalid_response_contract']};
  if(response.recommended.length>20||response.recommended.some(c=>!c||typeof c.product_id!=='string')||response.questions.some(q=>typeof q!=='string')||response.image_product_ids.some(x=>typeof x!=='string')||response.claim_refs.some(x=>typeof x!=='string'))return {failures:[...failures,'invalid_response_arrays']};
  const fields=next.cases[next.active_case_id].fields,value=field=>fields[field]?.value;
  const claims={...prepared.tools.claims,...(semantic.rate_requested?calculationClaims(catalog,fields):{})};
  // A separate Dify audit classifies every prose span. Bridge verifies exact
  // coverage and rejects free company/staff/label/dose assertions, while allowing
  // ordinary agronomic quantities. This does not preselect a plan or questions.
  const segments=r.audit?.segments;
  if(!Array.isArray(segments)||segments.some(s=>!s||typeof s.text!=='string')||segments.map(s=>s.text).join('')!==response.answer_template)failures.push('prose_audit_coverage');
  else for(const segment of segments) {
    if(['company_claim','staff_claim','status_claim','dose','registration','phi','action_claim'].includes(segment.kind))failures.push('unverified_prose_'+segment.kind);
    else if(segment.kind==='fact') {
      if(!/^\[\[fact:[A-Za-z0-9_:.\-]+\]\]$/.test(segment.text))failures.push('audit_fact_token_required');
    } else if(segment.kind==='action') {
      if(segment.text!=='[[handoff_ack]]'||action?.type!=='handoff')failures.push('unexecuted_action_claim');
    } else if(segment.kind==='customer_report') {
      if(segment.attributed!==true||!state.validateSources(segment.source_refs,prepared))failures.push('unattributed_customer_report');
    } else if(segment.kind==='treatment_advice') {
      if(!response.recommended.length||value('exposure')||value('injury')||value('near_harvest')||value('flowering'))failures.push('unverified_treatment_advice');
    } else if(!['conversation','general_agronomy'].includes(segment.kind))failures.push('unknown_audit_scope');
  }
  const selected=[];
  let text=response.answer_template.replace(/\[\[fact:([A-Za-z0-9_:.\-]+)\]\]/g,(token,id)=>{
    const fact=claims[id];if(!fact){failures.push('unknown_claim:'+id);return '';}
    selected.push(fact);return fact.text;
  });
  if(text.includes('[[fact:'))failures.push('malformed_fact_token');
  if(unique(selected.map(c=>c.id)).sort().join('|')!==unique(response.claim_refs).sort().join('|'))failures.push('claim_refs_mismatch');
  // The model controls wording and questions; exact company statements are expanded only from tool records.
  const prose=response.answer_template.replace(/\[\[fact:[A-Za-z0-9_:.\-]+\]\]/g,'').replace('[[handoff_ack]]','');
  if(catalog?.index.mentions(prose).length)failures.push('company_name_requires_fact_token');
  // General ingredient knowledge is not a company formula/label claim. The
  // semantic audit scopes such claims; catalog membership alone is not a ban.
  // These are output integrity checks, never input routing or case interpretation.
  for(const hit of prose.matchAll(/(?:สินค้า|แนะนำ)\s*["“]([^"”]+)["”]/g))if(!catalog?.index.resolve(hit[1]))failures.push('unknown_named_product');
  if(/0\d{1,2}[-\s.]?\d{3}[-\s.]?\d{3,4}/.test(prose))failures.push('phone_requires_verified_fact');
  if(/(?:ไม่มี|ยังไม่มี|มี)(?:ข้อมูล)?(?:การ)?ขึ้นทะเบียน|ยังไม่มีทะเบียน|ขึ้นทะเบียนแล้ว|(?:ทะเบียน|ฉลาก)[^\n]{0,80}(?:รับรอง|อนุญาต)/.test(prose))failures.push('registration_requires_verified_fact');
  if(/(?:PHI|ระยะ(?:หยุดพ่น|ปลอดภัย|เว้น)[^\n]{0,35}เก็บเกี่ยว)[^\n]{0,60}?\d+\s*วัน/i.test(prose))failures.push('phi_requires_verified_fact');
  if(/\b(?:Expand|Skyrocket|Cosmic[- ]?star|Standard)\b|strategy_rank|\*\*/i.test(prose))failures.push('internal_or_format_leak');
  if(/(?:ส่งเรื่อง|แจ้งทีม|แจ้งแอดมิน|นัดหมาย|ยกเลิกนัด|จอง|สั่งซื้อ)(?:ให้)?(?:แล้ว|เรียบร้อย)|จะพักการตอบ|จะหยุดตอบ|จะให้.*ติดต่อกลับ/.test(prose))failures.push('unexecuted_action_claim');
  const ids=unique([...response.recommended.map(x=>x?.product_id),...response.image_product_ids,...selected.map(x=>x.product_id).filter(Boolean)]);
  for(const id of ids)if(!catalog?.products.get(id)?.open)failures.push('closed_unknown_product');
  if(catalog?.index.mentions(text).some(p=>!p.open))failures.push('closed_product_text');
  const rejected=value('rejected_product_ids')||[],treatments=value('treatments')||[];
  for(const c of response.recommended) {
    const p=catalog?.products.get(c.product_id),usage=p?.usage.find(u=>u.ref===c.usage_ref);
    const basis=c.basis;
    if(!basis||!['company_usage','company_product','verified_evidence','conditional_discussion'].includes(basis.type)||!Array.isArray(basis.claim_refs)||!basis.claim_refs.length||
      basis.claim_refs.some(id=>!claims[id]||claims[id].product_id!==c.product_id))failures.push('recommendation_evidence_basis');
    if(!['recommendation','conditional_discussion'].includes(c.mode)||typeof c.reason!=='string'||!c.reason.trim())failures.push('recommendation_mode_required');
    if(basis?.type==='company_usage') {
      if(!usage||!basis.claim_refs.some(id=>claims[id]?.field==='usage'&&claims[id].source_ref===c.usage_ref))failures.push('recommendation_requires_company_usage');
      if(!c.checks||!['crop','target','stage','history'].every(k=>['supported','not_applicable'].includes(c.checks[k])))failures.push('suitability_not_established');
      if(usage&&stageMatch(usage.crop_stage,{stage:value('stage'),age_days:value('age_days'),age_months:value('age_months')})==='mismatch')failures.push('usage_stage_mismatch');
    }
    if(basis?.type==='company_product'&&!basis.claim_refs.some(id=>['selling_point','precaution','usage'].includes(claims[id]?.field)))failures.push('product_suitability_basis_missing');
    if(basis?.type==='verified_evidence'&&!basis.claim_refs.some(id=>claims[id]?.evidence_id&&prepared.tools.evidence.some(e=>e.evidence_id===claims[id].evidence_id&&e.product_id===c.product_id)))failures.push('product_evidence_missing');
    if(basis?.type==='conditional_discussion'&&c.mode!=='conditional_discussion')failures.push('conditional_scope_cannot_assert_use');
    if(c.mode==='conditional_discussion'&&!r.audit?.limitations_visible)failures.push('conditional_limitation_missing');
    if(c.mode==='recommendation'&&(rejected.includes(c.product_id)||treatments.some(t=>t.product_id===c.product_id&&['failed','reduced','injury','rejected'].includes(t.outcome))))failures.push('rejected_or_failed_product');
    if(c.mode==='recommendation'&&value('resistance_suspected')&&p?.moa_group&&treatments.some(t=>['failed','reduced'].includes(t.outcome)&&catalog?.products.get(t.product_id)?.moa_group===p.moa_group))failures.push('same_moa_after_failure');
    if(c.mode==='recommendation'&&(value('exposure')||value('injury')))failures.push('critical_treatment_stop');
    if(c.mode==='recommendation'&&(value('near_harvest')||value('flowering'))) {
      const safe=prepared.tools.evidence.some(e=>e.product_id===c.product_id&&e.product_label_verified&&e.stage_verified&&e.safety_reviewed&&e.technical_owner_approved);
      if(!safe)failures.push('high_risk_requires_product_label');
    }
    if(!selected.some(x=>x.product_id===c.product_id))failures.push('recommendation_missing_visible_product');
  }
  if(response.primary_product_id!=null&&!response.recommended.some(x=>x.product_id===response.primary_product_id&&x.mode==='recommendation'))failures.push('primary_not_recommended');
  const assessed=r.decision?.candidate_assessment,groups=new Map(),seenCandidates=new Set();
  if(!Array.isArray(assessed))failures.push('candidate_assessment_required');
  else for(const c of assessed) {
    if(!c||typeof c.product_id!=='string'||seenCandidates.has(c.product_id)||typeof c.eligible!=='boolean'||
      !Array.isArray(c.reasons)||!c.reasons.length||c.reasons.some(x=>typeof x!=='string'||!x.trim())){failures.push('candidate_reason_required');continue;}
    seenCandidates.add(c.product_id);
    if(c.eligible) {
      if(typeof c.suitability_group!=='string'||!c.suitability_group.trim()||!catalog?.products.get(c.product_id)?.open){failures.push('invalid_eligible_candidate');continue;}
      groups.set(c.product_id,c.suitability_group);
    }
  }
  // AI determines suitability groups and exclusions. Code applies trusted
  // Strategy ranks only inside an explicitly equal-suitability group.
  const actual=response.recommended.filter(c=>c.mode==='recommendation');
  for(const c of actual)if(!groups.has(c.product_id))failures.push('recommendation_not_ai_eligible');
  const primary=response.primary_product_id,primaryGroup=groups.get(primary);
  if(primary&&primaryGroup)for(const [id,group]of groups)if(group===primaryGroup&&catalog.products.get(id).rank<catalog.products.get(primary).rank)failures.push('strategy_primary_order');
  for(let i=0;i<actual.length;i++)for(let j=i+1;j<actual.length;j++) {
    const a=actual[i].product_id,b=actual[j].product_id;
    if(groups.has(a)&&groups.get(a)===groups.get(b)&&catalog.products.get(a)?.rank>catalog.products.get(b)?.rank)failures.push('strategy_display_order');
  }
  for(const claim of selected.filter(c=>['rate','calculation'].includes(c.field))) {
    if(!semantic.rate_requested||!claim.value.rate_verified)failures.push('rate_not_requested_or_unverified');
    if(!value('crop')||![claim.value.crop_name,claim.value.crop_group].includes(value('crop')))failures.push('rate_crop_unresolved');
    if(!value('stage')||value('exposure')||value('near_harvest')||value('flowering')||value('injury'))failures.push('rate_safety_unresolved');
    const row=catalog?.products.get(claim.product_id)?.usage.find(u=>u.ref===claim.source_ref);
    if(!row||value('target')!==row.target_name||value('equipment')!==row.application_equipment)failures.push('rate_usage_unresolved');
    if(row&&stageMatch(row.crop_stage,{stage:value('stage'),age_days:value('age_days'),age_months:value('age_months')})==='mismatch')failures.push('rate_stage_mismatch');
  }
  if(response.image_product_ids.length&&!semantic.image_requested)failures.push('image_not_requested');
  for(const id of response.image_product_ids)if(!catalog?.products.get(id)?.images.length)failures.push('image_unavailable');
  for(const q of response.questions)if(!text.includes(q))failures.push('chosen_question_not_in_response');
  const hasAck=response.answer_template.includes('[[handoff_ack]]');
  if((action?.type==='handoff')!==hasAck)failures.push('handoff_ack_contract');
  if(action?.type==='handoff'&&(response.recommended.length||response.image_product_ids.length))failures.push('handoff_must_not_sell');
  text=text.replace('[[handoff_ack]]',HANDOFF_ACK);
  if(value('exposure')) {
    if(response.recommended.length||selected.some(c=>['rate','calculation'].includes(c.field)))failures.push('critical_treatment_stop');
    // Signal is semantic AI output; the critical stop content is a verified system response.
    text=EXPOSURE+(action?.type==='handoff'?'\n'+HANDOFF_ACK:'');
  }
  if(failures.length)return {failures:unique(failures),semantic,next};
  const recommendations=response.recommended.filter(c=>c.mode==='recommendation');
  if(recommendations.length)next.last_recommendation=recommendations.map(c=>({...c,trace_id:prepared.trace_id,case_id:next.active_case_id,delivered:false}));
  return {failures:[],semantic,next,response:{answer_text:text,intent:semantic.intent,
    handoff_action:action.type==='handoff'?'request':'none',primary_product_id:response.primary_product_id||null,
    product_ids_recommended:recommendations.map(c=>c.product_id),discussed_product_ids:response.recommended.filter(c=>c.mode==='conditional_discussion').map(c=>c.product_id),image_product_ids:response.image_product_ids,
    claim_refs:response.claim_refs,rate_refs:selected.filter(c=>['rate','calculation'].includes(c.field)).map(c=>c.source_ref),
    evidence_refs:selected.filter(c=>c.evidence_id).map(c=>c.evidence_id),question_required:response.questions,warnings_required:[]},decision:r.decision||null};
}
async function run(query,options={}) {
  const started=performance.now(),prepared=prepare(query,options),attempts=[];
  let conversation_id=options.conversationId||'',checked={failures:['generation_not_run']},usage=null;
  if(['HUMAN_ACTIVE','HUMAN_REQUESTED','BOT_ASSIST_ONLY'].includes(prepared.ownership.state))return {response:{answer_text:'',handoff_action:'hold'},messages:[],context:prepared.state,conversation_id,metrics:{trace_id:prepared.trace_id,failures:['human_owned']}};
  for(let attempt=0;attempt<2;attempt++) {
    if(options.isCurrent&&!options.isCurrent()){checked={failures:['stale_generation']};break;}
    const requestContext=attempt?{...prepared,repair:{failures:checked.failures,previous_output:attempts.at(-1)?.raw_output,rule:'Repair invalid evidence/contract only. Reconsider freely; never reuse an old plan.'}}:prepared;
    const at=Date.now();
    try {
      const result=await options.generate({query,prepared_context:JSON.stringify(requestContext),trace_id:prepared.trace_id,conversation_id});
      const raw=result.answer??result;
      if(typeof result.conversation_id==='string')conversation_id=result.conversation_id;
      usage=result.usage||null;
      checked=validate(raw,prepared,options);
      attempts.push({request_at:at,response_at:Date.now(),conversation_id,raw_output:raw,failures:checked.failures});
      if(!checked.failures.length)break;
    }catch(e){checked={failures:['generation_failed']};attempts.push({request_at:at,response_at:Date.now(),error:'generation_failed'});break;}
  }
  const fallback=checked.failures.length>0;
  const response=checked.response||{answer_text:FALLBACK,intent:checked.semantic?.intent||'unavailable',handoff_action:'none',product_ids_recommended:[],image_product_ids:[],claim_refs:[],evidence_refs:[],primary_product_id:null};
  const metrics={trace_id:prepared.trace_id,contract_version:state.VERSION,route:'recovery_semantic',intent:response.intent,
    lineage:prepared.lineage,...prepared.lineage,ownership_version:prepared.ownership.version,
    conversation_id,raw_input:query,prepared_context:prepared,semantic:checked.semantic||null,
    state_before:prepared.state,state_delta:checked.semantic?.case_delta||null,state_after:checked.next||prepared.state,
    tool_sources:{catalog:prepared.tools.catalog_version,team:prepared.tools.team.verified_at||null,external:'OFF'},
    decision:checked.decision||null,candidate_ids:response.product_ids_recommended,primary_product_id:response.primary_product_id,
    claim_refs:response.claim_refs,attempts,generated_answer:response.answer_text,delivery_status:'not_attempted',
    failures:checked.failures,block:fallback,safe_fallback:fallback,total_ms:performance.now()-started,usage};
  options.observe?.(metrics);
  return {response,messages:renderMessages(response.answer_text),context:checked.next||prepared.state,conversation_id,prepared,metrics,failures:checked.failures,safe_fallback:fallback};
}
module.exports={prepare,validate,run,FALLBACK,HANDOFF_ACK};
