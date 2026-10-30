'use strict';

// v3.59 (round 2 test row 47, 31 Oct 2026): a camera photo sent at original quality
// (4000x5333, 5.7 MB) made Gemini in Dify fail on every try, so the customer got
// "ระบบขัดข้องชั่วคราว". The same photo at 1536x2048 (500 KB) was answered normally.
// Photos are turned upright from EXIF, fit inside maxSide and sent as JPEG.
// Without the optional sharp package, or if reading fails, the original goes through.

let SHARP = null;
let loadError = '';
try { SHARP = require('sharp'); } catch (e) { loadError = e.message; }

function createShrinker(opts) {
  const o = opts || {};
  const maxSide = Math.max(800, Math.min(4096, parseInt(o.maxSide, 10) || 2048));
  const overBytes = o.overBytes || 1.5 * 1024 * 1024;
  const log = o.log || (() => {});
  const read = { failOn: 'none', limitInputPixels: 80e6 };
  async function shrink(buf, sid) {
    if (!SHARP || !buf || !buf.length) return null;
    try {
      const meta = await SHARP(buf, read).metadata();
      const side = Math.max(meta.width || 0, meta.height || 0);
      const turned = (meta.orientation || 1) > 1;
      if (side <= maxSide && buf.length <= overBytes && !turned) return null;
      const out = await SHARP(buf, read).rotate()
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      log(`[image] ${sid} resized ${meta.width}x${meta.height} ${Math.round(buf.length / 1024)}KB -> ${out.info.width}x${out.info.height} ${Math.round(out.data.length / 1024)}KB`);
      return { body: out.data, type: 'image/jpeg', width: out.info.width, height: out.info.height };
    } catch (e) { log(`[image] ${sid} resize failed, sending the original: ${e.message}`); return null; }
  }
  // v3.59 (round 2 row 57): small upright JPEG of a customer photo for the admin chat page
  async function thumb(buf, side) {
    if (!SHARP || !buf || !buf.length) return null;
    try {
      return await SHARP(buf, read).rotate().resize({ width: side || 360, height: side || 360, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 70 }).toBuffer();
    } catch (_) { return null; }
  }
  return { shrink, thumb, maxSide, available: !!SHARP, loadError };
}

module.exports = { createShrinker };
