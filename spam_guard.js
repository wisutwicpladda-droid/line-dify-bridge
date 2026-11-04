'use strict';

// v3.72 (owner, 4 Nov 2026): protect the AI budget from floods sent by fake customers or competitors.
// server.js asks this guard before every paid step (speech-to-text and Dify). A fixed notice goes out with the
// LINE reply token, which costs nothing, at most once per limit window; later messages in the window are dropped
// without a reply. Counters live in memory and start again after a restart, which is fine for limits counted
// per minute, hour and day. Admins, bound dealers and ids in SPAM_ALLOW are never limited. An admin can still stop
// the bot for one chat for good with the existing "⏸ หยุดบอท ตอบเอง" button in the admin page.
//
// Per chat (env, 0 = no limit):
//   SPAM_BURST_MAX 8        messages in one minute; the rest are dropped without a reply
//   SPAM_HOUR_MAX 20        paid answers (Dify runs, cancelled runs included) in the last 60 minutes
//   SPAM_DAY_MAX 50         paid answers in one Thai day
//   SPAM_VOICE_DAY_MAX 10   voice messages a day (speech-to-text is paid before Dify runs)
//   SPAM_IMAGE_DAY_MAX 15   photos a day
//   SPAM_TEXT_MAX 1000      characters of one message passed to the AI
//   SPAM_REPEAT_MINUTES 10  the same typed question again: send the last answer again without the AI
// Whole bot:
//   SPAM_DAILY_BUDGET_THB 0 when today's AI cost of this bot reaches it, chats that got no answer before today get a
//                           notice with the sales team button instead of an AI answer (0 = off)
//   SPAM_GROUPS off         answer in group and room chats (SPAM_GROUP_ALLOW = group ids that may be answered)
//   SPAM_ALLOW              user ids never limited (staff, test accounts)
//   SPAM_GUARD off          turns the per-chat limits and the budget brake off (the group setting still applies)
// v3.73: the admin page (🛡️ กันสแปม) can change every value while the bot runs (configure); an empty value goes back
// to the env value. Group chats follow SPAM_GROUPS / the admin setting even when the guard is off.

