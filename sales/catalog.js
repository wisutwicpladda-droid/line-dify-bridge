'use strict';
const crypto=require('crypto');
const {identities,normalize}=require('../product_identity');
const overrides=require('./company_overrides.json');
const STRATEGY={expand:1,skyrocket:2,sky:2,natural:3,'cosmic-star':4,cosmicstar:4,cosmic:4,standard:5};
const clean=v=>String(v||'').trim();
const useful=v=>!!clean(v)&&! /^(none|n\/a|-|ไม่มี)$/i.test(clean(v));
function table(rows) {
  const headers=(rows[0]||[]).map(h=>clean(h).split(/\s/)[0]);
  return rows.slice(1).filter(r=>r[0]).map((r,i)=>Object.fromEntries([...headers.filter(Boolean).map(h=>[h,clean(r[headers.indexOf(h)])]),['_row',i+2]]));
}
function buildCatalog(snapshot, imageIndex={}, aliases={}) {
  const knownAliases={};
  for(const [name,id] of Object.entries(overrides.aliases)) (knownAliases[id] ||= []).push(name);
  for(const [id,names] of Object.entries(aliases)) knownAliases[id]=[...(knownAliases[id]||[]),...names];
  const index=identities(snapshot.master,knownAliases), products=new Map(), issues=[];
  for(const row of table(snapshot.master)) {
    const id=index.byId.get(row.product_id); if(!id) throw new Error('missing_identity');
    const p={...row,...id,rank:STRATEGY[clean(row.strategy).toLowerCase()]||99,usage:[],packages:[],images:[],issues:[]};
    if(!p.active_ingredient || !p.common_name_th) p.issues.push('missing_formula');
    if(p.rank===99) p.issues.push('missing_strategy');
    products.set(p.product_id,p);
  }
  for(const row of table(snapshot.usage)) {
    const p=products.get(row.product_id); if(!p) throw new Error('usage_orphan');
    // A broadcast row has no carrier water; the explicit area coverage is its basis.
    const areaBasis=Number(row.rate_basis_value)===0 && /หว่าน/.test(row.how_to_use) &&
      Number(row.coverage_area_value)>0 && row.coverage_area_unit==='ไร่';
    const normalized=areaBasis?{...row,rate_basis_value:row.coverage_area_value,rate_basis_unit:'ไร่'}:row;
    p.usage.push({...normalized,ref:row.usage_id,rate_verified:validRate(normalized),
      basis_source:areaBasis?'company_coverage_area':'company_rate_basis'});
  }
  for(const row of table(snapshot.packages)) {
    const p=products.get(row.product_id); if(!p) throw new Error('package_orphan');p.packages.push(row);
  }
  for(const [name,file]of Object.entries(imageIndex)) {
    const p=index.resolve(name);if(p) products.get(p.product_id).images.push(file);
    else issues.push({kind:'unmapped_image',name});
  }
  for(const p of products.values()) {
    p.images=[...new Set(p.images)];
    if(!p.usage.length)p.issues.push('missing_usage');
    if(!p.images.length)p.issues.push('missing_image');
    if(!p.status_selling)p.issues.push('unknown_status');
    if(p.usage.some(u=>!u.rate_verified))p.issues.push('incomplete_rate');
    if(p.usage.some(u=>!u.crop_stage))p.issues.push('missing_stage');
    issues.push(...p.issues.map(kind=>({product_id:p.product_id,kind})));
  }
  const hash=crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return {version:hash,loaded_at:Date.now(),index,products,issues};
}
function validRate(u) {
  return !!u.rate_min && !!u.rate_max && Number.isFinite(Number(u.rate_min)) && Number.isFinite(Number(u.rate_max)) &&
    Number(u.rate_min)>0 && Number(u.rate_max)>=Number(u.rate_min) && !!u.rate_unit &&
    Number(u.rate_basis_value)>0 && !!u.rate_basis_unit;
}
function companyFacts(p,{rates=false}={}) {
  const out={product_id:p.product_id,name:p.canonical_name,formula:p.common_name_th,active_ingredient:p.active_ingredient,
    moa:p.moa_group,selling_point:p.selling_point,precautions:p.additional_precautions,
    packages:p.packages.map(k=>({id:k.package_id,type:k.package_type,value:k.package_size_value,unit:k.package_size_unit})),
    usage:p.usage.map(u=>({ref:u.ref,crop:u.crop_name||u.crop_group,target:u.target_name,stage:u.crop_stage,equipment:u.application_equipment}))};
  if(rates)out.rates=p.usage.filter(u=>u.rate_verified);
  return out;
}
class CatalogStore {
  constructor({maxAgeMs=7200000}={}) {this.current=null;this.maxAgeMs=maxAgeMs;this.last_error=null;}
  promote(snapshot,images,aliases) {
    try {const next=buildCatalog(snapshot,images,aliases);if(!next.products.size)throw new Error('empty_catalog');this.current=next;this.last_error=null;return next;}
    catch(e){this.last_error=e.message;throw e;}
  }
  get(now=Date.now()) {return this.current&&now-this.current.loaded_at<=this.maxAgeMs?this.current:null;}
}
module.exports={buildCatalog,table,validRate,companyFacts,CatalogStore,STRATEGY,useful,normalize};
