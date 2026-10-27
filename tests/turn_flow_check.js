'use strict';

// v3.38 end-to-end check: the real server.js against mock LINE and Dify servers.
//  FB-02     two messages sent together -> one Dify run and one reply; a message sent while
//            the answer is being prepared waits and is answered next
//  FB-05/10  a photo and its caption reach Dify as one question with the photo attached
//  FB-09     a stream that breaks after Dify started still delivers the finished answer
//  FB-11     "ขอเบอทีมขาย" with no known province asks once, then answers from the team table
//  owner     the team reply says "พนักงานขายที่ดูแล จ.<province>" with no zone code or ME/MR; Ayutthaya names อ.เสนา/อ.ลาดบัวหลวง
//  FB-06     an answer without a recommendation gets the "ทีมขายในพื้นที่" quick reply
//  v3.43     the typing indicator is renewed while a slow answer is prepared and never renewed after the answer
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SECRET = 'turn-flow-secret';
const uid = (k) => 'U' + crypto.createHash('md5').update(k).digest('hex');
const USER = { join: uid('join'), busy: uid('busy'), photo: uid('photo'), team: uid('team'), cut: uid('cut'), norec: uid('norec'), ayut: uid('ayut') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = { replies: [], pushes: [], chats: [], uploads: 0, loading: [] };
const activeByUser = {};
let overlap = false;

function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
const sseLine = (o) => 'data: ' + JSON.stringify(o) + '\n\n';

function chat(p, res) {
  seen.chats.push(p);
  const u = p.user;
  activeByUser[u] = (activeByUser[u] || 0) + 1;
  if (activeByUser[u] > 1) overlap = true;
  const done = () => { activeByUser[u]--; };
  if (p.response_mode !== 'streaming') { done(); return json(res, 400, { message: 'expected streaming' }); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const cut = /CUT/.test(p.query);
  const ids = cut ? { conversation_id: 'conv-cut', message_id: 'msg-cut' } : { conversation_id: 'conv-' + u.slice(1, 7), message_id: 'msg-' + seen.chats.length };
  res.write(sseLine(Object.assign({ event: 'workflow_started' }, ids)));
  if (cut) {
    res.write(sseLine(Object.assign({ event: 'message', answer: 'คำตอบที่ Dify' }, ids)));
    return setTimeout(() => { done(); res.socket.destroy(); }, 50);
  }
  const answer = /NOREC/.test(p.query) ? 'ตอนนี้ยังไม่มีคำแนะนำสินค้าสำหรับโรคนี้ค่ะ' : 'รับคำถามแล้วค่ะ: ' + p.query.split('\n')[0];
  setTimeout(() => {
    res.write('event: ping\n\n');
    res.write(sseLine(Object.assign({ event: 'message', answer }, ids)));
    res.write(sseLine(Object.assign({ event: 'message_end' }, ids)));
    done();
    res.end();
  }, /SLOW/.test(p.query) ? 2500 : 100);
}

const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = req.url;
    const body = () => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return {}; } };
    if (url.startsWith('/v2/bot/message/reply')) { seen.replies.push(Object.assign(body(), { at: Date.now() })); return json(res, 200, {}); }
    if (url.startsWith('/v2/bot/message/push')) { seen.pushes.push(body()); return json(res, 200, {}); }
    if (url.startsWith('/v2/bot/chat/loading')) { seen.loading.push({ chatId: body().chatId, at: Date.now() }); return json(res, 202, {}); }
    if (url.startsWith('/v2/bot/profile/')) return json(res, 200, { displayName: 'ลูกค้าทดสอบ' });
    if (/^\/v2\/bot\/message\/[^/]+\/content/.test(url)) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9])); }
    if (url.startsWith('/v1/files/upload')) { seen.uploads++; return json(res, 201, { id: 'file-' + seen.uploads }); }
    if (url.startsWith('/v1/conversations')) return json(res, 200, { data: [] });
    if (url.startsWith('/v1/messages')) {
      const conv = new URL(url, 'http://x').searchParams.get('conversation_id');
      return json(res, 200, { data: conv === 'conv-cut' ? [{ id: 'msg-cut', answer: 'คำตอบที่ Dify ทำเสร็จแล้วค่ะ' }] : [] });
    }
    if (url.startsWith('/v1/chat-messages')) return chat(body(), res);
    json(res, 404, {});
  });
});

