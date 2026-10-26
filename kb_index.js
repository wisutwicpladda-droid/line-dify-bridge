// kb_index.js — v3.40 (26 ต.ค. 2569): สร้างดัชนี dify_icpladda_index.md จาก Google Sheet และซิงก์เข้า Dify Knowledge เอง
// เดิมสร้างด้วย sync_dify_knowledge.py ที่ต้องรันด้วยมือ ดัชนีจึงค้างตั้งแต่ 23 ก.ย. (ไม่มีโมเวนทัส ไฮซีส ไพโซรอน ทริปสัน พรีดิคท์ 15)
// รูปแบบเหมือนสคริปต์เดิม: 1 chunk ต่อ "ศัตรูพืช x พืช" และ 1 chunk ต่อ "พืช x ประเภทเป้าหมาย" เรียงตัวที่แนะนำก่อน
// ต่างจากเดิม: ใส่เฉพาะสินค้าที่เปิดขาย · ลำดับแนะนำตามที่กำหนด 29 ก.ย. (ชุดเดียวกับ kb_sync) · chunk ที่ยาวเกิน MAX_CHARS แบ่งเป็นส่วน
// ทุก KB_INDEX_MIN นาที: เนื้อหาไม่เปลี่ยน = ไม่ทำอะไร · เปลี่ยน = อัปโหลดเป็นเอกสารใหม่ รอ Dify ทำดัชนีเสร็จ แล้วค่อยลบตัวเก่า
// ถ้าตัวใหม่ทำดัชนีไม่สำเร็จ (เช่น เครดิต OpenAI หมด) ลบตัวใหม่ทิ้งและเก็บตัวเก่าไว้ บอทจึงค้นดัชนีได้ตลอด
// ชื่อเอกสารมีรหัสเนื้อหา เช่น dify_icpladda_index_1a2b3c4d.md เพราะ Dify เขียนทับเอกสารที่ชื่อซ้ำแทนการสร้างใหม่
// รหัสในชื่อจึงใช้บอกได้ด้วยว่าเนื้อหาใน Dify ตรงกับชีทหรือยัง
// เอกสารชื่อ dify_icpladda_index.md และ dify_icpladda_index_<รหัส>.md ทุกตัว bridge เป็นคนดูแล ถ้าสั่ง Disable ทุกตัวใน Dify ระบบจะหยุดซิงก์ให้
// ตัวแปร: KB_INDEX_SYNC=off ปิด · KB_INDEX_MIN นาทีต่อรอบ (ค่าเริ่ม 60) · KB_INDEX_DOC ชื่อเอกสาร (ค่าเริ่ม dify_icpladda_index.md)
'use strict';
const crypto = require('crypto');
const kb = require('./kb_sync');

const DOC = process.env.KB_INDEX_DOC || 'dify_icpladda_index.md';
const DOT = DOC.lastIndexOf('.');
const BASE = DOT > 0 ? DOC.slice(0, DOT) : DOC, EXT = DOT > 0 ? DOC.slice(DOT) : '';
const docName = (hash) => BASE + '_' + hash.slice(0, 8) + EXT;
// ชื่อเดิม หรือ ชื่อเดิม_<รหัส 8 ตัว>
function isManaged(name) {
  const n = String(name || '');
  if (n === DOC) return true;
  if (!n.startsWith(BASE + '_') || (EXT && !n.endsWith(EXT))) return false;
  return /^[0-9a-f]{8}$/.test(n.slice(BASE.length + 1, n.length - EXT.length));
}
const MAX_CHARS = 2000; // chunk ยาวมากค้นด้วยความหมายไม่ค่อยเจอ (สคริปต์เดิมเจอที่ ~4,000 ตัวอักษร) และ Dify ตัดที่ 4,000 token
const MIN_CHUNKS = 50; // ได้น้อยกว่านี้แปลว่าโหลดชีทไม่ครบ จะไม่อัปโหลด
const UNRANKED = 9;
const PROCESS_RULE = { mode: 'custom', rules: {
  pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }, { id: 'remove_urls_emails', enabled: false }],
  segmentation: { separator: '---', max_tokens: 4000, chunk_overlap: 0 } } };
