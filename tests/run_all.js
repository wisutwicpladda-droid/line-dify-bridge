'use strict';
// รันเทสทุกไฟล์ *_check.js ในโฟลเดอร์นี้ทีละไฟล์ (npm test) ผ่านครบ = exit 0 · ตัวที่ตกจะแสดงข้อความ error และบรรทัดท้ายของ output
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('_check.js')).sort();
let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 120000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  if (!ok) {
    const lines = ((r.stdout || '') + (r.stderr || '') + (r.error ? '\n' + r.error.message : '')).trim().split('\n');
    const show = [...new Set(lines.filter((l) => /Error|FAIL/.test(l)).slice(0, 3).concat(lines.slice(-12)))];
    console.log(show.map((l) => '    ' + l).join('\n'));
  }
}
console.log('\n' + (files.length - failed) + '/' + files.length + ' passed');
process.exit(failed ? 1 : 0);
