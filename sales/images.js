'use strict';
const {normalize}=require('./catalog');
const overrides=require('./company_overrides.json');
const ASK=/(ขอ|ส่ง|ดู|มี|อยากเห็น).{0,10}(รูป|ภาพ)|(รูป|ภาพ).*สินค้า/;
function imageRequest(query,catalog) {
  if(!catalog||!ASK.test(query))return null;
  const replacement=Object.entries(overrides.image_requests).find(([name])=>normalize(query).includes(normalize(name)));
  if(replacement) {
    const p=catalog.products.get(replacement[1].product_id);
    if(p?.open)return {ids:[p.product_id],answer:'สินค้านี้จำหน่ายเป็นชุดค่ะ น้องลัดดาส่งภาพ "'+p.canonical_name+'" ให้ดูนะคะ'};
  }
  const ids=catalog.index.mentions(query).filter(p=>p.open).map(p=>p.product_id);
  return ids.length?{ids,answer:ids.map(id=>'"'+catalog.products.get(id).canonical_name+'"').join(' และ ')}:null;
}
function imagePlan({catalog,response,query,publicUrl,sent={},now=Date.now(),ttl=86400000}) {
  const images=[],marks=[];
  if(!catalog||!publicUrl)return {images,marks};
  for(const id of new Set(response.image_product_ids||[])) {
    const p=catalog.products.get(id);if(!p?.open)continue;
    if(sent[id]&&now-sent[id]<ttl&&!ASK.test(query))continue;
    for(const file of p.images) {
      images.push({type:'image',originalContentUrl:publicUrl+'/img/p/'+file,previewImageUrl:publicUrl+'/img/p/'+file});
    }
    if(p.images.length)marks.push(id);
  }
  return {images,marks};
}
module.exports={imageRequest,imagePlan};
