'use strict';
const fs=require('node:fs'),{performance}=require('node:perf_hooks');
const {harness}=require('./helpers/bridge_harness');
const {buildCatalog}=require('../sales/catalog'),{selectCandidates}=require('../sales/candidates');
const fixture=require('./fixtures/company-snapshot.json'),images=require('../product_images/index.json');
const catalog=buildCatalog(fixture,images);
(async()=>{
 const h=harness();await h.api.refreshProductMaster();
 const results={measured_at:new Date().toISOString(),scope:'Real Bridge handlers, in-process; mocked LINE network; zero live customers. NOT real network p95.',routes:{},strategy:[],catalog:{}};
 for(const [name,q]of [['greeting','สวัสดีค่ะ'],['lookup','ไบเตอร์คือสารอะไร'],['package','นาแดน-จีขนาดบรรจุเท่าไร']]) {
  const ms=[];for(let i=0;i<60;i++){const t=performance.now();await h.api.handleEvent(h.event(q));ms.push(performance.now()-t);}
  ms.sort((a,b)=>a-b);results.routes[name]={samples:ms.length,mean_ms:ms.reduce((a,b)=>a+b,0)/ms.length,p95_ms:ms[Math.ceil(ms.length*.95)-1],input_tokens:0,
    final_LINE_payload:h.sent.at(-1)};
 }
 const gold=[
  {id:'rice-barnyard-10d',context:{crop:'ข้าว',target:'หญ้าข้าวนก',age_days:10},primary:'P0034',order:['P0034','P0081','P0008','P0009','P0041']},
  {id:'rice-weedy-9d',context:{crop:'ข้าว',target:'ข้าวดีด',age_days:9},primary:'P0046',order:['P0046']},
  {id:'durian-thrips',context:{crop:'ทุเรียน',target:'เพลี้ยไฟ',stage:'ทุกระยะ'},primary:'P0075',order:['P0075','P0062','P0087','P0017','P0029','P0031']}
 ];
 for(const g of gold){const c=selectCandidates(catalog,g.context),actual=c.eligible.map(x=>x.product_id);
  results.strategy.push({...g,actual,pass:JSON.stringify(actual)===JSON.stringify(g.order)&&c.primary_product_id===g.primary});}
 results.catalog={products:catalog.products.size,usage:[...catalog.products.values()].reduce((n,p)=>n+p.usage.length,0),packages:[...catalog.products.values()].reduce((n,p)=>n+p.packages.length,0),
  open:[...catalog.products.values()].filter(p=>p.open).length,version:catalog.version,issues:catalog.issues};
 fs.writeFileSync('tests/results/staging-benchmark.json',JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({routes:results.routes,strategy_pass:results.strategy.filter(x=>x.pass).length,strategy_total:gold.length}));
 if(results.strategy.some(x=>!x.pass))process.exitCode=1;
})();
