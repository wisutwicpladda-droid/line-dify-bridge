'use strict';

// v3.31: สรุปเคสลูกค้าที่สนใจซื้อและทิ้งเบอร์ไว้ แล้วส่งเข้ากลุ่ม LINE ฝ่ายขายเป็นเคส ๆ
// เคส = ลูกค้าพิมพ์เบอร์ในแชท + ใน 48 ชม. มีสัญญาณซื้อ (คำว่าซื้อ/ราคา/ร้าน/ทีมขาย ฯลฯ หรือบอทแนะนำสินค้าไปแล้ว)

const PHONE_RX = /(?<!\d)0\d{1,2}[- ]?\d{3}[- ]?\d{3,4}(?!\d)/;
const INTEREST_RX = /ซื้อ|สั่ง|ราคา|กี่บาท|ร้าน|ตัวแทน|จำหน่าย|ขายที่ไหน|สนใจ|อยากได้|ติดต่อ|ทีมขาย|พนักงาน|เซลล์|โทรกลับ|ส่งของ|ขอเบอร์|ใครดูแล/;
const WINDOW_MS = 48 * 3600000;
const RESEND_MS = 24 * 3600000;

function recent(history, now) {
  const list = Array.isArray(history) ? history : [];
  const inWindow = list.filter((h) => h && (!h.at || now - h.at <= WINDOW_MS));
  return inWindow.slice(-30);
}

// productsOf(text) คืนรายชื่อสินค้าที่พบในข้อความ (ใช้ตัวเดียวกับระบบรูปสินค้า)
function leadInterest(history, productsOf, now) {
  const rec = recent(history, now);
  const userTexts = rec.filter((h) => h.r === 'u').map((h) => String(h.t || ''));
  const botTexts = rec.filter((h) => h.r === 'b').map((h) => String(h.t || ''));
  const keyword = userTexts.some((t) => INTEREST_RX.test(t));
  const products = [...new Set(productsOf(botTexts.concat(userTexts).join('\n')) || [])].slice(0, 6);
  const questions = userTexts
    .filter((t) => t && !/^\(/.test(t) && !/^ขอรูป/.test(t))
    .slice(-4)
    .map((t) => t.replace(/\s+/g, ' ').slice(0, 90));
  return { interested: keyword || products.length > 0, keyword, products, questions };
}

function shouldSend(s, phone, now) {
  const last = s && s.lead;
  if (!last || !last.at) return true;
  if (last.phone !== phone) return true;
  return now - last.at > RESEND_MS;
}

function thaiTime(ms) {
  const d = new Date(ms + 7 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ' น.';
}

function buildCard(x) {
  const lines = ['🛒 เคสลูกค้าสนใจซื้อ — รบกวนฝ่ายขายติดต่อกลับ'];
  lines.push('ลูกค้า: ' + (x.name || '-'));
  lines.push('โทร: ' + x.phone);
  if (x.phoneNote) lines.push('ข้อความตอนให้เบอร์: ' + x.phoneNote);
  lines.push('พื้นที่: ' + (x.province ? 'จ.' + x.province + (x.zone ? ' (เขต ' + x.zone + ')' : '') : 'ยังไม่ทราบจังหวัด'));
  if (x.crops) lines.push('พืช: ' + x.crops);
  if (x.products && x.products.length) lines.push('สินค้าที่คุยถึง: ' + x.products.join(', '));
  if (x.questions && x.questions.length) {
    lines.push('ลูกค้าถาม:');
    x.questions.forEach((q) => lines.push('• ' + q));
  }
  if (x.promised) lines.push('สถานะ: บอทแจ้งลูกค้าแล้วว่าจะมีเจ้าหน้าที่ติดต่อกลับ');
  lines.push('ทีมเขตที่ควรติดต่อ: ' + (x.team || 'ยังไม่ทราบเขต รบกวนแอดมินช่วยกระจายเคส'));
  lines.push('เวลา: ' + thaiTime(x.at));
  if (x.adminUrl) lines.push('ดูแชทเต็ม: ' + x.adminUrl);
  return lines.join('\n').slice(0, 4900);
}

module.exports = { PHONE_RX, INTEREST_RX, leadInterest, shouldSend, buildCard, thaiTime };
