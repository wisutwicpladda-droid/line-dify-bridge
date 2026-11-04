'use strict';

// v3.72: ตัวกันสแปม (spam_guard.js) ด้วยนาฬิกาปลอม: ส่งถี่ จำกัดต่อชั่วโมงและต่อวัน เสียง รูป ข้อความแจ้งครั้งเดียวแล้วเงียบ
// ถามซ้ำได้คำตอบเดิม ข้อความสั้นที่ตอบคำถามของบอทไม่นับเป็นคำถามซ้ำ ตัดข้อความยาว รายชื่อยกเว้น กลุ่ม
// งบต่อวัน (แชทเก่ากับแชทใหม่) แจ้งเตือนงบวันละครั้ง ขึ้นวันใหม่ และ /health ไม่มี id แชทหรือเพดาน
const assert = require('assert');
const { createGuard, knownBefore, normQuestion, isNotice, NOTICES, REPEAT_MIN } = require('../spam_guard');

const MIN = 60000;
const T0 = Date.parse('2026-11-04T09:00:00+07:00');
function clock(start) { const c = { t: start || T0 }; c.now = () => c.t; c.add = (ms) => { c.t += ms; }; return c; }
const A = 'U' + 'a'.repeat(32);
const B = 'U' + 'b'.repeat(32);
const C = 'U' + 'c'.repeat(32);
const G = 'C' + 'd'.repeat(32);
const ask = (g, sid, text, extra) => g.check(Object.assign({ sid, stype: 'user', kind: 'text', text }, extra || {}));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok - ' + name); }

test('8 messages a minute pass, the 9th is dropped without a notice, the next minute is fine again', () => {
  const c = clock();
  const g = createGuard({ env: {}, now: c.now });
  for (let i = 1; i <= 8; i++) assert.strictEqual(ask(g, A, 'ข้อความที่ ' + i).action, 'answer');
  assert.deepStrictEqual(ask(g, A, 'ข้อความที่ 9'), { action: 'drop', reason: 'burst' });
  assert.strictEqual(ask(g, B, 'อีกแชทไม่เกี่ยว').action, 'answer');
  c.add(61 * 1000);
  assert.strictEqual(ask(g, A, 'นาทีถัดไป').action, 'answer');
  const t = g.summary().today;
  assert.strictEqual(t.hits.burst, 1);
  assert.strictEqual(t.dropped, 1);
  assert.strictEqual(t.notices, 0);
});

test('20 AI answers in an hour: one notice with the time to ask again and the sales team button, then silence, then a new window', () => {
  const c = clock();
  const g = createGuard({ env: {}, now: c.now });
  for (let i = 1; i <= 20; i++) { assert.strictEqual(ask(g, A, 'คำถามที่ ' + i).action, 'answer'); g.noteTurn(A); c.add(2 * MIN); }
  const r = ask(g, A, 'คำถามที่ 21'); // 09:40, answers from 09:00 to 09:38
  assert.strictEqual(r.action, 'notice');
  assert.strictEqual(r.reason, 'hour');
  assert(r.message.text.includes('ถึงประมาณ 10.00 น.'), r.message.text);
  assert.strictEqual(r.message.quickReply.items[0].action.text, 'ขอเบอร์ทีมขายในพื้นที่');
  assert.deepStrictEqual(ask(g, A, 'คำถามที่ 22'), { action: 'drop', reason: 'hour' });
  c.add(20 * MIN + 1000); // 10:00:01: the 09:00 answer is more than an hour old
  assert.strictEqual(ask(g, A, 'คำถามที่ 23').action, 'answer');
  g.noteTurn(A);
  const r2 = ask(g, A, 'คำถามที่ 24');
  assert.strictEqual(r2.action, 'notice', 'a new window gets its own notice');
  assert(r2.message.text.includes('ถึงประมาณ 10.02 น.'), r2.message.text);
});

test('50 AI answers a day: notice, silence, and a new Thai day starts again', () => {
  const c = clock();
  const g = createGuard({ env: { SPAM_DAY_MAX: '5', SPAM_HOUR_MAX: '0' }, now: c.now });
  for (let i = 1; i <= 5; i++) { assert.strictEqual(ask(g, A, 'ถาม ' + i).action, 'answer'); g.noteTurn(A); c.add(MIN); }
  const r = ask(g, A, 'ถาม 6');
  assert.deepStrictEqual([r.action, r.reason], ['notice', 'day']);
  assert.strictEqual(r.message.text, NOTICES.day);
  assert.deepStrictEqual(ask(g, A, 'ถาม 7'), { action: 'drop', reason: 'day' });
  c.t = Date.parse('2026-11-05T00:00:30+07:00');
  assert.strictEqual(ask(g, A, 'วันใหม่แล้ว').action, 'answer');
  assert.strictEqual(g.summary().today.day, '2026-11-05');
  assert.strictEqual(g.summary().today.notices, 0);
});

