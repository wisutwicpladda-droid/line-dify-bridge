'use strict';

// v3.72: ตัวกันสแปมกับ server.js จริง (LINE และ Dify เป็น mock ในเครื่อง คำตอบ Dify ใช้ FAKE_DIFY_ANSWER จึงไม่เสียเงิน)
// เพดานต่ำผ่าน env: คำตอบ AI 2 ครั้งต่อชั่วโมง ส่งได้ 4 ข้อความต่อนาที เสียง 1 ครั้งต่อวัน
// ตรวจ: ครบเพดานได้ข้อความแจ้งพร้อมปุ่มทีมขายครั้งเดียวด้วย reply แล้วเงียบ · ปุ่มทีมขายยังตอบได้ · ถามซ้ำได้คำตอบเดิมโดยไม่เรียก AI
// ส่งรัวเกินถูกตัด · ข้อความเสียงเกินเพดานไม่ถอดเสียง · ข้อความยาวถูกตัด · กลุ่มไม่ตอบ · แอดมินไม่ถูกจำกัด
// /health มีแต่ตัวเลข · /admin/api/spam และหน้า 💰 มีรายละเอียด
const assert = require('assert');
const SOURCE_VERSION = (require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8').match(/version: '([\d.]+)'/) || [])[1];
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { NOTICES } = require('../spam_guard');

const SECRET = 'test-secret';
const ADMIN = 'test-admin';
const FAKE = 'คำตอบทดสอบ: แกนเตอร์ใช้กำจัดวัชพืชในนาข้าวช่วง 7-12 วันหลังหว่านค่ะ';
const LIMITED = 'U' + '1'.repeat(32);
const REPEATER = 'U' + '2'.repeat(32);
const FLOOD = 'U' + '3'.repeat(32);
const VOICER = 'U' + '4'.repeat(32);
const LONGER = 'U' + '5'.repeat(32);
const STAFF = 'U' + '6'.repeat(32);
const GROUP = 'C' + '7'.repeat(32);
const sent = []; // { kind: 'reply' | 'push', to, messages }

function mockLine() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        let j = {};
        try { j = JSON.parse(b || '{}'); } catch (_) {}
        if (req.url.includes('/message/reply')) sent.push({ kind: 'reply', to: j.replyToken, messages: j.messages || [] });
        else if (req.url.includes('/message/push')) sent.push({ kind: 'push', to: j.to, messages: j.messages || [] });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(req.url.includes('/profile/') ? JSON.stringify({ displayName: 'ลูกค้าทดสอบ' }) : '{}');
      });
    });
    srv.listen(0, () => resolve(srv));
  });
}

function startBridge(port, linePort, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-spam-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'x', ADMIN_KEY: ADMIN,
      LINE_API_BASE: 'http://127.0.0.1:' + linePort, STATE_DIR: dir, REGISTER: 'off', DIFY_API_KEY: '',
      FAKE_DIFY_ANSWER: FAKE, ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '',
      SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', POS_TABLE: '', SALES_LEAD_TARGETS: '', LEAD_LINE_TOKEN: '', IMAGE_WAIT_SECONDS: '0',
      LINE_TEXT_WAIT_SECONDS: '1', LINE_FRAGMENT_WAIT_SECONDS: '1', DIFY_API_BASE: 'http://127.0.0.1:' + linePort + '/v1', DIFY_RESPONSE_MODE: '', DIFY_DATASET_KEY: '',
      PRODUCT_SHEET_ID: 'offline-test', TEAM_SHEET_URL: 'http://127.0.0.1:' + linePort + '/team-sheet',
      SPAM_GUARD: '', SPAM_HOUR_MAX: '2', SPAM_BURST_MAX: '4', SPAM_VOICE_DAY_MAX: '1', SPAM_DAY_MAX: '', SPAM_TEXT_MAX: '',
      SPAM_REPEAT_MINUTES: '', SPAM_DAILY_BUDGET_THB: '', SPAM_GROUPS: '', SPAM_GROUP_ALLOW: '', SPAM_ALLOW: '',
      ADMIN_NOTIFY_IDS: STAFF, OPENAI_ALERT_TO: ''
    }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return { child, log: () => log };
}

