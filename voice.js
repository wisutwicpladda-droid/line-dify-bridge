'use strict';

// v3.37-voice (ทดลอง V.2): ข้อความเสียงผ่าน ElevenLabs
//  - ฟัง: ไฟล์เสียงจาก LINE -> Speech to Text (Scribe) -> ข้อความ แล้วตอบเหมือนลูกค้าพิมพ์
//  - พูด: คำตอบ -> แปลงตัวเลขและหน่วยเป็นคำอ่านไทย -> Text to Speech ด้วยเสียงโคลน "น้องลัดดา"
//    -> ไฟล์ mp3 ส่งเป็นข้อความเสียงของ LINE คู่กับข้อความตัวอักษร (อัตราผสมยังอ่านย้อนได้)
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const pathmod = require('path');

function num(v, def, lo, hi) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

function config(env) {
  const e = env || {};
  const key = String(e.ELEVENLABS_API_KEY || '').trim();
  const voiceId = String(e.ELEVENLABS_VOICE_ID || '').trim();
  const modeRaw = String(e.VOICE_REPLY || 'voice').trim().toLowerCase();
  const mode = ['off', 'voice', 'always'].includes(modeRaw) ? modeRaw : 'voice';
  return {
    key,
    voiceId,
    mode, // off = ไม่ตอบเป็นเสียง · voice = ตอบเป็นเสียงเมื่อลูกค้าส่งเสียงมา · always = ทุกคำตอบจาก Dify
    base: String(e.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/+$/, ''), // override ได้เฉพาะตอนเทส
    sttModel: String(e.ELEVENLABS_STT_MODEL || 'scribe_v2').trim(),
    ttsModel: String(e.ELEVENLABS_TTS_MODEL || 'eleven_v4').trim(),
    language: String(e.VOICE_LANGUAGE == null ? 'th' : e.VOICE_LANGUAGE).trim(),
    stability: num(e.VOICE_STABILITY, 0.5, 0, 1),
    similarity: num(e.VOICE_SIMILARITY, 0.75, 0, 1),
    maxChars: Math.round(num(e.VOICE_MAX_CHARS, 600, 100, 2500)),
    maxInMs: Math.round(num(e.VOICE_MAX_INPUT_SECONDS, 180, 10, 900) * 1000),
    keepDays: num(e.VOICE_KEEP_DAYS, 7, 1, 60),
    sttOn: !!key,
    ttsOn: !!key && !!voiceId && mode !== 'off'
  };
}

// ---------- ตัวเลขเป็นคำอ่านไทย ----------
const DIGIT = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACE = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

function thaiInt(str) {
  const s = String(str).replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(s)) return String(str);
  if (s === '0') return DIGIT[0];
  if (s.length > 6) {
    const lo = s.slice(-6).replace(/^0+/, '');
    return thaiInt(s.slice(0, -6)) + 'ล้าน' + (lo ? (lo === '1' ? 'เอ็ด' : thaiInt(lo)) : '');
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = +s[i];
    const pos = s.length - i - 1;
    if (!d) continue;
    if (pos === 1) out += d === 1 ? 'สิบ' : (d === 2 ? 'ยี่สิบ' : DIGIT[d] + 'สิบ');
    else if (pos === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
    else out += DIGIT[d] + PLACE[pos];
  }
  return out;
}

function thaiNumber(tok) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(tok).replace(/,/g, ''));
  if (!m) return String(tok);
  let out = thaiInt(m[1]);
  if (m[2]) out += 'จุด' + m[2].split('').map((d) => DIGIT[+d]).join('');
  return out;
}

const NUM = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
const RANGE_RX = new RegExp('(' + NUM + ')\\s*[-–—~]\\s*(' + NUM + ')', 'g');
const NUM_RX = new RegExp(NUM, 'g');
const PHONE_RX = /0\d{1,2}[-\s.]?\d{3}[-\s.]?\d{3,4}/g;
const TIME_RX = /(\d{1,2})[.:](\d{2})\s*น\./g;

