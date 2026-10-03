'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildCatalog}=require('../sales/catalog');
const {run}=require('../sales/pipeline');
const catalog=buildCatalog(require('./fixtures/company-snapshot.json'),require('../product_images/index.json'));
const generate=async({prepared_context})=>({answer_plan:JSON.parse(prepared_context).answer_plan_default});
test('closed-product turn must not block a subsequent self-contained weed question',async()=>{
 const closed=await run('คริซ่ามีขายหรือยัง',{catalog,generate});
 const next=await run('ข้าว 10 วัน มีหญ้าข้าวนก ใช้อะไรดี',{catalog,generate,previous:closed.context});
 assert.equal(next.metrics.route,'structured');assert.equal(next.metrics.block,false);
 assert.ok(next.response.primary_product_id);assert.ok(!next.response.answer_text.includes('คริซ่า'));
});
test('summary-dependent package followup replaces the previous symptom context',async()=>{
 const symptom=await run('ทุเรียนใบเหลืองและเหี่ยว',{catalog,generate});
 const ownership={state:'BOT_ACTIVE',version:8,summary:'ลูกค้าถามขนาดบรรจุของ "นาแดน-จี" ยังไม่ทราบพืชและพื้นที่ ไม่ได้ขออัตราใช้'};
 const reply=await run('แล้วตัวนั้นขนาดเท่าไร',{catalog,generate,previous:symptom.context,ownership});
 assert.equal(reply.response.intent,'package');assert.match(reply.response.answer_text,/นาแดน-จี.*15.*กิโลกรัม/);
 assert.equal(reply.context.facts.values.previous_product.source,'admin_summary');
 assert.equal(reply.metrics.block,false);
 const next=await run('ข้าว 10 วัน มีหญ้าข้าวนก ใช้อะไรดี',{catalog,generate,previous:reply.context,ownership});
 assert.equal(next.context.crop,'ข้าว');assert.equal(next.context.age_days,10);
 assert.equal(next.context.facts.values.crop.source,'customer');
});
test('summary product cannot bypass closed status or supply an invented package value',async()=>{
 const reply=await run('แล้วตัวนั้นขนาดเท่าไร',{catalog,generate,ownership:{summary:'ลูกค้าถามคริซ่า ขนาด 99 กิโลกรัม'}});
 assert.ok(!/คริซ่า|99/.test(reply.response.answer_text));
 const real=await run('แล้วตัวนั้นขนาดเท่าไร',{catalog,generate,ownership:{summary:'ลูกค้าถามนาแดน-จี แอดมินพิมพ์ขนาดผิดว่า 99 กิโลกรัม'}});
 assert.match(real.response.answer_text,/15/);assert.ok(!real.response.answer_text.includes('99'));
});
