'use strict';
// เทส kb_index.js: สร้างดัชนีจากชีท และสลับเอกสารใน Dify แบบไม่ให้บอทค้นไม่เจอระหว่างอัปเดต (จำลอง Knowledge API)
const assert = require('assert');
const { createKbIndex, buildIndex, DOC } = require('../kb_index');

const MH = ['product_id\nรหัส', 'product_name', 'product_category', 'common_name_th', 'active_ingredient', 'moa_group', 'physical_form',
  'selling_point', 'absorption_method', 'mechanism_of_action', 'action_characteristics', 'phytotoxicity', 'additional_precautions',
  'strategy', 'status_selling', 'data_note'];
const prod = (id, name, strategy, status) => [id, name, 'Insecticide', '', '', '', 'น้ำ', '', '', '', '', '', '', strategy, status, ''];
const UH = ['usage_id', 'product_id', '', 'crop_group', 'crop_name', 'target_type', 'target_name', 'crop_stage', 'application_equipment',
  'application_method', 'how_to_use', 'rate_min', 'rate_max', 'rate_unit', 'rate_basis_value', 'rate_basis_unit',
  'coverage_area_value', 'coverage_area_unit', 'usage_note', 'data_note'];
function sheets(extraTarget) {
  const usage = [UH];
  let n = 0;
  const targets = Array.from({ length: 30 }, (_, i) => 'ศัตรู' + (i + 1)).concat(extraTarget ? [extraTarget] : []);
  // P2 (Skyrocket = ลำดับ 2) มาก่อนในชีท แต่ P1 (Expand = ลำดับ 1) ต้องขึ้นก่อนในดัชนี
  for (const pid of ['P2', 'P1', 'P3']) for (const crop of ['ทุเรียน', 'ข้าว']) for (const t of targets) {
    usage.push(['U' + (++n), pid, '', crop === 'ข้าว' ? 'นาข้าว' : 'ไม้ผล', crop, 'แมลง', t, 'ทุกระยะ', 'คน', '', '', '100', '200', 'ซีซี', '200', 'ลิตรน้ำ', '1', 'ไร่', t === 'ศัตรู1' ? 'ห้ามผสม---ด่าง' : '', '']);
  }
  return { master: [MH, prod('P1', 'ตัวแรก', 'Expand', 'ขาย'), prod('P2', 'ตัวสอง (ไม่มีรูป)', 'Skyrocket', 'ขาย'), prod('P3', 'คริซ่า', 'Natural', 'รอเปิดตัว')], usage };
}

// ---- สร้างดัชนี ----
const b = buildIndex(sheets());
assert.strictEqual(b.products, 2, 'ใส่เฉพาะสินค้าที่เปิดขาย');
assert(!b.text.includes('คริซ่า'), 'สินค้าที่รอเปิดต้องไม่อยู่ในดัชนี');
assert(!b.text.includes('(ไม่มีรูป)'), 'ตัดหมายเหตุภายในออกจากชื่อสินค้า');
const c1 = b.chunks.find((c) => c.startsWith('## ศัตรูพืช/เป้าหมาย: ศัตรู1 ในทุเรียน'));
assert(c1 && c1.indexOf('ตัวแรก') < c1.indexOf('ตัวสอง'), 'เรียงตัวที่ลำดับแนะนำดีกว่าก่อน');
assert(c1.includes('คนพ่น: ผสม 100-200 ซีซี กับน้ำ 200 ลิตร พ่นได้ 1 ไร่'), 'อัตราเป็นประโยคเดียวกับสคริปต์เดิม');
assert(!b.chunks.some((c) => c.includes('---')), '"---" ในเนื้อหาต้องถูกแทน เพราะเป็นตัวแบ่ง chunk ของ Dify');
assert.strictEqual(b.text.split('\n\n---\n\n').length, b.chunks.length, 'คั่น chunk ด้วย ---');
const small = buildIndex(sheets(), { maxChars: 700 });
assert(small.chunks.every((c) => c.length <= 700), 'chunk ยาวต้องถูกแบ่งให้ไม่เกิน maxChars');
assert(small.chunks.some((c) => c.includes('(ส่วน 1/')), 'chunk ที่แบ่งบอกว่าเป็นส่วนที่เท่าไร');
console.log('PASS: buildIndex (เฉพาะสินค้าเปิดขาย, เรียงลำดับ, แบ่ง chunk, กันตัวแบ่ง)');

