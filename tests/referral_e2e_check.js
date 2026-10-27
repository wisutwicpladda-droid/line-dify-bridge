'use strict';

// v3.37: ทดสอบการให้คะแนนลูกค้าและการส่งต่อร้านแบบครบวงจรกับ server.js จริง
// LINE API เป็น mock ในเครื่อง, คำตอบ Dify ใช้ FAKE_DIFY_ANSWER จึงไม่ต้องใช้ key จริง
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SECRET = 'test-secret';
const ADMIN = 'test-admin';
const CUSTOMER = 'U' + 'a'.repeat(32);
const SHOP = 'U' + 'b'.repeat(32);
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
        res.end(req.url.includes('/profile/') ? JSON.stringify({ displayName: req.url.includes(CUSTOMER) ? 'ลูกค้าทดสอบ' : 'Aww' }) : '{}');
      });
    });
    srv.listen(0, () => resolve(srv));
  });
}

function startBridge(port, linePort, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-ref-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'x', ADMIN_KEY: ADMIN,
      LINE_API_BASE: 'http://127.0.0.1:' + linePort, STATE_DIR: dir, REGISTER: 'off', DIFY_API_KEY: '',
      FAKE_DIFY_ANSWER: '"แกนเตอร์" ใช้กำจัดวัชพืชในนาข้าวช่วง 7-12 วันหลังหว่านข้าวค่ะ',
      SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', POS_TABLE: '', SALES_LEAD_TARGETS: '', LEAD_LINE_TOKEN: '', IMAGE_WAIT_SECONDS: '0'
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
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch (_) { resolve({ status: res.statusCode, text: b }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let seq = 0;
async function say(port, userId, textMsg) {
  seq++;
  const before = sent.length;
  const body = JSON.stringify({ destination: 'x', events: [{ type: 'message', mode: 'active', timestamp: Date.now(), source: { type: 'user', userId }, replyToken: 'rt' + seq, webhookEventId: 'ev' + seq, deliveryContext: { isRedelivery: false }, message: { id: 'm' + seq, type: 'text', text: textMsg } }] });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  const r = await req(port, 'POST', '/webhook', body, { 'x-line-signature': sig });
  assert.strictEqual(r.status, 200, 'webhook ' + r.status);
  for (let i = 0; i < 60; i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    if (sent.slice(before).some((x) => x.kind === 'reply' && x.to === 'rt' + seq)) break;
  }
  await new Promise((ok) => setTimeout(ok, 300));
  return sent.slice(before);
}

const texts = (out) => out.filter((x) => x.kind === 'reply').flatMap((x) => x.messages).map((m) => m.text || (m.template && m.template.text) || '').join('\n');
const quick = (out) => out.filter((x) => x.kind === 'reply').flatMap((x) => x.messages).flatMap((m) => (m.quickReply ? m.quickReply.items : [])).map((i) => i.action.text);

async function waitHealth(port) {
  for (let i = 0; i < 100; i++) {
    try { const h = await req(port, 'GET', '/health'); if (h.json && h.json.ok) return h.json; } catch (_) {}
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error('bridge did not start');
}

(async () => {
  const line = await mockLine();
  const linePort = line.address().port;
  const dealers = JSON.stringify([{ id: 'd1', name: 'ร้าน Aww (ทดสอบ)', provinces: ['*'], lineId: 'aww.test', joinCode: '4821' }]);

  // 1) ปิดฟีเจอร์ (ค่าเริ่มต้นของระบบจริง): ไม่มีปุ่มเสนอส่งต่อร้าน ไม่มีคะแนน
  let port = 40000 + Math.floor(Math.random() * 2000);
  let b = startBridge(port, linePort, { DEALERS: dealers });
  try {
    const h = await waitHealth(port);
    assert.strictEqual(h.version, '3.37-voice');
    assert.strictEqual(h.referral, false);
    assert.strictEqual(h.leadScore, false);
    const out = await say(port, CUSTOMER, 'แกนเตอร์ซื้อได้ที่ไหน');
    assert(!quick(out).includes('สนใจซื้อ ส่งต่อร้าน'), 'ปิดฟีเจอร์แล้วต้องไม่มีปุ่มส่งต่อร้าน');
    const out2 = await say(port, CUSTOMER, 'หาร้าน');
    assert(!/ร้านตัวแทนใกล้คุณ|อำเภอและจังหวัด/.test(texts(out2)), 'ปิดฟีเจอร์แล้ว "หาร้าน" ต้องไปที่บอทปกติ');
    const list = await req(port, 'GET', '/admin/api/list', null, { 'x-admin-key': ADMIN });
    assert.strictEqual(list.json.sessions[0].score, null, 'ปิดฟีเจอร์แล้วต้องไม่มีคะแนน');
  } finally { b.child.kill(); }

  // 2) เปิดฟีเจอร์ (V.2)
  sent.length = 0;
  port += 1;
  b = startBridge(port, linePort, { DEALERS: dealers, LEAD_SCORE: 'on', REFERRAL: 'on' });
  try {
    const h = await waitHealth(port);
    assert.deepStrictEqual(h.referral, { dealers: 1, bound: 0 });

    let out = await say(port, SHOP, 'ร้านค้า 4821');
    assert(/ลงทะเบียนไลน์นี้เป็นผู้รับเคสของ ร้าน Aww/.test(texts(out)), 'ร้านลงทะเบียนรับเคสได้: ' + texts(out));
    assert.deepStrictEqual((await waitHealth(port)).referral, { dealers: 1, bound: 1 });

    out = await say(port, CUSTOMER, 'ยาฆ่าหญ้าในนาข้าว');
    assert(!quick(out).includes('สนใจซื้อ ส่งต่อร้าน'), 'ยังไม่ได้พูดถึงการซื้อ ไม่ต้องเสนอ');
    out = await say(port, CUSTOMER, 'นา 20 ไร่ ใช้แกนเตอร์ยังไง');
    out = await say(port, CUSTOMER, 'แกนเตอร์ซื้อได้ที่ไหนคะ');
    assert(quick(out).includes('สนใจซื้อ ส่งต่อร้าน'), 'ลูกค้าถามที่ซื้อ ต้องเสนอส่งต่อร้าน: ' + JSON.stringify(quick(out)));
    assert(/แกนเตอร์/.test(texts(out)), 'ข้อความเสนอต้องมีชื่อสินค้า');

    out = await say(port, CUSTOMER, 'สนใจซื้อ ส่งต่อร้าน');
    assert(/อำเภอและจังหวัด/.test(texts(out)), 'ไม่รู้จังหวัด ต้องถามพื้นที่: ' + texts(out));
    out = await say(port, CUSTOMER, 'บ้านหมี่ ลพบุรี');
    assert(/ร้านตัวแทนใกล้คุณคือ ร้าน Aww/.test(texts(out)), 'ต้องเสนอร้านให้ยืนยัน: ' + texts(out));
    assert(quick(out).includes('ยืนยัน ส่งต่อร้าน'), 'ต้องมีปุ่มยืนยัน');
    assert(!out.some((x) => x.kind === 'push'), 'ยังไม่ยืนยัน ห้ามส่งอะไรให้ร้าน');

    out = await say(port, CUSTOMER, 'ยืนยัน ส่งต่อร้าน');
    const tpl = out.filter((x) => x.kind === 'reply').flatMap((x) => x.messages).find((m) => m.type === 'template');
    assert(tpl && tpl.template.actions[0].uri === 'https://line.me/ti/p/~aww.test', 'ต้องมีปุ่มทักไลน์ร้าน');
    assert(/ราคา การไปรับที่ร้าน หรือการจัดส่ง สอบถามกับร้าน/.test(texts(out)), 'ต้องบอกให้คุยเรื่องราคา/จัดส่งกับร้าน');
    const card = out.find((x) => x.kind === 'push' && x.to === SHOP);
    assert(card, 'ร้านต้องได้รับการ์ดลูกค้า');
    const cardText = card.messages[0].text;
    assert(/ลูกค้าสนใจซื้อ/.test(cardText) && /แกนเตอร์/.test(cardText) && /บ้านหมี่ ลพบุรี/.test(cardText), 'การ์ดต้องมีสินค้าและพื้นที่: ' + cardText);
    assert(/คะแนนความสนใจ: \d+\/100/.test(cardText), 'การ์ดต้องมีคะแนน');

    const list = await req(port, 'GET', '/admin/api/list', null, { 'x-admin-key': ADMIN });
    const c = list.json.sessions.find((x) => x.id === CUSTOMER);
    assert(c.score && c.score.value >= 90 && c.score.level === 'hot', 'ส่งต่อร้านแล้วต้องเป็นลูกค้าร้อน: ' + JSON.stringify(c.score));
    assert(c.score.reasons.some((r) => /สนใจซื้อ/.test(r)) && c.score.reasons.some((r) => /บอกพื้นที่ 20 ไร่/.test(r)), 'ต้องมีเหตุผลของคะแนน');
    assert.deepStrictEqual(c.ref, { step: 'sent', dealerName: 'ร้าน Aww (ทดสอบ)' });

    out = await say(port, CUSTOMER, 'แกนเตอร์ราคาเท่าไหร่');
    assert(!quick(out).includes('สนใจซื้อ ส่งต่อร้าน'), 'ส่งต่อแล้วไม่เสนอซ้ำใน 24 ชม.');

    // ลูกค้าอีกคนปฏิเสธ แล้วถามเรื่องใหม่ บอทต้องตอบปกติ
    const OTHER = 'U' + 'c'.repeat(32);
    await say(port, OTHER, 'ใช้แกนเตอร์ยังไง');
    out = await say(port, OTHER, 'อยากซื้อแกนเตอร์');
    assert(quick(out).includes('สนใจซื้อ ส่งต่อร้าน'));
    out = await say(port, OTHER, 'ไม่เป็นไร');
    assert(/พิมพ์ว่า "หาร้าน"/.test(texts(out)));
    out = await say(port, OTHER, 'ข้าวใบเหลืองเกิดจากอะไร');
    assert(/แกนเตอร์" ใช้กำจัดวัชพืช/.test(texts(out)), 'หลังปฏิเสธ คำถามใหม่ต้องได้คำตอบจากบอทตามปกติ');
    assert(!/ร้านตัวแทน/.test(texts(out)));
    const html = await new Promise((ok) => http.get({ host: '127.0.0.1', port, path: '/admin' }, (r) => { let s = ''; r.on('data', (d) => { s += d; }); r.on('end', () => ok(s)); }));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    new Function(scripts); // หน้าแอดมินต้องไม่มี syntax error
    assert(scripts.includes('function scoreBadge'));
  } catch (e) {
    console.log(b.log().split('\n').filter((l) => /referral|error|Error/.test(l)).slice(-20).join('\n'));
    throw e;
  } finally { b.child.kill(); line.close(); }
  console.log('PASS: lead score + dealer referral (off by default; offer -> location -> confirm -> shop card + chat button; decline returns to normal answers)');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

