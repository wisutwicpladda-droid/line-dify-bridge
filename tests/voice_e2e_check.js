'use strict';

// v3.37-voice: ทดสอบข้อความเสียงครบวงจรกับ server.js จริง
// LINE API และ ElevenLabs เป็น mock ในเครื่อง, คำตอบ Dify ใช้ FAKE_DIFY_ANSWER จึงไม่ต้องใช้ key จริง
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SECRET = 'test-secret';
const CUSTOMER = 'U' + 'd'.repeat(32);
const ANSWER = '"แกนเตอร์" ใช้กำจัดวัชพืชในนาข้าวช่วง 7-12 วันหลังหว่านข้าว อัตรา 200-250 ซีซี/น้ำ 40 ลิตร ต่อไร่ค่ะ';
const sent = []; // { kind: 'reply' | 'push', to, messages }
const el = { stt: [], tts: [], heard: 'แกนเตอร์ใช้ยังไงครับ' };

function fakeMp3(frames) {
  const f = Buffer.alloc(417);
  f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x64;
  return Buffer.concat(Array.from({ length: frames }, () => f));
}
const MP3 = fakeMp3(100); // 2,612 มิลลิวินาที

function listen(handler) {
  return new Promise((resolve) => { const srv = http.createServer(handler); srv.listen(0, () => resolve(srv)); });
}
function body(req) {
  return new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
}

const mockLine = () => listen(async (req, res) => {
  const b = await body(req);
  if (req.method === 'GET' && /\/v2\/bot\/message\/[^/]+\/content$/.test(req.url)) {
    res.writeHead(200, { 'Content-Type': 'audio/x-m4a' });
    return res.end(Buffer.from('fake-m4a-' + req.url));
  }
  let j = {};
  try { j = JSON.parse(b.toString('utf8') || '{}'); } catch (_) {}
  if (req.url.includes('/message/reply')) sent.push({ kind: 'reply', to: j.replyToken, messages: j.messages || [] });
  else if (req.url.includes('/message/push')) sent.push({ kind: 'push', to: j.to, messages: j.messages || [] });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(req.url.includes('/profile/') ? JSON.stringify({ displayName: 'ลูกค้าเสียง' }) : '{}');
});

const mockEleven = () => listen(async (req, res) => {
  const b = await body(req);
  if (req.url === '/v1/speech-to-text') {
    el.stt.push({ key: req.headers['xi-api-key'], body: b.toString('latin1') });
    res.writeHead(200, { 'Content-Type': 'application/json', 'character-cost': '1' });
    return res.end(JSON.stringify({ text: el.heard, language_code: 'tha' }));
  }
  if (req.url.startsWith('/v1/text-to-speech/')) {
    el.tts.push({ key: req.headers['xi-api-key'], url: req.url, json: JSON.parse(b.toString('utf8')) });
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'character-cost': '40' });
    return res.end(MP3);
  }
  res.writeHead(404); res.end();
});

function startBridge(port, linePort, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-voice-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'x', ADMIN_KEY: 'test-admin',
      LINE_API_BASE: 'http://127.0.0.1:' + linePort, STATE_DIR: dir, REGISTER: 'off', DIFY_API_KEY: '',
      PUBLIC_URL: 'http://127.0.0.1:' + port, FAKE_DIFY_ANSWER: ANSWER,
      ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '', VOICE_REPLY: '',
      SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', POS_TABLE: '', SALES_LEAD_TARGETS: '', LEAD_LINE_TOKEN: '', LINE_IMAGE_WAIT_SECONDS: '0'
    }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return { child, log: () => log };
}

function req(port, method, p, data, headers) {
  return new Promise((resolve, reject) => {
    const buf = data ? Buffer.from(data) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ 'Content-Type': 'application/json' }, buf ? { 'Content-Length': buf.length } : {}, headers || {}) }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => { const raw = Buffer.concat(c); let json = null; try { json = JSON.parse(raw.toString('utf8')); } catch (_) {} resolve({ status: res.statusCode, headers: res.headers, raw, json }); });
    });
    r.on('error', reject);
    if (buf) r.write(buf);
    r.end();
  });
}

