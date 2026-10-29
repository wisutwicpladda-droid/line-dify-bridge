'use strict';

// v3.55 (29 ต.ค. 2569): ค่าใช้จ่าย AI ของบอท สำหรับหน้า "💰 ค่าใช้จ่าย" ในเว็บแอดมิน
// ทุกคำตอบเก็บ token ที่แต่ละโหนดใน Dify ใช้ (เหตุการณ์ node_finished ของ stream ดู dify_stream.js)
// จำนวนครั้งที่ค้นเว็บ และค่าเสียง ElevenLabs (ถอดเสียงคิดตามวินาที อ่านเสียงคิดตามตัวอักษร)
// แล้วคิดเป็นเงินด้วยราคาของวันที่บันทึก ยอดย้อนหลังจึงไม่เปลี่ยนเมื่อราคาเปลี่ยน
// เช่น Gemini 3.8 Flash ขึ้นเป็น 2 เท่าตั้งแต่ 1 ม.ค. 2570 (ai.google.dev/gemini-api/docs/pricing)
// แก้ราคาได้ใน Railway: COST_USD_THB (บาทต่อ 1 USD) และ COST_PRICES (JSON) ดูคำอธิบายบนสุดของ server.js
// เก็บสรุปรายวัน 400 วัน รายละเอียดคำตอบล่าสุด 400 ครั้ง และยอดรายแชท 3 เดือน ในไฟล์ state บน Volume
// มี id แชทและคำถามสั้น ๆ จึงแสดงเฉพาะหน้าแอดมินที่ต้องใส่รหัส ห้ามใส่ใน /health ที่เปิดสาธารณะ

const TZ_MS = 7 * 3600000; // เวลาไทย ไม่มีเวลาออมแสง
const DAY_MS = 86400000;
const KEEP_DAYS = 400;
const KEEP_RECENT = 400;
const KEEP_MONTHS = 3;
const KEEP_CHATS = 3000;
const KINDS = ['text', 'image', 'voice'];
const CATS = ['ai', 'search', 'voice', 'kb', 'api'];
const SUM_FIELDS = ['i', 'o', 't', 'r', 's', 'sec', 'ch', 'cr'];
const SEARCH_RX = /google search|external search|ค้นเว็บ/i; // โหนด LLM ที่เปิดค้นเว็บ (grounding)
const PAID_API_RX = /openrouter|jev/i; // โหนด HTTP ที่เสียเงินต่อครั้ง
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RX = /^\d{4}-\d{2}$/;

const DEFAULT_PRICES = {
  usdThb: 33.8,
  // USD ต่อ 1 ล้าน token · out รวม token ที่โมเดลใช้คิด (thinking) · from = วันที่เริ่มใช้ราคา (เวลาไทย)
  models: {
    'gemini-3.8-flash': [{ from: '2000-01-01', in: 0.75, out: 3.75 }, { from: '2027-01-01', in: 1.5, out: 7.5 }]
  },
  defaultModel: 'gemini-3.8-flash', // โหนดที่ Dify ไม่บอกชื่อโมเดล
  searchFreePerMonth: 5000, // Google Search grounding ฟรีต่อเดือน (ทั้งบัญชี Google ใช้ร่วมกัน)
  searchUsdPer1k: 14,
  ttsUsdPer1kChars: 0.08, // ElevenLabs eleven_v4
  sttUsdPerHour: 0.22, // ElevenLabs scribe_v2
  apiUsdPerCall: 0.00007 // Jev ผ่าน OpenRouter ต่อครั้ง (ใช้เมื่อคำตอบของ API ไม่บอกค่าใช้จ่ายมาเอง)
};

const pos = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : 0; };
const r7 = (x) => Math.round(x * 1e7) / 1e7;
const r2 = (x) => Math.round(x * 100) / 100;
const dayKey = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);

function prevMonth(m) {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0');
}

