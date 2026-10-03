'use strict';
const vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createRequire}=require('node:module'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),localRequire=createRequire(path.join(root,'server.js'));
const fixture=require('../fixtures/company-snapshot.json');
// Execute the real handlers with all external transport and background jobs replaced.
function harness({answer,register='off'}={}) {
  const sent=[],calls=[],logs=[];let httpHandler;
  const network={request(options,callback){
    const req=new EventEmitter();let bytes='';
    req.write=b=>bytes+=b;req.setTimeout=()=>req;req.destroy=e=>req.emit('error',e);
    req.end=()=>queueMicrotask(()=>{
      const host=options.hostname||options.host;calls.push({host,path:options.path});
      let data={};const payload=bytes?JSON.parse(bytes):{};
      if(host==='api.line.me' && /message\/(reply|push)/.test(options.path))sent.push(payload.messages);
      else if(host==='api.line.me' && /profile/.test(options.path))data={displayName:'staging-test'};
      else if(host==='api.dify.ai' && /chat-messages/.test(options.path))data={answer:JSON.stringify(answer||localRequire('./sales/router').result('ยังต้องแยกสาเหตุค่ะ น้ำขังหรือเริ่มเป็นตรงไหนคะ','symptom'))};
      else throw Error('Network not permitted in test: '+host+options.path);
      const res=new EventEmitter();res.statusCode=200;res.headers={};callback(res);
      res.emit('data',Buffer.from(JSON.stringify(data)));res.emit('end');
    });return req;
  },get(){throw Error('Unexpected network GET');}};
  const kb={...localRequire('./kb_sync'),fetchSheets:async()=>fixture,start(){throw Error('Legacy KB sync must not run');}};
  const sandbox={Buffer,URL,console:{log:(...v)=>logs.push(v)},process:{env:{
    AI_SALES_PIPELINE:'on',AI_SALES_ENVIRONMENT:'staging',AI_SALES_DIFY_APP_ID:'ed28c981-1c94-4547-9003-aefa5e98aaf4',
    OWNERSHIP_V2:'on',REGISTER:register,PRODUCT_IMAGES:'on',PUBLIC_URL:'https://staging.invalid',
    LINE_CHANNEL_SECRET:'test-fixture-only',LINE_CHANNEL_ACCESS_TOKEN:'test-fixture-only',DIFY_API_KEY:'test-fixture-only'
  },on(){}},setTimeout:()=>({unref(){}}),setInterval:()=>({unref(){}}),clearTimeout(){},clearInterval(){},
    __dirname:root,module:{exports:{}},exports:{},queueMicrotask,
    require(id){if(id==='https')return network;if(id==='http')return {createServer(fn){httpHandler=fn;return {listen(){}};}};
      if(id==='./kb_sync')return kb;return localRequire(id);}
  };
  let code=fs.readFileSync(path.join(root,'server.js'),'utf8');
  code=code.slice(0,code.lastIndexOf('\ninitPersist();'));
  code+='\nmodule.exports={handleEvent,refreshProductMaster,sessions,salesCatalog,handleAdmin};';
  vm.runInNewContext(code,sandbox,{filename:'server.js'});
  const api=sandbox.module.exports;
  const event=(text,id='event-'+crypto.randomUUID())=>({type:'message',webhookEventId:id,replyToken:'test-reply',source:{type:'user',userId:'staging-only-user'},message:{type:'text',id, text}});
  return {api,sent,calls,logs,event,http:()=>httpHandler};
}

module.exports={harness};
