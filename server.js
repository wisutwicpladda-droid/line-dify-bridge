// ============================================================
// LINE OA <-> Dify Bridge (Node.js สำหรับ Railway)
// บอท "น้องลัดดา ICPL LINE Chatbot"
//
// จุดเด่น:
//  1. ตอบ ack ให้ LINE ทันที (กัน timeout/redelivery storm)
//  2. ประมวลผลต่อเบื้องหลัง (เซิร์ฟเวอร์รันค้างตลอด ไม่มีลิมิตเวลา)
//  3. Reply ก่อน ถ้า token หมดอายุ -> fallback เป็น Push
//  4. จำบทสนทนาต่อเนื่องผ่าน Dify conversations API (ไม่ต้องมี DB)
//  5. ไม่ใช้ dependency ใดๆ (Node built-in ล้วน) — deploy ง่ายสุด
//
// ENV ที่ต้องตั้งใน Railway -> Variables:
//  LINE_CHANNEL_SECRET        จาก LINE Developers -> Basic settings
//  LINE_CHANNEL_ACCESS_TOKEN  จาก LINE Developers -> Messaging API
//  DIFY_API_KEY               จาก Dify -> แอปน้องลัดดา -> API Access (app-...)
//  PORT                       Railway ตั้งให้อัตโนมัติ ไม่ต้องเพิ่มเอง
// ============================================================

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const CH_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CH_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const DIFY_KEY = process.env.DIFY_API_KEY || '';
const DIFY_BASE = 'https://api.dify.ai/v1';

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

// ---------- Event processing (เบื้องหลัง หลัง ack แล้ว) ----------
async function handleEvent(ev) {
  if (ev.type !== 'message' || !ev.message) return;
  if (ev.deliveryContext && ev.deliveryContext.isRedelivery) return; // กัน event ยิงซ้ำ

  const src = ev.source || {};
  const userId = src.userId || 'unknown';
  const sessionId = src.groupId || src.roomId || userId;

  let text = null;
  if (ev.message.type === 'text') text = ev.message.text;
  else if (ev.message.type === 'sticker') text = '(ผู้ใช้ส่งสติกเกอร์มา ทักทายกลับสั้นๆ อย่างเป็นมิตร)';
  else return;

  console.log(`[msg] ${sessionId.slice(0, 8)}...: ${text.slice(0, 60)}`);

  let answer = await askDify(sessionId, text);
  if (!answer) answer = 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้งนะคะ 🙏';
  answer = answer.slice(0, 4900);

  const ok = await lineReply(ev.replyToken, answer);
  if (!ok && userId !== 'unknown') {
    const pushed = await linePush(userId, answer);
    console.log(`[send] reply=failed push=${pushed}`);
  } else {
    console.log(`[send] reply=${ok}`);
  }
}

// ---------- Server ----------
const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'line-dify-bridge', ts: Date.now() }));
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end('Not found'); }

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

server.listen(PORT, () => console.log(`line-dify-bridge running on port ${PORT}`));
