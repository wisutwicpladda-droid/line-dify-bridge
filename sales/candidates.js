'use strict';
const {normalize,useful}=require('./catalog');
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
    const ranges=[...stage.matchAll(/(\d+)\s*[-–]\s*(\d+)/g)];
    if(ranges.length)return ranges.some(m=>ctx.age_days>=+m[1]&&ctx.age_days<=+m[2])?'match':'mismatch';
    return ctx.stage&&stage.includes(ctx.stage)?'match':'unknown';
  }
  return ctx.stage&&stage.includes(ctx.stage)?'match':'missing';
}
function evidenceMatch(e,p,ctx) {
  // Evidence is an approved adapter result, never a model's invented source URL.
  return e.verified===true && e.scope==='active_ingredient' && !!e.source && !!e.retrieved_at && !!e.claim &&
    same(e.active_ingredient,p.active_ingredient) && same(e.formulation,p.physical_form) &&
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
    if(ctx.safety_blocked_ids?.includes(p.product_id)){excluded.push({product_id:p.product_id,reason:'safety_exclusion'});continue;}
    if(!p.open){excluded.push({product_id:p.product_id,reason:'closed_or_unknown_status'});continue;}
    if(p.issues.includes('missing_formula')||p.rank===99){excluded.push({product_id:p.product_id,reason:'incomplete_product_truth'});continue;}
    const item={product_id:p.product_id,rank:p.rank,usage_refs:stageRows.filter(s=>s.state!=='mismatch').map(s=>s.u.ref),
      warnings:useful(p.additional_precautions)?[p.additional_precautions]:[],evidence_refs:ext.map(e=>e.id),
      reason:direct.length?'company_usage_match':'external_active_evidence',conditional:!direct.length};
    if(!direct.length){
      conditional.push(item);
      // Ingredient evidence alone is not enough: its stage/safety scope must also be reviewed.
      if(ext.some(e=>e.stage_verified===true && e.safety_reviewed===true &&
        (e.stage==='all' || (ctx.stage && same(e.stage,ctx.stage))))) eligible.push(item);
      else pending.push(item);
      continue;
    }
    if(!stageRows.some(s=>s.state==='match')){pending.push(item);continue;}
    eligible.push(item);
  }
  const rank=(a,b)=>a.rank-b.rank||a.product_id.localeCompare(b.product_id);
  eligible.sort(rank);pending.sort(rank);conditional.sort(rank);
  // An unresolved higher-priority candidate must not be silently skipped.
  const needsStage=pending.some(p=>!eligible[0]||p.rank<=eligible[0].rank);
  const primary=ctx.diagnosis_uncertain||needsStage?null:eligible[0]?.product_id||null;
  return {eligible,pending,conditional,excluded,primary_product_id:primary,missing_fields:needsStage?['crop_stage']:[],
    reason:ctx.diagnosis_uncertain?'diagnosis_unresolved':needsStage?'confirm_stage_before_final_choice':'suitability_then_strategy'};
}
module.exports={selectCandidates,cropMatch,stageMatch,evidenceMatch};
