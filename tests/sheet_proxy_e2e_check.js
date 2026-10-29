'use strict';

// v3.58 (29 ต.ค. 2569): ชีทสินค้าเป็นส่วนตัว ทดสอบ server.js จริง 3 บทบาท
//  A = บอทจริง: อ่านชีทด้วย service account และเป็นตัวกลาง /sheets/v4/... ให้โหนดอ่านชีทของ Dify (x-sheet-key)
//  B = V.2: อ่านชีทผ่านตัวกลางของ A (PRODUCT_SHEET_PROXY_URL/KEY)
//  C = A เริ่มใหม่ตอน Google ไม่ให้อ่าน: ใช้ข้อมูลชีทชุดล่าสุดที่เก็บใน Volume แทนการไม่มีข้อมูลเลย
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PEM = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const PROXY_KEY = 'proxy-key-' + crypto.randomBytes(12).toString('hex');
const HEAD_M = ['product_id', 'product_name', 'product_category', 'common_name_th', 'active_ingredient', 'moa_group', 'physical_form', 'selling_point', 'absorption_method', 'mechanism_of_action', 'action_characteristics', 'phytotoxicity', 'additional_precautions', 'strategy', 'status_selling', 'data_note'];
const HEAD_U = ['usage_id', 'product_id', 'product_name', 'crop_group', 'crop_name', 'target_type', 'target_name', 'crop_stage', 'application_equipment', 'application_method', 'how_to_use', 'rate_min', 'rate_max', 'rate_unit', 'rate_basis_value', 'rate_basis_unit', 'coverage_area_value', 'coverage_area_unit', 'usage_note', 'data_note'];
// แถวแบบที่ Sheets API ส่งมา: ไม่มีช่องว่างท้ายแถว
const MASTER = [HEAD_M,
  ['P1', 'แกนเตอร์', 'Herbicide', 'บิวทาคลอร์', 'butachlor', '15', 'EC', 'คุมวัชพืชในนาข้าว', '', '', '', '', '', 'Expand', 'ขาย'],
  ['P2', 'คริซ่า', 'Fungicide', 'ไตรไซคลาโซล', 'tricyclazole', '16', 'WP', '', '', '', '', '', '', 'Natural', 'ขาย'],
  ['P3', 'ตัวใหม่', 'Insecticide', '', '', '', '', '', '', '', '', '', '', 'Standard', 'เดือนธันวาคม']];
const USAGE = [HEAD_U, ['U1', 'P1', 'แกนเตอร์', 'ข้าว', 'นาหว่านน้ำตม', 'วัชพืช', 'หญ้าข้าวนก', 'ก่อนงอก', 'คน', 'พ่น', '', '200', '250', 'ซีซี', '20', 'ลิตร']];
const PACKAGES = [['package_id', 'product_id', 'product_name', 'package_type', 'package_value', 'package_unit'], ['K1', 'P1', 'แกนเตอร์', 'ขวด', '1', 'ลิตร']];
const TABS = { 111: { title: 'products_master', values: MASTER }, 222: { title: 'product_usage', values: USAGE }, 333: { title: 'product_packages', values: PACKAGES } };
const pad = (rows) => { const w = Math.max(...rows.map((r) => r.length)); return rows.map((r) => r.concat(Array(w - r.length).fill(''))); };
const G = { tokens: 0, api: 0, fail: 0 };

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const listen = (h) => new Promise((ok) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => ok(s)); });
function req(port, method, p, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: headers || {} }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => { const raw = Buffer.concat(c); let json = null; try { json = JSON.parse(raw.toString('utf8')); } catch (_) {} resolve({ status: res.statusCode, raw, json }); });
    });
    r.on('error', reject);
    r.end();
  });
}
function startBridge(port, env) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), LINE_CHANNEL_SECRET: 'test-secret', LINE_CHANNEL_ACCESS_TOKEN: 'x', ADMIN_KEY: 'test-admin',
      LINE_API_BASE: 'http://127.0.0.1:9', LINE_DATA_API_BASE: 'http://127.0.0.1:9', REGISTER: 'off', DIFY_API_KEY: '', DIFY_API_BASE: 'http://127.0.0.1:9/v1', DIFY_DATASET_KEY: '',
      SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', POS_TABLE: '', SALES_LEAD_TARGETS: '', LEAD_LINE_TOKEN: '', TEAM_SHEET_URL: 'http://127.0.0.1:9/team',
      GOOGLE_SA_JSON: '', SHEET_PROXY_KEY: '', PRODUCT_SHEET_PROXY_URL: '', PRODUCT_SHEET_PROXY_KEY: '', COST_FORWARD_URL: '', COST_FORWARD_KEY: '',
      PRODUCT_SHEET_ID: 'sheet-x', PRODUCT_GID_MASTER: '111', PRODUCT_GID_USAGE: '222', PRODUCT_GID_PACKAGES: '333'
    }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return { child, log: () => log };
}
async function waitHealth(port, ok, what) {
  let h = null;
  for (let i = 0; i < 150; i++) {
    try { h = (await req(port, 'GET', '/health')).json; if (h && h.ok && ok(h)) return h; } catch (_) {}
    await sleep(100);
  }
  throw new Error('timeout waiting for ' + what + ': ' + JSON.stringify(h && { productMaster: h.productMaster, sheetAuth: h.sheetAuth, sheetProxy: h.sheetProxy }));
}

