'use strict';

// v3.70 end-to-end (Feedback น้องลัดดา 2-3 พ.ย. 2569): server.js จริงกับ LINE และ Dify จำลอง
//  ข้อ 1-3   คำตอบยาวกว่า 600 ตัวอักษร: LINE ได้ข้อความเต็ม และประวัติแชทหน้าแอดมินเก็บข้อความเต็มเท่ากับที่ส่ง
//  ข้อ 20    "ราเซอร์ใช้กับแตงโมได้ไหม" ตอบว่าไม่แนะนำ -> ไม่ส่งรูปราเซอร์และไม่มีปุ่ม · ถามข้าวโพด (แนะนำพร้อมอัตรา) -> ยังส่งรูป
//  ข้อ 18,23 ป้ายปุ่มดูรูปไม่เกิน 20 ตัวอักษรและไม่ตัดกลางคำ ข้อความที่ส่งเมื่อกดยังเป็นชื่อเต็ม
//  ข้อ 15    เบอร์พนักงานขายในคำตอบของ Dify เป็นแบบเดียวกับเมนูทีมขาย
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SECRET = 'fb370-secret';
const KEY = 'fb370-admin-key';
const uid = (k) => 'U' + crypto.createHash('md5').update('fb370-' + k).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = { replies: [] };

// คำตอบจริงของ Feedback ข้อ 1 (log ของ Dify ระบบจริง 2 พ.ย. 16:48) ยาว 800 กว่าตัวอักษร หน้าแอดมินแสดงแค่ถึง "ทั้งนี้ อัตราสำหรับการพ่นด้วยโดรนให"
const LONG = 'หลังน้ำท่วมขัง ควรเร่งระบายน้ำออกจากแปลงเพื่อป้องกันโรครากเน่าโคนเน่าและไฟท๊อปเทอร่าเข้าทำลายต้นทุเรียนค่ะ น้องลัดดาแนะนำสินค้าตามลำดับดังนี้ค่ะ\n\n' +
  '"คาริสมา": พ่นทางใบ ดอก หรือราดดิน อัตรา 200-300 ซีซี ต่อน้ำ 200 ลิตร ต่อไร่ (ฉีดผ่าดอกได้)\n' +
  '"มาบลิค": ฉีดพ่นทางใบป้องกันเชื้อเข้ายอดอ่อน อัตรา 500 ซีซี ต่อน้ำ 200 ลิตร ต่อไร่ (หรือราดโคน 500-1,000 มล. ต่อน้ำ 200 ลิตร; หลีกเลี่ยงช่วงดอกหัวกำไลถึงผลระยะไข่ไก่)\n' +
  '"โทมาฮอค": ฉีดพ่นทางใบ ดอก ต้น หรือผล อัตรา 100-200 กรัม ต่อน้ำ 200 ลิตร ต่อไร่\n' +
  '"วอร์แรนต์": ฉีดพ่นทรงพุ่ม อัตรา 200-300 กรัม ต่อน้ำ 200 ลิตร ต่อไร่\n' +
  'ทั้งนี้ อัตราสำหรับการพ่นด้วยโดรนให้สอบถามพนักงานขายค่ะ ไม่ทราบว่าตอนนี้ระดับน้ำแห้งสนิทหรือยังคะ';
