'use strict';
// v3.42: ล็อก IP ที่ใส่รหัสแอดมินผิดหลายครั้ง (admin_guard.js) ทั้งแบบหน่วย และเปิด server.js จริงโดยไม่ต่อบริการภายนอก
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createAdminGuard } = require('../admin_guard');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function get(port, p, headers) {
  return new Promise((resolve) => {
    const rq = http.get({ host: '127.0.0.1', port, path: p, headers: headers || {} }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    rq.on('error', () => resolve(0));
  });
}

(async () => {
  // ---- หน่วย ----
  let t = 1e12; const logs = [];
  const g = createAdminGuard({ maxFails: 3, windowMs: 15 * 60000, lockMs: 15 * 60000, now: () => t, log: (m) => logs.push(m) });
  const req = (xff, remote) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote || '10.0.0.1' } });
  assert.strictEqual(g.clientIp(req('1.1.1.1, 203.0.113.5')), '203.0.113.5', 'ใช้ค่าขวาสุดของ X-Forwarded-For ที่ proxy เติม');
  assert.strictEqual(g.clientIp(req('', '10.0.0.9')), '10.0.0.9');
  assert.strictEqual(g.clientIp({ headers: { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 10.0.0.2' }, socket: {} }), '203.0.113.7', 'มี X-Real-IP จาก Railway ใช้ค่านั้นก่อน');
  const ip = '203.0.113.5';
  for (let i = 0; i < 10; i++) g.fail(ip, 'old-key');
  assert.strictEqual(g.lockedFor(ip), 0, 'รหัสผิดตัวเดิมซ้ำ (หน้าแอดมินที่เปิดค้างไว้ด้วยรหัสเก่า) ไม่ทำให้ล็อก');
  assert.deepStrictEqual(logs, ['[admin] wrong key from 203.0.x.x (1/3)'], 'log รหัสผิดเฉพาะครั้งแรกของแต่ละรหัส และซ่อนเลข IP บางส่วน');
  g.fail(ip, 'guess-1'); assert.strictEqual(g.lockedFor(ip), 0, 'ยังไม่ครบจำนวนครั้ง');
  g.fail(ip, 'guess-2'); assert.strictEqual(g.lockedFor(ip), 15, 'รหัสผิดไม่ซ้ำกันครบ 3 ตัวแล้วล็อก 15 นาที'); assert.match(logs[logs.length - 1], /locked 203\.0\.x\.x/);
  assert.strictEqual(g.lockedFor('198.51.100.7'), 0, 'IP อื่นไม่โดนล็อก');
  t += 14 * 60000; assert.ok(g.lockedFor(ip) > 0);
  t += 2 * 60000; assert.strictEqual(g.lockedFor(ip), 0, 'หมดเวลาล็อก');
  g.fail(ip, 'guess-3'); assert.strictEqual(g.lockedFor(ip), 0, 'เริ่มนับใหม่หลังหมดเวลาล็อก');
  g.fail('9.9.9.9', 'a'); g.fail('9.9.9.9', 'b'); g.ok('9.9.9.9'); g.fail('9.9.9.9', 'c'); g.fail('9.9.9.9', 'd');
  assert.strictEqual(g.lockedFor('9.9.9.9'), 0, 'ใส่รหัสถูกแล้วล้างตัวนับ');

  // ---- เปิด server.js จริง ----
  const port = await freePort();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-admin-'));
  const dead = 'http://127.0.0.1:9';
  const env = Object.assign({}, process.env, {
    PORT: String(port), LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_ACCESS_TOKEN: 't', DIFY_API_KEY: 'k',
    ADMIN_KEY: 'RightKey123', ADMIN_MAX_FAILS: '3', STATE_DIR: stateDir, REGISTER: 'off',
    LINE_API_BASE: dead, LINE_DATA_API_BASE: dead, DIFY_API_BASE: dead + '/v1', TEAM_SHEET_URL: dead + '/team',
    PRODUCT_SHEET_ID: 'offline-test', PRODUCT_IMAGES: 'off', DIFY_DATASET_KEY: '', SUPABASE_URL: '', SUPABASE_KEY: '', SUPABASE_SERVICE_KEY: '',
    ADMIN_NOTIFY_IDS: '', SALES_LEAD_TARGETS: '', LEAD_LINE_TOKEN: '', LIFF_ID: '', RAILWAY_VOLUME_MOUNT_PATH: '', SEED_USER_IDS: ''
  });
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  app.stdout.on('data', (d) => { log += d; });
  app.stderr.on('data', (d) => { log += d; });
  try {
    let up = 0;
    for (let i = 0; i < 50 && up !== 200; i++) { await sleep(200); up = await get(port, '/'); }
    assert.strictEqual(up, 200, 'server did not start');
    const A = '198.51.100.1', B = '203.0.113.9';
    const h = (key, xff) => ({ 'x-admin-key': key, 'x-forwarded-for': xff });
    assert.strictEqual(await get(port, '/admin/api/list', h('RightKey123', A)), 200, 'รหัสถูกเข้าได้');
    for (let i = 0; i < 6; i++) assert.strictEqual(await get(port, '/admin/api/list', h('old-key', A)), 401, 'หน้าที่เปิดค้างไว้ด้วยรหัสเก่าได้ 401 แต่ไม่ถูกล็อก');
    assert.strictEqual(await get(port, '/admin/api/list', h('RightKey123', A)), 200, 'รหัสเก่าซ้ำไม่ทำให้ล็อก IP');
    for (const k of ['guess-1', 'guess-2', 'guess-3']) assert.strictEqual(await get(port, '/admin/api/list', h(k, A)), 401, 'รหัสผิดได้ 401');
    assert.strictEqual(await get(port, '/admin/api/list', h('RightKey123', A)), 429, 'IP ที่ถูกล็อกได้ 429 แม้รหัสถูก');
    assert.strictEqual(await get(port, '/admin/api/list', h('RightKey123', '1.2.3.4, ' + A)), 429, 'ใส่ IP ปลอมทางซ้ายของ X-Forwarded-For ไม่ช่วยปลดล็อก');
    assert.strictEqual(await get(port, '/admin/api/list', h('RightKey123', B)), 200, 'IP อื่นยังเข้าได้');
    assert.strictEqual(await get(port, '/admin/api/list', Object.assign(h('RightKey123', A), { 'x-real-ip': B })), 200, 'ใช้ X-Real-IP ที่ Railway ตั้งก่อน X-Forwarded-For');
    assert.match(log, /\[admin\] locked 198\.51\.x\.x/);
    assert.match(log, /\[admin\] wrong key from 198\.51\.x\.x \(1\/3\)/);
  } catch (e) {
    console.error('--- server log ---\n' + log.slice(-2000));
    throw e;
  } finally {
    app.kill();
  }
  console.log('PASS: admin lockout (locks one IP after distinct wrong keys, a stale page repeating an old key is not locked, 429 even with the right key while locked, other IPs unaffected, spoofed X-Forwarded-For ignored, counter resets)');
})().catch((e) => { console.error(e); process.exit(1); });
