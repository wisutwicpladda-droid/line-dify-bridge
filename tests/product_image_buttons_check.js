'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MORE_IMAGES_TEXT, productImageButtonPage } = require('../product_image_buttons');

// Execute the actual image handlers without starting the HTTP server, contacting
// Dify/LINE, or reading credentials. This catches wiring and dedup regressions.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const catalog = require('../product_images/index.json');
const plain = (value) => JSON.parse(JSON.stringify(value));
function runtime(options = {}) {
  const context = vm.createContext({
    PIMG: catalog, PIMG_NAMES: Object.keys(catalog).sort((a, b) => b.length - a.length),
    PIMG_ON: true, PUBLIC_URL: 'https://images.example.test', PIMG_MODE: 'image', PIMG_MAX: 3,
    PIMG_BG: '#ffffff', process: { env: {} }, console: { log() {} },
    MORE_IMAGES_TEXT, productImageButtonPage, ...options
  });
  vm.runInContext(source.slice(source.indexOf('const pimgMsgs ='), source.indexOf('function servePimg(')), context);
  vm.runInContext(source.slice(source.indexOf('function lineMsgs('), source.indexOf('async function lineReply(')), context);
  return context;
}
const r = runtime();
const cases = [];
function check(name, fn) { fn(); cases.push(name); console.log('PASS: ' + name); }
function items(msgs) { return msgs[msgs.length - 1].quickReply.items; }
function productTexts(msgs) { return items(msgs).map((i) => i.action.text).filter((text) => text !== MORE_IMAGES_TEXT); }
const answer = 'แนะนำ "คาริสมา" หรือ "มาบลิค" ค่ะ';
const unique = [...new Map(Object.entries(catalog).map(([name, file]) => [file, name])).values()];

