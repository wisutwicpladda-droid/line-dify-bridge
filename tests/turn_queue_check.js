'use strict';

// v3.38 (FB-02): messages sent close together become one question, a chat never
// runs two Dify calls at once, and a photo waits for its caption.
const assert = require('assert');
const { createTurnQueue, turnQuery, isQuestionLine } = require('../turn_queue');

const IMAGE_Q = '[IMAGE]';
const STICKER_Q = '[STICKER]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let q = turnQuery([{ kind: 'text', text: 'หอมแดงใบไหม้' }, { kind: 'text', text: 'ใช้ยาอะไรดี' }], IMAGE_Q, STICKER_Q);
  assert.strictEqual(q.query, 'หอมแดงใบไหม้\nใช้ยาอะไรดี');
  assert.deepStrictEqual(q.images, []);
  q = turnQuery([{ kind: 'image', id: 'i1' }, { kind: 'text', text: 'เป็นโรคอะไร' }], IMAGE_Q, STICKER_Q);
  assert.deepStrictEqual(q.images, ['i1']);
  assert(q.query.startsWith('เป็นโรคอะไร\n') && q.query.includes('รูปภาพ 1 รูป') && q.query.endsWith(IMAGE_Q));
  assert.strictEqual(q.userText, 'เป็นโรคอะไร');
  assert.strictEqual(turnQuery([{ kind: 'image', id: 'i1' }], IMAGE_Q, STICKER_Q).query, IMAGE_Q);
  assert.strictEqual(turnQuery([{ kind: 'sticker' }], IMAGE_Q, STICKER_Q).query, STICKER_Q);

  const runs = [];
  const active = {};
  let overlap = false;
  let failOnce = true;
  const queue = createTurnQueue({
    textWaitMs: 60,
    imageWaitMs: 300,
    log: () => {},
    run: async (ctx, items) => {
      active[ctx.chat] = (active[ctx.chat] || 0) + 1;
      if (active[ctx.chat] > 1) overlap = true;
      runs.push({ token: ctx.token, items: items.map((x) => x.text || x.id) });
      try {
        await sleep(ctx.slow ? 400 : 10);
        if (ctx.fail && failOnce) { failOnce = false; throw new Error('Dify down'); }
      } finally { active[ctx.chat]--; }
    }
  });

  // two lines sent together -> one run, answered with the newest reply token
  assert.strictEqual(queue.push('A', { chat: 'A', token: 'a1' }, { kind: 'text', text: 'คำถาม 1' }), 'first');
  await sleep(20);
  assert.strictEqual(queue.push('A', { chat: 'A', token: 'a2' }, { kind: 'text', text: 'คำถาม 1 ต่อ' }), 'joined');
  await sleep(200);
  assert.deepStrictEqual(runs, [{ token: 'a2', items: ['คำถาม 1', 'คำถาม 1 ต่อ'] }]);

  // a message sent while the answer is being prepared waits for it, then runs on its own
  runs.length = 0;
  queue.push('B', { chat: 'B', token: 'b1', slow: true }, { kind: 'text', text: 'ถามยาว' });
  await sleep(150);
  assert.strictEqual(queue.busy('B'), true);
  assert.strictEqual(queue.push('B', { chat: 'B', token: 'b2' }, { kind: 'text', text: 'ถามต่อ' }), 'queued');
  await sleep(600);
  assert.deepStrictEqual(runs, [{ token: 'b1', items: ['ถามยาว'] }, { token: 'b2', items: ['ถามต่อ'] }]);
  assert.strictEqual(overlap, false, 'one chat ran two Dify calls at once');

  // a photo alone waits longer for its caption; the caption joins the photo
  runs.length = 0;
  queue.push('C', { chat: 'C', token: 'c1' }, { kind: 'image', id: 'img1' });
  await sleep(100);
  assert.strictEqual(runs.length, 0, 'photo was answered before its caption arrived');
  queue.push('C', { chat: 'C', token: 'c2' }, { kind: 'text', text: 'ใบเป็นจุด' });
  await sleep(250);
  assert.deepStrictEqual(runs, [{ token: 'c2', items: ['img1', 'ใบเป็นจุด'] }]);

  // different chats do not wait for each other
  runs.length = 0;
  queue.push('D', { chat: 'D', token: 'd1', slow: true }, { kind: 'text', text: 'แชท D' });
  queue.push('E', { chat: 'E', token: 'e1' }, { kind: 'text', text: 'แชท E' });
  await sleep(200);
  assert.deepStrictEqual(runs.map((r) => r.token).sort(), ['d1', 'e1']);
  await sleep(400);

  // a failed run does not block the next question in that chat
  runs.length = 0;
  queue.push('F', { chat: 'F', token: 'f1', fail: true }, { kind: 'text', text: 'ถามตอนระบบล่ม' });
  await sleep(200);
  queue.push('F', { chat: 'F', token: 'f2' }, { kind: 'text', text: 'ถามใหม่' });
  await sleep(200);
  assert.deepStrictEqual(runs.map((r) => r.token), ['f1', 'f2']);
  assert.strictEqual(queue.pending('F') + queue.pending('D') + queue.pending('E'), 0);

  // v3.59: question markers (round 2 test lines)
  for (const t of ['ใช้ยาอะไรดี', 'ทุเรียนมีอะไรแนะนำอีกไหม', 'มันเป็นโรคอะไรคะ', 'แนะนำหน่อย', 'ช่วยดูภาพดีๆ', 'ใช้กี่ซีซี', 'อะบา ชื่อว่าอะไร']) assert.strictEqual(isQuestionLine(t), true, t);
  for (const t of ['สวัสดี', 'ปลูกพริก', 'คู่มือการใช้', 'มันเกิดพร้อมกัน', 'ที่เกี่ยวกับนาข้าว', 'ก่อนเก็บเกี่ยว', 'หอมแดงมีจุดฉ่ำน้ำ แผลรูปไข่สีม่วง ขอบสีเหลือง']) assert.strictEqual(isQuestionLine(t), false, t);

  // v3.59: a line that is not yet a question waits longer for the next line; a question waits the short time
  const got = [];
  const q2 = createTurnQueue({ textWaitMs: 60, fragmentWaitMs: 400, imageWaitMs: 400, log: () => {},
    run: async (ctx, items) => { got.push(items.map((x) => x.text)); } });
  q2.push('G', {}, { kind: 'text', text: 'ปลูกพริก' });
  await sleep(200);
  q2.push('G', {}, { kind: 'text', text: 'มีเพลี้ยไฟ' });
  await sleep(200);
  assert.strictEqual(got.length, 0, 'a statement should wait for the question that follows');
  q2.push('G', {}, { kind: 'text', text: 'ใช้ยาอะไรดี' });
  await sleep(200);
  assert.deepStrictEqual(got, [['ปลูกพริก', 'มีเพลี้ยไฟ', 'ใช้ยาอะไรดี']]);

  // v3.59: a line that arrives before the answer is sent cancels the run, and all lines get one answer
  got.length = 0;
  let sent = 0;
  const q3 = createTurnQueue({ textWaitMs: 40, fragmentWaitMs: 40, imageWaitMs: 40, mergeWindowMs: 5000, maxMerges: 1, log: () => {},
    run: async (ctx, items, turn) => {
      got.push(items.map((x) => x.text));
      for (let i = 0; i < 15 && !turn.aborted; i++) await sleep(20); // about 300 ms of "Dify"
      if (turn.commit()) { sent++; await sleep(150); } // sending
    } });
  q3.push('H', {}, { kind: 'text', text: 'ทุเรียนมีอะไรแนะนำอีกไหม' });
  await sleep(120);
  assert.strictEqual(q3.push('H', {}, { kind: 'text', text: 'คู่มือการใช้' }), 'merged');
  await sleep(200); // the merged run is in progress
  assert.strictEqual(q3.push('H', {}, { kind: 'text', text: 'ขอรูปด้วยไหม' }), 'queued', 'at most maxMerges cancels in a row');
  await sleep(1200);
  assert.deepStrictEqual(got, [['ทุเรียนมีอะไรแนะนำอีกไหม'], ['ทุเรียนมีอะไรแนะนำอีกไหม', 'คู่มือการใช้'], ['ขอรูปด้วยไหม']]);
  assert.strictEqual(sent, 2, 'the cancelled run must not answer');

  // once the answer is being sent, a new line waits and is answered on its own
  got.length = 0; sent = 0;
  let committedAt = 0;
  const q4 = createTurnQueue({ textWaitMs: 30, fragmentWaitMs: 30, imageWaitMs: 30, mergeWindowMs: 5000, log: () => {},
    run: async (ctx, items, turn) => { got.push(items.map((x) => x.text)); await sleep(30); if (turn.commit()) { sent++; committedAt = Date.now(); await sleep(300); } } });
  q4.push('I', {}, { kind: 'text', text: 'ข้อแรกใช้ยังไง' });
  for (let i = 0; i < 200 && !committedAt; i++) await sleep(10);
  assert(committedAt, 'the first run should commit its answer');
  assert.strictEqual(q4.push('I', {}, { kind: 'text', text: 'ข้อสองใช้ยังไง' }), 'queued');
  await sleep(800);
  assert.deepStrictEqual(got, [['ข้อแรกใช้ยังไง'], ['ข้อสองใช้ยังไง']]);
  assert.strictEqual(sent, 2);

  // several photos: Dify is asked to read each one in the order sent
  const many = turnQuery([{ kind: 'image', id: 'a' }, { kind: 'image', id: 'b' }, { kind: 'image', id: 'c' }, { kind: 'text', text: 'เป็นโรคอะไร' }], IMAGE_Q, STICKER_Q);
  assert(many.query.includes('รูปที่ 1 ถึง 3') && many.query.includes('ทีละรูป'), many.query);
  assert(!turnQuery([{ kind: 'image', id: 'a' }, { kind: 'text', text: 'เป็นโรคอะไร' }], IMAGE_Q, STICKER_Q).query.includes('ทีละรูป'));

  console.log('PASS: turn queue joins close messages, waits longer for lines that are not yet a question, cancels a run when a new line comes before the answer, answers one question at a time per chat, and waits for photo captions');
})().catch((e) => { console.error(e); process.exit(1); });
