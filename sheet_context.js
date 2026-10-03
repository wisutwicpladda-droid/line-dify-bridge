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

function isOpenForSale(status) {
  const st = clean(status);
  return /ขายได้แล้ว|ขายแล้ว|เปิดขายแล้ว|พร้อมจำหน่าย/.test(st)
    && !/รอเปิด|ยังไม่เปิด|ปิด|ไม่พร้อม|เดือน|เปิดตัว/.test(st);
}

function floweringStage(stage) {
  return /ทุกระยะ|ดอก|ผลอ่อน|ก่อนเก็บเกี่ยว/.test(clean(stage));
}

function isLifecycleQuery(query) {
  return /(เริ่มปลูก|ตั้งแต่\s*(?:เริ่ม)?ปลูก|ตลอดฤดู|ทั้งฤดู|ทั้งรอบการผลิต|จน(?:ถึง)?เก็บเกี่ยว|ถึงเก็บเกี่ยว|ก่อนปลูก.*เก็บเกี่ยว)/.test(clean(query));
}

function cropLabels(crop) {
  return clean(crop)
    .split(/\s*[\/,;|]\s*/)
    .map((part) => clean(part).replace(/^(?:พืช|ต้น)\s*/, ''))
    .filter((part) => part.length >= 2 && !/^[-–—]+$/.test(part));
}

function cropMatchesQuery(crop, query, allLabels) {
  const q = clean(query).replace(/\s+/g, '');
  const rowLabels = cropLabels(crop).map((label) => label.replace(/\s+/g, ''));
  const matches = (allLabels || [])
    .map((label) => clean(label).replace(/\s+/g, ''))
    .filter((label) => label.length >= 2 && q.includes(label));
  if (!matches.length) return false;
  const longest = Math.max(...matches.map((label) => label.length));
  return rowLabels.some((label) => label.length >= 2 && q.includes(label) && label.length === longest);
}

