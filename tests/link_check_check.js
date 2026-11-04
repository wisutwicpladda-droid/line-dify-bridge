'use strict';
// v3.75: link_check.js (ตามลิงก์หลักฐานของ Dify ว่าเป็น doa.go.th ไหม) ด้วย fetch จำลอง ไม่ออกเน็ต
const assert = require('assert');
const lc = require('../link_check');

const KEY = 'k'.repeat(30);
const A = lc.PREFIX + 'AAAA_doa-1==';
const B = lc.PREFIX + 'BBBB_shop-2==';
const C = lc.PREFIX + 'CCCC_down-3==';
const calls = [];
const fakeFetch = async (url, opt) => {
  calls.push([url, opt.redirect]);
  if (url === A) return { status: 302, headers: { get: (h) => (h === 'location' ? 'https://www.doa.go.th/plprotect/x.pdf' : null) } };
  if (url === B) return { status: 302, headers: { get: (h) => (h === 'location' ? 'https://shopee.co.th/item-1' : null) } };
  throw new Error('network down');
};

function fakeRes() {
  const r = { status: 0, body: '' };
  r.writeHead = (s) => { r.status = s; };
  r.end = (b) => { r.body = b; };
  return r;
}

(async () => {
  // extraction: unique grounding links only, other links ignored
  const text = 'x "url": "' + A + '", y ' + A + ' z https://shopee.co.th/a ' + B + ' ' + C;
  assert.deepStrictEqual(lc.extract(text), [A, B, C]);
  assert.ok(lc.isDoaHost('www.doa.go.th') && lc.isDoaHost('doa.go.th') && !lc.isDoaHost('doa.go.th.evil.com') && !lc.isDoaHost('shopee.co.th'));

  const chk = lc.create({ keys: [KEY, '', 'short'], fetchImpl: fakeFetch });
  const out = await chk.check(text);
  assert.deepStrictEqual(out.map((o) => [o.host, o.doa, o.status]), [['www.doa.go.th', true, 'resolved'], ['shopee.co.th', false, 'resolved'], ['', false, 'unreachable']]);
  assert.ok(calls.every((c) => c[1] === 'manual'), 'never follows the redirect');

  // cache: resolved links are not fetched again
  const before = calls.length;
  await chk.check(A);
  assert.strictEqual(calls.length, before);

  // handler: key, method, body
  let res = fakeRes();
  await chk.handle({ method: 'POST', headers: { 'x-sheet-key': 'wrong' } }, res, Buffer.from(text));
  assert.strictEqual(res.status, 401);
  res = fakeRes();
  await chk.handle({ method: 'GET', headers: { 'x-sheet-key': KEY } }, res, Buffer.alloc(0));
  assert.strictEqual(res.status, 405);
  res = fakeRes();
  await chk.handle({ method: 'POST', headers: { 'x-sheet-key': KEY } }, res, Buffer.from(text));
  assert.strictEqual(res.status, 200);
  const j = JSON.parse(res.body);
  assert.strictEqual(j.links.length, 3);
  assert.strictEqual(j.links[0].doa, true);

  // not configured
  res = fakeRes();
  await lc.create({ keys: [] }).handle({ method: 'POST', headers: {} }, res, Buffer.alloc(0));
  assert.strictEqual(res.status, 503);

  const s = chk.summary();
  assert.ok(s.keys === 1 && s.denied === 1 && s.resolved === 2);
  console.log('link_check ok');
})().catch((e) => { console.error(e); process.exit(1); });

