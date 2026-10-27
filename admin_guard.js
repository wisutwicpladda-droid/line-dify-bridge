'use strict';
// admin_guard.js — v3.42 (27 ต.ค. 2569): กันเดารหัสหน้าแอดมิน
// หน้าแอดมินเปิดบนอินเทอร์เน็ต เห็นชื่อ เบอร์ และแชทของลูกค้า และส่งข้อความในนาม OA ได้ แต่เดิมใส่รหัสผิดได้ไม่จำกัด
// ใส่รหัสผิดครบ maxFails ครั้งภายใน windowMs -> IP นั้นถูกล็อก lockMs (ทุกคำขอได้ 429 แม้รหัสถูก) ใส่รหัสถูก = ล้างตัวนับของ IP นั้น
// IP ใช้ X-Real-IP ที่ proxy ของ Railway ตั้งให้ (เอกสาร Railway: "X-Real-IP for identifying client's remote IP")
// ไม่มี X-Real-IP (เช่น รันในเครื่อง) ใช้ค่าขวาสุดของ X-Forwarded-For เพราะค่าทางซ้ายผู้ส่งใส่มาเองได้ แล้วค่อยใช้ IP ของ socket
// นับเฉพาะรหัสผิดที่ไม่ซ้ำกัน: หน้าแอดมินที่เปิดค้างไว้ด้วยรหัสเก่าส่งรหัสเดิมทุก 20 วินาที ถ้านับทุกครั้งจะล็อก IP ทั้งออฟฟิศ
// ส่วนคนเดารหัสต้องลองรหัสใหม่ทุกครั้งอยู่แล้ว การนับแบบนี้จึงไม่ทำให้กันการเดาได้น้อยลง
const crypto = require('crypto');

function maskIp(ip) {
  const s = String(ip || '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.split('.').slice(0, 2).join('.') + '.x.x';
  return s.split(':').slice(0, 3).join(':') + ':…';
}

function createAdminGuard(opts) {
  opts = opts || {};
  const maxFails = Math.max(1, opts.maxFails || 10);
  const windowMs = opts.windowMs || 15 * 60000;
  const lockMs = opts.lockMs || 15 * 60000;
  const now = opts.now || Date.now;
  const log = opts.log || ((m) => console.log(m));
  const ips = new Map(); // ip -> { first, fails, lockedUntil, keys }

  function clientIp(req) {
    const h = req.headers || {};
    const real = String(h['x-real-ip'] || '').trim();
    if (real) return real;
    const xff = String(h['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    return xff.length ? xff[xff.length - 1] : String((req.socket && req.socket.remoteAddress) || '');
  }

  // นาทีที่ยังถูกล็อก (0 = ไม่ล็อก)
  function lockedFor(ip) {
    const e = ips.get(ip);
    return e && e.lockedUntil > now() ? Math.max(1, Math.ceil((e.lockedUntil - now()) / 60000)) : 0;
  }

  function fail(ip, key) {
    let e = ips.get(ip);
    if (!e || (now() - e.first > windowMs && !(e.lockedUntil > now()))) { e = { first: now(), fails: 0, lockedUntil: 0, keys: new Set() }; ips.set(ip, e); }
    const h = crypto.createHash('sha256').update(String(key || '')).digest('hex').slice(0, 16);
    if (e.keys.has(h)) return; // รหัสผิดตัวเดิมซ้ำ นับครั้งเดียว
    e.keys.add(h);
    e.fails++;
    log('[admin] wrong key from ' + maskIp(ip) + ' (' + e.fails + '/' + maxFails + ')');
    if (e.fails >= maxFails && !(e.lockedUntil > now())) {
      e.lockedUntil = now() + lockMs;
      log('[admin] locked ' + maskIp(ip) + ' for ' + Math.round(lockMs / 60000) + ' min after ' + e.fails + ' wrong keys');
    }
    if (ips.size > 2000) {
      for (const [k, v] of ips) if (!(v.lockedUntil > now()) && now() - v.first > windowMs) ips.delete(k);
    }
  }

  function ok(ip) { ips.delete(ip); }

  return { clientIp, lockedFor, fail, ok };
}

module.exports = { createAdminGuard, maskIp };
