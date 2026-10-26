'use strict';

// v3.38 (FB-09): streaming client for Dify chat-messages.
const assert = require('assert');
const http = require('http');
const { streamChat } = require('../dify_stream');

const line = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const ids = { conversation_id: 'c1', message_id: 'm1' };

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const p = JSON.parse(body);
    if (p.response_mode !== 'streaming' || req.headers.authorization !== 'Bearer k') { res.writeHead(500); return res.end('bad request from client'); }
    if (p.query === 'http-error') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"code":"invalid_param"}'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(line(Object.assign({ event: 'workflow_started' }, ids)));
    res.write('event: ping\n\n');
    if (p.query === 'workflow-error') { res.write(line({ event: 'error', status: 500, code: 'internal', message: 'LLM failed' })); return res.end(); }
    const first = line(Object.assign({ event: 'message', answer: 'สวัสดี' }, ids));
    res.write(first.slice(0, 15)); // one event split across two network chunks
    setTimeout(() => {
      res.write(first.slice(15));
      if (p.query === 'cut') return setTimeout(() => res.socket.destroy(), 20);
      res.write(line(Object.assign({ event: 'message', answer: 'ค่ะ' }, ids)));
      if (p.query !== 'no-end') res.write(line(Object.assign({ event: 'message_end' }, ids)));
      res.end();
    }, 30);
  });
});

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port + '/v1/';
  const ask = (query) => streamChat({ base, key: 'k', payload: { query, user: 'u', inputs: {}, response_mode: 'blocking' }, timeoutMs: 5000 });
  try {
    let r = await ask('ok');
    assert.deepStrictEqual([r.status, r.answer, r.ended, r.error, r.conversationId, r.messageId], [200, 'สวัสดีค่ะ', true, '', 'c1', 'm1']);
    r = await ask('cut');
    assert.strictEqual(r.answer, 'สวัสดี');
    assert.ok(r.error, 'a broken stream must be reported');
    assert.strictEqual(r.messageId, 'm1');
    r = await ask('no-end');
    assert.ok(r.error, 'an answer without message_end must be checked against /messages');
    r = await ask('workflow-error');
    assert.ok(/stream error 500 internal LLM failed/.test(r.error), r.error);
    r = await ask('http-error');
    assert.ok(r.error.startsWith('HTTP 400'), r.error);
    console.log('PASS: Dify stream joins split events, reports cut or failed streams, and keeps the message id for recovery');
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close();
});
