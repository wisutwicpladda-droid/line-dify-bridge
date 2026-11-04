'use strict';

// Keep ordinary LINE replies conversational. Requests that need exact details
// are deliberately excluded so rates, calculations, comparisons, programmes,
// registration/PHI and safety instructions are not shortened.
const DETAIL_QUERY_RX = /(อัตรา|กี่\s*(ไร่|กระสอบ|ลิตร|มล|กรัม|ซีซี|ถัง)|จำนวน\s*(ไร่|กระสอบ|ลิตร|ถัง)|คำนวณ|เปรียบเทียบ|เทียบ|โปรแกรม|ตลอด.*(ฤดู|เก็บเกี่ยว)|ตั้งแต่.*(ปลูก|เริ่ม)|ทะเบียน|PHI|ปลอดภัย|ฉุกเฉิน|เข้าตา|สูดดม|กลืน|สัมผัส|ทั้งหมด|ทุกตัว|ขอรายละเอียด|วิธีทำ|ขั้นตอน)/i;
// v3.71: a follow-up question usually ends with คะ/ค่ะ/นะคะ ("ดินระบายน้ำทันไหมคะ"); before, only a bare question
// word at the very end counted, so the compactor dropped the question the reply ended with.
const QUESTION_RX = /(ไหม|หรือไม่|อะไร|ตัวไหน|ชนิดไหน|อายุเท่าไร|ระยะไหน|จังหวัด|อำเภอ|แปลง|พบตรงไหน|ดูตรงไหน)(?:\s*(?:คะ|ค่ะ|นะคะ|ครับ))?\s*[?？]?$/;
const STRUCTURED_REPLY_RX = /(^|\n)\s*(?:[-•*]\s+|\d+[.)]\s+|(?:แนวทาง|วิธี|คำแนะนำ|ขั้นตอน|ข้อควรระวัง)\s*[:：]?)/u;
const ORDINARY_MAX = 420;
// v3.71 (owner, 4 Nov 2026: warm character tone): the reply may open with a short line that acknowledges
// the customer's worry ("ใบเหลืองร่วงเยอะแบบนี้น่าห่วงจริง ๆ ค่ะ"). It stays with the answer after it and is not
// counted against ORDINARY_MAX, so the warm opening does not push an ordinary reply into compaction.
const OPENER_MAX = 70;
// v3.44-v2 (bot test 27 Oct 2026): the compactor cut the answer to the second question
// ("อะทราซีน ... แล้วผสมกับ 2,4-ดี ได้ไหม"), the small-jar mixing advice and lists of product
// options. Mixing questions, messages with two or more questions, and answers that name two or
// more products are kept whole.
const MIX_QUERY_RX = /ผสม|ร่วมกับ|ใช้คู่|พร้อมกัน/;
const QUESTION_WORD_RX = /ไหม|มั้ย|มั๊ย|หรือเปล่า|ยังไง|อย่างไร|เท่าไหร่|เท่าไร|อะไร|ตัวไหน|ชนิดไหน|กี่/g;
// v3.54 (owner, 29 Oct 2026): every first answer states the application rate. An answer that
// gives a rate is kept whole, as shortening it could keep the product name and drop the rate.
const RATE_IN_ANSWER_RX = /\d+(?:[.,]\d+)?\s*(?:[-–]\s*\d+(?:[.,]\d+)?\s*)?(?:ซีซี|ซีซี\.|มล\.?|มิลลิลิตร|cc|กรัม|กก\.?|กิโลกรัม|ลิตร)\s*(?:ต่อ|\/)/i;

function isOpener(unit, productNames) {
  return unit.length <= OPENER_MAX && !/\d/.test(unit) && !QUESTION_RX.test(unit)
    && !(productNames || []).some((name) => name && unit.includes(name));
}

function asksSeveral(query) {
  return (String(query || '').match(QUESTION_WORD_RX) || []).length >= 2;
}
function namesSeveral(text, productNames) {
  return (productNames || []).filter((name) => name && text.includes(name)).length >= 2;
}

function clean(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sentenceUnits(text) {
  return text
    .split(/\n+|(?<=[.!?？])\s+|(?<=ค่ะ|คะ|นะคะ)\s+/u)
    .map((x) => x.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
}

function compactResponse(answer, query, productNames = []) {
  const text = clean(answer);
  if (!text || text.length <= ORDINARY_MAX || DETAIL_QUERY_RX.test(String(query || ''))) return text;
  if (MIX_QUERY_RX.test(String(query || '')) || asksSeveral(query) || namesSeveral(text, productNames)) return text;
  if (RATE_IN_ANSWER_RX.test(text)) return text;
  // Never shorten a structured answer. These often contain a heading followed
  // by the actual treatment steps; keeping only the first units can leave a
  // heading such as "แนวทางแก้ไขเบื้องต้น:" with no advice underneath.
  if (STRUCTURED_REPLY_RX.test(text)) return text;

  const all = sentenceUnits(text);
  const opener = all.length > 1 && isOpener(all[0], productNames) ? all[0] : '';
  const size = text.length - opener.length;
  if (opener && size <= ORDINARY_MAX) return text;
  const units = opener ? all.slice(1) : all;
  if (units.length <= 2 && size <= ORDINARY_MAX * 1.45) return text;

  const keep = [];
  const add = (unit) => {
    if (!unit || keep.includes(unit)) return;
    keep.push(unit);
  };

  // Keep the answer first, then one product/action line when present.
  add(opener);
  add(units[0]);
  const productLine = units.find((u, i) => i > 0 && productNames.some((name) => u.includes(name)));
  add(productLine || units[1]);

  // Preserve one useful follow-up question so the conversation can continue.
  const question = units.find((u, i) => i > 1 && QUESTION_RX.test(u));
  add(question);

  let out = keep.join('\n');
  if (out.length - opener.length > ORDINARY_MAX * 1.45) {
    out = keep.slice(0, opener ? 3 : 2).join('\n');
  }
  return out.trim();
}

module.exports = { compactResponse, DETAIL_QUERY_RX, ORDINARY_MAX };
