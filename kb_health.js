// kb_health.js — แจ้ง LINE เมื่อ Knowledge ของน้องลัดดาใน Dify มีปัญหา
// v3.39 (26 ต.ค. 2569): เครดิต OpenAI หมด (Dify ใช้ OpenAI embedding ทั้งตอนทำดัชนีและตอนค้น)
//   เหตุ: 29 ก.ย. เครดิตหมด เอกสาร "สินค้า_จาก_GoogleSheet.md" ขึ้น Error เงียบ ๆ จนถึง 26 ต.ค. (ต้นเหตุ FB-01)
// v3.42 (27 ต.ค. 2569): log พบว่า 22–26 ต.ค. ซิงก์เอกสารสินค้าจากชีทล้มทุกชั่วโมง 95 ครั้งโดยไม่มีใครรู้
//   ("Document is not available" = Dify ไม่ยอมอัปเดตเอกสารที่ค้าง Error ต้องกด Retry ใน Dify เอง) จึงแจ้งปัญหาอื่นด้วย
// ทุก KB_HEALTH_MIN นาที และทันทีที่ Dify ตอบ error เรื่อง quota:
//   1) ค้น Knowledge 1 ครั้ง ถ้า error เป็นเรื่องเครดิต -> แจ้ง LINE (ซ้ำทุก 24 ชม. ถ้ายังไม่หาย)
//   2) เครดิตกลับมา -> แจ้ง ลองอัปเดตเอกสารสินค้าใหม่ และบอกสิ่งที่ยังต้องแก้ เช่น เอกสารที่ต้องกด Retry
//   3) เอกสารใน Knowledge ค้าง Error ไม่ว่าสาเหตุอะไร หรือซิงก์จากชีท (kb_sync, kb_index) ล้มติดกัน SYNC_FAIL_RUNS รอบ
//      -> แจ้งรวมเป็นข้อความเดียว แจ้งซ้ำทุก 24 ชม. หรือทันทีเมื่อมีปัญหาใหม่ และแจ้งเมื่อกลับมาปกติ
// ค้น Knowledge ไม่ได้ด้วยสาเหตุอื่น (เช่น Dify ล่มชั่วคราว) หรือโหลดรายชื่อเอกสารไม่ได้ -> บันทึก log อย่างเดียว และไม่สรุปว่าปกติ
'use strict';

const CREDIT_RX = /insufficient_quota|exceeded your current quota|credit_balance|credit balance|check your plan and billing/i;
const BILLING_URL = 'https://platform.openai.com/settings/organization/billing/overview';
const DAY_MS = 24 * 3600 * 1000;
const SYNC_FAIL_RUNS = 3;

const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function when(ts) {
  try { return new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return new Date(ts).toISOString().slice(0, 16).replace('T', ' '); }
}

