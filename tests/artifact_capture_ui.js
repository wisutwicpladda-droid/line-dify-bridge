'use strict';
// Local receiver for browser-visible QA evidence only. Never calls LINE or cloud APIs.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'results');
const files={rag:'rag-live-ui.json',team:'team-live-summary.json',proof:'dify-staging-proof.jpg'};
http.createServer((req,res)=>{
 if(req.method==='POST'){
  if(req.headers.origin!=='http://127.0.0.1:9200'){res.writeHead(403);return res.end();}
  let body='';req.on('data',c=>{body+=c;if(body.length>4000000)req.destroy();});req.on('end',()=>{
   try{const f=new URLSearchParams(body),kind=f.get('kind');if(!files[kind])throw Error('Unknown kind');
    const data=kind==='proof'?Buffer.from(f.get('data'),'base64'):JSON.stringify(JSON.parse(f.get('data')),null,2);
    fs.writeFileSync(path.join(root,files[kind]),data);res.writeHead(303,{Location:'/?saved='+kind});res.end();
   }catch(e){res.writeHead(400);res.end(e.message);}
  });return;
 }
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<h1>Local staging evidence capture</h1><form method="post"><label>Kind<select name="kind"><option>rag</option><option>team</option><option>proof</option></select></label><label>Evidence<textarea name="data"></textarea></label><button>Save evidence</button></form><p>'+ (req.url.includes('saved=')?'Saved':'Ready')+'</p>');
}).listen(9200,'127.0.0.1',()=>console.log('Evidence capture http://127.0.0.1:9200'));
