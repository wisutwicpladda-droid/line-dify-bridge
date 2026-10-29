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
    if (p.query === 'node-issues') { // v3.50: โหนดที่พังแบบมีค่า default ยังให้คำตอบ แต่ต้องนับได้
      res.write(line({ event: 'node_finished', data: { title: 'เตรียมข้อมูล Jev', status: 'succeeded' } }));
      res.write(line({ event: 'node_finished', data: { title: 'Gemini วิเคราะห์บริบทและคำค้น', status: 'exception', error: 'Invalid context structure' } }));
      res.write(line({ event: 'node_retry', data: { title: 'จัดข้อมูลสินค้า/วิธีใช้' } }));
      res.write(line({ event: 'workflow_finished', data: { status: 'partial-succeeded' } }));
    }
    if (p.query === 'usage') { // v3.55: token และค่าใช้จ่ายรายโหนดสำหรับหน้าค่าใช้จ่าย
      res.write(line({ event: 'node_finished', data: { title: 'Gemini สรุปคำตอบ', node_type: 'llm', status: 'succeeded', process_data: { model_name: 'gemini-3.8-flash', usage: { prompt_tokens: 1, completion_tokens: 1 } }, outputs: { text: 'คำตอบ', usage: { prompt_tokens: 16000, completion_tokens: 3000, total_tokens: 19000, total_price: '0.02325', currency: 'USD' } }, execution_metadata: { total_tokens: 19000, total_price: '0.02325', currency: 'USD' } } }));
      res.write(line({ event: 'node_finished', data: { title: 'ตัวแยกสำรอง (Gemini)', node_type: 'question-classifier', status: 'succeeded', process_data: { model_name: 'gemini-3.8-flash', usage: { prompt_tokens: 900, completion_tokens: 20 } }, outputs: { class_name: 'farm' }, execution_metadata: { total_tokens: 1000, total_price: 0.0009, currency: 'USD' } } }));
      res.write(line({ event: 'node_finished', data: { title: 'วนทุกพืช', node_type: 'iteration', status: 'succeeded', execution_metadata: { total_tokens: 5000, total_price: 0.004, currency: 'USD' } } }));
      res.write(line({ event: 'node_finished', data: { title: 'Jev (OpenRouter)', node_type: 'http-request', status: 'succeeded', outputs: { status_code: 200, body: JSON.stringify({ answers: {}, usage: { cost: 0.00006 } }) } } }));
      res.write(line({ event: 'node_finished', data: { title: 'อ่าน Google Sheets สินค้า/วิธีใช้', node_type: 'http-request', status: 'succeeded', outputs: { status_code: 200, body: '{"values":[]}' } } }));
      res.write(line({ event: 'node_finished', data: { title: 'จัดข้อมูลสินค้า/วิธีใช้', node_type: 'code', status: 'succeeded', outputs: { result: 'x' } } }));
      res.write(line({ event: 'node_finished', data: { title: 'ค้น KB', node_type: 'knowledge-retrieval', status: 'succeeded', execution_metadata: { total_tokens: 60, total_price: 0.0000078, currency: 'USD' } } }));
    }
    const first = line(Object.assign({ event: 'message', answer: 'สวัสดี' }, ids));
    res.write(first.slice(0, 15)); // one event split across two network chunks
    setTimeout(() => {
      res.write(first.slice(15));
      if (p.query === 'cut') return setTimeout(() => res.socket.destroy(), 20);
      res.write(line(Object.assign({ event: 'message', answer: 'ค่ะ' }, ids)));
      if (p.query !== 'no-end') res.write(line(Object.assign({ event: 'message_end', metadata: p.query === 'usage' ? { usage: { prompt_tokens: 17000, completion_tokens: 3100, total_tokens: 20100, total_price: '0.024', currency: 'USD' } } : {} }, ids)));
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
    r = await ask('node-issues');
    assert.strictEqual(r.answer, 'สวัสดีค่ะ');
    assert.strictEqual(r.error, '');
    assert.deepStrictEqual(r.nodeIssues, [{ title: 'Gemini วิเคราะห์บริบทและคำค้น', status: 'exception', error: 'Invalid context structure' }]);
    assert.deepStrictEqual(r.nodeRetries, ['จัดข้อมูลสินค้า/วิธีใช้']);
    assert.strictEqual(r.workflowStatus, 'partial-succeeded');
    assert.deepStrictEqual(r.usage, [], 'events without token usage add nothing');
    assert.strictEqual(r.messageUsage, null);
    r = await ask('usage');
    assert.strictEqual(r.answer, 'สวัสดีค่ะ');
    assert.deepStrictEqual(r.usage.map((u) => u.title), ['Gemini สรุปคำตอบ', 'ตัวแยกสำรอง (Gemini)', 'Jev (OpenRouter)', 'อ่าน Google Sheets สินค้า/วิธีใช้', 'ค้น KB'], 'iteration and code nodes are skipped');
    assert.deepStrictEqual(r.usage[0], { title: 'Gemini สรุปคำตอบ', type: 'llm', status: 'succeeded', model: 'gemini-3.8-flash', inTok: 16000, outTok: 3000, tokens: 19000, difyUsd: 0.02325, extraUsd: 0 }, 'outputs.usage wins over process_data.usage');
    assert.deepStrictEqual([r.usage[1].inTok, r.usage[1].outTok, r.usage[1].tokens, r.usage[1].difyUsd], [900, 20, 1000, 0.0009], 'classifier usage from process_data');
    assert.strictEqual(r.usage[2].extraUsd, 0.00006, 'OpenRouter reports its own cost in the body');
    assert.deepStrictEqual([r.usage[3].tokens, r.usage[3].difyUsd, r.usage[3].extraUsd], [0, 0, 0]);
    assert.deepStrictEqual([r.usage[4].type, r.usage[4].tokens, r.usage[4].difyUsd], ['knowledge-retrieval', 60, 0.0000078]);
    assert.deepStrictEqual(r.messageUsage, { title: '', type: 'llm', status: 'succeeded', model: '', inTok: 17000, outTok: 3100, tokens: 20100, difyUsd: 0.024, extraUsd: 0 });
    console.log('PASS: Dify stream joins split events, reports cut or failed streams, keeps the message id for recovery, and reads token usage per node for the cost page');
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close();
});