(async () => {
  const google = await listen(async (rq, res) => {
    const c = [];
    for await (const d of rq) c.push(d);
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (rq.method === 'POST' && rq.url === '/token') { G.tokens++; return json(200, { access_token: 'tok-ok', expires_in: 3600 }); }
    if (G.fail) return json(G.fail, { error: { code: G.fail, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } });
    if (rq.headers.authorization !== 'Bearer tok-ok') return json(401, { error: { code: 401, message: 'no token' } });
    G.api++;
    const u = new URL('http://x' + rq.url);
    if (u.pathname === '/v4/spreadsheets/sheet-x') return json(200, { sheets: Object.entries(TABS).map(([id, t]) => ({ properties: { sheetId: Number(id), title: t.title } })) });
    if (u.pathname === '/v4/spreadsheets/sheet-x/values:batchGet') {
      return json(200, { spreadsheetId: 'sheet-x', valueRanges: u.searchParams.getAll('ranges').map((r) => {
        const name = r.split('!')[0].replace(/^'|'$/g, '');
        const t = Object.values(TABS).find((x) => x.title === name);
        return { range: name + '!A1:T9', majorDimension: 'ROWS', values: t ? t.values : [] };
      }) });
    }
    return json(404, { error: { code: 404, message: 'not found' } });
  });
  const gbase = 'http://127.0.0.1:' + google.address().port;
  const sa = JSON.stringify({ type: 'service_account', private_key_id: 'k1', private_key: PEM, client_email: 'sheets-sync@demo.iam.gserviceaccount.com', token_uri: gbase + '/token' }, null, 2);
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-sheet-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-sheet-b-'));
  const portA = 44000 + Math.floor(Math.random() * 1500);
  const portB = portA + 1;
  const envA = { GOOGLE_SA_JSON: sa, GOOGLE_SHEETS_API_BASE: gbase, SHEET_PROXY_KEY: PROXY_KEY, SHEET_PROXY_TTL_SECONDS: '1', STATE_DIR: dirA };
  const DIFY = '/sheets/v4/spreadsheets/sheet-x/values:batchGet?ranges=products_master%21A%3AP&ranges=product_usage%21A%3AT&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE';
  const KEY = { 'x-sheet-key': PROXY_KEY };
  let a = startBridge(portA, envA);
  let b = null;
  try {
    // A: อ่านชีทด้วย service account และเก็บสำเนาใน Volume
    let h = await waitHealth(portA, (x) => x.productMaster.ok, 'A product master');
    assert.deepStrictEqual([h.version >= '3.58', h.productMaster.products, h.sheetAuth.mode, h.sheetAuth.ok, h.sheetProxy.ready], [true, 2, 'service-account', true, true], JSON.stringify(h.productMaster));
    const pub = JSON.stringify(h);
    assert(!pub.includes(PROXY_KEY) && !pub.includes('PRIVATE KEY') && !pub.includes('tok-ok') && !pub.includes('sheets-sync@'), '/health ห้ามมี key token หรืออีเมลของ service account');
    const saved = JSON.parse(fs.readFileSync(path.join(dirA, 'product-sheet-cache.json'), 'utf8'));
    assert.deepStrictEqual([saved.id, saved.master, saved.usage, saved.packages], ['sheet-x', pad(MASTER), pad(USAGE), pad(PACKAGES)]);

    // ตัวกลางสำหรับ Dify: ต้องมี key ถูกต้อง อ่านได้เฉพาะชีทสินค้าแบบ GET ส่งคำตอบของ Google กลับตามเดิม
    assert.strictEqual((await req(portA, 'GET', DIFY)).status, 401);
    assert.strictEqual((await req(portA, 'GET', DIFY, { 'x-sheet-key': 'wrong-key' })).status, 401);
    let before = G.api;
    let r = await req(portA, 'GET', DIFY, KEY);
    assert.strictEqual(r.status, 200, r.raw.toString());
    assert.deepStrictEqual(r.json.valueRanges.map((v) => v.range.split('!')[0]), ['products_master', 'product_usage'], 'โค้ดใน Dify ตรวจชื่อแท็บจาก range');
    assert.deepStrictEqual(r.json.valueRanges[0].values, MASTER);
    assert.strictEqual(G.api, before + 1);
    const first = r.raw.toString();
    r = await req(portA, 'GET', DIFY, KEY);
    assert.deepStrictEqual([r.status, G.api], [200, before + 1], 'ภายใน TTL ต้องใช้คำตอบเดิม ไม่เรียก Google ซ้ำ');
    assert.strictEqual((await req(portA, 'GET', DIFY.replace('sheet-x', 'other-sheet'), KEY)).status, 403, 'อ่านได้เฉพาะชีทสินค้า');
    assert.strictEqual((await req(portA, 'POST', DIFY, KEY)).status, 405, 'อ่านอย่างเดียว');
    // Google ล่มหลัง TTL: ตอบชุดล่าสุดทันที แล้วบันทึก error ไว้ใน /health
    G.fail = 500;
    await sleep(1200);
    r = await req(portA, 'GET', DIFY, KEY);
    assert.deepStrictEqual([r.status, r.raw.toString()], [200, first], 'Google ล่มต้องได้ชุดล่าสุด');
    h = await waitHealth(portA, (x) => x.sheetProxy.errors >= 1, 'proxy error count');
    assert(/HTTP 500/.test(h.sheetProxy.lastError), h.sheetProxy.lastError);
    assert.strictEqual(h.sheetProxy.denied, 2);
    // คำขอใหม่ที่ไม่มีชุดเดิมตอน Google ล่ม: ส่ง error ของ Google ต่อให้ Dify (โหนดใน Dify ใช้ค่าสำรอง)
    assert.strictEqual((await req(portA, 'GET', DIFY.replace('product_usage%21A%3AT', 'product_packages'), KEY)).status, 500);
    G.fail = 0;

    // B (V.2): อ่านชีทผ่านตัวกลางของ A ไม่ต้องมี key ของ Google
    const tokensBefore = G.tokens;
    b = startBridge(portB, { PRODUCT_SHEET_PROXY_URL: 'http://127.0.0.1:' + portA + '/sheets', PRODUCT_SHEET_PROXY_KEY: PROXY_KEY, STATE_DIR: dirB });
    h = await waitHealth(portB, (x) => x.productMaster.ok, 'B product master via proxy');
    assert.deepStrictEqual([h.productMaster.products, h.sheetAuth.mode, h.sheetAuth.ok, h.sheetProxy], [2, 'proxy', true, false]);
    assert.strictEqual(G.tokens, tokensBefore, 'V.2 ไม่ขอ token จาก Google เอง');
    assert.strictEqual((await req(portB, 'GET', DIFY, KEY)).status, 503, 'V.2 ไม่มีตัวกลางของตัวเอง (ไม่ได้ตั้ง SHEET_PROXY_KEY)');
    b.child.kill();
    b = null;

    // บอทจริงที่ตั้ง SHEET_PROXY_KEY แล้วแต่ยังไม่มี key ของ Google: key ผิดได้ 401 key ถูกได้ 503 (ใช้ทดสอบโหนดใน Dify ก่อนใส่ key)
    b = startBridge(portB, { SHEET_PROXY_KEY: PROXY_KEY, STATE_DIR: dirB });
    await waitHealth(portB, (x) => x.sheetProxy && x.sheetProxy.ready === false, 'proxy without Google key');
    assert.strictEqual((await req(portB, 'GET', DIFY, { 'x-sheet-key': 'wrong-key' })).status, 401);
    r = await req(portB, 'GET', DIFY, KEY);
    assert.deepStrictEqual([r.status, /GOOGLE_SA_JSON/.test(r.json.error.message)], [503, true]);
    b.child.kill();
    b = null;

    // C: A เริ่มใหม่ตอน Google ไม่ให้อ่าน (เช่นถอดสิทธิ์ service account) ใช้ข้อมูลชุดล่าสุดใน Volume
    a.child.kill();
    await sleep(300);
    G.fail = 403;
    a = startBridge(portA, envA);
    h = await waitHealth(portA, (x) => !x.productMaster.ok && x.productMaster.cachedAt > 0, 'A restart with the saved copy');
    assert.strictEqual(h.productMaster.products, 2, 'ใช้ชุดที่เก็บไว้ได้ครบ');
    assert(/service account: sheets HTTP 403: The caller does not have permission/.test(h.productMaster.error), h.productMaster.error);
    assert.deepStrictEqual([h.sheetAuth.ok, /403/.test(h.sheetAuth.error)], [false, true]);
    assert(/using the saved sheet copy/.test(a.log()), 'ต้อง log ว่าใช้ชุดที่เก็บไว้');
  } catch (e) {
    console.log(a.log().slice(-2500));
    if (b) console.log(b.log().slice(-1500));
    throw e;
  } finally {
    a.child.kill();
    if (b) b.child.kill();
    google.close();
  }
  console.log('PASS: private product sheet: the main bot reads it with the service account, keeps a copy on the volume, and serves Dify through /sheets/v4 (key required, product sheet only, read only, 60 s reuse, last copy when Google fails); V.2 reads through the main bot; a restart while Google refuses uses the saved copy');
})().catch((e) => { console.error(e); process.exit(1); });