test('voice and photo limits per day; typing still works', () => {
  const c = clock();
  const g = createGuard({ env: { SPAM_VOICE_DAY_MAX: '2', SPAM_IMAGE_DAY_MAX: '2' }, now: c.now });
  for (const kind of ['voice', 'image']) {
    assert.strictEqual(g.check({ sid: A, kind }).action, 'answer');
    assert.strictEqual(g.check({ sid: A, kind }).action, 'answer');
    const r = g.check({ sid: A, kind });
    assert.deepStrictEqual([r.action, r.reason, r.message.text], ['notice', kind, NOTICES[kind]]);
    assert.strictEqual(g.check({ sid: A, kind }).action, 'drop');
    c.add(MIN);
  }
  assert.strictEqual(ask(g, A, 'พิมพ์มาแทนค่ะ').action, 'answer');
});

test('the same typed question within 10 minutes gets the last answer again without the AI', () => {
  const c = clock();
  const g = createGuard({ env: {}, now: c.now });
  const q = 'ไฮซีส ใช้ในทุเรียน อัตราเท่าไหร่คะ';
  assert.strictEqual(ask(g, A, q).action, 'answer');
  g.noteTurn(A);
  g.noteAnswer(A, q, 'คำตอบเรื่องไฮซีส');
  c.add(3 * MIN);
  assert.deepStrictEqual(ask(g, A, 'ไฮซีสใช้ในทุเรียน   อัตราเท่าไหร่คะ??'), { action: 'repeat', reason: 'repeat', answer: 'คำตอบเรื่องไฮซีส' });
  assert.strictEqual(ask(g, B, q).action, 'answer', 'another chat does not get this chat answer');
  c.add(11 * MIN);
  assert.strictEqual(ask(g, A, q).action, 'answer', 'more than 10 minutes later goes to the AI');
  assert.strictEqual(g.summary().today.repeats, 1);
  // replies shorter than REPEAT_MIN answer the bot's last question, so they always go to the AI
  g.noteAnswer(A, 'ได้ค่ะ', 'คำตอบแรก');
  assert.strictEqual(ask(g, A, 'ได้ค่ะ').action, 'answer');
  assert(normQuestion('ขอบคุณค่ะ').length < REPEAT_MIN && normQuestion('ใช่ครับ').length < REPEAT_MIN);
  // tone and vowel marks count: ข้าว is not ขาว
  assert.notStrictEqual(normQuestion('ใบข้าวเป็นจุดสีน้ำตาลใช้อะไรดี'), normQuestion('ใบขาวเป็นจุดสีน้ำตาลใช้อะไรดี'));
  const off = createGuard({ env: { SPAM_REPEAT_MINUTES: '0' }, now: c.now });
  off.noteAnswer(A, q, 'x');
  assert.strictEqual(ask(off, A, q).action, 'answer', 'SPAM_REPEAT_MINUTES=0 turns repeats off');
});

test('a message longer than 1,000 characters is cut before the AI', () => {
  const g = createGuard({ env: {}, now: clock().now });
  const r = ask(g, A, 'ก'.repeat(1500));
  assert.deepStrictEqual([r.action, r.truncated, r.text.length], ['answer', true, 1000]);
  assert.strictEqual(ask(g, A, 'สั้น ๆ').truncated, undefined);
  assert.strictEqual(g.summary().today.truncated, 1);
});

test('SPAM_ALLOW and the admin or dealer callback are never limited', () => {
  const g = createGuard({ env: { SPAM_ALLOW: 'Uxyz, ' + A, SPAM_HOUR_MAX: '1', SPAM_BURST_MAX: '2' }, now: clock().now, allow: (id) => id === B });
  for (let i = 0; i < 12; i++) { assert.strictEqual(ask(g, A, 'staff ' + i).action, 'answer'); g.noteTurn(A); }
  for (let i = 0; i < 12; i++) { assert.strictEqual(ask(g, B, 'dealer ' + i).action, 'answer'); g.noteTurn(B); }
  assert.strictEqual(ask(g, C, 'customer 1').action, 'answer');
  g.noteTurn(C);
  assert.strictEqual(ask(g, C, 'customer 2').action, 'notice');
  const rep = g.report({});
  assert.strictEqual(rep.top.find((x) => x.sid === A).allowed, true);
  assert.strictEqual(rep.top.find((x) => x.sid === C).allowed, false);
  assert.strictEqual(rep.limits.allow, 2);
});

