'use strict';
const {renderMessages}=require('../line_renderer');
const {result}=require('./router');
const {rateAnswer}=require('./rates');
const FALLBACK='น้องลัดดายังยืนยันรายละเอียดนี้ไม่ได้ค่ะ ขอข้อมูลพืช ระยะพืช และสิ่งที่ต้องการแก้เพิ่ม เพื่อเลือกคำแนะนำให้ตรงค่ะ';
function parseResponse(raw) {
  if(raw&&typeof raw==='object')return raw;
  const value=String(raw||'').trim().replace(/^\x60\x60\x60(?:json)?\s*/,'').replace(/\s*\x60\x60\x60$/,'');
  return JSON.parse(value);
}
function validateResponse(r,{catalog,context,candidates,requiredWarnings=[],requiredQuestions=[],evidence=[]}) {
  const failures=[];
  if(!r||typeof r.answer_text!=='string'||!r.answer_text.trim())return ['missing_answer'];
  for(const key of ['product_ids_recommended','warnings_required','question_required','rate_refs','evidence_refs','image_product_ids'])if(!Array.isArray(r[key]))failures.push('invalid_'+key);
  if(failures.length)return failures;
  if(/\*\*|\[cite[: ]|Expand|Skyrocket|Natural|Cosmic[- ]?star|Standard/i.test(r.answer_text))failures.push('internal_or_format_leak');
  const ids=[...new Set([...r.product_ids_recommended,...r.image_product_ids,...(r.primary_product_id?[r.primary_product_id]:[])])];
  if(ids.length&&!catalog)failures.push('catalog_unavailable');
  for(const id of ids)if(!catalog?.products.get(id)?.open)failures.push('closed_unknown_product');
  if(catalog)for(const p of catalog.index.mentions(r.answer_text))if(!p.open)failures.push('closed_name_leak');
  const mentioned=catalog?catalog.index.mentions(r.answer_text):[];
  for(const p of mentioned) {
    if(!context.product_ids?.includes(p.product_id)&&!r.product_ids_recommended.includes(p.product_id))failures.push('undeclared_product');
  }
  if(/\d+(?:\s*[-–]\s*\d+)?\s*(?:ซีซี|มล\.?|กรัม|กิโลกรัม)/.test(r.answer_text) && context.intent!=='package') {
    const expected=catalog?rateAnswer(context,catalog):null;
    if(!expected || expected.answer_text!==r.answer_text) failures.push('dose_not_deterministically_verified');
  }
  if(context.diagnosis_uncertain&&r.product_ids_recommended.length)failures.push('diagnosis_gate');
  if(candidates&&r.primary_product_id&&r.primary_product_id!==candidates.primary_product_id)failures.push('strategy_mismatch');
  if(r.primary_product_id&&!r.product_ids_recommended.includes(r.primary_product_id))failures.push('primary_not_recommended');
  for(const id of r.product_ids_recommended)if(candidates&&!candidates.eligible.some(p=>p.product_id===id))failures.push('unvalidated_candidate');
  for(const id of r.image_product_ids)if(!r.product_ids_recommended.includes(id)&&!context.product_ids?.includes(id))failures.push('unrelated_image');
  for(const warning of [...requiredWarnings,...r.warnings_required])if(!r.answer_text.includes(warning))failures.push('warning_lost');
  for(const question of [...requiredQuestions,...r.question_required])if(!r.answer_text.includes(question))failures.push('question_lost');
  const allowedRates=new Map((catalog?[...catalog.products.values()]:[]).filter(p=>p.open).flatMap(p=>p.usage.filter(u=>u.rate_verified).map(u=>[u.ref,{p,u}])));
  if(r.rate_refs.length&&!context.rate_requested)failures.push('unsolicited_rate');
  for(const ref of r.rate_refs) {
    const record=allowedRates.get(ref);
    if(!record||!context.product_ids?.includes(record.p.product_id)&&!r.product_ids_recommended.includes(record.p.product_id))failures.push('unverified_rate');
  }
  // Reject a generated dose without provenance, including numeric ranges / water bases.
  if(/\d+(?:\s*[-–]\s*\d+)?\s*(?:ซีซี|มล\.?|กรัม|กิโลกรัม)\s*(?:ต่อ|\/|ผสม|กับ)/.test(r.answer_text)&&!r.rate_refs.length)failures.push('unproven_dose');
  for(const ref of r.evidence_refs)if(!evidence.some(e=>e.id===ref&&e.verified))failures.push('unverified_evidence');
  return [...new Set(failures)];
}
function finalPayload(raw,prepared) {
  let r;try{r=parseResponse(raw);}catch{return {response:result(FALLBACK,prepared.context.intent),failures:['invalid_json'],messages:renderMessages(FALLBACK)};}
  const failures=validateResponse(r,prepared);
  if(failures.length)return {response:result(FALLBACK,prepared.context.intent),failures,messages:renderMessages(FALLBACK)};
  return {response:r,failures:[],messages:renderMessages(r.answer_text)};
}
module.exports={parseResponse,validateResponse,finalPayload,FALLBACK};
