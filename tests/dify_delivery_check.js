'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { SCHEMA, decodeDifyAnswer, splitText, lineMessages, deliveryIsCurrent } = require('../dify_delivery');
const { productImageButtonPage } = require('../product_image_buttons');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
const packet = text => JSON.stringify({ schema: SCHEMA, text, images: [], buttons: [], handoff: false });
function harness() {
  const calls = [], session = { responseEpoch: 1, history: [] };
  const env = { sessions: new Map([['u', session]]), console: { log() {} }, process: { env: {} },
    decodeDifyAnswer, lineMessages, deliveryIsCurrent, lineMsgs: lineMessages, productImageButtonPage,
    DIFY_BASE: 'https://dify.invalid', DIFY_KEY: 'fixture', LINE_API: 'https://line.invalid', CH_TOKEN: 'fixture',
    findConversation: async () => 'existing', request: async (method, url, headers, body) => {
      calls.push({ url, body });
      return url.endsWith('/chat-messages') ? { status: 200, data: { answer: packet('  คำตอบ\nอัตรา 3–5 กก./ไร่\n'), conversation_id: 'native-1' } } : { status: 200 };
    }, pushHist: (s, role, text) => s.history.push({ role, text }), markDirty() {}, broadcast() {}, flagCallback() {},
    MUTE_MINUTES: 30, PUBLIC_URL: 'https://assets.invalid', PIMG_MODE:'image', PIMG_ON: true, PIMG: { A:'p001.png', B:'p002.png' }, pimgMsgs: new WeakSet() };
  const pieces = [
    source.slice(source.indexOf('const difyQueues'), source.indexOf('// ---------- LINE ----------')),
    source.slice(source.indexOf('function pimgBuild('), source.indexOf('function pimgTap(')),
    source.slice(source.indexOf('async function lineReply('), source.indexOf('// ---------- CRM-lite')),
    source.slice(source.indexOf('async function sendAnswer('), source.indexOf('// ---------- คีย์เวิร์ด'))
  ];
  vm.runInNewContext(pieces.join('\n') + '\napi = { askDify, linePush, sendAnswer, difyMessages };', env);
  return { env, calls, session, ...env.api };
}
(async () => {
  await test('plain/fixed answers and envelope text remain byte-for-byte exact', () => {
    const raw = '  "ชื่อสินค้า" **ตัวอย่าง** [cite: 1]\n3–5 กก./ไร่ 😊  ';
    assert.equal(decodeDifyAnswer(raw).text, raw);
    assert.equal(decodeDifyAnswer(packet(raw)).text, raw);
  });
  await test('invalid envelopes fail rather than leaking protocol', () => {
    for (const value of [{schema:'bad',text:'x'}, {schema:SCHEMA,text:'x',images:'bad',buttons:[],handoff:false}, {reply:'x'}]) assert.throws(()=>decodeDifyAnswer(JSON.stringify(value)));
  });
  await test('long Thai text and emoji survive all chunks and retain final buttons', () => {
    const raw = 'ก'.repeat(4899) + '🌱' + 'ข'.repeat(30000);
    const out = lineMessages({ type:'text', text:raw, quickReply:{items:[]} });
    assert.equal(out.map(m=>m.text).join(''),raw); assert.ok(out.length>5);
    assert.ok(out.every(m=>m.text.length<=4900));
    assert.ok(out.slice(0,-1).every(m=>!m.quickReply)); assert.ok(out.at(-1).quickReply);
    assert.ok(splitText(raw).every(t=>!/[\uD800-\uDBFF]$/.test(t)));
  });
  await test('raw query/files pass unchanged; native conversation ID is reused', async () => {
    const h=harness(), text='  แล้วโดรนล่ะ\nช่วง 10–30 วัน  ', files=[{type:'image',upload_file_id:'fixture'}];
    const r=await h.askDify('u',text,files); await h.askDify('u','เรื่องใหม่');
    assert.equal(h.calls[0].body.query,text); assert.equal(h.calls[0].body.inputs.line_channel,'v1');
    assert.equal(h.calls[0].body.files,files); assert.equal(h.calls[1].body.conversation_id,'native-1');
    assert.equal(r.text,'  คำตอบ\nอัตรา 3–5 กก./ไร่\n');
  });
  await test('Dify owns images/buttons; names in prose cause no extra selection', () => {
    const h=harness(); const out=h.difyMessages(h.session,{text:'กล่าวถึง A และ B',images:['B'],buttons:['A','B']});
    assert.equal(out.length,2); assert.ok(out[1].originalContentUrl.endsWith('/p002.png'));
    assert.deepEqual(Array.from(out[1].quickReply.items,m=>m.action.text),['ขอรูป A','ขอรูป B']);
  });
  await test('reply plus pushes deliver all messages in batches of five', async () => {
    const h=harness(), raw='ก'.repeat(60000); assert.ok(await h.sendAnswer(h.session,{replyToken:'r'},'u',raw,{epoch:1}));
    assert.equal(h.calls.flatMap(c=>c.body.messages).map(m=>m.text).join(''),raw);
    assert.ok(h.calls.every(c=>c.body.messages.length<=5)); assert.equal(h.calls.length,3);
  });
  await test('claim during generation suppresses the late answer', async () => {
    const h=harness(); let release;
    h.env.request=async()=>new Promise(resolve=>{release=()=>resolve({status:200,data:{answer:packet('old')}})});
    const job=h.askDify('u','question'); await new Promise(r=>setImmediate(r));
    h.session.responseEpoch++; h.session.handoff=true; release(); assert.equal(await job,null);
  });
  await test('claim then rapid release still suppresses stale output', () => {
    const s={responseEpoch:10,mutedUntil:0,handoff:false}; assert.equal(deliveryIsCurrent(s,8),false); assert.equal(deliveryIsCurrent(s,10),true);
  });
  await test('ownership change stops later LINE batches without resending previous batches', async () => {
    const h=harness(); h.env.request=async(method,url,headers,body)=>{h.calls.push({url,body});h.session.responseEpoch++;return {status:200}};
    assert.equal(await h.sendAnswer(h.session,{replyToken:'r'},'u','ก'.repeat(60000),{epoch:1}),false); assert.equal(h.calls.length,1); assert.equal(h.session.history.length,5);
  });
  await test('Dify handoff metadata activates human ownership after its reply', async () => {
    const h=harness(); await h.sendAnswer(h.session,{replyToken:'r'},'u','รับเรื่องค่ะ',{epoch:1,handoff:true});
    assert.equal(h.session.handoff,true); assert.equal(h.session.responseEpoch,2);
  });
  await test('legacy semantic guards are absent from runtime source', () => {
    for (const name of ['sheetContext.enrichQuery','guardRate(','guardCalc(','guardOrder(','guardPhones(','guardInternal(','compactResponse(','pimgPlan(','pimgAllCategoryNames(']) assert.ok(!source.includes(name),name);
  });
  console.log(JSON.stringify({passed,failed:0,network:false}));
})().catch(e=>{console.error(e);process.exitCode=1});
