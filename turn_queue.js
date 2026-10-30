'use strict';

// v3.38 (LINE feedback FB-02, 26 Oct 2026): customers often send two lines in a
// row, or a photo followed by a question. Each LINE event used to start its own
// Dify run at once, so one customer got two answers that could disagree (onion
// disease: one answer said ก็อปกัน, the next อาร์เทมิส). Messages that arrive
// close together now become one question, and a chat never has two Dify runs at
// the same time: anything sent while an answer is being prepared waits and is
// answered next, with the earlier answer already in the conversation.
//
// v3.59 (round 2 test, 31 Oct 2026): real customers pause 4-7 seconds between
// lines, so the 4-second window still split rows 10, 14, 15, 17 and 18 into two
// or three answers. Two changes:
// - a line that is not yet a question ("สวัสดี", "ปลูกพริก", "คู่มือการใช้")
//   waits fragmentWaitMs (8 s) for the next line; a line that asks something
//   ("ใช้ยาอะไรดี", "...ไหม") waits textWaitMs (4 s) as before
// - a line that arrives after the run started but before its answer is sent,
//   within mergeWindowMs of the start, cancels that run (turn.signal aborts the
//   Dify stream, the run must not send) and the lines are answered together.
//   A run calls turn.commit() right before sending; once committed, new lines
//   wait and are answered next as before. At most maxMerges cancels in a row.

// Thai question and request markers. A line without one of these is treated as
// the start of a question that the customer is still typing.
const QUESTION_WORDS = [
  '?', '？', 'ไหม', 'มั้ย', 'มั๊ย', 'มั๋ย', 'เปล่า', 'หรือไม่', 'อะไร', 'ยังไง', 'อย่างไร', 'ยังงัย',
  'เท่าไร', 'เท่าไหร่', 'ไหนดี', 'ตัวไหน', 'อันไหน', 'ที่ไหน', 'ตรงไหน', 'เมื่อไร', 'เมื่อไหร่', 'ทำไม',
  'ได้บ้าง', 'มีบ้าง', 'แนะนำ', 'ช่วย', 'ขอรูป', 'ขอเบอร์', 'ขอข้อมูล', 'ขอราคา', 'ขอวิธี', 'ขอทราบ', 'ขอถาม',
  'ขอคำแนะนำ', 'ราคา', 'รบกวน', 'อยากทราบ', 'อยากรู้', 'สอบถาม', 'ต้องการซื้อ', 'ต้องการสั่ง'
];
function isQuestionLine(text) {
  const t = String(text || '').trim();
  // "กี่" (how many) but not inside "เกี่ยว" (เก็บเกี่ยว, ที่เกี่ยวกับ)
  return !!t && (QUESTION_WORDS.some((w) => t.includes(w)) || /(^|[^เ])กี่/.test(t));
}

