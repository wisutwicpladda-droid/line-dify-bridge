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
    summary: {
      products: products.length,
      openProducts: products.filter((r) => isOpenStatus(r[14])).length,
      closedOrUnreleasedProducts: products.filter((r) => !isOpenStatus(r[14])).length,
      errors: errors.length,
      warnings: warnings.length
    }
  };
}

module.exports = { validateProductData, isOpenStatus, STRATEGIES };
