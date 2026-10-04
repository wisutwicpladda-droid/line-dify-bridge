'use strict';

// LINE allows 13 quick replies on the last message. Reserve one for navigation
// only when the recommendation contains more than 13 products.
const MORE_IMAGES_TEXT = 'ดูรูปสินค้าเพิ่มเติม';
function productImageButtonPage(names, requestedPage = 0) {
  const size = names.length > 13 ? 12 : 13;
  const pages = Math.max(1, Math.ceil(names.length / size));
  const page = Number.isInteger(requestedPage) && requestedPage >= 0 ? requestedPage % pages : 0;
  const items = names.slice(page * size, (page + 1) * size).map((name) => ({
    type: 'action',
    action: { type: 'message', label: ('📷 ' + name).slice(0, 20), text: 'ขอรูป ' + name }
  }));
  if (pages > 1) items.push({
    type: 'action',
    action: { type: 'message', label: page + 1 === pages ? 'กลับรายการแรก' : 'ดูสินค้าเพิ่มเติม', text: MORE_IMAGES_TEXT }
  });
  return { page, pages, items };
}

module.exports = { MORE_IMAGES_TEXT, productImageButtonPage };
