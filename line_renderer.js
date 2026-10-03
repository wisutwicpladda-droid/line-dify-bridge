'use strict';
const LIMIT = 4900;
function chunkText(value, limit = LIMIT) {
  const text = String(value || ''); if (!text.trim()) return [];
  const parts = []; let rest = text;
  while (rest.length > limit) {
    let end = rest.lastIndexOf('\n', limit - 1) + 1;
    if (end < limit / 2) {
      end = 0;
      for (const s of new Intl.Segmenter('th', { granularity: 'sentence' }).segment(rest)) {
        const next = s.index + s.segment.length; if (next > limit) break; end = next;
      }
    }
    if (!end) {
      for (const s of new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(rest)) {
        const next = s.index + s.segment.length; if (next > limit) break; end = next;
      }
    }
    if (!end) throw new Error('line_chunk_limit_too_small');
    parts.push(rest.substring(0, end)); rest = rest.substring(end);
  }
  if (rest) parts.push(rest);
  return parts;
}
function renderMessages(input) {
  const out = [];
  for (const value of Array.isArray(input) ? input : [input]) {
    if (value == null) continue;
    if (typeof value === 'object' && value.type !== 'text') { if (value.type) out.push(value); continue; }
    const original = typeof value === 'object' ? value : { type: 'text', text: String(value) };
    const chunks = chunkText(original.text);
    chunks.forEach((text, index) => {
      const m = { ...original, text }; if (index !== chunks.length-1) delete m.quickReply; out.push(m);
    });
  }
  return out;
}
const batches = messages => Array.from({ length: Math.ceil(messages.length / 5) }, (_,i) => messages.slice(i*5, i*5+5));
module.exports = { chunkText, renderMessages, batches, LIMIT };