let seq = 0;
function post(port, userId, message) {
  seq++;
  const ev = { type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: 'ev' + seq, deliveryContext: { isRedelivery: false }, source: { type: 'user', userId }, replyToken: 'rt-' + seq, message: Object.assign({ id: 'm' + seq }, message) };
  const body = JSON.stringify({ destination: 'Ubot', events: [ev] });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/webhook', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-line-signature': sig, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode === 200 ? resolve(ev.replyToken) : reject(new Error('webhook HTTP ' + res.statusCode))));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function health(port) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } }); }).on('error', () => resolve(null));
  });
}
function freePort() {
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

const repliesFor = (token) => seen.replies.filter((r) => r.replyToken === token);
const textOf = (token) => repliesFor(token).map((r) => r.messages.map((m) => m.text || '').join('\n')).join('\n');
const chatsFor = (user) => seen.chats.filter((c) => c.user === user);

mock.listen(0, '127.0.0.1', async () => {
  const mockBase = 'http://127.0.0.1:' + mock.address().port;
  const port = await freePort();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-turn-'));
  const env = Object.assign({}, process.env, {
    PORT: String(port), LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'test-token', DIFY_API_KEY: 'test-key',
    LINE_API_BASE: mockBase, LINE_DATA_API_BASE: mockBase, DIFY_API_BASE: mockBase + '/v1',
    TEAM_SHEET_URL: mockBase + '/team-sheet', PRODUCT_SHEET_ID: 'offline-test', STATE_DIR: stateDir,
    REGISTER: 'off', LINE_LOADING_SECONDS: '5', LINE_LOADING_REFRESH_SEC: '1', LINE_TEXT_WAIT_SECONDS: '1', LINE_IMAGE_WAIT_SECONDS: '3', DIFY_RECOVER_SEC: '20',
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
    for (let i = 0; i < 50 && !h; i++) { await sleep(200); h = await health(port); }
    assert(h, 'server did not start');
    assert(/^3\.\d+(?:-v2)?$/.test(String(h.version)), 'health must report a 3.x version (V.2 trial builds end in -v2)');
    assert.strictEqual(h.difyMode, 'streaming');
    assert.strictEqual(h.textWaitSeconds, 1);
    assert.strictEqual(h.loadingRefreshSeconds, 1);

    const a1 = await post(port, USER.join, { type: 'text', text: 'หอมแดงเป็นโรคใบไหม้' });
    await sleep(300);
    const a2 = await post(port, USER.join, { type: 'text', text: 'ใช้ยาอะไรดีคะ' });
    const b1 = await post(port, USER.busy, { type: 'text', text: 'SLOW ข้าวโพดหนอนกินใบ' });
    const c1 = await post(port, USER.photo, { type: 'image', contentProvider: { type: 'line' } });
    await sleep(500);
    const c2 = await post(port, USER.photo, { type: 'text', text: 'ใบทุเรียนเป็นจุดแบบนี้คือโรคอะไร' });
    const d1 = await post(port, USER.team, { type: 'text', text: 'ขอเบอทีมขาย' });
    const g1 = await post(port, USER.ayut, { type: 'text', text: 'ขอเบอร์ทีมขายอยุธยาค่ะ' });
    const e1 = await post(port, USER.cut, { type: 'text', text: 'CUT อะบา ชื่อว่าอะไร' });
    const f1 = await post(port, USER.norec, { type: 'text', text: 'NOREC มันสำปะหลังใบไหม้แบคทีเรีย' });
    await sleep(1800); // the SLOW answer for b1 is still being prepared
    const b2 = await post(port, USER.busy, { type: 'text', text: 'แล้วใช้ช่วงไหนดี' });
    await sleep(300);
    assert(/จังหวัดไหน/.test(textOf(d1)), 'team request without a province should ask for it: ' + textOf(d1));
    const d2 = await post(port, USER.team, { type: 'text', text: 'ราชบุรีค่ะ' });

    const want = [a2, b1, b2, c2, d2, e1, f1, g1];
    for (let i = 0; i < 100 && want.some((t) => !repliesFor(t).length); i++) await sleep(200);

    // FB-02
    assert.deepStrictEqual(chatsFor(USER.join).map((c) => c.query), ['หอมแดงเป็นโรคใบไหม้\nใช้ยาอะไรดีคะ']);
    assert.strictEqual(repliesFor(a1).length, 0, 'first line got its own answer');
    assert.strictEqual(repliesFor(a2).length, 1);
    assert.deepStrictEqual(chatsFor(USER.busy).map((c) => c.query), ['SLOW ข้าวโพดหนอนกินใบ', 'แล้วใช้ช่วงไหนดี']);
    assert.strictEqual(repliesFor(b1).length + repliesFor(b2).length, 2);
    assert.strictEqual(overlap, false, 'one chat ran two Dify calls at once');
    // FB-05/FB-10
    const pc = chatsFor(USER.photo);
    assert.strictEqual(pc.length, 1, 'photo and caption should be one question');
    assert.deepStrictEqual(pc[0].files, [{ type: 'image', transfer_method: 'local_file', upload_file_id: 'file-1' }]);
    assert(pc[0].query.startsWith('ใบทุเรียนเป็นจุดแบบนี้คือโรคอะไร\n') && pc[0].query.includes('รูปภาพ 1 รูป'), pc[0].query);
    assert.strictEqual(repliesFor(c1).length, 0);
    assert.strictEqual(repliesFor(c2).length, 1);
    // FB-11 / FB-04
    assert.strictEqual(chatsFor(USER.team).length, 0, 'team request went to Dify');
    assert(textOf(d2).includes('พนักงานขายที่ดูแล จ.ราชบุรี') && textOf(d2).includes('063-205-9076'), textOf(d2));
    // owner decision (27 Oct 2026): customers see no zone code and no ME/MR
    const NO_CODES = /\bA\d\d\b|\bM[ER]\b/;
    assert(!NO_CODES.test(textOf(d2)), 'zone code or ME/MR shown to the customer: ' + textOf(d2));
    // Ayutthaya: the province team first, then the people for อ.เสนา/อ.ลาดบัวหลวง (the same people listed for ราชบุรี above)
    const ay = textOf(g1);
    const a04 = textOf(d2).split('\n').filter((l) => l.startsWith('• '));
    assert.strictEqual(chatsFor(USER.ayut).length, 0, 'team request went to Dify');
    assert(ay.startsWith('📍 พนักงานขายที่ดูแล จ.พระนครศรีอยุธยา\n') && !NO_CODES.test(ay), ay);
    const senaAt = ay.indexOf('ถ้าอยู่ อ.เสนา หรือ อ.ลาดบัวหลวง');
    assert(senaAt > 0 && a04.length > 0 && a04.every((l) => ay.indexOf(l) > senaAt), 'Ayutthaya reply should name อ.เสนา/อ.ลาดบัวหลวง and list their people: ' + ay);
    // FB-09
    assert.strictEqual(chatsFor(USER.cut).length, 1);
    assert(textOf(e1).includes('คำตอบที่ Dify ทำเสร็จแล้วค่ะ') && !textOf(e1).includes('ระบบขัดข้อง'), textOf(e1));
    // FB-06
    const last = repliesFor(f1)[0].messages.slice(-1)[0];
    assert(last.quickReply && last.quickReply.items.some((x) => x.action.label === '📞 ทีมขายในพื้นที่'), JSON.stringify(last));
    assert.strictEqual(seen.pushes.length, 0, 'every answer should use the reply token');
    // v3.43: typing indicator renewed during the slow answer, never after the last answer
    const tokensOf = { [USER.join]: [a1, a2], [USER.busy]: [b1, b2], [USER.photo]: [c1, c2], [USER.team]: [d1, d2], [USER.cut]: [e1], [USER.norec]: [f1], [USER.ayut]: [g1] };
    const replyTimes = (u) => seen.replies.filter((r) => tokensOf[u].includes(r.replyToken)).map((r) => r.at).sort((x, y) => x - y);
    const loadingTimes = (u) => seen.loading.filter((l) => l.chatId === u).map((l) => l.at);
    const firstBusy = replyTimes(USER.busy)[0];
    assert(loadingTimes(USER.busy).filter((t) => t < firstBusy).length >= 3, 'slow answer: typing should be renewed while waiting, got ' + loadingTimes(USER.busy).length + ' calls');
    await sleep(1600); // longer than one refresh interval
    for (const u of Object.values(USER)) {
      const last = replyTimes(u).slice(-1)[0];
      const late = loadingTimes(u).filter((t) => t > last);
      assert.strictEqual(late.length, 0, 'typing indicator renewed after the answer for ' + u.slice(0, 8));
    }
    assert(/\[loading\] U[0-9a-f]{7} typing kept \d+s \(\d+ refresh\)/.test(log), 'refresh log line');
  } catch (e) { failed = e; }
  app.kill();
  mock.close();
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
  if (failed) {
    console.error(failed);
    console.error('--- server log ---\n' + log.slice(-5000));
    process.exitCode = 1;
  } else {
    console.log('PASS: LINE turn flow (joined messages, one answer at a time, photo + caption, sales team, stream recovery, no-recommendation button, typing kept until the answer)');
  }
  setTimeout(() => process.exit(), 200);
});