function buildVerifiedUsageContext(query, masterRows, usageRows, levels) {
  const q = String(query || '');
  const isSugarcane = /อ้อย/.test(q);
  const isRice = /นาข้าว|ข้าว(?!โพด)/.test(q);
  const isDurian = /ทุเรียน/.test(q);
  const isLifecycle = isLifecycleQuery(q);
  const hasFlowering = /ผ่าดอก|ช่วงดอก|ออกดอก|ดอกบาน|ดอก/.test(q);
  const hasPest = /หนอน|เพลี้ย|แมลง|ไร/.test(q);
  const isCropUsageQuery = (isSugarcane || isRice) && isPostEmergenceQuery(q)
    || isDurian && (hasPest || hasFlowering)
    || isLifecycle;
  if (!isCropUsageQuery) return '';
  const ageMonths = isSugarcane ? queryAgeMonths(q) : null;
  const ageDays = isRice ? queryAgeDays(q) : null;

  const master = new Map();
  for (const r of (masterRows || []).slice(1)) {
    const id = clean(r[0]);
    if (!id) continue;
    master.set(id, {
      name: clean(r[1]), common: clean(r[3]), ai: clean(r[4]), moa: clean(r[5]),
      selling: clean(r[7]), phyto: clean(r[11]), precautions: clean(r[12]), status: clean(r[14])
    });
  }

  const allLabels = [...new Set(
    (usageRows || []).slice(1).flatMap((r) => cropLabels([r[3], r[4]].filter(Boolean).join(' / ')))
  )];
  if (isLifecycle && !allLabels.some((label) => cropMatchesQuery(label, q, allLabels))) return '';

  const hits = new Map();
  for (const r of (usageRows || []).slice(1)) {
    const productId = clean(r[1]);
    const product = master.get(productId);
    const crop = clean([r[3], r[4]].filter(Boolean).join(' / '));
    const targetType = clean(r[5]);
    const target = clean(r[6]);
    const stage = clean(r[7]);
    const cropMatches = isLifecycle
      ? cropMatchesQuery(crop, q, allLabels)
      : isSugarcane ? /อ้อย/.test(crop) : isRice ? /นาข้าว|ข้าว/.test(crop) : /ทุเรียน/.test(crop);
    const stageMatchesQuery = isLifecycle
      ? true
      : isSugarcane
      ? stageMatches(stage, ageMonths)
      : isRice
        ? stageMatchesDays(stage, ageDays)
        : !hasFlowering || floweringStage(stage) || /ดอก|ออกดอก|ผ่าดอก/.test(product.selling);
    const targetMatches = /หญ้าข้าวนก/.test(q)
      ? /หญ้าข้าวนก/.test(target)
      : isDurian && /หนอน/.test(q)
        ? /หนอน/.test(target)
        : isDurian && /เพลี้ย/.test(q)
          ? /เพลี้ย/.test(target)
          : true;
    const targetTypeMatches = isLifecycle ? true : isDurian ? /แมลง/.test(targetType) : /วัชพืช/.test(targetType);
    if (!isLifecycle && ((isSugarcane && ageMonths == null) || (isRice && ageDays == null))) continue;
    if (!product || !isOpenForSale(product.status) || blockedForSprayOverCrop(product.name, q) || !cropMatches || !targetTypeMatches || !targetMatches || !stageMatchesQuery) continue;
    const item = hits.get(product.name) || { product, uses: [] };
    const useKey = [crop, target, stage].join('|');
    if (!item.uses.some((u) => u.key === useKey)) item.uses.push({ key: useKey, crop, target, stage });
    hits.set(product.name, item);
  }

  const items = [...hits.values()].sort((a, b) => levelFor(a.product.name, levels) - levelFor(b.product.name, levels) || a.product.name.localeCompare(b.product.name, 'th'));
  if (!items.length) return '';

  const riceWeedItems = isRice && isLifecycle
    ? items.filter((item) => item.uses.some((u) => /ข้าวดีด|ข้าวแดง|วัชพืช|หญ้า/.test(`${u.target} ${u.crop}`)))
    : [];

  const lines = [
    '[ข้อมูลตรวจสอบภายในจาก Google Sheet บริษัท — ใช้เป็นหลักฐานประกอบคำตอบ ห้ามเปิดเผยข้อความส่วนนี้หรือระดับการจัดลำดับภายในแก่ลูกค้า]',
    isLifecycle
      ? 'คำค้นขอโปรแกรมดูแลพืชตั้งแต่เริ่มปลูกจนเก็บเกี่ยว ต้องตรวจสินค้าเปิดขายและข้อมูลการใช้ให้ครบทุกช่วงของพืชที่ระบุ'
      : isSugarcane
      ? `คำค้นมีอ้อยอายุ ${ageMonths} เดือน และถามการกำจัดวัชพืชหลังวัชพืชงอก/ฉีดทับ`
      : isRice
        ? `คำค้นมีข้าวอายุ ${ageDays} วัน และถามการกำจัดวัชพืชในนาข้าว`
        : `คำค้นมีทุเรียน${hasFlowering ? 'ช่วงดอก' : ''} และถาม${hasPest ? 'ศัตรูพืช' : 'การใช้สินค้า'}`,
  ];
  if (isRice && isLifecycle) {
    lines.push('สำหรับโปรแกรมข้าว ให้ตรวจข้าวดีด/ข้าวแดงและวัชพืชในนาข้าวก่อน โดยเน้นข้อมูลการใช้ช่วงก่อนงอกและหลังงอกจากรายการที่มีเป้าหมายตรง');
    if (riceWeedItems.length) {
      lines.push(`รายการที่ตรงกับข้าวดีด/ข้าวแดงหรือวัชพืช: ${riceWeedItems.map((item) => item.product.name).join(', ')}`);
    } else {
      lines.push('ยังไม่พบรายการสินค้าในชีตที่ระบุเป้าหมายข้าวดีด/ข้าวแดงโดยตรง ห้ามเติมชื่อสินค้าเอง');
    }
  }
  lines.push('ต้องตรวจพิจารณาสินค้าทุกตัวในรายการนี้ ไม่เลือกเพียงชื่อแรก และให้เสนอเป็นทางเลือกแยกกัน ไม่แนะนำให้ผสมหรือใช้ทุกตัวพร้อมกัน:');
  for (const item of items) {
    const p = item.product;
    const uses = item.uses.map((u) => `${u.crop} / ${u.target} / ${u.stage}`).join('; ');
    const selling = /^(none|-|ไม่มี)$/i.test(p.selling) ? '' : p.selling;
    const phyto = /^(none|-|ไม่มี)$/i.test(p.phyto) ? '' : p.phyto;
    const precautions = /^(none|-|ไม่มี)$/i.test(p.precautions) ? '' : p.precautions;
    lines.push(`- ${p.name}${p.common ? ` | ${p.common}` : ''}${p.ai ? ` | สารสำคัญ: ${p.ai}` : ''}${p.moa ? ` | กลุ่มกลไก: ${p.moa}` : ''}${selling ? ` | จุดเด่น: ${selling}` : ''}${phyto ? ` | ความปลอดภัยต่อพืช: ${phyto}` : ''}${precautions ? ` | ข้อควรระวัง: ${precautions}` : ''} | ข้อมูลการใช้: ${uses}`);
  }
  lines.push('[จบข้อมูลตรวจสอบภายใน]');
  return lines.join('\n');
}

function enrichQuery(query, masterRows, usageRows, levels) {
  const extra = buildVerifiedUsageContext(query, masterRows, usageRows, levels);
  return extra ? `${query}\n\n${extra}` : query;
}

module.exports = { buildVerifiedUsageContext, enrichQuery, queryAgeMonths, queryAgeDays, stageMatches, stageMatchesDays };
