'use strict';
const { identities, isOpenForSale } = require('./product_identity');
const UNAVAILABLE = 'น้องลัดดายังยืนยันข้อมูลสินค้านี้ไม่ได้ค่ะ ขอให้ทีมงานตรวจสอบก่อนแนะนำ';
function productRowsNotOpen(rows) { return [...identities(rows).byId.values()].filter(p => !p.open).map(p => p.canonical_name); }
function guardUnreleasedProducts(answer, rows, sessionId, logger) {
  const original = String(answer || '').trim(); if (!original) return '';
  let index; try { index = identities(rows); } catch { return UNAVAILABLE; }
  if (!index.byId.size) return UNAVAILABLE;
  const closed = index.mentions(original).filter(p => !p.open);
  if (!closed.length) return original;
  if (logger) logger('[guard] blocked_response closed_product_ids=' + closed.map(p=>p.product_id).join(','));
  // Reject invalid response; do not delete isolated sentences and change meaning.
  return UNAVAILABLE;
}
module.exports = { isOpenForSale, productRowsNotOpen, guardUnreleasedProducts, UNAVAILABLE };
