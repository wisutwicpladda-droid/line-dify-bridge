'use strict';

// v3.70 (Feedback น้องลัดดา 2-3 พ.ย. 2569)
// ข้อ 20: ลูกค้าถาม "ราเซอร์ใช้กับแตงโมได้ไหม" บอทตอบว่าไม่แนะนำ แต่ bridge ส่งรูปราเซอร์ตามมา ลูกค้าอาจเข้าใจว่าใช้ได้
//   -> สินค้าที่ทุกประโยคในคำตอบพูดถึงแบบ "ไม่แนะนำ / ยังไม่มีคำแนะนำ / ไม่ควรใช้" ไม่ส่งรูปและไม่มีปุ่มดูรูป
//   ประโยคที่มีอัตราใช้ (ตัวเลขกับหน่วย) หรือคำว่า "แนะนำ" (ที่ไม่ใช่ "ไม่แนะนำ"/"คำแนะนำ") นับเป็นคำแนะนำเสมอ
//   ข้อควรระวังท้ายคำแนะนำ เช่น "(ไม่แนะนำฉีดพ่นช่วงดอกบาน)" จึงไม่ทำให้รูปของสินค้าที่แนะนำหายไป
// ข้อ 18, 23: ป้ายปุ่มดูรูปสินค้า LINE จำกัด 20 ตัวอักษร เดิมตัดกลางคำ ("📷 ไดพิม 90 ดับเบิลย")
//   -> ย่อสูตรยาเป็นตัวย่อสากล (ดับเบิลยูจี = WG, ดับเบิ้ลยู.พี. = WP) ถ้ายังยาวเกินให้ตัดอีโมจิ แล้วจึงตัดที่ช่องว่างพร้อม …
//   ข้อความที่ส่งเมื่อกดปุ่มยังเป็นชื่อเต็ม ("ขอรูป <ชื่อเต็ม>")

const NEG_RX = /ไม่แนะนำ|ยังไม่มีคำแนะนำ|ไม่มีคำแนะนำ|ไม่ควรใช้|ห้ามใช้|ใช้ไม่ได้|ไม่สามารถใช้|ยังไม่มีข้อมูลการใช้/;
const POS_RX = /(?<!ไม่|คำ)แนะนำ/;
const RATE_RX = /\d[\d.,]*\s*(?:-\s*\d[\d.,]*\s*)?(?:ซีซี|ซี\.ซี\.|cc|มล\.?|มิลลิลิตร|ลิตร|กรัม|กก\.|กิโลกรัม|กิโล)/i;
const SENTENCE_SPLIT = /\n+|(?<=ค่ะ|คะ|ครับ|\.)\s+/;

function sentences(answer) {
  return String(answer == null ? '' : answer).split(SENTENCE_SPLIT).map((x) => x.trim()).filter(Boolean);
}

function isNegative(sentence) {
  return NEG_RX.test(sentence) && !RATE_RX.test(sentence) && !POS_RX.test(sentence);
}

// names = ชื่อสินค้าที่พบในคำตอบ คืน Set ของชื่อที่คำตอบไม่ได้แนะนำให้ใช้เลย
function negatedProducts(answer, names) {
  const out = new Set();
  const list = sentences(answer);
  for (const n of names || []) {
    const said = list.filter((x) => x.includes(n));
    if (said.length && said.every(isNegative)) out.add(n);
  }
  return out;
}

const LABEL_MAX = 20; // LINE quick reply label
const FORM_ABBR = [
  [/\s*ดับเบิ้?ลยู\s*\.?\s*จี\s*\.?/g, ' WG'],
  [/\s*ดับเบิ้?ลยู\s*\.?\s*พี\s*\.?/g, ' WP'],
  [/\s*เอส\s*\.?\s*ซี\s*\.?(?=$|\s)/g, ' SC'],
  [/\s*อี\s*\.?\s*ซี\s*\.?(?=$|\s)/g, ' EC']
];
function shortName(name) {
  let s = String(name == null ? '' : name).trim();
  for (const [rx, to] of FORM_ABBR) s = s.replace(rx, to);
  return s.replace(/\s{2,}/g, ' ').trim();
}
function buttonLabel(name) {
  const full = String(name == null ? '' : name).trim();
  const short = shortName(full);
  for (const c of ['📷 ' + full, '📷 ' + short, short]) if (c.length <= LABEL_MAX) return c;
  const cut = short.slice(0, LABEL_MAX - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp >= 6 ? cut.slice(0, sp) : cut).trim() + '…';
}

// v3.76 (5 พ.ย. 2569): Dify (โหนดตรวจหลักฐานและรูปแบบ LINE v11) ต่อท้ายคำตอบด้วย [[no_img:ชื่อ|ชื่อ]]
// = สินค้าที่ลูกค้าบอกว่าใช้แล้วไม่ได้ผลหรืออยากเปลี่ยน (บทบาทสินค้าที่ AI ขั้นวิเคราะห์อ่าน) ห้ามส่งรูปหรือปุ่มดูรูป
// ตัดเครื่องหมายออกทุกจุดก่อนข้อความถึงลูกค้า
const NO_IMG_RX = /\[\[no_img:([^\]\n]*)\]\]/g;
function splitNoImageTag(answer) {
  const names = [];
  const text = String(answer == null ? '' : answer).replace(NO_IMG_RX, (_, list) => {
    for (const n of String(list).split('|')) if (n.trim() && !names.includes(n.trim())) names.push(n.trim());
    return '';
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, names };
}

module.exports = { negatedProducts, isNegative, sentences, buttonLabel, shortName, LABEL_MAX, splitNoImageTag };

