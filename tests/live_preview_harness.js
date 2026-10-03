'use strict';
// Local, UI-assisted Dify Preview QA. NO LINE transport, credentials, or production state.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {buildCatalog}=require('../sales/catalog'),{prepare}=require('../sales/pipeline'),{finalPayload}=require('../sales/contracts');
const catalog=buildCatalog(require('./fixtures/company-snapshot.json'),require('../product_images/index.json'));
const cases=[
 ['A-known-pest','ข้าว 10 วัน มีหญ้าข้าวนก ใช้อะไรดี'],
 ['B-known-disease','ข้าวตรวจยืนยันโรคไหม้แล้ว อายุ 30 วัน ใช้อะไรดี'],
 ['C-symptom','ทุเรียนใบเหลืองและเหี่ยว ช่วยดูหน่อย'],
 ['D-two-diseases','ข้าวใบมีจุด ไม่แน่ใจโรคไหม้หรือโรคใบจุดสีน้ำตาล'],
 ['E-nutrition-disease','มะม่วงใบเหลือง ไม่แน่ใจว่าขาดธาตุหรือโรคเชื้อรา'],
 ['F-chemical-injury','ข้าวใบไหม้หลังพ่นยาเมื่อวาน เป็นโรคไหม้ไหม'],
 ['G-water-root','ทุเรียนเหี่ยวหลังน้ำขัง รากเน่าหรือเชื้อราคะ'],
 ['H-stage-missing','ในนาข้าวมีหญ้าข้าวนก ควรใช้ตัวไหน'],
 ['I-flowering','ทุเรียนช่วงดอกบาน มีเพลี้ยไฟ ใช้อะไรดี'],
 ['J-harvest','อีก 7 วันจะเก็บเกี่ยวทุเรียน ฉีดกำจัดเพลี้ยไฟได้ไหม'],
 ['K-product','ไบเตอร์คือสารอะไร'],
 ['L-comparison','แกนเตอร์กับอนิลการ์ดต่างกันอย่างไร'],
 ['M-missing-active','สาร cyantraniliprole ใช้กับแมลงกลุ่มไหน'],
 ['N-regulatory','ไบเตอร์ขึ้นทะเบียนสำหรับข้าวโพดไหม'],
 ['O-external','ข้าวโพดมีเพลี้ยกระโดดท้องขาว ใช้ไพรซีนได้ไหม'],
 ['P-followup','เพิ่งเป็นหลังน้ำขัง 3 วัน รากดำและมีกลิ่นค่ะ']
].map(([id,query])=>({id,query}));
const root=path.join(__dirname,'results');fs.mkdirSync(root,{recursive:true});
const saved=path.join(root,'live-preview.json');let records=fs.existsSync(saved)?JSON.parse(fs.readFileSync(saved)):[];
const implementationHash=require('node:crypto').createHash('sha256').update(['router','candidates','pipeline','contracts'].map(n=>fs.readFileSync(path.join(__dirname,'../sales/'+n+'.js'),'utf8')).join('\n')).digest('hex');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const provider=new (require('../sales/external_evidence').EvidenceProvider)({enabled:true});
const preparedRuns=new Map();
async function work(c){const options={catalog,previous:c.id==='P-followup'?{crop:'ทุเรียน',intent:'symptom',diagnosis_uncertain:true}: {},ownership:{state:'BOT_ACTIVE'}};
 const first=prepare(c.query,options);if(c.id==='O-external'){const external=await provider.search(first.context);return prepare(c.query,{...options,evidence:external.evidence});}return first;}
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:9199');
 if(req.method==='POST'&&url.pathname==='/record'){
  if(req.headers.origin!=='http://127.0.0.1:9199'){res.writeHead(403);return res.end();}
  let body='';req.on('data',c=>{body+=c;if(body.length>200000)req.destroy();});req.on('end',async()=>{
   try{const f=new URLSearchParams(body),c=cases.find(c=>c.id===f.get('id'));if(!c)throw Error('case');
    const raw=f.get('raw'),w=preparedRuns.get(f.get('prepared_run'));
    if(!w||w.context.query!==c.query)throw Error('Prepared context expired; reopen case before capture');
    const final=finalPayload(raw,w);
    records.push({id:c.id,query:c.query,implementationHash,at:new Date().toISOString(),environment:'Dify Preview live; Bridge validation replay; LINE NOT SENT',raw,prepared:w.prepared,context:w.context,final,metrics:f.get('metrics')});
    fs.writeFileSync(saved,JSON.stringify(records,null,2));res.writeHead(303,{Location:'/?case='+encodeURIComponent(c.id)+'&saved=1'});res.end();
   }catch(e){res.writeHead(400);res.end(e.message);}
  });return;
 }
 const c=cases.find(c=>c.id===url.searchParams.get('case'))||cases[0];const w=await work(c);
 const preparedRun=require('node:crypto').randomUUID();preparedRuns.set(preparedRun,w);if(preparedRuns.size>100)preparedRuns.delete(preparedRuns.keys().next().value);
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="th"><meta charset="utf-8"><title>Ladda Local Staging QA</title><style>body{font:16px system-ui;max-width:1000px;margin:24px auto}textarea{width:100%;height:160px}nav{display:flex;flex-wrap:wrap;gap:12px}label{display:block;margin-top:12px}</style><h1>Local QA — no LINE messages</h1><nav>${cases.map(c=>`<a href="/?case=${c.id}">${c.id}</a>`).join('')}</nav><h2>${c.id}</h2><label>Query<textarea id="query">${escape(c.query)}</textarea></label><label>Prepared<textarea id="prepared">${escape(JSON.stringify(w.prepared))}</textarea></label><form method="post" action="/record"><input type="hidden" name="prepared_run" value="${preparedRun}"><input type="hidden" name="id" value="${c.id}"><label>Raw live Dify output<textarea name="raw" required></textarea></label><label>Live trace metrics<textarea name="metrics"></textarea></label><button>Save and validate</button></form><p>${url.searchParams.has('saved')?'SAVED':''} ${records.length} actual outputs recorded</p><pre>${escape(JSON.stringify(records.at(-1)?.final?.failures||[]))}</pre></html>`);
}).listen(9199,'127.0.0.1',()=>console.log('QA UI http://127.0.0.1:9199 (no production integrations)'));
