// ============================================================
// LINE OA <-> Dify Bridge (Node.js สำหรับ Railway) — v2.2
// บอท "น้องลัดดา ICPL LINE Chatbot"
//
// จุดเด่น:
//  1. ตอบ ack ให้ LINE ทันที (กัน timeout/redelivery storm)
//  2. ประมวลผลต่อเบื้องหลัง (เซิร์ฟเวอร์รันค้างตลอด ไม่มีลิมิตเวลา)
//  3. Reply ก่อน ถ้า token หมดอายุ -> fallback เป็น Push
//  4. จำบทสนทนาต่อเนื่องผ่าน Dify conversations API (ไม่ต้องมี DB)
//  5. ระบบปิดเสียงบอท (mute) รายแชท:
//     - ลูกค้าพิมพ์ "คุยกับแอดมิน" -> บอทเงียบ MUTE_MINUTES นาที + ติดธง "ลูกค้าขอแอดมิน"
//     - ลูกค้าพิมพ์ "คุยกับบอท" -> บอทกลับมาตอบ
//     - หน้าแอดมิน /admin: เห็นแชท ลูกค้า↔บอท ย้อนหลัง (30 ข้อความ/แชท),
//       ปุ่ม ⏸ หยุดบอท (แอดมินตอบเอง) / ▶ เปิดบอทตอบต่อ รายแชท
//  6. ไม่ใช้ dependency ใดๆ (Node built-in ล้วน)
//
// ENV ที่ต้องตั้งใน Railway -> Variables:
//  LINE_CHANNEL_SECRET        จาก LINE Developers -> Basic settings
//  LINE_CHANNEL_ACCESS_TOKEN  จาก LINE Developers -> Messaging API
//  DIFY_API_KEY               จาก Dify -> แอปน้องลัดดา -> API Access (app-...)
//  ADMIN_KEY                  รหัสผ่านหน้าแอดมิน (ตั้งเองอะไรก็ได้ อังกฤษ/ตัวเลข)
//  MUTE_MINUTES               (ไม่บังคับ) นาทีที่บอทเงียบเมื่อลูกค้าขอแอดมิน ค่าเริ่ม 60
//  PORT                       Railway ตั้งให้อัตโนมัติ ไม่ต้องเพิ่มเอง
//
// หมายเหตุ:
//  - ประวัติแชท/สถานะปิดเสียง เก็บในหน่วยความจำ -> redeploy แล้วรีเซ็ต
//  - หน้าแอดมินเห็นเฉพาะข้อความที่ผ่านระบบนี้ (ลูกค้า + บอท)
//    ข้อความที่แอดมินพิมพ์เองใน LINE OA Manager จะไม่แสดง (LINE ไม่ส่ง event มา)
// ============================================================

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const CH_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CH_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const DIFY_KEY = process.env.DIFY_API_KEY || '';
const ADMIN_KEY = (process.env.ADMIN_KEY || '').trim();
const MUTE_MINUTES = Math.max(1, parseInt(process.env.MUTE_MINUTES || '60', 10) || 60);
const DIFY_BASE = 'https://api.dify.ai/v1';
const FOREVER = 8640000000000000; // ค่า timestamp สูงสุดของ JS = ปิดจนกว่าจะเปิด

// ---------- ทะเบียนแชท + สถานะปิดเสียง + ประวัติ (in-memory) ----------
const sessions = new Map(); // id -> {name,type,lastText,lastAt,mutedUntil,handoff,history}

function touchSession(id, type, text) {
  let s = sessions.get(id);
  if (!s) {
    s = { name: '', type, lastText: '', lastAt: 0, mutedUntil: 0, handoff: false, history: [] };
    sessions.set(id, s);
    if (sessions.size > 500) {
      let oldestId = null, oldestAt = Infinity;
      for (const [k, v] of sessions) if (v.lastAt < oldestAt) { oldestAt = v.lastAt; oldestId = k; }
      if (oldestId && oldestId !== id) sessions.delete(oldestId);
    }
  }
  if (text != null && text !== '') s.lastText = String(text).slice(0, 120);
  s.lastAt = Date.now();
  return s;
}

function pushHist(s, role, text) {
  s.history.push({ r: role, t: String(text).slice(0, 600), at: Date.now() });
  if (s.history.length > 30) s.history.splice(0, s.history.length - 30);
}