function config(env) {
  const e = env || {};
  let prices = JSON.parse(JSON.stringify(DEFAULT_PRICES));
  let error = '';
  if (e.COST_PRICES) {
    try {
      const o = JSON.parse(e.COST_PRICES);
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('ต้องเป็น JSON object');
      const p = JSON.parse(JSON.stringify(prices));
      for (const [k, v] of Object.entries(o)) {
        if (k === 'models') {
          if (!v || typeof v !== 'object') throw new Error('models ต้องเป็น object');
          for (const [name, list] of Object.entries(v)) {
            const arr = (Array.isArray(list) ? list : [list])
              .filter((x) => x && typeof x === 'object' && pos(x.in) + pos(x.out) > 0)
              .map((x) => ({ from: DAY_RX.test(String(x.from || '')) ? String(x.from) : '2000-01-01', in: pos(x.in), out: pos(x.out) }))
              .sort((a, b) => (a.from < b.from ? -1 : (a.from > b.from ? 1 : 0)));
            if (!arr.length) throw new Error('ราคาของ ' + name + ' ไม่ถูกต้อง');
            p.models[name.toLowerCase()] = arr;
          }
        } else if (k === 'defaultModel') {
          p.defaultModel = String(v || '').toLowerCase();
        } else if (typeof DEFAULT_PRICES[k] === 'number') {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0 || (k === 'usdThb' && n === 0)) throw new Error(k + ' ต้องเป็นตัวเลข');
          p[k] = n;
        }
      }
      prices = p;
    } catch (err) {
      error = 'COST_PRICES อ่านไม่ได้ (' + err.message + ') จึงใช้ราคาตั้งต้น';
    }
  }
  if (pos(e.COST_USD_THB)) prices.usdThb = pos(e.COST_USD_THB);
  return { prices, error };
}

// ชื่อโมเดลจาก Dify -> ชื่อในตารางราคา (ชื่อที่ยาวที่สุดที่อยู่ในชื่อโมเดล)
function modelKey(prices, model) {
  const m = String(model || '').toLowerCase();
  if (!m) return '';
  let key = '';
  for (const k of Object.keys(prices.models)) if (m.includes(k) && k.length > key.length) key = k;
  return key;
}

function priceOn(prices, key, day) {
  let p = null;
  for (const x of prices.models[key] || []) if (x.from <= day) p = x;
  return p;
}

// วันที่ราคาเปลี่ยนครั้งถัดไปหลังวันนี้ ('' = ไม่มี)
function nextChange(prices, today) {
  let from = '';
  for (const list of Object.values(prices.models)) for (const x of list) if (x.from > today && (!from || x.from < from)) from = x.from;
  return from;
}

// คิดค่าใช้จ่ายของรายการเดิมใหม่ด้วยราคาของวันอื่น (ใช้ประมาณการหลังราคาเปลี่ยน)
function reprice(prices, i, day) {
  const key = modelKey(prices, i.m);
  const p = key && (i.i || i.o) ? priceOn(prices, key, day) : null;
  return p ? ((i.i || 0) * p.in + (i.o || 0) * p.out) / 1e6 : (i.u || 0);
}

// usage ของโหนดจาก dify_stream.js -> รายการค่าใช้จ่าย (null = ไม่มีค่าใช้จ่าย เช่น โหนด code หรือ HTTP ที่ดึงชีท)
function nodeItem(prices, u, day) {
  if (!u || typeof u !== 'object') return null;
  const type = String(u.type || '');
  const title = String(u.title || type || 'Dify').slice(0, 80);
  const ok = !u.status || u.status === 'succeeded';
  const inTok = pos(u.inTok);
  const tokens = pos(u.tokens);
  let outTok = pos(u.outTok);
  if (inTok && tokens > inTok + outTok) outTok = tokens - inTok; // thinking ที่ไม่ได้รวมอยู่ใน completion
  let cat = type === 'knowledge-retrieval' ? 'kb' : (type === 'http-request' || type === 'tool' ? 'api' : 'ai');
  if (cat === 'ai' && SEARCH_RX.test(title)) cat = 'search';
  let model = '';
  let usd = 0;
  if ((cat === 'ai' || cat === 'search') && inTok + outTok > 0) {
    model = u.model ? modelKey(prices, u.model) : prices.defaultModel;
    const p = model ? priceOn(prices, model, day) : null;
    if (p) usd = (inTok * p.in + outTok * p.out) / 1e6;
  }
  if (!usd) usd = pos(u.difyUsd) || pos(u.extraUsd); // โมเดลที่ไม่อยู่ในตารางราคา ใช้ราคาที่ Dify หรือ API บอกมา
  if (!usd && cat === 'api' && ok && PAID_API_RX.test(title)) usd = prices.apiUsdPerCall;
  if (!usd && !tokens && !(inTok + outTok)) return null;
  return { n: title, c: cat, m: model || String(u.model || '').toLowerCase().slice(0, 40), i: inTok, o: outTok, t: tokens || inTok + outTok, u: r7(usd), r: 1, s: cat === 'search' && ok ? 1 : 0 };
}

