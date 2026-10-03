'use strict';
const assert=require('assert'),{guardUnreleasedProducts,UNAVAILABLE}=require('../unreleased_guard');
const snapshot=require('./fixtures/company-snapshot.json');
for(const name of ['คริซ่า','คริซ่า (ไม่มีรูป)']) assert.equal(guardUnreleasedProducts('แนะนำ '+name,snapshot.master),UNAVAILABLE);
assert.equal(guardUnreleasedProducts('ชื่อสินค้า',[]),UNAVAILABLE);
console.log('PASS: canonical closed status and unavailable catalog fail closed');
