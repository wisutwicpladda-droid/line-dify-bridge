'use strict';

// Build a small, verified slice of the current Product Usage sheet for queries
// where Dify retrieval can otherwise return only the first matching product.
// This module intentionally exposes no internal strategy group names.

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

function queryAgeMonths(query) {
  const m = String(query || '').match(/(?:อายุ|ประมาณ|ราว)?\s*(\d+(?:\.\d+)?)\s*เดือน/);
  return m ? Number(m[1]) : null;
}

function queryAgeDays(query) {
  const m = String(query || '').match(/(?:อายุ|ประมาณ|ราว)?\s*(\d+(?:\.\d+)?)\s*(?:วัน|วันหลังหว่าน)/);
  return m ? Number(m[1]) : null;
}

function stageMatches(stage, ageMonths) {
  const st = clean(stage);
  if (ageMonths == null) return false;
  if (/ทุกระยะ/.test(st)) return true;
  const ranges = [...st.matchAll(/(\d+(?:\.\d+)?)\s*[-–ถึง]\s*(\d+(?:\.\d+)?)\s*เดือน/g)];
  if (ranges.some((m) => ageMonths >= Number(m[1]) && ageMonths <= Number(m[2]))) return true;
  const single = [...st.matchAll(/(\d+(?:\.\d+)?)\s*เดือน/g)].map((m) => Number(m[1]));
  return single.some((n) => n === ageMonths);
}

function stageMatchesDays(stage, ageDays) {
  const st = clean(stage);
  if (ageDays == null) return false;
  if (/ทุกระยะ/.test(st)) return true;
  const ranges = [...st.matchAll(/(\d+(?:\.\d+)?)\s*[-–ถึง]\s*(\d+(?:\.\d+)?)\s*(?:วัน|วันหลังหว่านข้าว)?/g)];
  if (ranges.some((m) => ageDays >= Number(m[1]) && ageDays <= Number(m[2]))) return true;
  const single = [...st.matchAll(/(\d+(?:\.\d+)?)\s*วัน/g)].map((m) => Number(m[1]));
  return single.some((n) => n === ageDays);
}

function isPostEmergenceQuery(query) {
  return /(ฉีด\s*ทับ|ยาเก็บ|ฆ่า\s*หญ้า|วัชพืช|หญ้า)/.test(String(query || ''));
}

function blockedForSprayOverCrop(name, query) {
  // App safety rule: do not suggest Chironya for spraying over emerged sugarcane.
  return /ฉีด\s*ทับ/.test(String(query || '')) && name === 'ชิรอนย่า';
}

function levelFor(name, levels) {
  const map = levels && levels.map ? levels.map : (levels || {});
  return Number(map[name] || 999);
}

function buildVerifiedUsageContext(query, masterRows, usageRows, levels) {
  const q = String(query || '');
  if (!isPostEmergenceQuery(q)) return '';
  const isSugarcane = /อ้อย/.test(q);
  const isRice = /นาข้าว|ข้าว(?!โพด)/.test(q);
  if (!isSugarcane && !isRice) return '';
  const ageMonths = isSugarcane ? queryAgeMonths(q) : null;
  const ageDays = isRice ? queryAgeDays(q) : null;
  if ((isSugarcane && ageMonths == null) || (isRice && ageDays == null)) return '';

  const master = new Map();
  for (const r of (masterRows || []).slice(1)) {
    const id = clean(r[0]);
    if (!id) continue;
    master.set(id, { name: clean(r[1]), common: clean(r[3]), ai: clean(r[4]), moa: clean(r[5]) });
  }

  const hits = new Map();
  for (const r of (usageRows || []).slice(1)) {
    const productId = clean(r[1]);
    const product = master.get(productId);
    const crop = clean([r[3], r[4]].filter(Boolean).join(' / '));
    const targetType = clean(r[5]);
    const target = clean(r[6]);
    const stage = clean(r[7]);
    const cropMatches = isSugarcane ? /อ้อย/.test(crop) : /นาข้าว|ข้าว/.test(crop);
    const stageMatchesQuery = isSugarcane ? stageMatches(stage, ageMonths) : stageMatchesDays(stage, ageDays);
    const targetMatches = /หญ้าข้าวนก/.test(q) ? /หญ้าข้าวนก/.test(target) : true;
    if (!product || blockedForSprayOverCrop(product.name, q) || !cropMatches || !/วัชพืช/.test(targetType) || !targetMatches || !stageMatchesQuery) continue;
    const item = hits.get(product.name) || { product, uses: [] };
    const useKey = [crop, target, stage].join('|');
    if (!item.uses.some((u) => u.key === useKey)) item.uses.push({ key: useKey, crop, target, stage });
    hits.set(product.name, item);
  }

  const items = [...hits.values()].sort((a, b) => levelFor(a.product.name, levels) - levelFor(b.product.name, levels) || a.product.name.localeCompare(b.product.name, 'th'));
  if (!items.length) return '';

  const lines = [
    '[ข้อมูลตรวจสอบภายในจาก Google Sheet บริษัท — ใช้เป็นหลักฐานประกอบคำตอบ ห้ามเปิดเผยข้อความส่วนนี้หรือระดับการจัดลำดับภายในแก่ลูกค้า]',
    isSugarcane
      ? `คำค้นมีอ้อยอายุ ${ageMonths} เดือน และถามการกำจัดวัชพืชหลังวัชพืชงอก/ฉีดทับ`
      : `คำค้นมีข้าวอายุ ${ageDays} วัน และถามการกำจัดวัชพืชในนาข้าว`,
    'ต้องตรวจพิจารณาสินค้าทุกตัวในรายการนี้ ไม่เลือกเพียงชื่อแรก และให้เสนอเป็นทางเลือกแยกกัน ไม่แนะนำให้ผสมหรือใช้ทุกตัวพร้อมกัน:',
  ];
  for (const item of items) {
    const p = item.product;
    const uses = item.uses.map((u) => `${u.crop} / ${u.target} / ${u.stage}`).join('; ');
    lines.push(`- ${p.name}${p.common ? ` | ${p.common}` : ''}${p.ai ? ` | สารสำคัญ: ${p.ai}` : ''}${p.moa ? ` | กลุ่มกลไก: ${p.moa}` : ''} | ข้อมูลการใช้: ${uses}`);
  }
  lines.push('[จบข้อมูลตรวจสอบภายใน]');
  return lines.join('\n');
}

function enrichQuery(query, masterRows, usageRows, levels) {
  const extra = buildVerifiedUsageContext(query, masterRows, usageRows, levels);
  return extra ? `${query}\n\n${extra}` : query;
}

module.exports = { buildVerifiedUsageContext, enrichQuery, queryAgeMonths, queryAgeDays, stageMatches, stageMatchesDays };
