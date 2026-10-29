'use strict';

// v3.56 (29 ต.ค. 2569): ส่งบันทึกค่าใช้จ่ายต่อไปยังหน้าค่าใช้จ่ายของ bridge อื่น
// ใช้กับ V.2 และชุดทดสอบ (relay ในเครื่อง) ให้ส่งเข้าหน้าของบอทจริง เพราะทุกแอปใช้ Gemini key และบิลเดียวกัน
// ตั้ง COST_FORWARD_URL (เช่น https://<บอทจริง>/admin/api/cost/ingest) และ COST_FORWARD_KEY (= COST_INGEST_KEY ของปลายทาง)
// ส่งทันทีที่บันทึก ถ้าไม่สำเร็จเก็บในคิว (สูงสุด 500 รายการ) แล้วลองใหม่ทุก 2 นาที ครั้งละไม่เกิน 50 รายการ
// ปลายทางกันนับซ้ำด้วย id ของบันทึก ส่งซ้ำได้ปลอดภัย · ปลายทางตอบ 401 (รหัสผิด) = หยุดส่งจนกว่าจะ restart
// เพื่อไม่ให้ IP ถูกล็อกจากการใส่รหัสผิดซ้ำ ๆ
const http = require('http');
const https = require('https');

function post(url, key, body, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (_) { return resolve({ status: 0, error: 'bad url' }); }
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = (u.protocol === 'http:' ? http : https).request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + (u.search || ''), method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'x-cost-key': key },
      timeout: timeoutMs || 15000
    }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (t.length < 2000) t += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.end(data);
  });
}

function createForwarder(opts) {
  const o = opts || {};
  const url = String(o.url || '').trim();
  const key = String(o.key || '').trim();
  const log = o.log || (() => {});
  const state = { on: !!(url && key), sent: 0, failed: 0, error: '', at: 0, stopped: false };
  let queue = [];
  let busy = false;

  async function flush() {
    if (!state.on || state.stopped || busy || !queue.length) return;
    busy = true;
    try {
      while (queue.length && !state.stopped) {
        const batch = queue.slice(0, 50);
        const r = await post(url, key, { records: batch }, o.timeoutMs);
        if (r.status === 401) {
          state.stopped = true;
          state.error = 'ปลายทางไม่รับรหัส (401) หยุดส่ง';
          log('[cost] forward key rejected by ' + new URL(url).host + ', stop forwarding (check COST_FORWARD_KEY)');
          break;
        }
        if (r.status !== 200) {
          state.failed++;
          state.error = r.error || ('HTTP ' + r.status);
          log('[cost] forward failed: ' + state.error + ' (' + queue.length + ' waiting)');
          break;
        }
        queue = queue.slice(batch.length);
        state.sent += batch.length;
        state.error = '';
        state.at = Date.now();
      }
    } finally { busy = false; }
  }

  function send(rec) {
    if (!state.on || state.stopped || !rec) return;
    queue.push(rec);
    if (queue.length > 500) queue = queue.slice(-500);
    return flush();
  }

  let timer = null;
  if (state.on && o.retryMs !== 0) {
    timer = setInterval(flush, o.retryMs || 120000);
    if (timer.unref) timer.unref();
  }
  return { send, flush, state, pending: () => queue.length, stop: () => { if (timer) clearInterval(timer); } };
}

module.exports = { createForwarder, post };
