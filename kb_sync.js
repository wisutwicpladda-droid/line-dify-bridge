// kb_sync.js — sync ข้อมูลสินค้าจาก Google Sheet (Product master) เข้า Dify Knowledge Base อัตโนมัติ
// ตัวแปร: DIFY_DATASET_KEY (จำเป็น, Knowledge API key), KB_DATASET_ID, PRODUCT_SHEET_ID, KB_DOC_NAME, KB_SYNC_MIN, NAME_OVERRIDES
'use strict';
const https = require('https');
const crypto = require('crypto');

const SHEET_ID = process.env.PRODUCT_SHEET_ID || '155mB2y8vpDYITc49ZbsAWKdjaJXz31EMGBHKUiO4_pU';
const GIDS = { master: process.env.PRODUCT_GID_MASTER || '1517893127', usage: process.env.PRODUCT_GID_USAGE || '212188772', packages: process.env.PRODUCT_GID_PACKAGES || '994912510' };
const DATASET_ID = process.env.KB_DATASET_ID || 'af225749-33cc-4f0a-ae49-934ada9af79f';
const DOC_NAME = process.env.KB_DOC_NAME || 'สินค้า_จาก_GoogleSheet.md';
const KEY = process.env.DIFY_DATASET_KEY || '';
const SYNC_MIN = Math.max(5, parseInt(process.env.KB_SYNC_MIN || '60', 10) || 60);
const SEP = '@@@@';
// ชื่อที่เปลี่ยนแล้วแต่ชีทยังไม่แก้ เช่น "โซนิก=ทริปสัน"
const OVERRIDES = {};
(process.env.NAME_OVERRIDES || 'โซนิก=ทริปสัน').split(',').forEach((p) => { const [a, b] = p.split('=').map((x) => (x || '').trim()); if (a && b) OVERRIDES[a] = b; });

const state = { enabled: !!KEY, ok: false, at: 0, products: 0, chars: 0, hash: '', docId: '', action: '', error: '' };
// v3.10: ระดับแนะนำของสินค้าแต่ละชื่อ ใช้เรียงสินค้าในคำตอบก่อนส่งถึงลูกค้า (server.js guardOrder)
const levels = { map: {}, names: [], moa: {}, categories: {}, status: {}, at: 0 }; // v3.17: metadata สำหรับคำขอรายการสินค้าทั้งหมดและรูปสินค้า