function createTurnQueue(opts) {
  const textWaitMs = Math.max(0, opts.textWaitMs || 0);
  const fragmentWaitMs = Math.max(textWaitMs, opts.fragmentWaitMs || 0);
  const imageWaitMs = Math.max(0, opts.imageWaitMs || 0);
  const mergeWindowMs = Math.max(0, opts.mergeWindowMs || 0);
  const maxMerges = opts.maxMerges == null ? 2 : Math.max(0, opts.maxMerges);
  const isQuestion = opts.isQuestion || isQuestionLine;
  const run = opts.run;                 // async (ctx, items) => void
  const log = opts.log || (() => {});
  const boxes = new Map();              // sessionId -> { items, ctx, timer, busy, turn, merges }

  function waitFor(box) {
    const onlyImages = box.items.length > 0 && box.items.every((x) => x.kind === 'image');
    if (onlyImages) return imageWaitMs;
    const last = box.items[box.items.length - 1];
    if (!last || last.kind !== 'text' || last.voice) return textWaitMs;
    return isQuestion(last.text) ? textWaitMs : fragmentWaitMs;
  }

  function schedule(sessionId, box) {
    clearTimeout(box.timer);
    box.timer = setTimeout(() => { flush(sessionId).catch((e) => log('[turn] error: ' + e.message)); }, waitFor(box));
  }

  async function flush(sessionId) {
    const box = boxes.get(sessionId);
    if (!box || box.busy || !box.items.length) return;
    const items = box.items.splice(0);
    const ctx = box.ctx;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const turn = {
      startedAt: Date.now(), aborted: false, committed: false,
      signal: controller ? controller.signal : undefined,
      abort() { if (this.aborted || this.committed) return false; this.aborted = true; if (controller) controller.abort(); return true; },
      // call right before sending the answer: false = the run was cancelled, do not send
      commit() { if (this.aborted) return false; this.committed = true; return true; }
    };
    box.busy = true;
    box.turn = turn;
    try {
      await run(ctx, items, turn);
    } finally {
      box.busy = false;
      box.turn = null;
      if (turn.aborted) box.items = items.concat(box.items); // cancelled: answer these lines together with the new ones
      else box.merges = 0;
      if (box.items.length) schedule(sessionId, box);
      else if (boxes.get(sessionId) === box) boxes.delete(sessionId);
    }
  }

  // ctx carries the newest LINE event so its fresh reply token is used.
  function push(sessionId, ctx, item) {
    let box = boxes.get(sessionId);
    if (!box) { box = { items: [], ctx: null, timer: null, busy: false, turn: null, merges: 0 }; boxes.set(sessionId, box); }
    box.items.push(item);
    box.ctx = ctx;
    if (box.busy) {
      const t = box.turn;
      if (t && mergeWindowMs && (box.merges || 0) < maxMerges && Date.now() - t.startedAt <= mergeWindowMs && t.abort()) {
        box.merges = (box.merges || 0) + 1;
        log('[turn] ' + String(sessionId).slice(0, 8) + ' new message before the answer was sent: cancel it and answer all lines together');
        return 'merged';
      }
      log('[turn] ' + String(sessionId).slice(0, 8) + ' waiting for the current answer (' + box.items.length + ' queued)');
      return 'queued';
    }
    schedule(sessionId, box);
    return box.items.length === 1 ? 'first' : 'joined';
  }

  return { push, flush, pending: (id) => (boxes.get(id) ? boxes.get(id).items.length : 0), busy: (id) => !!(boxes.get(id) && boxes.get(id).busy) };
}

// items -> one Dify query. Text lines keep their order; photos ride along with the text.
function turnQuery(items, imageQuery, stickerQuery) {
  const texts = items.filter((x) => x.kind === 'text' && String(x.text || '').trim()).map((x) => String(x.text).trim());
  const images = items.filter((x) => x.kind === 'image' && x.id).map((x) => x.id);
  let query;
  if (images.length && texts.length) {
    query = texts.join('\n') + '\n\n(ลูกค้าส่งรูปภาพ ' + images.length + ' รูปมาพร้อมข้อความด้านบน ให้อ่านรูปประกอบกับข้อความนี้และตอบรวมในคำตอบเดียว' + manyImagesNote(images.length) + ') ' + imageQuery;
  } else if (images.length) query = images.length > 1 ? '(ลูกค้าส่งรูปภาพ ' + images.length + ' รูป' + manyImagesNote(images.length) + ') ' + imageQuery : imageQuery;
  else if (texts.length) query = texts.join('\n');
  else query = stickerQuery;
  return { query, images, userText: texts.join('\n') };
}

// v3.59 (round 2 row 48): three photos of different crops got "which photo do you mean?" and no
// diagnosis. Ask for a short reading of each photo in the order sent (Dify receives at most 3).
function manyImagesNote(n) {
  if (n < 2) return '';
  const shown = Math.min(n, 3);
  return ' รูปเรียงตามลำดับที่ลูกค้าส่ง (รูปที่ 1 ถึง ' + shown + ') ถ้าแต่ละรูปเป็นคนละพืชหรือคนละปัญหา ให้บอกสั้น ๆ ทีละรูปว่าน่าจะเป็นอะไร แล้วแนะนำสินค้าของปัญหาที่ลูกค้าถาม หรือถามว่าต้องการคำแนะนำของรูปไหน ห้ามตอบแค่ถามกลับโดยไม่บอกว่าเห็นอะไรในแต่ละรูป';
}

module.exports = { createTurnQueue, turnQuery, isQuestionLine };