// คำสะกดผิดในชีท ชุดเดียวกับ sync_dify_knowledge.py
const TYPO = [['ปลอยภัย', 'ปลอดภัย'], ['ถุงฟอยด์', 'ถุงฟอยล์'], ['มันสำปะหรัง', 'มันสำปะหลัง'], ['ลำใย', 'ลำไย'],
  ['ใบ้ไหม้', 'ใบไหม้'], ['แกลอน', 'แกลลอน'], ['เพลี้ี้ย', 'เพลี้ย'], ['(ไม่มีรูป)', '']];
const CAT = { Herbicide: 'สารกำจัดวัชพืช', Insecticide: 'สารกำจัดแมลง', Fungicide: 'สารป้องกันกำจัดโรคพืช',
  Biostimulants: 'สารเสริมประสิทธิภาพพืช', Fertilizer: 'ปุ๋ย', PGR: 'สารควบคุมการเจริญเติบโตพืช' };

function clean(v) {
  if (v == null) return null;
  let t = String(v);
  for (const [bad, good] of TYPO) t = t.split(bad).join(good);
  t = t.replace(/\r/g, '\n').split('\n').map((p) => p.trim()).filter(Boolean).join(' / ').replace(/ {2,}/g, ' ').trim();
  return /^(none|-|nan)?$/i.test(t) ? null : t;
}

// หัวตารางในชีทเป็น "field_name\nคำอธิบาย\nตัวอย่าง" ใช้บรรทัดแรกเป็นชื่อคอลัมน์
function table(rows) {
  if (!rows || !rows.length) return [];
  const hdr = rows[0].map((h, i) => String(h == null ? '' : h).split('\n')[0].trim() || 'col' + i);
  return rows.slice(1).filter((r) => r.some((c) => String(c == null ? '' : c).trim()))
    .map((r) => { const o = {}; hdr.forEach((h, i) => { o[h] = clean(r[i]); }); return o; });
}

function num(v) {
  if (v == null) return null;
  const t = String(v).trim(), f = Number(t.replace(/,/g, ''));
  if (!t || !isFinite(f)) return String(v);
  return Number.isInteger(f) ? String(f) : String(Number(f.toPrecision(6)));
}

// อัตราเป็นประโยคพูด เช่น "ผสม 200 ซีซี กับน้ำ 200 ลิตร พ่นได้ 1 ไร่"
function rateText(u) {
  const lo = num(u.rate_min), hi = num(u.rate_max);
  if (!lo && !hi) return null;
  const amt = ((lo && hi && lo !== hi ? lo + '-' + hi : (lo || hi)) + ' ' + (u.rate_unit || '')).trim();
  const basis = num(u.rate_basis_value);
  const area = u.coverage_area_value ? (num(u.coverage_area_value) + ' ' + (u.coverage_area_unit || '')).trim() : '';
  if (basis && basis !== '0') return 'ผสม ' + amt + ' กับน้ำ ' + basis + ' ลิตร' + (area ? ' พ่นได้ ' + area : '');
  if (area === '1 ไร่') return amt + ' ต่อไร่';
  return area ? amt + ' ต่อ ' + area : amt;
}
const isSpray = (rt) => !!rt && rt.includes('กับน้ำ');

// อัตราของกรณีเดียวกันแยกคนพ่นกับโดรน เช่น " — คนพ่น: ผสม 100 ซีซี กับน้ำ 200 ลิตร พ่นได้ 1 ไร่ | โดรน: ไม่ระบุอัตรา"
function indexRates(rows) {
  const parts = [];
  for (const [equip, label0] of [['คน', 'คนพ่น'], ['โดรน', 'โดรน']]) {
    const rs = rows.filter((x) => x.application_equipment === equip);
    if (!rs.length) continue;
    const rt = rs.map(rateText).find(Boolean) || null;
    const label = rt && equip === 'คน' && !isSpray(rt) ? 'คน' : label0; // อัตราต่อไร่ เช่น ยาเม็ด ใช้หว่าน ไม่ได้พ่น
    let part = label + ': ' + (rt || 'ไม่ระบุอัตรา');
    const note = (rs.find((x) => x.usage_note) || {}).usage_note;
    if (note) part += ' — หมายเหตุ: ' + note; // ชุดหลายขวดบอกอัตราแยกขวดในหมายเหตุ
    parts.push(part);
  }
  if (!parts.length) { const rt = rows.map(rateText).find(Boolean); if (rt) parts.push(rt); }
  return parts.length ? ' — ' + parts.join(' | ') : '';
}

