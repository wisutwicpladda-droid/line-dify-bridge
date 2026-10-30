'use strict';

// v3.38 (LINE feedback FB-09, 26 Oct 2026): Dify Cloud ends a blocking
// chat-messages request after about 100 seconds while the workflow keeps
// running. On 21 Oct a 134-second run finished in Dify but the customer saw
// "ระบบขัดข้องชั่วคราว". Streaming keeps the connection alive (Dify sends ping
// events) and returns the message id early, so a broken stream can still pick
// up the finished answer from /messages.

const http = require('http');
const https = require('https');

// v3.55 (29 Oct 2026): token และค่าใช้จ่ายของแต่ละโหนด สำหรับหน้า "ค่าใช้จ่าย" ในเว็บแอดมิน (cost.js)
// node_finished ของ Dify มี execution_metadata { total_tokens, total_price, currency } ส่วนโหนด LLM
// มี usage { prompt_tokens, completion_tokens } ใน outputs หรือ process_data และชื่อโมเดลใน process_data.model_name
// โหนด HTTP ที่ API ตอบค่าใช้จ่ายมาเอง (เช่น OpenRouter usage.cost) อ่านจาก body
// iteration/loop ข้าม เพราะโหนดข้างในส่ง node_finished ของตัวเองอยู่แล้ว จะนับซ้ำ
const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : 0; };
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
function usageOf(u, meta, extra) {
  const m = obj(meta);
  const cur = String(m.currency || u.currency || 'USD').toUpperCase();
  const inTok = num(u.prompt_tokens);
  const outTok = num(u.completion_tokens);
  return {
    inTok, outTok,
    tokens: num(m.total_tokens) || num(u.total_tokens) || inTok + outTok,
    difyUsd: cur === 'USD' ? num(m.total_price != null ? m.total_price : u.total_price) : 0,
    extraUsd: extra || 0
  };
}
function nodeUsage(d) {
  const type = String(d.node_type || '');
  if (type === 'iteration' || type === 'loop') return null;
  const pd = obj(d.process_data);
  const op = obj(d.outputs);
  const u = Object.keys(obj(op.usage)).length ? obj(op.usage) : obj(pd.usage);
  let extra = 0;
  if (type === 'http-request' && typeof op.body === 'string' && op.body.length < 200000 && op.body.includes('"cost"')) {
    try { const b = JSON.parse(op.body); extra = num(b && b.usage && b.usage.cost) || num(b && b.cost); } catch (_) {}
  }
  const x = usageOf(u, d.execution_metadata, extra);
  if (!x.tokens && !x.difyUsd && !x.extraUsd && type !== 'http-request') return null;
  return Object.assign({ title: String(d.title || d.node_id || '').slice(0, 80), type, status: String(d.status || ''), model: String(pd.model_name || '').slice(0, 60) }, x);
}

