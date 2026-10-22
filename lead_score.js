'use strict';

// v3.37 (ทดลองใน V.2): คะแนนความสนใจซื้อ 0-100 ต่อแชท คำนวณจากสัญญาณในแชท 7 วันล่าสุด
// ใช้ในหน้า /admin (ป้าย 🔥/🌤/❄️ + เหตุผล) และในการ์ดส่งต่อร้าน เปิดด้วย LEAD_SCORE=on

const BUY_RX = /ซื้อ|สั่ง|ราคา|กี่บาท|ร้าน|ตัวแทน|จำหน่าย|ขายที่ไหน|มีขาย|หาซื้อ|อยากได้|สนใจ|จัดส่ง|ส่งของ/;
const AREA_RX = /\d[\d,.]*\s*ไร่/;
const PHONE_RX = /(?<!\d)0\d{1,2}[- ]?\d{3}[- ]?\d{3,4}(?!\d)/;
const WINDOW_MS = 7 * 24 * 3600000;
const LEVEL_TH = { hot: 'ร้อน', warm: 'อุ่น', cold: 'เย็น' };
const LEVEL_ICON = { hot: '🔥', warm: '🌤', cold: '❄️' };

function levelOf(value) {
  return value >= 60 ? 'hot' : (value >= 30 ? 'warm' : 'cold');
}

// input: { history, productsOf(text) -> [names], asksRate(text) -> bool, province, phone, referral, now }
function scoreLead(input) {
  const x = input || {};
  const now = x.now || Date.now();
  const hist = (Array.isArray(x.history) ? x.history : []).filter((h) => h && (!h.at || now - h.at <= WINDOW_MS));
  const users = hist.filter((h) => h.r === 'u').map((h) => String(h.t || '')).filter((t) => t && !/^\(/.test(t));
  const bots = hist.filter((h) => h.r === 'b').map((h) => String(h.t || ''));
  const productsOf = typeof x.productsOf === 'function' ? x.productsOf : () => [];
  const parts = [];
  const add = (pts, why) => parts.push({ pts, why });

  const askedProducts = [...new Set(productsOf(users.join('\n')) || [])];
  const shownProducts = [...new Set(productsOf(bots.join('\n')) || [])];
  if (askedProducts.length) add(15, 'ถามถึงสินค้า ' + askedProducts.slice(0, 3).join(', '));
  else if (shownProducts.length) add(10, 'บอทแนะนำ ' + shownProducts.slice(0, 3).join(', '));
  if (typeof x.asksRate === 'function' && users.some((t) => x.asksRate(t))) add(15, 'ถามวิธีใช้/อัตรา');
  const area = users.map((t) => t.match(AREA_RX)).find(Boolean);
  if (area) add(15, 'บอกพื้นที่ ' + area[0].replace(/\s+/g, ' '));
  const buy = users.find((t) => BUY_RX.test(t));
  if (buy) add(25, 'สนใจซื้อ: "' + buy.replace(/\s+/g, ' ').slice(0, 40) + '"');
  if (x.phone || users.some((t) => PHONE_RX.test(t))) add(15, 'ให้เบอร์โทร');
  if (x.province) add(5, 'รู้จังหวัด ' + x.province);
  if (users.length >= 6) add(10, 'คุยต่อเนื่อง ' + users.length + ' ข้อความ');
  else if (users.length >= 3) add(5, 'คุย ' + users.length + ' ข้อความ');

  let value = Math.min(100, parts.reduce((a, p) => a + p.pts, 0));
  const ref = x.referral;
  if (ref && ref.step === 'sent') { value = Math.max(value, 90); add(0, 'ยืนยันให้ส่งต่อร้าน' + (ref.dealerName ? ' ' + ref.dealerName : '')); }
  else if (ref && ref.step === 'declined') add(0, 'ยังไม่ต้องการให้ส่งต่อร้าน');
  const level = levelOf(value);
  return {
    value,
    level,
    levelTh: LEVEL_TH[level],
    icon: LEVEL_ICON[level],
    products: askedProducts.concat(shownProducts.filter((p) => !askedProducts.includes(p))).slice(0, 5),
    reasons: parts.map((p) => p.why + (p.pts ? ' (+' + p.pts + ')' : '')),
    at: now
  };
}

module.exports = { scoreLead, levelOf, LEVEL_TH, BUY_RX };

