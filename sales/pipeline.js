'use strict';
const crypto=require('crypto');
const {extract,fastAnswer,boundedContext,result}=require('./router');
const {selectCandidates}=require('./candidates');
const {rateAnswer}=require('./rates');
const {finalPayload}=require('./contracts');
const {imageRequest}=require('./images');
const {shouldSearch}=require('./external_evidence');
const {buildClaims,defaultPlan}=require('./claims');
const {unansweredQuestions,recordAsked}=require('./conversation_facts');
function prepare(query,{catalog,previous={},history=[],ownership={},preference=null,evidence=[]}={}) {
  const context=extract(query,catalog,previous);
  const candidates=catalog?selectCandidates(catalog,context,evidence):null;
  const selectedIds=[...new Set([...context.product_ids,...(candidates?.eligible||[]).slice(0,6).map(p=>p.product_id),...(candidates?.pending||[]).slice(0,6).map(p=>p.product_id)])];
  const allowed=selectedIds.map(id=>catalog?.products.get(id)).filter(p=>p?.open);
  const primary=candidates?.eligible.find(p=>p.product_id===candidates.primary_product_id);
  const computedRate=context.rate_requested&&catalog?rateAnswer(context,catalog):null;
  const selecting=['known_problem','season_program','general_agriculture'].includes(context.intent);
  const requiredWarnings=selecting?primary?.warnings||[]:[];
  const questionOptions=unansweredQuestions(context,candidates);
  const requiredQuestions=questionOptions.map(q=>q.text);
  if(context.near_harvest)requiredWarnings.push('ใกล้เก็บเกี่ยว ต้องตรวจระยะเว้นก่อนเก็บเกี่ยวของสินค้านั้นก่อนใช้ค่ะ');
  if(context.stage==='ดอก'&&!['package','rate'].includes(context.intent))requiredWarnings.push('ช่วงดอกบานต้องระวังแมลงผสมเกสร และยังไม่ควรสรุปว่าปลอดภัยต่อดอกจากชื่อสารอย่างเดียวค่ะ');
  const allowedClaims=buildClaims(catalog,context,candidates,evidence);
  const prepared={
    intent:context.intent,needs_web:context.needs_web,customer_state:context,catalog_version:catalog?.version||null,
    diagnosis_state:{uncertain:context.diagnosis_uncertain,confirmed_target:context.target||null},
    uncertainties:context.diagnosis_uncertain?['ต้องแยกโรค น้ำขัง ขาดธาตุ และผลจากสารก่อนเลือกยา']:[],
    missing_fields:candidates?.missing_fields||[],validated_candidates:candidates?.eligible||[],
    conditional_candidates:candidates?.conditional||[],
    strategy_selected_candidate:candidates?.primary_product_id||null,
    allowed_product_facts:[],
    allowed_product_claims:allowedClaims,
    claim_control:{version:2,enforced:context.intent!=='team'&&(!!context.product_ids.length||context.diagnosis_uncertain||['known_problem','comparison','competitor','regulatory','season_program'].includes(context.intent)||context.near_harvest||context.stage==='ดอก')},
    question_options:questionOptions,
    retrieval_plan:{query_llm:false,rag:false,reason:'Company facts/usage are structured; Main handles ambiguity directly; reviewed prose retrieval remains an explicit opt-in'},
    allowed_rates:computedRate?allowed.flatMap(p=>p.usage.filter(u=>computedRate.rate_refs.includes(u.ref))):[],
    required_warnings:requiredWarnings,required_questions:requiredQuestions,
    external_evidence_summary:evidence.filter(e=>e.verified),human_state:ownership.state||'BOT_ACTIVE',
    communication_preference:preference&&Date.parse(preference.expires_at)>Date.now()?preference:null,conversation:boundedContext(history,ownership.summary)
  };
  const work={context,catalog,candidates,requiredWarnings,requiredQuestions,evidence,prepared};
  prepared.answer_plan_default=defaultPlan(work);
  prepared.guidance_options=require('./claims').GUIDANCE;
  return work;
}
async function run(query,options) {
  const started=performance.now(),trace_id=crypto.randomUUID(),timings={};
  let at=performance.now();let work=prepare(query,options);timings.prepare=performance.now()-at;
  let external={status:'not_needed',evidence:[],failures:[]};
  const picture=imageRequest(query,options.catalog);
  if(picture)work.context.product_ids=picture.ids;
  let raw=picture?result(picture.answer,'image',{image_product_ids:picture.ids}):
    fastAnswer(work.context,options.catalog)|| (options.catalog?rateAnswer(work.context,options.catalog):null),route=raw?'fast':'deep',usage=null;
  if(raw)work.generatedLocally=true;
  // A complete code-selected recommendation or a two-product fact comparison needs no model rewrite.
  if(!raw&&((work.context.intent==='known_problem'&&work.candidates?.primary_product_id)||work.context.intent==='comparison')) {
    raw={answer_plan:defaultPlan(work)};route='structured';
  }
  if(!work.generatedLocally){
    if(options.strictKnowledgeVersion && (options.knowledgeRelease?.status!=='ready' ||
       options.knowledgeRelease?.catalogVersion!==options.catalog?.version)) {
      raw=result('น้องลัดดากำลังตรวจข้อมูลสินค้ารุ่นล่าสุดค่ะ ยังยืนยันคำแนะนำนี้ไม่ได้ ขอให้ทีมงานช่วยตรวจต่อ','unavailable');
      route='knowledge_not_ready';
      work.generatedLocally=true;
    }
  }
  if(!raw){
    if(shouldSearch(work.context,work.candidates)) {
      at=performance.now();
      try{external=options.evidenceProvider?await options.evidenceProvider.search(work.context,{trace_id}):{status:'disabled',evidence:[],failures:[]};}
      catch{external={status:'failed',evidence:[],failures:[{reason:'provider_failed'}]};}
      timings.web_evidence=performance.now()-at;
      work=prepare(query,{...options,evidence:[...(options.evidence||[]),...external.evidence]});
      work.prepared.external_evidence_status=external.status;
    }
    at=performance.now();
    try{const generation=await options.generate({query,prepared_context:JSON.stringify(work.prepared),trace_id,needs_web:work.context.needs_web});
      raw=generation.answer||generation;usage=generation.usage||null;
    }catch{raw=result('ตอนนี้น้องลัดดายังตรวจข้อมูลส่วนนี้ไม่ได้ค่ะ รบกวนลองใหม่หรือให้ทีมงานช่วยตรวจต่อ','unavailable');work.generatedLocally=true;}
    timings.generate=performance.now()-at;
  }
  at=performance.now();const output=finalPayload(raw,work);timings.validate_render=performance.now()-at;
  recordAsked(work.context,work.prepared.question_options.filter(q=>output.response.answer_text.includes(q.text)));
  const metrics={trace_id,intent:work.context.intent,route,catalog_version:options.catalog?.version||null,ownership_version:options.ownership?.version,
    candidate_ids:work.candidates?.eligible.map(p=>p.product_id)||[],filtered:work.candidates?.excluded||[],
    planned_primary_product_id:work.candidates?.primary_product_id||null,
    primary_product_id:output.response.primary_product_id||null,external_evidence_used:output.response.evidence_refs,
    external_evidence_status:external.status,external_failures:external.failures||[],
    release_id:options.releaseId||'unversioned-staging',jev_status:'disabled',dify_version:options.difyVersion||null,kb_version:options.knowledgeRelease?.catalogVersion||null,
    model:route==='deep'?'gemini-3.8-flash':null,query_llm_planned:route==='deep'&&work.prepared.retrieval_plan.query_llm,rag_planned:false,
    block:output.failures.length>0,safe_fallback:!!output.safe_fallback,unsupported_prose_removed:!!output.prose_removed,
    claim_refs:output.response.claim_refs||[],timings,total_ms:performance.now()-started,usage,failures:output.failures};
  // Only the product-name token enters the requested alias review queue, never the full transcript.
  const unknown=query.match(/(?:สินค้าชื่อ|ยาชื่อ|สารชื่อ)\s*["“]?([^\s"”?,]{2,50})/);
  if(unknown&&/^[\p{L}\p{M}\d-]+$/u.test(unknown[1])&&/[\p{L}]/u.test(unknown[1])&&!options.catalog?.index.resolve(unknown[1]))metrics.alias_review={event_type:'unknown_product_spelling',product_name_token:unknown[1],spelling_hash:crypto.createHash('sha256').update(unknown[1]).digest('hex'),review_status:'unreviewed',auto_apply:false};
  options.observe?.(metrics);
  return {...output,metrics,context:work.context,prepared:work.prepared};
}
module.exports={prepare,run};
