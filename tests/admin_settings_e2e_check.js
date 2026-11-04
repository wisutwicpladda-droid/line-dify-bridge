'use strict';

// v3.73: หน้า 🛡️ กันสแปม แท็ก และ blacklist กับ server.js จริง (LINE และ Dify เป็น mock ในเครื่อง คำตอบ Dify ใช้ FAKE_DIFY_ANSWER)
// ตรวจ: ค่าที่บันทึกในหน้าแอดมินใช้ทันที (เพดานชั่วโมง งบ) · ส่งข้อความทดสอบถึงผู้รับแจ้งเตือนที่เลือก + ADMIN_NOTIFY_IDS
// blacklist: บอทไม่ตอบ ไม่เก็บข้อความ นับครั้งที่ส่งมา เอาออกแล้วตอบได้ตามเดิม · แท็กจากหัวแชท + กรองรายการตามแท็ก
// กลุ่ม: เปิด/ปิดได้จากหน้าแอดมิน · ค่าตั้ง blacklist และผู้รับแจ้งเตือนอยู่ต่อหลังรีสตาร์ต · คืนค่าเริ่มต้น · หน้าแอดมินไม่มี syntax error
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
const FAKE = 'คำตอบทดสอบ: แกนเตอร์ใช้กำจัดวัชพืชในนาข้าวค่ะ';
const ADMIN_UID = 'U' + '9'.repeat(32);
const C1 = 'U' + '1'.repeat(32);
const C2 = 'U' + '2'.repeat(32);
const C4 = 'U' + '4'.repeat(32);
const C5 = 'U' + '5'.repeat(32);
const GROUP = 'C' + '7'.repeat(32);
const sent = [];

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
        res.end(req.url.includes('/profile/') ? JSON.stringify({ displayName: req.url.includes(C2) ? 'Aww' : 'ลูกค้าทดสอบ' }) : '{}');
      });
    });
    srv.listen(0, () => resolve(srv));
  });
}

function startBridge(port, linePort, dir) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'x', ADMIN_KEY: ADMIN,
      LINE_API_BASE: 'http://127.0.0.1:' + linePort, STATE_DIR: dir, REGISTER: 'off', DIFY_API_KEY: '',
      FAKE_DIFY_ANSWER: FAKE, ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '',
      SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', POS_TABLE: '', SALES_LEAD_TARGETS: '', LEAD_LINE_TOKEN: '', IMAGE_WAIT_SECONDS: '0',
      LINE_TEXT_WAIT_SECONDS: '1', LINE_FRAGMENT_WAIT_SECONDS: '1', DIFY_API_BASE: 'http://127.0.0.1:' + linePort + '/v1', DIFY_RESPONSE_MODE: '', DIFY_DATASET_KEY: '',
      PRODUCT_SHEET_ID: 'offline-test', TEAM_SHEET_URL: 'http://127.0.0.1:' + linePort + '/team-sheet',
      SPAM_GUARD: '', SPAM_HOUR_MAX: '', SPAM_BURST_MAX: '', SPAM_DAY_MAX: '', SPAM_VOICE_DAY_MAX: '', SPAM_IMAGE_DAY_MAX: '', SPAM_TEXT_MAX: '',
      SPAM_REPEAT_MINUTES: '', SPAM_DAILY_BUDGET_THB: '', SPAM_GROUPS: '', SPAM_GROUP_ALLOW: '', SPAM_ALLOW: '',
      ADMIN_NOTIFY_IDS: ADMIN_UID, OPENAI_ALERT_TO: ''
    }),
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
const adm = (port, method, p, body) => req(port, method, p, body, { 'x-admin-key': ADMIN });