function fetchProfile(s, userId) {
  if (s.name || s.type !== 'user' || !userId || userId === 'unknown') return;
  s.name = '…';
  request('GET', 'https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
    Authorization: 'Bearer ' + CH_TOKEN
  }).then((r) => {
    s.name = (r.status === 200 && r.data && r.data.displayName) ? String(r.data.displayName).slice(0, 60) : '';
  }).catch(() => { s.name = ''; });
}

// ---------- HTTP helper (ไม่ใช้ axios/fetch lib) ----------
function request(method, url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + (u.search || ''),
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        body ? { 'Content-Length': Buffer.byteLength(body) } : {},
        headers || {}
      ),
      timeout: 180000
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(d); } catch (_) { parsed = d; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ---------- Dify ----------
async function findConversation(sessionId) {
  try {
    const r = await request('GET', `${DIFY_BASE}/conversations?user=${encodeURIComponent(sessionId)}&limit=1`, {
      Authorization: `Bearer ${DIFY_KEY}`
    });
    if (r.status === 200 && r.data && r.data.data && r.data.data[0]) return r.data.data[0].id || '';
  } catch (e) { console.log('findConversation error:', e.message); }
  return '';
}

async function askDify(sessionId, text) {
  const conversationId = await findConversation(sessionId);
  try {
    const r = await request('POST', `${DIFY_BASE}/chat-messages`, { Authorization: `Bearer ${DIFY_KEY}` }, {
      inputs: {},
      query: text,
      response_mode: 'blocking',
      user: sessionId,
      conversation_id: conversationId,
      auto_generate_name: true
    });
    if (r.status === 200 && r.data && typeof r.data.answer === 'string') return r.data.answer.trim();
    console.log('dify error:', r.status, JSON.stringify(r.data).slice(0, 300));
  } catch (e) { console.log('dify fetch error:', e.message); }
  return '';
}

// ---------- LINE ----------
async function lineReply(replyToken, text) {
  if (!replyToken) return false;
  try {
    const r = await request('POST', 'https://api.line.me/v2/bot/message/reply',
      { Authorization: `Bearer ${CH_TOKEN}` },
      { replyToken, messages: [{ type: 'text', text }] });
    if (r.status !== 200) console.log('reply error:', r.status, JSON.stringify(r.data).slice(0, 300));
    return r.status === 200;
  } catch (e) { console.log('reply fetch error:', e.message); return false; }
}

async function linePush(to, text) {
  try {
    const r = await request('POST', 'https://api.line.me/v2/bot/message/push',
      { Authorization: `Bearer ${CH_TOKEN}` },
      { to, messages: [{ type: 'text', text }] });
    if (r.status !== 200) console.log('push error:', r.status, JSON.stringify(r.data).slice(0, 300));
    return r.status === 200;
  } catch (e) { console.log('push fetch error:', e.message); return false; }
}

async function sendAnswer(s, ev, fallbackTo, text) {
  pushHist(s, 'b', text);
  const ok = await lineReply(ev.replyToken, text);
  if (!ok && fallbackTo && fallbackTo !== 'unknown') {
    const pushed = await linePush(fallbackTo, text);
    console.log(`[send] reply=failed push=${pushed}`);
  } else {
    console.log(`[send] reply=${ok}`);
  }
}

// ---------- คีย์เวิร์ดปิด/เปิดเสียง ----------
const MUTE_WORDS = ['คุยกับแอดมิน', 'ติดต่อแอดมิน', 'ขอสายแอดมิน', 'ขอแอดมิน', 'แอดมินตอบ', 'ต่อแอดมิน', 'หาแอดมิน'];
const UNMUTE_WORDS = ['คุยกับบอท', 'คุยกับน้องลัดดา', 'เปิดบอท', '/bot'];

function wantsAdmin(t) {
  const x = (t || '').trim();
  return x === 'แอดมิน' || x === 'admin' || MUTE_WORDS.some((w) => x.includes(w));
}
function wantsBot(t) {
  const x = (t || '').trim();
  return UNMUTE_WORDS.some((w) => x.includes(w));
}

// ---------- Event processing (เบื้องหลัง หลัง ack แล้ว) ----------
async function handleEvent(ev) {
  if (ev.type !== 'message' || !ev.message) return;
  if (ev.deliveryContext && ev.deliveryContext.isRedelivery) return; // กัน event ยิงซ้ำ

  const src = ev.source || {};
  const userId = src.userId || 'unknown';
  const sessionId = src.groupId || src.roomId || userId;
  const stype = src.groupId ? 'group' : (src.roomId ? 'room' : 'user');
  const pushTarget = src.groupId || src.roomId || userId; // push เข้ากลุ่มถ้าเป็นกลุ่ม

  let text = null;
  if (ev.message.type === 'text') text = ev.message.text;
  else if (ev.message.type === 'sticker') text = '(ผู้ใช้ส่งสติกเกอร์มา ทักทายกลับสั้นๆ อย่างเป็นมิตร)';
  else return;

  const shown = ev.message.type === 'text' ? text : '(สติกเกอร์)';
  const s = touchSession(sessionId, stype, shown);
  pushHist(s, 'u', shown);
  fetchProfile(s, userId); // ยิงเบื้องหลัง ไม่รอ

  const now = Date.now();

  // mute หมดเวลาแล้ว -> เคลียร์สถานะ
  if (s.mutedUntil && s.mutedUntil <= now) { s.mutedUntil = 0; s.handoff = false; }

  if (ev.message.type === 'text') {
    // ลูกค้าขอกลับมาคุยกับบอท
    if (wantsBot(text)) {
      s.mutedUntil = 0;
      s.handoff = false;
      console.log(`[unmute-kw] ${sessionId.slice(0, 8)}`);
      await sendAnswer(s, ev, pushTarget, 'น้องลัดดากลับมาแล้วค่ะ 😊 สอบถามเรื่องสินค้าได้เลยนะคะ');
      return;
    }
    // ลูกค้าขอคุยกับแอดมิน -> ปิดเสียงบอทชั่วคราว + ติดธงขอแอดมิน
    if (wantsAdmin(text)) {
      s.mutedUntil = now + MUTE_MINUTES * 60000;
      s.handoff = true;
      console.log(`[mute-kw] ${sessionId.slice(0, 8)} for ${MUTE_MINUTES}m (handoff)`);
      await sendAnswer(s, ev, pushTarget,
        `รับทราบค่ะ เดี๋ยวแอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ 🙏\n\n(น้องลัดดาขอพักการตอบแชทนี้ ${MUTE_MINUTES} นาที ถ้าต้องการคุยกับน้องลัดดาต่อ พิมพ์ "คุยกับบอท" ได้เลยค่ะ)`);
      return;
    }
  }

  // แชทนี้ถูกปิดเสียงอยู่ -> บอทเงียบ ให้แอดมินตอบเอง
  if (s.mutedUntil > now) {
    console.log(`[muted] ${sessionId.slice(0, 8)} skip: ${String(text).slice(0, 40)}`);
    return;
  }

  console.log(`[msg] ${sessionId.slice(0, 8)}...: ${text.slice(0, 60)}`);

  let answer = await askDify(sessionId, text);
  if (!answer) answer = 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้งนะคะ 🙏';
  await sendAnswer(s, ev, pushTarget, answer.slice(0, 4900));
}

// ---------- หน้าแอดมิน ----------
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>น้องลัดดา — ควบคุมบอท</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #0f1420; color: #e8ecf4; padding: 16px; max-width: 640px; margin: 0 auto; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { color: #93a0b4; font-size: 12.5px; margin-bottom: 16px; }
  .card { background: #1a2233; border: 1px solid #2a3550; border-radius: 12px; padding: 14px; margin-bottom: 10px; }
  .card.ho { border-color: #c97d1e; box-shadow: 0 0 0 1px #c97d1e33; }
  input { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #2a3550; background: #0f1420; color: #e8ecf4; font-size: 15px; }
  button { border: 0; border-radius: 10px; padding: 10px 14px; font-size: 13.5px; cursor: pointer; font-family: inherit; }
  .primary { background: #2f6fed; color: #fff; width: 100%; margin-top: 10px; padding: 12px; font-size: 15px; }
  .row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .b-mute { background: #3a2a12; color: #ffb454; }
  .b-on { background: #12321f; color: #4ade80; }
  .name { font-weight: 600; font-size: 15px; }
  .last { color: #93a0b4; font-size: 13px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: #6b7891; font-size: 11.5px; margin-top: 3px; }
  .badge { display: inline-block; font-size: 11.5px; border-radius: 99px; padding: 2px 9px; margin-left: 6px; vertical-align: 1px; }
  .on { background: #12321f; color: #4ade80; }
  .off { background: #3a1620; color: #ff7a90; }
  .hoff { background: #3a2a12; color: #ffb454; }
  .empty { color: #6b7891; text-align: center; padding: 30px 10px; font-size: 14px; }
  .note { color: #6b7891; font-size: 12px; margin-top: 14px; line-height: 1.6; }
  #err { color: #ff7a90; font-size: 13px; margin-top: 8px; display: none; }
  .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .refresh { background: #223050; color: #9fb4d8; }
  .chead { cursor: pointer; }
  .chatbox { background: #0f1420; border: 1px solid #223050; border-radius: 10px; margin-top: 10px; padding: 10px; max-height: 320px; overflow-y: auto; }
  .msg { margin-bottom: 8px; display: flex; flex-direction: column; }
  .mu { align-items: flex-start; }
  .mb { align-items: flex-end; }
  .bub { max-width: 85%; padding: 8px 11px; border-radius: 12px; font-size: 13.5px; white-space: pre-wrap; word-break: break-word; }
  .mu .bub { background: #223050; }
  .mb .bub { background: #14532d; }
  .mt { font-size: 10.5px; color: #6b7891; margin-top: 2px; }
</style>
</head>
<body>
<h1>🤖 น้องลัดดา — ควบคุมบอทรายแชท</h1>
<div class="sub">แตะการ์ดเพื่อดูแชท · ⏸ หยุดบอทเมื่อจะตอบเอง · ▶ เปิดกลับเมื่อตอบเสร็จ</div>

<div id="login" class="card">
  <div style="margin-bottom:8px; font-size:14px;">ใส่รหัสแอดมิน (ADMIN_KEY)</div>
  <input id="key" type="password" placeholder="รหัสแอดมิน" autocomplete="current-password">
  <button class="primary" id="loginbtn">เข้าสู่ระบบ</button>
  <div id="err"></div>
</div>

<div id="app" style="display:none;">
  <div class="topbar">
    <div class="sub" style="margin:0;" id="count"></div>
    <button class="refresh" id="refreshbtn">รีเฟรช ⟳</button>
  </div>
  <div id="list"></div>
  <div class="note">
    🙋 การ์ดขอบส้ม = ลูกค้าพิมพ์ขอคุยกับแอดมิน (บอทหยุดให้แล้ว รอแอดมินไปตอบใน LINE OA)<br>
    💬 หน้านี้เห็นเฉพาะข้อความ ลูกค้า ↔ บอท — ที่แอดมินพิมพ์ตอบใน LINE OA จะไม่แสดงที่นี่<br>
    💡 ลูกค้าพิมพ์ "คุยกับแอดมิน" = บอทหยุด <span id="mm"></span> นาที / "คุยกับบอท" = บอทกลับมา<br>
    ⚠️ ประวัติ/สถานะเก็บในหน่วยความจำ ถ้าระบบ redeploy จะเริ่มนับใหม่
  </div>
</div>

<script>
var KEY = sessionStorage.getItem('nladda_key') || '';
var timer = null;
var open = {};

function esc(s) { return String(s || '').replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

function ago(t) {
  if (!t) return '-';
  var m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'เมื่อครู่';
  if (m < 60) return m + ' นาทีที่แล้ว';
  var h = Math.floor(m / 60);
  if (h < 24) return h + ' ชม.ที่แล้ว';
  return Math.floor(h / 24) + ' วันที่แล้ว';
}

function hhmm(t) { return new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); }

function login() {
  KEY = document.getElementById('key').value.trim();
  load(true);
}

function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'x-admin-key': KEY, 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(path, opts).then(function(r) {
    if (r.status === 401) throw new Error('รหัสไม่ถูกต้อง');
    if (r.status === 503) throw new Error('ยังไม่ได้ตั้งค่า ADMIN_KEY ใน Railway');
    if (!r.ok) throw new Error('ผิดพลาด (' + r.status + ')');
    return r.json();
  });
}

function load(fromLogin) {
  if (!KEY) return;
  api('/admin/api/list').then(function(d) {
    sessionStorage.setItem('nladda_key', KEY);
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('mm').textContent = d.muteMinutes;
    render(d.sessions);
    for (var id in open) if (open[id]) fetchHist(id);
    if (!timer) timer = setInterval(load, 10000);
  }).catch(function(e) {
    if (fromLogin) { var el = document.getElementById('err'); el.style.display = 'block'; el.textContent = e.message; }
    sessionStorage.removeItem('nladda_key');
  });
}

function render(list) {
  var now = Date.now();
  document.getElementById('count').textContent = 'แชททั้งหมด ' + list.length + ' รายการ';
  if (!list.length) {
    document.getElementById('list').innerHTML = '<div class="card empty">ยังไม่มีแชทเข้ามาหลังระบบเริ่มทำงาน<br>เมื่อลูกค้าทักไลน์ จะขึ้นรายการที่นี่</div>';
    return;
  }
  var h = '';
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var muted = s.mutedUntil > now;
    var forever = s.mutedUntil >= 8000000000000000;
    var badge = muted
      ? '<span class="badge off">🔇 ' + (forever ? 'หยุดอยู่ · แอดมินตอบ' : 'หยุดถึง ' + hhmm(s.mutedUntil) + ' น.') + '</span>'
      : '<span class="badge on">🔊 บอทตอบอยู่</span>';
    var hobadge = (muted && s.handoff) ? '<span class="badge hoff">🙋 ลูกค้าขอแอดมิน</span>' : '';
    var icon = s.type === 'group' ? '👥' : (s.type === 'room' ? '💬' : '👤');
    var nm = s.name && s.name !== '…' ? s.name : (s.id.slice(0, 10) + '…');
    var toggleBtn = muted
      ? '<button class="b-on" data-id="' + s.id + '" data-m="0">▶ เปิดบอทตอบต่อ</button>'
      : '<button class="b-mute" data-id="' + s.id + '" data-m="-1">⏸ หยุดบอท (แอดมินตอบเอง)</button>';
    h += '<div class="card' + ((muted && s.handoff) ? ' ho' : '') + '">'
      + '<div class="chead" data-open="' + s.id + '">'
      + '<div class="name">' + icon + ' ' + esc(nm) + badge + hobadge + '</div>'
      + '<div class="last">' + esc(s.lastText || '-') + '</div>'
      + '<div class="meta">ข้อความล่าสุด ' + ago(s.lastAt) + ' · แตะเพื่อดู/ซ่อนแชท</div>'
      + '</div>'
      + '<div class="chatbox" id="cb-' + s.id + '" style="display:' + (open[s.id] ? 'block' : 'none') + '"></div>'
      + '<div class="row">' + toggleBtn + '</div>'
      + '</div>';
  }
  document.getElementById('list').innerHTML = h;
}

function fetchHist(id) {
  api('/admin/api/history?id=' + encodeURIComponent(id)).then(function(d) {
    var el = document.getElementById('cb-' + id);
    if (!el) return;
    if (!d.history.length) { el.innerHTML = '<div class="meta" style="padding:6px;">ยังไม่มีข้อความหลังระบบเริ่มทำงานรอบนี้</div>'; return; }
    var h = '';
    for (var i = 0; i < d.history.length; i++) {
      var m = d.history[i];
      h += '<div class="msg ' + (m.r === 'u' ? 'mu' : 'mb') + '">'
        + '<div class="bub">' + esc(m.t) + '</div>'
        + '<div class="mt">' + (m.r === 'u' ? '👤 ลูกค้า' : '🤖 บอท') + ' · ' + hhmm(m.at) + '</div>'
        + '</div>';
    }
    var atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = h;
    if (atBottom || !el.dataset.filled) { el.scrollTop = el.scrollHeight; el.dataset.filled = '1'; }
  }).catch(function() {});
}

document.getElementById('loginbtn').addEventListener('click', login);
document.getElementById('key').addEventListener('keydown', function(e) { if (e.key === 'Enter') login(); });
document.getElementById('refreshbtn').addEventListener('click', function() { load(); });

document.getElementById('list').addEventListener('click', function(e) {
  var b = e.target.closest('button[data-id]');
  if (b) {
    mute(b.getAttribute('data-id'), parseInt(b.getAttribute('data-m'), 10));
    return;
  }
  var hd = e.target.closest('[data-open]');
  if (hd) {
    var id = hd.getAttribute('data-open');
    open[id] = !open[id];
    var el = document.getElementById('cb-' + id);
    if (el) {
      el.style.display = open[id] ? 'block' : 'none';
      if (open[id]) fetchHist(id);
    }
  }
});

function mute(id, minutes) {
  api('/admin/api/mute', { method: 'POST', body: JSON.stringify({ id: id, minutes: minutes }) })
    .then(function() { load(); })
    .catch(function(e) { alert(e.message); });
}

if (KEY) load();
</script>
</body>
</html>`;

function adminAuthed(req) {
  if (!ADMIN_KEY) return null; // ยังไม่ได้ตั้งค่า
  const k = req.headers['x-admin-key'] || '';
  try {
    return k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
  } catch (_) { return false; }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function handleAdmin(req, res, path, body) {
  const authed = adminAuthed(req);
  if (authed === null) return sendJson(res, 503, { ok: false, error: 'ADMIN_KEY not set' });
  if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  if (path === '/admin/api/list' && req.method === 'GET') {
    const list = [...sessions.entries()]
      .map(([id, s]) => ({ id, name: s.name, type: s.type, lastText: s.lastText, lastAt: s.lastAt, mutedUntil: s.mutedUntil, handoff: !!s.handoff }))
      .sort((a, b) => ((b.handoff && b.mutedUntil > Date.now()) ? 1 : 0) - ((a.handoff && a.mutedUntil > Date.now()) ? 1 : 0) || b.lastAt - a.lastAt)
      .slice(0, 100);
    return sendJson(res, 200, { ok: true, muteMinutes: MUTE_MINUTES, now: Date.now(), sessions: list });
  }

  if (path === '/admin/api/history' && req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    const s = sessions.get(id);
    if (!s) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    return sendJson(res, 200, { ok: true, id, history: s.history });
  }

  if (path === '/admin/api/mute' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    const s = sessions.get(id);
    const m = data.minutes;
    if (m === 0) { s.mutedUntil = 0; s.handoff = false; }   // ▶ เปิดบอท
    else if (m === -1) s.mutedUntil = FOREVER;               // ⏸ หยุดจนกว่าจะเปิด
    else if (typeof m === 'number' && m > 0) s.mutedUntil = Date.now() + m * 60000;
    else s.mutedUntil = Date.now() + MUTE_MINUTES * 60000;   // ค่าเริ่มต้น
    console.log(`[admin] ${id.slice(0, 8)} mutedUntil=${s.mutedUntil}`);
    return sendJson(res, 200, { ok: true, id, mutedUntil: s.mutedUntil, handoff: !!s.handoff });
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

// ---------- Server ----------
const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  // หน้าแอดมิน (HTML)
  if (req.method === 'GET' && path === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(ADMIN_HTML);
  }

  // Admin API
  if (path.startsWith('/admin/api/')) {
    if (req.method === 'GET') return handleAdmin(req, res, path, Buffer.alloc(0));
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handleAdmin(req, res, path, Buffer.concat(chunks)));
    return;
  }

  // Health check
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'line-dify-bridge', version: 2.2, ts: Date.now() }));
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end('Not found'); }

  // LINE webhook
  let chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    // ตรวจลายเซ็น LINE
    const sig = req.headers['x-line-signature'] || '';
    const expected = crypto.createHmac('sha256', CH_SECRET).update(body).digest('base64');
    let valid = false;
    try { valid = sig.length > 0 && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch (_) {}
    if (!valid) { res.writeHead(401); return res.end('Invalid signature'); }

    // ✨ ack ทันที แล้วค่อยประมวลผล
    res.writeHead(200); res.end('OK');

    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) { return; }
    (data.events || []).forEach((ev) => {
      handleEvent(ev).catch((e) => console.log('event error:', e.message));
    });
  });
});

server.listen(PORT, () => console.log(`line-dify-bridge v2.2 (mute+admin+history) running on port ${PORT}`));