function cropLabel(u) {
  if (u.crop_name && u.crop_group && !u.crop_name.includes(u.crop_group)) return u.crop_name + ' (' + u.crop_group + ')';
  return u.crop_name || u.crop_group || '';
}
const splitTargets = (name) => String(name || '').split(',').map((t) => t.trim()).filter(Boolean);
const rankFromStrategy = (m) => kb.STRAT_LEVEL[String(m.strategy || '').toLowerCase()] || UNRANKED;

// sheets = { master, usage } แบบแถว CSV จาก kb_sync.fetchSheets()
// opts (ใช้ตอนเทียบกับสคริปต์เดิม): rankOf, includeClosed, maxChars, overrides
function buildIndex(sheets, opts) {
  opts = opts || {};
  const maxChars = opts.maxChars || MAX_CHARS;
  const overrides = opts.overrides || kb.OVERRIDES || {};
  const rankOf = opts.rankOf || rankFromStrategy;
  const included = opts.includeClosed ? () => true : (m) => kb.isOpenForSale(m.status_selling);
  const master = table(sheets.master);
  const usage = table(sheets.usage).filter((u) => u.target_type || u.target_name || rateText(u)); // แถวที่กรอกไม่ครบยังไม่ใช้
  const byPid = new Map(master.map((m) => [m.product_id, m]));
  const usageByPid = new Map();
  for (const u of usage) { if (!usageByPid.has(u.product_id)) usageByPid.set(u.product_id, []); usageByPid.get(u.product_id).push(u); }
  const byTarget = new Map(), byCropType = new Map();
  const add = (map, key, head, item) => { if (!map.has(key)) map.set(key, { head, items: [] }); map.get(key).items.push(item); };
  const caseKey = (x) => [x.crop_group, x.crop_name, x.target_name, x.crop_stage].map((v) => v || '').join('\u0001');
  let products = 0;
  for (const [pid, rows] of usageByPid) {
    const m = byPid.get(pid);
    if (!m || !included(m)) continue;
    products++;
    const name = overrides[m.product_name] || m.product_name;
    const rank = rankOf(m);
    const head = '- ' + name + ' (' + (CAT[m.product_category] || m.product_category || '') + ' ลำดับแนะนำ ' + rank + ')';
    const seen = new Set();
    for (const u of rows) {
      const key = caseKey(u);
      if (seen.has(key)) continue;
      seen.add(key);
      // 1 บรรทัดต่อ สินค้า x พืช x เป้าหมาย x ระยะ พร้อมอัตราทั้งคนพ่นและโดรน
      const rates = indexRates(rows.filter((x) => caseKey(x) === key));
      const stage = u.crop_stage ? ' ระยะ ' + u.crop_stage : '';
      const crop = u.crop_name || u.crop_group || 'ไม่ระบุพืช';
      for (const t of splitTargets(u.target_name)) add(byTarget, t + '\u0001' + crop, [t, crop], [rank, head + ' — ' + cropLabel(u) + stage + rates]);
      const ttype = u.target_type || 'อื่น ๆ';
      add(byCropType, crop + '\u0001' + ttype, [crop, ttype], [rank, head + ' — เป้าหมาย ' + (u.target_name || 'ไม่ระบุ') + stage + rates]);
    }
  }
  // ตัดบรรทัดซ้ำ แล้วเรียงตัวที่แนะนำก่อน (บอทมักหยิบตัวแรก)
  const ranked = (items) => {
    const seen = new Set(), uniq = [];
    for (const [r, line] of items) { const k = r + '\u0001' + line; if (!seen.has(k)) { seen.add(k); uniq.push([r, uniq.length, line]); } }
    return uniq.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  };
  const chunks = [];
  const emit = (title, summary, lines) => {
    const whole = [title, summary(lines.length), '', ...lines].join('\n');
    if (whole.length <= maxChars) { chunks.push(whole); return; }
    const budget = Math.max(200, maxChars - title.length - summary(lines.length).length - 60);
    const parts = [];
    let cur = [], size = 0;
    for (const l of lines) {
      if (cur.length && size + l.length + 1 > budget) { parts.push(cur); cur = []; size = 0; }
      cur.push(l); size += l.length + 1;
    }
    if (cur.length) parts.push(cur);
    let first = 1;
    parts.forEach((p, i) => {
      chunks.push([title + ' (ส่วน ' + (i + 1) + '/' + parts.length + ')',
        summary(lines.length) + ' ส่วนนี้คือลำดับที่ ' + first + '-' + (first + p.length - 1), '', ...p].join('\n'));
      first += p.length;
    });
  };
  for (const { head: [t, crop], items } of byTarget.values()) {
    emit('## ศัตรูพืช/เป้าหมาย: ' + t + ' ใน' + crop,
      (n) => 'สรุป: ยาหรือสินค้าที่ใช้กับ ' + t + ' ใน' + crop + ' มี ' + n + ' รายการ เรียงจากตัวที่แนะนำก่อน', ranked(items));
  }
  for (const { head: [crop, ttype], items } of byCropType.values()) {
    emit('## พืช: ' + crop + ' — ' + ttype,
      (n) => 'สรุป: สินค้าสำหรับ ' + crop + ' ประเภท ' + ttype + ' มี ' + n + ' รายการ เรียงจากตัวที่แนะนำก่อน', ranked(items));
  }
  // "---" คือตัวแบ่ง chunk ของ Dify ห้ามมีในเนื้อหา และล้างอักขระแบบที่ Dify ล้างเอง เพื่อให้เทียบกับ segment ใน Dify ได้ตรง
  const safe = chunks.map((c) => difyClean(c.replace(/-{3,}/g, '—')));
  return { text: safe.join('\n\n---\n\n') + '\n', chunks: safe, products };
}

