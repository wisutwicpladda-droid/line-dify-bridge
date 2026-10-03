'use strict';
const crypto=require('node:crypto');
const {normalize}=require('../product_identity');
const useful=v=>!!String(v||'').trim()&&!/^(none|n\/a|ไม่มี|-)$/.test(String(v).trim());
const SUMMARY={
 uncertain:'อาการนี้ยังแยกสาเหตุไม่ได้แน่ชัดค่ะ น้องลัดดาขอข้อมูลเพิ่มเพื่อเลือกแนวทางให้ตรง',
 risk:'น้องลัดดายังยืนยันวิธีใช้ที่ปลอดภัยในระยะนี้ไม่ได้ค่ะ ต้องตรวจข้อจำกัดของสินค้าก่อน',
 regulatory_unknown:'น้องลัดดายังตรวจยืนยันทะเบียนหรือระยะเว้นก่อนเก็บเกี่ยวสำหรับกรณีนี้ไม่ได้ค่ะ ต้องตรวจฉลากหรือแหล่งทางการเพิ่มเติม',
 conditional:'สารสำคัญมีข้อมูลรองรับในกรณีนี้ค่ะ แต่ยังต้องตรวจระยะพืชและข้อจำกัดก่อนเลือกใช้สินค้า ข้อมูลนี้ไม่ได้ยืนยันทะเบียนหรืออัตราใช้ของสินค้า',
 no_match:'น้องลัดดายังเลือกสินค้าที่ตรงเงื่อนไขนี้ไม่ได้ค่ะ ขอข้อมูลเพิ่มหรือให้ทีมงานตรวจต่อ',
 ask_stage:'ตัวเลือกขึ้นอยู่กับระยะพืชค่ะ น้องลัดดาขอทราบระยะก่อนเลือกตัวที่เหมาะ',
 comparison:'จุดต่างจากข้อมูลบริษัทมีดังนี้ค่ะ',
 none:''
};
const GUIDANCE={observe:'สังเกตตำแหน่งที่เริ่มเป็นและการกระจายของอาการไว้ก่อนค่ะ',inspect_root:'ตรวจรากและสภาพน้ำรอบต้น โดยยังไม่สรุปว่าเป็นเชื้อราจากอาการอย่างเดียวค่ะ'};
function factFacet(ctx) {
 const t=ctx.query||'';
 if(/strategy|expand|skyrocket|natural|cosmic|standard/i.test(t))return 'internal';
 if(ctx.intent==='package')return 'package';
 if(/จุดเด่น|คุณสมบัติ/.test(t))return 'selling_point';
 if(/กลุ่ม(?:สาร|กลไก)|IRAC|FRAC|HRAC|ออกฤทธิ์กลุ่ม/i.test(t))return 'moa';
 if(/กลุ่มอะไร|ประเภทอะไร/.test(t))return 'category';
 if(/ขายหรือยัง|เปิดขาย|สถานะขาย|เปิดตัว|จำหน่ายหรือยัง/.test(t))return 'status';
 if(/ใช้กับอะไร|ใช้กับพืชอะไร|กำจัดอะไร|ตามข้อมูลบริษัท/.test(t))return 'usage';
 if(/ข้อควรระวัง/.test(t))return 'precautions';
 if(/คือสาร|สารอะไร|ชื่อสามัญ|ส่วนประกอบ|สูตรอะไร/.test(t))return 'ingredient';
 return null;
}
function addClaim(out,catalog,p,field,value,ref,text) {
 if(!useful(typeof value==='string'?value:JSON.stringify(value)))return;
 const digest=crypto.createHash('sha256').update(JSON.stringify([catalog.version,p.product_id,field,value,ref])).digest('hex').slice(0,18);
 out.push({claim_id:'C'+digest,product_id:p.product_id,field,value,source_type:'company_catalog',source_ref:ref,catalog_version:catalog.version,text});
}
function buildClaims(catalog,ctx,candidates,evidence=[]) {
 if(!catalog)return [];
 const ids=ctx.intent==='comparison'?[...(ctx.product_ids||[])]:[...new Set([...(ctx.product_ids||[]),...(candidates?.eligible||[]).map(p=>p.product_id),...(candidates?.conditional||[]).map(p=>p.product_id)])];
 const out=[],facet=factFacet(ctx);
 for(const id of ids){const p=catalog.products.get(id);if(!p?.open)continue;
  const name='"'+p.canonical_name+'"',ref='master:'+id;
  const direct=ctx.intent==='product'||ctx.intent==='package';
  if(!direct||!facet||facet==='ingredient')addClaim(out,catalog,p,'active_ingredient',p.common_name_th,ref,name+' มีสารสำคัญ '+p.common_name_th+' ค่ะ');
  if(facet==='moa')addClaim(out,catalog,p,'moa',p.moa_group,ref,name+' อยู่กลุ่มกลไกการออกฤทธิ์ '+p.moa_group+' ตามข้อมูลบริษัทค่ะ');
  if(facet==='category')addClaim(out,catalog,p,'category',p.product_category,ref,name+' เป็น'+p.product_category+'ค่ะ');
  if(facet==='selling_point')addClaim(out,catalog,p,'selling_point',p.selling_point,ref,'ข้อมูลบริษัทระบุจุดเด่นของ '+name+': '+p.selling_point);
  if(facet==='status')addClaim(out,catalog,p,'availability',p.status_selling,ref,name+' เปิดจำหน่ายแล้วค่ะ ส่วนสต็อกต้องตรวจสอบกับร้านอีกครั้ง');
  if(facet==='precautions')addClaim(out,catalog,p,'precaution',p.additional_precautions,ref,'ข้อควรระวังของ '+name+': '+p.additional_precautions);
  if(facet==='package')for(const k of p.packages)addClaim(out,catalog,p,'package',{value:k.package_size_value,unit:k.package_size_unit},k.package_id,name+' มีขนาด '+k.package_size_value+' '+k.package_size_unit+' ค่ะ');
  const rows=p.usage.filter(u=>(!ctx.crop||normalize(u.crop_name||u.crop_group)===normalize(ctx.crop)||(ctx.crop==='ข้าว'&&u.crop_group==='นาข้าว'))&&(!ctx.target||normalize(u.target_name).includes(normalize(ctx.target))));
  if(facet==='usage'||!direct)for(const u of rows){
   const target=ctx.target||u.target_name,crop=u.crop_name||u.crop_group;
   addClaim(out,catalog,p,'crop_target',{crop,target},u.ref,name+' มีข้อมูลบริษัทสำหรับ'+target+'ใน'+crop+'ค่ะ');
   // Stage is row-scoped; never turn an all-stage entry into pollinator or PHI evidence.
   if(!ctx.near_harvest&&ctx.stage!=='ดอก')addClaim(out,catalog,p,'stage',u.crop_stage,u.ref,name+' ระยะใช้ที่บริษัทระบุ: '+u.crop_stage);
   if(facet==='usage')addClaim(out,catalog,p,'application',u.how_to_use,u.ref,name+' วิธีใช้ตามข้อมูลบริษัท: '+u.how_to_use);
  }
 }
 for(const e of evidence){
  if(!e.verified||e.conflict||!e.evidence_id||!(Date.parse(e.valid_until||e.expires_at)>Date.now()))continue;
  // Explicit label/PHI verification is distinct from ingredient-use evidence.
  if(['phi','registration','pollinator_safety'].includes(e.claim_type)&&!e.product_label_verified)continue;
  out.push({claim_id:'E'+e.evidence_id,product_id:e.product_id||null,field:e.claim_type,value:e.claim,source_type:e.source_type,source_ref:e.evidence_id,text:'ข้อมูลสารสำคัญ: '+e.claim,evidence_id:e.evidence_id});
 }
 return out;
}
function directFact(ctx,catalog,claims) {
 const p=ctx.product_ids?.length===1?catalog?.products.get(ctx.product_ids[0]):null,facet=factFacet(ctx);
 if(!p||!['product','package'].includes(ctx.intent)||!facet)return null;
 if(facet==='internal')return {text:'ชื่อกลุ่มภายในบริษัทไม่ใช่ข้อมูลสำหรับลูกค้าค่ะ น้องลัดดาช่วยอธิบายประเภทสินค้าหรือกลไกการออกฤทธิ์ได้',claim_refs:[]};
 if(!p.open)return {text:'สินค้านี้ยังไม่เปิดจำหน่ายค่ะ',claim_refs:[]};
 const unique=[...new Map(claims.filter(c=>c.product_id===p.product_id).map(c=>[c.text,c])).values()];
 return {text:unique.length?unique.map(c=>c.text).join('\n'):'น้องลัดดายังไม่มีข้อมูลส่วนนี้ของสินค้าที่ตรวจยืนยันได้ค่ะ ขอให้ทีมงานตรวจต่อ',claim_refs:unique.map(c=>c.claim_id)};
}
function defaultPlan(work) {
 const {context:c,candidates:k,prepared:p}=work,claims=p.allowed_product_claims||[];
 let summary_key=c.diagnosis_uncertain?'uncertain':c.near_harvest||c.stage==='ดอก'?'risk':c.intent==='regulatory'?'regulatory_unknown':k?.conditional.length?'conditional':k?.missing_fields.includes('crop_stage')?'ask_stage':'no_match';
 let claim_refs=[];
 if(c.intent==='comparison'){summary_key='comparison';claim_refs=claims.filter(x=>x.field==='active_ingredient').map(x=>x.claim_id);}
 if(c.intent!=='comparison'&&k?.primary_product_id&&!c.diagnosis_uncertain&&!c.near_harvest&&c.stage!=='ดอก'){
  summary_key='none';const found=claims.find(x=>x.product_id===k.primary_product_id&&x.field==='crop_target');if(found)claim_refs=[found.claim_id];
 }
 if(c.intent!=='comparison'&&k?.conditional.length)claim_refs=claims.filter(x=>x.source_type!=='company_catalog').slice(0,2).map(x=>x.claim_id);
 return {summary_key,claim_refs,guidance_ids:[],question_ids:(p.question_options||[]).map(q=>q.id)};
}
function renderPlan(plan,work) {
 const p=work.prepared,claimMap=new Map((p.allowed_product_claims||[]).map(c=>[c.claim_id,c])),failures=[];
 if(!plan||typeof plan!=='object')return {failures:['missing_answer_plan']};
 for(const k of ['claim_refs','guidance_ids','question_ids'])if(!Array.isArray(plan[k])||plan[k].some(x=>typeof x!=='string'))failures.push('invalid_plan_'+k);
 if(!Object.hasOwn(SUMMARY,plan.summary_key))failures.push('invalid_plan_summary');
 if(failures.length)return {failures};
 if(plan.claim_refs.some(id=>!claimMap.has(id)))failures.push('unsupported_claim_ref');
 if(plan.guidance_ids.some(id=>!Object.hasOwn(GUIDANCE,id)))failures.push('unsupported_guidance');
 if(plan.question_ids.some(id=>!p.question_options.some(q=>q.id===id)))failures.push('unsupported_or_answered_question');
 const allowedSummary=defaultPlan(work).summary_key;
 if(plan.summary_key!==allowedSummary)failures.push('summary_outside_scope');
 if(failures.length)return {failures};
 const selected=plan.claim_refs.map(id=>claimMap.get(id));
 // No free model prose enters the product truth boundary. Unknown text is retained only in trace.
 const questions=p.question_options||[],text=[SUMMARY[plan.summary_key],...selected.map(c=>c.text),...plan.guidance_ids.map(id=>GUIDANCE[id]),...work.requiredWarnings,...questions.map(q=>q.text)].filter(Boolean).join('\n');
 const primary=work.candidates?.primary_product_id;
 return {failures:[],text,claim_refs:plan.claim_refs,primary:selected.some(c=>c.product_id===primary&&c.field==='crop_target')?primary:null,evidence_refs:selected.filter(c=>c.evidence_id).map(c=>c.evidence_id)};
}
module.exports={factFacet,buildClaims,directFact,defaultPlan,renderPlan,SUMMARY,GUIDANCE};