// คำตอบตัวอักษร -> ข้อความสำหรับอ่านออกเสียง: ตัดอีโมจิ ลิงก์ เครื่องหมาย และอ่านตัวเลขเป็นคำไทย
// เช่น "20-30 ซีซี/น้ำ 20 ลิตร" -> "ยี่สิบ ถึง สามสิบ ซีซี ต่อ น้ำ ยี่สิบ ลิตร"
function speechText(text, maxChars) {
  let t = String(text || '');
  t = t.replace(/https?:\/\/\S+/g, ' ');
  t = t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '');
  t = t.replace(PHONE_RX, (p) => {
    const digits = p.replace(/\D/g, '');
    const groups = /[-\s.]/.test(p) ? p.split(/[-\s.]/) : [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
    return ' ' + groups.filter(Boolean).map((g) => g.split('').map((d) => DIGIT[+d]).join(' ')).join(', ') + ' ';
  });
  t = t.replace(TIME_RX, (_, h, m) => ' ' + thaiInt(h) + ' นาฬิกา' + (+m ? ' ' + thaiInt(m) + ' นาที' : '') + ' ');
  t = t.replace(/^[ \t]*[-–•●▪◦*]+[ \t]+/gm, '');
  t = t.replace(/[*_#`>|]+/g, ' ');
  t = t.replace(/["“”‘’'«»]/g, '');
  t = t.replace(/(\d)\s*(?:มล\.|ml\b)/gi, '$1 มิลลิลิตร');
  t = t.replace(/(\d)\s*(?:กก\.|kg\b)/gi, '$1 กิโลกรัม');
  t = t.replace(/(\d)\s*(?:c\.c\.|cc\b)/gi, '$1 ซีซี');
  t = t.replace(/%/g, ' เปอร์เซ็นต์ ');
  t = t.replace(RANGE_RX, (_, a, b) => ' ' + thaiNumber(a) + ' ถึง ' + thaiNumber(b) + ' ');
  t = t.replace(NUM_RX, (n) => ' ' + thaiNumber(n) + ' ');
  t = t.replace(/\s*\/\s*/g, ' ต่อ ');
  t = t.replace(/ฯลฯ/g, ' เป็นต้น ');
  t = t.replace(/[()[\]{}<>]/g, ' ');
  t = t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  const max = maxChars || 600;
  if (t.length > max) {
    let cut = t.slice(0, max);
    const k = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
    if (k > max * 0.6) cut = cut.slice(0, k);
    t = cut.trim() + ' รายละเอียดเพิ่มเติมอยู่ในข้อความนะคะ';
  }
  return t;
}

// ---------- ความยาวไฟล์ mp3 (มิลลิวินาที) สำหรับช่อง duration ของ LINE ----------
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3DurationMs(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return 0;
  let i = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    i = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  }
  let samples = 0;
  let rate = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3;
    const layer = (buf[i + 1] >> 1) & 3;
    const bri = (buf[i + 2] >> 4) & 15;
    const sri = (buf[i + 2] >> 2) & 3;
    const pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const sr = SR[ver][sri];
    const kbps = (ver === 3 ? BR1 : BR2)[bri];
    samples += ver === 3 ? 1152 : 576;
    rate = sr;
    i += Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / sr) + pad;
  }
  return rate ? Math.round((samples / rate) * 1000) : 0;
}

// ---------- ElevenLabs API ----------
function call(method, url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttp = u.protocol === 'http:';
    const req = (isHttp ? http : https).request({
      hostname: u.hostname,
      port: u.port || (isHttp ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method,
      headers: Object.assign({}, headers || {}, body ? { 'Content-Length': body.length } : {}),
      timeout: timeoutMs || 60000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers || {}, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function transcribe(cfg, buf, opts) {
  if (!cfg || !cfg.key) throw new Error('missing ELEVENLABS_API_KEY');
  const o = opts || {};
  const boundary = '----NongLaddaVoice' + crypto.randomBytes(12).toString('hex');
  const fields = { model_id: cfg.sttModel, tag_audio_events: 'false' };
  if (cfg.language) fields.language_code = cfg.language;
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  const name = String(o.filename || 'voice.m4a').replace(/[\r\n"\\]/g, '_');
  const type = String(o.contentType || 'audio/mp4').split(';')[0].trim() || 'audio/mp4';
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`, 'utf8'));
  parts.push(buf, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  const r = await call('POST', cfg.base + '/v1/speech-to-text', { 'xi-api-key': cfg.key, 'Content-Type': 'multipart/form-data; boundary=' + boundary }, Buffer.concat(parts), 90000);
  let j = null;
  try { j = JSON.parse(r.body.toString('utf8')); } catch (_) {}
  if (r.status !== 200 || !j) throw new Error(`speech-to-text ${r.status} ${r.body.toString('utf8').slice(0, 160)}`);
  return { text: String(j.text || '').trim(), language: j.language_code || '', cost: r.headers['character-cost'] || '' };
}

async function synthesize(cfg, text) {
  if (!cfg || !cfg.ttsOn) throw new Error('text-to-speech is off');
  const payload = { text, model_id: cfg.ttsModel, voice_settings: { stability: cfg.stability, similarity_boost: cfg.similarity } };
  if (cfg.language) payload.language_code = cfg.language;
  const r = await call('POST', `${cfg.base}/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}?output_format=mp3_44100_128`,
    { 'xi-api-key': cfg.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, Buffer.from(JSON.stringify(payload), 'utf8'), 90000);
  if (r.status !== 200 || !r.body.length) throw new Error(`text-to-speech ${r.status} ${r.body.toString('utf8').slice(0, 160)}`);
  return { buf: r.body, cost: r.headers['character-cost'] || '' };
}

// ---------- ไฟล์เสียงที่ให้ LINE ดึงไปเล่น (ชื่อสุ่ม เก็บไว้ keepDays วัน) ----------
const FILE_RX = /^[a-f0-9]{32}\.mp3$/;
let lastClean = 0;
function cleanup(dir, keepDays, now) {
  const limit = (now || Date.now()) - keepDays * 86400000;
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!FILE_RX.test(f)) continue;
    const p = pathmod.join(dir, f);
    try { if (fs.statSync(p).mtimeMs < limit) { fs.unlinkSync(p); removed++; } } catch (_) {}
  }
  return removed;
}
function save(dir, buf, keepDays) {
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(pathmod.join(dir, id + '.mp3'), buf);
  const now = Date.now();
  if (now - lastClean > 3600000) {
    lastClean = now;
    try { cleanup(dir, keepDays || 7, now); } catch (_) {}
  }
  return id;
}
function serve(req, res, dir, name) {
  if (!dir || !FILE_RX.test(name || '')) { res.writeHead(404); return res.end(); }
  fs.readFile(pathmod.join(dir, name), (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=604800' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

module.exports = { config, thaiInt, thaiNumber, speechText, mp3DurationMs, transcribe, synthesize, save, cleanup, serve };
