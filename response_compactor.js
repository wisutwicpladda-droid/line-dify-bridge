'use strict';

// Keep ordinary LINE replies conversational. Requests that need exact details
// are deliberately excluded so rates, calculations, comparisons, programmes,
// registration/PHI and safety instructions are not shortened.
const DETAIL_QUERY_RX = /(อัตรา|กี่\s*(ไร่|กระสอบ|ลิตร|มล|กรัม|ซีซี|ถัง)|จำนวน\s*(ไร่|กระสอบ|ลิตร|ถัง)|คำนวณ|เปรียบเทียบ|เทียบ|โปรแกรม|ตลอด.*(ฤดู|เก็บเกี่ยว)|ตั้งแต่.*(ปลูก|เริ่ม)|ทะเบียน|PHI|ปลอดภัย|ฉุกเฉิน|เข้าตา|สูดดม|กลืน|สัมผัส|ทั้งหมด|ทุกตัว|ขอรายละเอียด|วิธีทำ|ขั้นตอน)/i;
const QUESTION_RX = /(ไหม|หรือไม่|อะไร|ตัวไหน|ชนิดไหน|อายุเท่าไร|ระยะไหน|จังหวัด|อำเภอ|แปลง|พบตรงไหน|ดูตรงไหน)\s*[?？]?$/;
const ORDINARY_MAX = 420;

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

  const units = sentenceUnits(text);
  if (units.length <= 2 && text.length <= ORDINARY_MAX * 1.45) return text;

  const keep = [];
  const add = (unit) => {
    if (!unit || keep.includes(unit)) return;
    keep.push(unit);
  };

  // Keep the answer first, then one product/action line when present.
  add(units[0]);
  const productLine = units.find((u, i) => i > 0 && productNames.some((name) => u.includes(name)));
  add(productLine || units[1]);

  // Preserve one useful follow-up question so the conversation can continue.
  const question = units.find((u, i) => i > 1 && QUESTION_RX.test(u));
  add(question);

  let out = keep.join('\n');
  if (out.length > ORDINARY_MAX * 1.45) {
    out = keep.slice(0, 2).join('\n');
  }
  return out.trim();
}

module.exports = { compactResponse, DETAIL_QUERY_RX, ORDINARY_MAX };