let seq = 0;
const user = (id) => ({ type: 'user', userId: id });
async function postEvent(port, source, message, type) {
  seq++;
  const ev = { type: type || 'message', mode: 'active', timestamp: Date.now(), source, replyToken: 'rt' + seq, webhookEventId: 'ev' + seq, deliveryContext: { isRedelivery: false } };
  if (!type || type === 'message') ev.message = Object.assign({ id: 'm' + seq }, message);
  const body = JSON.stringify({ destination: 'x', events: [ev] });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  const r = await req(port, 'POST', '/webhook', body, { 'x-line-signature': sig });
  assert.strictEqual(r.status, 200, 'webhook ' + r.status);
  return 'rt' + seq;
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const repliesTo = (token) => sent.filter((x) => x.kind === 'reply' && x.to === token);
async function say(port, source, text) {
  const token = await postEvent(port, source, { type: 'text', text });
  for (let i = 0; i < 80 && !repliesTo(token).length; i++) await sleep(100);
  await sleep(200);
  return repliesTo(token);
}
async function silent(port, source, text, type) {
  const token = await postEvent(port, source, { type: 'text', text }, type);
  await sleep(2600);
  return repliesTo(token);
}
const texts = (out) => out.flatMap((x) => x.messages).map((m) => m.text || '').join('\n');
async function waitHealth(port) {
  for (let i = 0; i < 100; i++) {
    try { const h = await req(port, 'GET', '/health'); if (h.json && h.json.ok) return h.json; } catch (_) {}
    await sleep(150);
  }
  throw new Error('bridge did not start');
}

(async () => {
  const line = await mockLine();
  const linePort = line.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-settings-'));
  let port = 44000 + Math.floor(Math.random() * 2000);
  let b = startBridge(port, linePort, dir);
  try {
    const h = await waitHealth(port);
    assert.strictEqual(h.version, SOURCE_VERSION);

    // 1) defaults from env (none set) and the alert recipients from ADMIN_NOTIFY_IDS
    let st = (await adm(port, 'GET', '/admin/api/settings')).json;
    assert.deepStrictEqual([st.spam.hourMax, st.spam.budgetThb, st.spam.groups, st.spam.on], [20, 0, false, true]);
    assert.deepStrictEqual(st.alertTo, []);
    assert.deepStrictEqual(st.envAlertTo.map((x) => x.id), [ADMIN_UID]);
    assert.strictEqual((await req(port, 'GET', '/admin/api/settings')).status, 401, 'settings need the admin key');

    assert(texts(await say(port, user(C1), 'ยาฆ่าหญ้าในนาข้าวใช้อะไรดีคะ')).includes(FAKE));
    assert(texts(await say(port, user(C2), 'สวัสดีค่ะ แกนเตอร์ใช้ยังไงคะ')).includes(FAKE));

    // 2) save from the admin page: 1 AI answer an hour, budget 500 THB, groups off, Aww (C2) gets the budget alerts
    assert.strictEqual((await adm(port, 'POST', '/admin/api/settings', { spam: { hourMax: -1 } })).status, 400, 'a negative limit is refused');
    st = (await adm(port, 'POST', '/admin/api/settings', { spam: { hourMax: '1', budgetThb: '500', groups: false, on: true }, alertTo: [C2, 'not-an-id'] })).json;
    assert.deepStrictEqual([st.spam.hourMax, st.spam.budgetThb, st.spam.burstMax], [1, 500, 8], 'saved values apply, others keep the defaults');
    assert.deepStrictEqual(st.alertTo.map((x) => [x.id, x.name]), [[C2, 'Aww']], 'only valid LINE ids, shown with the chat name');
    const notice = await say(port, user(C1), 'ถ้าหญ้าขึ้นเยอะต้องทำยังไงคะ');
    assert(texts(notice).includes('ขอพักตอบอัตโนมัติถึงประมาณ'), 'the new hour limit applies at once: ' + texts(notice));
    const rep = (await adm(port, 'GET', '/admin/api/spam')).json;
    assert.deepStrictEqual([rep.limits.hour, rep.limits.budgetThb, rep.budget.thb], [1, 500, 500]);

    // 3) test alert goes to the chosen chat and to ADMIN_NOTIFY_IDS, by push
    const before = sent.length;
    const ta = (await adm(port, 'POST', '/admin/api/settings/test-alert', {})).json;
    assert.strictEqual(ta.ok, true);
    assert.deepStrictEqual(ta.results.map((x) => x.id).sort(), [C2, ADMIN_UID].sort());
    const pushes = sent.slice(before).filter((x) => x.kind === 'push');
    assert.deepStrictEqual(pushes.map((x) => x.to).sort(), [C2, ADMIN_UID].sort());
    assert(/ทดสอบแจ้งเตือน/.test(pushes[0].messages[0].text) && /500 บาท/.test(pushes[0].messages[0].text), pushes[0].messages[0].text);

    // 4) blacklist: no reply, nothing stored, count only; follow ignored; removing it answers again
    await adm(port, 'POST', '/admin/api/settings', { spam: { hourMax: 5, budgetThb: 500, groups: false, on: true } });
    assert(texts(await say(port, user(C4), 'ใช้ยาอะไรกับเพลี้ยดีคะ')).includes(FAKE));
    const hist0 = (await adm(port, 'GET', '/admin/api/history?id=' + C4)).json;
    assert.strictEqual((await adm(port, 'POST', '/admin/api/blacklist', { id: 'bad', on: true })).status, 400);
    assert.deepStrictEqual((await adm(port, 'POST', '/admin/api/blacklist', { id: C4, on: true })).json, { ok: true, id: C4, blacklisted: true });
    assert.strictEqual((await silent(port, user(C4), 'ตอบหน่อยค่ะ')).length, 0, 'blacklisted chat gets no reply');
    assert.strictEqual((await silent(port, user(C4), '', 'follow')).length, 0, 'blacklisted chat gets no welcome');
    const hist1 = (await adm(port, 'GET', '/admin/api/history?id=' + C4)).json;
    assert.strictEqual(JSON.stringify(hist1.history || hist1.messages || hist1), JSON.stringify(hist0.history || hist0.messages || hist0), 'blacklisted messages are not stored');
    let list = (await adm(port, 'GET', '/admin/api/list')).json;
    const c4 = list.sessions.find((x) => x.id === C4);
    assert(c4.bl && c4.bl.blocked === 2, 'list shows the blacklist and the count: ' + JSON.stringify(c4.bl));
    assert.strictEqual(list.blacklisted, 1);
    st = (await adm(port, 'GET', '/admin/api/settings')).json;
    assert.deepStrictEqual(st.blacklist.map((x) => [x.id, x.blocked, x.chat]), [[C4, 2, true]]);
    assert.deepStrictEqual((await adm(port, 'POST', '/admin/api/blacklist', { id: C4, on: false })).json.blacklisted, false);
    assert(texts(await say(port, user(C4), 'กลับมาถามใหม่ค่ะ ใช้ยาอะไรดี')).includes(FAKE), 'removed from the blacklist: answered again');

    // 5) tags from the chat header and the tag filter
    await adm(port, 'POST', '/admin/api/crm', { id: C4, tags: ['สแปม', 'คู่แข่ง'] });
    list = (await adm(port, 'GET', '/admin/api/list?tag=' + encodeURIComponent('สแปม'))).json;
    assert.deepStrictEqual(list.sessions.map((x) => x.id), [C4], 'tag filter');
    assert.strictEqual(list.tag, 'สแปม');
    assert(list.tags.some((x) => x.t === 'คู่แข่ง' && x.n === 1), JSON.stringify(list.tags));
    await adm(port, 'POST', '/admin/api/crm', { id: C4, tags: ['คู่แข่ง'] });
    list = (await adm(port, 'GET', '/admin/api/list?tag=' + encodeURIComponent('สแปม'))).json;
    assert.deepStrictEqual(list.sessions, [], 'removed tag no longer matches');
    const prof = (await adm(port, 'GET', '/admin/api/crm?id=' + C4)).json.profile;
    assert.deepStrictEqual(prof.tags, ['คู่แข่ง'], 'tags are kept in the CRM profile');

    // 6) groups: on from the admin page -> answered; off -> no reply
    await adm(port, 'POST', '/admin/api/settings', { spam: { hourMax: 1, budgetThb: 500, groups: true, on: true } });
    assert(texts(await say(port, { type: 'group', groupId: GROUP, userId: C5 }, 'ในกลุ่มถามได้ไหมคะ')).includes(FAKE), 'groups on: answered');
    await adm(port, 'POST', '/admin/api/settings', { spam: { hourMax: 1, budgetThb: 500, groups: false, on: true } });
    assert.strictEqual((await silent(port, { type: 'group', groupId: GROUP, userId: C5 }, 'ถามอีกครั้งในกลุ่มค่ะ')).length, 0, 'groups off: no reply');

    // 7) admin page
    const html = await new Promise((ok) => http.get({ host: '127.0.0.1', port, path: '/admin' }, (r) => { let s = ''; r.on('data', (d) => { s += d; }); r.on('end', () => ok(s)); }));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    new Function(scripts);
    for (const k of ['function renderSpam', 'function renderTagBar', 'function saveTags', 'function renderTagFilter']) assert(scripts.includes(k), k);
    for (const k of ['id="spambtn"', 'id="blbtn"', 'id="tagbtn"', 'id="tsel"', 'id="spamv"', 'id="tagbar"']) assert(html.includes(k), k);

    // 8) keep a blacklisted id with no chat, wait for the state file, restart
    await adm(port, 'POST', '/admin/api/blacklist', { id: C5, on: true });
    await sleep(4000);
  } catch (e) {
    console.log(b.log().split('\n').filter((l) => /settings|blacklist|spam|error|Error/.test(l)).slice(-30).join('\n'));
    b.child.kill();
    line.close();
    throw e;
  }
  b.child.kill();
  await sleep(500);
  port += 1;
  b = startBridge(port, linePort, dir);
  try {
    await waitHealth(port);
    let st = (await adm(port, 'GET', '/admin/api/settings')).json;
    assert.deepStrictEqual([st.spam.hourMax, st.spam.budgetThb, st.spam.groups], [1, 500, false], 'settings survive a restart');
    assert.deepStrictEqual(st.alertTo.map((x) => x.id), [C2]);
    assert.deepStrictEqual(st.blacklist.map((x) => x.id), [C5], 'blacklist survives a restart');
    assert(/loaded spam settings/.test(b.log()));
    assert.strictEqual((await silent(port, user(C5), 'ทักหลังรีสตาร์ต')).length, 0, 'still blacklisted after a restart');
    st = (await adm(port, 'POST', '/admin/api/settings', { spam: {} })).json;
    assert.deepStrictEqual([st.spam.hourMax, st.spam.budgetThb, st.spam.groups], [20, 0, false], 'reset to the defaults');
  } catch (e) {
    console.log(b.log().split('\n').filter((l) => /settings|blacklist|spam|error|Error/.test(l)).slice(-30).join('\n'));
    throw e;
  } finally { b.child.kill(); line.close(); }
  console.log('PASS: admin settings e2e (limits and budget from the admin page apply at once, test alert to chosen chat + ADMIN_NOTIFY_IDS, blacklist ignores and stores nothing, tags + tag filter, groups on/off, settings and blacklist survive a restart, reset, admin page compiles)');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
