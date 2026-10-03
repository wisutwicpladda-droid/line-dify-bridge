'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {harness}=require('./helpers/bridge_harness');
const ownership=require('../conversation_ownership');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const ui=source.slice(source.indexOf('async function toggleBot()'),source.indexOf("document.getElementById('tglbtn').addEventListener"));
function request(h,method,url,data){
 let status,body;
 h.api.handleAdmin({method,url,headers:{'x-admin-key':'test-fixture-only'}},{writeHead:s=>status=s,end:b=>body=JSON.parse(b)},url,Buffer.from(JSON.stringify(data||{})));
 return {status,body};
}
function click(h,chat,summary,minutes=0){
 const sent=[],errors=[];let loads=0,prompts=0;
 const sandbox={sel:chat.id,findSel:()=>chat,askResumeSummary:async()=>{prompts++;return summary;},alert:e=>errors.push(e),load:()=>loads++,api:(url,opts)=>{
  const data=JSON.parse(opts.body);sent.push(data);const r=request(h,'POST',url,data);
  return r.status===200?Promise.resolve(r.body):Promise.reject(Error(r.body.error));
 }};
 vm.runInNewContext(ui,sandbox);const button={dataset:{m:String(minutes)},disabled:false};
 return {done:Promise.resolve(sandbox.toggleBot.call(button)),sent,errors,button,loads:()=>loads,prompts:()=>prompts};
}
test('actual admin button resumes human-owned chat with fresh version and summary, then next turn answers',async()=>{
 const h=harness();await h.api.refreshProductMaster();await h.api.handleEvent(h.event('สวัสดีค่ะ'));
 const s=h.api.sessions.get('staging-only-user');ownership.transition(s,'HUMAN_ACTIVE',{actor:'admin'});s.handoff=true;s.mutedUntil=8640000000000000;
 const before=h.sent.length;await h.api.handleEvent(h.event('นาแดน-จีขนาดอะไร'));assert.equal(h.sent.length,before);
 const chat=request(h,'GET','/admin/api/list').body.sessions[0];
 const summary='ลูกค้าถามขนาดนาแดน-จี ยังไม่ได้ระบุพืชหรือพื้นที่';
 const c=click(h,chat,summary);await c.done;
 assert.deepEqual(c.errors,[]);assert.equal(c.sent[0].version,chat.ownership.version);assert.equal(c.sent[0].summary,summary);
 assert.equal(s.ownership.state,'BOT_RESUME');assert.equal(s.ownership.summary,summary);assert.equal(s.mutedUntil,0);
 await h.api.handleEvent(h.event('นาแดน-จีขนาดอะไร'));
 assert.equal(s.ownership.state,'BOT_ACTIVE');assert.equal(s.ownership.summary,summary);
 assert.ok(h.sent.at(-1).some(m=>m.text?.includes('15')));assert.equal(c.button.disabled,false);
 assert.ok(h.logs.some(x=>x[0]==='[sales-delivery]'));
});
test('stale admin cannot resume after another owner transition; refresh is requested',async()=>{
 const h=harness();await h.api.handleEvent(h.event('สวัสดีค่ะ'));
 const s=h.api.sessions.get('staging-only-user');ownership.transition(s,'HUMAN_ACTIVE',{actor:'admin'});
 const old=request(h,'GET','/admin/api/list').body.sessions[0];ownership.transition(s,'HUMAN_ACTIVE',{actor:'admin'});
 const c=click(h,old,'ข้อมูลเดิม');await c.done;
 assert.deepEqual(c.errors,['ownership_conflict']);assert.equal(s.ownership.state,'HUMAN_ACTIVE');assert.equal(c.loads(),1);
});
test('cancel or blank resume summary leaves ownership unchanged and makes no request',async()=>{
 const h=harness();await h.api.handleEvent(h.event('สวัสดีค่ะ'));
 const s=h.api.sessions.get('staging-only-user');ownership.transition(s,'HUMAN_ACTIVE',{actor:'admin'});
 const chat=request(h,'GET','/admin/api/list').body.sessions[0];
 for(const summary of [null,'  ']){const c=click(h,chat,summary);await c.done;assert.equal(c.sent.length,0);assert.equal(s.ownership.state,'HUMAN_ACTIVE');}
});
test('mute API requires version and resume summary rather than bypassing ownership checks',async()=>{
 const h=harness();await h.api.handleEvent(h.event('สวัสดีค่ะ'));const s=h.api.sessions.get('staging-only-user');
 ownership.transition(s,'HUMAN_ACTIVE',{actor:'admin'});
 assert.equal(request(h,'POST','/admin/api/mute',{id:'staging-only-user',minutes:0}).body.error,'ownership_version_required');
 assert.equal(request(h,'POST','/admin/api/mute',{id:'staging-only-user',minutes:0,version:s.ownership.version}).body.error,'resume_summary_required');
 assert.equal(s.ownership.state,'HUMAN_ACTIVE');
});
test('legacy UI retains original payload and never asks for staging summary',async()=>{
 const calls=[];const sandbox={sel:'legacy',findSel:()=>({id:'legacy',ownership:null}),askResumeSummary:()=>{throw Error('legacy prompt');},alert:()=>{},load:()=>{},api:(p,o)=>{calls.push(JSON.parse(o.body));return Promise.resolve();}};
 vm.runInNewContext(ui,sandbox);await sandbox.toggleBot.call({dataset:{m:'0'}});
 assert.deepEqual(calls,[{id:'legacy',minutes:0}]);
});
