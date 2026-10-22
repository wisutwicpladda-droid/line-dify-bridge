'use strict';

// v3.37 (ทดลองใน V.2): ส่งลูกค้าที่สนใจซื้อไปหาร้านตัวแทนใกล้บ้านทาง LINE
// ลูกค้าต้องยืนยันก่อนทุกครั้ง บอทไม่ถามที่อยู่ และไม่รับปากเรื่องราคา/จัดส่ง (ลูกค้าคุยกับร้านเอง)
// เปิดด้วย REFERRAL=on และรายชื่อร้านใน DEALERS (JSON array):
//   [{ "id": "d1", "name": "ร้าน...", "provinces": ["*"], "districts": [], "lineId": "", "lineUrl": "", "lineOa": "",
//      "phone": "", "userId": "", "joinCode": "" }]
// provinces "*" = รับทุกพื้นที่, lineId = LINE ID ส่วนตัว, lineOa = @id ของ LINE OA ร้าน (เติมข้อความให้ลูกค้าได้)
// userId = LINE userId ของร้านใน OA นี้ (รับการ์ดแจ้งลูกค้า) ได้จากการพิมพ์ "ร้านค้า <joinCode>" ใน OA

const START_RX = /^(หาร้าน|ร้านใกล้|หาร้านใกล้|ส่งต่อร้าน|🛒?\s*ส่งต่อร้านให้หน่อย|สนใจซื้อ\s*ส่งต่อร้าน)/;
const INTENT_RX = /ซื้อ|สั่งซื้อ|ราคา|กี่บาท|ร้าน|ตัวแทน|ขายที่ไหน|มีขาย|หาซื้อ|อยากได้/;
const YES_RX = /^(✅\s*)?(ยืนยัน|ตกลง|โอเค|ok|ได้|ใช่|สนใจ|ส่งเลย|เอา|🛒)/i;
const NO_RX = /^(❌\s*)?(ไม่|ยกเลิก|ไว้ก่อน|ยังไม่)/;
const PHONE_RX = /(?<!\d)0\d{1,2}[- ]?\d{3}[- ]?\d{3,4}(?!\d)/;
const JOIN_RX = /^ร้านค้า\s+(\S+)$/;
const STEP_TTL = 30 * 60000;
const OFFER_COOLDOWN = 24 * 3600000;
const PENDING = ['offered', 'location', 'confirm', 'phone'];

function parseDealers(raw) {
  let list = [];
  try { list = JSON.parse(raw || '[]'); } catch (e) { return { dealers: [], error: 'DEALERS JSON ไม่ถูกต้อง: ' + e.message }; }
  if (!Array.isArray(list)) return { dealers: [], error: 'DEALERS ต้องเป็น array' };
  const dealers = list.filter((d) => d && d.name).map((d, i) => ({
    id: String(d.id || 'd' + (i + 1)),
    name: String(d.name).trim(),
    provinces: (Array.isArray(d.provinces) ? d.provinces : [d.provinces || '*']).map((p) => String(p).trim()).filter(Boolean),
    districts: (Array.isArray(d.districts) ? d.districts : []).map((p) => String(p).trim()).filter(Boolean),
    lineId: String(d.lineId || '').trim().replace(/^~/, ''),
    lineUrl: String(d.lineUrl || '').trim(),
    lineOa: String(d.lineOa || '').trim(),
    phone: String(d.phone || '').trim(),
    userId: String(d.userId || '').trim(),
    joinCode: String(d.joinCode || '').trim()
  }));
  return { dealers, error: '' };
}

function areaText(d) {
  const p = d.provinces.filter((x) => x !== '*');
  if (d.districts.length) return 'อ.' + d.districts.join(', อ.') + (p.length ? ' จ.' + p[0] : '');
  return p.length ? 'จ.' + p.join(', จ.') : 'ทุกพื้นที่';
}

function clean(t) { return String(t || '').replace(/^(อำเภอ|อ\.|จังหวัด|จ\.)\s*/, '').trim(); }

// เลือกร้าน: อำเภอตรง > จังหวัดตรง > ร้านที่รับทุกพื้นที่ ("*")
function pickDealer(dealers, locationText, province) {
  const loc = String(locationText || '') + ' ' + String(province || '');
  const has = (name) => !!clean(name) && loc.includes(clean(name));
  return dealers.find((d) => d.districts.some(has))
    || dealers.find((d) => d.provinces.some((p) => p !== '*' && has(p)))
    || dealers.find((d) => d.provinces.includes('*'))
    || null;
}

function chatUrl(d, products) {
  if (d.lineOa) {
    const msg = 'สวัสดีค่ะ สนใจ ' + (products.length ? products.join(', ') : 'สินค้า') + ' (แนะนำจากน้องลัดดา) สะดวกให้ไปรับที่ร้านหรือจัดส่งไหมคะ';
    return 'https://line.me/R/oaMessage/' + encodeURIComponent(d.lineOa.startsWith('@') ? d.lineOa : '@' + d.lineOa) + '/?' + encodeURIComponent(msg);
  }
  if (d.lineUrl) return d.lineUrl;
  if (d.lineId) return 'https://line.me/ti/p/~' + encodeURIComponent(d.lineId);
  return '';
}

