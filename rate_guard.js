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
// v3.44-v2 (bot test 27 Oct 2026): "แก่นเตอร์ ใช้ไง" (no ยัง) and a customer quoting a dose
// ("เซลล์บอกว่าต้องใส่ 50 กรัมต่อน้ำ 20 ลิตร จริงไหม") are rate questions too; the guard cut the
// sheet rate the customer needed to compare.
const COLLOQUIAL_ASK_RX = /(ใช้|ฉีด|พ่น|หว่าน)\s*ไง/;
const QUOTED_DOSE_RX = /\d[\d.,]*\s*(ซีซี|cc|มล|ml|กรัม|ก\.|ลิตร|กิโล|กก|ช้อน|ฝา)/i;
// A short reply right after a rate question ("ข้าวค่ะ", "ทั้งคน ทั้งโดรนค่ะ") continues that question.
const FOLLOW_UP_MS = 20 * 60000;
const FOLLOW_UP_MAX_CHARS = 60;

function asksRate(text) {
  const t = String(text || '');
  return BASE_ASK_RX.test(t) || EXTRA_ASK_RX.test(t) || COLLOQUIAL_ASK_RX.test(t) || QUOTED_DOSE_RX.test(t);
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

// v3.46 (production bot test 27 Oct 2026): cutting only the numbers left
// "อัตราใช้สำหรับคนพ่นคือ พ่นได้ 1 ไร่ (หรือหากใช้โดรน ต่อไร่) ค่ะ" and
// "โดยพ่นด้วยคน ต่อไร่ หรือพ่นด้วยโดรน ต่อไร่ค่ะ". A rate inside a sentence is now cut together with
// the words that only make sense with the number: back to the "อัตรา…", "โดยพ่นด้วยคน" or "ใช้"
// that introduces it, and forward to the end of the sentence when the rest is rate wording only.
const END_RX = /(นะคะ|ค่ะ|คะ|ครับ|[.!?])/g;
// v3.47 (production bot test 28 Oct 2026, sim-genx-02): "…ขึ้นไปได้ โดยใช้อัตรา 100 ซีซีต่อน้ำ 20 ลิตรค่ะ"
// left "…ขึ้นไปได้ โดยค่ะ" because "ใช้" went with the number. A bare connector (โดย/และ/ส่วน/หรือ)
// and "อยู่ที่/คือ/ประมาณ" right before the rate now go with it.
const LEAD_RX = /(?:(?:โดย|และ|ส่วน|หรือ)\s*(?:การ|หาก|ถ้า)?\s*)?(?:อัตรา(?:การ)?(?:ใช้)?[^\s"“”()]{0,20}(?:\s*(?:คือ|ใช้|ประมาณ))?|(?:พ่น|ฉีด|หว่าน)(?:ด้วย)?(?:คน|โดรน)(?:\s*ใช้)?|(?:ใช้)?(?:ด้วย)?(?:คน|โดรน)(?:พ่น|ฉีด)?(?:\s*ใช้)?|ใช้|ใส่|ผสม)\s*(?:(?:อยู่)?ที่|คือ|ประมาณ)?\s*$|(?:โดย(?:การ)?|และ|ส่วน|หรือ)\s*(?:(?:อยู่)?ที่|คือ|ประมาณ)?\s*$/;
// Words that only lead into a rate. A sentence with nothing else before the cut
// ("ส่วนการใช้โดรนอยู่ที่", "ปริมาณที่ใช้คือ") is cut from its start.
const HEAD_FILLER_RX = /ปริมาณ|ส่วน|โดย|อยู่|ที่|คือ|แนะนำ|ให้|ควร|ซึ่ง|จะ/g;
// "…คำแนะนำการพ่นด้วยคนคือ 300 ซีซี…": the noun the lead belongs to goes with it, never a bare "การ".
const LEAD_NOUN_RX = /(?:มี)?(?:เฉพาะ|เพียง|แค่)?(?:คำแนะนำ)?(?:สำหรับ|ใน)?การ\s*$/;
// "ต่อไร่" / "ต่อ 1 งาน" right after a cut rate only made sense with the number.
const TRAIL_UNIT_RX = /^\s*ต่อ\s*(?:พื้นที่\s*)?(?:[\d.,]+\s*)?(?:ไร่|งาน)/;
// Sentence endings. "คะ" followed by a letter starts a word (คะน้า, คะแนน), not an ending.
const ENDING = '(?:นะคะ|ค่ะ|คะ(?![\u0E01-\u0E4E])|ครับ)';
const FILLER_RX = /พ่นได้|ฉีดได้|หว่านได้|หรือ|หาก|ถ้า|ใช้|ด้วย|โดรน|คน|พ่น|ฉีด|หว่าน|ต่อ|ไร่|งาน|ลิตร|น้ำ|ละ|สำหรับ|ประมาณ|และ|อัตรา|พื้นที่|การ|ได้|[\d.,+\-–()\s:]/g;
const NAME_ONLY_RX = /^\s*(?:["“][^"”\n]{1,40}["”]\s*(?:และ|,)?\s*)+(?:นะคะ|ค่ะ|คะ|ครับ)?\s*$/;

function sentenceStart(line, before) {
  let start = 0;
  END_RX.lastIndex = 0;
  let m;
  while ((m = END_RX.exec(line)) && m.index + m[0].length <= before) start = m.index + m[0].length;
  return start;
}
// A rate inside brackets ends at the closing bracket, so a cut never leaves "(…" open.
function sentenceEnd(line, from, start) {
  END_RX.lastIndex = from;
  const m = END_RX.exec(line);
  let end = m ? m.index : line.length;
  const before = line.slice(0, start);
  if ((before.match(/\(/g) || []).length > (before.match(/\)/g) || []).length) {
    const close = line.indexOf(')', from);
    if (close >= 0 && close < end) end = close;
  }
  return end;
}
function mergeSpans(spans) {
  const out = [];
  for (const sp of spans.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]); else out.push(sp.slice());
  }
  return out;
}
// One line: returns the line with its inline rates cut and how many rate phrases were found.
function cutRateClauses(line) {
  const found = [];
  for (const rx of RATE_PHRASES) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(line))) {
      if (!m[0].trim()) { rx.lastIndex++; continue; }
      found.push([m.index, m.index + m[0].length]);
    }
  }
  if (!found.length) return { line, n: 0 };
  for (const sp of found) {
    const st = sentenceStart(line, sp[0]);
    const lead = LEAD_RX.exec(line.slice(st, sp[0]));
    if (lead) sp[0] = st + lead.index;
    const noun = lead && LEAD_NOUN_RX.exec(line.slice(st, sp[0]));
    if (noun) sp[0] = st + noun.index;
    // Closing brackets that end the previous sentence stay, and a head with its own bracket is left alone.
    const head = line.slice(st, sp[0]);
    const skip = head.match(/^[\s)\]”"]*/)[0].length;
    const words = head.slice(skip);
    if (!/[()]/.test(words) && !words.replace(FILLER_RX, '').replace(HEAD_FILLER_RX, '').trim()) sp[0] = st + skip;
  }
  for (const sp of found) { const tail = TRAIL_UNIT_RX.exec(line.slice(sp[1])); if (tail) sp[1] += tail[0].length; }
  let spans = mergeSpans(found);
  for (let i = 0; i < spans.length; i++) {
    const end = sentenceEnd(line, spans[i][1], spans[i][0]);
    let rest = line.slice(spans[i][1], end);
    for (let j = i + 1; j < spans.length && spans[j][0] < end; j++) rest = rest.replace(line.slice(spans[j][0], spans[j][1]), ' ');
    if (!rest.replace(FILLER_RX, '').trim()) spans[i][1] = Math.max(spans[i][1], end);
  }
  spans = mergeSpans(spans);
  let out = '';
  let pos = 0;
  for (const sp of spans) { out += line.slice(pos, sp[0]) + ' '; pos = sp[1]; }
  out += line.slice(pos);
  out = out.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(new RegExp('\\s+(' + ENDING + ')', 'g'), '$1').replace(/\s+([,.)])/g, '$1').trim();
  // v3.47: a whole sentence cut leaves its ending behind: "…ได้ค่ะค่ะ", or "ค่ะ" opening the line.
  out = out.replace(new RegExp('(' + ENDING + ')(?:\\s*' + ENDING + ')+', 'g'), '$1');
  if (!line.slice(0, spans[0][0]).trim()) out = out.replace(new RegExp('^' + ENDING + '\\s*'), '');
  // A sentence left with only product names keeps the names and drops its dangling ending.
  out = out.replace(/[^\n]*?(?:นะคะ|ค่ะ|คะ|ครับ|$)/g, (s) => (s && NAME_ONLY_RX.test(s) ? s.replace(/(นะคะ|ค่ะ|คะ|ครับ)(\s*)$/, '$2') + ' ' : s)).replace(/[ \t]{2,}/g, ' ').trim();
  return { line: out, n: found.length };
}
// Thai letters outside quoted product names: how much of the answer is left to read.
function substance(text) {
  return String(text).replace(/["“][^"”\n]*["”]/g, '').replace(/[^\u0E01-\u0E5B]/g, '').length;
}

function stripRates(answer) {
  let removed = 0;
  const out = [];
  for (const line of String(answer).split('\n')) {
    if (RATE_LABEL_RX.test(line) || RATE_MARKED_LINE_RX.test(line)) { removed++; continue; }
    const cut = cutRateClauses(line);
    let l = cut.line;
    if (cut.n) {
      removed += cut.n;
      if (!l || /^[\s\-–•:,.()]*(?:นะคะ|ค่ะ|คะ|ครับ)?[\s\-–•:,.()]*$/.test(l) || NAME_ONLY_RX.test(l)) continue;
    }
    out.push(l);
  }
  if (!removed) return { text: String(answer), removed: 0 };
  const kept = out.filter((l) => !RATE_INTRO_RX.test(l));
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Never cut an answer down to nothing: when the rates were all it said, keep them.
  if (substance(text) < 6) return { text: String(answer), removed: 0 };
  return { text, removed };
}

module.exports = { asksRate, rateAsked, stripRates, BASE_ASK_RX, EXTRA_ASK_RX };
