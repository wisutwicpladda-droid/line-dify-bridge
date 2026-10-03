'use strict';
const https=require('node:https'),crypto=require('node:crypto');
const registry=require('./evidence_sources.json');
const norm=s=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
const formulation=s=>(String(s||'').match(/\b(?:WG|WP|EC|SC|SL|ZC|SP|SG|GR|CS)\b/i)||[])[0]?.toUpperCase()||null;
const concentrations=s=>String(s||'').match(/\d+(?:\.\d+)?\s*%/g)?.map(x=>x.replace(/\s/g,''))||[];
function reviewedContent(body,e) {
 if(!e.section_start)return body;
 const text=body.toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
 const start=text.indexOf(e.section_start),end=text.indexOf(e.section_end,start);
 if(start<0||end<=start)throw Error('reviewed_section_missing');
 return Buffer.from(text.slice(start,end).trim(),'utf8');
}
function sourceTier(url,type) {
 let u;try{u=new URL(url);}catch{return 99;}
 if(u.protocol!=='https:'||u.username||u.password||u.port)return 99;
 if(/(^|\.)(doa|doae|moac)\.go\.th$/.test(u.hostname))return 1;
 if(/(^|\.)(irac-online\.org|frac\.info|hracglobal\.com)$/.test(u.hostname)||/\.ac\.th$/.test(u.hostname))return 2;
 // Non-government sources must be explicitly reviewed in the registry; no generic domain trust.
 if(registry.some(r=>new URL(r.source_url).hostname===u.hostname && r.source_type===type))return type==='manufacturer'?3:type==='credible_reference'?4:99;
 return 99;
}
function fetchSource(url,{timeoutMs=7000,maxBytes=12500000}={}) {
 // Exact reviewed URLs only. No model/customer URL, redirects, arbitrary ports or private hosts.
 if(!registry.some(r=>r.source_url===url)||sourceTier(url)===99)return Promise.reject(Error('unreviewed_source'));
 return new Promise((resolve,reject)=>{
  const req=https.get(url,{headers:{Accept:'text/html,application/pdf','User-Agent':'Ladda-Staging-Evidence/1.0'}},res=>{
   if(res.statusCode!==200){res.resume();reject(Error('source_http_'+res.statusCode));return;}
   const chunks=[];let size=0;
   res.on('data',c=>{size+=c.length;if(size>maxBytes)req.destroy(Error('source_too_large'));else chunks.push(c);});
   res.on('end',()=>resolve({body:Buffer.concat(chunks),content_type:res.headers['content-type']||''}));res.on('error',reject);
  });req.setTimeout(timeoutMs,()=>req.destroy(Error('source_timeout')));req.on('error',reject);
 });
}
function shouldSearch(ctx,candidates) {
 if(['exposure','greeting','acknowledgement','admin','image','package','rate','team','out_of_scope'].includes(ctx.intent))return false;
 if(ctx.intent==='product'&&/คือสาร|สารอะไร|ชื่อสามัญ|สูตรอะไร|ส่วนประกอบ/.test(ctx.query))return false;
 return !!ctx.needs_web || !!(ctx.crop&&ctx.target&&!ctx.diagnosis_uncertain&&!candidates?.eligible?.length&&!candidates?.pending?.length);
}
class EvidenceProvider {
 constructor({enabled=false,fetcher=fetchSource,now=()=>Date.now()}={}){this.enabled=enabled;this.fetcher=fetcher;this.now=now;this.cache=new Map();}
 async search(ctx,{trace_id}={}) {
  if(!this.enabled)return {evidence:[],status:'disabled',trace_id};
  const started=performance.now(), failures=[],now=this.now();
  // Search a maintained, reviewed source index, then re-fetch the live source. This is NOT general web discovery.
  const matches=registry.filter(e=>norm(e.crop)===norm(ctx.crop) && norm(e.target)===norm(ctx.target) && Date.parse(e.review_valid_until)>now)
    .sort((a,b)=>sourceTier(a.source_url,a.source_type)-sourceTier(b.source_url,b.source_type)).slice(0,3);
  const evidence=(await Promise.all(matches.map(async e=>{
   try {
    let record=this.cache.get(e.source_url);
    if(!record || record.until<=now){const source=await this.fetcher(e.source_url);record={...source,until:now+600000};this.cache.set(e.source_url,record);}
    const content_hash=crypto.createHash('sha256').update(reviewedContent(record.body,e)).digest('hex');
    if(content_hash!==e.reviewed_sha256)throw Error('source_changed_requires_review');
    return {...e,id:e.evidence_id,source:e.source_url,scope:'active_ingredient',verified:true,
      retrieved_at:new Date(now).toISOString(),valid_until:new Date(Math.min(now+600000,Date.parse(e.review_valid_until))).toISOString(),content_hash,
      source_tier:sourceTier(e.source_url,e.source_type),active_evidence_supported:true,product_label_verified:false,company_rate_available:false,
      stage_verified:false,safety_reviewed:false};
   }catch(error){failures.push({evidence_id:e.evidence_id,reason:error.message});return null;}
  }))).filter(Boolean);
  return {evidence,status:evidence.length?'verified_active_only':failures.length?'failed':'no_reviewed_source',failures,trace_id,ms:performance.now()-started};
 }
}
function compatible(e,p) {
 return norm(e.active_ingredient)===norm(p.active_ingredient) && e.formulation===formulation(p.active_ingredient) &&
   JSON.stringify(e.concentration)===JSON.stringify(concentrations(p.active_ingredient));
}
module.exports={EvidenceProvider,shouldSearch,sourceTier,fetchSource,compatible,formulation,concentrations,reviewedContent};
