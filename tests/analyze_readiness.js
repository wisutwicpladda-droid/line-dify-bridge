'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildCatalog}=require('../sales/catalog'),{prepare}=require('../sales/pipeline'),{finalPayload}=require('../sales/contracts');
const catalog=buildCatalog(require('./fixtures/company-snapshot.json'),require('../product_images/index.json'));
const dir=path.join(__dirname,'results'),load=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const write=(n,d)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(d,null,2));
function canonical(o){if(Array.isArray(o))return o.map(canonical);if(o&&typeof o==='object')return Object.fromEntries(Object.keys(o).filter(k=>k!=='updated_at').sort().map(k=>[k,canonical(o[k])]));return o;}
const implementationHash=crypto.createHash('sha256').update(['router','candidates','pipeline','contracts'].map(n=>fs.readFileSync(path.join(__dirname,'../sales/'+n+'.js'),'utf8')).join('\n')).digest('hex');
const live=load('live-preview.json').map((r,i)=>{
 const capture_error=i===0&&r.id==='A-known-pest'&&r.final.failures.includes('invalid_json');
 const work=prepare(r.query,{catalog,previous:r.id==='P-followup'?{crop:'ทุเรียน',intent:'symptom',diagnosis_uncertain:true}:{},ownership:{state:'BOT_ACTIVE'},evidence:r.prepared.external_evidence_summary||[]});
 const same=JSON.stringify(canonical(work.prepared))===JSON.stringify(canonical(r.prepared));
 let text=r.metrics;try{text=JSON.parse(text).trace||text;}catch{}
 const stages=[...text.matchAll(/- generic: ([^\n]+)\n  - generic: (?:(\d+(?:\.\d+)?)(K)? tokens · )?(\d+(?:\.\d+)?) (ms|s)/g)].map(m=>({name:m[1],tokens:+(m[2]||0)*(m[3]?1000:1),ms:+m[4]*(m[5]==='s'?1000:1)}));
 const currentFinal=!capture_error?finalPayload(r.raw,work):null;
 return {...r,capture_error,prepared_semantic_parity:same,current_final:currentFinal,validated_against_current:currentFinal?currentFinal.failures:['capture_error'],
  timing:{scope:'Dify Preview node durations, sum excludes network/queue/LINE; displayed token counts rounded',stages,sum_node_ms:stages.reduce((a,s)=>a+s.ms,0),displayed_total_tokens:stages.reduce((a,s)=>a+s.tokens,0)}};
});
const pct=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]:null;
const groups={normal:live.filter(r=>/^[ABL]-/.test(r.id)&&!r.capture_error),deep:live.filter(r=>/^[CDEFGHIJMNOP]-/.test(r.id)),forced_lookup:live.filter(r=>r.id==='K-product')};
const latency=Object.fromEntries(Object.entries(groups).map(([g,r])=>[g,{count:r.length,p50_sum_node_ms:pct(r.map(r=>r.timing.sum_node_ms),.5),p95_sum_node_ms:pct(r.map(r=>r.timing.sum_node_ms),.95),max_sum_node_ms:Math.max(...r.map(r=>r.timing.sum_node_ms)),displayed_tokens:r.reduce((a,r)=>a+r.timing.displayed_total_tokens,0),scope:'not LINE end-to-end; small exploratory sample, not SLA'}]));
const rag=load('rag-live-ui.json').map(r=>{
 const chunks=r.snapshot.split(/(?=  - generic: Chunk-)/).slice(1).map(c=>({chunk:c.match(/Chunk-(\d+)/)?.[1],score:+(c.match(/generic: score\s+- generic: "([\d.]+)"/)?.[1]||0),text:c,product_ids:[...c.matchAll(/รหัสสินค้า: (P\d+)/g)].map(m=>m[1])}));
 for(const c of chunks){const ps=c.product_ids.map(id=>catalog.products.get(id)).filter(Boolean);
  c.relevant=r.intent==='exact_product'||r.intent==='product_typo'?c.product_ids.includes('P0062'):
   r.intent==='rate'?ps.some(p=>p.canonical_name==='นาแดน-จี'):
   r.intent==='comparison'?ps.some(p=>['แกนเตอร์','อะนิลการ์ด'].includes(p.canonical_name)):
   r.intent==='symptom'?false:
   r.intent==='crop_pest'?ps.some(p=>p.usage.some(u=>/ข้าว/.test(u.crop_name||u.crop_group)&&u.target_name.includes('หญ้าข้าวนก'))):
   r.intent==='crop_disease'?ps.some(p=>p.usage.some(u=>/ข้าว/.test(u.crop_name||u.crop_group)&&u.target_name.includes('โรคไหม้'))):
   r.intent==='full_season'?ps.some(p=>p.usage.some(u=>/ข้าว/.test(u.crop_name||u.crop_group)))||c.text.includes('สารบัญการใช้'):false;
 }
 const metric=cs=>({k:cs.length,relevant:cs.filter(c=>c.relevant).length,irrelevant:cs.filter(c=>!c.relevant).length,precision:cs.length?cs.filter(c=>c.relevant).length/cs.length:null});
 return {...r,chunks,...metric(chunks),offline_sensitivity:{top1:metric(chunks.slice(0,1)),top3:metric(chunks.slice(0,3)),threshold035:metric(chunks.filter(c=>c.score>=.35))}};
});
write('readiness-analysis.json',{at:new Date().toISOString(),implementationHash,catalog_version:catalog.version,live,latency,rag,
 rag_scoring:'Deterministic narrow relevance from product ID + company usage. Symptom diagnosis requires differential evidence, not product listings (all returned listings scored irrelevant). Scores rounded by Dify UI. Review with technical owner; not an approved clinical gold set.',
 network_fast_path:'BLOCKED: no authorized LINE staging channel/credentials',line_e2e:'NOT RUN',production_gate:'CLOSED'});
console.log(JSON.stringify({live:live.length,current_prepared:live.filter(r=>r.prepared_semantic_parity&&!r.capture_error).length,raw_blocked:live.filter(r=>r.final.failures.length&&!r.capture_error).map(r=>r.id),latency,rag:rag.map(r=>({intent:r.intent,mode:r.mode,p:r.precision,k:r.k}))}));
