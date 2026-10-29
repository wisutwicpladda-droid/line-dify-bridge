'use strict';
// v3.58 (29 ต.ค. 2569): อ่านชีทสินค้าที่เป็นส่วนตัว (เจ้าของปิด "ทุกคนที่มีลิงก์ดูได้" เมื่อ 29 ต.ค.)
// 3 แบบ ตามตัวแปรที่ตั้งใน Railway:
//  - service-account: GOOGLE_SA_JSON = เนื้อไฟล์ JSON ของ key ของ service account ที่ชีทแชร์ให้ (เช่น sheets-sync@...)
//    สร้าง JWT (RS256) แลก access token จาก Google แล้วอ่านด้วย Sheets API v4 (scope spreadsheets.readonly)
//    โปรเจกต์ของ service account ต้องเปิด Google Sheets API
//  - proxy: PRODUCT_SHEET_PROXY_URL + PRODUCT_SHEET_PROXY_KEY = อ่านผ่าน bridge ตัวที่มี service account (เช่น V.2 อ่านผ่านบอทจริง)
//    URL ลงท้ายด้วย /sheets ส่ง key ใน header x-sheet-key
//  - public: ไม่ได้ตั้งทั้งสองอย่าง ใช้ลิงก์ CSV สาธารณะแบบเดิม (kb_sync.js)
// ห้าม log หรือแสดง private key / access token
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DEFAULT_API_BASE = 'https://sheets.googleapis.com';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const short = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n || 160);

// รับได้ทั้งเนื้อ JSON ตรง ๆ และแบบ base64 (บางคนเข้ารหัสก่อนวางใน Railway)
function parseServiceAccount(raw) {
  const t = String(raw || '').trim();
  if (!t) return { sa: null, error: '' };
  let obj = null;
  try { obj = JSON.parse(t); } catch (_) {
    try { obj = JSON.parse(Buffer.from(t, 'base64').toString('utf8')); } catch (_) { obj = null; }
  }
  if (!obj || typeof obj !== 'object') return { sa: null, error: 'GOOGLE_SA_JSON อ่านไม่ได้ ต้องเป็นเนื้อไฟล์ JSON ของ key ทั้งไฟล์' };
  const email = String(obj.client_email || '');
  let key = String(obj.private_key || '');
  if (!key.includes('\n') && key.includes('\\n')) key = key.replace(/\\n/g, '\n'); // วางแบบ escape ซ้อนมา
  if (!/@/.test(email) || !/-----BEGIN (RSA )?PRIVATE KEY-----/.test(key)) return { sa: null, error: 'GOOGLE_SA_JSON ไม่มี client_email หรือ private_key' };
  try { crypto.createPrivateKey(key); } catch (_) { return { sa: null, error: 'private_key ใน GOOGLE_SA_JSON ใช้ไม่ได้' }; }
  return { sa: { email, key, keyId: String(obj.private_key_id || ''), tokenUri: String(obj.token_uri || DEFAULT_TOKEN_URI) }, error: '' };
}

// แถวจาก Sheets API ตัดช่องว่างท้ายแถวทิ้ง เติมกลับให้ยาวเท่ากันทุกแถวเหมือน CSV export ที่ kb_sync ใช้เดิม
function rowsOf(values) {
  const rows = Array.isArray(values) ? values : [];
  const width = rows.reduce((w, r) => Math.max(w, Array.isArray(r) ? r.length : 0), 0);
  return rows.map((r) => {
    const a = (Array.isArray(r) ? r : []).map((v) => (v == null ? '' : String(v)));
    while (a.length < width) a.push('');
    return a;
  });
}