check('previously sent Karisma retains both buttons without automatic duplicate', () => {
  const s = { pimgSent: { [catalog['คาริสมา']]: Date.now() } };
  const plan = r.pimgPlan(s, 'มียางครับ', answer);
  assert.deepEqual(plain(plan.buttons), ['คาริสมา', 'มาบลิค']);
  assert.equal(plan.images.length, 0);
});
check('both previously sent products retain buttons', () => {
  const s = { pimgSent: { [catalog['คาริสมา']]: Date.now(), [catalog['มาบลิค']]: Date.now() } };
  assert.deepEqual(plain(r.pimgPlan(s, 'มียางครับ', answer).buttons), ['คาริสมา', 'มาบลิค']);
});
check('currently attached image also has a button; automatic repeats remain suppressed', () => {
  const s = {};
  const first = r.pimgPlan(s, 'คาริสมา', answer);
  assert.equal(first.images.length, 1);
  assert(first.images[0].originalContentUrl.endsWith('/p007.png'));
  assert.deepEqual(plain(first.buttons), ['คาริสมา', 'มาบลิค']);
  const next = r.pimgPlan(s, 'คาริสมา', answer);
  assert.equal(next.images.length, 0);
  assert.deepEqual(plain(next.buttons), ['คาริสมา', 'มาบลิค']);
});
check('more than four products are not truncated', () => {
  const names = unique.slice(0, 6);
  assert.equal(r.pimgPlan({}, 'แนะนำสินค้า', names.join('\n')).buttons.length, 6);
});
check('13 buttons fit on one page; 14 use 12 plus navigation', () => {
  const thirteen = productImageButtonPage(unique.slice(0, 13));
  assert.equal(thirteen.pages, 1);
  assert.equal(thirteen.items.length, 13);
  const fourteen = productImageButtonPage(unique.slice(0, 14));
  assert.equal(fourteen.pages, 2);
  assert.equal(fourteen.items.length, 13);
  assert.equal(fourteen.items[12].action.text, MORE_IMAGES_TEXT);
});
check('all mapped images are reachable through actual menu navigation with no omissions', () => {
  const s = {};
  let msgs = ['สินค้าที่แนะนำ'];
  r.pimgAttachButtons(s, msgs, unique);
  const found = [];
  const pages = Math.ceil(unique.length / 12);
  for (let page = 0; page < pages; page++) {
    assert.equal(s.pimgMenu.page, page);
    assert(items(msgs).length <= 13);
    for (const item of items(msgs)) assert(item.action.label.length <= 20);
    found.push(...productTexts(msgs));
    assert.equal(r.lineMsgs(msgs).length, 1);
    msgs = r.pimgTap(s, MORE_IMAGES_TEXT);
  }
  assert.deepEqual(found, unique.map((name) => 'ขอรูป ' + name));
  assert.equal(s.pimgMenu.page, 0);
  assert.equal(msgs[0].text, `เลือกสินค้าที่ต้องการดูรูปค่ะ (หน้า 1/${pages})`);
});
check('explicit repeat image tap returns exact image and retains both buttons', () => {
  const s = { pimgSent: { [catalog['คาริสมา']]: Date.now() } };
  r.pimgAttachButtons(s, ['คำตอบ'], ['คาริสมา', 'มาบลิค']);
  const imgs = r.pimgTap(s, 'ขอรูป คาริสมา');
  assert.equal(imgs.length, 1);
  assert(imgs[0].originalContentUrl.endsWith('/p007.png'));
  assert.deepEqual(plain(productTexts(imgs)), ['ขอรูป คาริสมา', 'ขอรูป มาบลิค']);
});
check('image tap preserves current page; new recommendation replaces old menu', () => {
  const s = {};
  r.pimgAttachButtons(s, ['คำตอบ'], unique);
  r.pimgTap(s, MORE_IMAGES_TEXT);
  const imgs = r.pimgTap(s, 'ขอรูป ' + unique[12]);
  assert.equal(s.pimgMenu.page, 1);
  assert(productTexts(imgs).includes('ขอรูป ' + unique[12]));
  r.pimgAttachButtons(s, ['คำตอบใหม่'], ['มาบลิค']);
  assert.deepEqual(plain(s.pimgMenu), { names: ['มาบลิค'], page: 0 });
  const direct = r.pimgTap(s, 'ขอรูป คาริสมา');
  assert.deepEqual(plain(productTexts(direct)), ['ขอรูป คาริสมา']);
});
check('menu survives ordinary session JSON persistence', () => {
  const s = {};
  r.pimgAttachButtons(s, ['คำตอบ'], unique);
  const restored = plain(s);
  r.pimgTap(restored, MORE_IMAGES_TEXT);
  assert.equal(restored.pimgMenu.page, 1);
});
check('same-image aliases are deduplicated and each catalog name requests the correct file', () => {
  const aliases = Object.entries(catalog).filter(([, file]) => file === catalog['คาริสมา']).map(([name]) => name);
  assert.equal(r.pimgPlan({}, 'แนะนำสินค้า', aliases.join('\n')).buttons.length, 1);
  for (const [name, file] of Object.entries(catalog)) {
    assert(fs.existsSync(path.join(__dirname, '../product_images', file)), name + ' has no image');
    const imgs = r.pimgTap({}, 'ขอรูป ' + name);
    assert.equal(imgs[0].originalContentUrl, 'https://images.example.test/img/p/' + file);
    assert.equal(items(imgs)[0].action.text, 'ขอรูป ' + name);
  }
});
check('quick replies attach to last outgoing message without adding messages', () => {
  const msgs = ['คำตอบ', { type: 'image', originalContentUrl: 'https://images.example.test/a.png' }, { type: 'text', text: 'ลงทะเบียน' }];
  r.pimgAttachButtons({}, msgs, ['คาริสมา', 'มาบลิค']);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0], 'คำตอบ');
  assert.equal(msgs[1].quickReply, undefined);
  assert.equal(items(r.lineMsgs(msgs)).length, 2);
});
check('empty/emergency recommendation clears stale menu; disabled images remain disabled', () => {
  const s = {};
  r.pimgAttachButtons(s, ['คำตอบ'], ['คาริสมา']);
  const plan = r.pimgPlan(s, 'ฉุกเฉิน', 'ไปโรงพยาบาลพร้อมขวดคาริสมาค่ะ');
  assert.deepEqual(plain(plan), { images: [], buttons: [] });
  r.pimgAttachButtons(s, ['ไปโรงพยาบาล'], plan.buttons);
  assert.equal(s.pimgMenu, undefined);
  assert.equal(r.pimgTap(s, MORE_IMAGES_TEXT), null);
  for (const options of [{ PIMG_ON: false }, { PUBLIC_URL: '' }]) {
    const off = runtime(options);
    assert.deepEqual(plain(off.pimgPlan({}, '', answer)), { images: [], buttons: [] });
    assert.equal(off.pimgTap({}, 'ขอรูป คาริสมา'), null);
  }
});
check('unknown image names cannot produce an invented image URL or button', () => {
  assert.equal(r.pimgTap({}, 'ขอรูป ไม่มีสินค้านี้'), null);
  const msgs = ['คำตอบ'];
  r.pimgAttachButtons({}, msgs, ['ไม่มีสินค้านี้', 'คาริสมา']);
  assert.deepEqual(plain(productTexts(msgs)), ['ขอรูป คาริสมา']);
});
check('normal answer uses session menu and image tap remains ahead of Dify generation', () => {
  assert(source.includes('pimgAttachButtons(s, msgs, pplan.buttons);'));
  const handler = source.slice(source.indexOf('async function handleEvent('));
  assert(handler.indexOf('if (s.mutedUntil > now)') < handler.indexOf('const tapImgs ='));
  const tapBlock = handler.slice(handler.indexOf('const tapImgs ='), handler.indexOf('const allCategoryNames ='));
  assert(tapBlock.includes('sendAnswer(s, ev, pushTarget, tapImgs'));
  assert(tapBlock.includes('return;'));
  assert(!tapBlock.includes('askDify'));
});

console.log(JSON.stringify({ passed: cases.length, catalogNames: Object.keys(catalog).length, uniqueImageFiles: unique.length, missingFiles: 0, networkCalls: 0 }));
