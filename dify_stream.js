'use strict';

// v3.38 (LINE feedback FB-09, 26 Oct 2026): Dify Cloud ends a blocking
// chat-messages request after about 100 seconds while the workflow keeps
// running. On 21 Oct a 134-second run finished in Dify but the customer saw
// "ระบบขัดข้องชั่วคราว". Streaming keeps the connection alive (Dify sends ping
// events) and returns the message id early, so a broken stream can still pick
// up the finished answer from /messages.

const http = require('http');
const https = require('https');

function streamChat(opts) {
  const { base, key, payload } = opts;
  const timeoutMs = opts.timeoutMs || 240000;
  const idleMs = opts.idleMs || 120000;
  return new Promise((resolve) => {
    const u = new URL(base.replace(/\/+$/, '') + '/chat-messages');
    const body = JSON.stringify(Object.assign({}, payload, { response_mode: 'streaming' }));
    // v3.50 (28 Oct 2026): เก็บโหนดที่พัง (exception/failed) และโหนดที่ต้องลองใหม่ สำหรับสถิติคุณภาพ
    // โหนดที่พังแบบมีค่า default ยังให้คำตอบได้ ลูกค้าไม่เห็น error แต่คำตอบมักช้าและอ่อนลง
    const out = { status: 0, answer: '', conversationId: '', messageId: '', ended: false, error: '', nodeIssues: [], nodeRetries: [], workflowStatus: '' };
    let buf = '', raw = '', done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(hard);
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
          if (ev.event === 'message' || ev.event === 'agent_message') out.answer += ev.answer || '';
          else if (ev.event === 'message_replace') out.answer = ev.answer || '';
          else if (ev.event === 'message_end') out.ended = true;
          else if (ev.event === 'node_finished') {
            const d = ev.data || {};
            if (d.status && d.status !== 'succeeded') out.nodeIssues.push({ title: String(d.title || d.node_id || '').slice(0, 80), status: String(d.status), error: String(d.error || '').slice(0, 160) });
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
    req.write(body);
    req.end();
  });
}

module.exports = { streamChat };