function streamChat(opts) {
  const { base, key, payload } = opts;
  const timeoutMs = opts.timeoutMs || 240000;
  const idleMs = opts.idleMs || 120000;
  // v3.59: opts.signal (AbortSignal) cancels the run when the customer sends another line before
  // the answer is sent (turn_queue.js). The stream is closed and Dify is asked to stop the task.
  const signal = opts.signal;
  return new Promise((resolve) => {
    const u = new URL(base.replace(/\/+$/, '') + '/chat-messages');
    const body = JSON.stringify(Object.assign({}, payload, { response_mode: 'streaming' }));
    // v3.50 (28 Oct 2026): เก็บโหนดที่พัง (exception/failed) และโหนดที่ต้องลองใหม่ สำหรับสถิติคุณภาพ
    // โหนดที่พังแบบมีค่า default ยังให้คำตอบได้ ลูกค้าไม่เห็น error แต่คำตอบมักช้าและอ่อนลง
    // v3.55: usage = token/ค่าใช้จ่ายรายโหนด · messageUsage = ยอดรวมของข้อความจาก message_end (ใช้เมื่อไม่มีรายโหนด)
    const out = { status: 0, answer: '', conversationId: '', messageId: '', taskId: '', ended: false, aborted: false, error: '', nodeIssues: [], nodeRetries: [], workflowStatus: '', usage: [], messageUsage: null };
    let buf = '', raw = '', done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(hard);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      if (err && !out.error) out.error = err;
      resolve(out);
    };
    const req = (u.protocol === 'http:' ? http : https).request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + (u.search || ''), method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Content-Length': Buffer.byteLength(body) },
      timeout: idleMs
    }, (res) => {
      out.status = res.statusCode;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (out.status !== 200) { raw += chunk; return; }
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
          if (ev.conversation_id) out.conversationId = ev.conversation_id;
          if (ev.message_id) out.messageId = ev.message_id;
          if (ev.task_id) out.taskId = ev.task_id;
          if (ev.event === 'message' || ev.event === 'agent_message') out.answer += ev.answer || '';
          else if (ev.event === 'message_replace') out.answer = ev.answer || '';
          else if (ev.event === 'message_end') {
            out.ended = true;
            const mu = obj(ev.metadata).usage;
            if (mu && typeof mu === 'object') out.messageUsage = Object.assign({ title: '', type: 'llm', status: 'succeeded', model: '' }, usageOf(mu, null, 0));
          } else if (ev.event === 'node_finished') {
            const d = ev.data || {};
            if (d.status && d.status !== 'succeeded') out.nodeIssues.push({ title: String(d.title || d.node_id || '').slice(0, 80), status: String(d.status), error: String(d.error || '').slice(0, 600) });
            const nu = nodeUsage(d);
            if (nu) out.usage.push(nu);
          } else if (ev.event === 'node_retry') {
            const d = ev.data || {};
            out.nodeRetries.push(String(d.title || d.node_id || '').slice(0, 80));
          } else if (ev.event === 'workflow_finished') out.workflowStatus = String((ev.data && ev.data.status) || '');
          else if (ev.event === 'error') out.error = ('stream error ' + (ev.status || '') + ' ' + (ev.code || '') + ' ' + String(ev.message || '')).slice(0, 300);
        }
      });
      res.on('end', () => {
        if (out.status !== 200) return finish('HTTP ' + out.status + ' ' + raw.slice(0, 300));
        // An answer without message_end may be cut short, so the caller fetches the finished one from /messages.
        finish(out.ended ? '' : (out.answer ? 'stream ended before message_end' : 'stream closed without an answer'));
      });
      res.on('error', (e) => finish(e.message));
      res.on('aborted', () => finish('stream aborted'));
      res.on('close', () => finish(out.ended ? '' : 'stream closed before message_end'));
    });
    const hard = setTimeout(() => { req.destroy(); finish('timeout after ' + Math.round(timeoutMs / 1000) + 's'); }, timeoutMs);
    req.on('timeout', () => { req.destroy(); finish('no data for ' + Math.round(idleMs / 1000) + 's'); });
    req.on('error', (e) => finish(e.message));
    let onAbort = null;
    if (signal) {
      onAbort = () => {
        if (done) return;
        out.aborted = true;
        if (out.taskId) stopTask(base, key, out.taskId, payload.user);
        req.destroy();
        finish('aborted');
      };
      if (signal.aborted) { out.aborted = true; done = true; clearTimeout(hard); out.error = 'aborted'; req.destroy(); return resolve(out); }
      signal.addEventListener('abort', onAbort);
    }
    req.write(body);
    req.end();
  });
}

// v3.59: POST /chat-messages/:task_id/stop so a cancelled run stops using tokens (best effort)
function stopTask(base, key, taskId, user) {
  try {
    const u = new URL(base.replace(/\/+$/, '') + '/chat-messages/' + encodeURIComponent(taskId) + '/stop');
    const body = JSON.stringify({ user: String(user || '') });
    const req = (u.protocol === 'http:' ? http : https).request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname, method: 'POST', timeout: 10000,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (_) {}
}

module.exports = { streamChat, nodeUsage, stopTask };
