'use strict';
// Remove editorial annotations only. Formula/colour variants keep their identity.
const canonicalName = v => String(v || '').normalize('NFC').replace(/\s*\((?:ยัง)?ไม่มีรูป(?:ภาพ)?\)\s*/g, '').trim();
const normalize = v => canonicalName(v).toLowerCase().replace(/[\s"“”'*–—-]+/g, '');
const isOpenForSale = v => ['ขาย','ขายได้แล้ว','ขายแล้ว','เปิดขายแล้ว','พร้อมจำหน่าย'].includes(String(v || '').trim());
function identities(rows, aliases = {}) {
  const byId = new Map(), byAlias = new Map();
  for (const row of (rows || []).slice(1)) {
    if (!row[0] || !row[1]) continue;
    if (byId.has(row[0])) throw new Error('duplicate_product_id');
    const p = { product_id: row[0], canonical_name: canonicalName(row[1]), normalized_name: normalize(row[1]),
      aliases: [row[1], canonicalName(row[1]), ...(aliases[row[0]] || [])], status_selling: row[14] || '', open: isOpenForSale(row[14]) };
    byId.set(p.product_id, p);
    for (const alias of p.aliases) {
      const key = normalize(alias); if (!key) continue;
      const matches = byAlias.get(key) || new Set(); matches.add(p.product_id); byAlias.set(key, matches);
    }
  }
  function resolve(value) {
    if (byId.has(value)) return byId.get(value);
    const ids = byAlias.get(normalize(value));
    return ids && ids.size === 1 ? byId.get([...ids][0]) : null;
  }
  function mentions(value) {
    let text = normalize(value); const result = new Set();
    for (const [alias, ids] of [...byAlias].sort((a,b) => b[0].length-a[0].length)) {
      if (alias.length < 3 || !text.includes(alias)) continue;
      for (const id of ids) result.add(id);
      text = text.split(alias).join(' '.repeat(alias.length));
    }
    return [...result].map(id => byId.get(id));
  }
  function ambiguities(value) {
    const text=normalize(value);
    return [...byAlias].filter(([alias,ids])=>alias.length>=3&&ids.size>1&&text.includes(alias)).map(([alias,ids])=>({alias,product_ids:[...ids]}));
  }
  return { byId, resolve, mentions, ambiguities };
}
module.exports = { canonicalName, normalize, isOpenForSale, identities };
