'use strict';

// v3.50 (28 Oct 2026): สถิติคุณภาพคำตอบ สำหรับงานตรวจรายวันที่อ่าน /health
// เก็บต่อรอบคำถาม: เวลา ชนิด (ข้อความ/รูป/เสียง) ใช้เวลากี่วินาที ได้คำตอบจาก Dify ไหม
// ข้อความสำรองที่ส่งแทนคำตอบ (ระบบขัดข้อง/เปิดรูปไม่ได้) และโหนดใน Dify ที่พังหรือต้องลองใหม่
// โหนดที่พังแบบมีค่า default ยังให้คำตอบได้ ลูกค้าไม่เห็น error แต่คำตอบมักช้าและอ่อนลง (เช่นรูปที่วิเคราะห์ไม่ได้)
// ไม่เก็บข้อความ ชื่อ หรือ userId ของลูกค้า
// v3.52: ผลการส่งคำตอบ reply / push (reply ไม่ผ่านจึงส่งแบบ push) / failed (ส่งไม่ถึงลูกค้าเลย)

const KEEP = 3000;
const SLOW_MS = 60000;
const round1 = (x) => Math.round(x * 10) / 10;

function normalize(t) {
  return {
    at: Number(t.at) || 0,
    kind: t.kind === 'image' || t.kind === 'voice' ? t.kind : 'text',
    ms: Math.max(0, Math.round(Number(t.ms) || 0)),
    ok: !!t.ok,
    delivery: t.delivery === 'reply' || t.delivery === 'push' || t.delivery === 'failed' ? t.delivery : '',
    fallback: t.fallback ? String(t.fallback).slice(0, 40) : '',
    issues: Array.isArray(t.issues) ? t.issues.slice(0, 8).map((x) => String(x).slice(0, 120)) : [],
    retries: Array.isArray(t.retries) ? t.retries.slice(0, 8).map((x) => String(x).slice(0, 80)) : []
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function createQuality(opts) {
  const o = opts || {};
  const now = o.now || Date.now;
  let turns = [];

  function record(t) {
    const rec = normalize(Object.assign({}, t, { at: now() }));
    turns.push(rec);
    if (turns.length > KEEP) turns = turns.slice(-KEEP);
    return rec;
  }

  function summary(hours) {
    const h = hours || 24;
    const since = now() - h * 3600000;
    const rows = turns.filter((t) => t.at >= since);
    const secs = rows.map((t) => t.ms / 1000).sort((a, b) => a - b);
    const byKind = {}, nodeIssues = {}, nodeRetries = {}, problems = [];
    for (const t of rows) {
      const k = byKind[t.kind] || (byKind[t.kind] = { turns: 0, fallbacks: 0, slowOver60s: 0, withNodeIssues: 0, notDelivered: 0 });
      k.turns++;
      if (t.fallback) k.fallbacks++;
      if (t.ms > SLOW_MS) k.slowOver60s++;
      if (t.issues.length) k.withNodeIssues++;
      if (t.delivery === 'failed') k.notDelivered++;
      for (const x of t.issues) nodeIssues[x] = (nodeIssues[x] || 0) + 1;
      for (const x of t.retries) nodeRetries[x] = (nodeRetries[x] || 0) + 1;
      if (t.fallback || t.issues.length || t.ms > SLOW_MS || t.delivery === 'failed') {
        problems.push({ at: new Date(t.at).toISOString(), kind: t.kind, seconds: round1(t.ms / 1000), fallback: t.fallback || undefined, issues: t.issues.length ? t.issues : undefined, notDelivered: t.delivery === 'failed' || undefined });
      }
    }
    return {
      hours: h,
      turns: rows.length,
      fallbacks: rows.filter((t) => t.fallback).length,
      slowOver60s: rows.filter((t) => t.ms > SLOW_MS).length,
      withNodeIssues: rows.filter((t) => t.issues.length).length,
      pushed: rows.filter((t) => t.delivery === 'push').length,
      notDelivered: rows.filter((t) => t.delivery === 'failed').length,
      seconds: { median: round1(percentile(secs, 0.5)), p90: round1(percentile(secs, 0.9)), max: round1(secs.length ? secs[secs.length - 1] : 0) },
      byKind,
      nodeIssues,
      nodeRetries,
      lastProblems: problems.slice(-10),
      trackingSince: turns.length ? new Date(turns[0].at).toISOString() : null
    };
  }

  function dump() { return turns.slice(-KEEP); }
  function load(arr) {
    if (!Array.isArray(arr)) return;
    turns = arr.filter((t) => t && typeof t === 'object' && Number(t.at) > 0).map(normalize).slice(-KEEP);
  }

  return { record, summary, dump, load };
}

module.exports = { createQuality, SLOW_MS };
