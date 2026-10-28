'use strict';

// ตรวจความพร้อมของข้อมูลสินค้าแต่ละแถวก่อนนำไปใช้กับ routing และ KB sync
// โมดูลนี้ไม่แก้ข้อมูลในชีตและไม่ทำให้สินค้าที่ข้อมูลไม่ครบถูกเปิดขายเอง

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const STRATEGIES = new Set(['expand', 'skyrocket', 'natural', 'cosmic-star', 'standard']);

function isOpenStatus(value) {
  const status = clean(value);
  return /^(ขาย|ขายได้แล้ว|ขายแล้ว|เปิดขายแล้ว|พร้อมจำหน่าย)$/.test(status)
    && !/รอเปิด|ยังไม่เปิด|ปิด|ไม่พร้อม|เดือน|เปิดตัว/.test(status);
}

function hasNumber(value) {
  const text = clean(value);
  return text !== '' && Number.isFinite(Number(text.replace(/,/g, '')));
}

// v3.50 (28 Oct 2026): ตรวจเนื้อหาที่เคยหลุดถึงลูกค้า -> notices [{ key, line }] สำหรับแจ้งทีม
// ไม่เปลี่ยน ok และไม่ทำให้สินค้าถูกปิด ข้อความต้องอ่านเข้าใจได้โดยไม่ต้องรู้โค้ด
const HOUSEHOLD_RX = /บ้านเรือน|อาคาร|ยุง|แมลงสาบ|แมลงวันบ้าน/;
// สระบนซ้อนกัน (เพลี้ี้ย), วรรณยุกต์ซ้อนกัน, สระล่างซ้อนกัน (สููตร)
const THAI_MARK_TYPO_RX = /[\u0E31\u0E34-\u0E37][\u0E48-\u0E4C]?[\u0E31\u0E34-\u0E37]|[\u0E48-\u0E4B]{2}|[\u0E38-\u0E3A]{2}/;
const TEXT_FIELDS = [[7, 'จุดเด่น'], [9, 'กลไกการออกฤทธิ์'], [10, 'ลักษณะการออกฤทธิ์'], [11, 'ความเป็นพิษต่อพืช'], [12, 'ข้อควรระวัง']];
const COPY_SET = [7, 9, 10]; // ซ้ำครบสามช่องนี้ระหว่างสินค้าคนละสาร = น่าจะคัดลอกทั้งแถวมาผิด
const CHEM_CATS = /^(Herbicide|Insecticide|Fungicide)$/i;
// กลุ่มกลไกที่เป็นรหัสสารจริง (A, C1, 4A, 3+3, M3, 33) สินค้ากลุ่มเดียวกันใช้ข้อความกลไกร่วมกันได้
// ส่วนค่าแบบ Biostimulants, PGR, none ไม่ใช่รหัสกลุ่มสาร
const MOA_CODE_RX = /^[A-Z]{0,2}\d{0,2}[A-Z]?(?:\s*\+\s*[A-Z]{0,2}\d{0,2}[A-Z]?)*$/;
const COMPARE_RX = /กว่า|เทียบ|แทน|ต่างจาก|ไม่ใช่|ร่วมกับ|ผสม|สลับ|ดื้อ/;
// ชื่อสารภาษาไทยสะกดได้หลายแบบ (อะมีทริน/อะมีทรีน) เทียบแบบไม่สนสระสั้นยาวและวรรณยุกต์
const thFold = (s) => String(s || '').replace(/ี/g, 'ิ').replace(/ื/g, 'ึ').replace(/ู/g, 'ุ').replace(/[\u0E48-\u0E4C]/g, '');
const COMPARE_FOLDED_RX = new RegExp(thFold(COMPARE_RX.source));
const AI_STOP = new Set(['PROTEIN', 'HYDROLYSATE', 'EXTRACT', 'ACIDS', 'AMINO', 'SODIUM', 'POTASSIUM', 'AMMONIUM', 'METHYL', 'ETHYL', 'BUTYL',
  'HYDROCHLORIDE', 'NITRATE', 'SULFATE', 'SULPHATE', 'OXIDE', 'CHELATE', 'COMPLEX', 'TECHNICAL', 'SOLUBLE', 'POWDER']);

