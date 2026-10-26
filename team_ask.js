'use strict';

// v3.38 (LINE feedback FB-04, FB-11, 26 Oct 2026): "ทีมงานในพื้นที่ของฉัน" from the
// rich menu sent three registration messages, while "ขอเบอทีมขาย" went to Dify
// and the model named the same A04 people "ทีมขายเขตราชบุรี" in one chat and
// "ทีมขายเขตสมุทรปราการ" in another. Every short request for the sales team is
// now answered from the team sheet with the zone code; without a province the
// bot asks for it once in a single message.

const TEAM_WORD_RX = /(ทีมงาน|ทีมขาย|ทีมเซล(?:ล์)?|เซลล์|ผู้แทน(?:ขาย)?|ตัวแทนขาย|พนักงานขาย|ผู้ดูแล(?:เขต|พื้นที่)|เจ้าหน้าที่(?:ขาย|ใน(?:พื้นที่|เขต)|ประจำ(?:พื้นที่|เขต)))/;
const FILLER_RX = /ขอ|ดู|อยาก(?:ได้|รู้)?|ทราบ|หา|มี|เบอร์โทร|เบอโทร|เบอร์|เบอ|โทรศัพท์|โทร|ติดต่อ|ช่องทาง|ทาง|ไลน์|ไอดี|สอบถาม|ปรึกษา|คุย|กับ|ใน|ประจำ|ดูแล|พื้นที่|เขต|จังหวัด|จ\.|ของ|ฉัน|ผม|หนู|เรา|ดิฉัน|หน่อย|ด้วย|ได้|ไหม|มั้ย|มั๊ย|ค่ะ|คะ|ครับ|คับ|จ้า|จ้ะ|นะ|อยู่|ที่|คน|ไหน|อะไร|บ้าง|แถว|นี้|นั้น/g;
const NOISE_RX = /[\s.!?,:;()"'“”~\-]+|\p{Extended_Pictographic}/gu;

// Short names customers type for a province. They also begin people's names and
// other places (สุพรรณี, ปทุมมา, กาญจนา, อุดรศักดิ์, ปากน้ำโพ), so they are read only
// in a sales team request or in the reply to "อยู่จังหวัดไหน", never at registration.
const SHORT_PROVINCE = { 'ปากน้ำโพ': 'นครสวรรค์', 'สุพรรณ': 'สุพรรณบุรี', 'ปทุม': 'ปทุมธานี', 'อุดร': 'อุดรธานี', 'กาญ': 'กาญจนบุรี', 'ปากน้ำ': 'สมุทรปราการ' };
const SHORT_RX = new RegExp(Object.keys(SHORT_PROVINCE).sort((a, b) => b.length - a.length).join('|'), 'g');

function findProvince(t, provinceOf) {
  const full = provinceOf(t);
  if (full) return full;
  const m = t.match(SHORT_RX);
  return m ? SHORT_PROVINCE[m[0]] : '';
}
function stripProvince(t, provinceRx) {
  return (provinceRx ? t.replace(new RegExp(provinceRx.source, 'g'), ' ') : t).replace(SHORT_RX, ' ');
}

// Returns { province } when the whole message is a request for the sales team
// (optionally with a province), otherwise null so the question goes to Dify.
function teamAsk(text, provinceOf, provinceRx) {
  const t = String(text || '').trim();
  if (!t || t.length > 60 || !TEAM_WORD_RX.test(t)) return null;
  const province = findProvince(t, provinceOf);
  let rest = t.replace(TEAM_WORD_RX, ' ');
  if (province) rest = stripProvince(rest, provinceRx);
  rest = rest.replace(FILLER_RX, ' ').replace(NOISE_RX, '');
  return rest.length <= 2 ? { province } : null;
}

// A short reply that is basically a province name (after the bot asked for one).
function provinceAnswer(text, provinceOf, provinceRx) {
  const t = String(text || '').trim();
  if (!t || t.length > 30) return '';
  const province = findProvince(t, provinceOf);
  if (!province) return '';
  const rest = stripProvince(t, provinceRx)
    .replace(/จังหวัด|จ\.|อำเภอ|อ\.|อยู่|ที่|ค่ะ|คะ|ครับ|คับ|จ้า|นะ|เมือง/g, ' ').replace(NOISE_RX, '');
  return rest.length <= 12 ? province : '';
}

module.exports = { teamAsk, provinceAnswer, TEAM_WORD_RX };
