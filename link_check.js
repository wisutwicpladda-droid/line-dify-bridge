'use strict';
// v3.75 (5 พ.ย. 2569): ตามลิงก์หลักฐานของขั้นค้นเว็บใน Dify ว่าชี้ไปเว็บไหน
// เจ้าของสั่ง: หลักฐานจากเว็บใช้ได้เฉพาะกรมวิชาการเกษตร (doa.go.th) ลิงก์ที่ Gemini ให้มาเป็น grounding-api-redirect ซึ่งซ่อนเว็บปลายทาง
// และโหนด Code ของ Dify ออกเน็ตไม่ได้ Dify จึงส่งข้อความที่มีลิงก์มาให้ bridge ตามแทน
//   POST /links/check  header x-sheet-key: <SHEET_PROXY_KEY หรือ PRODUCT_SHEET_PROXY_KEY>  body = ข้อความใดก็ได้ (ผลของขั้นค้นเว็บ)
//   ตอบ {"rule":"doa.go.th only","links":[{"url","host","doa","status"}]}
// ตามได้เฉพาะลิงก์ https://vertexaisearch.cloud.google.com/grounding-api-redirect/... แบบไม่ follow (อ่าน Location อย่างเดียว)
// จึงใช้ยิงไปเว็บอื่นไม่ได้ · ลิงก์ละ 4 วินาที สูงสุด 12 ลิงก์ต่อครั้ง · ผลที่ตามได้เก็บไว้ 24 ชั่วโมง
const crypto = require('crypto');

const PREFIX = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/';
const LINK_RX = /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[A-Za-z0-9_\-=]+/g;
const DOA = 'doa.go.th';

function extract(text, max = 12) {
  const out = [];
  for (const m of String(text || '').matchAll(LINK_RX)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= max) break;
  }
  return out;
}

function isDoaHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  return h === DOA || h.endsWith('.' + DOA);
}

function create({ keys = [], fetchImpl = globalThis.fetch, timeoutMs = 4000, ttlMs = 24 * 3600000 } = {}) {
  const goodKeys = keys.map((k) => String(k || '').trim()).filter((k) => k.length >= 24);
  const cache = new Map();
  const st = { calls: 0, links: 0, resolved: 0, failed: 0, denied: 0, lastError: '' };

  function keyOk(k) {
    const s = String(k || '');
    return goodKeys.some((g) => g.length === s.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(s)));
  }

  async function resolve(url) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.v;
    let v;
    try {
      const r = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(timeoutMs) });
      const loc = (r.headers && r.headers.get && r.headers.get('location')) || '';
      let host = '';
      try { host = loc ? new URL(loc).hostname : ''; } catch (_) { host = ''; }
      v = host ? { host, doa: isDoaHost(host), status: 'resolved' } : { host: '', doa: false, status: 'http_' + r.status };
      try { if (r.body && typeof r.body.cancel === 'function') await r.body.cancel(); } catch (_) { /* body already closed */ }
    } catch (e) {
      v = { host: '', doa: false, status: 'unreachable' };
      st.lastError = String((e && e.message) || e).slice(0, 160);
    }
    if (v.status === 'resolved') {
      st.resolved++;
      cache.set(url, { at: Date.now(), v });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
    } else {
      st.failed++;
    }
    return v;
  }

  async function check(text) {
    const urls = extract(text);
    st.calls++;
    st.links += urls.length;
    return Promise.all(urls.map(async (url) => Object.assign({ url }, await resolve(url))));
  }

  async function handle(req, res, body) {
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    if (!goodKeys.length) return send(503, { error: 'link check is not configured (needs SHEET_PROXY_KEY or PRODUCT_SHEET_PROXY_KEY)' });
    if (!keyOk(req.headers['x-sheet-key'])) { st.denied++; return send(401, { error: 'invalid x-sheet-key' }); }
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    const links = await check(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || ''));
    return send(200, { rule: 'doa.go.th only', links });
  }

  return { extract, isDoaHost, resolve, check, handle, summary: () => Object.assign({}, st, { keys: goodKeys.length, cached: cache.size }) };
}

module.exports = { create, extract, isDoaHost, PREFIX };

