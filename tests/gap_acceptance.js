'use strict';
const fs=require('node:fs');
const {buildCatalog}=require('../sales/catalog'),{run}=require('../sales/pipeline');
const {harness}=require('./helpers/bridge_harness');
const catalog=buildCatalog(require('./fixtures/company-snapshot.json'),require('../product_images/index.json'));
const core=[
 ['A-flowering','A','ทุเรียนช่วงดอกบาน มีเพลี้ยไฟ ใช้อะไรดี'],['A-harvest','A','อีก 7 วันจะเก็บเกี่ยวทุเรียน ฉีดกำจัดเพลี้ยไฟได้ไหม'],
 ['A-injury','A','ข้าวใบไหม้หลังพ่นยาเมื่อวาน เป็นโรคไหม้ไหม'],['A-exposure','A','ยาฆ่าแมลงเข้าตา'],
 ['A-registration','A','ไบเตอร์ขึ้นทะเบียนสำหรับข้าวโพดไหม'],['A-closed','A','คริซ่าคือสารอะไร'],
 ['B-barnyard','B','ข้าว 10 วัน มีหญ้าข้าวนก ใช้อะไรดี'],['B-weedy','B','ข้าว 9 วัน มีข้าวดีด ใช้อะไรดี'],
 ['B-disease','B','ข้าวตรวจยืนยันโรคไหม้แล้ว อายุ 30 วัน ใช้อะไรดี'],['B-stage','B','ในนาข้าวมีหญ้าข้าวนก ควรใช้ตัวไหน'],
 ['B-compare','B','แกนเตอร์กับอนิลการ์ดต่างกันอย่างไร'],['B-rate','B','นาแดน-จี 170 ไร่ใช้กี่กระสอบ'],
 ['B-mango','B','บอมส์ ไวท์ คือสารอะไร'],['B-corn','B','ข้าวโพดมีเพลี้ยไฟ แนะนำอะไร'],
 ['B-sugarcane','B','อ้อย 2 เดือน มีหญ้าใช้อะไรดี'],['B-season','B','ข้าวแนะนำตั้งแต่เริ่มปลูกจนเก็บเกี่ยว'],
 ['B-greeting','B','สวัสดีค่ะ']
];
const cases=core.map(([id,tier,query])=>({id,tier,query})).concat([...catalog.products.values()].map(p=>({id:'C-'+p.product_id,tier:'C',query:p.canonical_name+' คือสารอะไร'})));
(async()=>{
 const live=JSON.parse(fs.readFileSync('tests/results/gap-live-preview.json','utf8'));
 const rows=[];
 for(const c of cases){
  const actual=[...live].reverse().find(x=>x.query===c.query);let called=false;
  const r=await run(c.query,{catalog,generate:async()=>{called=true;return actual?{answer:actual.raw}:Promise.reject(Error('no live capture for this case'));}});
  rows.push({...c,confirmed_facts:r.context.facts,candidates:r.prepared.validated_candidates,selected_product:r.response.primary_product_id,
   company_evidence:r.prepared.allowed_product_claims,external_evidence:r.prepared.external_evidence_summary,
   raw_answer:called?actual?.raw||null:'NOT CALLED — deterministic catalog/candidate path',final_answer:r.response.answer_text,
   final_line_payload:r.messages,why:r.failures.length?r.failures:r.metrics.route,metrics:r.metrics,
   measurement:called?(actual?'Live Dify replay':'NOT EXECUTED — no capture'):'Local deterministic real pipeline',review_status:'UNREVIEWED'});
 }
 const h=harness({knowledgeVersion:catalog.version});await h.api.refreshProductMaster();const latency={};
 for(const [group,q] of [['greeting','สวัสดีค่ะ'],['exact','ไบเตอร์คือสารอะไร'],['package','นาแดน-จีขนาดอะไร'],['known_problem','ข้าว 10 วัน มีหญ้าข้าวนก ใช้อะไรดี'],['comparison','แกนเตอร์กับอนิลการ์ดต่างกันอย่างไร']]){
  const times=[];for(let i=0;i<30;i++){const t=performance.now();await h.api.handleEvent(h.event(q));times.push(performance.now()-t);}times.sort((a,b)=>a-b);
  latency[group]={samples:times.length,p50_ms:times[14],p95_ms:times[28],final_line_payload:h.sent.at(-1),scope:'actual handler / mocked network — NOT LINE SLA'};
 }
 const byIntent={};for(const r of rows.filter(x=>!x.measurement.startsWith('NOT EXECUTED'))){const m=r.metrics,g=byIntent[m.intent]||={n:0,blocked:0,safe_fallback:0,recommended:0,selection_ready:0};g.n++;g.blocked+=+m.block;g.safe_fallback+=+m.safe_fallback;g.recommended+=+!!m.primary_product_id;g.selection_ready+=+!!m.planned_primary_product_id;}
 fs.writeFileSync('tests/results/gap-acceptance.json',JSON.stringify({at:new Date().toISOString(),catalog_version:catalog.version,rows,by_intent:byIntent,local_latency:latency,owner_approved:0,production_release_allowed:false},null,2)+'\n');
 console.log(JSON.stringify({cases:rows.length,by_intent:byIntent,local_latency:latency},null,2));
})();
