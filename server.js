// ============================================================
// LINE OA <-> Dify Bridge (Node.js สำหรับ Railway) — v2.6
// บอท "น้องลัดดา ICPL LINE Chatbot"
//
// จุดเด่น:
//  1. ตอบ ack ให้ LINE ทันที (กัน timeout/redelivery storm)
//  2. Reply ก่อน ถ้า token หมดอายุ -> fallback เป็น Push
//  3. จำบทสนทนาต่อเนื่องผ่าน Dify conversations API (ไม่ต้องมี DB)
//  4. หน้าแอดมิน /admin ดีไซน์แบบ LINE OA Manager + ปุ่ม ⏸/▶ หยุด/เปิดบอทรายแชท
//  5. แชทเก่าเก็บถาวรลงดิสก์ (Railway Volume ที่ /data) — redeploy แล้วไม่หาย
//     + Real-time: แชทใหม่เด้งขึ้นเองทันทีผ่าน SSE ไม่ต้องกด refresh
//  6. ช่องพิมพ์ตอบลูกค้าจากหน้าแอดมินได้เลย (ส่งในนาม OA ผ่าน Push API)
//     ⚠️ ข้อความที่แอดมินส่งจากหน้านี้ใช้โควต้า Push รายเดือนของ LINE OA
//        (บอทตอบเองใช้ Reply API ไม่กินโควต้า) ถ้าจะคุยยาวๆ ใช้ LINE OA Manager ตามเดิม
//  7. v2.6: ดึงประวัติสนทนาเก่า (ลูกค้า↔บอท) กลับมาจาก Dify อัตโนมัติ
//     - ตอนบูท: เติมประวัติเก่าให้ทุกแชทที่รู้จัก + แชทจาก SEED_USER_IDS
//     - ลูกค้า(เก่า)ทักครั้งแรก: ประวัติเดิมทั้งหมดโผล่ตามมาเองใน 1-2 วิ
//     - หมายเหตุ: ข้อความที่แอดมินเคยพิมพ์ใน LINE OA Manager ดึงไม่ได้ (LINE ไม่มี API)
//  8. ไม่ใช้ dependency ใดๆ (Node built-in ล้วน)
//
// ENV ที่ต้องตั้งใน Railway -> Variables:
//  LINE_CHANNEL_SECRET        จาก LINE Developers -> Basic settings
//  LINE_CHANNEL_ACCESS_TOKEN  จาก LINE Developers -> Messaging API
//  DIFY_API_KEY               จาก Dify -> แอปน้องลัดดา -> API Access (app-...)
//  ADMIN_KEY                  รหัสผ่านหน้าแอดมิน (อังกฤษ/ตัวเลข)
//  MUTE_MINUTES               (ไม่บังคับ) นาทีที่บอทเงียบเมื่อลูกค้าขอแอดมิน ค่าเริ่ม 60
//  STATE_DIR                  (ไม่บังคับ) โฟลเดอร์เก็บไฟล์ถาวร ค่าเริ่ม /data
//                             *** ต้อง Attach Volume ใน Railway ที่ mount path /data
//                                 ไม่งั้นไฟล์หายตอน redeploy (ระบบยังทำงานได้ แค่ไม่ถาวร)
//  SEED_USER_IDS              (ไม่บังคับ) LINE userId คั่นด้วย , เพื่อดึงลูกค้าเก่า
//                             เข้าลิสต์พร้อมประวัติทันทีตอนบูท (ใส่ครั้งเดียวพอ)
//  PORT                       Railway ตั้งให้อัตโนมัติ
// ============================================================

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const pathmod = require('path');

const PORT = process.env.PORT || 3000;
const CH_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CH_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const DIFY_KEY = process.env.DIFY_API_KEY || '';
const ADMIN_KEY = (process.env.ADMIN_KEY || '').trim();
const MUTE_MINUTES = Math.max(1, parseInt(process.env.MUTE_MINUTES || '60', 10) || 60);
const STATE_DIR = process.env.STATE_DIR || '/data';
const DIFY_BASE = 'https://api.dify.ai/v1';
const FOREVER = 8640000000000000;
const HIST_MAX = 200;

// ---------- ทะเบียนแชท + สถานะ + ประวัติ ----------
const sessions = new Map(); // id -> {name,pic,type,lastText,lastAt,mutedUntil,handoff,history}

// ---------- Persistence (เก็บถาวรลงดิสก์ ถ้ามี Volume) ----------
const STATE_FILE = pathmod.join(STATE_DIR, 'nladda-state.json');
let persistOK = false;
let dirty = false;
let saveTimer = null;