function ttsItem(prices, t) {
  const ch = Math.round(pos(t && t.chars));
  if (!ch) return null;
  return { n: 'ElevenLabs อ่านคำตอบเป็นเสียง', c: 'voice', m: 'tts', ch, cr: pos(t.credits), u: r7(ch / 1000 * prices.ttsUsdPer1kChars), r: 1 };
}

function sttItem(prices, t) {
  const sec = Math.round(pos(t && t.sec) * 10) / 10;
  if (!sec && !pos(t && t.credits)) return null;
  return { n: 'ElevenLabs ถอดข้อความเสียง', c: 'voice', m: 'stt', sec, cr: pos(t.credits), u: r7(sec / 3600 * prices.sttUsdPerHour), r: 1 };
}

// รวมรายการชื่อเดียวกัน (โหนดเดียวกันที่รันซ้ำ หรือรวมทั้งวัน)
function addItem(map, x) {
  const key = x.c + '|' + x.n + '|' + (x.m || '');
  const a = map[key] || (map[key] = { n: x.n, c: x.c, m: x.m || '', u: 0 });
  for (const f of SUM_FIELDS) if (x[f]) a[f] = r7((a[f] || 0) + x[f]);
  a.u = r7(a.u + (x.u || 0));
  return a;
}

function cleanItem(x) {
  if (!x || typeof x !== 'object' || typeof x.n !== 'string' || !x.n) return null;
  const out = { n: x.n.slice(0, 80), c: CATS.includes(x.c) ? x.c : 'api', m: String(x.m || '').slice(0, 40), u: pos(x.u) };
  for (const f of SUM_FIELDS) { const v = pos(x[f]); if (v) out[f] = v; }
  return out;
}

function cleanKinds(o, whole) {
  const out = {};
  if (o && typeof o === 'object') for (const k of KINDS) { const v = pos(o[k]); if (v) out[k] = whole ? Math.round(v) : v; }
  return out;
}

function cleanRec(r) {
  if (!r || typeof r !== 'object' || !pos(r.at)) return null;
  return {
    at: pos(r.at), sid: String(r.sid || '').slice(0, 80), k: KINDS.includes(r.k) ? r.k : 'text', q: String(r.q || '').slice(0, 80),
    n: r.n ? 1 : 0, u: pos(r.u), t: Math.round(pos(r.t)), s: Math.round(pos(r.s)),
    it: Array.isArray(r.it) ? r.it.map(cleanItem).filter(Boolean).slice(0, 30) : []
  };
}