function aiIdentity(ai) {
  const s = String(ai || '').toUpperCase();
  const words = new Set((s.match(/[A-Z]{5,}/g) || []).filter((w) => !AI_STOP.has(w)));
  if (/2,4-D/.test(s)) words.add('2,4-D');
  return words;
}

function thaiAiNames(common) {
  return String(common || '').split(/\s*[+,/]\s*|\s+และ\s+/)
    .map((part) => (part.trim().match(/^[\u0E00-\u0E7F][\u0E00-\u0E7F-]{3,}/) || [''])[0])
    .filter((n) => n.length >= 5);
}

function isMoaCode(moa) {
  const m = clean(moa).toUpperCase();
  return !!m && m.length <= 9 && MOA_CODE_RX.test(m);
}

function contentNotices(products, usages) {
  const notices = [];
  const add = (key, line) => { if (!notices.some((n) => n.key === key)) notices.push({ key, line }); };
  const info = products.map((row) => ({
    id: clean(row[0]), name: clean(row[1]).replace(/\s*\(ไม่มีรูป\)\s*/g, '').trim(), raw: String(row[1] == null ? '' : row[1]),
    cat: clean(row[2]), ai: aiIdentity(row[4]), moa: clean(row[5]), thai: thaiAiNames(row[3]),
    texts: Object.fromEntries(TEXT_FIELDS.map(([c]) => [c, clean(row[c])])), row
  }));
  const nameOf = new Map(info.map((p) => [p.id, p.name]));

  // 1) ชื่อสินค้ามีช่องว่างหรือตัวขึ้นบรรทัดเกิน
  for (const p of info) {
    if (/^\s|\s$|[\r\n\t]|\s{2,}/.test(p.raw)) add('name-space:' + p.id, 'ชื่อสินค้า "' + p.name + '" (' + p.id + ') มีช่องว่างหรือตัวขึ้นบรรทัดเกินในช่องชื่อ ชื่อในคำตอบของบอทจะติดช่องว่างไปด้วย');
  }

  // 2) ข้อความยาวซ้ำกันระหว่างสินค้าคนละประเภท
  for (const [col, label] of TEXT_FIELDS) {
    const groups = new Map();
    for (const p of info) {
      const t = p.texts[col];
      if (t.length < 40 || /^(none|-|ไม่มี)$/i.test(t)) continue;
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(p);
    }
    for (const ps of groups.values()) {
      const cats = new Map();
      for (const p of ps) cats.set(p.cat, (cats.get(p.cat) || 0) + 1);
      if (ps.length < 2 || cats.size < 2) continue;
      const top = Math.max(...cats.values());
      const odd = ps.filter((p) => cats.get(p.cat) < top || [...cats.values()].every((n) => n === top));
      const others = ps.filter((p) => !odd.includes(p));
      const key = 'dup-category:' + col + ':' + ps.map((p) => p.id).sort().join(',');
      add(key, odd.map((p) => p.name + ' (' + (p.cat || 'ไม่ระบุประเภท') + ')').join(', ') + ' ใช้ข้อความ' + label + 'เหมือนกันทุกคำกับ '
        + (others.length ? others.map((p) => p.name).join(', ') + ' ซึ่งเป็นสินค้าคนละประเภท' : 'สินค้าคนละประเภท') + ' น่าจะคัดลอกผิดแถว');
    }
  }

  // 3) จุดเด่น กลไก และลักษณะการออกฤทธิ์ซ้ำครบทั้งสามช่องระหว่างสินค้าที่สารสำคัญต่างกัน
  //    ยกเว้นสินค้ากลุ่มกลไกเดียวกัน (รหัสสารจริง) ซึ่งใช้คำอธิบายกลไกร่วมกันได้
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const a = info[i], b = info[j];
      if ([...a.ai].some((w) => b.ai.has(w))) continue;
      if (isMoaCode(a.moa) && clean(a.moa).toUpperCase() === clean(b.moa).toUpperCase()) continue;
      if (!COPY_SET.every((c) => a.texts[c].length >= 20 && a.texts[c] === b.texts[c])) continue;
      add('dup-copy:' + [a.id, b.id].sort().join(','), a.name + ' กับ ' + b.name + ' ใช้ข้อความจุดเด่น กลไก และลักษณะการออกฤทธิ์ชุดเดียวกันทุกคำ ทั้งที่สารสำคัญต่างกัน บอทจะอธิบายสินค้าตัวหนึ่งด้วยข้อมูลของอีกตัว');
    }
  }

  // 3b) ข้อความของยาเคมีเอ่ยชื่อสารของสินค้าอื่นเหมือนเป็นสารของตัวเอง (เช่นยาอะทราซีนที่เขียนว่า "อะมีทรีนยับยั้ง...")
  const chem = info.filter((p) => CHEM_CATS.test(p.cat));
  const display = new Map();
  for (const p of chem) for (const n of p.thai) if (!display.has(thFold(n))) display.set(thFold(n), n);
  const allNames = [...display.keys()];
  for (const p of chem) {
    const own = p.thai.map(thFold);
    for (const [col, label] of TEXT_FIELDS) {
      const t = thFold(p.texts[col]);
      if (!t) continue;
      for (const n of allNames) {
        if (own.some((o) => o.includes(n) || n.includes(o))) continue;
        const at = t.indexOf(n);
        if (at < 0 || COMPARE_FOLDED_RX.test(t.slice(Math.max(0, at - 24), at))) continue;
        add('foreign-ai:' + p.id + ':' + col, p.name + ' ช่อง' + label + 'เขียนถึงสาร' + display.get(n) + ' ซึ่งไม่ใช่สารของสินค้านี้ (สารของสินค้านี้คือ ' + (p.thai.join(' + ') || clean(p.row[3])) + ')');
        break;
      }
    }
  }

  // 4) สะกดผิดแบบสระหรือวรรณยุกต์ซ้อน
  const typo = (key, who, text) => {
    const m = String(text || '').match(THAI_MARK_TYPO_RX);
    if (!m) return;
    const s = String(text);
    const start = Math.max(0, m.index - 8);
    add(key, who + ' สะกดผิด (สระหรือวรรณยุกต์ซ้อน): "' + s.slice(start, m.index + m[0].length + 8).replace(/\s+/g, ' ').trim() + '"');
  };
  for (const p of info) {
    typo('thai:' + p.id + ':name', 'ชื่อสินค้า ' + p.name, p.raw);
    typo('thai:' + p.id + ':common', p.name + ' ช่องชื่อสามัญ', p.row[3]);
    for (const [col, label] of TEXT_FIELDS) typo('thai:' + p.id + ':' + col, p.name + ' ช่อง' + label, p.row[col]);
  }
  for (const u of usages) {
    const id = clean(u[0]);
    const who = id + ' ' + (nameOf.get(clean(u[1])) || clean(u[2]));
    typo('thai:' + id + ':target', who + ' ช่องศัตรูพืช', u[6]);
    typo('thai:' + id + ':stage', who + ' ช่องระยะพืช', u[7]);
    typo('thai:' + id + ':how', who + ' ช่องวิธีใช้', u[10]);
    typo('thai:' + id + ':note', who + ' ช่องหมายเหตุ', u[18]);
  }

  // 5) แมลงในบ้านอยู่ในแถวพืช (บอทอาจแนะนำสินค้านี้ให้กำจัดยุง แมลงสาบ หรือมดบนต้นพืช)
  const household = new Map();
  for (const u of usages) {
    const m = clean(u[6]).match(HOUSEHOLD_RX);
    if (!m) continue;
    const pid = clean(u[1]);
    const h = household.get(pid) || { name: nameOf.get(pid) || clean(u[2]), crops: [], words: new Set(), ids: [] };
    const crop = clean(u[4]) || clean(u[3]);
    if (crop && !h.crops.includes(crop)) h.crops.push(crop);
    h.words.add(m[0]);
    h.ids.push(clean(u[0]));
    household.set(pid, h);
  }
  for (const [pid, h] of household) {
    add('household:' + pid, h.name + ' แถวพืช ' + h.crops.join(', ') + ' (' + h.ids.join(' ') + ') มีแมลงในบ้าน (' + [...h.words].join(', ') + ') ในช่องศัตรูพืช บอทอาจแนะนำสินค้านี้ให้กำจัดแมลงในบ้านบนต้นพืช');
  }
  return notices;
}

