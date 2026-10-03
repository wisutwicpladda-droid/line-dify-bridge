'use strict';
const {normalize,useful}=require('./catalog');
const {compatible}=require('./external_evidence');
const same=(a,b)=>!!a&&!!b&&normalize(a)===normalize(b);
function cropMatch(u,crop) {
  if(!crop)return false;
  const values=(u.crop_name||u.crop_group||'').split(/[,、/]/).map(x=>x.trim());
  return values.some(v=>same(v,crop)||(crop==='ข้าว'&&v==='นาข้าว'));
}
function stageMatch(stage,ctx) {
  if(!stage)return 'unknown';
  if(/ทุกระยะ|ทุกช่วง/.test(stage))return 'match';
  if(ctx.age_days!=null) {
    const months=stage.match(/(\d+)\s*[-–]\s*(\d+)\s*เดือน/);
    if(months)return ctx.age_months==null?'unknown':ctx.age_months>=+months[1]&&ctx.age_months<=+months[2]?'match':'mismatch';
    const month=stage.match(/^(\d+)\s*เดือน/);
    if(month)return ctx.age_months==null?'unknown':ctx.age_months===+month[1]?'match':'mismatch';
    // Include every explicit crop-age interval, excluding standalone water-holding durations.
    const ranges=[...stage.matchAll(/(\d+)\s*[-–]\s*(\d+)\s*(?:วัน\s*(?:หลังหว่าน(?:ข้าว)?)?|หลังหว่าน(?:ข้าว)?)/g)]
      .filter(r=>!/(?:กักน้ำ|รักษาระดับน้ำ)[^\d]*$/.test(stage.slice(0,r.index)));
    if(ranges.length)return ranges.some(range=>ctx.age_days>=+range[1]&&ctx.age_days<=+range[2])?'match':'mismatch';
    return ctx.stage&&stage.includes(ctx.stage)?'match':'unknown';
  }
  return ctx.stage&&stage.includes(ctx.stage)?'match':'missing';
}
function evidenceMatch(e,p,ctx) {
  // Evidence is an approved adapter result, never a model's invented source URL.
  return e.verified===true && !e.conflict && !!e.evidence_id && !!e.document_hash && e.scope==='active_ingredient' && !!e.source && !!e.retrieved_at && !!e.claim &&
    compatible(e,p) && (e.formulation!==null || same(e.physical_form,p.physical_form)) &&
    Date.parse(e.valid_until||e.expires_at)>Date.now() &&
    same(e.crop,ctx.crop) && same(e.target,ctx.target) && e.confidence==='high';
}
function selectCandidates(catalog,ctx,evidence=[]) {
  const eligible=[],conditional=[],pending=[],excluded=[];
  for(const p of catalog.products.values()) {
    const direct=p.usage.filter(u=>cropMatch(u,ctx.crop)&&ctx.target&&normalize(u.target_name).includes(normalize(ctx.target)));
    const ext=evidence.filter(e=>evidenceMatch(e,p,ctx));
    if(!direct.length&&!ext.length) {excluded.push({product_id:p.product_id,reason:'no_suitability_evidence'});continue;}
    const stageRows=direct.map(u=>({u,state:stageMatch(u.crop_stage,ctx)}));
    if(direct.length && stageRows.every(s=>s.state==='mismatch')) {excluded.push({product_id:p.product_id,reason:'stage_mismatch'});continue;}
    if(ctx.safety_blocked_ids?.includes(p.product_id) ||
      ctx.stage==='ดอก' && /(?:ห้าม|ไม่แนะนำ).*ดอกบาน/.test(p.additional_precautions||'')){
      excluded.push({product_id:p.product_id,reason:'safety_exclusion'});continue;
    }
    if(!p.open){excluded.push({product_id:p.product_id,reason:'closed_or_unknown_status'});continue;}
    if(p.issues.includes('missing_formula')||p.rank===99){excluded.push({product_id:p.product_id,reason:'incomplete_product_truth'});continue;}
    const item={product_id:p.product_id,rank:p.rank,usage_refs:stageRows.filter(s=>s.state!=='mismatch').map(s=>s.u.ref),
      warnings:useful(p.additional_precautions)?[p.additional_precautions]:[],evidence_refs:ext.map(e=>e.id),
      reason:direct.length?'company_usage_match':'external_active_evidence',conditional:!direct.length,
      active_evidence_supported:ext.length>0,product_label_verified:false,company_rate_available:direct.some(u=>u.rate_verified)};
    if(ctx.near_harvest || ctx.stage==='ดอก') {
      pending.push({...item,reason:ctx.near_harvest?'phi_verification_required':'pollinator_review_required'});continue;
    }
    if(!direct.length){
      conditional.push(item);
      // Ingredient evidence alone is not enough: its stage/safety scope must also be reviewed.
      if(ext.some(e=>e.technical_owner_approved===true&&e.stage_verified===true && e.safety_reviewed===true &&
        (e.stage==='all' || (ctx.stage && same(e.stage,ctx.stage))))) eligible.push(item);
      else pending.push({...item,reason:'external_stage_safety_review_required'});
      continue;
    }
    if(!stageRows.some(s=>s.state==='match')){pending.push({...item,reason:'stage_unconfirmed'});continue;}
    eligible.push(item);
  }
  const rank=(a,b)=>a.rank-b.rank||a.product_id.localeCompare(b.product_id);
  eligible.sort(rank);pending.sort(rank);conditional.sort(rank);
  // An unresolved higher-priority candidate must not be silently skipped.
  const needsStage=pending.some(p=>!eligible[0]||p.rank<=eligible[0].rank);
  const primary=ctx.diagnosis_uncertain||needsStage?null:eligible[0]?.product_id||null;
  const blockers=needsStage?pending.filter(p=>!eligible[0]||p.rank<=eligible[0].rank):[];
  const missing=[...new Set(blockers.map(p=>p.reason==='stage_unconfirmed'?'crop_stage':p.reason==='phi_verification_required'?'verified_phi':p.reason==='pollinator_review_required'?'pollinator_review':'external_stage_safety_review'))];
  return {eligible,pending,conditional,excluded,primary_product_id:primary,missing_fields:missing,
    reason:ctx.diagnosis_uncertain?'diagnosis_unresolved':needsStage?'confirm_stage_before_final_choice':'suitability_then_strategy'};
}
module.exports={selectCandidates,cropMatch,stageMatch,evidenceMatch};