const ANSWERS = [
  [/^LONG/, LONG],
  [/แตงโม/, 'ไม่แนะนำให้ใช้ "ราเซอร์" กับแตงโมค่ะ เนื่องจากเป็นยาคุมกำจัดวัชพืชที่เหมาะกับพืชไร่ เช่น ข้าวโพด อ้อย และมันสำปะหลัง แตงโมเป็นพืชตระกูลแตงที่ไวต่อสารกำจัดวัชพืชมาก อาจเกิดความเป็นพิษต่อพืชได้ค่ะ'],
  [/ข้าวโพด/, '"ราเซอร์" ใช้กับข้าวโพดได้ค่ะ ฉีดพ่นหลังปลูก 0-3 วัน อัตรา 800 ซีซี ต่อน้ำ 100 ลิตร ต่อไร่'],
  [/มันสำปะหลัง/, 'สำหรับคุมฆ่าหญ้าในไร่มันสำปะหลังระยะแรก น้องลัดดาแนะนำดังนี้ค่ะ\n\n"ไดยูแมกซ์ 80 ดับเบิ้ลยู.พี." คุมฆ่าหญ้าใบแคบและใบกว้าง อัตรา 500 กรัม ต่อน้ำ 100 ลิตร ต่อไร่\n"ไดพิม 90 ดับเบิลยูจี" อัตรา 450 กรัม ต่อน้ำ 100 ลิตร ต่อไร่\n"บอมส์ ไรซ์ บูสเตอร์" ใช้บำรุงหลังพ่นยา อัตรา 50 ซีซี ต่อน้ำ 20 ลิตร\n\nไม่ทราบว่าแปลงปลูกได้กี่วันแล้วคะ'],
  [/^FAILED/, '"อัพดาว" เป็นสารไม่เลือกทำลายที่ใช้ล้างแปลงก่อนทำนาหรือหัวคันนาเท่านั้นค่ะ สำหรับแห้วหมูในนาข้าว แนะนำเปลี่ยนมาใช้ "ซิมเมอร์" อัตรา 330 ซีซี ต่อ 1 ไร่ พ่นหลังหว่านหรือปักดำ 15 วันค่ะ\n[[no_img:อัพดาว]]'],
  [/^PHONE/, 'สามารถหาซื้อได้ผ่านร้านค้าตัวแทนจำหน่ายในพื้นที่ค่ะ ติดต่อพนักงานขายที่ดูแล จ.สุราษฎร์ธานี ได้แก่ คุณวิลาสินี ขวัญเมือง (เมย์) โทร 063-2059079 ได้เลยค่ะ']
];
const sseLine = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
let n = 0;
function chat(p, res) {
  const q = String(p.query || '').split('\n')[0];
  const hit = ANSWERS.find(([rx]) => rx.test(q));
  const answer = hit ? hit[1] : 'รับคำถามแล้วค่ะ';
  const ids = { conversation_id: 'c-' + String(p.user).slice(1, 7), message_id: 'm-' + (++n), task_id: 't-' + n };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(sseLine(Object.assign({ event: 'workflow_started' }, ids)));
  setTimeout(() => { res.write(sseLine(Object.assign({ event: 'message', answer }, ids))); res.write(sseLine(Object.assign({ event: 'message_end' }, ids))); res.end(); }, 80);
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = req.url;
    const body = () => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return {}; } };
    if (url.startsWith('/v2/bot/message/reply')) { seen.replies.push(body()); return json(res, 200, {}); }
    if (url.startsWith('/v2/bot/message/push')) return json(res, 200, {});
    if (url.startsWith('/v2/bot/chat/loading')) return json(res, 202, {});
    if (url.startsWith('/v2/bot/profile/')) return json(res, 200, { displayName: 'ทดสอบ' });
    if (url.startsWith('/v1/conversations')) return json(res, 200, { data: [] });
    if (url.startsWith('/v1/messages')) return json(res, 200, { data: [] });
    if (url.startsWith('/v1/chat-messages')) return chat(body(), res);
    json(res, 404, {});
  });
});
let seq = 0;
function post(port, userId, text) {
  seq++;
  const ev = { type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: 'ev' + seq, deliveryContext: { isRedelivery: false }, source: { type: 'user', userId }, replyToken: 'rt-' + seq, message: { id: 'm' + seq, type: 'text', text } };
  const body = JSON.stringify({ destination: 'Ubot', events: [ev] });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/webhook', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-line-signature': sig, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      res.resume(); res.on('end', () => (res.statusCode === 200 ? resolve(ev.replyToken) : reject(new Error('webhook HTTP ' + res.statusCode))));
    });
    req.on('error', reject); req.end(body);
  });
}
function getJson(port, p, key) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { 'x-admin-key': key || '' } }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(c).toString('utf8')); } catch (_) {} resolve(j); }); }).on('error', () => resolve(null));
  });
}
function freePort() { return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
const msgsOf = (token) => seen.replies.filter((r) => r.replyToken === token).flatMap((r) => r.messages || []);
const textOf = (token) => msgsOf(token).map((m) => m.text || '').join('\n');
const labelsOf = (token) => msgsOf(token).flatMap((m) => (m.quickReply ? m.quickReply.items : [])).map((x) => x.action);

mock.listen(0, '127.0.0.1', async () => {
  const mockBase = 'http://127.0.0.1:' + mock.address().port;
  const port = await freePort();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-fb370-'));
  const env = Object.assign({}, process.env, {
    PORT: String(port), LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'test-token', DIFY_API_KEY: 'test-key', ADMIN_KEY: KEY,
    LINE_API_BASE: mockBase, LINE_DATA_API_BASE: mockBase, DIFY_API_BASE: mockBase + '/v1', PUBLIC_URL: 'https://bridge.test',
    TEAM_SHEET_URL: mockBase + '/team-sheet', PRODUCT_SHEET_ID: 'offline-test', STATE_DIR: stateDir, REGISTER: 'off',
    LINE_LOADING_SECONDS: '5', LINE_TEXT_WAIT_SECONDS: '1', LINE_FRAGMENT_WAIT_SECONDS: '1', LINE_IMAGE_WAIT_SECONDS: '3',
    DIFY_RESPONSE_MODE: '', FAKE_DIFY_ANSWER: '', LINE_JOIN_MESSAGES: '', SUPABASE_URL: '', SUPABASE_KEY: '', SUPABASE_SERVICE_KEY: '',
    DIFY_DATASET_KEY: '', LIFF_ID: '', ADMIN_NOTIFY_IDS: '', SALES_LEAD_TARGETS: '', LEAD_LINE_TOKEN: '', RAILWAY_VOLUME_MOUNT_PATH: ''
  });
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  app.stdout.on('data', (d) => { log += d; });
  app.stderr.on('data', (d) => { log += d; });
  let failed = null;
  try {
    let h = null;
    for (let i = 0; i < 50 && !h; i++) { await sleep(200); h = await getJson(port, '/'); }
    assert(h, 'server did not start');
    const U = { long: uid('long'), neg: uid('neg'), pos: uid('pos'), btn: uid('btn'), phone: uid('phone'), failed: uid('failed') };
    const t = {
      long: await post(port, U.long, 'LONG ทุเรียนโดนน้ำท่วม 1 อาทิตย์ ใช้ยาตัวไหนช่วยได้'),
      neg: await post(port, U.neg, 'ราเซอร์ใช้กับแตงโมได้ไหม'),
      pos: await post(port, U.pos, 'ราเซอร์ใช้กับข้าวโพดได้ไหม'),
      btn: await post(port, U.btn, 'ยาคุมฆ่าหญ้าในไร่มันสำปะหลัง ระยะแรก'),
      phone: await post(port, U.phone, 'PHONE ซื้อได้ที่ไหน'),
      failed: await post(port, U.failed, 'FAILED แห้วหมูในนาข้าว ใช้อัพดาวแล้วไม่ตาย ใช้อะไรดี')
    };
    for (let i = 0; i < 80 && Object.values(t).some((x) => !msgsOf(x).length); i++) await sleep(200);

    // ข้อ 1-3
    const sent = textOf(t.long);
    assert(sent.length > 600 && sent.endsWith('ไม่ทราบว่าตอนนี้ระดับน้ำแห้งสนิทหรือยังคะ'), 'LINE should get the full answer: ' + sent.length);
    const hist = await getJson(port, '/admin/api/history?id=' + U.long, KEY);
    const b = ((hist && hist.history) || []).filter((x) => x.r === 'b').map((x) => x.t);
    assert(b.includes(sent), 'admin history should keep the full answer (got ' + b.map((x) => x.length).join(',') + ' chars, sent ' + sent.length + ')');

    // ข้อ 20
    const negMsgs = msgsOf(t.neg);
    assert(!negMsgs.some((m) => m.type === 'image'), 'no product image for a product the answer does not recommend: ' + JSON.stringify(negMsgs));
    assert(!labelsOf(t.neg).some((a) => /ราเซอร์/.test(a.label + a.text)), 'no image button for it either: ' + JSON.stringify(labelsOf(t.neg)));
    assert(/\[pimg\] skip not recommended: ราเซอร์/.test(log), 'log should say why the image was skipped');
    const posMsgs = msgsOf(t.pos);
    assert(posMsgs.some((m) => m.type === 'image' && /p038\.png$/.test(m.originalContentUrl)), 'a recommended named product still gets its image: ' + JSON.stringify(posMsgs));

    // ข้อ 18, 23
    const acts = labelsOf(t.btn);
    assert(acts.length >= 3, 'three image buttons expected: ' + JSON.stringify(acts));
    for (const a of acts) assert(a.label.length <= 20, 'label longer than 20: ' + a.label);
    const byText = Object.fromEntries(acts.map((a) => [a.text, a.label]));
    assert.strictEqual(byText['ขอรูป ไดยูแมกซ์ 80 ดับเบิ้ลยู.พี.'], '📷 ไดยูแมกซ์ 80 WP');
    assert.strictEqual(byText['ขอรูป ไดพิม 90 ดับเบิลยูจี'], '📷 ไดพิม 90 WG');
    assert.strictEqual(byText['ขอรูป บอมส์ ไรซ์ บูสเตอร์'], 'บอมส์ ไรซ์ บูสเตอร์');

    // v3.76: ลูกค้าบอกว่าอัพดาวไม่ได้ผล (Dify ส่ง [[no_img:อัพดาว]]) -> ไม่มีรูปหรือปุ่มอัพดาว แม้ลูกค้าพิมพ์ชื่อมาเอง และเครื่องหมายไม่ถึงลูกค้า
    const fMsgs = msgsOf(t.failed);
    assert(!/no_img|\[\[/.test(textOf(t.failed)), 'the tag must not reach the customer: ' + textOf(t.failed));
    assert(textOf(t.failed).includes('15 วันค่ะ'), 'answer text intact: ' + textOf(t.failed));
    const upFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'product_images', 'index.json'), 'utf8'))['อัพดาว'];
    assert(upFile && !fMsgs.some((m) => m.type === 'image' && m.originalContentUrl.endsWith('/' + upFile)), 'no image of the failed product: ' + JSON.stringify(fMsgs));
    assert(!labelsOf(t.failed).some((a) => /อัพดาว/.test(a.label + a.text)), 'no button for it: ' + JSON.stringify(labelsOf(t.failed)));
    assert(/no image \(customer says it did not work\): อัพดาว/.test(log), 'log should name the skipped product');

    // ข้อ 15
    assert(textOf(t.phone).includes('โทร 063-205-9079') && !textOf(t.phone).includes('063-2059079'), 'phone format: ' + textOf(t.phone));
  } catch (e) { failed = e; }
  app.kill();
  mock.close();
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
  if (failed) {
    console.error(failed);
    console.error('--- server log ---\n' + log.slice(-4000));
    process.exitCode = 1;
  } else {
    console.log('PASS: v3.70 feedback fixes end to end (full answer in admin history, no image for a product the answer advises against, short button labels, team phone format)');
  }
  setTimeout(() => process.exit(), 200);
});

