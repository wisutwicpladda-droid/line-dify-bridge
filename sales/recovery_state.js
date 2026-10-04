'use strict';
const crypto = require('node:crypto');
const ownership = require('../conversation_ownership');
const VERSION = 'recovery-v1';
const clone = x => JSON.parse(JSON.stringify(x));
const FIELDS = new Set(['crop','stage','age_days','age_months','target','diagnosis','symptoms','location','area_rai','water_liters','equipment','water_condition',
  'treatments','rejected_product_ids','goal','topic','unresolved_questions','near_harvest','days_to_harvest','flowering',
  'exposure','injury','resistance_suspected','preferences','references']);
const ARRAYS = new Set(['symptoms','treatments','rejected_product_ids','unresolved_questions','references']);
const BOOLS = new Set(['near_harvest','flowering','exposure','injury','resistance_suspected']);
const NUMBERS = new Set(['age_days','age_months','area_rai','water_liters','days_to_harvest']);
function emptyState() { return {version:VERSION,revision:0,active_case_id:'case-1',cases:{'case-1':{fields:{}}},last_recommendation:[]}; }
// Whole messages only: a dropped message is recorded, never silently clipped at 600 chars.
function boundedHistory(history=[], {maxMessages=40,maxChars=48000}={}) {
  const selected=[];let chars=0;
  for (let i=history.length-1;i>=0;i--) {
    const h=history[i],text=String(h.t??h.text??'');
    if (selected.length>=maxMessages || chars+text.length>maxChars) break;
    selected.unshift({id:h.id||'history-'+i+'-'+(h.at||0),role:h.r||h.role,text,at:h.at||null}); chars+=text.length;
  }
  return {messages:selected,omitted_messages:history.length-selected.length,policy:'whole-messages-40/48000'};
}
function scopeKey({appId,releaseId='unversioned',ownershipVersion=1}) {
  return crypto.createHash('sha256').update(JSON.stringify([VERSION,appId,releaseId,ownershipVersion])).digest('hex');
}
function snapshot(session,options={}) {
  const scope=scopeKey({...options,ownershipVersion:ownership.ensure(session).version});
  const saved=session.recovery;
  // Canonical state survives admin resume; native memory does not cross ownership epochs.
  const appScope=[VERSION,options.appId,options.releaseId||'unversioned'].join(':');
  return {scope,app_scope:appScope,state:saved?.app_scope===appScope?clone(saved.state):emptyState(),
    conversation_id:saved?.scope===scope?saved.conversation_id||'':'',ticket:ownership.ticket(session)};
}
function sourceMap(prepared) {
  return new Map([...prepared.history.messages,prepared.current_message,...(prepared.admin_context?[prepared.admin_context]:[])].map(m=>[m.id,m]));
}
function validateSources(refs,prepared,{customerOnly=false,currentOnly=false}={}) {
  const map=sourceMap(prepared);
  return Array.isArray(refs)&&refs.length>0&&refs.length<=12&&refs.every(ref=>{
    const m=map.get(ref?.message_id);
    return m&&typeof ref.quote==='string'&&ref.quote.trim().length>0&&m.text.includes(ref.quote)&&
      (!customerOnly||m.role==='u')&&(!currentOnly||m.id===prepared.current_message.id);
  });
}
function applyDelta(state,delta,prepared) {
  if (!delta || delta.base_revision!==state.revision) throw Error('state_revision_conflict');
  if (!['continue','new','switch'].includes(delta.case_action)||!/^case-[a-zA-Z0-9_-]{1,64}$/.test(delta.case_id||'')) throw Error('invalid_case_delta');
  if (!Array.isArray(delta.updates)||delta.updates.length>FIELDS.size) throw Error('invalid_state_updates');
  const next=clone(state),id=delta.case_id;
  if(delta.case_action==='continue'&&id!==state.active_case_id)throw Error('continue_case_mismatch');
  if(delta.case_action==='switch'&&!next.cases[id])throw Error('unknown_case');
  if(delta.case_action==='new') {
    if(next.cases[id]||Object.keys(next.cases).length>=20)throw Error('invalid_new_case');
    if(!validateSources(delta.source_refs,prepared,{customerOnly:true,currentOnly:true}))throw Error('case_change_provenance');
    next.cases[id]={fields:{}};
  }
  if(delta.case_action==='switch'&&!validateSources(delta.source_refs,prepared,{customerOnly:true,currentOnly:true}))throw Error('case_change_provenance');
  next.active_case_id=id; const seen=new Set();
  for(const update of delta.updates) {
    const {field,value,source_refs}=update;
    if(!FIELDS.has(field)||seen.has(field))throw Error('unknown_duplicate_state_field');seen.add(field);
    if(!validateSources(source_refs,prepared))throw Error('state_provenance');
    if(!['references','unresolved_questions'].includes(field)&&source_refs.some(r=>!['u','a'].includes(sourceMap(prepared).get(r.message_id)?.role)))throw Error('bot_text_is_not_customer_assertion');
    // Older summary/history can fill an unknown slot, but cannot overwrite a newer assertion.
    const old=next.cases[id].fields[field];
    if(old && prepared.state.admin_summary_applied===prepared.admin_context?.id &&
       !source_refs.some(r=>r.message_id===prepared.current_message.id) && JSON.stringify(old.value)!==JSON.stringify(value))throw Error('stale_state_source');
    if(old && !source_refs.some(r=>r.message_id===prepared.current_message.id) &&
       source_refs.every(r=>r.message_id!==prepared.admin_context?.id) && JSON.stringify(old.value)!==JSON.stringify(value))throw Error('stale_state_source');
    if(value!==null) {
      if(ARRAYS.has(field)?!Array.isArray(value):BOOLS.has(field)?typeof value!=='boolean':NUMBERS.has(field)?!(Number.isFinite(value)&&value>=0):typeof value!=='string')throw Error('invalid_state_value');
      if(field==='diagnosis'&&!['confirmed','uncertain','not_applicable'].includes(value))throw Error('invalid_diagnosis_value');
      if(field==='treatments'&&value.some(t=>!t||typeof t!=='object'||!['effective','failed','reduced','injury','unknown'].includes(t.outcome)))throw Error('invalid_treatment_history');
      if(['rejected_product_ids','symptoms','unresolved_questions'].includes(field)&&value.some(v=>typeof v!=='string'))throw Error('invalid_state_array');
      if(JSON.stringify(value).length>12000)throw Error('state_value_too_large');
    }
    // Null is a retraction with provenance; no fallback to a parallel legacy context.
    next.cases[id].fields[field]={value,source_refs:clone(source_refs),revision:state.revision+1};
  }
  next.revision++;
  if(prepared.admin_context)next.admin_summary_applied=prepared.admin_context.id;
  if(JSON.stringify(next).length>120000)throw Error('state_capacity');
  return next;
}
function commit(session,snap,result) {
  if(!ownership.canSend(session,snap.ticket))return false;
  if(session.recovery?.app_scope===snap.app_scope && session.recovery.state.revision!==snap.state.revision)return false;
  session.recovery={app_scope:snap.app_scope,scope:snap.scope,state:clone(result.context||snap.state),
    conversation_id:result.conversation_id||snap.conversation_id||'',updated_at:Date.now()};
  return true;
}
module.exports={VERSION,FIELDS,emptyState,boundedHistory,scopeKey,snapshot,validateSources,applyDelta,commit};
