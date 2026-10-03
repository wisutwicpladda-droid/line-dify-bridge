'use strict';
const crypto=require('crypto');
const EVENT_TYPES=new Set(['customer_input','bot_output','admin_output','admin_correction','recommendation','diagnosis','handoff','latency','dealer_referral','customer_continuation','purchase_signal']);
function preference(value,{source,explicit=false,confidence=1,now=Date.now(),ttlMs=2592000000}={}) {
  if(!source)throw new Error('preference_source_required');
  return {value,source,explicit,confidence,updated_at:new Date(now).toISOString(),expires_at:new Date(now+ttlMs).toISOString()};
}
function learningEvent(type,data,{consent=false}={}) {
  if(!EVENT_TYPES.has(type))throw new Error('invalid_event_type');
  const event={id:crypto.randomUUID(),type,at:new Date().toISOString(),trace_id:data.trace_id,product_ids:data.product_ids||[],review_status:'unreviewed',approved_ground_truth:false};
  // Raw transcript retention is opt-in and must pass a separately configured redactor.
  if(consent&&data.redacted_text)event.redacted_text=data.redacted_text;
  return event;
}
function dealerReferral(dealer,availability) {
  if(!dealer||!dealer.active||!dealer.verified_at)return {available:false,stock:'unknown'};
  return {available:true,dealer_id:dealer.dealer_id,name:dealer.dealer_name,province:dealer.province,district:dealer.district,contact:dealer.contact,
    stock:availability?.verified_at&&Date.parse(availability.expires_at)>Date.now()&&availability?.dealer_id===dealer.dealer_id?availability.status:'unknown'};
}
module.exports={preference,learningEvent,dealerReferral};
