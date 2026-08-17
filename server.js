// ============================================================
// LINE OA <-> Dify Bridge (Node.js สำหรับ Railway) — v2.9
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
//  8. v2.8: ธง "📞 รอติดต่อกลับ" ในหน้าแอดมิน — ติดให้เองเมื่อ
//     (ก) บอทรับปากลูกค้าว่าจะให้เจ้าหน้าที่/แอดมินติดต่อกลับ หรือส่งเรื่องต่อให้แล้ว
//     (ข) ลูกค้าทิ้งเบอร์โทรไว้ในแชท (เก็บชื่อ+เบอร์โชว์ให้แอดมินเลย)
//     (ค) ลูกค้าพิมพ์ขอคุยกับแอดมิน
//     แชทที่รอติดต่อกลับเด้งขึ้นบนสุด (พื้นแดง) แอดมินกด "✓ ติดต่อแล้ว" เมื่อจัดการเสร็จ
//     + แจ้งเตือนเข้า LINE แอดมินได้ (ตั้ง ADMIN_NOTIFY_IDS) และแสดงจำนวนใน title หน้าเว็บ
//  9. v2.9: CRM-lite ในหน้าแอดมิน — ปุ่ม 👤 โปรไฟล์ ในแต่ละแชท: ชื่อจริง เบอร์ จังหวัด/อำเภอ พืชที่ปลูก
//     จำนวนไร่ ร้านที่ซื้อประจำ สถานะ (ใหม่/สนใจ/เสนอราคา/ซื้อแล้ว/เงียบ) แท็ก โน้ต + บันทึกการติดตาม
//     ระบบเติมให้เองจากแชท: เบอร์ จังหวัด พืชที่พูดถึง + โชว์ผู้ดูแลเขต ME/MR ตามจังหวัด
//     ช่องค้นหาในลิสต์ (ชื่อ/เบอร์/แท็ก/จังหวัด) + ส่งออก CSV เปิดใน Excel
//     เก็บใน Supabase ถ้าตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY (ตาราง crm_customers, crm_notes)
//     ไม่ตั้งก็ทำงานได้ โดยเก็บใน state file บน Volume
// 10. ไม่ใช้ dependency ใดๆ (Node built-in ล้วน)
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
//  ADMIN_NOTIFY_IDS           (ไม่บังคับ) LINE userId ของแอดมิน คั่นด้วย , — เมื่อมีลูกค้า
//                             รอติดต่อกลับ ระบบจะ Push แจ้งเตือนเข้า LINE แอดมินทันที
//                             (ใช้โควต้า Push 1 ข้อความ/คน/ครั้ง) ดู userId ตัวเองได้จากหน้า /admin
//  SUPABASE_URL               (ไม่บังคับ) https://xxxx.supabase.co  — เปิดใช้ CRM บน Supabase
//  SUPABASE_SERVICE_KEY       (ไม่บังคับ) service_role key ของโปรเจกต์ (เก็บฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามใส่ในหน้าเว็บ)
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
const RAILWAY_VOL = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const STATE_DIR = process.env.STATE_DIR || RAILWAY_VOL || '/data';
const HAS_VOLUME = !!RAILWAY_VOL && STATE_DIR.startsWith(RAILWAY_VOL); // ถาวรจริงเฉพาะเมื่อ Railway Attach Volume แล้ว (Railway ตั้ง RAILWAY_VOLUME_MOUNT_PATH ให้เอง) และ STATE_DIR ชี้เข้า Volume นั้น
const DIFY_BASE = 'https://api.dify.ai/v1';
const FOREVER = 8640000000000000;
const HIST_MAX = 200;
const ADMIN_NOTIFY_IDS = (process.env.ADMIN_NOTIFY_IDS || '').split(/[\s,]+/).filter((x) => /^U[0-9a-f]{32}$/.test(x));
const PUBLIC_URL = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '');
// CRM: เชื่อม Supabase (ถ้าตั้งค่า) ไม่งั้นเก็บใน state file บน Volume
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const SB_ON = !!(SB_URL && SB_KEY);

// ---------- ทะเบียนแชท + สถานะ + ประวัติ ----------
const sessions = new Map(); // id -> {name,pic,type,lastText,lastAt,mutedUntil,handoff,history,bf,cb,cbDone,cbCount}
// cb = { at, src:'bot'|'phone'|'kw'|'admin', topic, contact, note }  ธง "รอติดต่อกลับ" (null = ไม่มี)
const crm = new Map();      // line_user_id -> โปรไฟล์ CRM (real_name, phone, province, district, crops, farm_rai, shop, status, tags[], note, auto{}, first_seen_at, last_chat_at, updated_at)
const crmNotes = new Map(); // line_user_id -> [{id, text, by_admin, created_at}] (บันทึกการติดตาม) — ใช้เมื่อไม่มี Supabase หรือเป็นแคช

// ---------- Persistence (เก็บถาวรลงดิสก์ ถ้ามี Volume) ----------
const STATE_FILE = pathmod.join(STATE_DIR, 'nladda-state.json');
let canWrite = false;   // เขียนดิสก์ได้ (เซฟกันแครชได้ แต่ redeploy อาจหาย)
let persistOK = false;  // ถาวรจริง = เขียนได้ + มี Volume ต่ออยู่จริง
let dirty = false;
let saveTimer = null;

function initPersist() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(pathmod.join(STATE_DIR, '.write-test'), 'ok');
    fs.unlinkSync(pathmod.join(STATE_DIR, '.write-test'));
    canWrite = true;
  } catch (e) {
    canWrite = false;
    console.log(`[persist] เขียน ${STATE_DIR} ไม่ได้ (${e.code})`);
  }
  persistOK = canWrite && HAS_VOLUME;
  if (!persistOK) {
    console.log(`[persist] NOT PERMANENT — ${canWrite ? 'ยังไม่ได้ Attach Volume ใน Railway (คลิกขวาที่ service -> Attach Volume)' : 'ดิสก์เขียนไม่ได้'} — แชทจะหายเมื่อ redeploy`);
  } else {
    console.log(`[persist] ON — volume at ${STATE_DIR}`);
  }
  if (!canWrite) return;
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
            history: s.history.slice(-HIST_MAX), bf: !!s.bf,
            cb: (s.cb && typeof s.cb === 'object') ? s.cb : null,
            cbDone: (s.cbDone && typeof s.cbDone === 'object') ? s.cbDone : null,
            cbCount: s.cbCount || 0
          });
        }
        console.log(`[persist] loaded ${sessions.size} chats from disk`);
      }
      if (raw && Array.isArray(raw.crm)) {
        for (const [id, c] of raw.crm) if (id && c && typeof c === 'object') crm.set(id, c);
        console.log(`[persist] loaded ${crm.size} CRM profiles from disk`);
      }
      if (raw && Array.isArray(raw.crmNotes)) {
        for (const [id, arr] of raw.crmNotes) if (id && Array.isArray(arr)) crmNotes.set(id, arr.slice(-200));
      }
    }
  } catch (e) { console.log('[persist] load error:', e.message); }
}