test('group and room chats are not answered unless SPAM_GROUPS=on or the group is in SPAM_GROUP_ALLOW', () => {
  const g = createGuard({ env: {}, now: clock().now });
  assert.strictEqual(g.groupAllowed(G), false);
  assert.deepStrictEqual(g.check({ sid: G, stype: 'group', kind: 'text', text: 'สวัสดี' }), { action: 'drop', reason: 'group' });
  g.noteGroupDrop();
  assert.strictEqual(g.summary().today.groupDropped, 2);
  assert.strictEqual(createGuard({ env: { SPAM_GROUPS: 'on' }, now: clock().now }).check({ sid: G, stype: 'room', kind: 'text', text: 'สวัสดี' }).action, 'answer');
  const g3 = createGuard({ env: { SPAM_GROUP_ALLOW: G }, now: clock().now });
  assert.strictEqual(g3.groupAllowed(G), true);
  assert.strictEqual(g3.groupAllowed('C' + 'e'.repeat(32)), false);
  assert.strictEqual(g3.limits().groups, 'allowlist');
});

test('daily budget: new chats get the notice once, chats answered before today still get answers; alerts once per level per day', () => {
  const c = clock();
  const g = createGuard({ env: { SPAM_DAILY_BUDGET_THB: '300' }, now: c.now });
  assert.strictEqual(ask(g, A, 'แชทใหม่', { known: false, spentToday: 299.99 }).action, 'answer');
  const r = ask(g, B, 'แชทใหม่อีกคน', { known: false, spentToday: 300 });
  assert.deepStrictEqual([r.action, r.reason, r.message.text], ['notice', 'budget', NOTICES.budget]);
  assert.strictEqual(r.message.quickReply.items[0].action.label, '📞 ทีมขายในพื้นที่');
  assert.deepStrictEqual(ask(g, B, 'ยังถามต่อ', { known: false, spentToday: 310 }), { action: 'drop', reason: 'budget' });
  assert.strictEqual(ask(g, C, 'ลูกค้าเก่าถาม', { known: true, spentToday: 310 }).action, 'answer');
  assert.strictEqual(g.budgetLevel(100), '');
  assert.strictEqual(g.budgetLevel(240), 'warn');
  assert.strictEqual(g.budgetLevel(250), '');
  assert.strictEqual(g.budgetLevel(300), 'stop');
  assert.strictEqual(g.budgetLevel(350), '');
  assert.strictEqual(g.budgetLevel(260), '', 'no warn after stop on the same day');
  assert.strictEqual(g.summary().today.budgetLevel, 'stop');
  assert.deepStrictEqual(g.report({ spentToday: 350 }).budget, { thb: 300, spentToday: 350 });
  c.t = Date.parse('2026-11-05T08:00:00+07:00');
  assert.strictEqual(g.budgetLevel(250), 'warn', 'a new day starts the alerts again');
  assert.strictEqual(createGuard({ env: {}, now: c.now }).budgetLevel(99999), '', 'no budget set = no alerts');
  assert.strictEqual(ask(createGuard({ env: {}, now: c.now }), B, 'ไม่มีงบ', { known: false, spentToday: 99999 }).action, 'answer');
});

test('knownBefore: a real answer before today counts, today or a guard notice does not', () => {
  const now = Date.parse('2026-11-04T10:00:00+07:00');
  const before = Date.parse('2026-11-03T23:59:00+07:00');
  assert.strictEqual(knownBefore([{ r: 'u', t: 'สวัสดี', at: before - 5 }, { r: 'b', t: 'สวัสดีค่ะ', at: before }], now), true);
  assert.strictEqual(knownBefore([{ r: 'b', t: 'สวัสดีค่ะ', at: Date.parse('2026-11-04T00:00:01+07:00') }], now), false);
  assert.strictEqual(knownBefore([{ r: 'u', t: 'สวัสดี', at: before }], now), false);
  assert.strictEqual(knownBefore([{ r: 'b', t: NOTICES.budget, at: before }], now), false);
  assert.strictEqual(knownBefore([{ r: 'b', t: NOTICES.hour.replace('{time}', '10.00'), at: before }], now), false);
  assert.strictEqual(isNotice('สวัสดีค่ะ'), false);
  assert.strictEqual(knownBefore(undefined, now), false);
});