const MIN_MS = 60000;
const HOUR_MS = 60 * MIN_MS;
const TZ_MS = 7 * HOUR_MS; // Thai time, no daylight saving
const dayKey = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
const thaiTime = (ms) => new Date(ms + TZ_MS).toISOString().slice(11, 16).replace(':', '.');
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const idList = (v) => String(v || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
// Shorter messages ("ค่ะ", "ใช่ครับ", "ขอบคุณค่ะ") usually answer the question at the end of the bot's last answer,
// so the same words can need a different answer: they always go to the AI.
const REPEAT_MIN = 12;

const TEAM_BUTTON = { type: 'action', action: { type: 'message', label: '📞 ทีมขายในพื้นที่', text: 'ขอเบอร์ทีมขายในพื้นที่' } };
const NOTICES = {
  hour: 'ชั่วโมงนี้น้องลัดดาตอบคำถามในแชทนี้ไปหลายข้อแล้ว ขอพักตอบอัตโนมัติถึงประมาณ {time} น. นะคะ ถ้าเร่งด่วน กดปุ่มด้านล่างเพื่อรับเบอร์พนักงานขายในพื้นที่ได้เลยค่ะ 🙏',
  day: 'วันนี้น้องลัดดาตอบคำถามในแชทนี้ไปหลายข้อแล้ว ขอพักตอบอัตโนมัติถึงพรุ่งนี้นะคะ ถ้าเร่งด่วน กดปุ่มด้านล่างเพื่อรับเบอร์พนักงานขายในพื้นที่ได้เลยค่ะ 🙏',
  voice: 'วันนี้ส่งข้อความเสียงมาหลายครั้งแล้วนะคะ รบกวนพิมพ์เป็นข้อความแทนได้ไหมคะ น้องลัดดาจะได้ช่วยดูต่อค่ะ',
  image: 'วันนี้ส่งรูปมาหลายรูปแล้วนะคะ รบกวนพิมพ์ชื่อสินค้าหรือคำถามเป็นข้อความได้ไหมคะ น้องลัดดาจะได้ช่วยดูต่อค่ะ',
  budget: 'ตอนนี้มีคนทักเข้ามามาก น้องลัดดาขอให้พนักงานขายในพื้นที่ช่วยดูแลก่อนนะคะ กดปุ่มด้านล่างเพื่อรับเบอร์ติดต่อได้เลยค่ะ 🙏'
};
// The start of each notice, to tell a notice in the chat history from a real answer.
const NOTICE_HEADS = Object.values(NOTICES).map((t) => t.split('{time}')[0].slice(0, 24));
const isNotice = (t) => { const s = String(t || ''); return NOTICE_HEADS.some((h) => s.startsWith(h)); };

function config(env) {
  return {
    on: env.SPAM_GUARD !== 'off',
    burstMax: num(env.SPAM_BURST_MAX, 8),
    hourMax: num(env.SPAM_HOUR_MAX, 20),
    dayMax: num(env.SPAM_DAY_MAX, 50),
    voiceDayMax: num(env.SPAM_VOICE_DAY_MAX, 10),
    imageDayMax: num(env.SPAM_IMAGE_DAY_MAX, 15),
    textMax: num(env.SPAM_TEXT_MAX, 1000),
    repeatMinutes: num(env.SPAM_REPEAT_MINUTES, 10),
    budgetThb: num(env.SPAM_DAILY_BUDGET_THB, 0),
    groups: env.SPAM_GROUPS === 'on',
    allow: new Set(idList(env.SPAM_ALLOW)),
    groupAllow: new Set(idList(env.SPAM_GROUP_ALLOW))
  };
}

// Letters, Thai vowel and tone marks, and digits, so "ใช้อะไรดี?" and "ใช้อะไร ดี" are the same question
// but "ข้าว" and "ขาว" are not.
const normQuestion = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

// A chat that got a real answer (not a notice from this guard) before today is not stopped by the budget brake.
function knownBefore(history, nowMs) {
  const start = Date.parse(dayKey(nowMs) + 'T00:00:00+07:00');
  return (history || []).some((h) => h && h.r === 'b' && h.at && h.at < start && !isNotice(h.t));
}

function createGuard(opts) {
  const o = opts || {};
  const now = o.now || Date.now;
  const base = config(o.env || {}); // Railway env values, or the built-in defaults
  const cfg = Object.assign({}, base, { allow: new Set(base.allow), groupAllow: new Set(base.groupAllow) });
  const extraAllow = typeof o.allow === 'function' ? o.allow : null; // admins and bound dealers (can change while running)
  const users = new Map(); // sid -> { day, burst, turns, dayTurns, voice, image, noticed, last, why }
  let day = dayKey(now());
  let stats = fresh();

  function fresh() {
    return { day, dropped: 0, notices: 0, repeats: 0, truncated: 0, groupDropped: 0,
      hits: { burst: 0, hour: 0, day: 0, voice: 0, image: 0, budget: 0 }, limited: new Set(), budgetLevel: '' };
  }
  function roll() {
    const k = dayKey(now());
    if (k === day) return;
    day = k;
    stats = fresh();
    for (const [sid, u] of users) {
      if (u.day !== day && (!u.turns.length || now() - u.turns[u.turns.length - 1] > HOUR_MS)) users.delete(sid);
    }
  }
  function user(sid) {
    let u = users.get(sid);
    if (!u) { u = { day, burst: [], turns: [], dayTurns: 0, voice: 0, image: 0, noticed: {}, last: null, why: '' }; users.set(sid, u); }
    if (u.day !== day) { u.day = day; u.dayTurns = 0; u.voice = 0; u.image = 0; u.noticed = {}; u.why = ''; }
    return u;
  }
  function allowed(sid) { return cfg.allow.has(sid) || !!(extraAllow && extraAllow(sid)); }
  function limit(u, sid, reason, windowKey, time) {
    stats.hits[reason] += 1;
    stats.limited.add(sid);
    u.why = reason;
    if (u.noticed[reason] === windowKey) { stats.dropped += 1; return { action: 'drop', reason }; }
    u.noticed[reason] = windowKey;
    stats.notices += 1;
    return { action: 'notice', reason, message: { type: 'text', text: NOTICES[reason].replace('{time}', time || ''), quickReply: { items: [TEAM_BUTTON] } } };
  }

  // m = { sid, stype: 'user'|'group'|'room', kind: 'text'|'image'|'voice'|'sticker', text, known, spentToday }
  // -> { action: 'answer', text, truncated? } | { action: 'notice', reason, message } | { action: 'repeat', answer } | { action: 'drop', reason }
  function check(m) {
    const x = m || {};
    const text = typeof x.text === 'string' ? x.text : '';
    roll();
    const sid = String(x.sid || '');
    if (x.stype && x.stype !== 'user' && !groupAllowed(sid)) { stats.groupDropped += 1; return { action: 'drop', reason: 'group' }; }
    if (!cfg.on) return { action: 'answer', text };
    if (allowed(sid)) return { action: 'answer', text };
    const t = now();
    const u = user(sid);
    u.burst = u.burst.filter((ms) => t - ms < MIN_MS);
    u.burst.push(t);
    if (cfg.burstMax && u.burst.length > cfg.burstMax) {
      stats.hits.burst += 1; stats.limited.add(sid); stats.dropped += 1; u.why = 'burst';
      return { action: 'drop', reason: 'burst' };
    }
    const key = x.kind === 'text' ? normQuestion(text) : '';
    if (key.length >= REPEAT_MIN && u.last && cfg.repeatMinutes && t - u.last.at <= cfg.repeatMinutes * MIN_MS && key === u.last.key) {
      stats.repeats += 1;
      return { action: 'repeat', reason: 'repeat', answer: u.last.answer };
    }
    if (cfg.budgetThb && Number(x.spentToday) >= cfg.budgetThb && !x.known) return limit(u, sid, 'budget', day);
    if (x.kind === 'voice' && cfg.voiceDayMax && u.voice >= cfg.voiceDayMax) return limit(u, sid, 'voice', day);
    if (x.kind === 'image' && cfg.imageDayMax && u.image >= cfg.imageDayMax) return limit(u, sid, 'image', day);
    u.turns = u.turns.filter((ms) => t - ms < HOUR_MS);
    if (cfg.hourMax && u.turns.length >= cfg.hourMax) {
      const until = u.turns[u.turns.length - cfg.hourMax] + HOUR_MS; // the count drops below the limit at this time
      return limit(u, sid, 'hour', 'h' + until, thaiTime(until));
    }
    if (cfg.dayMax && u.dayTurns >= cfg.dayMax) return limit(u, sid, 'day', day);
    if (x.kind === 'voice') u.voice += 1;
    if (x.kind === 'image') u.image += 1;
    if (cfg.textMax && text.length > cfg.textMax) { stats.truncated += 1; return { action: 'answer', text: text.slice(0, cfg.textMax), truncated: true }; }
    return { action: 'answer', text };
  }

  function groupAllowed(sid) { return cfg.groups || cfg.groupAllow.has(sid); }
  function noteGroupDrop() { roll(); stats.groupDropped += 1; }

  // v3.73: values from the admin page. s = { on, groups, burstMax, hourMax, dayMax, voiceDayMax, imageDayMax, textMax,
  // repeatMinutes, budgetThb, allow: [ids] }; a missing or empty value uses the env value again.
  const SETTING_KEYS = ['on', 'groups', 'burstMax', 'hourMax', 'dayMax', 'voiceDayMax', 'imageDayMax', 'textMax', 'repeatMinutes', 'budgetThb'];
  function configure(s) {
    const x = s || {};
    for (const k of SETTING_KEYS) {
      const v = x[k];
      if (v === undefined || v === null || v === '') cfg[k] = base[k];
      else if (k === 'on' || k === 'groups') cfg[k] = v === true || v === 'on' || v === 'true';
      else {
        const n = Number(v);
        cfg[k] = Number.isFinite(n) && n >= 0 ? (k === 'budgetThb' ? Math.round(n * 100) / 100 : Math.floor(n)) : base[k];
      }
    }
    cfg.allow = new Set([...base.allow, ...idList(Array.isArray(x.allow) ? x.allow.join(',') : x.allow)]);
  }
  function pick(c) { const out = {}; for (const k of SETTING_KEYS) out[k] = c[k]; return out; }
  function settings() { return { values: pick(cfg), defaults: pick(base), envAllow: base.allow.size }; }

  // One paid answer (one Dify run) for this chat.
  function noteTurn(sid) {
    if (!cfg.on) return;
    roll();
    const u = user(String(sid || ''));
    u.turns.push(now());
    u.dayTurns += 1;
  }

  // The last real answer to a typed question, sent again when the same question comes back soon.
  function noteAnswer(sid, question, answer) {
    if (!cfg.on || !question || !answer) return;
    const key = normQuestion(question);
    if (key.length < REPEAT_MIN) return;
    roll();
    const u = user(String(sid || ''));
    u.last = { key, answer: String(answer), at: now() };
  }

  // Budget alert levels, each returned once per day: 'warn' at 80% of SPAM_DAILY_BUDGET_THB, 'stop' at 100%.
  function budgetLevel(spentToday) {
    if (!cfg.on || !cfg.budgetThb) return '';
    roll();
    const s = Number(spentToday) || 0;
    const level = s >= cfg.budgetThb ? 'stop' : (s >= cfg.budgetThb * 0.8 ? 'warn' : '');
    if (!level || level === stats.budgetLevel || (level === 'warn' && stats.budgetLevel === 'stop')) return '';
    stats.budgetLevel = level;
    return level;
  }

  function limits() {
    return { burstPerMinute: cfg.burstMax, hour: cfg.hourMax, day: cfg.dayMax, voiceDay: cfg.voiceDayMax, imageDay: cfg.imageDayMax,
      textMax: cfg.textMax, repeatMinutes: cfg.repeatMinutes, budgetThb: cfg.budgetThb,
      groups: cfg.groups ? 'on' : (cfg.groupAllow.size ? 'allowlist' : 'off'), allow: cfg.allow.size };
  }

  // For the public /health: counts only, no chat ids and no limits.
  function summary() {
    roll();
    return { on: cfg.on, today: { day: stats.day, notices: stats.notices, dropped: stats.dropped, repeats: stats.repeats,
      truncated: stats.truncated, groupDropped: stats.groupDropped, hits: Object.assign({}, stats.hits),
      limitedChats: stats.limited.size, budgetLevel: stats.budgetLevel || undefined } };
  }

  // For the admin page: limits, budget and the chats with the most paid answers today.
  // r = { nameOf(sid), hasChat(sid), spentToday }
  function report(r) {
    const x = r || {};
    const out = Object.assign(summary(), { limits: limits() });
    const t = now();
    const rows = [];
    for (const [sid, u] of users) {
      if (u.day !== day) continue;
      rows.push({ sid, name: x.nameOf ? String(x.nameOf(sid) || '') : '', chat: x.hasChat ? !!x.hasChat(sid) : false,
        answersToday: u.dayTurns, answersLastHour: u.turns.filter((ms) => t - ms < HOUR_MS).length, voice: u.voice, image: u.image,
        limited: stats.limited.has(sid) ? (u.why || 'yes') : '', allowed: allowed(sid) });
    }
    rows.sort((a, b) => (b.limited ? 1 : 0) - (a.limited ? 1 : 0) || b.answersToday - a.answersToday || b.answersLastHour - a.answersLastHour);
    out.chatsToday = rows.length;
    out.top = rows.slice(0, 30);
    if (cfg.budgetThb) out.budget = { thb: cfg.budgetThb, spentToday: Number(x.spentToday) || 0 };
    return out;
  }

  return { check, noteTurn, noteAnswer, groupAllowed, noteGroupDrop, budgetLevel, summary, report, limits, configure, settings, cfg };
}

module.exports = { createGuard, knownBefore, normQuestion, isNotice, NOTICES, REPEAT_MIN };
