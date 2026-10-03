'use strict';
// Operator-only localhost console. Credentials stay in RAM; exported evidence is redacted.
// LINE endpoint calls follow https://developers.line.biz/en/reference/messaging-api/#webhook-settings
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORIGIN='http://127.0.0.1:9200',STAGE='https://line-dify-bridge-staging-ladda-staging.up.railway.app';
const nonce=crypto.randomBytes(24).toString('hex');let secrets=null,originalEndpoint=null,verified=false,rows=[];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function redact(v){let s=JSON.stringify(v);if(secrets)for(const value of Object.values(secrets))if(value)s=s.replaceAll(value,'[REDACTED]');return JSON.parse(s.replace(/U[0-9a-f]{32}/g,'[LINE_USER]'));}
function record(action,result){rows.push({at:new Date().toISOString(),action,result:redact(result)});fs.writeFileSync(path.join(__dirname,'results/staging-network-console.json'),JSON.stringify(rows,null,2));}
async function request(base,p,method='GET',data,headers={}){const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(45000)});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=text}return {status:r.status,body};}
const line=(p,m,d)=>request('https://api.line.me',p,m,d,{Authorization:'Bearer '+secrets.line});
const admin=(p,m,d)=>request(STAGE,p,m,d,{'X-Admin-Key':secrets.admin});
async function verify(){
 const bot=await line('/v2/bot/info'),dify=await request('https://api.dify.ai','/v1/info','GET',undefined,{Authorization:'Bearer '+secrets.dify});
 const health=await admin('/admin/api/sales/health'),publicHealth=await request(STAGE,'/'),profile=await line('/v2/bot/profile/'+secrets.tester);
 verified=bot.status===200&&bot.body.basicId==='@671seycr'&&dify.status===200&&dify.body.name==='น้องลัดดา AI Sales STAGING 20261003'&&health.status===200&&health.body.environment==='staging'&&health.body.dify_app==='ed28c981-1c94-4547-9003-aefa5e98aaf4'&&publicHealth.body.persist===true&&publicHealth.body.supabase===false&&publicHealth.body.pos===false&&profile.body.displayName?.toLowerCase()==='aww';
 const endpoint=await line('/v2/bot/channel/webhook/endpoint');if(!originalEndpoint&&endpoint.status===200)originalEndpoint=endpoint.body.endpoint;
 return {verified,bot:{status:bot.status,basicId:bot.body.basicId,displayName:bot.body.displayName},dify:{status:dify.status,name:dify.body.name},health,publicHealth,profile:{status:profile.status,name:profile.body.displayName},endpoint};
}
async function act(action,f){
 if(action==='connect'){secrets={line:f.get('line'),dify:f.get('dify'),admin:f.get('admin'),tester:f.get('tester')};if(!Object.values(secrets).every(Boolean)||!/^U[0-9a-f]{32}$/.test(secrets.tester))throw Error('Credentials/tester missing');return verify();}
 if(!secrets||!verified)throw Error('Verified staging identity required');
 if(action==='verify')return verify();
 if(action==='test-webhook')return line('/v2/bot/channel/webhook/test','POST',{endpoint:STAGE+'/webhook'});
 if(action==='use-staging'){
  await verify();if(!verified)throw Error('Identity changed');
  const test=await line('/v2/bot/channel/webhook/test','POST',{endpoint:STAGE+'/webhook'});if(test.body.success!==true)throw Error('Staging webhook test failed');
  const set=await line('/v2/bot/channel/webhook/endpoint','PUT',{endpoint:STAGE+'/webhook'});return {originalEndpoint,set,current:await line('/v2/bot/channel/webhook/endpoint')};
 }
 if(action==='restore-webhook'){
  if(!originalEndpoint||!originalEndpoint.startsWith('https://line-dify-bridge-production.up.railway.app/'))throw Error('No verified baseline endpoint');
  return {set:await line('/v2/bot/channel/webhook/endpoint','PUT',{endpoint:originalEndpoint}),current:await line('/v2/bot/channel/webhook/endpoint')};
 }
 if(action==='traces')return {scope:'Real inbound webhook traces only; zero synthetic events injected',traces:await admin('/admin/api/sales/traces'),copilot:await admin('/admin/api/sales/copilot?id='+encodeURIComponent(secrets.tester))};
 throw Error('Unknown action');
}
const page=()=>`<!doctype html><meta charset="utf-8"><title>Ladda Staging Network Console</title><style>body{font:16px/1.5 system-ui;max-width:1000px;margin:30px auto}label{display:block}input{width:90%;margin:6px;padding:6px}button{margin:8px;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eff5f1;padding:15px}</style><h1>LINE staging — AWW only</h1><p>Fixed target: ${STAGE}. Credentials in RAM only. No production Bridge/KB changes. Actual LINE samples are never fabricated.</p>${!secrets?`<form method="post"><input type="hidden" name="csrf" value="${nonce}"><input type="hidden" name="action" value="connect">${['line','dify','admin','tester'].map(x=>`<label>${x}<input type="password" name="${x}" autocomplete="off" required></label>`).join('')}<button>Verify identities</button></form>`:''}<form method="post"><input type="hidden" name="csrf" value="${nonce}">${['verify','test-webhook','use-staging','restore-webhook','traces'].map(x=>`<button name="action" value="${x}">${x}</button>`).join('')}</form><p>Verified: ${verified}; original endpoint: ${esc(originalEndpoint||'not read')}</p><pre>${esc(JSON.stringify(rows.at(-1)||{},null,2))}</pre>`;
http.createServer((req,res)=>{
 if(req.headers.host!=='127.0.0.1:9200'){res.writeHead(403);return res.end();}
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(req.method==='POST'){
  if(req.headers.origin!==ORIGIN){res.writeHead(403);return res.end();}let body='';req.on('data',c=>{body+=c;if(body.length>12000)req.destroy()});
  req.on('end',async()=>{const f=new URLSearchParams(body);body='';if(f.get('csrf')!==nonce){res.writeHead(403);return res.end();}try{const action=f.get('action'),r=await act(action,f);record(action,r);}catch(e){record(f.get('action'),{error:e.message});}res.writeHead(303,{Location:'/'});res.end();});return;
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page());
}).listen(9200,'127.0.0.1',()=>console.log('Staging operator UI http://127.0.0.1:9200; secrets RAM-only'));
