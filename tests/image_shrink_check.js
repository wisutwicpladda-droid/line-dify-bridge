'use strict';

// v3.59 (round 2 row 47): a 4000x5333 camera photo is shrunk to fit 2048 px before it goes to Dify,
// a small photo goes through untouched, a sideways phone photo is turned upright, and a broken file
// falls back to the original.
const assert = require('assert');
const { createShrinker } = require('../image_shrink');

(async () => {
  const logs = [];
  const s = createShrinker({ maxSide: 2048, log: (m) => logs.push(m) });
  if (!s.available) { console.log('SKIP: sharp is not installed (' + s.loadError + ')'); return; }
  const sharp = require('sharp');
  // a big noisy photo like row 47 (noise keeps the JPEG large)
  const W = 4000, H = 5333;
  const raw = Buffer.alloc(W * H * 3);
  let x = 12345;
  for (let i = 0; i < raw.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[i] = (x >> 16) & 0xff; }
  const big = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  assert(big.length > 4 * 1024 * 1024, 'test photo should be several MB, got ' + big.length);
  const out = await s.shrink(big, 'test');
  assert(out && out.type === 'image/jpeg', 'big photo should be shrunk');
  assert.strictEqual(Math.max(out.width, out.height), 2048);
  assert.strictEqual(out.width, 1536);
  assert(out.body.length < big.length / 2, out.body.length);
  const meta = await sharp(out.body).metadata();
  assert.strictEqual(meta.format, 'jpeg');
  assert.strictEqual(meta.height, 2048);

  // a small photo goes through as it is
  const small = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 120, b: 40 } } }).jpeg().toBuffer();
  assert.strictEqual(await s.shrink(small, 'test'), null);

  // a sideways phone photo (EXIF orientation 6) is turned upright
  const side = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 200, b: 50 } } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const up = await s.shrink(side, 'test');
  assert(up, 'rotated photo should be rewritten upright');
  assert.strictEqual(up.width, 900);
  assert.strictEqual(up.height, 1200);

  // a PNG screenshot with transparency becomes a JPEG on white when it is too big
  const png = await sharp({ create: { width: 3000, height: 3000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const flat = await s.shrink(png, 'test');
  assert(flat && flat.type === 'image/jpeg' && flat.width === 2048, 'large PNG should be shrunk to JPEG');
  const px = await sharp(flat.body).raw().toBuffer();
  assert(px[0] > 240 && px[1] > 240 && px[2] > 240, 'transparent area should become white');

  // not an image -> null (the caller sends the original)
  assert.strictEqual(await s.shrink(Buffer.from('not an image'), 'test'), null);
  assert(logs.some((l) => /resize failed/.test(l)));
  console.log('PASS: photos are shrunk to 2048 px JPEG before Dify, small photos pass through, sideways photos are turned upright, broken files fall back to the original');
})().catch((e) => { console.error(e); process.exit(1); });