// ---- จำลอง Dify Knowledge API ----
function fakeDify(opts) {
  opts = opts || {};
  let seq = 0, clock = 1000;
  const docs = (opts.docs || []).map((d) => Object.assign({ enabled: true, indexing_status: 'completed', archived: false }, d));
  const calls = [];
  // แบบเดียวกับ Dify: ยุบช่องว่าง แบ่งที่ --- ตัดสัญลักษณ์หน้า segment (ก่อน strip) แล้ว strip
  const LEAD = /^[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F!"#$%&'()*+,./:;<=>?@^_\x60~]+/;
  const toSegs = (text) => text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').split('---')
    .map((s) => s.replace(LEAD, '').trim()).filter(Boolean);
  async function api(method, path, body) {
    calls.push(method + ' ' + path.replace(/\?.*$/, ''));
    let m;
    if (method === 'GET' && /\/documents\?/.test(path)) return { status: 200, data: { data: docs.map((d) => Object.assign({}, d, { segs: undefined })), has_more: false } };
    if (method === 'GET' && (m = path.match(/\/documents\/([^/]+)\/segments/))) {
      const d = docs.find((x) => x.id === m[1]);
      return { status: 200, data: { data: d.segs.map((c, i) => ({ position: i + 1, content: c })), total: d.segs.length, has_more: false } };
    }
    if (method === 'POST' && /create-by-text$/.test(path)) {
      const id = 'new' + (++seq);
      docs.push({ id, name: body.name, enabled: true, archived: false, indexing_status: 'indexing', created_at: ++clock, segs: toSegs(body.text), polls: 0 });
      return { status: 200, data: { document: { id }, batch: 'batch-' + id } };
    }
    if (method === 'GET' && (m = path.match(/\/documents\/batch-([^/]+)\/indexing-status/))) {
      const d = docs.find((x) => x.id === m[1]);
      d.polls++;
      if (d.polls >= 2) d.indexing_status = opts.failIndexing ? 'error' : 'completed';
      return { status: 200, data: { data: [{ indexing_status: d.indexing_status, completed_segments: d.segs.length, error: opts.failIndexing && d.polls >= 2 ? 'insufficient_quota' : null }] } };
    }
    if (method === 'DELETE' && (m = path.match(/\/documents\/([^/]+)$/))) {
      const i = docs.findIndex((x) => x.id === m[1]);
      if (i >= 0) docs.splice(i, 1);
      return { status: 204, data: null };
    }
    return { status: 404, data: null, text: 'no route ' + path };
  }
  return { api, docs, calls, toSegs };
}
const mk = (fake, sh) => createKbIndex({ api: fake.api, datasetId: 'ds', fetchSheets: async () => sh || sheets(), sleep: async () => {}, pollMs: 1, enabled: true });

(async () => {
  const quiet = console.log; console.log = () => {};
  try {
    // 1) ดัชนีเก่า (เนื้อหาต่าง) -> อัปโหลดตัวใหม่ รอเสร็จ แล้วค่อยลบตัวเก่า
    const f1 = fakeDify({ docs: [{ id: 'old1', name: DOC, created_at: 1, segs: ['## ดัชนีเก่า'] }, { id: 'other', name: 'สินค้า_จาก_GoogleSheet.md', created_at: 2, segs: ['x'] }] });
    const k1 = mk(f1);
    let s = await k1.syncOnce(false);
    assert.strictEqual(s.action, 'replaced'); assert.strictEqual(s.ok, true);
    assert.deepStrictEqual(f1.docs.map((d) => d.id).sort(), ['new1', 'other'], 'ลบเฉพาะดัชนีตัวเก่า เอกสารอื่นไม่ยุ่ง');
    const iCreate = f1.calls.findIndex((c) => c.endsWith('create-by-text')), iDel = f1.calls.indexOf('DELETE /datasets/ds/documents/old1');
    const iDone = f1.calls.lastIndexOf('GET /datasets/ds/documents/batch-new1/indexing-status');
    assert(iCreate >= 0 && iDone > iCreate && iDel > iDone, 'ต้องลบตัวเก่าหลังตัวใหม่ทำดัชนีเสร็จเท่านั้น');
    // 2) รอบถัดไป เนื้อหาเดิม -> ไม่อัปโหลดซ้ำ
    const before = f1.calls.length;
    s = await k1.syncOnce(false);
    assert.strictEqual(s.action, 'unchanged');
    assert(!f1.calls.slice(before).some((c) => /create-by-text|DELETE/.test(c)), 'เนื้อหาเดิมต้องไม่อัปโหลดหรือลบ');
    // 3) bridge เพิ่งรีสตาร์ท (ไม่มี state) -> เทียบกับ segment ใน Dify แล้วรู้ว่าเหมือนเดิม
    const k1b = mk(f1);
    s = await k1b.syncOnce(false);
    assert.strictEqual(s.action, 'unchanged', 'หลังรีสตาร์ทต้องรู้จากเนื้อหาใน Dify ว่าไม่ต้องอัปโหลดใหม่');
    assert(f1.calls.some((c) => /segments$/.test(c)), 'อ่าน segment มาเทียบ');
    // 4) ชีทเปลี่ยน -> อัปโหลดใหม่
    s = await mk(f1, sheets('ศัตรูใหม่')).syncOnce(false);
    assert.strictEqual(s.action, 'replaced');
    assert.deepStrictEqual(f1.docs.filter((d) => d.name === DOC).map((d) => d.id), ['new2']);
    // 5) ตัวใหม่ทำดัชนีไม่สำเร็จ (เครดิตหมด) -> ลบตัวใหม่ เก็บตัวเก่า
    const f5 = fakeDify({ failIndexing: true, docs: [{ id: 'old5', name: DOC, created_at: 1, segs: ['## ดัชนีเก่า'] }] });
    s = await mk(f5).syncOnce(false);
    assert.strictEqual(s.ok, false); assert(/kept the previous index/.test(s.error));
    assert.deepStrictEqual(f5.docs.map((d) => d.id), ['old5'], 'ต้องเก็บดัชนีเก่าไว้เมื่อตัวใหม่ล้ม');
    // 6) ผู้ใช้ Disable ดัชนีทุกตัวใน Dify -> ไม่ซิงก์
    const f6 = fakeDify({ docs: [{ id: 'off6', name: DOC, created_at: 1, enabled: false, segs: ['x'] }] });
    s = await mk(f6).syncOnce(false);
    assert.strictEqual(s.action, 'disabled-in-dify');
    assert(!f6.calls.some((c) => /create-by-text|DELETE/.test(c)));
    // 7) มีดัชนีซ้ำค้างจากรอบที่ล้มกลางทาง -> เก็บตัวล่าสุดที่เนื้อหาตรง ลบตัวที่เหลือ
    const text = buildIndex(sheets()).text;
    const f7 = fakeDify({ docs: [{ id: 'dupOld', name: DOC, created_at: 1, segs: ['## เก่า'] }] });
    f7.docs.push({ id: 'dupNew', name: DOC, enabled: true, archived: false, indexing_status: 'completed', created_at: 5, segs: f7.toSegs(text) });
    s = await mk(f7).syncOnce(false);
    assert.strictEqual(s.action, 'unchanged+cleaned');
    assert.deepStrictEqual(f7.docs.map((d) => d.id), ['dupNew']);
    // 8) ปิดด้วย KB_INDEX_SYNC=off
    const off = createKbIndex({ api: f7.api, datasetId: 'ds', fetchSheets: async () => sheets(), enabled: false });
    assert.strictEqual(off.status(), 'off');
  } finally { console.log = quiet; }
  console.log('PASS: kb_index sync (สลับเอกสารหลังตัวใหม่เสร็จ, ไม่อัปโหลดซ้ำ, เก็บตัวเก่าเมื่อล้ม, เคารพการ Disable, เก็บกวาดตัวซ้ำ)');
})().catch((e) => { console.error(e); process.exit(1); });