function get(url, left) {
  left = left == null ? 4 : left;
  return new Promise((resolve, reject) => {
    const rq = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) { res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), left - 1)); }
      const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8') }));
    });
    rq.on('error', reject); rq.on('timeout', () => rq.destroy(new Error('timeout')));
  });
}
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const rq = https.request({ hostname: 'api.dify.ai', path: '/v1' + path, method, timeout: 120000,
      headers: Object.assign({ Authorization: 'Bearer ' + KEY }, data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) }, (res) => {
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => { const t = Buffer.concat(c).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (_) {} resolve({ status: res.statusCode, data: j, text: t }); });
    });
    rq.on('error', reject); rq.on('timeout', () => rq.destroy(new Error('timeout')));
    if (data) rq.write(data); rq.end();
  });
}
function parseCsv(t) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const s = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const num = (v) => { const x = s(v); if (x === '') return null; const n = Number(x.replace(/,/g, '')); return isFinite(n) ? n : null; };
const fmt = (n) => (Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
const CAT = { Insecticide: 'สารกำจัดแมลง', Fungicide: 'สารป้องกันกำจัดโรคพืช', Herbicide: 'สารกำจัดวัชพืช', PGR: 'สารควบคุมการเจริญเติบโตพืช', Biostimulants: 'สารเสริมประสิทธิภาพพืช', Fertilizer: 'ปุ๋ย' };
const PKG = { 'ถุงฟอยด์': 'ถุงฟอยล์', 'แกลอน': 'แกลลอน' };
const TO_BASE = { 'ซีซี': 1, 'มล.': 1, 'ลิตร': 1000, 'กรัม': 1, 'กิโลกรัม': 1000, 'เม็ด': 1 };
const KIND = { 'ซีซี': 'v', 'มล.': 'v', 'ลิตร': 'v', 'กรัม': 'w', 'กิโลกรัม': 'w', 'เม็ด': 'p' };
// ลำดับแนะนำ (ผู้ใช้กำหนด 29 ก.ย.): Expand > Skyrocket > Natural > Cosmic-Star > Standard
const STRAT_LEVEL = { 'expand': 1, 'skyrocket': 2, 'natural': 3, 'cosmic-star': 4, 'standard': 5 };

function buildText(master, usage, packages) {
  const hm = master[0].length, mrows = master.slice(1).filter((r) => s(r[0]).startsWith('P'));
  const U = {}, P = {};
  usage.slice(1).forEach((r) => { const id = s(r[1]); if (id) (U[id] = U[id] || []).push(r); });
  packages.slice(1).forEach((r) => { const id = s(r[1]); if (id) (P[id] = P[id] || []).push(r); });
  const blocks = [], usageIndex = [], lv = {}, mo = {}, categories = {}, statuses = {};
  for (const r of mrows) {
    const id = s(r[0]); let name = s(r[1]).replace(/\s*\(ไม่มีรูป\)\s*/g, '').trim();
    const oldName = OVERRIDES[name] ? name : ''; if (oldName) name = OVERRIDES[name];
    const cat = s(r[2]), common = s(r[3]), ai = s(r[4]), moa = s(r[5]), form = s(r[6]), sell = s(r[7]), absorb = s(r[8]), mech = s(r[9]), act = s(r[10]), phyto = s(r[11]), prec = s(r[12]), strat = s(r[13]).replace(/^Cosmic-star$/i, 'Cosmic-Star'), sellStatus = s(r[14]);
    categories[name] = cat;
    statuses[name] = sellStatus;
    const uses = (U[id] || []).map((u) => ({ group: s(u[3]), crop: s(u[4]), ttype: s(u[5]), target: s(u[6]), stage: s(u[7]), eq: s(u[8]), method: s(u[9]), how: s(u[10]), rmin: num(u[11]), rmax: num(u[12]), unit: s(u[13]), bval: num(u[14]), bunit: s(u[15]), cov: num(u[16]), cunit: s(u[17]), note: s(u[18]), dnote: s(u[19]) }));
    const withTarget = uses.filter((u) => u.target);
    const crops = [...new Set(withTarget.map((u) => u.crop || u.group))];
    const targets = [...new Set(withTarget.flatMap((u) => u.target.split(/\s*,\s*/)).filter(Boolean))];
    if (/ขาย/.test(sellStatus) && !/รอเปิด|ปิด|ไม่พร้อม/.test(sellStatus) && withTarget.length) {
      const useSummary = withTarget.map((u) => [u.crop || u.group, u.target, u.stage, u.method].filter(Boolean).join(' / '));
      usageIndex.push(name + ' | ' + [...new Set(useSummary)].join(' ; '));
    }
    const L = [];
    if (STRAT_LEVEL[strat.toLowerCase()]) lv[name] = STRAT_LEVEL[strat.toLowerCase()];
    if (moa) mo[name] = moa;
    L.push(name + (common ? ' (' + common + ')' : '') + (oldName ? ' — ชื่อเดิม ' + oldName : ''));
    L.push('รหัสสินค้า: ' + id);
    // v3.9: ชื่อกลุ่มสินค้า (Expand/Skyrocket/...) เป็นข้อมูลภายใน ห้ามเขียนลง KB ใส่เป็นเลขลำดับแทน
    if (STRAT_LEVEL[strat.toLowerCase()]) L.push('ลำดับแนะนำภายใน (ห้ามบอกลูกค้า): ' + STRAT_LEVEL[strat.toLowerCase()]);
    if (sellStatus) L.push('สถานะการขาย: ' + sellStatus);
    L.push('สรุป: ' + name + ' คือ' + (CAT[cat] || cat) + (crops.length ? ' ใช้กับ ' + crops.join(' ') : '') + (targets.length ? ' เป้าหมาย ' + targets.join(' ') : ''));
    L.push('');
    L.push('หมวดสินค้า: ' + (CAT[cat] || cat) + (cat ? ' (' + cat + ')' : ''));
    if (ai) L.push('สารสำคัญ: ' + ai);
    if (moa) L.push('กลุ่มกลไกการออกฤทธิ์ (MOA): ' + moa);
    if (form) L.push('ลักษณะสาร: ' + form);
    if (absorb) L.push('การดูดซึม: ' + absorb);
    if (mech) L.push('กลไกการออกฤทธิ์: ' + mech);
    if (act) L.push('ลักษณะการออกฤทธิ์: ' + act);
    if (phyto) L.push('ความปลอดภัยต่อพืช: ' + phyto);
    if (prec && !/^(none|-)$/i.test(prec)) L.push('ข้อควรระวังเพิ่มเติม: ' + prec);
    if (sell) L.push('จุดเด่นของสินค้า: ' + sell);
    L.push('');
    L.push('พืชที่ใช้ได้ ศัตรูพืชเป้าหมาย และอัตราใช้');
    if (!withTarget.length) L.push('ยังไม่มีข้อมูลการใช้และอัตราใช้ในระบบ — แนะนำให้สอบถามเจ้าหน้าที่');
    const groups = [];
    for (const u of withTarget) {
      const key = [u.crop, u.group, u.target, u.ttype, u.stage, u.method, u.how, u.note, u.dnote].join('|');
      let g = groups.find((x) => x.key === key); if (!g) { g = { key, u, rows: [] }; groups.push(g); } g.rows.push(u);
    }
    for (const g of groups) {
      const u = g.u;
      const cropLabel = u.crop ? u.crop + (u.group && u.group !== u.crop ? ' (' + u.group + ')' : '') : u.group;
      L.push('พืช: ' + cropLabel + ' | เป้าหมาย: ' + u.target + (u.ttype ? ' (' + u.ttype + ')' : ''));
      L.push('');
      if (u.stage) L.push('ระยะพืชที่ใช้: ' + u.stage);
      if (u.method) L.push('ส่วนที่พ่น/วิธีพ่น: ' + u.method);
      for (const x of g.rows) {
        const water = x.bunit === 'ลิตรน้ำ' && x.bval;
        const who = (water ? 'พ่นด้วย' : 'ใช้โดย') + (x.eq || 'คน');
        if (x.rmin == null && x.rmax == null) { L.push(who + ': ไม่ระบุอัตราในข้อมูล'); continue; }
        const lo = x.rmin != null ? x.rmin : x.rmax, hi = x.rmax != null ? x.rmax : x.rmin;
        const rate = (lo === hi ? fmt(lo) : fmt(lo) + '-' + fmt(hi)) + ' ' + x.unit;
        const cov = x.cov ? ' พ่นได้ ' + fmt(x.cov) + ' ' + (x.cunit || 'ไร่') : '';
        L.push(who + ': ' + (water ? 'ผสม ' + rate + ' กับน้ำ ' + fmt(x.bval) + ' ลิตร' + cov : rate + ' ต่อ' + (x.cunit || 'ไร่')));
      }
      if (u.how) L.push('วิธีใช้: ' + u.how);
      if (u.note) L.push('หมายเหตุอัตราใช้: ' + u.note);
      if (u.dnote) L.push('หมายเหตุ: ' + u.dnote);
      L.push('');
    }
    const pk = (P[id] || []).map((p) => ({ type: PKG[s(p[3])] || s(p[3]), val: num(p[4]), unit: s(p[5]), note: s(p[6]) })).filter((p) => p.type || p.val);
    if (pk.length) {
      L.push('ขนาดบรรจุ');
      for (const p of pk) L.push(p.type + ' ' + (p.val != null ? fmt(p.val) : '') + ' ' + p.unit + (p.note ? ' (' + p.note + ')' : ''));
      // จำนวนไร่ต่อบรรจุ (คำนวณจากอัตราพ่นด้วยคนต่อไร่) ไม่รวมไม้ผล
      const rai = [];
      for (const p of pk) {
        if (p.val == null || !TO_BASE[p.unit]) continue;
        const amt = p.val * TO_BASE[p.unit];
        const seen = new Set();
        for (const x of withTarget) {
          if (x.group === 'ไม้ผล' || x.eq !== 'คน' || !x.cov || !TO_BASE[x.unit] || KIND[x.unit] !== KIND[p.unit]) continue;
          const lo = (x.rmin != null ? x.rmin : x.rmax), hi = (x.rmax != null ? x.rmax : x.rmin); if (!lo) continue;
          const a = Math.max(1, Math.round(amt / (hi * TO_BASE[x.unit]) * x.cov)), b = Math.max(1, Math.round(amt / (lo * TO_BASE[x.unit]) * x.cov));
          if (amt / (hi * TO_BASE[x.unit]) < 1) continue;
          const k = (x.crop || x.group) + ':' + a + '-' + b; if (seen.has(k)) continue; seen.add(k);
          rai.push(p.type + ' ' + fmt(p.val) + ' ' + p.unit + ' ' + (x.crop || x.group) + ' ใช้ได้ประมาณ ' + (a === b ? a : a + '-' + b) + ' ไร่');
        }
      }
      if (rai.length) { L.push(''); L.push('จำนวนไร่ต่อบรรจุ (คำนวณจากอัตราพ่นด้วยคน): ' + [...new Set(rai)].join(' / ')); }
    }
    blocks.push(L.join('\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  const usageIndexBlock = ['สารบัญการใช้สินค้าที่เปิดขายจาก Google Sheet (ใช้ค้นพืช ปัญหา และช่วงการใช้)', 'ชื่อสินค้า | พืช / เป้าหมาย / ระยะ / วิธีใช้', ...usageIndex].join('\n');
  // สารบัญสั้น ๆ เป็น chunk แรกสำหรับคำถามแบบ "มีสินค้าหมวดนี้อะไรบ้าง"
  // ทำให้ Dify ค้นเจอรายการทั้งหมวดจากชีต โดยไม่ต้องเพิ่มชื่อสินค้าแบบตายตัวใน prompt
  const indexLines = ['สารบัญสินค้าเปิดขายจาก Google Sheet (ใช้ค้นรายการหมวดสินค้า)', 'ชื่อสินค้า | หมวดสินค้า | สารสำคัญภาษาไทยและสูตร | การดูดซึม'];
  for (const r of mrows) {
    const id = s(r[0]); let name = s(r[1]).replace(/\s*\(ไม่มีรูป\)\s*/g, '').trim();
    if (OVERRIDES[name]) name = OVERRIDES[name];
    const sellStatus = statuses[name] || '';
    if (!/ขาย/.test(sellStatus) || /รอเปิด|ปิด|ไม่พร้อม/.test(sellStatus)) continue;
    indexLines.push([name, CAT[s(r[2])] || s(r[2]), s(r[3]), s(r[8])].join(' | '));
  }
  const indexBlock = indexLines.join('\n');
  return { text: [indexBlock, usageIndexBlock, ...blocks].join('\n' + SEP + '\n'), products: blocks.length, categories, status: statuses, levels: lv, moa: mo };
}

async function fetchSheets() {
  const base = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=';
  const out = {};
  for (const [k, gid] of Object.entries(GIDS)) {
    const r = await get(base + gid);
    if (r.status !== 200) throw new Error(k + ' HTTP ' + r.status);
    out[k] = parseCsv(r.text);
  }
  return out;
}

async function syncOnce(force) {
  if (!KEY) { state.error = 'DIFY_DATASET_KEY not set'; return state; }
  try {
    const sh = await fetchSheets();
    const { text, products, levels: lv, moa: mo, categories, status } = buildText(sh.master, sh.usage, sh.packages);
    if (products < 50) throw new Error('found only ' + products + ' products, skip');
    setLevels(lv, mo, categories, status);
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    if (!force && hash === state.hash && state.docId) { Object.assign(state, { ok: true, at: Date.now(), action: 'unchanged', error: '' }); return state; }
    const rule = { mode: 'custom', rules: { pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: false }, { id: 'remove_urls_emails', enabled: false }], segmentation: { separator: SEP, max_tokens: 4000 } } };
    let docId = state.docId;
    if (!docId) {
      const l = await api('GET', '/datasets/' + DATASET_ID + '/documents?limit=100&keyword=' + encodeURIComponent(DOC_NAME));
      if (l.status !== 200) throw new Error('list ' + l.status + ' ' + l.text.slice(0, 200));
      const hit = (l.data.data || []).find((x) => x.name === DOC_NAME); docId = hit ? hit.id : '';
    }
    let r, action;
    if (docId) { r = await api('POST', '/datasets/' + DATASET_ID + '/documents/' + docId + '/update-by-text', { name: DOC_NAME, text, process_rule: rule }); action = 'updated'; }
    else { r = await api('POST', '/datasets/' + DATASET_ID + '/document/create-by-text', { name: DOC_NAME, text, indexing_technique: 'high_quality', process_rule: rule }); action = 'created'; }
    if (r.status !== 200) throw new Error(action + ' ' + r.status + ' ' + r.text.slice(0, 300));
    docId = (r.data && r.data.document && r.data.document.id) || docId;
    Object.assign(state, { ok: true, at: Date.now(), products, chars: text.length, hash, docId, action, error: '' });
    console.log('[kb-sync] ' + action + ' ' + DOC_NAME + ': ' + products + ' products, ' + text.length + ' chars');
  } catch (e) {
    Object.assign(state, { ok: false, at: Date.now(), error: e.message });
    console.log('[kb-sync] failed: ' + e.message);
  }
  return state;
}

function start() {
  if (!KEY) { console.log('[kb-sync] OFF (ตั้ง DIFY_DATASET_KEY เพื่อ sync สินค้าจาก Google Sheet)'); return; }
  console.log('[kb-sync] ON every ' + SYNC_MIN + ' min -> ' + DOC_NAME);
  setTimeout(() => syncOnce(false), 20000);
  setInterval(() => syncOnce(false), SYNC_MIN * 60000);
}

function setLevels(lv, mo, categories, status) {
  levels.map = lv || {};
  levels.moa = mo || {};
  levels.categories = categories || {};
  levels.status = status || {};
  levels.names = Object.keys(levels.map).sort((a, b) => b.length - a.length); // ชื่อยาวก่อน กัน "นาแดน" ชนกับ "นาแดน 6 จี"
  levels.at = Date.now();
}

module.exports = { buildText, parseCsv, fetchSheets, syncOnce, start, state, levels, setLevels };
