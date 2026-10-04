'use strict';

// Transport protocol only. No crop, product, rate, status or prose inference.
const SCHEMA = 'ladda.line.v1';
function decodeDifyAnswer(answer) {
  if (typeof answer !== 'string') throw new TypeError('Dify answer must be text');
  let value;
  try { value = JSON.parse(answer); } catch (_) { value = null; }
  if (!value || value.schema !== SCHEMA) {
    if (value && typeof value === 'object' && ('schema' in value || 'reply' in value || 'text' in value)) {
      throw new TypeError('Unsupported Dify delivery contract');
    }
    // Fixed safety/greeting branches and rollback-compatible plain responses.
    return { text: answer, images: [], buttons: [], handoff: false };
  }
  if (typeof value.text !== 'string' || !value.text.trim() || typeof value.handoff !== 'boolean') {
    throw new TypeError('Invalid Dify delivery envelope');
  }
  for (const field of ['images', 'buttons']) {
    if (!Array.isArray(value[field]) || value[field].length > 200 || value[field].some(n => typeof n !== 'string' || !n || n.length > 200)) {
      throw new TypeError('Invalid Dify delivery references');
    }
  }
  return { text: value.text, images: [...new Set(value.images)], buttons: [...new Set(value.buttons)], handoff: value.handoff };
}

function splitText(text, limit = 4900) {
  if (!Number.isInteger(limit) || limit < 2) throw new RangeError('Invalid chunk size');
  const chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + limit, text.length);
    // LINE size is bounded in UTF-16 units; do not break a surrogate pair.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function lineMessages(input) {
  const out = [];
  for (const item of (Array.isArray(input) ? input : [input])) {
    if (item == null) continue;
    if (typeof item === 'object' && item.type !== 'text') { if (item.type) out.push(item); continue; }
    const value = typeof item === 'object' ? item.text : String(item);
    if (typeof value !== 'string' || !value.length) continue;
    const parts = splitText(value);
    parts.forEach((part, index) => {
      const msg = typeof item === 'object' ? { ...item, text: part } : { type: 'text', text: part };
      if (index !== parts.length - 1) delete msg.quickReply;
      out.push(msg);
    });
  }
  return out;
}

function deliveryIsCurrent(session, epoch, now = Date.now()) {
  return !!session && (session.responseEpoch || 0) === epoch && !session.handoff && !(session.mutedUntil > now);
}

module.exports = { SCHEMA, decodeDifyAnswer, splitText, lineMessages, deliveryIsCurrent };
