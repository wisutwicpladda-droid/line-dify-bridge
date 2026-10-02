'use strict';

// Grounding/search may still be used internally, but customer-facing LINE text
// must not expose source labels, URLs, or provider citation markers.
function stripVisibleCitations(answer) {
  let text = String(answer || '').trim();
  if (!text) return '';

  // Source lists are appended at the end by some model/provider responses.
  text = text.replace(/\n\s*(?:แหล่งอ้างอิง|แหล่งที่มา|อ้างอิงจาก|sources?|references?)\s*:?[\s\S]*$/imu, '');
  text = text.replace(/\[[^\]]{0,160}\]\(https?:\/\/[^)\s]+\)/gi, '');
  text = text.replace(/https?:\/\/\S+/gi, '');
  text = text.replace(/\s*\[(?:cite|citation|source|ref(?:erence)?)\s*:?\s*\d+(?:\s*[,;]\s*\d+)*\]/gi, '');
  text = text.replace(/\s*【\s*(?:cite|citation|source|ref(?:erence)?)?\s*\d+(?:\s*[,;]\s*\d+)*\s*】/gi, '');
  text = text.replace(/\s*\((?:cite|citation|source|ref(?:erence)?)\s*:?\s*\d+(?:\s*[,;]\s*\d+)*\)/gi, '');
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { stripVisibleCitations };