const quoteTitle = (t) => "'" + String(t).replace(/'/g, "''") + "'";

function createGoogleSheets(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const doFetch = o.fetch || ((url, init) => fetch(url, init));
  const now = o.now || Date.now;
  const timeoutMs = o.timeoutMs || 20000;
  const parsed = parseServiceAccount(env.GOOGLE_SA_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const sa = parsed.sa;
  const apiBase = String(env.GOOGLE_SHEETS_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const proxyUrl = String(env.PRODUCT_SHEET_PROXY_URL || '').trim().replace(/\/+$/, '');
  const proxyKey = String(env.PRODUCT_SHEET_PROXY_KEY || '').trim();
  const mode = sa ? 'service-account' : (proxyUrl && proxyKey ? 'proxy' : 'public');
  const state = { mode, configError: parsed.error, ok: null, at: 0, error: '', tokens: 0 };
  let tok = { value: '', exp: 0 };
  let tokWait = null;
  let titleCache = { id: '', at: 0, map: null };

  async function fetchToken() {
    const iat = Math.floor(now() / 1000);
    const head = b64url(JSON.stringify(sa.keyId ? { alg: 'RS256', typ: 'JWT', kid: sa.keyId } : { alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: sa.email, scope: SCOPE, aud: sa.tokenUri, iat, exp: iat + 3600 }));
    const unsigned = head + '.' + claims;
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.key);
    const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(unsigned + '.' + b64url(sig));
    const r = await doFetch(sa.tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(timeoutMs) });
    let j = {};
    try { j = await r.json(); } catch (_) { j = {}; }
    if (!r.ok || !j.access_token) throw new Error('token HTTP ' + r.status + (j.error ? ' ' + short(j.error, 40) : '') + (j.error_description ? ': ' + short(j.error_description, 120) : ''));
    tok = { value: String(j.access_token), exp: now() + (Number(j.expires_in) > 0 ? Number(j.expires_in) : 3600) * 1000 };
    state.tokens++;
    return tok.value;
  }

  // access token ใช้ซ้ำจนเหลือ 1 นาทีก่อนหมดอายุ ขอพร้อมกันหลายที่ก็ขอ Google ครั้งเดียว
  async function token(force) {
    if (!force && tok.value && tok.exp - 60000 > now()) return tok.value;
    if (!tokWait) tokWait = fetchToken().finally(() => { tokWait = null; });
    return tokWait;
  }

  // GET path ที่ขึ้นต้นด้วย /v4/spreadsheets/... ไปที่ Sheets API (service account) หรือ bridge ตัวกลาง (proxy)
  async function get(path) {
    if (mode === 'service-account') {
      const call = async (t) => doFetch(apiBase + path, { headers: { Authorization: 'Bearer ' + t }, signal: AbortSignal.timeout(timeoutMs) });
      let r = await call(await token(false));
      if (r.status === 401) r = await call(await token(true)); // token ถูกเพิกถอนหรือหมดอายุก่อนเวลา ขอใหม่ 1 ครั้ง
      return r;
    }
    if (mode === 'proxy') return doFetch(proxyUrl + path, { headers: { 'x-sheet-key': proxyKey }, signal: AbortSignal.timeout(timeoutMs) });
    throw new Error('ไม่ได้ตั้ง GOOGLE_SA_JSON หรือ PRODUCT_SHEET_PROXY_URL/KEY');
  }

  async function getJson(path) {
    const r = await get(path);
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (_) { j = null; }
    if (r.status !== 200 || !j) {
      const msg = j && j.error ? (typeof j.error === 'string' ? j.error : j.error.message) : '';
      throw new Error((mode === 'proxy' ? 'proxy' : 'sheets') + ' HTTP ' + r.status + (msg ? ': ' + short(msg, 160) : ''));
    }
    return j;
  }

  // ชื่อแท็บของแต่ละ gid (sheetId) จำไว้ 10 นาที
  async function titles(spreadsheetId) {
    if (titleCache.map && titleCache.id === spreadsheetId && now() - titleCache.at < 600000) return titleCache.map;
    const j = await getJson('/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + '?fields=' + encodeURIComponent('sheets.properties(sheetId,title)'));
    const map = {};
    for (const sh of j.sheets || []) if (sh && sh.properties) map[String(sh.properties.sheetId)] = String(sh.properties.title);
    titleCache = { id: spreadsheetId, at: now(), map };
    return map;
  }

  // gids = { master: '1517893127', usage: '...' } -> { master: [[...], ...], usage: [...] } รูปแบบเดียวกับ CSV export
  async function readTabs(spreadsheetId, gids) {
    try {
      const map = await titles(spreadsheetId);
      const keys = Object.keys(gids);
      const names = keys.map((k) => {
        const t = map[String(gids[k])];
        if (!t) throw new Error('ไม่พบแท็บ ' + k + ' (gid ' + gids[k] + ') ในชีท');
        return t;
      });
      const q = names.map((n) => 'ranges=' + encodeURIComponent(quoteTitle(n))).join('&') + '&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE';
      const j = await getJson('/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + '/values:batchGet?' + q);
      const vr = Array.isArray(j.valueRanges) ? j.valueRanges : [];
      if (vr.length !== keys.length) throw new Error('ได้ ' + vr.length + ' แท็บ ต้องการ ' + keys.length);
      const out = {};
      keys.forEach((k, i) => { out[k] = rowsOf(vr[i] && vr[i].values); });
      Object.assign(state, { ok: true, at: now(), error: '' });
      return out;
    } catch (e) {
      Object.assign(state, { ok: false, at: now(), error: short(e.message, 200) });
      throw e;
    }
  }

  function status() {
    return { mode, ok: state.ok, at: state.at || undefined, error: state.error || state.configError || undefined };
  }

  return { mode, state, status, get, getJson, titles, readTabs, token: () => token(false) };
}

module.exports = { createGoogleSheets, parseServiceAccount, rowsOf, SCOPE };
