'use strict';

// v3.56: ส่งบันทึกค่าใช้จ่ายต่อไปยังหน้าค่าใช้จ่ายของบอทจริง (cost_forward.js)
const assert = require('assert');
const http = require('http');
const { createForwarder } = require('../cost_forward');

const got = [];
let mode = 'ok';
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    if (req.headers['x-cost-key'] !== 'k-123') { res.writeHead(401); return res.end('{}'); }
    if (mode === 'down') { res.writeHead(503); return res.end('{}'); }
    got.push(JSON.parse(b));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});

server.listen(0, '127.0.0.1', async () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/admin/api/cost/ingest';
  try {
    const off = createForwarder({ url: '', key: '' });
    assert.strictEqual(off.state.on, false);
    off.send({ id: 'x' });
    assert.strictEqual(off.pending(), 0, 'ไม่ได้ตั้งปลายทาง ต้องไม่เก็บคิว');

    const f = createForwarder({ url, key: 'k-123', retryMs: 0 });
    await f.send({ id: 'a1', at: 1 });
    assert.deepStrictEqual(got.map((x) => x.records.map((r) => r.id)), [['a1']]);
    mode = 'down';
    await f.send({ id: 'a2', at: 2 });
    await f.send({ id: 'a3', at: 3 });
    assert.strictEqual(f.pending(), 2, 'ส่งไม่สำเร็จต้องเก็บไว้ในคิว');
    assert(/503/.test(f.state.error), f.state.error);
    mode = 'ok';
    await f.flush();
    assert.strictEqual(f.pending(), 0);
    assert.deepStrictEqual(got[got.length - 1].records.map((r) => r.id), ['a2', 'a3'], 'ส่งที่ค้างเป็นชุดเดียว ตามลำดับ');
    assert.strictEqual(f.state.sent, 3);

    const wrong = createForwarder({ url, key: 'wrong', retryMs: 0, log: () => {} });
    await wrong.send({ id: 'b1' });
    assert.strictEqual(wrong.state.stopped, true, 'รหัสผิดต้องหยุดส่ง ไม่ส่งรหัสผิดซ้ำจน IP ถูกล็อก');
    await wrong.send({ id: 'b2' });
    assert.strictEqual(wrong.pending(), 1, 'หยุดแล้วไม่เพิ่มคิว');
    console.log('PASS: cost forwarder sends records, keeps failed ones for retry in order, and stops on a rejected key');
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close();
});
