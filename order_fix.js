// v3.16: เมื่อ guardOrder ย้ายสินค้าระดับแนะนำเลขน้อยขึ้นเป็นตัวแรก ประโยคปิดท้ายของ LLM ยังบอกให้ "เริ่มจาก" ตัวเดิม
// (ชีท QA ข้อ 9: ต้องบอกให้ชัดว่าเลือกตัวไหน) จึงเขียนประโยคเริ่มต้นและประโยคทางเลือกใหม่ตามลำดับจริง
// ประโยคที่ไม่ได้พูดถึงสินค้าในชุดนี้ (เช่น วิธีพ่น ข้อควรระวัง) คงไว้ตามเดิม
// ตัวอื่นจะบอกว่า "ออกฤทธิ์คนละกลุ่ม ใช้สลับ" ก็ต่อเมื่อกลุ่มกลไกการออกฤทธิ์จากชีทไม่ซ้ำกับตัวแรกเลย

const START_RX = /เริ่ม|ตัวหลัก|ตัวแรก/;
const ALT_RX = /สลับ|ทางเลือก|รอบถัดไป|ก็ได้|แทน|หรือ/;

function moaSet(v) {
  return new Set(String(v || '').toUpperCase().split(/[+,\s/]+/).map((x) => x.trim()).filter((x) => x && x !== '-' && x !== 'NONE'));
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' หรือ ' + names[names.length - 1];
}

function altSentence(first, others, moa) {
  if (!others.length) return '';
  const f = moaSet(moa[first]);
  const diff = [], rest = [];
  for (const n of others) {
    const m = moaSet(moa[n]);
    if (f.size && m.size && [...m].every((x) => !f.has(x))) diff.push(n); else rest.push(n);
  }
  const parts = [];
  if (diff.length) parts.push(joinNames(diff) + ' ออกฤทธิ์คนละกลุ่มกับ ' + first + ' ใช้พ่นสลับในรอบถัดไปเพื่อลดการดื้อยาได้');
  if (rest.length) parts.push(joinNames(rest) + ' เป็นทางเลือกเมื่อหา ' + first + ' ไม่ได้');
  return 'ส่วน ' + parts.join(' และ ') + 'ค่ะ';
}

// par: ย่อหน้าปิดท้าย · fix: { oldFirst, first, others } · moa: { ชื่อสินค้า: 'กลุ่ม MOA' }
// คืน null ถ้าย่อหน้านี้ไม่ได้บอกให้เริ่มจากตัวเดิม
function fixClosing(par, fix, moa) {
  const text = String(par);
  if (!text.includes(fix.oldFirst) || !START_RX.test(text)) return null;
  const names = [fix.first].concat(fix.others);
  const sentences = text.split(/(?<=(?:ค่ะ|คะ|ครับ))[ \t]+/);
  const alt = altSentence(fix.first, fix.others, moa || {});
  const out = [];
  let startDone = false, altDone = false;
  for (const s of sentences) {
    const hit = names.some((n) => s.includes(n));
    if (!hit) { out.push(s); continue; }
    if (!startDone && START_RX.test(s)) {
      out.push('แนะนำให้เริ่มจาก ' + fix.first + ' ก่อนค่ะ' + (alt ? ' ' + alt : ''));
      startDone = true; altDone = !!alt;
      continue;
    }
    if (ALT_RX.test(s) || START_RX.test(s)) {
      if (!altDone && alt) { out.push(alt); altDone = true; }
      continue;
    }
    out.push(s);
  }
  if (!startDone) return null;
  return out.join(' ');
}

module.exports = { fixClosing, altSentence, moaSet };