function initPersist() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(pathmod.join(STATE_DIR, '.write-test'), 'ok');
    fs.unlinkSync(pathmod.join(STATE_DIR, '.write-test'));
    persistOK = true;
  } catch (e) {
    persistOK = false;
    console.log(`[persist] OFF — เขียน ${STATE_DIR} ไม่ได้ (${e.code}) ต่อ Volume ใน Railway ที่ mount path /data เพื่อเก็บแชทถาวร`);
    return;
  }
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (raw && Array.isArray(raw.sessions)) {
        for (const [id, s] of raw.sessions) {
          if (!id || !s) continue;
          if (s.name === '…') s.name = '';
          if (!Array.isArray(s.history)) s.history = [];
          sessions.set(id, {
            name: s.name || '', pic: s.pic || '', type: s.type || 'user',
            lastText: s.lastText || '', lastAt: s.lastAt || 0,
            mutedUntil: s.mutedUntil || 0, handoff: !!s.handoff,
            history: s.history.slice(-HIST_MAX), bf: !!s.bf
          });
        }
        console.log(`[persist] loaded ${sessions.size} chats from disk`);
      }
    }
  } catch (e) { console.log('[persist] load error:', e.message); }
}

function saveNow() {
  if (!persistOK || !dirty) return;
  dirty = false;
  const data = JSON.stringify({ v: 1, savedAt: Date.now(), sessions: [...sessions.entries()] });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFile(tmp, data, (err) => {
    if (err) { console.log('[persist] write error:', err.message); return; }
    fs.rename(tmp, STATE_FILE, (err2) => {
      if (err2) console.log('[persist] rename error:', err2.message);
    });
  });
}

function markDirty() {
  dirty = true;
  if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 3000);
}

process.on('SIGTERM', () => {
  try {
    if (persistOK && dirty) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ v: 1, savedAt: Date.now(), sessions: [...sessions.entries()] }));
    }
  } catch (_) {}
  process.exit(0);
});

// ---------- Real-time (SSE) ----------
const sseClients = new Set();
const sseTokens = new Map(); // token -> expiry
let bcTimer = null;

function broadcast() {
  if (bcTimer) return;
  bcTimer = setTimeout(() => {
    bcTimer = null;
    for (const res of sseClients) {
      try { res.write('data: u\n\n'); } catch (_) { sseClients.delete(res); }
    }
  }, 250);
}

setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': hb\n\n'); } catch (_) { sseClients.delete(res); }
  }
  const now = Date.now();
  for (const [t, exp] of sseTokens) if (exp < now) sseTokens.delete(t);
}, 25000);

function touchSession(id, type, text) {
  let s = sessions.get(id);
  if (!s) {
    s = { name: '', pic: '', type, lastText: '', lastAt: 0, mutedUntil: 0, handoff: false, history: [], bf: false };
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
  if (s.history.length > HIST_MAX) s.history.splice(0, s.history.length - HIST_MAX);
  markDirty();
  broadcast();
}

function fetchProfile(s, userId) {
  if (s.name || s.type !== 'user' || !userId || userId === 'unknown') return;
  s.name = '…';
  request('GET', 'https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
    Authorization: 'Bearer ' + CH_TOKEN
  }).then((r) => {
    if (r.status === 200 && r.data) {
      s.name = String(r.data.displayName || '').slice(0, 60);
      s.pic = String(r.data.pictureUrl || '').slice(0, 500);
      markDirty();
      broadcast();
    } else { s.name = ''; }
  }).catch(() => { s.name = ''; });
}

// ---------- HTTP helper ----------
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

// ---------- ดึงประวัติเก่าจาก Dify (backfill) ----------
async function backfillFromDify(id, s) {
  try {
    const rc = await request('GET', `${DIFY_BASE}/conversations?user=${encodeURIComponent(id)}&limit=20`, {
      Authorization: `Bearer ${DIFY_KEY}`
    });
    if (rc.status !== 200 || !rc.data || !Array.isArray(rc.data.data)) {
      console.log(`[backfill] ${id.slice(0, 8)} conv list failed (${rc.status})`);
      return;
    }
    const convs = rc.data.data.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, 5);
    const entries = [];
    for (const c of convs) {
      const rm = await request('GET', `${DIFY_BASE}/messages?user=${encodeURIComponent(id)}&conversation_id=${encodeURIComponent(c.id)}&limit=100`, {
        Authorization: `Bearer ${DIFY_KEY}`
      });
      if (rm.status === 200 && rm.data && Array.isArray(rm.data.data)) {
        for (const m of rm.data.data) {
          const at = (m.created_at || 0) * 1000;
          if (!at) continue;
          if (m.query) entries.push({ r: 'u', t: String(m.query).slice(0, 600), at });
          if (m.answer) entries.push({ r: 'b', t: String(m.answer).slice(0, 600), at: at + 1 });
        }
      }
    }
    entries.sort((a, b) => a.at - b.at);
    // เติมเฉพาะข้อความที่เก่ากว่าที่มีอยู่ (กันซ้ำกับที่ระบบบันทึกสดไว้แล้ว)
    const minAt = s.history.length ? s.history[0].at : Infinity;
    const older = entries.filter((e) => e.at < minAt - 2000);
    if (older.length) s.history = older.concat(s.history).slice(-HIST_MAX);
    if (!s.lastAt && s.history.length) {
      const last = s.history[s.history.length - 1];
      s.lastAt = last.at;
      s.lastText = String(last.t).slice(0, 120);
    }
    s.bf = true;
    markDirty();
    broadcast();
    console.log(`[backfill] ${id.slice(0, 8)} +${older.length} old msgs from ${convs.length} convs`);
  } catch (e) { console.log(`[backfill] ${id.slice(0, 8)} error:`, e.message); }
}

