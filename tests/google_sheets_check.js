'use strict';

// v3.58 (29 ต.ค. 2569): ชีทสินค้าเป็นส่วนตัว อ่านด้วย service account (JWT RS256 -> access token -> Sheets API v4)
// หรือผ่าน bridge ตัวกลาง (x-sheet-key) แถวที่ได้ต้องหน้าตาเหมือน CSV export เดิมที่ kb_sync ใช้
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const { createGoogleSheets, parseServiceAccount, rowsOf, SCOPE } = require('../google_sheets');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const unb64 = (x) => Buffer.from(String(x).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const listen = (h) => new Promise((ok) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => ok(s)); });
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); });

// ชีทจำลอง: แถวจาก Sheets API ไม่มีช่องว่างท้ายแถว และแถวว่างกลางตารางเป็น []
const TABS = {
  111: { title: 'products_master', values: [['product_id', 'product_name', 'status'], ['P1', 'แกนเตอร์', 'ขาย'], ['P2', 'คริซ่า'], [], ['P3', "ชื่อมี 'quote'", 'ขาย']] },
  222: { title: 'product_usage', values: [['usage_id', 'product_id', 'crop', 'rate'], ['U1', 'P1', 'ข้าว', '200']] },
  333: { title: 'product package', values: [['id', 'size'], ['K1', '1 ลิตร']] }
};
const byTitle = (t) => Object.values(TABS).find((x) => x.title === t);
const G = { tokens: [], calls: [], revokeOnce: false, failNext: 0, token: '' };

