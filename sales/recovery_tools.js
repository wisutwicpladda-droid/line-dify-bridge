'use strict';
const {useful}=require('./catalog');
const overrides=require('./company_overrides.json');
function calculationClaims(catalog,fields) {
  const out={},number=x=>Number(Number(x).toFixed(6));
  for(const p of catalog?.products.values()||[])if(p.open)for(const u of p.usage) {
    const key=u.rate_basis_unit==='ไร่'?'area_rai':u.rate_basis_unit==='ลิตรน้ำ'?'water_liters':null;
    const amount=key?fields[key]?.value:null;
    if(!u.rate_verified||!Number.isFinite(amount)||amount<=0)continue;
    const low=number(Number(u.rate_min)*amount/Number(u.rate_basis_value)),high=number(Number(u.rate_max)*amount/Number(u.rate_basis_value));
    let text='"'+p.canonical_name+'" '+(key==='area_rai'?'พื้นที่ ':'น้ำ ')+amount+' '+(key==='area_rai'?'ไร่':'ลิตร')+' ใช้ '+low+(low!==high?'–'+high:'')+' '+u.rate_unit;
    const bag=key==='area_rai'?p.packages.find(k=>k.package_type==='กระสอบ'&&k.package_size_unit===u.rate_unit):null;
    if(bag&&Number(bag.package_size_value)>0) {
      const policy=overrides.severity_rates[p.product_id];
      const approved=policy&&policy.min===Number(u.rate_min)&&policy.max===Number(u.rate_max)&&policy.unit===u.rate_unit&&policy.basis_value===Number(u.rate_basis_value)&&policy.basis_unit===u.rate_basis_unit;
      text+=' ('+(approved?policy.low_label:'อัตราต่ำ')+' '+Math.ceil(low/Number(bag.package_size_value))+' กระสอบ; '+(approved?policy.high_label:'อัตราสูง')+' '+Math.ceil(high/Number(bag.package_size_value))+' กระสอบ)';
    }
    const id=p.product_id+':calculation:'+u.ref;
    out[id]={id,field:'calculation',text,product_id:p.product_id,source_ref:u.ref,source_type:'company_calculation',
      value:{crop_name:u.crop_name,crop_group:u.crop_group,rate_verified:true},basis:{field:key,amount,source_refs:fields[key].source_refs},catalog_version:catalog.version};
  }
  return out;
}
function verifiedTools({catalog,team={},dealers=[],evidence=[]}={}) {
  const claims={},products=[];
  const add=(id,field,value,text,source_ref,product_id=null,extra={})=>{
    if(!useful(typeof value==='object'?JSON.stringify(value):value))return;
    claims[id]={id,field,value,text,product_id,source_ref,source_type:'company_catalog',catalog_version:catalog?.version||null,...extra};
  };
  for(const p of catalog?.products.values()||[]) {
    // Closed identities are internal deny-list evidence, never customer-visible facts.
    if(!p.open)continue;
    const id=p.product_id,n='"'+p.canonical_name+'"';
    const usage=p.usage.map(u=>Object.fromEntries(['ref','crop_name','crop_group','target_name','crop_stage','application_equipment','how_to_use','rate_verified','rate_min','rate_max','rate_unit','rate_basis_value','rate_basis_unit','coverage_area_value','coverage_area_unit'].map(k=>[k,u[k]])));
    add(id+':name','name',p.canonical_name,n,id,id);
    add(id+':formula','formula',p.common_name_th,n+' มีสารสำคัญ '+p.common_name_th,id,id);
    add(id+':moa','moa',p.moa_group,n+' กลุ่มกลไกการออกฤทธิ์ '+p.moa_group,id,id);
    add(id+':point','selling_point',p.selling_point,n+': '+p.selling_point,id,id);
    add(id+':precaution','precaution',p.additional_precautions,n+': '+p.additional_precautions,id,id);
    add(id+':status','status',p.status_selling,n+' เปิดจำหน่ายแล้วค่ะ สต็อกต้องตรวจสอบกับร้านอีกครั้ง',id,id);
    for(const k of p.packages)add(id+':package:'+k.package_id,'package',k,n+' ขนาด '+k.package_size_value+' '+k.package_size_unit,k.package_id,id);
    for(const u of usage) {
      add(id+':usage:'+u.ref,'usage',{crop:u.crop_name||u.crop_group,target:u.target_name,stage:u.crop_stage},n+' ข้อมูลบริษัทระบุใช้กับ '+(u.crop_name||u.crop_group)+' / '+u.target_name+' ระยะ '+u.crop_stage,u.ref,id);
      if(u.rate_verified)add(id+':rate:'+u.ref,'rate',{crop_name:u.crop_name,crop_group:u.crop_group,rate_verified:true},n+' อัตรา '+u.rate_min+(u.rate_min!==u.rate_max?'–'+u.rate_max:'')+' '+u.rate_unit+' ต่อ '+u.rate_basis_value+' '+u.rate_basis_unit+' ('+(u.application_equipment||u.how_to_use)+')',u.ref,id);
    }
    products.push({product_id:id,name:p.canonical_name,aliases:p.aliases||[],category:p.product_category,formula:p.common_name_th,active_ingredient:p.active_ingredient,
      moa:p.moa_group,strategy_rank:p.rank,usage,packages:p.packages.map(k=>({package_id:k.package_id,value:k.package_size_value,unit:k.package_size_unit})),precautions:p.additional_precautions,
      selling_point:p.selling_point,image_available:p.images.length>0,claim_ids:Object.keys(claims).filter(k=>claims[k].product_id===id)});
  }
  // Team data is a separate tool source. Presence never establishes dealer stock.
  for(const row of team.records||[])if(row.id&&row.text&&team.verified_at)add('team:'+row.id,'team',row,row.text,row.id,null,
    {source_type:'company_team',verified_at:team.verified_at});
  const verifiedDealers=dealers.filter(d=>d.active===true&&d.verified_at&&d.dealer_id&&d.dealer_name).map(d=>({...d,stock:'unknown'}));
  for(const d of verifiedDealers)add('dealer:'+d.dealer_id,'dealer',d,d.dealer_name+' '+(d.province||'')+' '+(d.contact||'')+' (ต้องตรวจสอบสต็อกกับร้าน)',d.dealer_id,null,{source_type:'company_dealer',verified_at:d.verified_at});
  const approved=evidence.filter(e=>e.verified&&e.evidence_id&&Date.parse(e.valid_until||e.expires_at)>Date.now()&&!e.conflict);
  for(const e of approved) {
    if(['phi','registration','pollinator_safety'].includes(e.claim_type)&&!e.product_label_verified)continue;
    add('evidence:'+e.evidence_id,e.claim_type,e.claim,e.claim,e.evidence_id,e.product_id||null,{source_type:e.source_type,evidence_id:e.evidence_id});
  }
  return {catalog_version:catalog?.version||null,products,claims,team:{...team,stock:'unknown'},dealers:verifiedDealers,evidence:approved,external_discovery:'OFF'};
}
function images({catalog,ids=[],publicUrl}) {
  if(!publicUrl)return [];
  return [...new Set(ids)].flatMap(id=>{
    const p=catalog?.products.get(id);
    if(!p?.open)return [];
    return p.images.map(file=>({type:'image',originalContentUrl:publicUrl+'/img/p/'+file,previewImageUrl:publicUrl+'/img/p/'+file}));
  });
}
module.exports={verifiedTools,images,calculationClaims};
