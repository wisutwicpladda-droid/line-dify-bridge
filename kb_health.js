// kb_health.js — v3.39 (26 ต.ค. 2569): แจ้ง LINE เมื่อเครดิต OpenAI หมดจน Knowledge ของ Dify ใช้ไม่ได้
// เหตุ: 29 ก.ย. เครดิตหมด เอกสาร "สินค้า_จาก_GoogleSheet.md" ขึ้น Error เงียบ ๆ จนถึง 26 ต.ค. (ต้นเหตุ FB-01)
// ทุก KB_HEALTH_MIN นาที และทันทีที่ Dify ตอบ error เรื่อง quota:
//   1) ค้น Knowledge 1 ครั้ง (Dify ใช้ OpenAI embedding) ถ้า error เป็นเรื่องเครดิต -> แจ้ง LINE (ซ้ำทุก 24 ชม. ถ้ายังไม่หาย)
//   2) เครดิตกลับมาแล้ว -> แจ้ง, สั่ง kb_sync อัปเดตเอกสารสินค้าใหม่ และบอกเอกสารที่ต้องกด Retry
// error อื่น (เช่น Dify ล่มชั่วคราว) บันทึก log อย่างเดียว
'use strict';

const CREDIT_RX = /insufficient_quota|exceeded your current quota|credit_balance|credit balance|check your plan and billing/i;
const BILLING_URL = 'https://platform.openai.com/settings/organization/billing/overview';
const DAY_MS = 24 * 3600 * 1000;

function createKbHealth(opts) {
  const { api, datasetId, sheetDocName, notify, resync } = opts;
  const now = opts.now || Date.now;
  const state = { ok: null, at: 0, error: '', creditOut: false, alertedAt: 0, staleAlertedAt: 0, running: false };

  async function probe() {
    const r = await api('POST', '/datasets/' + datasetId + '/retrieve', { query: 'สถานะระบบน้องลัดดา' });
    const docs = [];
    const l = await api('GET', '/datasets/' + datasetId + '/documents?limit=100');
    if (l.status === 200 && l.data && Array.isArray(l.data.data)) {
      for (const d of l.data.data) {
        if (d && d.enabled !== false && d.indexing_status === 'error') docs.push({ name: String(d.name || d.id), error: String(d.error || '') });
      }
    }
    const ok = r.status === 200;
    return { ok, error: ok ? '' : r.status + ' ' + String(r.text || '').slice(0, 300), docs };
  }

  async function check() {
    if (state.running) return state;
    state.running = true;
    try {
      const p = await probe();
      const creditDocs = p.docs.filter((d) => CREDIT_RX.test(d.error)).map((d) => d.name);
      Object.assign(state, { at: now(), ok: p.ok && !p.docs.length,
        error: p.error || p.docs.map((d) => d.name + ': ' + d.error.slice(0, 150)).join(' | ') });
      if (!p.ok && CREDIT_RX.test(p.error)) {
        state.creditOut = true;
        if (!state.alertedAt || now() - state.alertedAt >= DAY_MS) {
          state.alertedAt = now();
          await notify('⚠️ เครดิต OpenAI หมด\nKnowledge ของน้องลัดดาค้นข้อมูลไม่ได้ เพราะ Dify ใช้ OpenAI ในการค้น\nเติมเครดิตที่ ' + BILLING_URL
            + '\nระบบเช็กซ้ำทุกชั่วโมง และจะแจ้งอีกครั้งเมื่อกลับมาใช้ได้');
        }
        return state;
      }
      if (!p.ok) { console.log('[kb-health] retrieve failed (not credit): ' + p.error.slice(0, 200)); return state; }
      const recovered = state.creditOut;
      Object.assign(state, { creditOut: false, alertedAt: 0 });
      const sheetFixed = !!resync && creditDocs.includes(sheetDocName);
      if (sheetFixed) await resync();
      const retry = creditDocs.filter((n) => n !== sheetDocName);
      if (recovered) {
        state.staleAlertedAt = now();
        await notify('✅ เครดิต OpenAI กลับมาใช้ได้แล้ว'
          + (sheetFixed ? '\nสั่งอัปเดตเอกสาร ' + sheetDocName + ' ใหม่ให้แล้ว' : '')
          + (retry.length ? '\nเอกสารที่ต้องกด Retry ใน Dify Knowledge: ' + retry.join(', ') : ''));
      } else if (retry.length && (!state.staleAlertedAt || now() - state.staleAlertedAt >= DAY_MS)) {
        state.staleAlertedAt = now();
        await notify('⚠️ เอกสาร Knowledge ขึ้น Error เพราะเครดิต OpenAI เคยหมด\nกด Retry ใน Dify Knowledge: ' + retry.join(', '));
      }
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
    return { ok: state.ok, at: state.at, creditOut: state.creditOut, error: state.error ? state.error.slice(0, 200) : undefined };
  }

  return { state, check, checkSoon, status };
}

module.exports = { createKbHealth, CREDIT_RX };