function createCost(opts) {
  const o = opts || {};
  const now = o.now || Date.now;
  const cfg = config(o.env || {});
  const prices = cfg.prices;
  let since = 0; // เวลาที่เริ่มนับ (บันทึกแรก)
  let days = {}; // 'YYYY-MM-DD' -> { n: คำตอบ, k: คำตอบแยกชนิด, ku: USD แยกชนิด, u: USD, it: รายการแยกโหนด }
  let recent = []; // คำตอบล่าสุดพร้อมรายละเอียดแยกโหนด
  let chats = {}; // 'YYYY-MM' -> { sid: [คำตอบ, USD] }

  const thb = (usd) => r2((Number(usd) || 0) * prices.usdThb);
  const perMsg = (usd, n) => (n ? r2(usd * prices.usdThb / n) : 0);

  function addDay(day, rec) {
    const d = days[day] || (days[day] = { n: 0, k: {}, ku: {}, u: 0, it: {} });
    d.n += rec.n;
    if (rec.n) d.k[rec.k] = (d.k[rec.k] || 0) + rec.n;
    d.ku[rec.k] = r7((d.ku[rec.k] || 0) + rec.u);
    d.u = r7(d.u + rec.u);
    for (const i of rec.it) addItem(d.it, i);
    const keys = Object.keys(days);
    if (keys.length > KEEP_DAYS) {
      keys.sort();
      for (const k of keys.slice(0, keys.length - KEEP_DAYS)) delete days[k];
    }
  }

  function addChat(month, rec) {
    if (!rec.sid) return;
    const m = chats[month] || (chats[month] = {});
    const c = m[rec.sid] || (m[rec.sid] = [0, 0]);
    c[0] += rec.n;
    c[1] = r7(c[1] + rec.u);
    const months = Object.keys(chats).sort();
    for (const k of months.slice(0, Math.max(0, months.length - KEEP_MONTHS))) delete chats[k];
    const ids = Object.keys(m);
    if (ids.length > KEEP_CHATS) {
      ids.sort((a, b) => m[b][1] - m[a][1]);
      for (const id of ids.slice(KEEP_CHATS)) delete m[id];
    }
  }

  // t = { sid, kind: text|image|voice, q: คำถาม, turn: false = ไม่นับเป็นคำตอบ (เช่น ถอดเสียง),
  //       nodes: usage รายโหนดจาก dify_stream, message: usage รวมของข้อความ (ใช้เมื่อไม่มีรายโหนด),
  //       tts: { chars, credits }, stt: { sec, credits } }
  function record(t) {
    const x = t || {};
    const at = now();
    const day = dayKey(at);
    const map = {};
    for (const u of Array.isArray(x.nodes) ? x.nodes : []) { const it = nodeItem(prices, u, day); if (it) addItem(map, it); }
    if (x.message && !Object.values(map).some((i) => i.c === 'ai' || i.c === 'search')) {
      const it = nodeItem(prices, Object.assign({}, x.message, { title: 'Dify (รวมทุกขั้น)', type: 'llm', model: '' }), day);
      if (it) addItem(map, it);
    }
    if (x.tts) { const it = ttsItem(prices, x.tts); if (it) addItem(map, it); }
    if (x.stt) { const it = sttItem(prices, x.stt); if (it) addItem(map, it); }
    const items = Object.values(map);
    if (!items.length) return null;
    const isTurn = x.turn !== false;
    const rec = {
      at, sid: String(x.sid || '').slice(0, 80), k: KINDS.includes(x.kind) ? x.kind : 'text',
      q: String(x.q || '').replace(/\s+/g, ' ').trim().slice(0, 80), n: isTurn ? 1 : 0,
      u: r7(items.reduce((a, i) => a + i.u, 0)), t: items.reduce((a, i) => a + (i.t || 0), 0), s: items.reduce((a, i) => a + (i.s || 0), 0),
      it: items
    };
    if (!since) since = at;
    addDay(day, rec);
    addChat(day.slice(0, 7), rec);
    if (isTurn) {
      recent.push(rec);
      if (recent.length > KEEP_RECENT) recent = recent.slice(-KEEP_RECENT);
    }
    return rec;
  }

  function sumDays(keys) {
    let usd = 0;
    let turns = 0;
    for (const k of keys) {
      const d = days[k];
      if (d) { usd += d.u; turns += d.n; }
    }
    return { thb: thb(usd), turns, perMsg: perMsg(usd, turns), usd: r7(usd) };
  }

  function priceView(today) {
    return {
      usdThb: prices.usdThb,
      models: Object.keys(prices.models).map((m) => {
        const cur = priceOn(prices, m, today);
        const nx = prices.models[m].find((x) => x.from > today);
        return { model: m, in: cur ? cur.in : null, out: cur ? cur.out : null, next: nx ? { from: nx.from, in: nx.in, out: nx.out } : null };
      }),
      searchFreePerMonth: prices.searchFreePerMonth,
      searchUsdPer1k: prices.searchUsdPer1k,
      ttsUsdPer1kChars: prices.ttsUsdPer1kChars,
      sttUsdPerHour: prices.sttUsdPerHour,
      apiUsdPerCall: prices.apiUsdPerCall
    };
  }

  // สรุปสำหรับหน้าแอดมิน · nameOf(sid) = ชื่อแชท · hasChat(sid) = แชทยังอยู่ในระบบ (กดเปิดได้)
  function summary(opts2) {
    const so = opts2 || {};
    const nameOf = typeof so.nameOf === 'function' ? so.nameOf : () => '';
    const hasChat = typeof so.hasChat === 'function' ? so.hasChat : () => false;
    const nowMs = now();
    const today = dayKey(nowMs);
    const lastDays = (n) => Array.from({ length: n }, (_, i) => dayKey(nowMs - (n - 1 - i) * DAY_MS));
    const d30 = lastDays(30);
    const month = today.slice(0, 7);
    const prev = prevMonth(month);
    const allKeys = Object.keys(days);

    // ค้นเว็บเดือนนี้เทียบโควตาฟรีของ Google ส่วนที่เกินรวมในยอดเดือนนี้
    let searches = 0;
    for (const k of allKeys) if (k.startsWith(month)) for (const i of Object.values(days[k].it)) searches += i.s || 0;
    const overUsd = Math.max(0, searches - prices.searchFreePerMonth) * prices.searchUsdPer1k / 1000;
    const monthSum = sumDays(allKeys.filter((k) => k.startsWith(month)));
    if (overUsd > 0) {
      monthSum.usd = r7(monthSum.usd + overUsd);
      monthSum.thb = thb(monthSum.usd);
      monthSum.perMsg = perMsg(monthSum.usd, monthSum.turns);
    }

    // ประมาณการต่อเดือน (30 วัน) จากวันที่นับครบทั้งวันล่าสุดไม่เกิน 7 วัน ไม่รวมวันนี้และวันแรกที่เริ่มนับ
    let projection = null;
    const firstFull = since ? dayKey(since + DAY_MS) : '';
    const basis = firstFull ? lastDays(8).slice(0, 7).filter((k) => k >= firstFull) : [];
    if (basis.length) {
      const change = nextChange(prices, today);
      let usd = 0;
      let usdNext = 0;
      for (const k of basis) {
        const d = days[k];
        if (!d) continue;
        usd += d.u;
        for (const i of Object.values(d.it)) usdNext += change ? reprice(prices, i, change) : i.u;
      }
      projection = { days: basis.length, perDay: thb(usd / basis.length), month: thb(usd / basis.length * 30) };
      if (change) projection.next = { from: change, month: thb(usdNext / basis.length * 30) };
    }

    const daily = d30.map((k) => {
      const d = days[k];
      const g = { ai: 0, search: 0, voice: 0, other: 0 };
      if (d) for (const i of Object.values(d.it)) g[g[i.c] === undefined ? 'other' : i.c] += i.u;
      return { day: k, thb: d ? thb(d.u) : 0, turns: d ? d.n : 0, groups: { ai: thb(g.ai), search: thb(g.search), voice: thb(g.voice), other: thb(g.other) } };
    });

    const agg = {};
    let total30 = 0;
    const kindN = { text: 0, image: 0, voice: 0 };
    const kindUsd = { text: 0, image: 0, voice: 0 };
    for (const k of d30) {
      const d = days[k];
      if (!d) continue;
      total30 += d.u;
      for (const i of Object.values(d.it)) addItem(agg, i);
      for (const kd of KINDS) { kindN[kd] += d.k[kd] || 0; kindUsd[kd] += d.ku[kd] || 0; }
    }
    const items = Object.values(agg).sort((a, b) => b.u - a.u).map((a) => {
      const r = a.r || 1;
      return {
        label: a.n, cat: a.c, model: a.m, runs: a.r || 0,
        avgIn: Math.round((a.i || 0) / r), avgOut: Math.round((a.o || 0) / r), avgTokens: Math.round((a.t || 0) / r),
        avgSec: Math.round((a.sec || 0) / r * 10) / 10, avgChars: Math.round((a.ch || 0) / r), credits: Math.round(a.cr || 0), searches: a.s || 0,
        thb: thb(a.u), share: total30 > 0 ? Math.round(a.u / total30 * 1000) / 10 : 0
      };
    });
    const byKind = {};
    for (const kd of KINDS) byKind[kd] = { turns: kindN[kd], thb: thb(kindUsd[kd]), perMsg: perMsg(kindUsd[kd], kindN[kd]) };

    const from7 = nowMs - 7 * DAY_MS;
    const topTurns = recent.filter((x) => x.at >= from7).sort((a, b) => b.u - a.u).slice(0, 10).map((x) => ({
      at: x.at, sid: x.sid, name: String(nameOf(x.sid) || ''), chat: !!hasChat(x.sid), kind: x.k, q: x.q, thb: thb(x.u), tokens: x.t, search: x.s > 0,
      steps: x.it.slice().sort((a, b) => b.u - a.u).slice(0, 3).map((i) => ({ label: i.n, thb: thb(i.u) }))
    }));
    const cm = chats[month] || {};
    const topChats = Object.keys(cm).sort((a, b) => cm[b][1] - cm[a][1]).slice(0, 10).map((sid) => ({
      sid, name: String(nameOf(sid) || ''), chat: !!hasChat(sid), turns: cm[sid][0], thb: thb(cm[sid][1]), perMsg: perMsg(cm[sid][1], cm[sid][0])
    }));

    return {
      since: since || null,
      today: Object.assign({ day: today }, sumDays([today])),
      yesterday: sumDays([dayKey(nowMs - DAY_MS)]),
      last7: sumDays(lastDays(7)),
      last30: sumDays(d30),
      month: Object.assign({ key: month }, monthSum),
      prevMonth: Object.assign({ key: prev }, sumDays(allKeys.filter((k) => k.startsWith(prev)))),
      projection,
      daily,
      items,
      byKind,
      search: { month: searches, free: prices.searchFreePerMonth, overThb: thb(overUsd) },
      topTurns,
      topChats,
      prices: priceView(today),
      error: cfg.error || undefined
    };
  }

  function dump() { return { v: 1, since, days, recent, chats }; }

  function load(obj) {
    if (!obj || typeof obj !== 'object' || obj.v !== 1) return false;
    const nd = {};
    if (obj.days && typeof obj.days === 'object') {
      for (const k of Object.keys(obj.days).filter((x) => DAY_RX.test(x)).sort().slice(-KEEP_DAYS)) {
        const d = obj.days[k];
        if (!d || typeof d !== 'object') continue;
        const it = {};
        if (d.it && typeof d.it === 'object') for (const x of Object.values(d.it)) { const ci = cleanItem(x); if (ci) addItem(it, ci); }
        nd[k] = { n: Math.round(pos(d.n)), k: cleanKinds(d.k, true), ku: cleanKinds(d.ku, false), u: pos(d.u), it };
      }
    }
    const nc = {};
    if (obj.chats && typeof obj.chats === 'object') {
      for (const m of Object.keys(obj.chats).filter((x) => MONTH_RX.test(x)).sort().slice(-KEEP_MONTHS)) {
        const map = obj.chats[m];
        if (!map || typeof map !== 'object') continue;
        nc[m] = {};
        for (const [sid, v] of Object.entries(map)) if (Array.isArray(v)) nc[m][sid.slice(0, 80)] = [Math.round(pos(v[0])), pos(v[1])];
      }
    }
    days = nd;
    recent = Array.isArray(obj.recent) ? obj.recent.map(cleanRec).filter(Boolean).slice(-KEEP_RECENT) : [];
    chats = nc;
    since = pos(obj.since);
    return true;
  }

  return { record, summary, dump, load, thb, prices, error: cfg.error };
}

module.exports = { createCost, config, dayKey, DEFAULT_PRICES };
