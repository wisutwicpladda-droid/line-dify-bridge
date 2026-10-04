'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MORE_IMAGES_TEXT, productImageButtonPage } = require('../product_image_buttons');
const { lineMessages } = require('../dify_delivery');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const catalog = require('../product_images/index.json');
const unique = [...new Map(Object.entries(catalog).map(([n,f])=>[f,n])).values()];
function runtime(options={}) {
 const env={PIMG:catalog,PIMG_ON:true,PUBLIC_URL:'https://assets.invalid',PIMG_MODE:'image',PIMG_BG:'#00000000',console:{log(){}},MORE_IMAGES_TEXT,productImageButtonPage,...options};
 vm.runInNewContext(source.slice(source.indexOf('const pimgMsgs ='),source.indexOf('function servePimg('))+'\napi={pimgBuild,pimgAttachButtons,pimgTap,difyMessages}',env);return env.api;
}
let passed=0;function test(n,f){f();passed++;console.log('PASS '+n)}
const r=runtime();
const packet=(names,images=[])=>({text:'คำตอบจาก Dify',buttons:names,images});
function items(msgs){return msgs.at(-1).quickReply.items}
test('all recommendations have buttons regardless of previous/current images',()=>{
 const s={pimgSent:{[catalog['คาริสมา']]:Date.now()}};
 const out=r.difyMessages(s,packet(['คาริสมา','มาบลิค'],['คาริสมา']));
 assert.deepEqual(Array.from(items(out),m=>m.action.text),['ขอรูป คาริสมา','ขอรูป มาบลิค']);
 assert.equal(out[1].originalContentUrl,'https://assets.invalid/img/p/p007.png');
});
test('13 buttons fit; 14 reserve one pagination slot',()=>{
 assert.equal(productImageButtonPage(unique.slice(0,13)).items.length,13);
 const m=productImageButtonPage(unique.slice(0,14));assert.equal(m.pages,2);assert.equal(m.items[12].action.text,MORE_IMAGES_TEXT);
});
test('every mapped asset is reachable through pagination',()=>{
 const s={};let msgs=r.difyMessages(s,packet(unique)),found=[];
 for(let i=0;i<Math.ceil(unique.length/12);i++){
 assert.equal(s.pimgMenu.page,i);assert.ok(items(msgs).length<=13);
 found.push(...Array.from(items(msgs),m=>m.action.text).filter(t=>t!==MORE_IMAGES_TEXT));msgs=r.pimgTap(s,MORE_IMAGES_TEXT);
 }
 assert.deepEqual(found,unique.map(n=>'ขอรูป '+n));assert.equal(s.pimgMenu.page,0);
});
test('explicit product taps return to Dify for fresh status; only pagination is local',()=>{
 assert.equal(r.pimgTap({},'ขอรูป คาริสมา'),null);assert.equal(r.pimgTap({},'ขอรูป ไม่มีสินค้า'),null);
});
test('all catalog references resolve to existing exact files',()=>{
 for(const [name,file]of Object.entries(catalog)){
 assert.ok(fs.existsSync(path.join(__dirname,'../product_images',file)));
 assert.equal(r.pimgBuild([name])[0].originalContentUrl,'https://assets.invalid/img/p/'+file);
 }
 assert.equal(r.pimgBuild(Object.keys(catalog)).length,unique.length);
});
test('flex rendering uses explicit references with at most 10 bubbles',()=>{
 const flex=runtime({PIMG_MODE:'flex'}).pimgBuild(unique);
 assert.equal(flex.length,Math.ceil(unique.length/10));
 assert.ok(flex.every(m=>m.type==='flex'&&(m.contents.type==='bubble'||m.contents.contents.length<=10)));
});
test('empty metadata clears stale menus; disabled assets remain disabled',()=>{
 const s={};r.difyMessages(s,packet(['คาริสมา']));r.difyMessages(s,packet([]));assert.equal(s.pimgMenu,undefined);
 for(const options of [{PIMG_ON:false},{PUBLIC_URL:''}]){
 const x=runtime(options).difyMessages({},packet(['คาริสมา'],['คาริสมา']));assert.equal(x.length,1);assert.equal(typeof x[0],'string');
 }
});
test('long text retains all characters and quick replies on its last chunk',()=>{
 const text='ก'.repeat(15000);const msgs=r.difyMessages({}, {...packet(['คาริสมา']),text});const chunks=lineMessages(msgs);
 assert.equal(chunks.map(m=>m.text).join(''),text);assert.ok(chunks.at(-1).quickReply);assert.ok(chunks.slice(0,-1).every(m=>!m.quickReply));
});
test('missing assets cannot invent URLs or silently hide Dify-requested buttons',()=>{
 const failed=r.pimgBuild(['ไม่มีไฟล์รูป']);assert.equal(failed[0].type,'text');assert.ok(failed[0].text.includes('ไม่มีไฟล์รูป'));assert.ok(!failed[0].originalContentUrl);
 const out=r.difyMessages({},packet(['ไม่มีไฟล์รูป','คาริสมา']));assert.equal(items(out).length,2);
});
console.log(JSON.stringify({passed,catalogNames:Object.keys(catalog).length,uniqueImageFiles:unique.length,network:false}));