(async () => {
  // 1) แปลงแถว และอ่าน key
  assert.deepStrictEqual(rowsOf([['a', 'b', 'c'], ['1'], [], ['x', null, 'z']]), [['a', 'b', 'c'], ['1', '', ''], ['', '', ''], ['x', '', 'z']]);
  assert.deepStrictEqual(rowsOf(undefined), []);
  assert.deepStrictEqual(parseServiceAccount(''), { sa: null, error: '' });
  assert(/อ่านไม่ได้/.test(parseServiceAccount('{not json').error));
  assert(/client_email/.test(parseServiceAccount(JSON.stringify({ client_email: 'a@b' })).error));
  assert(/ใช้ไม่ได้/.test(parseServiceAccount(JSON.stringify({ client_email: 'a@b', private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n' })).error));

  const srv = await listen(async (req, res) => {
    const b = await readBody(req);
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && req.url === '/token') {
      const p = new URLSearchParams(b);
      const parts = String(p.get('assertion') || '').split('.');
      const okSig = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, unb64(parts[2]));
      G.tokens.push({ grant: p.get('grant_type'), okSig, head: JSON.parse(unb64(parts[0])), claims: JSON.parse(unb64(parts[1])) });
      G.token = 'tok-' + G.tokens.length;
      return json(200, { access_token: G.token, expires_in: 3600, token_type: 'Bearer' });
    }
    let path = req.url;
    const viaProxy = path.startsWith('/sheets/');
    if (viaProxy) path = path.slice('/sheets'.length);
    G.calls.push({ path, auth: req.headers.authorization || '', key: req.headers['x-sheet-key'] || '' });
    if (viaProxy ? req.headers['x-sheet-key'] !== 'proxy-key' : req.headers.authorization !== 'Bearer ' + G.token) return json(401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
    if (G.revokeOnce) { G.revokeOnce = false; return json(401, { error: { code: 401, message: 'revoked' } }); }
    if (G.failNext) { const code = G.failNext; G.failNext = 0; return json(code, { error: { code, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }); }
    const u = new URL('http://x' + path);
    if (u.pathname === '/v4/spreadsheets/sheet-x') {
      assert.strictEqual(u.searchParams.get('fields'), 'sheets.properties(sheetId,title)');
      return json(200, { sheets: Object.entries(TABS).map(([id, t]) => ({ properties: { sheetId: Number(id), title: t.title } })) });
    }
    if (u.pathname === '/v4/spreadsheets/sheet-x/values:batchGet') {
      assert.deepStrictEqual([u.searchParams.get('majorDimension'), u.searchParams.get('valueRenderOption')], ['ROWS', 'FORMATTED_VALUE']);
      return json(200, { spreadsheetId: 'sheet-x', valueRanges: u.searchParams.getAll('ranges').map((r) => {
        const name = r.replace(/^'|'$/g, '').replace(/''/g, "'");
        const t = byTitle(name);
        return { range: r + '!A1:Z9', majorDimension: 'ROWS', values: t ? t.values : [] };
      }) });
    }
    return json(404, { error: { code: 404, message: 'not found' } });
  });
  const base = 'http://127.0.0.1:' + srv.address().port;
  const saObj = { type: 'service_account', project_id: 'demo', private_key_id: 'kid-123', private_key: PEM, client_email: 'sheets-sync@demo.iam.gserviceaccount.com', token_uri: base + '/token' };
  const GIDS = { master: '111', usage: '222', packages: '333' };
  let clock = Date.parse('2026-10-29T12:00:00Z');

  try {
    // 2) service account: ลายเซ็น JWT ถูกต้อง ขอ token ครั้งเดียวแล้วใช้ซ้ำ อ่านชื่อแท็บจาก gid
    const c = createGoogleSheets({ env: { GOOGLE_SA_JSON: JSON.stringify(saObj, null, 2), GOOGLE_SHEETS_API_BASE: base }, now: () => clock });
    assert.strictEqual(c.mode, 'service-account');
    let sh = await c.readTabs('sheet-x', GIDS);
    assert.deepStrictEqual(sh.master, [['product_id', 'product_name', 'status'], ['P1', 'แกนเตอร์', 'ขาย'], ['P2', 'คริซ่า', ''], ['', '', ''], ['P3', "ชื่อมี 'quote'", 'ขาย']]);
    assert.deepStrictEqual(sh.usage, [['usage_id', 'product_id', 'crop', 'rate'], ['U1', 'P1', 'ข้าว', '200']]);
    assert.deepStrictEqual(sh.packages, [['id', 'size'], ['K1', '1 ลิตร']], 'ชื่อแท็บที่มีช่องว่างต้องอ่านได้');
    assert.strictEqual(G.tokens.length, 1);
    const t0 = G.tokens[0];
    assert.strictEqual(t0.okSig, true, 'ลายเซ็น JWT ต้องตรวจด้วย public key ผ่าน');
    assert.strictEqual(t0.grant, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    assert.deepStrictEqual([t0.head.alg, t0.head.kid], ['RS256', 'kid-123']);
    assert.deepStrictEqual([t0.claims.iss, t0.claims.scope, t0.claims.aud, t0.claims.exp - t0.claims.iat], [saObj.client_email, SCOPE, saObj.token_uri, 3600]);
    assert.strictEqual(SCOPE, 'https://www.googleapis.com/auth/spreadsheets.readonly', 'ขอสิทธิ์อ่านอย่างเดียว');
    assert.deepStrictEqual(c.status(), { mode: 'service-account', ok: true, at: clock, error: undefined });
    const calls = G.calls.length;
    sh = await c.readTabs('sheet-x', GIDS);
    assert.strictEqual(G.tokens.length, 1, 'token ยังไม่หมดอายุ ต้องใช้ซ้ำ');
    assert.strictEqual(G.calls.length, calls + 1, 'ชื่อแท็บจำไว้ 10 นาที อ่านแค่ค่าในแท็บ');
    // token ใกล้หมดอายุ (เหลือน้อยกว่า 1 นาที) ขอใหม่
    clock += 59.5 * 60000;
    await c.readTabs('sheet-x', GIDS);
    assert.strictEqual(G.tokens.length, 2);
    // Google ตอบ 401 (token ถูกเพิกถอน) ขอ token ใหม่แล้วลองอีก 1 ครั้ง
    G.revokeOnce = true;
    await c.readTabs('sheet-x', GIDS);
    assert.strictEqual(G.tokens.length, 3);
    // ไม่มีสิทธิ์อ่านชีท: error จาก Google อ่านเข้าใจได้ และไม่มี key หลุดใน error
    G.failNext = 403;
    let err = null;
    try { await c.readTabs('sheet-x', GIDS); } catch (e) { err = e; }
    assert(err && /sheets HTTP 403: The caller does not have permission/.test(err.message), err && err.message);
    assert(!/PRIVATE KEY|tok-/.test(err.message));
    assert.strictEqual(c.status().ok, false);
    assert(/403/.test(c.status().error));
    // gid ที่ไม่มีในชีท
    err = null;
    try { await c.readTabs('sheet-x', { master: '999' }); } catch (e) { err = e; }
    assert(err && /ไม่พบแท็บ master \(gid 999\)/.test(err.message), err && err.message);
    // ขอพร้อมกันตอนยังไม่มี token = ขอ token ครั้งเดียว
    const before = G.tokens.length;
    const c2 = createGoogleSheets({ env: { GOOGLE_SA_JSON: JSON.stringify(saObj), GOOGLE_SHEETS_API_BASE: base }, now: () => clock });
    await Promise.all([c2.readTabs('sheet-x', GIDS), c2.readTabs('sheet-x', GIDS), c2.token()]);
    assert.strictEqual(G.tokens.length, before + 1);

    // 3) วาง key แบบ base64 หรือแบบ \n ซ้อน ก็อ่านได้
    assert.strictEqual(parseServiceAccount(Buffer.from(JSON.stringify(saObj)).toString('base64')).sa.email, saObj.client_email);
    const escaped = JSON.stringify(Object.assign({}, saObj, { private_key: PEM.replace(/\n/g, '\\n') }));
    assert.strictEqual(parseServiceAccount(escaped).error, '');

    // 4) ผ่าน bridge ตัวกลาง: ส่ง x-sheet-key ไม่ขอ token จาก Google
    const tokensBefore = G.tokens.length;
    const p = createGoogleSheets({ env: { PRODUCT_SHEET_PROXY_URL: base + '/sheets/', PRODUCT_SHEET_PROXY_KEY: 'proxy-key' } });
    assert.strictEqual(p.mode, 'proxy');
    sh = await p.readTabs('sheet-x', GIDS);
    assert.strictEqual(sh.master[1][1], 'แกนเตอร์');
    assert.strictEqual(G.tokens.length, tokensBefore);
    assert(G.calls.slice(-2).every((x) => x.key === 'proxy-key' && !x.auth));
    const bad = createGoogleSheets({ env: { PRODUCT_SHEET_PROXY_URL: base + '/sheets', PRODUCT_SHEET_PROXY_KEY: 'wrong' } });
    err = null;
    try { await bad.readTabs('sheet-x', GIDS); } catch (e) { err = e; }
    assert(err && /^proxy HTTP 401/.test(err.message), err && err.message);

    // 5) ไม่ได้ตั้งอะไร = แบบเดิม (ลิงก์สาธารณะใน kb_sync) · key เสียบอกสาเหตุใน status
    const pub = createGoogleSheets({ env: {} });
    assert.strictEqual(pub.mode, 'public');
    await assert.rejects(pub.get('/v4/spreadsheets/x'), /ไม่ได้ตั้ง GOOGLE_SA_JSON/);
    const broken = createGoogleSheets({ env: { GOOGLE_SA_JSON: '{"client_email":"x@y"' } });
    assert.strictEqual(broken.mode, 'public');
    assert(/GOOGLE_SA_JSON อ่านไม่ได้/.test(broken.status().error));
  } finally {
    srv.close();
  }
  console.log('PASS: private product sheet is read with a service account (signed RS256 JWT, read-only scope, token reused until it nearly expires, one token for parallel reads, retry after 401, tab names from gid, rows padded like the CSV export) or through the bridge proxy with x-sheet-key; Google errors stay readable and never include the key');
})().catch((e) => { console.error(e); process.exit(1); });
