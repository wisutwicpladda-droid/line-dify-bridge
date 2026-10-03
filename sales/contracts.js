'use strict';
const {renderMessages}=require('../line_renderer');
const {result}=require('./router');
const {rateAnswer}=require('./rates');
const FALLBACK='น้องลัดดายังยืนยันรายละเอียดนี้ไม่ได้ค่ะ ขอข้อมูลพืช ระยะพืช และสิ่งที่ต้องการแก้เพิ่ม เพื่อเลือกคำแนะนำให้ตรงค่ะ';
const ARRAYS=['product_ids_recommended','warnings_required','question_required','rate_refs','evidence_refs','image_product_ids'];
const HANDOFF=new Set(['none','hold','request','human_requested','dealer_referral']);
function treatmentMention(text,catalog){
  const common=catalog?[...catalog.products.values()].flatMap(p=>[p.common_name_th,p.active_ingredient]).flatMap(s=>String(s||'').split(/\s*\+\s*/).map(s=>s.replace(/\d+(?:\.\d+)?\s*%.*$/,'').trim()).filter(s=>s.length>=4)):[];
  const names=[...common,'คาร์เบนดาซิม','เมทาแลกซิล','ฟอสอีทิล','อะบาเมกติน','อิมิดาโคลพริด','ไทอะมีทอกแซม','คอปเปอร์','mancozeb','metalaxyl','acetamiprid','บิวเวอเรีย','ไตรโคเดอร์มา','ชีวภัณฑ์'];
  return /ใช้|พ่น|ฉีด|ราด|หว่าน/.test(text)&&names.some(s=>text.toLowerCase().includes(s.toLowerCase()));
}
// Only normalize empty optional containers. Never repair a fact, ID, reference or dose.
function repairTypes(input) {
  if(!input || typeof input!=='object' || Array.isArray(input))return input;
  const r={...input};
  for(const key of ARRAYS)if(r[key]===null)r[key]=[];
  if(r.uncertainty===null)r.uncertainty='';
  return r;
}
function parseResponse(raw) {
  if(raw&&typeof raw==='object')return raw;
  const value=String(raw||'').trim().replace(/^\x60\x60\x60(?:json)?\s*/,'').replace(/\s*\x60\x60\x60$/,'');
  return JSON.parse(value);
}
function validateResponse(r,{catalog,context={},candidates,prepared={},requiredWarnings=[],requiredQuestions=[],evidence=[]}) {
  const failures=[];
  if(!r||typeof r.answer_text!=='string'||!r.answer_text.trim())return ['missing_answer'];
  for(const key of ARRAYS)if(!Array.isArray(r[key])||r[key].some(v=>typeof v!=='string'||!v.trim()))failures.push('invalid_'+key);
  if(failures.length)return failures;
  if(typeof r.intent!=='string'||typeof r.uncertainty!=='string'||typeof r.handoff_action!=='string')failures.push('invalid_scalar_contract');
  if(!Object.hasOwn(r,'primary_product_id') || r.primary_product_id!==null && typeof r.primary_product_id!=='string')failures.push('invalid_primary');
  if(!HANDOFF.has(r.handoff_action))failures.push('invalid_handoff');
  if(r.intent!=='unavailable'&&(context.diagnosis_uncertain||context.near_harvest||context.stage==='ดอก')&&!r.uncertainty?.trim())failures.push('uncertainty_lost');
  if(['HUMAN_ACTIVE','HUMAN_REQUESTED','BOT_ASSIST_ONLY'].includes(prepared.human_state))failures.push('human_owned');
  if(catalog)for(const match of r.answer_text.matchAll(/(?:สินค้า|แนะนำ)\s*["“]([^"”]+)["”]/g))
    if(!catalog.index.resolve(match[1]))failures.push('unknown_named_product');
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
  if(context.diagnosis_uncertain&&(r.product_ids_recommended.length||mentioned.length||treatmentMention(r.answer_text,catalog)))failures.push('diagnosis_gate');
  if((context.near_harvest||context.stage==='ดอก')&&treatmentMention(r.answer_text,catalog)&&!evidence.some(e=>e.verified&&e.stage_verified&&e.safety_reviewed&&e.technical_owner_approved))failures.push('unverified_high_risk_treatment');
  if(candidates&&r.primary_product_id&&r.primary_product_id!==candidates.primary_product_id)failures.push('strategy_mismatch');
  if(candidates&&r.product_ids_recommended.length&&!candidates.primary_product_id)failures.push('candidate_decision_unresolved');
  if(candidates&&r.product_ids_recommended.length&&candidates.primary_product_id&&!r.primary_product_id)failures.push('missing_primary_decision');
  if(r.primary_product_id&&!r.product_ids_recommended.includes(r.primary_product_id))failures.push('primary_not_recommended');
  for(const id of r.product_ids_recommended)if(candidates&&!candidates.eligible.some(p=>p.product_id===id))failures.push('unvalidated_candidate');
  for(const id of r.image_product_ids)if(!r.product_ids_recommended.includes(id)&&!context.product_ids?.includes(id))failures.push('unrelated_image');
  for(const warning of [...requiredWarnings,...r.warnings_required])if(!r.answer_text.includes(warning))failures.push('warning_lost');
  for(const question of [...(r.intent==='unavailable'?[]:requiredQuestions),...r.question_required])if(!r.answer_text.includes(question))failures.push('question_lost');
  const allowedRates=new Map((catalog?[...catalog.products.values()]:[]).filter(p=>p.open).flatMap(p=>p.usage.filter(u=>u.rate_verified).map(u=>[u.ref,{p,u}])));
  if(r.rate_refs.length&&!context.rate_requested)failures.push('unsolicited_rate');
  for(const ref of r.rate_refs) {
    const record=allowedRates.get(ref);
    if(!record||!context.product_ids?.includes(record.p.product_id)&&!r.product_ids_recommended.includes(record.p.product_id))failures.push('unverified_rate');
    if(prepared.allowed_rates && !prepared.allowed_rates.some(u=>u.ref===ref))failures.push('rate_outside_prepared_scope');
  }
  // Reject a generated dose without provenance, including numeric ranges / water bases.
  if(/\d+(?:\s*[-–]\s*\d+)?\s*(?:ซีซี|มล\.?|กรัม|กิโลกรัม)\s*(?:ต่อ|\/|ผสม|กับ)/.test(r.answer_text)&&!r.rate_refs.length)failures.push('unproven_dose');
  for(const ref of r.evidence_refs)if(!evidence.some(e=>(e.evidence_id||e.id)===ref&&e.verified&&(!e.valid_until||Date.parse(e.valid_until)>Date.now())))failures.push('unverified_evidence');
  // A missing label is unknown, not proof of no registration. Ingredient evidence cannot support either claim.
  if(/(?:ไม่มี|ยังไม่มี|มี)(?:ข้อมูล)?(?:การ)?ขึ้นทะเบียน|ยังไม่มีทะเบียน|ขึ้นทะเบียนแล้ว|(?:ทะเบียน|ฉลาก)[^\n]{0,80}(?:รับรอง|อนุญาต)/.test(r.answer_text+'\n'+r.uncertainty)&&
     !evidence.some(e=>e.verified&&e.product_label_verified&&(!e.valid_until||Date.parse(e.valid_until)>Date.now())))failures.push('unverified_product_label_claim');
  if(/(?:PHI|ระยะ(?:หยุดพ่น|ปลอดภัย|เว้น)[^\n]{0,35}เก็บเกี่ยว)[^\n]{0,60}?\d+(?:\s*[-–]\s*\d+)?\s*วัน/i.test(r.answer_text)&&
     !evidence.some(e=>e.verified&&e.claim_type==='phi'&&e.product_label_verified&&(!e.valid_until||Date.parse(e.valid_until)>Date.now())))failures.push('unverified_phi_claim');
  if(['regulatory','competitor'].includes(context.intent) && r.intent!=='unavailable' && !r.evidence_refs.length)
    failures.push('current_fact_requires_verified_evidence');
  return [...new Set(failures)];
}
function finalPayload(raw,prepared) {
  if(['HUMAN_ACTIVE','HUMAN_REQUESTED','BOT_ASSIST_ONLY'].includes(prepared.prepared?.human_state))return {response:result('','hold',{handoff_action:'hold'}),failures:['human_owned'],messages:[]};
  const safeText=base=>[base,...(prepared.requiredWarnings||[])].join('\n');
  let r;try{r=repairTypes(parseResponse(raw));}catch{const text=safeText(FALLBACK);return {response:result(text,prepared.context.intent),failures:['invalid_json'],messages:renderMessages(text)};}
  const failures=validateResponse(r,prepared);
  if(failures.length) {
    const fallback=failures.includes('unverified_phi_claim')?
      'น้องลัดดายังยืนยันจำนวนวันที่ต้องเว้นก่อนเก็บเกี่ยวของสินค้านี้ไม่ได้ค่ะ ขอให้ทีมงานตรวจฉลากก่อนใช้':failures.includes('unverified_product_label_claim')?
      'น้องลัดดายังตรวจยืนยันทะเบียนของสินค้าสำหรับกรณีนี้ไม่ได้ค่ะ ข้อมูลการใช้สารสำคัญและข้อมูลการขึ้นทะเบียนสินค้าเป็นคนละส่วน ขอให้ทีมงานตรวจสอบก่อนใช้ค่ะ':failures.includes('unverified_high_risk_treatment')?
      'น้องลัดดายังยืนยันวิธีใช้ที่ปลอดภัยในระยะนี้ไม่ได้ค่ะ ขอให้ทีมงานตรวจข้อจำกัดของสินค้าก่อนแนะนำ':failures.includes('current_fact_requires_verified_evidence')?
      'น้องลัดดายังตรวจยืนยันข้อมูลล่าสุดส่วนนี้ไม่ได้ค่ะ ขอให้ทีมงานตรวจจากแหล่งข้อมูลทางการก่อนสรุป':FALLBACK;
    const text=safeText(fallback);
    return {response:result(text,prepared.context.intent,{warnings_required:prepared.requiredWarnings||[]}),failures,messages:renderMessages(text)};
  }
  return {response:r,failures:[],messages:renderMessages(r.answer_text)};
}
module.exports={parseResponse,repairTypes,validateResponse,finalPayload,FALLBACK};