function req(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ 'Content-Type': 'application/json' }, data ? { 'Content-Length': data.length } : {}, headers || {}) }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b), text: b }); } catch (_) { resolve({ status: res.statusCode, text: b }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let seq = 0;
const user = (id) => ({ type: 'user', userId: id });
async function post(port, source, message) {
  seq++;
  const body = JSON.stringify({ destination: 'x', events: [{ type: 'message', mode: 'active', timestamp: Date.now(), source, replyToken: 'rt' + seq, webhookEventId: 'ev' + seq, deliveryContext: { isRedelivery: false }, message: Object.assign({ id: 'm' + seq }, message) }] });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  const r = await req(port, 'POST', '/webhook', body, { 'x-line-signature': sig });
  assert.strictEqual(r.status, 200, 'webhook ' + r.status);
  return 'rt' + seq;
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const repliesTo = (token) => sent.filter((x) => x.kind === 'reply' && x.to === token);
async function say(port, source, message) {
  const token = await post(port, source, typeof message === 'string' ? { type: 'text', text: message } : message);
  for (let i = 0; i < 80 && !repliesTo(token).length; i++) await sleep(100);
  await sleep(200);
  return repliesTo(token);
}
async function silent(port, source, message) {
  const token = await post(port, source, typeof message === 'string' ? { type: 'text', text: message } : message);
  await sleep(2600);
  return repliesTo(token);
}
const texts = (out) => out.flatMap((x) => x.messages).map((m) => m.text || '').join('\n');
const quick = (out) => out.flatMap((x) => x.messages).flatMap((m) => (m.quickReply ? m.quickReply.items : [])).map((i) => i.action.text);
async function health(port) { return (await req(port, 'GET', '/health')).json; }
async function waitHealth(port) {
  for (let i = 0; i < 100; i++) {
    try { const h = await health(port); if (h && h.ok) return h; } catch (_) {}
    await sleep(150);
  }
  throw new Error('bridge did not start');
}

(async () => {
  const line = await mockLine();
  const port = 42000 + Math.floor(Math.random() * 2000);
  const b = startBridge(port, line.address().port, {});
  try {
    let h = await waitHealth(port);
    assert.strictEqual(h.version, SOURCE_VERSION);
    assert.strictEqual(h.spamGuard.on, true);
    assert.strictEqual(h.spamGuard.limits, undefined, '/health must not show the limits');

    // 1) two AI answers an hour: the third question gets one notice with the sales team button, the fourth gets nothing
    assert(texts(await say(port, user(LIMITED), 'ยาฆ่าหญ้าในนาข้าวใช้อะไรดีคะ')).includes(FAKE));
    assert(texts(await say(port, user(LIMITED), 'แล้วใช้ช่วงไหนดีคะ')).includes(FAKE));
    const notice = await say(port, user(LIMITED), 'ถ้าหญ้าขึ้นเยอะต้องทำยังไงคะ');
    assert(texts(notice).includes('ขอพักตอบอัตโนมัติถึงประมาณ'), 'third question must get the hour notice: ' + texts(notice));
    assert(!texts(notice).includes(FAKE), 'the notice is not an AI answer');
    assert.deepStrictEqual(quick(notice), ['ขอเบอร์ทีมขายในพื้นที่']);
    assert.strictEqual((await silent(port, user(LIMITED), 'ตอบหน่อยค่ะ')).length, 0, 'after the notice the chat gets no reply');
    const team = await say(port, user(LIMITED), 'ขอเบอร์ทีมขายในพื้นที่');
    assert(/จังหวัดไหน/.test(texts(team)), 'the sales team button still works without the AI: ' + texts(team));
    assert(!sent.some((x) => x.kind === 'push' && x.to === LIMITED), 'notices never use push');

    // 2) the same question again within 10 minutes: the last answer again, no AI turn
    assert(texts(await say(port, user(REPEATER), 'แกนเตอร์ใช้ในนาข้าวช่วงไหนดีคะ')).includes(FAKE));
    const turnsBefore = (await health(port)).quality.turns;
    const again = await say(port, user(REPEATER), 'แกนเตอร์ ใช้ในนาข้าว ช่วงไหนดีคะ ?');
    assert.strictEqual(texts(again), FAKE, 'repeat must resend the last answer');
    h = await health(port);
    assert.strictEqual(h.quality.turns, turnsBefore, 'a repeat must not run the AI');
    assert.strictEqual(h.spamGuard.today.repeats, 1);

    // 3) six messages at once with SPAM_BURST_MAX=4: four are answered together, two are dropped
    const floodTokens = [];
    for (let i = 1; i <= 6; i++) floodTokens.push(await post(port, user(FLOOD), { type: 'text', text: 'ข้อความรัวที่ ' + i }));
    for (let i = 0; i < 60 && !floodTokens.some((t) => repliesTo(t).length); i++) await sleep(100);
    await sleep(1500);
    const floodReplies = floodTokens.flatMap((t) => repliesTo(t));
    assert.strictEqual(floodReplies.length, 1, 'one answer for the burst: ' + JSON.stringify(floodReplies));
    assert.strictEqual(floodReplies[0].to, floodTokens[3], 'answered with the last message that passed');

    // 4) voice: the first is heard (no ElevenLabs key here, so the bridge says it cannot listen), the second gets the notice, the third nothing
    assert(/ฟังข้อความเสียงไม่ได้/.test(texts(await say(port, user(VOICER), { type: 'audio', duration: 2000 }))));
    const vn = await say(port, user(VOICER), { type: 'audio', duration: 2000 });
    assert.strictEqual(texts(vn), NOTICES.voice);
    assert.strictEqual((await silent(port, user(VOICER), { type: 'audio', duration: 2000 })).length, 0);
    assert(texts(await say(port, user(VOICER), 'พิมพ์มาแทนค่ะ ใช้แกนเตอร์ยังไง')).includes(FAKE), 'typing still works');

    // 5) a 1,500-character message is cut to 1,000 before the AI
    assert(texts(await say(port, user(LONGER), 'ช่วยดูหน่อยค่ะ ' + 'ก'.repeat(1500))).includes(FAKE));
    assert(/long message cut to 1000 characters/.test(b.log()), 'log must show the cut');

    // 6) group chats are not answered
    assert.strictEqual((await silent(port, { type: 'group', groupId: GROUP, userId: 'U' + '8'.repeat(32) }, 'สวัสดีค่ะ ใช้ยาอะไรดี')).length, 0);

    // 7) admins in ADMIN_NOTIFY_IDS are never limited
    for (const q of ['คำถามแอดมินข้อหนึ่งคะ', 'คำถามแอดมินข้อสองคะ', 'คำถามแอดมินข้อสามคะ']) assert(texts(await say(port, user(STAFF), q)).includes(FAKE), 'admin must not be limited');

    h = await health(port);
    const t = h.spamGuard.today;
    assert.deepStrictEqual([t.notices, t.hits.hour, t.hits.burst, t.hits.voice, t.repeats, t.truncated, t.groupDropped, t.limitedChats], [2, 2, 2, 2, 1, 1, 1, 3], JSON.stringify(t));
    assert(!JSON.stringify(h.spamGuard).includes(LIMITED.slice(1, 12)), '/health must not show chat ids');

    // 8) admin API and the cost page
    assert.strictEqual((await req(port, 'GET', '/admin/api/spam')).status, 401);
    const rep = (await req(port, 'GET', '/admin/api/spam', null, { 'x-admin-key': ADMIN })).json;
    assert.strictEqual(rep.limits.hour, 2);
    assert.strictEqual(rep.limits.groups, 'off');
    assert.strictEqual(rep.top[0].limited !== '', true, 'limited chats first');
    const lim = rep.top.find((x) => x.sid === LIMITED);
    assert.deepStrictEqual([lim.limited, lim.answersToday, lim.chat], ['hour', 2, true]);
    assert.strictEqual(rep.top.find((x) => x.sid === STAFF).allowed, true);
    assert.strictEqual(rep.top.find((x) => x.sid === REPEATER).answersToday, 1, 'the repeat did not count as an AI answer');
    const costPage = (await req(port, 'GET', '/admin/api/cost', null, { 'x-admin-key': ADMIN })).json;
    assert(costPage.spam && costPage.spam.top.length >= 5, 'the cost page gets the spam report');
    const html = await new Promise((ok) => http.get({ host: '127.0.0.1', port, path: '/admin' }, (r) => { let s = ''; r.on('data', (d) => { s += d; }); r.on('end', () => ok(s)); }));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    new Function(scripts); // the admin page must not have a syntax error
    assert(scripts.includes('function cvSpam') && scripts.includes('function cvSpamWarn'));
  } catch (e) {
    console.log(b.log().split('\n').filter((l) => /spam|turn|error|Error|voice/.test(l)).slice(-30).join('\n'));
    throw e;
  } finally { b.child.kill(); line.close(); }
  console.log('PASS: spam guard e2e (hour notice once then silence, sales team button still free, repeat without AI, burst cut, voice limit before speech-to-text, long text cut, groups off, admins unlimited, /health counts only, admin report)');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
