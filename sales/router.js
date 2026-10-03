'use strict';
const {normalize,companyFacts}=require('./catalog');
const evidenceSources=require('./evidence_sources.json');
const {updateFacts}=require('./conversation_facts');
const {buildClaims,directFact}=require('./claims');
const EMPTY={product_ids_recommended:[],primary_product_id:null,warnings_required:[],question_required:[],rate_refs:[],evidence_refs:[],image_product_ids:[],uncertainty:'',handoff_action:'none'};
const result=(answer_text,intent,extra={})=>({...EMPTY,answer_text,intent,...extra});
const {isExposure,SAFETY,exposureAnswer}=require('./safety');
function extract(text,catalog,previous={}) {
  if(previous.updated_at && Date.now()-previous.updated_at>1800000)previous={};
  const t=String(text||'').trim(), hits=catalog?catalog.index.mentions(t):[];
  const ctx={...previous,product_ids:hits.length?hits.map(p=>p.product_id):(previous.product_ids||[]),query:t};
  ctx.ambiguous_aliases=catalog?.index.ambiguities(t)||[];
  ctx.explicit_product_ids=hits.map(p=>p.product_id);
  const crops=[...new Set(['ข้าวโพด','ทุเรียน','มะม่วง','อ้อย','ข้าว','ลำไย','มันสำปะหลัง',
    ...(catalog?[...catalog.products.values()].flatMap(p=>p.usage.flatMap(u=>(u.crop_name||u.crop_group).split(/[,、/]/).map(x=>x.trim()).filter(Boolean))):[])])].sort((a,b)=>b.length-a.length);
  const explicitCrop=crops.find(c=>t.includes(c));
  if(explicitCrop && previous.crop && explicitCrop!==previous.crop) {
    delete ctx.age_days;delete ctx.age_months;delete ctx.stage;delete ctx.target;ctx.product_ids=hits.map(p=>p.product_id);
    previous={};
  }
  ctx.crop=explicitCrop||previous.crop||null;
  const harvest=t.match(/(?:อีก\s*)?(\d+)\s*วัน.{0,8}เก็บเกี่ยว/);
  const age=t.replace(/(?:อีก\s*)?\d+\s*วัน.{0,8}เก็บเกี่ยว/g,'').match(/(?:อายุ|ข้าว|อ้อย|ปลูก|หว่าน)\s*(\d+)\s*(วัน|เดือน)/)
    || (/^\d+\s*(?:วัน|เดือน)(?:ค่ะ|ครับ|คะ)?$/.test(t)?t.match(/(\d+)\s*(วัน|เดือน)/):null);
  ctx.near_harvest=/ใกล้เก็บเกี่ยว|ก่อนเก็บเกี่ยว/.test(t)||!!harvest||previous.near_harvest||false;
  if(harvest)ctx.days_to_harvest=+harvest[1];
  if(age){ctx.age_days=Number(age[1])*(age[2]==='เดือน'?30:1);ctx.age_months=age[2]==='เดือน'?+age[1]:null;ctx.age_unit=age[2];}
  if(/ก่อนปลูก|เตรียมดิน/.test(t))ctx.stage='ก่อนปลูก';
  if(/ช่วงดอก|ดอกบาน|กำลังออกดอก/.test(t)&&!/ยังไม่|ไม่ออกดอก/.test(t))ctx.stage='ดอก';
  if(catalog){
    const targets=[...new Set([...catalog.products.values()].flatMap(p=>p.usage.flatMap(u=>u.target_name.split(/[,\n:：]/).map(x=>x.trim()).filter(x=>x.length>=4))))].sort((a,b)=>b.length-a.length);
    ctx.target=[...targets,...evidenceSources.map(e=>e.target)].sort((a,b)=>b.length-a.length).find(x=>t.includes(x))||previous.target||null;
  }
  const rate=/อัตรา|กี่(?:กระสอบ|ขวด|ซีซี|กรัม|ถัง)|ผสมเท่า|ใช้น้ำ|น้ำ\s*\d+\s*ลิตร/.test(t);
  let intent='general_agriculture';
  if(isExposure(t))intent='exposure';
  else if(/(?:เบอร์|ติดต่อ|เขต|จังหวัด).*(?:พนักงานขาย|ทีมขาย)|(?:พนักงานขาย|ทีมขาย).*(?:เบอร์|เขต|จังหวัด)/.test(t))intent='team';
  else if(/แอดมิน|เจ้าหน้าที่|พนักงานขาย|ทีมงาน/.test(t))intent='admin';
  else if(/^(?:สวัสดี(?:ครับ|ค่ะ|คะ)?|ดีครับ|hello|hi|ทักทาย)$/i.test(t))intent='greeting';
  else if(/^(?:ขอบคุณ|โอเค|รับทราบ|ตกลง)(?:ครับ|ค่ะ|คะ|นะ)?[.! ]*$/.test(t))intent='acknowledgement';
  else if(/นายก|อิหร่าน|อเมริกา.*ชนะ|เลือกตั้ง|พันธุ์(?:ข้าว|ข้าวโพด)/.test(t))intent='out_of_scope';
  else if(/ทะเบียน|ขึ้นทะเบียน|PHI|เว้น.*เก็บ|ต้องห้าม|ล่าสุด/i.test(t))intent='regulatory';
  else if(/เทียบ|ต่าง.*ยังไง|ต่าง.*อย่างไร|คล้าย|ดีกว่า/.test(t))intent=hits.length>=2?'comparison':'competitor';
  else if(/เริ่มปลูก.*เก็บเกี่ยว|ทั้งฤดู|ทุกช่วง/.test(t))intent='season_program';
  else if(rate)intent='rate';
  else if(/ขนาด|บรรจุ|กระสอบละ|ขวดละ/.test(t)&&ctx.product_ids.length)intent='package';
  else if(hits.length)intent='product';
  else if(/ใบเหลือง|เหี่ยว|โคนเน่า|รากเน่า|รากดำ|มีกลิ่น|ยอดหงิก|ปลายใบไหม้|ไม่ออกผล|ไม่ติดผล/.test(t) && !/ยืนยันแล้ว|ตรวจพบเชื้อ/.test(t))intent='symptom';
  else if(ctx.target)intent='known_problem';
  else if(/เหลือง|เหี่ยว|เน่า|จุด|หงิก|ไหม้|แห้ง|ไม่ออกผล|ไม่ติดผล/.test(t))intent='symptom';
  ctx.intent=intent;ctx.rate_requested=intent==='rate';ctx.diagnosis_uncertain=intent==='symptom';
  if(!['exposure','rate','package','regulatory'].includes(intent)&&/หรือ.{0,25}(?:โรค|ขาดธาตุ|เชื้อรา)|ไม่แน่ใจ.*(?:โรค|เชื้อ)|หลัง(?:ฉีด|พ่น).*(?:ไหม้|เหลือง)|น้ำขัง.*(?:เหี่ยว|เหลือง|เน่า)/.test(t)) {
    ctx.intent='symptom';ctx.diagnosis_uncertain=true;
  }
  ctx.needs_web=['regulatory','competitor'].includes(intent)||/IRAC|FRAC|HRAC|ผ่าดอก|ผสมเกสร|แมลงปีกแข็ง/i.test(t);
  ctx.explicit_actives=catalog?[...new Set([...catalog.products.values()].flatMap(p=>[p.active_ingredient,p.common_name_th]).filter(s=>s&&normalize(t).includes(normalize(s))))]:[];
  if(ctx.near_harvest)ctx.needs_web=true;
  if(previous.diagnosis_uncertain&&['general_agriculture','product'].includes(ctx.intent)&&!hits.length&&!/ยืนยันแล้ว|ตรวจพบเชื้อ/.test(t)) {ctx.intent='symptom';ctx.diagnosis_uncertain=true;}
  ctx.facts=updateFacts(t,ctx,previous);
  if(Object.keys(ctx.facts.conflicts).length)ctx.diagnosis_uncertain=true;
  ctx.updated_at=Date.now();return ctx;
}
function fastAnswer(ctx,catalog) {
  const t=ctx.query||'';
  if(ctx.intent==='exposure'){const answer=exposureAnswer(t);return result(answer,'exposure',{warnings_required:[answer]});}
  if(ctx.intent==='greeting')return result('สวัสดีค่ะ น้องลัดดาช่วยเรื่องพืชและสินค้าเกษตรได้ วันนี้อยากปรึกษาเรื่องไหนคะ','greeting');
  if(ctx.intent==='acknowledgement')return result('ยินดีค่ะ มีเรื่องไหนอยากคุยต่อ บอกน้องลัดดาได้เลย','acknowledgement');
  if(ctx.intent==='admin')return result('รับเรื่องให้ทีมงานแล้วค่ะ น้องลัดดาจะพักการตอบระหว่างแอดมินดูแล','admin',{handoff_action:'request'});
  if(ctx.intent==='out_of_scope')return result('น้องลัดดาช่วยเรื่องการดูแลพืชและสินค้าเกษตรค่ะ เรื่องนี้อยู่นอกขอบเขตที่น้องลัดดาแนะนำได้','out_of_scope');
  if(!catalog)return null;
  if(ctx.ambiguous_aliases?.length){const ids=[...new Set(ctx.ambiguous_aliases.flatMap(x=>x.product_ids))];const names=ids.map(id=>catalog.products.get(id)).filter(p=>p?.open).map(p=>'"'+p.canonical_name+'"');return result('ชื่อนี้ตรงกับมากกว่าหนึ่งรายการค่ะ หมายถึง '+names.join(' หรือ ')+' คะ','clarification');}
  const p=ctx.product_ids.length===1?catalog.products.get(ctx.product_ids[0]):null;
  if(p&&!p.open&&['product','package','rate'].includes(ctx.intent))return result('น้องลัดดายังยืนยันข้อมูลสินค้านี้ไม่ได้ค่ะ ขอให้ทีมงานตรวจสอบก่อนแนะนำ',ctx.intent);
  const direct=directFact(ctx,catalog,buildClaims(catalog,ctx,null));
  if(direct)return result(direct.text,ctx.intent,{claim_refs:direct.claim_refs});
  // Exact fact questions only. Do not treat every question mentioning a name as lookup.
  if(p&&ctx.intent==='package')return result('"'+p.canonical_name+'" มีขนาด '+p.packages.map(k=>k.package_size_value+' '+k.package_size_unit).join(' และ ')+' ค่ะ','package');
  if(p&&ctx.intent==='product'&&(/คือสาร|สารอะไร|ชื่อสามัญ|ส่วนประกอบ|สูตรอะไร/.test(t)||normalize(t)===p.normalized_name))
    return result('"'+p.canonical_name+'" มีสารสำคัญ '+p.common_name_th+' ค่ะ','product');
  return null;
}
function boundedContext(history,summary='') {
  const recent=(history||[]).filter(h=>['u','a','b'].includes(h.role||h.r)&&!String(h.text||h.t||'').includes('[ข้อมูลตรวจสอบภายใน'))
    .slice(-6).map(h=>({role:h.role||h.r,text:String(h.text||h.t||'').slice(0,800)}));
  return {admin_summary:String(summary).slice(0,1500),recent};
}
module.exports={extract,fastAnswer,result,isExposure,SAFETY,exposureAnswer,boundedContext};
