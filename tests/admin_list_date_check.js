'use strict';

// v3.68: รายการแชทในหน้าแอดมินกรองตามวันที่ (เวลาไทย) กับ server.js จริง
// แชทผ่านเกณฑ์เมื่อข้อความล่าสุดหรือข้อความใดในประวัติอยู่ในช่วง ใส่สลับกันได้ ค่าที่ผิด = ทุกแชท
const assert = require('assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ADMIN = 'test-admin';
const T = (iso) => Date.parse(iso);
const sess = (lastAt, ats) => ({ name: 'n', type: 'user', lastText: 'x', lastAt, history: ats.map((at) => ({ r: 'u', t: 'x', at })) });
const SESSIONS = [
  ['Ua', sess(T('2026-11-01T10:00:00+07:00'), [T('2026-10-20T09:00:00+07:00'), T('2026-11-01T10:00:00+07:00')])],
  ['Ub', sess(T('2026-10-25T08:00:00+07:00'), [T('2026-10-25T08:00:00+07:00')])],
  ['Uc', sess(T('2026-11-02T23:30:00+07:00'), [T('2026-11-02T23:30:00+07:00')])] // 16:30 UTC ยังเป็นวันที่ 2 ตามเวลาไทย
];

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { 'x-admin-key': ADMIN } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch (e) { reject(new Error(res.statusCode + ' ' + b.slice(0, 200))); } });
    }).on('error', reject);
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladda-listdate-'));
  fs.writeFileSync(path.join(dir, 'nladda-state.json'), JSON.stringify({ v: 2, savedAt: Date.now(), sessions: SESSIONS, crm: [], crmNotes: [] }));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_ACCESS_TOKEN: 'x', ADMIN_KEY: ADMIN, STATE_DIR: dir, REGISTER: 'off',
      LINE_API_BASE: 'http://127.0.0.1:9', DIFY_API_KEY: '', DIFY_DATASET_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', POS_TABLE: '',
      PRODUCT_SHEET_ID: 'offline-test', TEAM_SHEET_URL: 'http://127.0.0.1:9/team-sheet', SALES_LEAD_TARGETS: '', LEAD_LINE_TOKEN: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  try {
    let ok = false;
    for (let i = 0; i < 50 && !ok; i++) { await new Promise((r) => setTimeout(r, 200)); ok = await get(port, '/admin/api/list').then((r) => r.status === 200, () => false); }
    assert(ok, 'server did not start\n' + log.slice(-800));
    const ids = async (q) => { const r = await get(port, '/admin/api/list' + q); return [r.json.sessions.map((s) => s.id).sort(), r.json.range]; };
    assert.deepStrictEqual(await ids(''), [['Ua', 'Ub', 'Uc'], null], 'ไม่กรอง = ทุกแชท');
    assert.deepStrictEqual(await ids('?from=2026-11-01&to=2026-11-01'), [['Ua'], { from: '2026-11-01', to: '2026-11-01' }]);
    assert.deepStrictEqual((await ids('?from=2026-10-20&to=2026-10-20'))[0], ['Ua'], 'ข้อความเก่าในประวัติก็นับ');
    assert.deepStrictEqual((await ids('?from=2026-11-02&to=2026-11-02'))[0], ['Uc'], '23.30 น. เวลาไทยยังเป็นวันที่ 2');
    assert.deepStrictEqual((await ids('?from=2026-11-03&to=2026-11-03'))[0], [], 'ไม่มีแชทวันที่ 3');
    assert.deepStrictEqual(await ids('?from=2026-11-02&to=2026-10-25'), [['Ua', 'Ub', 'Uc'], { from: '2026-10-25', to: '2026-11-02' }], 'ใส่สลับกันได้');
    assert.deepStrictEqual((await ids('?from=2026-10-26&to=2026-10-31'))[0], [], 'ช่วงที่ไม่มีข้อความ');
    for (const bad of ['?from=2026-11-01', '?from=1/11/2026&to=2026-11-01', '?from=2026-13-45&to=2026-13-45']) {
      assert.deepStrictEqual(await ids(bad), [['Ua', 'Ub', 'Uc'], null], 'ค่าผิด = ทุกแชท ' + bad);
    }
    // v3.69 ปฏิทินรายเดือน: จำนวนแชทที่มีข้อความในแต่ละวันของเดือน (เวลาไทย) เดือนที่มีแชท และจำนวนแชทที่ตรงทั้งหมด
    let r = (await get(port, '/admin/api/list?from=2026-11-01&to=2026-11-30&month=2026-11')).json;
    assert.deepStrictEqual([r.monthDays, r.months, r.matched, r.sessions.length], [{ '2026-11-01': 1, '2026-11-02': 1 }, ['2026-11', '2026-10'], 2, 2]);
    r = (await get(port, '/admin/api/list?from=2026-10-20&to=2026-10-20&month=2026-10')).json;
    assert.deepStrictEqual([r.monthDays, r.matched, r.sessions.map((s) => s.id)], [{ '2026-10-20': 1, '2026-10-25': 1 }, 1, ['Ua']], 'เลือกวันในปฏิทินแล้วตัวเลขทั้งเดือนยังอยู่');
    r = (await get(port, '/admin/api/list?from=2026-09-01&to=2026-09-30&month=2026-09')).json;
    assert.deepStrictEqual([r.monthDays, r.matched], [{}, 0]);
    r = (await get(port, '/admin/api/list')).json;
    assert.deepStrictEqual([r.monthDays, r.months, r.matched], [undefined, undefined, 3], 'ไม่ขอปฏิทิน = ไม่นับรายวัน');
    console.log('PASS: the admin chat list filters by date (Thai time), counts any message in the chat history, accepts swapped dates, ignores bad dates, and counts chats per day of a month for the calendar');
  } finally {
    child.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
