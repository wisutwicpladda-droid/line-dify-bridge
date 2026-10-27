'use strict';
// v3.39 + v3.42: แจ้ง LINE เมื่อเครดิต OpenAI หมด และเมื่อข้อมูลใน Knowledge มีปัญหา (kb_health.js) ทดสอบกับ Knowledge API จำลอง
const assert = require('assert');
const { createKbHealth } = require('../kb_health');

(async () => {
  const quiet = console.log; console.log = () => {};
  try {
    let t = 1e12; const now = () => t;
    const HOUR = 3600e3, DAY = 24 * HOUR;
    const SHEET = 'สินค้า_จาก_GoogleSheet.md';

    // 1) เครดิตหมด -> แจ้งวันละครั้ง -> กลับมาใช้ได้ -> บอกเอกสารที่ต้อง Retry -> Retry แล้วแจ้งว่าปกติ
    const sent = []; let resyncs = 0;
    let retrieve = { status: 400, text: '[openai] Rate Limit Error, Error code: 429 - You exceeded your current quota, please check your plan and billing details. insufficient_quota' };
    let docs = [{ name: SHEET, enabled: true, indexing_status: 'error', error: 'Error code: 429 - insufficient_quota' }, { name: 'dify_icpladda_index.md', enabled: true, indexing_status: 'completed' }];
    const api = async (m, p) => (p.endsWith('/retrieve') ? retrieve : { status: 200, data: { data: docs } });
    const h = createKbHealth({ api, datasetId: 'ds', sheetDocName: SHEET, notify: async (m) => { sent.push(m); }, resync: async () => { resyncs++; return { ok: false }; }, now });
    await h.check(); assert.strictEqual(sent.length, 1); assert.match(sent[0], /เครดิต OpenAI หมด/);
    t += HOUR; await h.check(); assert.strictEqual(sent.length, 1, 'no repeat within 24h');
    t += DAY; await h.check(); assert.strictEqual(sent.length, 2, 'repeat after 24h');
    retrieve = { status: 200, text: '{}' };
    t += HOUR; await h.check(); assert.strictEqual(sent.length, 3); assert.match(sent[2], /กลับมาใช้ได้/); assert.strictEqual(resyncs, 1);
    assert.match(sent[2], /สินค้า_จาก_GoogleSheet\.md ค้าง Error/, 'Dify does not update a document stuck in Error, so it must be listed for Retry');
    t += HOUR; await h.check(); assert.strictEqual(sent.length, 3, 'no repeat while the same document waits for Retry');
    docs = [{ name: SHEET, enabled: true, indexing_status: 'completed' }];
    t += HOUR; await h.check(); assert.strictEqual(sent.length, 4); assert.match(sent[3], /กลับมาปกติ/);
    t += HOUR; await h.check(); assert.strictEqual(sent.length, 4, 'quiet when healthy'); assert.strictEqual(h.status().ok, true);
    retrieve = { status: 500, text: 'Internal Server Error' };
    t += HOUR; await h.check(); assert.strictEqual(sent.length, 4, 'a Dify error that is not about credit is log only');

    // 2) ซิงก์ล้มติดกัน 3 รอบ -> แจ้ง · ปัญหาเดิมไม่แจ้งซ้ำใน 24 ชม. · ปัญหาใหม่แจ้งทันที · ครบ 24 ชม. แจ้งซ้ำ · หายหมดแจ้งว่าปกติ
    const sent2 = [];
    const sheetSync = { failStreak: 2, failSince: t, error: 'updated 400 {"code":"invalid_param","message":"Document is not available"}' };
    const indexSync = { failStreak: 0 };
    const okApi = async (m, p) => (p.endsWith('/retrieve') ? { status: 200 } : { status: 200, data: { data: [] } });
    const h2 = createKbHealth({ api: okApi, datasetId: 'ds', sheetDocName: SHEET, notify: async (m) => { sent2.push(m); }, now,
      syncStates: () => [{ label: 'ซิงก์เอกสารสินค้า', state: sheetSync }, { label: 'ซิงก์ดัชนี', state: indexSync }] });
    await h2.check(); assert.strictEqual(sent2.length, 0, 'two failed runs are not alerted yet');
    sheetSync.failStreak = 3; t += HOUR; await h2.check();
    assert.strictEqual(sent2.length, 1); assert.match(sent2[0], /ซิงก์เอกสารสินค้า ไม่สำเร็จ 3 รอบติดกัน/); assert.match(sent2[0], /Document is not available/);
    sheetSync.failStreak = 4; t += HOUR; await h2.check(); assert.strictEqual(sent2.length, 1, 'the same problem is not repeated within 24h');
    Object.assign(indexSync, { failStreak: 3, failSince: t, error: 'indexing error' }); t += HOUR; await h2.check();
    assert.strictEqual(sent2.length, 2, 'a new problem is alerted at once'); assert.match(sent2[1], /ซิงก์ดัชนี/);
    t += DAY; await h2.check(); assert.strictEqual(sent2.length, 3, 'repeat after 24h');
    sheetSync.failStreak = 0; indexSync.failStreak = 0; t += HOUR; await h2.check();
    assert.strictEqual(sent2.length, 4); assert.match(sent2[3], /กลับมาปกติ/);
    t += HOUR; await h2.check(); assert.strictEqual(sent2.length, 4, 'quiet when healthy');

    // 3) เอกสารค้าง Error ด้วยสาเหตุอื่น -> แจ้งให้ Retry พร้อมสาเหตุ วันละครั้ง
    const sent3 = [];
    const h3 = createKbHealth({ api: async (m, p) => (p.endsWith('/retrieve') ? { status: 200 } : { status: 200, data: { data: [{ name: 'dify_rice_underwater.md', indexing_status: 'error', error: 'Rate limit reached for embedding' }] } }),
      datasetId: 'ds', sheetDocName: SHEET, notify: async (m) => { sent3.push(m); }, now });
    await h3.check(); await h3.check(); assert.strictEqual(sent3.length, 1);
    assert.match(sent3[0], /dify_rice_underwater\.md ค้าง Error \(Rate limit/); assert.match(sent3[0], /Retry/);

    // 4) เครดิตหมด -> แจ้งเฉพาะเรื่องเครดิต ไม่แจ้งซิงก์ล้มซ้ำซ้อน
    const sent4 = [];
    const h4 = createKbHealth({ api: async (m, p) => (p.endsWith('/retrieve') ? { status: 400, text: 'insufficient_quota' } : { status: 200, data: { data: [] } }),
      datasetId: 'ds', sheetDocName: SHEET, notify: async (m) => { sent4.push(m); }, now,
      syncStates: () => [{ label: 'ซิงก์ดัชนี', state: { failStreak: 5, error: 'insufficient_quota' } }] });
    await h4.check(); assert.strictEqual(sent4.length, 1); assert.match(sent4[0], /เครดิต OpenAI หมด/); assert.doesNotMatch(sent4[0], /ซิงก์ดัชนี/);

    // 5) โหลดรายชื่อเอกสารไม่ได้ -> ไม่สรุปว่าปกติ (กันข้อความ ✅ ผิด)
    const sent5 = []; let listOk = true;
    const h5 = createKbHealth({ api: async (m, p) => (p.endsWith('/retrieve') ? { status: 200 }
      : (listOk ? { status: 200, data: { data: [{ name: 'x.md', indexing_status: 'error', error: 'boom' }] } } : { status: 502, text: 'bad gateway' })),
      datasetId: 'ds', sheetDocName: SHEET, notify: async (m) => { sent5.push(m); }, now });
    await h5.check(); assert.strictEqual(sent5.length, 1);
    listOk = false; t += HOUR; await h5.check(); assert.strictEqual(sent5.length, 1, 'no false recovery when the document list fails');
    assert.strictEqual(h5.status().ok, false);

    // 6) Dify ตอบ error เรื่องเครดิตระหว่างแชท -> เช็กทันที, error อื่นไม่เช็ก
    let calls = 0;
    const h6 = createKbHealth({ api: async () => { calls++; return { status: 200, data: { data: [] } }; }, datasetId: 'ds', sheetDocName: SHEET, notify: async () => {}, now });
    h6.checkSoon('timeout'); assert.strictEqual(calls, 0);
    h6.checkSoon('insufficient_quota'); await new Promise((r) => setTimeout(r, 20)); assert.ok(calls > 0);
  } finally { console.log = quiet; }
  console.log('PASS: Knowledge alerts (credit out once a day, recovery lists what still needs Retry, sync failing 3 runs in a row, documents stuck in Error, new problems alerted at once, recovery message, no false recovery, no double alert during a credit outage)');
})().catch((e) => { console.error(e); process.exit(1); });