function stateJson() {
  return JSON.stringify({ v: 2, savedAt: Date.now(), sessions: [...sessions.entries()], crm: [...crm.entries()], crmNotes: [...crmNotes.entries()] });
}

function saveNow() {
  if (!canWrite || !dirty) return;
  dirty = false;
  const data = stateJson();
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
    if (canWrite && dirty) {
      fs.writeFileSync(STATE_FILE, stateJson());
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
    s = { name: '', pic: '', type, lastText: '', lastAt: 0, mutedUntil: 0, handoff: false, history: [], bf: false, cb: null, cbDone: null, cbCount: 0 };
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
      if (crm.has(userId)) crmTouch(userId, s, ''); // ชื่อ LINE มาทีหลัง -> อัปเดตใน CRM
    } else { s.name = ''; }
  }).catch(() => { s.name = ''; });
}

// ---------- HTTP helper ----------
function request(method, url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttp = u.protocol === 'http:';
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttp ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        body ? { 'Content-Length': Buffer.byteLength(body) } : {},
        headers || {}
      ),
      timeout: 180000
    };
    const req = (isHttp ? http : https).request(opts, (res) => {
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
      sessions.set(id, { name: '', pic: '', type: 'user', lastText: '', lastAt: 0, mutedUntil: 0, handoff: false, history: [], bf: false, cb: null, cbDone: null, cbCount: 0 });
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
  if (process.env.FAKE_DIFY_ANSWER) return process.env.FAKE_DIFY_ANSWER; // สำหรับเทสอัตโนมัติเท่านั้น
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

// ---------- CRM-lite (โปรไฟล์ลูกค้า + แท็ก + โน้ต) : Supabase หรือ state file ----------
const CRM_FIELDS = ['real_name', 'phone', 'province', 'district', 'crops', 'farm_rai', 'shop', 'status', 'tags', 'note'];
const CRM_STATUS = ['new', 'interested', 'quoted', 'customer', 'inactive'];
// จังหวัด -> เขตขาย (จากไฟล์ทีมขาย ME/MR) เพื่อโชว์ผู้ดูแลเขตในโปรไฟล์
const ZONE_OF = {};
[['A01', 'แม่ฮ่องสอน เชียงใหม่ เชียงราย ลำพูน ลำปาง พะเยา ตาก แพร่ น่าน'],
 ['A02', 'นครสวรรค์ พิจิตร พิษณุโลก กำแพงเพชร'],
 ['A03', 'สุพรรณบุรี อ่างทอง ชัยนาท กาญจนบุรี สิงห์บุรี'],
 ['A04', 'นครปฐม ราชบุรี เพชรบุรี นนทบุรี ปทุมธานี สมุทรสาคร สมุทรสงคราม สมุทรปราการ'],
 ['A05', 'ลพบุรี พระนครศรีอยุธยา อยุธยา สระบุรี เพชรบูรณ์'],
 ['A06', 'ประจวบคีรีขันธ์ ชุมพร สุราษฎร์ธานี ระนอง'],
 ['A07', 'นครศรีธรรมราช กระบี่ ภูเก็ต พังงา สตูล ตรัง พัทลุง สงขลา ปัตตานี ยะลา นราธิวาส'],
 ['A08', 'นครราชสีมา โคราช ชัยภูมิ บุรีรัมย์ สุรินทร์ ศรีสะเกษ อุบลราชธานี ยโสธร อำนาจเจริญ ร้อยเอ็ด มหาสารคาม ขอนแก่น กาฬสินธุ์ มุกดาหาร นครพนม สกลนคร อุดรธานี หนองคาย บึงกาฬ หนองบัวลำภู เลย'],
 ['A09', 'ระยอง จันทบุรี ตราด'],
 ['A10', 'ฉะเชิงเทรา ชลบุรี ปราจีนบุรี สระแก้ว นครนายก']].forEach(([z, ps]) => ps.split(' ').forEach((p) => { ZONE_OF[p] = z; }));
const ZONE_TEAM = {
  A01: 'ME กมล ยศอิ (ขนุน) 092-4245391 · MR จิติมา เรืองเพชร (แอ๋ว) 063-2059085',
  A02: 'ME ปทิตตา จันทร์กลิ่น (ผึ้ง) 063-2059071 · MR ศิริพร มณีสวัสดิ์ (แนทตี้) 063-2059072',
  A03: 'ME ดุสิตา จำปาสัก (มุก) 063-2059073 · MR ปนัดภร ไชยสุพัฒน์ (ปาว) 065-9642342',
  A04: 'ME อชิรญาณ์ เวฬุวนารักษ์ (ปอนด์) 063-2059076 · MR พุทธิตา พงษ์ไผ่ขำ (แป้ง) 082-1121691',
  A05: 'ME สุกัญญา ชูประสูติ (เล็ก) 065-5255687 · MR อัฐภิญญา พิมรินทร์ (แพน) 080-0430967',
  A06: 'ME วิลาสินี ขวัญเมือง (เมย์) 063-2059079 · MR ประภัศพรรณ (น้ำหวาน) 063-2059093 / ณัฐวัฒน์ (ไตเติ้ล) 063-2059077 / ภาวินี (เนส) 098-2863444',
  A07: 'ME ชนาภัทร พลูหนัง (อ้อม) 061-2692590 · MR ศตวรรษ (เจมส์) 092-2478766 / ษศกร (โลมา) 065-1193314',
  A08: 'ME ออมสิน เนาว์ประเสริฐ (ก้ง) 063-2059058 · MR วัชรพงศ์ พิลุณร์ (แทนไท) 063-2059078',
  A09: 'ME สุชาดา ราชคม (โบว์) 098-8326952 · MR กัญญารัตน์ (นุ้ย) 080-0430977 / ศิรินาฏ (ปังหวาน) 063-2059082 / ภาณุพงศ์ (ท็อป) 063-2284037 / กาญจนาพร (ลูกเจี๊ยบ) 065-5255690',
  A10: 'ME พิรยา สินสุวรรณ์ (แป้ง) 063-2059063 · MR สุประวีณ์ บุญมี (ปอ) 063-2059068'
};
const PROVINCE_RX = new RegExp('(' + Object.keys(ZONE_OF).sort((a, b) => b.length - a.length).join('|') + ')');
const CROP_WORDS = ['ทุเรียน', 'นาข้าว', 'ข้าวโพด', 'ข้าว', 'ลำไย', 'มะม่วง', 'ส้ม', 'อ้อย', 'มันสำปะหลัง', 'มัน', 'ปาล์ม', 'ยางพารา', 'พริก', 'หอม', 'กระเทียม', 'คะน้า', 'ผัก', 'มะเขือ', 'ถั่วฝักยาว', 'มังคุด', 'เงาะ', 'ลองกอง', 'กาแฟ', 'มะพร้าว', 'แตง'];

function zoneInfo(province) {
  const m = PROVINCE_RX.exec(province || '');
  const z = m ? ZONE_OF[m[1]] : '';
  return z ? { zone: z, team: ZONE_TEAM[z] } : null;
}

async function sb(method, path, body, extraHeaders) {
  const headers = Object.assign({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, extraHeaders || {});
  return request(method, SB_URL + '/rest/v1' + path, headers, body);
}

function crmGet(id) {
  let c = crm.get(id);
  if (!c) {
    const s = sessions.get(id);
    c = { line_user_id: id, display_name: s ? s.name : '', picture_url: s ? s.pic : '', real_name: '', phone: '', province: '', district: '', crops: '', farm_rai: null, shop: '', status: 'new', tags: [], note: '', auto: {}, first_seen_at: new Date().toISOString(), last_chat_at: null, updated_at: new Date().toISOString() };
    crm.set(id, c);
    markDirty();
    if (SB_ON) sbUpsert(c);
  }
  return c;
}

let sbErrLogged = 0;
function sbUpsert(c) {
  if (!SB_ON) return Promise.resolve(false);
  const row = Object.assign({}, c, { tags: Array.isArray(c.tags) ? c.tags : [], updated_at: new Date().toISOString() });
  return sb('POST', '/crm_customers?on_conflict=line_user_id', [row], { Prefer: 'resolution=merge-duplicates,return=minimal' })
    .then((r) => {
      if (r.status >= 300) { if (sbErrLogged++ < 5) console.log('[crm] supabase upsert failed:', r.status, JSON.stringify(r.data).slice(0, 200)); return false; }
      return true;
    }).catch((e) => { if (sbErrLogged++ < 5) console.log('[crm] supabase error:', e.message); return false; });
}

async function crmLoadFromSupabase() {
  if (!SB_ON) return;
  try {
    let from = 0, total = 0;
    while (true) {
      const r = await sb('GET', '/crm_customers?select=*&order=updated_at.desc', null, { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' });
      if (r.status >= 300 || !Array.isArray(r.data)) { console.log('[crm] supabase load failed:', r.status, JSON.stringify(r.data).slice(0, 200)); return; }
      for (const row of r.data) {
        if (!row.line_user_id) continue;
        const local = crm.get(row.line_user_id);
        // Supabase เป็นแหล่งจริง แต่ถ้าเครื่องมีข้อมูลใหม่กว่า (แก้ตอน Supabase ล่ม) ให้ดันขึ้นแทน
        if (local && local.updated_at && row.updated_at && local.updated_at > row.updated_at) { sbUpsert(local); continue; }
        crm.set(row.line_user_id, Object.assign({}, row, { tags: Array.isArray(row.tags) ? row.tags : [], auto: row.auto || {} }));
      }
      total += r.data.length;
      if (r.data.length < 1000) break;
      from += 1000;
    }
    console.log(`[crm] loaded ${total} profiles from Supabase`);
    markDirty();
  } catch (e) { console.log('[crm] supabase load error:', e.message); }
}

// อัปเดตข้อมูลอัตโนมัติจากแชท (ชื่อ LINE, เวลาแชทล่าสุด, เบอร์/จังหวัด/พืชที่ลูกค้าพิมพ์)
function crmTouch(id, s, userText) {
  if (!id || id === 'unknown' || (s && s.type !== 'user')) return;
  const c = crmGet(id);
  let changed = false;
  if (s && s.name && s.name !== '…' && c.display_name !== s.name) { c.display_name = s.name; c.picture_url = s.pic || ''; changed = true; }
  const nowIso = new Date().toISOString();
  if (!c.last_chat_at || (Date.now() - Date.parse(c.last_chat_at)) > 5 * 60000) { c.last_chat_at = nowIso; changed = true; }
  if (userText) {
    c.auto = c.auto || {};
    const pm = PHONE_RX.exec(userText);
    if (pm && c.auto.phone !== pm[0]) { c.auto.phone = pm[0]; if (!c.phone) c.phone = pm[0].replace(/[- ]/g, ''); changed = true; }
    const prm = PROVINCE_RX.exec(userText);
    if (prm && c.auto.province !== prm[1]) { c.auto.province = prm[1]; if (!c.province) c.province = prm[1]; changed = true; }
    const found = CROP_WORDS.filter((w) => userText.includes(w)).map((w) => (w === 'นาข้าว' ? 'ข้าว' : w === 'มัน' ? 'มันสำปะหลัง' : w));
    if (found.length) {
      const set = new Set((c.auto.crops || '').split(',').map((x) => x.trim()).filter(Boolean));
      const before = set.size;
      found.forEach((w) => set.add(w));
      if (set.size !== before) { c.auto.crops = [...set].slice(0, 12).join(','); changed = true; }
    }
  }
  if (changed) { c.updated_at = nowIso; markDirty(); if (SB_ON) sbUpsert(c); }
}

function crmUpdate(id, fields) {
  const c = crmGet(id);
  for (const k of CRM_FIELDS) {
    if (!(k in fields)) continue;
    let v = fields[k];
    if (k === 'tags') v = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : String(v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
    else if (k === 'farm_rai') { v = v === '' || v == null ? null : Number(v); if (v != null && !isFinite(v)) v = null; }
    else if (k === 'status') v = CRM_STATUS.includes(v) ? v : 'new';
    else v = String(v == null ? '' : v).slice(0, k === 'note' ? 2000 : 200);
    c[k] = v;
  }
  c.updated_at = new Date().toISOString();
  markDirty();
  broadcast();
  return SB_ON ? sbUpsert(c) : Promise.resolve(true);
}

async function crmAddNote(id, text) {
  crmGet(id);
  const note = { id: Date.now(), line_user_id: id, text: String(text).slice(0, 2000), by_admin: 'admin', created_at: new Date().toISOString() };
  if (SB_ON) {
    const r = await sb('POST', '/crm_notes', [{ line_user_id: id, text: note.text, by_admin: 'admin' }], { Prefer: 'return=representation' }).catch((e) => ({ status: 599, data: e.message }));
    if (r.status < 300 && Array.isArray(r.data) && r.data[0]) Object.assign(note, r.data[0]);
    else if (sbErrLogged++ < 5) console.log('[crm] note insert failed:', r.status, JSON.stringify(r.data).slice(0, 200));
  }
  const arr = crmNotes.get(id) || [];
  arr.push(note);
  crmNotes.set(id, arr.slice(-200));
  markDirty();
  return note;
}

async function crmListNotes(id) {
  if (SB_ON) {
    const r = await sb('GET', `/crm_notes?line_user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`).catch(() => ({ status: 599 }));
    if (r.status < 300 && Array.isArray(r.data)) { crmNotes.set(id, r.data.slice().reverse()); return r.data; }
  }
  return (crmNotes.get(id) || []).slice().reverse();
}

function crmSummary(id) {
  const c = crm.get(id);
  if (!c) return null;
  return { real_name: c.real_name || '', phone: c.phone || '', province: c.province || '', status: c.status || 'new', tags: c.tags || [], crops: c.crops || (c.auto && c.auto.crops) || '' };
}

function csvCell(v) {
  const s = v == null ? '' : (Array.isArray(v) ? v.join('|') : String(v));
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ---------- ธง "รอติดต่อกลับ" (callback) ----------
// (ก) บอทรับปาก: "ติดต่อกลับ / โทรกลับ / ส่งเรื่องให้…แล้ว / ประสาน…แล้ว / เจ้าหน้าที่จะรีบติดต่อ ฯลฯ"
const CB_BOT_RX = /ติดต่อกลับ|โทรกลับ|(ส่งเรื่อง|ส่งต่อ|ประสาน|แจ้ง|บันทึกข้อมูล)[^\n]{0,40}?(เรียบร้อย|ให้แล้ว|แล้วนะ|แล้วค่ะ|แล้วจ้ะ)|(เจ้าหน้าที่|ทีมงาน|แอดมิน|ฝ่ายขาย|พี่ ?ๆ|ผู้แทน)[^\n]{0,24}?จะ(รีบ)?(ติดต่อ|โทร|เข้ามา|ตอบ|ประสาน)/;
// (ข) ลูกค้าทิ้งเบอร์โทร (มือถือ 10 หลัก / บ้าน 9 หลัก มีหรือไม่มีขีด/ช่องว่างก็ได้)
const PHONE_RX = /(?<!\d)0\d{1,2}[- ]?\d{3}[- ]?\d{3,4}(?!\d)/;

function lastUserText(s) {
  for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].r === 'u') return s.history[i].t;
  return '';
}

function flagCallback(id, s, src, extra) {
  const isNew = !s.cb;
  if (isNew) {
    s.cb = { at: Date.now(), src, topic: String(lastUserText(s)).slice(0, 120), contact: '', note: '' };
    s.cbCount = (s.cbCount || 0) + 1;
  }
  if (extra && extra.note && !s.cb.note) s.cb.note = String(extra.note).slice(0, 160);
  if (extra && extra.contact) s.cb.contact = String(extra.contact).slice(0, 80);
  if (extra && extra.topic && !s.cb.topic) s.cb.topic = String(extra.topic).slice(0, 120);
  markDirty();
  broadcast();
  console.log(`[callback] ${id.slice(0, 8)} src=${src} new=${isNew} contact=${s.cb.contact ? 'yes' : 'no'}`);
  if (isNew || (extra && extra.contact)) notifyAdmins(id, s, isNew);
}

function clearCallback(s) {
  if (!s.cb) return;
  s.cbDone = Object.assign({}, s.cb, { doneAt: Date.now() });
  s.cb = null;
  markDirty();
  broadcast();
}

function detectBotPromise(id, s, text) {
  const m = CB_BOT_RX.exec(String(text || ''));
  if (!m) return;
  const i = Math.max(0, m.index - 40);
  flagCallback(id, s, 'bot', { note: String(text).slice(i, m.index + 80).replace(/\s+/g, ' ') });
}

function detectPhone(id, s, text) {
  const m = PHONE_RX.exec(String(text || ''));
  if (!m) return;
  flagCallback(id, s, 'phone', { contact: String(text).trim().slice(0, 80), topic: lastUserText(s) });
}

function notifyAdmins(id, s, isNew) {
  if (!ADMIN_NOTIFY_IDS.length) return;
  const name = (s.name && s.name !== '…') ? s.name : id.slice(0, 10) + '…';
  const msg = (isNew ? '🔔 ลูกค้ารอติดต่อกลับ' : '📞 ลูกค้าทิ้งเบอร์ติดต่อแล้ว')
    + `\nลูกค้า: ${name}`
    + (s.cb.topic ? `\nเรื่อง: ${s.cb.topic.slice(0, 100)}` : '')
    + (s.cb.contact ? `\nติดต่อ: ${s.cb.contact}` : '\nติดต่อ: (ยังไม่ได้ทิ้งเบอร์)')
    + (PUBLIC_URL ? `\nเปิดหน้าแอดมิน: ${PUBLIC_URL}/admin` : '');
  for (const to of ADMIN_NOTIFY_IDS) {
    if (to === id) continue;
    linePush(to, msg).catch(() => {});
  }
}

async function sendAnswer(s, ev, fallbackTo, text) {
  pushHist(s, 'b', text);
  detectBotPromise(fallbackTo || 'unknown', s, text);
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
  if (ev.message.type === 'text') detectPhone(sessionId, s, text); // ลูกค้าทิ้งเบอร์ -> ธงรอติดต่อกลับ + เก็บเบอร์
  if (stype === 'user') crmTouch(sessionId, s, ev.message.type === 'text' ? text : ''); // CRM: อัปเดตโปรไฟล์อัตโนมัติ
  // ลูกค้าเก่าทักครั้งแรกหลังระบบใหม่ -> ดึงประวัติเดิมจาก Dify ตามมาให้เอง
  if (isNewChat) setTimeout(() => backfillFromDify(sessionId, s).catch(() => {}), 50);

  const now = Date.now();

  if (s.mutedUntil && s.mutedUntil <= now) { s.mutedUntil = 0; s.handoff = false; markDirty(); broadcast(); }

  if (ev.message.type === 'text') {
    if (wantsBot(text)) {
      s.mutedUntil = 0;
      s.handoff = false;
      if (s.cb && s.cb.src === 'kw') clearCallback(s); // ลูกค้ากลับมาคุยกับบอทเอง = ไม่รอแอดมินแล้ว
      console.log(`[unmute-kw] ${sessionId.slice(0, 8)}`);
      await sendAnswer(s, ev, pushTarget, 'น้องลัดดากลับมาแล้วค่ะ 😊 สอบถามเรื่องสินค้าได้เลยนะคะ');
      return;
    }
    if (wantsAdmin(text)) {
      s.mutedUntil = now + MUTE_MINUTES * 60000;
      s.handoff = true;
      flagCallback(sessionId, s, 'kw', { note: 'ลูกค้าพิมพ์ขอคุยกับแอดมิน', topic: text });
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
  .item.cb { background: #fdeeee; }
  .item.cb.sel { background: #fadcdc; }
  .ilast.cbtxt { color: #c62828; font-weight: 600; }
  .cnt.red { background: #d33a41; }
  .cbbar { display: none; padding: 9px 16px; background: #fdeeee; border-bottom: 1px solid #f5c6c6; font-size: 12.5px; color: #8a1f24; line-height: 1.6; }
  .cbbar.on { display: block; }
  .cbbar b { color: #c62828; }
  .cbbtn { border-radius: 9px; padding: 9px 12px; font-size: 12.5px; font-weight: 700; flex: none; margin-right: 6px; }
  .cbbtn.done { background: #c62828; color: #fff; }
  .cbbtn.set { background: #f1f3f5; color: #55606b; }
  .srch { padding: 8px 12px; border-bottom: 1px solid #eef0f2; }
  .srch input { width: 100%; padding: 8px 12px; border: 1px solid #e3e6ea; border-radius: 10px; font-size: 13px; background: #f7f9fb; color: #1f2329; outline: none; }
  .srch input:focus { border-color: #06c755; background: #fff; }
  .itag { display: inline-block; font-size: 10px; border-radius: 6px; padding: 0 5px; margin-left: 4px; background: #eef4fb; color: #3b6db3; vertical-align: 1px; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .itag.st-customer { background: #e6f9ee; color: #0a9a4a; }
  .itag.st-quoted { background: #fff1dd; color: #d97706; }
  .itag.st-interested { background: #eef4fb; color: #3b6db3; }
  .itag.st-inactive { background: #f1f3f5; color: #98a2ad; }
  .crmbtn { border-radius: 9px; padding: 9px 12px; font-size: 12.5px; font-weight: 700; flex: none; margin-right: 6px; background: #eef4fb; color: #2f5fa3; }
  .crmbtn.on { background: #2f5fa3; color: #fff; }
  .body { flex: 1; min-height: 0; display: flex; }
  .msgs { flex: 1; overflow-y: auto; padding: 18px 18px 24px; background: #fff; }
  .crm { width: 330px; flex: none; border-left: 1px solid #e3e6ea; overflow-y: auto; background: #fbfcfd; display: none; padding: 12px 14px 20px; font-size: 12.5px; }
  .crm.on { display: block; }
  .crm h4 { font-size: 12px; color: #55606b; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: .3px; }
  .crm h4:first-child { margin-top: 0; }
  .crm label { display: block; font-size: 11px; color: #8a95a1; margin: 7px 0 2px; }
  .crm input, .crm select, .crm textarea { width: 100%; padding: 7px 9px; border: 1px solid #dfe3e8; border-radius: 8px; font-size: 13px; font-family: inherit; background: #fff; color: #1f2329; outline: none; }
  .crm input:focus, .crm select:focus, .crm textarea:focus { border-color: #06c755; }
  .crm textarea { resize: vertical; min-height: 56px; }
  .crm .row2 { display: flex; gap: 8px; }
  .crm .row2 > div { flex: 1; min-width: 0; }
  .crm .auto { background: #fff; border: 1px dashed #dfe3e8; border-radius: 8px; padding: 8px 10px; color: #55606b; line-height: 1.7; }
  .crm .auto b { color: #1f2329; }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
  .tag { background: #eef4fb; color: #2f5fa3; border-radius: 99px; padding: 2px 8px; font-size: 11.5px; cursor: pointer; border: 1px solid transparent; }
  .tag.on { background: #2f5fa3; color: #fff; }
  .tag.x::after { content: ' ✕'; opacity: .6; }
  .crm .savebtn { width: 100%; margin-top: 10px; padding: 9px; border-radius: 9px; background: #06c755; color: #fff; font-weight: 700; font-size: 13.5px; }
  .crm .savebtn:disabled { opacity: .5; }
  .crm .saved { font-size: 11px; color: #0a9a4a; margin-top: 4px; min-height: 14px; }
  .notes { margin-top: 6px; }
  .note { background: #fff; border: 1px solid #eef0f2; border-radius: 8px; padding: 6px 9px; margin-bottom: 6px; }
  .note .nt { font-size: 10.5px; color: #98a2ad; margin-bottom: 2px; }
  .noteadd { display: flex; gap: 6px; margin-top: 6px; }
  .noteadd input { flex: 1; }
  .noteadd button { border-radius: 8px; padding: 0 12px; background: #2f5fa3; color: #fff; font-weight: 700; }
  .exp { font-size: 11px; color: #3b6db3; cursor: pointer; text-decoration: underline; }
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
  .pill.cb { background: #fdebec; color: #c62828; }
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
    .crm { position: absolute; inset: 0; width: 100%; z-index: 6; }
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
      <b>แชท<span class="cnt" id="count">0</span><span class="cnt red" id="cbcount" style="display:none" title="ลูกค้ารอติดต่อกลับ">📞 0</span><span class="live off" id="live">● กำลังเชื่อมต่อ…</span></b>
      <button class="rf" id="refreshbtn">⟳</button>
    </div>
    <div class="srch"><input id="q" type="search" placeholder="🔍 ค้นหา ชื่อ / เบอร์ / แท็ก / จังหวัด / พืช"></div>
    <div class="items" id="items"></div>
    <div class="side-note"><span id="ps"></span><span id="sb"></span><span class="exp" id="expbtn">⬇ ส่งออก CRM เป็น CSV/Excel</span> · 📞 แดง = ลูกค้ารอติดต่อกลับ (บอทรับปากว่าจะให้เจ้าหน้าที่ติดต่อ / ลูกค้าทิ้งเบอร์) กด "✓ ติดต่อแล้ว" เมื่อจัดการเสร็จ · 🙋 ส้ม = ลูกค้าขอแอดมิน · 🔇 = บอทหยุดอยู่ · ลูกค้าพิมพ์ "คุยกับแอดมิน" บอทหยุด <span id="mm"></span> นาที / "คุยกับบอท" บอทกลับมา · พิมพ์ตอบจากหน้านี้ = ส่งในนามน้องลัดดา (ใช้โควต้า Push ของ LINE OA)<span id="nt"></span></div>
  </div>
  <div class="main" id="main">
    <div class="chat-head" id="chead">
      <button class="backbtn" id="backbtn">‹</button>
      <div class="av s" id="hav">👤</div>
      <div class="hinfo">
        <div class="hname" id="hname"></div>
        <div class="hstat" id="hstat"></div>
      </div>
      <button class="crmbtn" id="crmbtn">👤 โปรไฟล์</button>
      <button class="cbbtn set" id="cbbtn"></button>
      <button class="tgl stop" id="tglbtn"></button>
    </div>
    <div class="cbbar" id="cbbar"></div>
    <div class="body">
      <div class="msgs" id="msgs">
        <div class="chat-empty"><div class="big">💬</div><div>เลือกแชทจากรายการด้านซ้าย<br>เพื่อดูบทสนทนาและควบคุมบอท</div></div>
      </div>
      <div class="crm" id="crm"></div>
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
var q = '';
var crmOpen = false;
var crmData = null;
var crmTags = [];
var PRESET_TAGS = ['ลูกค้าใหม่', 'ลูกค้าประจำ', 'ตัวแทนจำหน่าย', 'เกษตรกร', 'สนใจสินค้า', 'รอตัดสินใจ', 'ซื้อแล้ว', 'ห้ามรบกวน'];
var STATUS_TH = { new: 'ใหม่', interested: 'สนใจ', quoted: 'เสนอราคาแล้ว', customer: 'ซื้อแล้ว', inactive: 'เงียบ/ไม่สนใจ' };
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
    document.getElementById('nt').textContent = d.notify ? ' · 🔔 แจ้งเตือนเข้า LINE แอดมิน ' + d.notify + ' คน' : ' · 🔔 แจ้งเตือน LINE แอดมิน: ปิด (ตั้ง ADMIN_NOTIFY_IDS ใน Railway)';
    document.getElementById('sb').innerHTML = d.sb
      ? '🗄️ CRM: <b style="color:#0a9a4a">Supabase</b> · '
      : '🗄️ CRM: <b style="color:#d97706">เก็บในเครื่อง</b> (ตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY เพื่อซิงก์) · ';
    cache = d.sessions;
    var pend = d.pending || 0;
    var cbEl = document.getElementById('cbcount');
    cbEl.style.display = pend ? 'inline-block' : 'none';
    cbEl.textContent = '📞 ' + pend;
    document.title = (pend ? '(' + pend + ') ' : '') + 'น้องลัดดา — ควบคุมบอท';
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

function matchQ(s) {
  if (!q) return true;
  var c = s.crm || {};
  var hay = [s.name, s.id, s.lastText, c.real_name, c.phone, c.province, c.crops, (c.tags || []).join(' '), STATUS_TH[c.status] || '', s.cb && s.cb.contact].join(' ').toLowerCase();
  return hay.indexOf(q) !== -1;
}

function crmBadge(s) {
  var c = s.crm;
  if (!c) return '';
  var h = '';
  if (c.status && c.status !== 'new') h += '<span class="itag st-' + c.status + '">' + esc(STATUS_TH[c.status] || c.status) + '</span>';
  if (c.tags && c.tags.length) h += '<span class="itag">' + esc(c.tags[0]) + (c.tags.length > 1 ? ' +' + (c.tags.length - 1) : '') + '</span>';
  return h;
}

function renderList() {
  var now = Date.now();
  document.getElementById('count').textContent = cache.length;
  if (!cache.length) {
    document.getElementById('items').innerHTML = '<div class="empty">ยังไม่มีแชทเข้ามา<br>เมื่อลูกค้าทักไลน์จะเด้งขึ้นที่นี่เอง</div>';
    return;
  }
  var h = '';
  var shown = 0;
  for (var i = 0; i < cache.length; i++) {
    var s = cache[i];
    if (!matchQ(s)) continue;
    shown++;
    var muted = s.mutedUntil > now;
    var isHo = muted && s.handoff;
    var isCb = !!s.cb;
    var dot = isCb ? '<span class="stdot">📞</span>' : (muted ? '<span class="stdot">' + (isHo ? '🙋' : '🔇') + '</span>' : '');
    var av = avatarHtml(s, '').replace('</div>', dot + '</div>');
    var last = isCb
      ? '📞 รอติดต่อกลับ · ' + esc(s.cb.contact || s.cb.topic || s.lastText || '-')
      : (isHo ? '🙋 ขอคุยกับแอดมิน · ' : '') + esc(s.lastText || '-');
    h += '<div class="item' + (s.id === sel ? ' sel' : '') + (isCb ? ' cb' : (isHo ? ' ho' : '')) + '" data-id="' + s.id + '">'
      + av
      + '<div class="icol">'
      + '<div class="irow1"><span class="iname">' + esc((s.crm && s.crm.real_name) || dispName(s)) + crmBadge(s) + '</span><span class="itime">' + listTime(isCb ? s.cb.at : s.lastAt) + '</span></div>'
      + '<div class="ilast' + (isCb ? ' cbtxt' : (isHo ? ' hotxt' : '')) + '">' + last + '</div>'
      + '</div></div>';
  }
  if (!shown) h = '<div class="empty">ไม่พบแชทที่ตรงกับ "' + esc(q) + '"</div>';
  document.getElementById('items').innerHTML = h;
}

// ---------- CRM panel ----------
function crmField(label, id, val, ph) {
  return '<label>' + label + '</label><input id="' + id + '" value="' + esc(val == null ? '' : val) + '" placeholder="' + esc(ph || '') + '">';
}

function renderTags() {
  var el = document.getElementById('cf_tags');
  if (!el) return;
  var h = '';
  var i;
  for (i = 0; i < PRESET_TAGS.length; i++) {
    var on = crmTags.indexOf(PRESET_TAGS[i]) !== -1;
    h += '<span class="tag' + (on ? ' on' : '') + '" data-tag="' + esc(PRESET_TAGS[i]) + '">' + esc(PRESET_TAGS[i]) + '</span>';
  }
  for (i = 0; i < crmTags.length; i++) {
    if (PRESET_TAGS.indexOf(crmTags[i]) === -1) h += '<span class="tag on x" data-tag="' + esc(crmTags[i]) + '">' + esc(crmTags[i]) + '</span>';
  }
  el.innerHTML = h;
}

function renderNotes(notes) {
  var el = document.getElementById('cf_notes');
  if (!el) return;
  if (!notes || !notes.length) { el.innerHTML = '<div class="nt" style="color:#98a2ad;font-size:11px">ยังไม่มีบันทึก</div>'; return; }
  var h = '';
  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    h += '<div class="note"><div class="nt">' + dayLabel(Date.parse(n.created_at)) + ' ' + hhmm(Date.parse(n.created_at)) + '</div>' + esc(n.text) + '</div>';
  }
  el.innerHTML = h;
}

function renderCrm(d) {
  var p = d.profile;
  crmData = d;
  crmTags = (p.tags || []).slice();
  var a = p.auto || {};
  var s = findSel() || {};
  var statusOpts = '';
  var keys = ['new', 'interested', 'quoted', 'customer', 'inactive'];
  for (var i = 0; i < keys.length; i++) statusOpts += '<option value="' + keys[i] + '"' + (p.status === keys[i] ? ' selected' : '') + '>' + STATUS_TH[keys[i]] + '</option>';
  var zone = d.zone ? '<b>เขต ' + esc(d.zone.zone) + '</b> — ' + esc(d.zone.team) : '<span style="color:#98a2ad">ใส่จังหวัดแล้วระบบจะบอกผู้ดูแลเขตให้</span>';
  var h = ''
    + '<div style="display:flex;justify-content:space-between;align-items:center"><h4>👤 โปรไฟล์ลูกค้า</h4><span class="exp" id="crmclose">✕ ปิด</span></div>'
    + '<div class="row2"><div>' + crmField('ชื่อจริง / ชื่อที่ใช้เรียก', 'cf_real_name', p.real_name, s.name || '') + '</div><div>' + crmField('เบอร์โทร', 'cf_phone', p.phone, a.phone || '08x-xxx-xxxx') + '</div></div>'
    + '<div class="row2"><div>' + crmField('จังหวัด', 'cf_province', p.province, a.province || '') + '</div><div>' + crmField('อำเภอ', 'cf_district', p.district, '') + '</div></div>'
    + '<div class="row2"><div>' + crmField('พืชที่ปลูก', 'cf_crops', p.crops, a.crops || 'เช่น ทุเรียน, ข้าว') + '</div><div>' + crmField('พื้นที่ (ไร่)', 'cf_farm_rai', p.farm_rai, '') + '</div></div>'
    + crmField('ร้านค้า/ตัวแทนที่ซื้อประจำ', 'cf_shop', p.shop, '')
    + '<label>สถานะ</label><select id="cf_status">' + statusOpts + '</select>'
    + '<label>แท็ก (กดเลือก หรือพิมพ์เพิ่มแล้ว Enter)</label><div class="tags" id="cf_tags"></div><input id="cf_newtag" placeholder="เพิ่มแท็กเอง…" style="margin-top:6px">'
    + '<label>โน้ตสรุป (สิ่งที่ควรรู้เกี่ยวกับลูกค้ารายนี้)</label><textarea id="cf_note">' + esc(p.note || '') + '</textarea>'
    + '<button class="savebtn" id="cf_save">💾 บันทึกโปรไฟล์</button><div class="saved" id="cf_saved"></div>'
    + '<h4>ผู้ดูแลเขต (ME/MR)</h4><div class="auto" id="cf_zone">' + zone + '</div>'
    + '<h4>ข้อมูลอัตโนมัติจากแชท</h4><div class="auto">'
    + 'LINE: ' + esc(s.name || '-') + ' <span style="color:#98a2ad;font-size:10.5px">' + esc(p.line_user_id || '') + '</span><br>'
    + 'ทักครั้งแรก: <b>' + (p.first_seen_at ? dayLabel(Date.parse(p.first_seen_at)) + ' ' + hhmm(Date.parse(p.first_seen_at)) : '-') + '</b> · ล่าสุด: <b>' + (p.last_chat_at ? dayLabel(Date.parse(p.last_chat_at)) + ' ' + hhmm(Date.parse(p.last_chat_at)) : '-') + '</b><br>'
    + 'เบอร์ที่พิมพ์ในแชท: <b>' + esc(a.phone || '-') + '</b> · จังหวัดที่พูดถึง: <b>' + esc(a.province || '-') + '</b><br>'
    + 'พืชที่พูดถึง: <b>' + esc(a.crops || '-') + '</b>'
    + '</div>'
    + '<h4>บันทึกการติดตาม</h4><div class="noteadd"><input id="cf_notein" placeholder="เช่น โทรแล้ว 17/8 ลูกค้าจะสั่ง 2 ลัง"><button id="cf_noteadd">เพิ่ม</button></div><div class="notes" id="cf_notes"></div>';
  document.getElementById('crm').innerHTML = h;
  renderTags();
  renderNotes(d.notes);
}

function loadCrm(id) {
  if (!id) return;
  api('/admin/api/crm?id=' + encodeURIComponent(id)).then(function(d) {
    if (id !== sel) return;
    renderCrm(d);
  }).catch(function(e) { document.getElementById('crm').innerHTML = '<div class="empty">โหลดโปรไฟล์ไม่ได้: ' + esc(e.message) + '</div>'; });
}

function toggleCrm(force) {
  crmOpen = typeof force === 'boolean' ? force : !crmOpen;
  document.getElementById('crm').className = 'crm' + (crmOpen ? ' on' : '');
  document.getElementById('crmbtn').className = 'crmbtn' + (crmOpen ? ' on' : '');
  if (crmOpen && sel) loadCrm(sel);
}

function saveCrm() {
  if (!sel) return;
  var g = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var body = { id: sel, real_name: g('cf_real_name'), phone: g('cf_phone'), province: g('cf_province'), district: g('cf_district'), crops: g('cf_crops'), farm_rai: g('cf_farm_rai'), shop: g('cf_shop'), status: g('cf_status'), tags: crmTags, note: g('cf_note') };
  var btn = document.getElementById('cf_save');
  btn.disabled = true;
  api('/admin/api/crm', { method: 'POST', body: JSON.stringify(body) }).then(function(d) {
    btn.disabled = false;
    document.getElementById('cf_saved').textContent = '✓ บันทึกแล้ว ' + hhmm(Date.now()) + (crmData && crmData.sb ? (d.synced ? ' · ซิงก์ Supabase แล้ว' : ' · ⚠️ ซิงก์ Supabase ไม่สำเร็จ (เก็บในเครื่องไว้ก่อน)') : ' (เก็บในเครื่อง)');
    var z = document.getElementById('cf_zone');
    if (z) z.innerHTML = d.zone ? '<b>เขต ' + esc(d.zone.zone) + '</b> — ' + esc(d.zone.team) : '<span style="color:#98a2ad">ใส่จังหวัดแล้วระบบจะบอกผู้ดูแลเขตให้</span>';
    load();
  }).catch(function(e) { btn.disabled = false; alert('บันทึกไม่สำเร็จ: ' + e.message); });
}

function addNote() {
  var inp = document.getElementById('cf_notein');
  var t = inp ? inp.value.trim() : '';
  if (!t || !sel) return;
  api('/admin/api/crm/note', { method: 'POST', body: JSON.stringify({ id: sel, text: t }) }).then(function() {
    inp.value = '';
    loadCrm(sel);
  }).catch(function(e) { alert('เพิ่มบันทึกไม่สำเร็จ: ' + e.message); });
}

function exportCsv() {
  fetch('/admin/api/crm/export.csv', { headers: { 'x-admin-key': KEY } }).then(function(r) {
    if (!r.ok) throw new Error('ส่งออกไม่สำเร็จ (' + r.status + ')');
    return r.blob();
  }).then(function(b) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'crm_customers_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }).catch(function(e) { alert(e.message); });
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
  if (s.cb) st += '<span class="pill cb">📞 รอติดต่อกลับ</span>';
  document.getElementById('hstat').innerHTML = st;
  var b = document.getElementById('tglbtn');
  if (muted) { b.className = 'tgl start'; b.textContent = '▶ เปิดบอทตอบต่อ'; b.dataset.m = '0'; }
  else { b.className = 'tgl stop'; b.textContent = '⏸ หยุดบอท ตอบเอง'; b.dataset.m = '-1'; }
  var cbb = document.getElementById('cbbtn');
  var bar = document.getElementById('cbbar');
  if (s.cb) {
    cbb.className = 'cbbtn done'; cbb.textContent = '✓ ติดต่อแล้ว'; cbb.dataset.a = 'done';
    var why = s.cb.src === 'phone' ? 'ลูกค้าทิ้งเบอร์ไว้' : (s.cb.src === 'kw' ? 'ลูกค้าพิมพ์ขอคุยกับแอดมิน' : (s.cb.src === 'admin' ? 'แอดมินตั้งธงเอง' : 'บอทรับปากว่าจะให้เจ้าหน้าที่ติดต่อกลับ'));
    bar.className = 'cbbar on';
    bar.innerHTML = '<b>📞 ลูกค้ารอติดต่อกลับ</b> ตั้งแต่ ' + dayLabel(s.cb.at) + ' ' + hhmm(s.cb.at) + ' · ' + esc(why)
      + (s.cb.contact ? ' · <b>ติดต่อ: ' + esc(s.cb.contact) + '</b>' : ' · ยังไม่ได้ทิ้งเบอร์ (ดูในแชท)')
      + (s.cb.topic ? '<br>เรื่อง: ' + esc(s.cb.topic) : '')
      + (s.cb.note && s.cb.src === 'bot' ? '<br>บอทตอบว่า: “' + esc(s.cb.note) + '”' : '');
  } else {
    cbb.className = 'cbbtn set'; cbb.textContent = '📞 ตั้งรอติดต่อกลับ'; cbb.dataset.a = 'set';
    bar.className = 'cbbar'; bar.innerHTML = '';
  }
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
  if (crmOpen) loadCrm(id);
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

document.getElementById('cbbtn').addEventListener('click', function() {
  if (!sel) return;
  var a = this.dataset.a;
  if (a === 'done' && !confirm('ยืนยันว่าติดต่อลูกค้ารายนี้เรียบร้อยแล้ว?')) return;
  api('/admin/api/callback', { method: 'POST', body: JSON.stringify({ id: sel, action: a }) })
    .then(function() { load(); })
    .catch(function(e) { alert(e.message); });
});

document.getElementById('q').addEventListener('input', function() { q = this.value.trim().toLowerCase(); renderList(); });
document.getElementById('crmbtn').addEventListener('click', function() { toggleCrm(); });
document.getElementById('expbtn').addEventListener('click', exportCsv);
document.getElementById('crm').addEventListener('click', function(e) {
  var t = e.target;
  if (t.id === 'crmclose') { toggleCrm(false); return; }
  if (t.id === 'cf_save') { saveCrm(); return; }
  if (t.id === 'cf_noteadd') { addNote(); return; }
  var tg = t.closest ? t.closest('.tag') : null;
  if (tg) {
    var name = tg.getAttribute('data-tag');
    var i = crmTags.indexOf(name);
    if (i === -1) crmTags.push(name); else crmTags.splice(i, 1);
    renderTags();
  }
});
document.getElementById('crm').addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'cf_newtag') {
    e.preventDefault();
    var v = e.target.value.trim();
    if (v && crmTags.indexOf(v) === -1) crmTags.push(v);
    e.target.value = '';
    renderTags();
  } else if (e.target.id === 'cf_notein') { e.preventDefault(); addNote(); }
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
    const now = Date.now();
    const rank = (x) => (x.cb ? 2 : 0) + ((x.handoff && x.mutedUntil > now) ? 1 : 0);
    const list = [...sessions.entries()]
      .map(([id, s]) => ({ id, name: s.name, pic: s.pic, type: s.type, lastText: s.lastText, lastAt: s.lastAt, mutedUntil: s.mutedUntil, handoff: !!s.handoff, cb: s.cb || null, cbDone: s.cbDone || null, crm: crmSummary(id) }))
      // ธงรอติดต่อกลับอยู่บนสุด (คนที่รอนานสุดขึ้นก่อน) -> ขอแอดมิน -> ล่าสุดก่อน
      .sort((a, b) => rank(b) - rank(a) || ((a.cb && b.cb) ? a.cb.at - b.cb.at : b.lastAt - a.lastAt))
      .slice(0, 100);
    const pending = [...sessions.values()].filter((s) => s.cb).length;
    return sendJson(res, 200, { ok: true, muteMinutes: MUTE_MINUTES, persist: persistOK, notify: ADMIN_NOTIFY_IDS.length, sb: SB_ON, pending, now, sessions: list });
  }

  // ---- CRM ----
  if (path === '/admin/api/crm' && req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    const c = crmGet(id);
    crmListNotes(id).then((notes) => sendJson(res, 200, { ok: true, profile: c, notes, zone: zoneInfo(c.province || (c.auto && c.auto.province) || ''), sb: SB_ON, statuses: CRM_STATUS }))
      .catch(() => sendJson(res, 200, { ok: true, profile: c, notes: [], zone: zoneInfo(c.province || ''), sb: SB_ON, statuses: CRM_STATUS }));
    return;
  }
  if (path === '/admin/api/crm' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    crmUpdate(id, data).then((saved) => {
      const c = crmGet(id);
      console.log(`[crm] ${id.slice(0, 8)} profile updated (sb=${saved})`);
      sendJson(res, 200, { ok: true, profile: c, synced: saved, zone: zoneInfo(c.province || '') });
    });
    return;
  }
  if (path === '/admin/api/crm/note' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    const text = String(data.text || '').trim();
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    if (!text) return sendJson(res, 400, { ok: false, error: 'empty text' });
    crmAddNote(id, text).then((note) => sendJson(res, 200, { ok: true, note }));
    return;
  }
  if (path === '/admin/api/crm/export.csv' && req.method === 'GET') {
    const cols = ['line_user_id', 'display_name', 'real_name', 'phone', 'province', 'district', 'crops', 'farm_rai', 'shop', 'status', 'tags', 'note', 'first_seen_at', 'last_chat_at', 'updated_at'];
    const rows = [cols.join(',')];
    for (const c of crm.values()) rows.push(cols.map((k) => csvCell(k === 'crops' ? (c.crops || (c.auto && c.auto.crops) || '') : c[k])).join(','));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="crm_customers.csv"' });
    return res.end('\uFEFF' + rows.join('\r\n'));
  }

  // ธงรอติดต่อกลับ: action = 'done' (ติดต่อแล้ว) | 'set' (แอดมินตั้งเอง)
  if (path === '/admin/api/callback' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body.toString('utf8')); } catch (_) {}
    const id = data.id;
    if (!id || !sessions.has(id)) return sendJson(res, 404, { ok: false, error: 'chat not found' });
    const s = sessions.get(id);
    if (data.action === 'done') clearCallback(s);
    else if (data.action === 'set') { if (!s.cb) flagCallback(id, s, 'admin', { note: 'แอดมินตั้งธงเอง' }); }
    else return sendJson(res, 400, { ok: false, error: 'bad action' });
    console.log(`[admin] ${id.slice(0, 8)} callback ${data.action}`);
    return sendJson(res, 200, { ok: true, id, cb: s.cb || null });
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
    return res.end(JSON.stringify({ ok: true, service: 'line-dify-bridge', version: 2.9, persist: persistOK, chats: sessions.size, callbacks: [...sessions.values()].filter((s) => s.cb).length, crm: crm.size, supabase: SB_ON, ts: Date.now() }));
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
if (SB_ON) { console.log('[crm] Supabase ON:', SB_URL); crmLoadFromSupabase(); } else { console.log('[crm] Supabase OFF — CRM เก็บใน state file (ตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY เพื่อซิงก์)'); }
setTimeout(bootBackfill, 3000);
server.listen(PORT, () => console.log(`line-dify-bridge v2.9 (crm+callback-flag+backfill+send+persist=${persistOK}+SSE, notify=${ADMIN_NOTIFY_IDS.length}, supabase=${SB_ON}) running on port ${PORT}`));