function bootBackfill() {
  // นำเข้าลูกค้าเก่าจาก SEED_USER_IDS (ถ้าตั้งไว้)
  const seeds = (process.env.SEED_USER_IDS || '').split(/[\s,]+/).filter((x) => /^U[0-9a-f]{32}$/.test(x));
  for (const id of seeds) {
    if (!sessions.has(id)) {
      sessions.set(id, { name: '', pic: '', type: 'user', lastText: '', lastAt: 0, mutedUntil: 0, handoff: false, history: [], bf: false });
      fetchProfile(sessions.get(id), id);
    }
  }
  if (seeds.length) console.log(`[backfill] seeded ${seeds.length} user ids`);
  // ไล่เติมประวัติเก่าให้ทุกแชทที่ยังไม่เคยเติม
  const pending = [...sessions.entries()].filter(([, s]) => !s.bf);
  let i = 0;
  const next = () => {
    if (i >= pending.length) return;
    const [id, s] = pending[i++];
    backfillFromDify(id, s).catch(() => {}).then(() => setTimeout(next, 300));
  };
  if (pending.length) console.log(`[backfill] sweeping ${pending.length} chats...`);
  next();
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

// ---------- Event processing ----------
async function handleEvent(ev) {
  if (ev.type !== 'message' || !ev.message) return;
  if (ev.deliveryContext && ev.deliveryContext.isRedelivery) return;

  const src = ev.source || {};
  const userId = src.userId || 'unknown';
  const sessionId = src.groupId || src.roomId || userId;
  const stype = src.groupId ? 'group' : (src.roomId ? 'room' : 'user');
  const pushTarget = src.groupId || src.roomId || userId;

  let text = null;
  if (ev.message.type === 'text') text = ev.message.text;
  else if (ev.message.type === 'sticker') text = '(ผู้ใช้ส่งสติกเกอร์มา ทักทายกลับสั้นๆ อย่างเป็นมิตร)';
  else return;

  const shown = ev.message.type === 'text' ? text : '(สติกเกอร์)';
  const s = touchSession(sessionId, stype, shown);
  const isNewChat = s.history.length === 0 && !s.bf;
  pushHist(s, 'u', shown);
  fetchProfile(s, userId);
  // ลูกค้าเก่าทักครั้งแรกหลังระบบใหม่ -> ดึงประวัติเดิมจาก Dify ตามมาให้เอง
  if (isNewChat) setTimeout(() => backfillFromDify(sessionId, s).catch(() => {}), 50);

  const now = Date.now();

  if (s.mutedUntil && s.mutedUntil <= now) { s.mutedUntil = 0; s.handoff = false; markDirty(); broadcast(); }

  if (ev.message.type === 'text') {
    if (wantsBot(text)) {
      s.mutedUntil = 0;
      s.handoff = false;
      console.log(`[unmute-kw] ${sessionId.slice(0, 8)}`);
      await sendAnswer(s, ev, pushTarget, 'น้องลัดดากลับมาแล้วค่ะ 😊 สอบถามเรื่องสินค้าได้เลยนะคะ');
      return;
    }
    if (wantsAdmin(text)) {
      s.mutedUntil = now + MUTE_MINUTES * 60000;
      s.handoff = true;
      console.log(`[mute-kw] ${sessionId.slice(0, 8)} for ${MUTE_MINUTES}m (handoff)`);
      await sendAnswer(s, ev, pushTarget,
        `รับทราบค่ะ เดี๋ยวแอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ 🙏\n\n(น้องลัดดาขอพักการตอบแชทนี้ ${MUTE_MINUTES} นาที ถ้าต้องการคุยกับน้องลัดดาต่อ พิมพ์ "คุยกับบอท" ได้เลยค่ะ)`);
      return;
    }
  }

  if (s.mutedUntil > now) {
    console.log(`[muted] ${sessionId.slice(0, 8)} skip: ${String(text).slice(0, 40)}`);
    return;
  }

  console.log(`[msg] ${sessionId.slice(0, 8)}...: ${text.slice(0, 60)}`);

  let answer = await askDify(sessionId, text);
  if (!answer) answer = 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้งนะคะ 🙏';
  await sendAnswer(s, ev, pushTarget, answer.slice(0, 4900));
}

// ---------- หน้าแอดมิน (ดีไซน์แบบ LINE OA Manager) ----------
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>น้องลัดดา — ควบคุมบอท</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #e9ebee; color: #1f2329; }
  button { font-family: inherit; cursor: pointer; border: 0; }

  .login-wrap { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .login-card { background: #fff; border-radius: 14px; padding: 28px 24px; width: 100%; max-width: 380px; box-shadow: 0 6px 24px rgba(0,0,0,.08); text-align: center; }
  .login-card .logo { font-size: 40px; margin-bottom: 8px; }
  .login-card h1 { font-size: 17px; margin-bottom: 2px; }
  .login-card .sub { color: #8a95a1; font-size: 12.5px; margin-bottom: 18px; }
  .login-card input { width: 100%; padding: 12px 14px; border: 1px solid #d8dde3; border-radius: 10px; font-size: 15px; background: #fff; color: #1f2329; }
  .login-card .go { width: 100%; margin-top: 12px; padding: 12px; border-radius: 10px; background: #06c755; color: #fff; font-size: 15px; font-weight: 600; }
  #err { color: #e5484d; font-size: 13px; margin-top: 10px; display: none; }

  .app { display: none; height: 100dvh; max-width: 1280px; margin: 0 auto; background: #fff; box-shadow: 0 0 24px rgba(0,0,0,.06); }
  .app.on { display: flex; }

  .side { width: 340px; flex: none; border-right: 1px solid #e3e6ea; display: flex; flex-direction: column; background: #fff; }
  .side-head { padding: 13px 16px; border-bottom: 1px solid #e3e6ea; display: flex; align-items: center; justify-content: space-between; }
  .side-head b { font-size: 16px; }
  .cnt { display: inline-block; background: #06c755; color: #fff; font-size: 11px; border-radius: 99px; padding: 1px 7px; margin-left: 6px; vertical-align: 2px; }
  .live { font-size: 10.5px; color: #0a9a4a; margin-left: 8px; }
  .live.off { color: #d33a41; }
  .rf { background: #f1f3f5; color: #55606b; border-radius: 8px; padding: 6px 10px; font-size: 14px; }
  .items { flex: 1; overflow-y: auto; }
  .item { display: flex; gap: 10px; padding: 11px 14px; cursor: pointer; border-bottom: 1px solid #f4f5f7; align-items: center; }
  .item:hover { background: #f7f9fb; }
  .item.sel { background: #eef4fb; }
  .item.ho { background: #fff6e8; }
  .item.ho.sel { background: #ffefd6; }
  .av { width: 46px; height: 46px; border-radius: 50%; flex: none; background: #cfd8e3; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 19px; font-weight: 600; position: relative; overflow: visible; }
  .av img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
  .stdot { position: absolute; right: -3px; bottom: -3px; font-size: 14px; line-height: 1; filter: drop-shadow(0 0 1px #fff); }
  .icol { flex: 1; min-width: 0; }
  .irow1 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .iname { font-weight: 600; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .itime { font-size: 11px; color: #98a2ad; flex: none; }
  .ilast { font-size: 12.5px; color: #8a95a1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
  .ilast.hotxt { color: #d97706; font-weight: 600; }
  .side-note { padding: 9px 14px; border-top: 1px solid #eef0f2; font-size: 11px; color: #98a2ad; line-height: 1.7; }
  .empty { text-align: center; color: #98a2ad; padding: 40px 16px; font-size: 13.5px; line-height: 1.8; }

  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: #fff; }
  .chat-head { padding: 9px 16px; border-bottom: 1px solid #e3e6ea; display: none; align-items: center; gap: 11px; background: #fff; }
  .chat-head.on { display: flex; }
  .backbtn { display: none; background: none; font-size: 24px; color: #55606b; padding: 0 6px 2px 0; }
  .av.s { width: 38px; height: 38px; font-size: 16px; }
  .hinfo { flex: 1; min-width: 0; }
  .hname { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hstat { font-size: 11.5px; margin-top: 2px; display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { border-radius: 99px; padding: 1.5px 9px; font-size: 11px; font-weight: 600; }
  .pill.g { background: #e6f9ee; color: #0a9a4a; }
  .pill.r { background: #fdebec; color: #d33a41; }
  .pill.o { background: #fff1dd; color: #d97706; }
  .tgl { border-radius: 9px; padding: 9px 14px; font-size: 13px; font-weight: 700; flex: none; }
  .tgl.stop { background: #fdebec; color: #d33a41; }
  .tgl.start { background: #06c755; color: #fff; }
  .msgs { flex: 1; overflow-y: auto; padding: 18px 18px 24px; background: #fff; }
  .day { text-align: center; margin: 6px 0 14px; }
  .day span { background: #eef0f3; color: #8a95a1; font-size: 11px; border-radius: 99px; padding: 3px 12px; }
  .mrow { display: flex; margin-bottom: 13px; gap: 8px; align-items: flex-end; }
  .mrow.user { justify-content: flex-start; }
  .mrow.bot { justify-content: flex-end; }
  .mav { width: 30px; height: 30px; border-radius: 50%; background: #cfd8e3; color: #fff; flex: none; display: flex; align-items: center; justify-content: center; font-size: 13px; overflow: hidden; }
  .mav img { width: 100%; height: 100%; object-fit: cover; }
  .bub { max-width: 62%; padding: 9px 13px; border-radius: 15px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .user .bub { background: #f1f2f4; border-top-left-radius: 4px; }
  .bot .bub { background: #cce4ff; border-top-right-radius: 4px; }
  .mtime { font-size: 10.5px; color: #98a2ad; flex: none; padding-bottom: 2px; }
  .bot .bub.ab { background: #d4f5dd; }
  .chat-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #b3bcc5; gap: 10px; }
  .chat-empty .big { font-size: 44px; }
  .composer { display: none; gap: 8px; padding: 10px 14px; border-top: 1px solid #e3e6ea; background: #fff; align-items: flex-end; }
  .composer.on { display: flex; }
  .composer textarea { flex: 1; resize: none; border: 1px solid #d8dde3; border-radius: 18px; padding: 9px 14px; font-size: 14px; font-family: inherit; line-height: 1.45; max-height: 110px; background: #fff; color: #1f2329; outline: none; }
  .composer textarea:focus { border-color: #06c755; }
  .sendbtn { background: #06c755; color: #fff; border-radius: 50%; width: 40px; height: 40px; font-size: 17px; flex: none; }
  .sendbtn:disabled { opacity: .45; cursor: default; }

  @media (max-width: 760px) {
    .app.on { display: block; }
    .side { width: 100%; height: 100dvh; }
    .main { position: fixed; inset: 0; background: #fff; transform: translateX(102%); transition: transform .18s ease; z-index: 5; }
    .main.show { transform: none; }
    .backbtn { display: block; }
    .bub { max-width: 78%; }
  }
</style>
</head>
<body>

<div id="login" class="login-wrap">
  <div class="login-card">
    <div class="logo">🤖</div>
    <h1>น้องลัดดา — ควบคุมบอทรายแชท</h1>
    <div class="sub">ใส่รหัสแอดมิน (ADMIN_KEY) เพื่อเข้าใช้งาน</div>
    <input id="key" type="password" placeholder="รหัสแอดมิน" autocomplete="current-password">
    <button class="go" id="loginbtn">เข้าสู่ระบบ</button>
    <div id="err"></div>
  </div>
</div>

<div id="app" class="app">
  <div class="side">
    <div class="side-head">
      <b>แชท<span class="cnt" id="count">0</span><span class="live off" id="live">● กำลังเชื่อมต่อ…</span></b>
      <button class="rf" id="refreshbtn">⟳</button>
    </div>
    <div class="items" id="items"></div>
    <div class="side-note"><span id="ps"></span>🙋 ส้ม = ลูกค้าขอแอดมิน · 🔇 = บอทหยุดอยู่ · ลูกค้าพิมพ์ "คุยกับแอดมิน" บอทหยุด <span id="mm"></span> นาที / "คุยกับบอท" บอทกลับมา · พิมพ์ตอบจากหน้านี้ = ส่งในนามน้องลัดดา (ใช้โควต้า Push ของ LINE OA)</div>
  </div>
  <div class="main" id="main">
    <div class="chat-head" id="chead">
      <button class="backbtn" id="backbtn">‹</button>
      <div class="av s" id="hav">👤</div>
      <div class="hinfo">
        <div class="hname" id="hname"></div>
        <div class="hstat" id="hstat"></div>
      </div>
      <button class="tgl stop" id="tglbtn"></button>
    </div>
    <div class="msgs" id="msgs">
      <div class="chat-empty"><div class="big">💬</div><div>เลือกแชทจากรายการด้านซ้าย<br>เพื่อดูบทสนทนาและควบคุมบอท</div></div>
    </div>
    <div class="composer" id="composer">
      <textarea id="ta" rows="1" placeholder="พิมพ์ตอบลูกค้าในนามน้องลัดดา… (Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่)"></textarea>
      <button class="sendbtn" id="sendbtn" title="ส่ง">➤</button>
    </div>
  </div>
</div>

<script>
var KEY = sessionStorage.getItem('nladda_key') || '';
var timer = null;
var sel = null;
var cache = [];
var es = null;
var esRetry = null;
var COLORS = ['#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1'];

function esc(s) { return String(s || '').replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

function colorOf(id) {
  var n = 0;
  for (var i = 0; i < id.length; i++) n = (n + id.charCodeAt(i)) % COLORS.length;
  return COLORS[n];
}

function hhmm(t) { return new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }).replace(':', '.') + ' น.'; }

function listTime(t) {
  if (!t) return '';
  var d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm(t);
  var y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'เมื่อวาน';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

function dayLabel(t) {
  var d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'วันนี้';
  var y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'เมื่อวาน';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

function avatarHtml(s, cls) {
  var inner;
  if (s.type === 'group') inner = '👥';
  else if (s.pic) inner = '<img src="' + esc(s.pic) + '" alt="">';
  else {
    var ch = (s.name && s.name !== '…') ? s.name.trim().charAt(0) : '👤';
    inner = esc(ch);
  }
  var bg = (s.pic || s.type === 'group') ? '' : ' style="background:' + colorOf(s.id) + '"';
  return '<div class="av ' + (cls || '') + '"' + bg + '>' + inner + '</div>';
}

function dispName(s) { return (s.name && s.name !== '…') ? s.name : (s.id.slice(0, 10) + '…'); }

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

function setLive(on) {
  var el = document.getElementById('live');
  if (on) { el.className = 'live'; el.textContent = '● เรียลไทม์'; }
  else { el.className = 'live off'; el.textContent = '● กำลังเชื่อมต่อ…'; }
}

function connectStream() {
  if (es) return;
  api('/admin/api/token', { method: 'POST' }).then(function(d) {
    if (es) return;
    es = new EventSource('/admin/api/stream?t=' + encodeURIComponent(d.token));
    es.onopen = function() { setLive(true); };
    es.onmessage = function() { load(); };
    es.onerror = function() {
      setLive(false);
      try { es.close(); } catch (e) {}
      es = null;
      if (!esRetry) esRetry = setTimeout(function() { esRetry = null; connectStream(); }, 5000);
    };
  }).catch(function() {
    if (!esRetry) esRetry = setTimeout(function() { esRetry = null; connectStream(); }, 8000);
  });
}

function load(fromLogin) {
  if (!KEY) return;
  api('/admin/api/list').then(function(d) {
    sessionStorage.setItem('nladda_key', KEY);
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').classList.add('on');
    document.getElementById('mm').textContent = d.muteMinutes;
    document.getElementById('ps').innerHTML = d.persist
      ? '💾 เก็บแชทถาวร: <b style="color:#0a9a4a">เปิด</b> · '
      : '💾 เก็บแชทถาวร: <b style="color:#d33a41">ปิด</b> (ต่อ Volume ที่ /data ใน Railway) · ';
    cache = d.sessions;
    renderList();
    if (sel) { renderHead(); fetchHist(sel); }
    if (!timer) timer = setInterval(load, 20000);
    connectStream();
  }).catch(function(e) {
    if (fromLogin) { var el = document.getElementById('err'); el.style.display = 'block'; el.textContent = e.message; }
    sessionStorage.removeItem('nladda_key');
  });
}

function findSel() {
  for (var i = 0; i < cache.length; i++) if (cache[i].id === sel) return cache[i];
  return null;
}

function renderList() {
  var now = Date.now();
  document.getElementById('count').textContent = cache.length;
  if (!cache.length) {
    document.getElementById('items').innerHTML = '<div class="empty">ยังไม่มีแชทเข้ามา<br>เมื่อลูกค้าทักไลน์จะเด้งขึ้นที่นี่เอง</div>';
    return;
  }
  var h = '';
  for (var i = 0; i < cache.length; i++) {
    var s = cache[i];
    var muted = s.mutedUntil > now;
    var isHo = muted && s.handoff;
    var dot = muted ? '<span class="stdot">' + (isHo ? '🙋' : '🔇') + '</span>' : '';
    var av = avatarHtml(s, '').replace('</div>', dot + '</div>');
    h += '<div class="item' + (s.id === sel ? ' sel' : '') + (isHo ? ' ho' : '') + '" data-id="' + s.id + '">'
      + av
      + '<div class="icol">'
      + '<div class="irow1"><span class="iname">' + esc(dispName(s)) + '</span><span class="itime">' + listTime(s.lastAt) + '</span></div>'
      + '<div class="ilast' + (isHo ? ' hotxt' : '') + '">' + (isHo ? '🙋 ขอคุยกับแอดมิน · ' : '') + esc(s.lastText || '-') + '</div>'
      + '</div></div>';
  }
  document.getElementById('items').innerHTML = h;
}

function renderHead() {
  var s = findSel();
  if (!s) return;
  var now = Date.now();
  var muted = s.mutedUntil > now;
  var forever = s.mutedUntil >= 8000000000000000;
  document.getElementById('chead').classList.add('on');
  document.getElementById('hav').outerHTML = avatarHtml(s, 's').replace('class="av "', 'class="av s"');
  document.querySelector('#chead .av').id = 'hav';
  document.getElementById('hname').textContent = dispName(s);
  var st = muted
    ? '<span class="pill r">🔇 ' + (forever ? 'บอทหยุดอยู่ · แอดมินตอบ' : 'หยุดถึง ' + hhmm(s.mutedUntil)) + '</span>'
    : '<span class="pill g">🔊 บอทตอบอัตโนมัติ</span>';
  if (muted && s.handoff) st += '<span class="pill o">🙋 ลูกค้าขอแอดมิน</span>';
  document.getElementById('hstat').innerHTML = st;
  var b = document.getElementById('tglbtn');
  if (muted) { b.className = 'tgl start'; b.textContent = '▶ เปิดบอทตอบต่อ'; b.dataset.m = '0'; }
  else { b.className = 'tgl stop'; b.textContent = '⏸ หยุดบอท ตอบเอง'; b.dataset.m = '-1'; }
}

function fetchHist(id) {
  api('/admin/api/history?id=' + encodeURIComponent(id)).then(function(d) {
    if (id !== sel) return;
    var el = document.getElementById('msgs');
    var s = findSel() || { pic: '', name: '', id: id, type: 'user' };
    if (!d.history.length) {
      el.innerHTML = '<div class="chat-empty"><div class="big">🕐</div><div>ยังไม่มีข้อความ</div></div>';
      return;
    }
    var h = '';
    var lastDay = '';
    for (var i = 0; i < d.history.length; i++) {
      var m = d.history[i];
      var dl = dayLabel(m.at);
      if (dl !== lastDay) { h += '<div class="day"><span>' + dl + '</span></div>'; lastDay = dl; }
      if (m.r === 'u') {
        var mav = s.pic ? '<img src="' + esc(s.pic) + '" alt="">' : (s.type === 'group' ? '👥' : '👤');
        h += '<div class="mrow user"><div class="mav">' + mav + '</div><div class="bub">' + esc(m.t) + '</div><div class="mtime">' + hhmm(m.at) + '</div></div>';
      } else {
        var isAdm = m.r === 'a';
        h += '<div class="mrow bot"><div class="mtime">' + (isAdm ? '🧑‍💼 แอดมิน · ' : '🤖 ') + hhmm(m.at) + '</div><div class="bub' + (isAdm ? ' ab' : '') + '">' + esc(m.t) + '</div></div>';
      }
    }
    var atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    var wasFilled = el.dataset.for === id;
    el.innerHTML = h;
    if (!wasFilled || atBottom) el.scrollTop = el.scrollHeight;
    el.dataset.for = id;
  }).catch(function() {});
}

function selectChat(id) {
  sel = id;
  renderList();
  renderHead();
  document.getElementById('msgs').dataset.for = '';
  document.getElementById('msgs').innerHTML = '<div class="chat-empty"><div class="big">⏳</div></div>';
  document.getElementById('composer').classList.add('on');
  fetchHist(id);
  document.getElementById('main').classList.add('show');
}

var sending = false;
function autoGrow() {
  var ta = document.getElementById('ta');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
}
function doSend() {
  var ta = document.getElementById('ta');
  var btn = document.getElementById('sendbtn');
  var t = ta.value.trim();
  if (!t || !sel || sending) return;
  sending = true;
  btn.disabled = true;
  api('/admin/api/send', { method: 'POST', body: JSON.stringify({ id: sel, text: t }) })
    .then(function() {
      ta.value = '';
      autoGrow();
      sending = false;
      btn.disabled = false;
      ta.focus();
      fetchHist(sel);
      load();
    })
    .catch(function() {
      sending = false;
      btn.disabled = false;
      alert('ส่งไม่สำเร็จ — เช็คโควต้า Push รายเดือนของ LINE OA หรือ token');
    });
}

document.getElementById('loginbtn').addEventListener('click', login);
document.getElementById('key').addEventListener('keydown', function(e) { if (e.key === 'Enter') login(); });
document.getElementById('refreshbtn').addEventListener('click', function() { load(); });
document.getElementById('backbtn').addEventListener('click', function() { document.getElementById('main').classList.remove('show'); });

document.getElementById('items').addEventListener('click', function(e) {
  var it = e.target.closest('.item');
  if (it) selectChat(it.getAttribute('data-id'));
});

document.getElementById('tglbtn').addEventListener('click', function() {
  if (!sel) return;
  var m = parseInt(this.dataset.m, 10);
  api('/admin/api/mute', { method: 'POST', body: JSON.stringify({ id: sel, minutes: m }) })
    .then(function() { load(); })
    .catch(function(e) { alert(e.message); });
});

document.getElementById('sendbtn').addEventListener('click', doSend);
document.getElementById('ta').addEventListener('input', autoGrow);
document.getElementById('ta').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
});

if (KEY) load();
</script>
</body>
</html>`;

function adminAuthed(req) {
  if (!ADMIN_KEY) return null;
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
  // SSE stream ใช้ token (EventSource ตั้ง header เองไม่ได้)
  if (path === '/admin/api/stream' && req.method === 'GET') {
    const t = new URL(req.url, 'http://x').searchParams.get('t') || '';
    const exp = sseTokens.get(t);
    if (!exp || exp < Date.now()) return sendJson(res, 401, { ok: false, error: 'bad token' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  const authed = adminAuthed(req);
  if (authed === null) return sendJson(res, 503, { ok: false, error: 'ADMIN_KEY not set' });
  if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  if (path === '/admin/api/token' && req.method === 'POST') {
    const token = crypto.randomBytes(16).toString('hex');
    sseTokens.set(token, Date.now() + 24 * 3600000);
    if (sseTokens.size > 50) {
      const oldest = sseTokens.keys().next().value;
      sseTokens.delete(oldest);
    }
    return sendJson(res, 200, { ok: true, token });
  }

  if (path === '/admin/api/list' && req.method === 'GET') {
    const list = [...sessions.entries()]
      .map(([id, s]) => ({ id, name: s.name, pic: s.pic, type: s.type, lastText: s.lastText, lastAt: s.lastAt, mutedUntil: s.mutedUntil, handoff: !!s.handoff }))
      .sort((a, b) => ((b.handoff && b.mutedUntil > Date.now()) ? 1 : 0) - ((a.handoff && a.mutedUntil > Date.now()) ? 1 : 0) || b.lastAt - a.lastAt)
      .slice(0, 100);
    return sendJson(res, 200, { ok: true, muteMinutes: MUTE_MINUTES, persist: persistOK, now: Date.now(), sessions: list });
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
    if (m === 0) { s.mutedUntil = 0; s.handoff = false; }
    else if (m === -1) s.mutedUntil = FOREVER;
    else if (typeof m === 'number' && m > 0) s.mutedUntil = Date.now() + m * 60000;
    else s.mutedUntil = Date.now() + MUTE_MINUTES * 60000;
    markDirty();
    broadcast();
    console.log(`[admin] ${id.slice(0, 8)} mutedUntil=${s.mutedUntil}`);
    return sendJson(res, 200, { ok: true, id, mutedUntil: s.mutedUntil, handoff: !!s.handoff });
  }

  // แอดมินส่งข้อความหาลูกค้าในนาม OA (ใช้ Push API — กินโควต้ารายเดือน)
  if (path === '/admin/api/send' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    const text = String(data.text || '').trim().slice(0, 4900);
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    if (!text) return sendJson(res, 400, { ok: false, error: 'empty text' });
    const s = sessions.get(id);
    linePush(id, text).then((ok) => {
      if (ok) {
        pushHist(s, 'a', text);
        s.lastText = text.slice(0, 120);
        s.lastAt = Date.now();
        markDirty();
        broadcast();
        console.log(`[admin-send] ${id.slice(0, 8)} len=${text.length}`);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 502, { ok: false, error: 'push failed' });
    }).catch(() => sendJson(res, 502, { ok: false, error: 'push failed' }));
    return;
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

// ---------- Server ----------
const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && path === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(ADMIN_HTML);
  }

  if (path.startsWith('/admin/api/')) {
    if (req.method === 'GET') return handleAdmin(req, res, path, Buffer.alloc(0));
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handleAdmin(req, res, path, Buffer.concat(chunks)));
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'line-dify-bridge', version: 2.6, persist: persistOK, ts: Date.now() }));
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end('Not found'); }

  // LINE webhook
  let chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    const sig = req.headers['x-line-signature'] || '';
    const expected = crypto.createHmac('sha256', CH_SECRET).update(body).digest('base64');
    let valid = false;
    try { valid = sig.length > 0 && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch (_) {}
    if (!valid) { res.writeHead(401); return res.end('Invalid signature'); }

    res.writeHead(200); res.end('OK');

    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) { return; }
    (data.events || []).forEach((ev) => {
      handleEvent(ev).catch((e) => console.log('event error:', e.message));
    });
  });
});

initPersist();
setTimeout(bootBackfill, 3000);
server.listen(PORT, () => console.log(`line-dify-bridge v2.6 (backfill+send+persist=${persistOK}+SSE) running on port ${PORT}`));
