'use strict';

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

function isOpenForSale(status) {
  const st = clean(status);
  return /ขายได้แล้ว|ขายแล้ว|เปิดขายแล้ว|พร้อมจำหน่าย/.test(st)
    && !/รอเปิด|ยังไม่เปิด|ปิด|ไม่พร้อม|เดือน|เปิดตัว/.test(st);
}

function productRowsNotOpen(masterRows) {
  const out = [];
  for (const row of (masterRows || []).slice(1)) {
    const name = clean(row[1]);
    if (name && !isOpenForSale(row[14])) out.push(name);
  }
  return out.sort((a, b) => b.length - a.length);
}

// Final safety net: a product whose status is not explicitly open must never
// be exposed by a retrieved answer, even if an old KB chunk is still present.
function guardUnreleasedProducts(answer, masterRows, sessionId, logger) {
  const original = String(answer || '').trim();
  if (!original) return '';
  const closed = productRowsNotOpen(masterRows);
  const leaked = closed.filter((name) => original.includes(name));
  if (!leaked.length) return original;

  const parts = original.split(/\n+|(?<=[.!?！？])\s+/u);
  const kept = parts.filter((part) => !leaked.some((name) => part.includes(name)));
  let result = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // A one-line answer containing the unpublished name has no safe sentence to
  // preserve. Keep the response useful without repeating the product name.
  if (!result || leaked.some((name) => result.includes(name))) {
    result = 'ตอนนี้น้องลัดดาแนะนำได้เฉพาะสินค้าที่เปิดจำหน่ายแล้วค่ะ หากบอกพืชและปัญหา น้องลัดดาจะช่วยเลือกตัวที่ใช้ได้ให้';
  }
  if (typeof logger === 'function') logger(`[guard] ${String(sessionId || '').slice(0, 8)} removed unreleased product(s): ${leaked.join(', ')}`);
  return result;
}

module.exports = { isOpenForSale, productRowsNotOpen, guardUnreleasedProducts };
