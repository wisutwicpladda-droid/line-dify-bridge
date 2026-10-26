'use strict';

// v3.38 (LINE feedback FB-02, 26 Oct 2026): customers often send two lines in a
// row, or a photo followed by a question. Each LINE event used to start its own
// Dify run at once, so one customer got two answers that could disagree (onion
// disease: one answer said ก็อปกัน, the next อาร์เทมิส). Messages that arrive
// close together now become one question, and a chat never has two Dify runs at
// the same time: anything sent while an answer is being prepared waits and is
// answered next, with the earlier answer already in the conversation.

function createTurnQueue(opts) {
  const textWaitMs = Math.max(0, opts.textWaitMs || 0);
  const imageWaitMs = Math.max(0, opts.imageWaitMs || 0);
  const run = opts.run;                 // async (ctx, items) => void
  const log = opts.log || (() => {});
  const boxes = new Map();              // sessionId -> { items, ctx, timer, busy }

  function schedule(sessionId, box) {
    clearTimeout(box.timer);
    const onlyImages = box.items.length > 0 && box.items.every((x) => x.kind === 'image');
    box.timer = setTimeout(() => { flush(sessionId).catch((e) => log('[turn] error: ' + e.message)); },
      onlyImages ? imageWaitMs : textWaitMs);
  }

  async function flush(sessionId) {
    const box = boxes.get(sessionId);
    if (!box || box.busy || !box.items.length) return;
    const items = box.items.splice(0);
    const ctx = box.ctx;
    box.busy = true;
    try {
      await run(ctx, items);
    } finally {
      box.busy = false;
      if (box.items.length) schedule(sessionId, box);
      else if (boxes.get(sessionId) === box) boxes.delete(sessionId);
    }
  }

  // ctx carries the newest LINE event so its fresh reply token is used.
  function push(sessionId, ctx, item) {
    let box = boxes.get(sessionId);
    if (!box) { box = { items: [], ctx: null, timer: null, busy: false }; boxes.set(sessionId, box); }
    box.items.push(item);
    box.ctx = ctx;
    if (box.busy) { log('[turn] ' + String(sessionId).slice(0, 8) + ' waiting for the current answer (' + box.items.length + ' queued)'); return 'queued'; }
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
    query = texts.join('\n') + '\n\n(ลูกค้าส่งรูปภาพ ' + images.length + ' รูปมาพร้อมข้อความด้านบน ให้อ่านรูปประกอบกับข้อความนี้และตอบรวมในคำตอบเดียว) ' + imageQuery;
  } else if (images.length) query = imageQuery;
  else if (texts.length) query = texts.join('\n');
  else query = stickerQuery;
  return { query, images, userText: texts.join('\n') };
}

module.exports = { createTurnQueue, turnQuery };