function validateProductData(masterRows, usageRows, imageIndex) {
  const errors = [];
  const warnings = [];
  const master = (masterRows || []).slice(1);
  const usages = (usageRows || []).slice(1);
  const images = imageIndex || {};
  const usageByProduct = new Map();

  for (const row of usages) {
    const id = clean(row[1]);
    if (id) {
      if (!usageByProduct.has(id)) usageByProduct.set(id, []);
      usageByProduct.get(id).push(row);
    }
  }

  const products = master.filter((row) => clean(row[0]).startsWith('P'));
  const ids = new Set();
  for (const row of products) {
    const id = clean(row[0]);
    const rawName = clean(row[1]);
    const name = rawName.replace(/\s*\(ไม่มีรูป\)\s*/g, '').trim();
    const common = clean(row[3]);
    const active = clean(row[4]);
    const category = clean(row[2]);
    const strategy = clean(row[13]);
    const status = clean(row[14]);
    const key = strategy.toLowerCase().replace(/\s+/g, '-');
    const label = name || id || '(ไม่มีรหัส/ชื่อ)';

    if (!id) errors.push(`${label}: ไม่มีรหัสสินค้า`);
    else if (ids.has(id)) errors.push(`${label}: รหัสสินค้าซ้ำ ${id}`);
    else ids.add(id);
    if (!name) errors.push(`${id || '(ไม่มีรหัส)'}: ไม่มีชื่อสินค้า`);
    if (!category) warnings.push(`${label}: ไม่มีหมวดสินค้า`);
    if (!common && !active) errors.push(`${label}: ไม่มีชื่อสามัญหรือสารสำคัญ`);
    if (!status) errors.push(`${label}: ไม่มีสถานะขาย`);
    if (!strategy) errors.push(`${label}: ไม่มี Strategy`);
    else if (!STRATEGIES.has(key)) errors.push(`${label}: Strategy ไม่อยู่ในรายการที่กำหนด (${strategy})`);

    // สินค้าที่ยังไม่เปิดต้องถูกตรวจข้อมูลตัวตน แต่ไม่บังคับให้มีรูปหรืออัตราใช้
    if (!isOpenStatus(status)) continue;

    if (!Object.prototype.hasOwnProperty.call(images, name)) warnings.push(`${label}: ยังไม่มีรูปสินค้าใน index`);
    const rows = usageByProduct.get(id) || [];
    const targetRows = rows.filter((r) => clean(r[6]));
    if (!targetRows.length) {
      errors.push(`${label}: ไม่มีข้อมูลพืช/เป้าหมายการใช้`);
      continue;
    }
    for (const use of targetRows) {
      if (!clean(use[3]) && !clean(use[4])) warnings.push(`${label}: แถวการใช้ไม่มีพืช`);
      if (!clean(use[7])) warnings.push(`${label}: แถวการใช้ไม่มีระยะพืช`);
      if (!hasNumber(use[11]) && !hasNumber(use[12])) warnings.push(`${label}: แถวการใช้ไม่มีอัตรา`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    notices: contentNotices(products, usages),
    summary: {
      products: products.length,
      openProducts: products.filter((r) => isOpenStatus(r[14])).length,
      closedOrUnreleasedProducts: products.filter((r) => !isOpenStatus(r[14])).length,
      errors: errors.length,
      warnings: warnings.length
    }
  };
}

module.exports = { validateProductData, isOpenStatus, STRATEGIES, contentNotices, aiIdentity };