function qr(...pairs) {
  return { items: pairs.map(([label, text]) => ({ type: 'action', action: { type: 'message', label: label.slice(0, 20), text } })) };
}

function isPending(ref, now) {
  return !!(ref && PENDING.includes(ref.step) && (now || Date.now()) - (ref.at || 0) <= STEP_TTL);
}

// ข้อความล่าสุดของลูกค้าแสดงความสนใจซื้อ + มีสินค้าในบทสนทนา + ยังไม่เสนอใน 24 ชม.
function shouldOffer(ref, userText, products, now) {
  const t = now || Date.now();
  const u = String(userText || '').trim();
  if (!INTENT_RX.test(u) || !products || !products.length) return false;
  if (START_RX.test(u)) return false;
  if (ref && ref.offeredAt && t - ref.offeredAt < OFFER_COOLDOWN) return false;
  if (ref && ref.step === 'sent' && t - (ref.at || 0) < OFFER_COOLDOWN) return false;
  return true;
}

function offerMessage(products) {
  const list = products.slice(0, 3).map((p) => '"' + p + '"').join(' ');
  return {
    type: 'text',
    text: '🛒 ถ้าสนใจซื้อ ' + list + ' น้องลัดดาช่วยหาร้านตัวแทนใกล้บ้านแล้วพาไปทักร้านได้เลยค่ะ',
    quickReply: qr(['🛒 ส่งต่อร้านให้หน่อย', 'สนใจซื้อ ส่งต่อร้าน'], ['ไม่เป็นไร', 'ไม่เป็นไร'])
  };
}

function dealerCard(ref, d, ctx) {
  const score = ctx.score;
  const lines = ['🛒 ลูกค้าสนใจซื้อ (ส่งต่อจากน้องลัดดา)', ''];
  lines.push('• ลูกค้า: ' + (ctx.customerName || 'ลูกค้า LINE'));
  lines.push('• สินค้า: ' + (ref.products && ref.products.length ? ref.products.join(', ') : 'ยังไม่ระบุ'));
  lines.push('• พื้นที่: ' + (ref.location || ctx.province || 'ยังไม่ทราบ'));
  if (score) lines.push('• คะแนนความสนใจ: ' + score.value + '/100 (' + score.levelTh + ')');
  if (ref.phone) lines.push('• โทร: ' + ref.phone);
  const qs = (ctx.questions || []).filter(Boolean).slice(-3);
  if (qs.length) { lines.push('', '💬 ลูกค้าถามน้องลัดดา:'); qs.forEach((q) => lines.push('- ' + q)); }
  lines.push('');
  lines.push(ref.phone ? '📞 รบกวนร้านโทรกลับลูกค้าด้วยค่ะ' : '💬 ลูกค้าจะทักไปที่ไลน์ร้าน');
  lines.push('เรื่องราคาและการจัดส่ง ตกลงกับลูกค้าได้โดยตรงค่ะ');
  return lines.join('\n');
}

function sentReplies(d, ref) {
  const url = chatUrl(d, ref.products || []);
  const head = 'ส่งเรื่องให้ ' + d.name + ' แล้วค่ะ 🙏';
  const tail = 'เรื่องราคา การไปรับที่ร้าน หรือการจัดส่ง สอบถามกับร้านได้โดยตรงเลยนะคะ';
  if (!url) return [head + (ref.phone ? ' ร้านจะโทรกลับที่เบอร์ ' + ref.phone : '') + (d.phone ? '\nหรือโทรหาร้านได้ที่ ' + d.phone : '') + '\n' + tail];
  const hint = d.lineOa ? '' : '\nพอแชทกับร้านเปิดขึ้นมา พิมพ์บอกร้านได้เลยว่า "สนใจ ' + ((ref.products || []).join(', ') || 'สินค้า') + ' จากน้องลัดดา"';
  return [
    head + hint + '\n' + tail + (d.phone ? '\nเบอร์ร้าน: ' + d.phone : ''),
    { type: 'template', altText: 'กดทักไลน์ ' + d.name, template: { type: 'buttons', text: ('ทักไลน์ ' + d.name).slice(0, 160), actions: [{ type: 'uri', label: '💬 ทักไลน์ร้าน', uri: url }] } }
  ];
}

