'use strict';

// Rate guard for LINE replies: show application rates only when the customer asks.
// Moved out of server.js in v3.36 so it can be unit tested.
// v3.36 fix (case 14 Oct 2026, แกนเตอร์): "ใช้ในนาข้าวยังไง" has words between ใช้ and ยังไง,
// and the follow-up "ทั้งคน ทั้งโดรนค่ะ" has no rate word, so correct sheet rates were cut.

const BASE_ASK_RX = /อัตรา|เท่า(ไหร่|ไร|ไร)|กี่\s*(ซีซี|cc|มล|ลิตร|กรัม|กิโล|ขวด|ถุง|กระสอบ|ไร่|ช้อน|ฝา|ถัง)|ผสม|วิธีใช้|ใช้(ยัง|อย่าง)ไง|ฉีด(ยัง|อย่าง)ไง|พ่น(ยัง|อย่าง)ไง|หว่าน(ยัง|อย่าง)ไง|ปริมาณ|ถัง|\d+\s*ไร่|ทำ.*(ยัง|อย่าง)ไง|ขั้นตอน/i;
const RATE_LABEL_RX = /^\s*(\d+[.)]\s*)?[-•]?\s*(อัตรา\s*[:：]|(พ่นด้วย(คน|โดรน)|คนพ่น|โดรน|ใช้โดรน|หว่านด้วย(คน|โดรน))\s*[:：]?\s*(ผสม|ใช้|หว่าน|อัตรา)?\s*\d)/;
// Gemini often formats the label in Markdown and writes set rates as 50+50.
// Remove that whole rate line when the customer did not ask for a rate so a
// partial value such as "50+" cannot remain visible.
const RATE_MARKED_LINE_RX = /^\s*(?:\d+[.)]\s*)?[-•]?\s*(?:\*\*)?\s*(อัตรา|พ่นด้วย(คน|โดรน)|คนพ่น|โดรน|ใช้โดรน|หว่านด้วย(คน|โดรน))\s*(?:\*\*)?\s*[:：]/;
const U = '(ซีซี|cc|มล\\.?|ลิตร|กรัม|กิโลกรัม|กก\\.?)';
const N = '[\\d.,]+(\\s*[-–]\\s*[\\d.,]+)?';
const RATE_PHRASES = [
  new RegExp('(ใน|ใช้|ที่)?\\s*อัตรา\\s*' + N + '\\s*' + U + '(\\s*(ต่อ|\\/)\\s*(น้ำ\\s*' + N + '\\s*ลิตร|ไร่|ต้น))?(\\s*(พ่น|ฉีด)ได้\\s*' + N + '\\s*ไร่)?', 'g'),
  new RegExp('ผสม\\s*' + N + '\\s*' + U + '\\s*(กับ|ต่อ)\\s*น้ำ\\s*' + N + '\\s*ลิตร(\\s*(ต่อ\\s*ไร่|(พ่น|ฉีด)ได้\\s*' + N + '\\s*ไร่))?', 'g'),
  new RegExp(N + '\\s*' + U + '\\s*(ต่อ|\\/)\\s*(น้ำ\\s*' + N + '\\s*ลิตร|ไร่|ต้น)', 'g'),
  new RegExp('\\(?\\s*\\d+\\s*(ขวด|ถุง|กระสอบ|ชุด)[^\\n()]{0,30}?ใช้ได้(ประมาณ)?\\s*' + N + '\\s*ไร่\\s*\\)?', 'g')
];

// Phrasings the base pattern missed: words between the verb and ยังไง/อย่างไร,
// application methods (คน/โดรน/เครื่องพ่น) and per-unit wording (ต่อไร่, ไร่ละ).
const EXTRA_ASK_RX = /(ใช้|ฉีด|พ่น|หว่าน|ราด|รด)[^\n?]{0,30}?((ยัง|อย่าง)(ไง|ไร)|ยังงัย|แบบไหน)|วิธี(พ่น|ฉีด|ผสม|หว่าน|ราด)|ต่อ\s*(ไร่|ถัง|ต้น)|(ไร่|ถัง|ต้น)ละ|โดรน|พ่นด้วยคน|คนพ่น|เครื่องพ่น|ถังพ่น|เป้พ่น/i;
// A short reply right after a rate question ("ข้าวค่ะ", "ทั้งคน ทั้งโดรนค่ะ") continues that question.
const FOLLOW_UP_MS = 20 * 60000;
const FOLLOW_UP_MAX_CHARS = 60;

function asksRate(text) {
  const t = String(text || '');
  return BASE_ASK_RX.test(t) || EXTRA_ASK_RX.test(t);
}

// history: session entries { r: 'u' | 'b', t, at }. The current message may already be the last 'u' entry.
function rateAsked(userText, history, now) {
  const t = String(userText || '');
  if (asksRate(t)) return true;
  if (t.length > FOLLOW_UP_MAX_CHARS) return false;
  const at = now || Date.now();
  const users = (Array.isArray(history) ? history : []).filter((h) => h && h.r === 'u' && h.t);
  if (users.length && users[users.length - 1].t === t) users.pop();
  return users.slice(-2).some((h) => (!h.at || at - h.at <= FOLLOW_UP_MS) && asksRate(h.t));
}

// "…มีอัตราดังนี้ค่ะ" left with nothing after it reads like a broken reply.
const RATE_INTRO_RX = /(อัตรา|วิธีใช้|วิธีพ่น)[^\n]{0,40}ดังนี้\s*(ค่ะ|คะ|นะคะ|ครับ)?\s*[:：]?\s*$/;

function stripRates(answer) {
  let removed = 0;
  const out = [];
  for (const line of String(answer).split('\n')) {
    if (RATE_LABEL_RX.test(line) || RATE_MARKED_LINE_RX.test(line)) { removed++; continue; }
    let l = line;
    for (const rx of RATE_PHRASES) l = l.replace(rx, () => { removed++; return ' '; });
    if (l !== line) {
      l = l.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.)])/g, '$1').trim();
      if (!l || /^[\s\-–•:,.()]*$/.test(l)) continue;
    }
    out.push(l);
  }
  if (!removed) return { text: String(answer), removed: 0 };
  const kept = out.filter((l) => !RATE_INTRO_RX.test(l));
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
}

module.exports = { asksRate, rateAsked, stripRates, BASE_ASK_RX, EXTRA_ASK_RX };
