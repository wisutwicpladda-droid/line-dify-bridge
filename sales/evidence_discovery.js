'use strict';
const crypto=require('node:crypto');
// Discovery produces leads only. Neither a model URL nor grounding metadata is a verified claim.
const fingerprint=ctx=>crypto.createHash('sha256').update(JSON.stringify(['intent','crop','target','stage','product_ids','query'].map(k=>[k,ctx[k]||null]))).digest('hex');
function sourceRank(url,type){
 let u;try{u=new URL(url);}catch{return 99;}
 if(u.protocol!=='https:'||u.username||u.password||u.port)return 99;
 if(/(^|\.)(doa|doae|moac)\.go\.th$/.test(u.hostname))return 1;
 if(type==='official_label')return 2;
 if(/\.ac\.th$|\.edu$/.test(u.hostname)||type==='research')return 3;
 if(/(^|\.)(irac-online\.org|frac\.info|hracglobal\.com)$/.test(u.hostname))return 4;
 if(type==='manufacturer')return 5;
 if(type==='reviewed_technical')return 6;return 99;
}
function groundingLeads(metadata,ctx,now=Date.now()){
 const chunks=metadata?.groundingChunks||metadata?.grounding_chunks||[],supports=metadata?.groundingSupports||metadata?.grounding_supports||[];
 return chunks.flatMap((chunk,i)=>{
  const web=chunk.web;if(!web?.uri||!web.title||sourceRank(web.uri)===99)return [];
  const snippets=supports.filter(s=>(s.groundingChunkIndices||s.grounding_chunk_indices||[]).includes(i)).map(s=>s.segment?.text).filter(Boolean);
  if(!snippets.length)return [];
  return [{query_fingerprint:fingerprint(ctx),source_url:web.uri,title:web.title,snippet:snippets.join('\n'),retrieved_at:new Date(now).toISOString(),verification_status:'discovered_unverified',verified:false}];
 });
}
function verifyReviewedClaims(records,{now=Date.now()}={}){
 const valid=records.filter(e=>e.verified&&e.evidence_id&&e.document_hash&&e.source_ref&&e.claim&&e.active_ingredient&&e.formulation&&Array.isArray(e.concentration)&&e.crop&&e.target&&e.jurisdiction&&e.retrieved_at&&Date.parse(e.expires_at)>now&&sourceRank(e.source_url,e.source_type)<99);
 const groups=new Map();for(const e of valid){const key=JSON.stringify([e.claim_type,e.active_ingredient,e.formulation,e.concentration,e.crop,e.target,e.stage,e.jurisdiction]);const group=groups.get(key)||[];group.push(e);groups.set(key,group);}
 const conflicts=[];for(const group of groups.values())if(new Set(group.map(e=>JSON.stringify(e.claim_value??e.claim))).size>1){conflicts.push(...group.map(e=>e.evidence_id));}
 return {evidence:valid.filter(e=>!conflicts.includes(e.evidence_id)),conflicts,status:conflicts.length?'conflict':valid.length?'verified':'unverified'};
}
class Discovery {
 constructor({enabled=false,provider=null}={}){this.enabled=enabled;this.provider=provider;}
 async search(ctx){
  if(!this.enabled||!this.provider)return {status:'provider_unavailable',leads:[],feature_enabled:false};
  const data=await this.provider(ctx);return {status:'discovered_unverified',leads:groundingLeads(data,ctx),feature_enabled:true};
 }
}
module.exports={Discovery,groundingLeads,verifyReviewedClaims,sourceRank,fingerprint};
