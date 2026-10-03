'use strict';
const crypto=require('crypto');
const EVENT_ALIASES={customer_input:'customer_message',bot_output:'bot_response',admin_output:'admin_response',recommendation:'recommendation_event',diagnosis:'diagnosis_event',handoff:'handoff_event'};
const EVENT_TYPES=new Set(['customer_message','bot_response','admin_response','admin_correction','recommendation_event','diagnosis_event','handoff_event','latency','failure','dealer_referral','customer_continuation','purchase_signal']);
function preference(value,{source,explicit=false,confidence=1,now=Date.now(),ttlMs=2592000000}={}) {
  if(!source)throw new Error('preference_source_required');
  return {value,source,explicit,confidence,updated_at:new Date(now).toISOString(),expires_at:new Date(now+ttlMs).toISOString()};
}
function learningEvent(type,data,{consent=false}={}) {
  type=EVENT_ALIASES[type]||type;
  if(!EVENT_TYPES.has(type))throw new Error('invalid_event_type');
  const event={id:crypto.randomUUID(),type,at:new Date().toISOString(),trace_id:data.trace_id,product_ids:data.product_ids||[],version_refs:data.version_refs||{},review_status:'unreviewed',approved_ground_truth:false};
  // Raw transcript retention is opt-in and must pass a separately configured redactor.
  if(consent&&data.redacted_text)event.redacted_text=data.redacted_text;
  return event;
}
// On-demand export only. Never schedules training, edits prompts, or treats admin text as truth.
function evaluationExport(events,{from,to}={}) {
 const lo=Date.parse(from),hi=Date.parse(to);if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo>=hi||hi-lo>31*86400000)throw Error('invalid_evaluation_window');
 return {schema_version:1,from,to,auto_train:false,rows:events.filter(e=>Date.parse(e.at)>=lo&&Date.parse(e.at)<hi).map(e=>({
  id:e.id,type:EVENT_ALIASES[e.type]||e.type,at:e.at,trace_id:e.trace_id,product_ids:e.product_ids,version_refs:e.version_refs||{},review_status:e.review_status,approved_ground_truth:false
 }))};
}
function dealerReferral(dealer,availability) {
  if(!dealer||!dealer.active||!dealer.verified_at)return {available:false,stock:'unknown'};
  return {available:true,dealer_id:dealer.dealer_id,name:dealer.dealer_name,province:dealer.province,district:dealer.district,contact:dealer.contact,
    stock:availability?.verified_at&&Date.parse(availability.expires_at)>Date.now()&&availability?.dealer_id===dealer.dealer_id?availability.status:'unknown'};
}
module.exports={preference,learningEvent,dealerReferral,evaluationExport,EVENT_TYPES};