// ผลลัพธ์: null = ไม่เกี่ยวกับการส่งต่อร้าน (ให้บอทตอบปกติ)
// { ref, replies, notify: { dealer, text } | null, dropped } (dropped = เลิกขั้นตอนค้าง แล้วให้บอทตอบปกติ)
function handle(prev, text, ctx) {
  const now = ctx.now || Date.now();
  const t = String(text || '').trim();
  const dealers = ctx.dealers || [];
  const pending = isPending(prev, now);
  const ref = Object.assign({}, pending ? prev : {}, { at: now });
  const start = START_RX.test(t);

  if (!start && !pending) return null;
  if (pending && !start && NO_RX.test(t)) {
    return { ref: Object.assign(ref, { step: 'declined' }), replies: ['ได้เลยค่ะ 😊 ถ้าสนใจภายหลัง พิมพ์ว่า "หาร้าน" ได้ตลอดนะคะ'], notify: null };
  }

  const toPick = (r, location) => {
    r.location = location || r.location || '';
    const d = pickDealer(dealers, r.location, ctx.province);
    if (!d) {
      r.step = 'none';
      return { ref: r, replies: ['ตอนนี้น้องลัดดายังไม่มีรายชื่อร้านตัวแทนในพื้นที่นี้ค่ะ 🙏 พิมพ์ "ทีมงานในพื้นที่" เพื่อให้ทีมขายช่วยแนะนำร้านได้นะคะ'], notify: null };
    }
    r.step = 'confirm';
    r.dealerId = d.id;
    r.dealerName = d.name;
    const prods = (r.products || []).length ? ' สินค้าที่สนใจ (' + r.products.join(', ') + ')' : '';
    return {
      ref: r,
      replies: [{
        type: 'text',
        text: 'ร้านตัวแทนใกล้คุณคือ ' + d.name + ' (' + areaText(d) + ') ค่ะ\n\nยืนยันให้น้องลัดดาส่งเรื่องให้ร้าน แล้วพาไปทักร้านไหมคะ?\n(ร้านจะได้รับชื่อ LINE' + prods + ' และพื้นที่ของคุณ)',
        quickReply: qr(['✅ ยืนยัน', 'ยืนยัน ส่งต่อร้าน'], ['❌ ยกเลิก', 'ยกเลิก'])
      }],
      notify: null
    };
  };

  if (start || (prev && prev.step === 'offered' && YES_RX.test(t))) {
    ref.products = (ref.products && ref.products.length) ? ref.products : (ctx.products || []);
    if (!dealers.length) return { ref: Object.assign(ref, { step: 'none' }), replies: ['ตอนนี้ยังไม่มีรายชื่อร้านตัวแทนในระบบค่ะ 🙏 พิมพ์ "ทีมงานในพื้นที่" เพื่อให้ทีมขายช่วยแนะนำร้านได้นะคะ'], notify: null };
    if (!ctx.province && !ref.location) {
      ref.step = 'location';
      return { ref, replies: ['ได้เลยค่ะ 😊 ขอทราบอำเภอและจังหวัดของคุณหน่อยนะคะ น้องลัดดาจะหาร้านตัวแทนที่ใกล้ที่สุดให้ค่ะ\n(เช่น อ.บ้านหมี่ จ.ลพบุรี)'], notify: null };
    }
    return toPick(ref, '');
  }

  const drop = () => ({ ref: Object.assign(ref, { step: 'dropped' }), replies: null, notify: null, dropped: true });
  if (prev.step === 'offered') return drop();

  if (prev.step === 'location') {
    if (t.length > 50 || /\?|ไหม|อะไร|ยังไง|อย่างไร/.test(t)) return drop();
    return toPick(ref, t);
  }

  const d = dealers.find((x) => x.id === prev.dealerId);
  if (prev.step === 'confirm') {
    if (!YES_RX.test(t)) return drop();
    if (!d) return toPick(ref, ref.location);
    if (!chatUrl(d, []) && !ref.phone) {
      ref.step = 'phone';
      return { ref, replies: ['ร้านนี้ยังไม่มีไลน์ให้ทักโดยตรงค่ะ ขอเบอร์โทรของคุณ เพื่อให้ร้านโทรกลับได้ไหมคะ? (พิมพ์เบอร์มาได้เลย หรือพิมพ์ "ยกเลิก")'], notify: null };
    }
    ref.step = 'sent';
    return { ref, replies: sentReplies(d, ref), notify: d.userId ? { dealer: d, text: dealerCard(ref, d, ctx) } : null };
  }

  if (prev.step === 'phone') {
    const m = PHONE_RX.exec(t);
    if (!m || !d) return drop();
    ref.phone = m[0];
    ref.step = 'sent';
    return { ref, replies: sentReplies(d, ref), notify: d.userId ? { dealer: d, text: dealerCard(ref, d, ctx) } : null };
  }
  return null;
}

// "ร้านค้า <joinCode>" -> ผูก LINE userId ของคนพิมพ์กับร้าน (ร้านจะได้รับการ์ดลูกค้า)
function joinDealer(dealers, text, userId) {
  const m = JOIN_RX.exec(String(text || '').trim());
  if (!m || !userId || userId === 'unknown') return null;
  const d = dealers.find((x) => x.joinCode && x.joinCode === m[1]);
  if (!d) return { ok: false, reply: 'รหัสร้านค้าไม่ถูกต้องค่ะ' };
  d.userId = userId;
  return { ok: true, dealer: d, reply: 'ลงทะเบียนไลน์นี้เป็นผู้รับเคสของ ' + d.name + ' แล้วค่ะ ✅\nเมื่อมีลูกค้ายืนยันว่าจะซื้อ น้องลัดดาจะส่งการ์ดลูกค้ามาที่แชทนี้นะคะ' };
}

module.exports = { parseDealers, pickDealer, chatUrl, shouldOffer, offerMessage, handle, joinDealer, isPending, dealerCard, areaText, START_RX, INTENT_RX };

