'use strict';

// v3.45-v2 (27 Oct 2026): three province names are also everyday words in farm chats:
// "เต็มเลยค่ะ", "บอกมาเลย" (เลย), "แพร่ระบาด" (แพร่), "ตากแดด" (ตาก). The bridge read them as
// provinces, saved the guess as the customer's CRM province and sent it to Dify, so customers who
// never gave a province were told about the salespeople of จ.เลย. These names now count only after
// จ./จังหวัด, or when the whole message is the name (a reply such as "เลยค่ะ" to "อยู่จังหวัดอะไรคะ").
const PROVINCE_WORDS = new Set(['เลย', 'แพร่', 'ตาก']);
const MARK_BEFORE_RX = /(?:จ\.|จังหวัด|จว\.)\s*$/;
const NOISE_RX = /[\s\u200b.!?,:;()"'“”~\-]+|\p{Extended_Pictographic}/gu;
// Thai has no spaces, so a name can also sit inside other words: "อัตราด้วย" and "ปุ๋ยตราดาว" contain
// "ตราด". When a name ends in a consonant and the next character is a vowel or tone mark (or อ),
// that consonant starts the next syllable, so the match is part of another word.
const ENDS_IN_CONSONANT_RX = /[\u0E01-\u0E2E]$/;
const NEXT_IN_SYLLABLE_RX = /^[\u0E2D\u0E30-\u0E3A\u0E47-\u0E4E]/;
// v3.51 (28 Oct 2026): "โคราช" is also how customers misspell the product โค-ราซ. On 28 Oct a real chat
// "โคราชใช้ยังไง" was read as จ.นครราชสีมา and the bot offered that province's salespeople. A product
// question right after the name (ใช้ ฉีด ผสม อัตรา ยังไง ...) means the product unless จ./จังหวัด comes first.
const PRODUCT_LOOKALIKES = {
  'โคราช': /^\s*(?:ใช้|ฉีด|พ่น|ผสม|อัตรา|ราด|กำจัด|รักษา|ป้องกัน|ดี(?:ไหม|มั้ย|มั๊ย|มั๋ย)|ได้(?:ไหม|มั้ย|มั๊ย)|ยังไง|ยังงัย|อย่างไร|กี่|คือ(?:อะไร|ยา)|เป็นยา|ขวด|แกลลอน|ตัวนี้)/
};

function bareText(text) {
  return String(text || '').replace(NOISE_RX, '')
    .replace(/^(?:อยู่ที่|อยู่|ที่|แถว)+/, '')
    .replace(/(?:ค่ะ|คะ|ค่า|ครับ|คับ|ฮะ|จ้า|จ้ะ|จ๊ะ|นะ)+$/, '');
}

// rx: a province regex with one capture group (PROVINCE_RX / PROVINCE_ALL_RX in server.js).
// Returns the first province name as typed (aliases not mapped yet), or '' when there is none.
function provinceMatch(rx, text) {
  const t = String(text || '');
  const g = new RegExp(rx.source, 'g');
  let m;
  while ((m = g.exec(t))) {
    const name = m[1];
    if (ENDS_IN_CONSONANT_RX.test(name) && NEXT_IN_SYLLABLE_RX.test(t.slice(m.index + name.length))) continue;
    if (PRODUCT_LOOKALIKES[name] && !MARK_BEFORE_RX.test(t.slice(0, m.index)) && PRODUCT_LOOKALIKES[name].test(t.slice(m.index + name.length))) continue;
    if (!PROVINCE_WORDS.has(name)) return name;
    if (MARK_BEFORE_RX.test(t.slice(0, m.index))) return name;
    if (bareText(t) === name) return name;
  }
  return '';
}

module.exports = { provinceMatch, PROVINCE_WORDS };

