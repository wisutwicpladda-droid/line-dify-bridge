'use strict';
const {cropMatch,stageMatch}=require('./candidates');
const {result}=require('./router');
const overrides=require('./company_overrides.json');
function rateAnswer(ctx,catalog) {
  if(ctx.intent!=='rate'||ctx.product_ids.length!==1)return null;
  const p=catalog.products.get(ctx.product_ids[0]);if(!p?.open)return null;
  let rows=p.usage.filter(u=>u.rate_verified && (!ctx.crop||cropMatch(u,ctx.crop)) &&
    (ctx.age_days==null || stageMatch(u.crop_stage,ctx)!=='mismatch'));
  const drone=/โดรน/.test(ctx.query),human=/คน|สะพาย/.test(ctx.query);
  if(drone||human)rows=rows.filter(u=>u.application_equipment===(drone?'โดรน':'คน'));
  const crops=new Set(rows.map(u=>u.crop_name||u.crop_group));
  if(crops.size>1)return result('ต้องการใช้ "'+p.canonical_name+'" กับพืชอะไร และพ่นด้วยคนหรือโดรนคะ','rate');
  if(!rows.length)return result('ยังไม่มีอัตราบริษัทที่ยืนยันได้สำหรับการใช้นี้ค่ะ น้องลัดดาแนะนำให้ทีมขายตรวจสอบก่อนใช้','rate');
  const signatures=new Set(rows.map(u=>[u.rate_min,u.rate_max,u.rate_unit,u.rate_basis_value,u.rate_basis_unit].join('|')));
  if(signatures.size>1)return result('ใช้กับพืชอายุเท่าไร และพ่นด้วยคนหรือโดรนคะ น้องลัดดาจะเลือกอัตราให้ตรงวิธีค่ะ','rate');
  const u=rows[0], range=u.rate_min===u.rate_max?u.rate_min:u.rate_min+'–'+u.rate_max;
  let answer='"'+p.canonical_name+'" อัตรา '+range+' '+u.rate_unit+' ต่อ '+u.rate_basis_value+' '+u.rate_basis_unit;
  const water=ctx.query.match(/น้ำ\s*(\d+(?:\.\d+)?)\s*ลิตร/),area=ctx.query.match(/(\d+(?:\.\d+)?)\s*ไร่/);
  if(water&&u.rate_basis_unit==='ลิตรน้ำ'){
    const m=+water[1]/+u.rate_basis_value;answer+=' น้ำ '+water[1]+' ลิตร ใช้ '+(+u.rate_min*m)+'–'+(+u.rate_max*m)+' '+u.rate_unit;
  }
  if(area&&u.rate_basis_unit==='ไร่'){
    const m=+area[1]/+u.rate_basis_value;
    const bag=p.packages.find(k=>k.package_type==='กระสอบ'&&k.package_size_unit===u.rate_unit);
    answer+=' พื้นที่ '+area[1]+' ไร่ ใช้ '+(+u.rate_min*m)+'–'+(+u.rate_max*m)+' '+u.rate_unit;
    if(bag) {
      const low=Math.ceil(+u.rate_min*m/+bag.package_size_value),high=Math.ceil(+u.rate_max*m/+bag.package_size_value);
      const policy=overrides.severity_rates[p.product_id];
      if(policy && policy.min===+u.rate_min && policy.max===+u.rate_max && policy.unit===u.rate_unit &&
        policy.basis_value===+u.rate_basis_value && policy.basis_unit===u.rate_basis_unit)
        answer+=' ('+policy.low_label+' '+low+' กระสอบ; '+policy.high_label+' '+high+' กระสอบ)';
      else answer+=' ('+low+'–'+high+' กระสอบ)';
    }
  }
  const equipment=[...new Set(rows.filter(r=>[r.rate_min,r.rate_max,r.rate_unit,r.rate_basis_value,r.rate_basis_unit].join('|')===[u.rate_min,u.rate_max,u.rate_unit,u.rate_basis_value,u.rate_basis_unit].join('|')).map(r=>r.application_equipment))];
  if(equipment.length)answer+=' ใช้ได้'+equipment.join('และ');
  answer+='ค่ะ';
  return result(answer,'rate',{rate_refs:[u.ref]});
}
module.exports={rateAnswer};
