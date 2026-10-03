'use strict';
// Explicit network test, not part of default unit suite. Reads official public sources only.
const fs=require('node:fs');
const {EvidenceProvider,compatible}=require('../sales/external_evidence');
const {buildCatalog}=require('../sales/catalog'),{selectCandidates}=require('../sales/candidates');
const catalog=buildCatalog(require('./fixtures/company-snapshot.json'));
(async()=>{
 const provider=new EvidenceProvider({enabled:true}),results=[];
 for(const ctx of [{crop:'ข้าวโพด',target:'เพลี้ยกระโดดท้องขาว',stage:'เจริญทางใบ'},{crop:'ทุเรียน',target:'ด้วงหนวดยาวเจาะลำต้น'},{crop:'ทุเรียน',target:'แมลงปีกแข็ง'}]){
  const external=await provider.search(ctx,{trace_id:'live-evidence-'+results.length});const candidates=selectCandidates(catalog,ctx,external.evidence);
  results.push({context:ctx,external,candidates:{conditional:candidates.conditional,pending:candidates.pending,primary:candidates.primary_product_id},
    compatibility:external.evidence.map(e=>({evidence_id:e.evidence_id,compatible_products:[...catalog.products.values()].filter(p=>compatible(e,p)).map(p=>p.product_id)}))});
 }
 fs.writeFileSync('tests/results/'+(process.env.QA_EVIDENCE_FILE||'live-evidence.json'),JSON.stringify({environment:'live HTTPS source retrieval, local real catalog matching; no LINE',at:new Date().toISOString(),results},null,2));
 console.log(JSON.stringify(results.map(r=>({crop:r.context.crop,target:r.context.target,status:r.external.status,failures:r.external.failures,conditional:r.candidates.conditional.map(c=>c.product_id),primary:r.candidates.primary}))));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