// การล้างข้อความพื้นฐานของ Dify (CleanProcessor) ทำกับทุกเอกสารก่อนแบ่ง chunk
function difyClean(t) {
  return t.replace(/<\|/g, '<').replace(/\|>/g, '>').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\xEF\xBF\xBE\uFFFE]/g, '');
}
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');

function createKbIndex(opts) {
  const { api, datasetId, fetchSheets } = opts;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || Date.now;
  const pollMs = opts.pollMs || 15000; // Knowledge API ของ Dify Cloud จำกัดจำนวนครั้งต่อนาที
  const timeoutMs = opts.timeoutMs || 15 * 60000;
  const enabled = opts.enabled != null ? !!opts.enabled : !/^(off|0|false|no)$/i.test(process.env.KB_INDEX_SYNC || '');
  const state = { enabled, ok: null, at: 0, action: '', name: '', chunks: 0, products: 0, docId: '', error: '', running: false };
  const base = '/datasets/' + datasetId;

  async function listManaged() {
    const docs = [];
    for (let page = 1; page <= 10; page++) {
      const r = await api('GET', base + '/documents?page=' + page + '&limit=100');
      if (r.status !== 200) throw new Error('list documents ' + r.status + ' ' + String(r.text || '').slice(0, 200));
      const d = (r.data && r.data.data) || [];
      docs.push(...d);
      if (!d.length || !(r.data && r.data.has_more)) break;
    }
    return docs.filter((d) => d && isManaged(d.name) && !d.archived);
  }

  async function waitIndexed(batch) {
    const t0 = now();
    for (;;) {
      const r = await api('GET', base + '/documents/' + batch + '/indexing-status');
      const st = r.status === 200 && r.data && Array.isArray(r.data.data) ? r.data.data[0] : null;
      const s = st && st.indexing_status;
      if (s === 'completed') return { ok: true, segments: st.completed_segments };
      if (s === 'error' || s === 'paused' || (st && st.error)) return { ok: false, error: 'indexing ' + (s || '?') + ': ' + String((st && st.error) || '').slice(0, 200) };
      if (now() - t0 > timeoutMs) return { ok: false, error: 'indexing timeout (' + (s || 'HTTP ' + r.status) + ')' };
      await sleep(pollMs);
    }
  }

  async function remove(ids) {
    const failed = [];
    for (const id of ids) {
      const r = await api('DELETE', base + '/documents/' + id);
      if (r.status !== 200 && r.status !== 204) failed.push(String(id).slice(0, 8) + ':' + r.status);
    }
    return failed;
  }

  function done(fields) {
    Object.assign(state, { at: now(), error: '' }, fields);
    console.log('[kb-index] ' + state.action + ' ' + DOC + ': ' + state.chunks + ' chunks, ' + state.products + ' products'
      + (fields.removed ? ', removed ' + fields.removed + ' old' : '') + (state.error ? ' · ' + state.error : ''));
    return state;
  }

  async function syncOnce() {
    if (!state.enabled || state.running) return state;
    state.running = true;
    try {
      const built = buildIndex(await fetchSheets());
      if (built.chunks.length < MIN_CHUNKS) throw new Error('built only ' + built.chunks.length + ' chunks, skip');
      const name = docName(hashOf(built.text));
      const info = { name, chunks: built.chunks.length, products: built.products };
      const managed = await listManaged();
      if (managed.length && managed.every((d) => d.enabled === false)) return done(Object.assign({ ok: true, action: 'disabled-in-dify' }, info));
      const cur = managed.find((d) => d.name === name && d.enabled !== false && d.indexing_status === 'completed');
      if (cur) {
        // เนื้อหาใน Dify ตรงกับชีทแล้ว เก็บกวาดตัวเก่าที่ค้าง (ไม่แตะตัวที่กำลังทำดัชนี)
        const stale = managed.filter((d) => d.id !== cur.id && /^(completed|error)$/.test(d.indexing_status || ''));
        const failed = stale.length ? await remove(stale.map((d) => d.id)) : [];
        return done(Object.assign({ ok: !failed.length, action: stale.length ? 'unchanged+cleaned' : 'unchanged', docId: cur.id,
          removed: stale.length - failed.length, error: failed.length ? 'delete failed ' + failed.join(',') : '' }, info));
      }
      const before = new Set(managed.map((d) => d.id));
      const r = await api('POST', base + '/document/create-by-text', { name, text: built.text,
        indexing_technique: 'high_quality', doc_form: 'text_model', doc_language: 'Thai', process_rule: PROCESS_RULE });
      if (r.status !== 200 || !r.data || !r.data.document) throw new Error('create ' + r.status + ' ' + String(r.text || '').slice(0, 300));
      const newId = r.data.document.id;
      const w = await waitIndexed(r.data.batch);
      if (!w.ok) {
        // ห้ามลบเอกสารที่มีอยู่ก่อน แม้ Dify จะเขียนทับตัวเดิมแทนการสร้างใหม่
        if (!before.has(newId)) await remove([newId]);
        throw new Error(w.error + ' (kept the previous index)');
      }
      const old = managed.map((d) => d.id).filter((id) => id !== newId);
      const failed = old.length ? await remove(old) : [];
      return done(Object.assign({ ok: !failed.length, action: managed.length ? 'replaced' : 'created', docId: newId, segments: w.segments,
        removed: old.length - failed.length, error: failed.length ? 'delete failed ' + failed.join(',') : '' }, info));
    } catch (e) {
      Object.assign(state, { ok: false, at: now(), error: e.message });
      console.log('[kb-index] failed: ' + e.message);
      return state;
    } finally {
      state.running = false;
    }
  }

  function start() {
    if (!state.enabled) { console.log('[kb-index] OFF (KB_INDEX_SYNC=off)'); return; }
    const min = Math.max(10, parseInt(process.env.KB_INDEX_MIN || '60', 10) || 60);
    console.log('[kb-index] ON every ' + min + ' min -> ' + DOC);
    setTimeout(() => syncOnce(false), opts.firstDelayMs || 120000);
    setInterval(() => syncOnce(false), min * 60000);
  }

  function status() {
    if (!state.enabled) return 'off';
    return { ok: state.ok, at: state.at, action: state.action, name: state.name, chunks: state.chunks, products: state.products,
      docId: state.docId ? state.docId.slice(0, 8) : '', error: state.error ? state.error.slice(0, 200) : undefined };
  }

  return { state, syncOnce, start, status };
}

module.exports = { createKbIndex, buildIndex, table, rateText, isManaged, docName, hashOf, DOC, PROCESS_RULE, MAX_CHARS };