let seq = 0;
async function send(port, message) {
  seq++;
  const before = sent.length;
  const payload = JSON.stringify({ destination: 'x', events: [{ type: 'message', mode: 'active', timestamp: Date.now(), source: { type: 'user', userId: CUSTOMER }, replyToken: 'rt' + seq, webhookEventId: 'ev' + seq, deliveryContext: { isRedelivery: false }, message: Object.assign({ id: 'm' + seq }, message) }] });
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64');
  const r = await req(port, 'POST', '/webhook', payload, { 'x-line-signature': sig });
  assert.strictEqual(r.status, 200, 'webhook ' + r.status);
  for (let i = 0; i < 80; i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    if (sent.slice(before).some((x) => x.kind === 'reply' && x.to === 'rt' + seq)) break;
  }
  await new Promise((ok) => setTimeout(ok, 200));
  return sent.slice(before).filter((x) => x.kind === 'reply').flatMap((x) => x.messages);
}
const voiceMsg = () => ({ type: 'audio', duration: 4000, contentProvider: { type: 'line' } });

async function waitHealth(port) {
  for (let i = 0; i < 100; i++) {
    try { const h = await req(port, 'GET', '/health'); if (h.json && h.json.ok) return h.json; } catch (_) {}
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error('bridge did not start');
}

(async () => {
  const line = await mockLine();
  const eleven = await mockEleven();
  const linePort = line.address().port;
  const elBase = 'http://127.0.0.1:' + eleven.address().port;

  // 1) ไม่มี key (ค่าเริ่มต้นของระบบจริง): ข้อความเสียงต้องได้คำตอบให้พิมพ์แทน ไม่เงียบ
  let port = 42000 + Math.floor(Math.random() * 2000);
  let b = startBridge(port, linePort, {});
  try {
    const h = await waitHealth(port);
    assert.strictEqual(h.version, '3.37-voice');
    assert.strictEqual(h.voice, false);
    const out = await send(port, voiceMsg());
    assert.strictEqual(out.length, 1, JSON.stringify(out));
    assert(/ยังฟังข้อความเสียงไม่ได้/.test(out[0].text), out[0].text);
    assert.strictEqual(el.stt.length, 0, 'ไม่มี key ต้องไม่เรียก ElevenLabs');
  } catch (e) { console.log(b.log().slice(-1500)); throw e; } finally { b.child.kill(); }

  // 2) เปิดเสียง (V.2): ถอดเสียง -> ตอบข้อความ + เสียงน้องลัดดา
  port += 1;
  b = startBridge(port, linePort, { ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_VOICE_ID: 'voice-ladda', ELEVENLABS_API_BASE: elBase });
  try {
    const h = await waitHealth(port);
    assert.deepStrictEqual(h.voice, { stt: 'scribe_v2', tts: 'eleven_v4', reply: 'voice', files: true });

    let out = await send(port, voiceMsg());
    assert.strictEqual(el.stt.length, 1, 'ต้องถอดเสียง 1 ครั้ง');
    assert.strictEqual(el.stt[0].key, 'test-key');
    assert(/name="model_id"\r\n\r\nscribe_v2/.test(el.stt[0].body) && /name="language_code"\r\n\r\nth/.test(el.stt[0].body), 'ต้องส่ง model และภาษาไทย');
    assert(el.stt[0].body.includes('fake-m4a-/v2/bot/message/m' + seq + '/content'), 'ต้องส่งไฟล์เสียงที่ดาวน์โหลดจาก LINE');
    assert.strictEqual(out[0].type, 'text');
    assert(out[0].text.includes('แกนเตอร์'), 'ข้อความคำตอบต้องอยู่ก่อน: ' + JSON.stringify(out));
    const audio = out.find((m) => m.type === 'audio');
    assert(audio, 'ต้องมีข้อความเสียง: ' + JSON.stringify(out));
    assert.strictEqual(audio.duration, 2612);
    assert(audio.originalContentUrl.startsWith('http://127.0.0.1:' + port + '/voice/') && /\/[a-f0-9]{32}\.mp3$/.test(audio.originalContentUrl));
    const tts = el.tts[0];
    assert.strictEqual(tts.url, '/v1/text-to-speech/voice-ladda?output_format=mp3_44100_128');
    assert.strictEqual(tts.json.model_id, 'eleven_v4');
    assert.strictEqual(tts.json.language_code, 'th');
    assert.deepStrictEqual(tts.json.voice_settings, { stability: 0.5, similarity_boost: 0.75 });
    assert(tts.json.text.includes('เจ็ด ถึง สิบสอง วัน') && tts.json.text.includes('สองร้อย ถึง สองร้อยห้าสิบ ซีซี ต่อ น้ำ สี่สิบ ลิตร'), 'ตัวเลขต้องเป็นคำอ่านไทย: ' + tts.json.text);
    const file = await req(port, 'GET', new URL(audio.originalContentUrl).pathname);
    assert.strictEqual(file.status, 200);
    assert.strictEqual(file.headers['content-type'], 'audio/mpeg');
    assert(file.raw.equals(MP3), 'ไฟล์ที่ LINE ดึงต้องเป็นเสียงที่สร้าง');
    assert.strictEqual((await req(port, 'GET', '/voice/../server.js')).status, 404);
    assert.strictEqual((await req(port, 'GET', '/voice/' + 'a'.repeat(32) + '.mp3')).status, 404);

    const list = await req(port, 'GET', '/admin/api/list', null, { 'x-admin-key': 'test-admin' });
    const sess = list.json && list.json.sessions && list.json.sessions.find((x) => x.id === CUSTOMER);
    assert(sess && /🎤 แกนเตอร์ใช้ยังไงครับ/.test(JSON.stringify(sess)), 'หน้าแอดมินต้องเห็นข้อความที่ถอดจากเสียง');

    // พิมพ์ข้อความปกติ: ไม่แนบเสียง (VOICE_REPLY=voice)
    out = await send(port, { type: 'text', text: 'แล้วใช้กับโดรนได้ไหม' });
    assert(out.length >= 1 && !out.some((m) => m.type === 'audio'), 'ลูกค้าพิมพ์ ต้องไม่แนบเสียง: ' + JSON.stringify(out));
    assert.strictEqual(el.tts.length, 1);

    // ถอดเสียงไม่ได้ข้อความ (เสียงเงียบ): ขอให้พูดใหม่หรือพิมพ์
    el.heard = '';
    out = await send(port, voiceMsg());
    assert(out.length === 1 && /ฟังข้อความเสียงไม่ชัด/.test(out[0].text), JSON.stringify(out));
    assert.strictEqual(el.tts.length, 1, 'ไม่มีคำถาม ต้องไม่สร้างเสียง');

    // เสียงยาวเกินกำหนด: ไม่ส่งไปถอดเสียง
    const sttBefore = el.stt.length;
    out = await send(port, { type: 'audio', duration: 900000, contentProvider: { type: 'line' } });
    assert(/ยาวเกินไป/.test(out[0].text), JSON.stringify(out));
    assert.strictEqual(el.stt.length, sttBefore);
  } catch (e) { console.log(b.log().slice(-2500)); throw e; } finally { b.child.kill(); }

  // 3) VOICE_REPLY=always: คำตอบจากการพิมพ์ก็แนบเสียง
  port += 1;
  el.heard = 'แกนเตอร์ใช้ยังไงครับ';
  b = startBridge(port, linePort, { ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_VOICE_ID: 'voice-ladda', ELEVENLABS_API_BASE: elBase, VOICE_REPLY: 'always', ELEVENLABS_TTS_MODEL: 'eleven_v4_turbo' });
  try {
    await waitHealth(port);
    const out = await send(port, { type: 'text', text: 'แกนเตอร์ใช้ยังไง' });
    assert(out.some((m) => m.type === 'audio'), 'always ต้องแนบเสียง: ' + JSON.stringify(out));
    assert.strictEqual(el.tts[el.tts.length - 1].json.model_id, 'eleven_v4_turbo');
  } catch (e) { console.log(b.log().slice(-1500)); throw e; } finally { b.child.kill(); line.close(); eleven.close(); }

  console.log('PASS: voice messages (no key -> ask to type; STT -> answer text + cloned-voice audio; typed -> text only; silence/too long handled; always mode)');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