test('SPAM_GUARD=off answers every chat without limits; group chats still follow SPAM_GROUPS', () => {
  const g = createGuard({ env: { SPAM_GUARD: 'off', SPAM_BURST_MAX: '1', SPAM_HOUR_MAX: '1' }, now: clock().now });
  for (let i = 0; i < 5; i++) { assert.strictEqual(ask(g, A, 'x' + i).action, 'answer'); g.noteTurn(A); }
  assert.deepStrictEqual(g.check({ sid: G, stype: 'group', kind: 'text', text: 'x' }), { action: 'drop', reason: 'group' });
  assert.strictEqual(g.groupAllowed(G), false);
  assert.strictEqual(g.summary().on, false);
  assert.deepStrictEqual(g.report({}).top, []);
  const open = createGuard({ env: { SPAM_GUARD: 'off', SPAM_GROUPS: 'on' }, now: clock().now });
  assert.strictEqual(open.check({ sid: G, stype: 'group', kind: 'text', text: 'x' }).action, 'answer');
});

test('v3.73 admin settings replace the env values while running; an empty value goes back to the env value', () => {
  const c = clock();
  const g = createGuard({ env: { SPAM_HOUR_MAX: '5' }, now: c.now });
  const s0 = g.settings();
  assert.deepStrictEqual([s0.defaults.hourMax, s0.defaults.budgetThb, s0.defaults.groups, s0.defaults.on], [5, 0, false, true]);
  g.configure({ hourMax: 1, budgetThb: '500', groups: false, on: true, allow: [B] });
  assert.deepStrictEqual([g.cfg.hourMax, g.cfg.budgetThb, g.limits().budgetThb], [1, 500, 500]);
  assert.strictEqual(ask(g, A, 'คำถามแรกของวันนี้').action, 'answer');
  g.noteTurn(A);
  assert.strictEqual(ask(g, A, 'คำถามที่สองของวันนี้').action, 'notice', 'the hour limit from the admin page applies at once');
  for (let i = 0; i < 3; i++) { assert.strictEqual(ask(g, B, 'allow ' + i).action, 'answer'); g.noteTurn(B); }
  assert.strictEqual(g.budgetLevel(400), 'warn', '80% of the 500 THB budget');
  assert.strictEqual(g.budgetLevel(500), 'stop');
  assert.deepStrictEqual(g.settings().values.hourMax, 1);
  g.configure({ hourMax: '' });
  assert.deepStrictEqual([g.cfg.hourMax, g.cfg.budgetThb, g.cfg.allow.has(B)], [5, 0, false], 'cleared values go back to the env values');
  g.configure({ hourMax: -3 });
  assert.strictEqual(g.cfg.hourMax, 5, 'a negative number is ignored');
  g.configure({ hourMax: 'abc' });
  assert.strictEqual(g.cfg.hourMax, 5, 'a value that is not a number is ignored');
  g.configure({ hourMax: 1, on: false });
  assert.strictEqual(ask(g, A, 'ปิดตัวกันแล้วถามต่อ').action, 'answer', 'guard off: no limits');
  g.configure({ groups: true });
  assert.strictEqual(g.groupAllowed(G), true);
  g.configure({ groups: 'off' });
  assert.strictEqual(g.groupAllowed(G), false);
});

test('/health summary has counts only; the admin report has limits, names and limited chats first', () => {
  const c = clock();
  const g = createGuard({ env: { SPAM_HOUR_MAX: '1' }, now: c.now });
  ask(g, A, 'คำถามแรกของลูกค้า');
  g.noteTurn(A);
  assert.strictEqual(ask(g, A, 'คำถามที่สองของลูกค้า').action, 'notice');
  ask(g, B, 'อีกคนหนึ่ง');
  g.noteTurn(B);
  c.add(MIN);
  g.noteTurn(B);
  const s = g.summary();
  assert.strictEqual(JSON.stringify(s).includes(A), false, '/health must not show chat ids');
  assert.strictEqual(s.limits, undefined, '/health must not show the limits');
  assert.strictEqual(s.today.limitedChats, 1);
  const rep = g.report({ nameOf: (id) => (id === A ? 'ลูกค้า A' : ''), hasChat: () => true });
  assert.strictEqual(rep.top[0].sid, A, 'limited chats first');
  assert.deepStrictEqual([rep.top[0].limited, rep.top[0].name, rep.top[0].chat, rep.top[0].answersToday], ['hour', 'ลูกค้า A', true, 1]);
  assert.strictEqual(rep.top[1].answersToday, 2);
  assert.strictEqual(rep.limits.hour, 1);
  assert.strictEqual(rep.chatsToday, 2);
  assert.strictEqual(rep.budget, undefined);
});

console.log('PASS: spam guard ' + passed + ' checks');