function createKbHealth(opts) {
  const { api, datasetId, sheetDocName, notify, resync } = opts;
  const syncStates = opts.syncStates || (() => []); // [{ label, state: { failStreak, failSince, error } }]
  const now = opts.now || Date.now;
  const state = { ok: null, at: 0, error: '', creditOut: false, alertedAt: 0, problemKeys: [], problemAlertedAt: 0, running: false };

  async function probe() {
    const r = await api('POST', '/datasets/' + datasetId + '/retrieve', { query: 'สถานะระบบน้องลัดดา' });
    const docs = [];
    let listed = false, listError = '';
    const l = await api('GET', '/datasets/' + datasetId + '/documents?limit=100');
    if (l.status === 200 && l.data && Array.isArray(l.data.data)) {
      listed = true;
      for (const d of l.data.data) {
        if (d && d.enabled !== false && d.indexing_status === 'error') docs.push({ name: String(d.name || d.id), error: String(d.error || '') });
      }
    } else listError = l.status + ' ' + String(l.text || '').slice(0, 200);
    const ok = r.status === 200;
    return { ok, listed, listError, error: ok ? '' : r.status + ' ' + String(r.text || '').slice(0, 300), docs };
  }

  function docProblems(docs) {
    return docs.map((d) => ({ key: 'doc:' + d.name, line: 'เอกสาร ' + d.name + ' ค้าง Error'
      + (CREDIT_RX.test(d.error) ? ' เพราะเครดิต OpenAI เคยหมด' : (d.error ? ' (' + short(d.error, 100) + ')' : ''))
      + ' ต้องกด Retry ใน Dify Knowledge' }));
  }

  function syncProblems() {
    const out = [];
    for (const s of syncStates() || []) {
      const st = s && s.state;
      if (!st || !(st.failStreak >= SYNC_FAIL_RUNS)) continue;
      out.push({ key: 'sync:' + s.label, line: s.label + ' ไม่สำเร็จ ' + st.failStreak + ' รอบติดกัน'
        + (st.failSince ? ' ตั้งแต่ ' + when(st.failSince) : '') + (st.error ? ' (' + short(st.error, 120) + ')' : '') });
    }
    return out;
  }

  // แจ้งรวมข้อความเดียว: มีปัญหาใหม่หรือครบ 24 ชม. -> แจ้ง, ปัญหาหายหมดหลังเคยแจ้ง -> แจ้งว่าปกติ
  async function report(problems) {
    const keys = problems.map((p) => p.key);
    if (!keys.length) {
      if (!state.problemKeys.length) return;
      Object.assign(state, { problemKeys: [], problemAlertedAt: 0 });
      await notify('✅ ข้อมูลน้องลัดดาใน Knowledge กลับมาปกติแล้ว');
      return;
    }
    const fresh = keys.some((k) => !state.problemKeys.includes(k));
    const due = now() - state.problemAlertedAt >= DAY_MS;
    state.problemKeys = keys;
    if (!fresh && !due) return;
    state.problemAlertedAt = now();
    await notify('⚠️ ข้อมูลน้องลัดดาใน Knowledge มีปัญหา\n' + problems.map((p) => '• ' + p.line).join('\n')
      + '\nบอทยังตอบลูกค้าได้จากข้อมูลเดิม แต่ข้อมูลที่แก้ในชีทจะยังไม่เข้า Knowledge จนกว่าจะแก้'
      + '\nระบบเช็กทุกชั่วโมง แจ้งซ้ำทุก 24 ชม. และแจ้งอีกครั้งเมื่อกลับมาปกติ');
  }

  async function check() {
    if (state.running) return state;
    state.running = true;
    try {
      const p = await probe();
      Object.assign(state, { at: now(), ok: p.ok && p.listed && !p.docs.length,
        error: p.error || p.listError || p.docs.map((d) => d.name + ': ' + d.error.slice(0, 150)).join(' | ') });
      if (!p.ok && CREDIT_RX.test(p.error)) {
        state.creditOut = true;
        if (!state.alertedAt || now() - state.alertedAt >= DAY_MS) {
          state.alertedAt = now();
          await notify('⚠️ เครดิต OpenAI หมด\nKnowledge ของน้องลัดดาค้นข้อมูลไม่ได้ เพราะ Dify ใช้ OpenAI ในการค้น\nเติมเครดิตที่ ' + BILLING_URL
            + '\nระบบเช็กซ้ำทุกชั่วโมง และจะแจ้งอีกครั้งเมื่อกลับมาใช้ได้');
        }
        return state;
      }
      if (!p.ok || !p.listed) {
        console.log('[kb-health] ' + (p.ok ? 'document list' : 'retrieve') + ' failed (not credit): ' + (p.error || p.listError).slice(0, 200));
        return state;
      }
      const syncIssues = syncProblems();
      if (state.creditOut) {
        // เครดิตกลับมา: ลองอัปเดตเอกสารสินค้า (Dify จะไม่ยอมถ้าเอกสารยังค้าง Error) แล้วบอกสิ่งที่ยังต้องแก้ในข้อความเดียว
        Object.assign(state, { creditOut: false, alertedAt: 0 });
        let resynced = false;
        if (resync && p.docs.some((d) => d.name === sheetDocName)) {
          const st = await resync();
          resynced = !!(st && st.ok);
        }
        const left = docProblems(p.docs.filter((d) => !(resynced && d.name === sheetDocName))).concat(syncIssues);
        Object.assign(state, { problemKeys: left.map((x) => x.key), problemAlertedAt: left.length ? now() : 0 });
        await notify('✅ เครดิต OpenAI กลับมาใช้ได้แล้ว'
          + (resynced ? '\nอัปเดตเอกสาร ' + sheetDocName + ' ใหม่ให้แล้ว' : '')
          + (left.length ? '\nยังต้องแก้:\n' + left.map((x) => '• ' + x.line).join('\n') : ''));
        return state;
      }
      await report(docProblems(p.docs).concat(syncIssues));
      return state;
    } catch (e) {
      Object.assign(state, { at: now(), error: e.message });
      console.log('[kb-health] check failed: ' + e.message);
      return state;
    } finally {
      state.running = false;
    }
  }

  // Dify ตอบ error เรื่องเครดิตระหว่างแชท -> เช็กทันที (ไม่ถี่กว่า 5 นาที)
  function checkSoon(errorText) {
    if (!CREDIT_RX.test(String(errorText || '')) || now() - state.at < 5 * 60000) return;
    check().catch(() => {});
  }

  function status() {
    return { ok: state.ok, at: state.at, creditOut: state.creditOut, problems: state.problemKeys.length || undefined,
      error: state.error ? state.error.slice(0, 200) : undefined };
  }

  return { state, check, checkSoon, status };
}

module.exports = { createKbHealth, CREDIT_RX, SYNC_FAIL_RUNS };
