'use strict';
// Customer statements only. Model hypotheses are never promoted to confirmed facts.
const FIELDS=['crop','crop_stage','plant_age','symptoms','affected_part','distribution','onset','water_condition','root_color','root_smell','recent_spray','recent_fertilizer','known_pest','known_disease','previous_product','previous_active','location','customer_question'];
const QUESTIONS={
 crop:'เป็นพืชอะไรคะ',plant_age:'ตอนนี้พืชอายุเท่าไรหรืออยู่ระยะไหนคะ',
 affected_part:'เริ่มมีอาการที่ส่วนไหนของต้นคะ',distribution:'เป็นบางต้นหรือกระจายทั่วแปลงคะ',
 onset:'เริ่มมีอาการเมื่อไรคะ',water_condition:'ตอนนี้ยังมีน้ำขังอยู่หรือน้ำลดแล้วคะ',
 root_color:'รากเปลี่ยนเป็นสีอะไรคะ',root_smell:'รากมีกลิ่นผิดปกติไหมคะ',
 recent_spray:'ก่อนเกิดอาการเพิ่งพ่นสารอะไร ผสมอะไร และใช้เท่าไรคะ',recent_fertilizer:'ช่วงนี้ใส่ปุ๋ยอะไรไปบ้างคะ'
};
function updateFacts(text,ctx,previous={}) {
 const old=previous.facts, reset=!!(old?.values?.crop&&ctx.crop&&old.values.crop.value!==ctx.crop)||/เริ่มเคสใหม่|คนละแปลง|อีกแปลง/.test(text);
 const state=reset||!old?{version:1,turn:0,values:{},conflicts:{},questions_already_asked:[],questions_answered:[]}:JSON.parse(JSON.stringify(old));
 state.turn++;state.version=1;
 const found={customer_question:text};
 if(ctx.crop&&(text.includes(ctx.crop)||!state.values.crop))found.crop=ctx.crop;
 if(ctx.stage&&(/ดอก|ก่อนปลูก|เตรียมดิน/.test(text)||!state.values.crop_stage))found.crop_stage=ctx.stage;
 if(ctx.age_days!=null&&(/\d+\s*(วัน|เดือน)/.test(text)||!state.values.plant_age))found.plant_age={days:ctx.age_days,unit:'วัน'};
 const symptoms=[...text.matchAll(/ใบเหลือง|เหี่ยว|รากดำ|รากเน่า|โคนเน่า|ใบไหม้|ใบมีจุด|ยอดหงิก|ปลายใบแห้ง/g)].map(m=>m[0]);
 if(symptoms.length)found.symptoms=[...new Set([...(state.values.symptoms?.value||[]),...symptoms])];
 if(/ราก/.test(text))found.affected_part='ราก';else if(/ใบ/.test(text))found.affected_part='ใบ';else if(/โคน/.test(text))found.affected_part='โคนต้น';
 if(/ทั่ว(?:ทั้ง)?แปลง|ทุกต้น/.test(text))found.distribution='ทั่วแปลง';else if(/บางต้น|บางจุด|เป็นหย่อม/.test(text))found.distribution='บางต้น/เป็นหย่อม';
 const onset=text.match(/(?:เพิ่งเป็น|เริ่มเป็น|น้ำขัง|เกิดอาการ|เป็นมา)[^\n]{0,12}?\d+\s*(?:วัน|สัปดาห์)/);
 if(onset)found.onset=onset[0];else if(/เมื่อวาน|วันนี้|สองวันก่อน/.test(text))found.onset=text.match(/เมื่อวาน|วันนี้|สองวันก่อน/)[0];
 if(/น้ำลดแล้ว|น้ำแห้งแล้ว|ระบาย(?:น้ำ)?ออกแล้ว|ไม่มีน้ำขัง/.test(text))found.water_condition='น้ำลดแล้ว/ไม่มีน้ำขัง';
 else if(/ยัง(?:มี)?น้ำขัง|น้ำยังขัง/.test(text))found.water_condition='ยังมีน้ำขัง';
 else if(/น้ำขัง/.test(text)&&!state.values.water_condition)found.water_condition='มีประวัติน้ำขัง';
 const color=text.match(/ราก(?:เป็น|มี|สี|เป็นสี)?\s*(ดำ|ขาว|น้ำตาล|เหลือง)/);if(color)found.root_color=color[1];
 if(/ไม่มีกลิ่น|ไม่เหม็น/.test(text))found.root_smell='ไม่มีกลิ่นผิดปกติ';else if(/มีกลิ่น|รากเหม็น/.test(text))found.root_smell='มีกลิ่นผิดปกติ';
 if(/ไม่ได้(?:ฉีด|พ่น)|ยังไม่(?:ฉีด|พ่น)|ไม่มีการพ่น/.test(text))found.recent_spray='ไม่ได้พ่นสาร';
 else if(/พ่น|ฉีด/.test(text)&&/เมื่อวาน|ก่อนเกิด|เพิ่ง|หลังพ่น/.test(text))found.recent_spray=text;
 if(/ไม่ได้ใส่ปุ๋ย|ยังไม่ใส่ปุ๋ย/.test(text))found.recent_fertilizer='ยังไม่ได้ใส่ปุ๋ย';
 else if(/ใส่ปุ๋ย|ให้ปุ๋ย/.test(text))found.recent_fertilizer=text;
 if(ctx.target&&!ctx.diagnosis_uncertain)found[/โรค|เน่า|ไหม้/.test(ctx.target)?'known_disease':'known_pest']=ctx.target;
 if(ctx.explicit_product_ids?.length)found.previous_product=ctx.explicit_product_ids;
 if(ctx.explicit_actives?.length)found.previous_active=ctx.explicit_actives;
 const loc=text.match(/(?:จังหวัด|อำเภอ|ตำบล)\s*([^\s,\n]+)/);if(loc)found.location=loc[0];
 for(const [key,value]of Object.entries(found)) {
  const before=state.values[key];
  // Water receding is a progression, not a contradictory observation. Identity/age/root colour require clarification.
  if(before&&['plant_age','root_color','root_smell'].includes(key)&&JSON.stringify(before.value)!==JSON.stringify(value)&&!/แก้เป็น|แก้ไข|ตอนนี้|เปลี่ยนเป็น/.test(text)) {
   state.conflicts[key]={previous:before.value,incoming:value,turn:state.turn};continue;
  }
  state.values[key]={value,source:'customer',turn:state.turn,quote:text.slice(0,500)};delete state.conflicts[key];
  if(state.questions_already_asked.includes(key)&&!state.questions_answered.includes(key))state.questions_answered.push(key);
 }
 state.questions_already_asked=state.questions_already_asked.slice(-30);return state;
}
function unansweredQuestions(ctx,candidates) {
 const f=ctx.facts||{values:{},conflicts:{},questions_already_asked:[]},v=f.values;
 const conflicts=Object.keys(f.conflicts||{}).map(key=>({id:'confirm_'+key,field:key,text:'ขอยืนยัน'+({root_color:'สีราก',root_smell:'กลิ่นราก',plant_age:'อายุพืช'}[key]||key)+'อีกครั้งค่ะ ข้อมูลล่าสุดต่างจากที่แจ้งก่อนหน้านี้ ตอนนี้เป็นอย่างไรคะ'}));
 if(conflicts.length)return conflicts.slice(0,3);
 const needed=[];
 if(candidates?.missing_fields?.includes('crop_stage')&&!v.plant_age&&!v.crop_stage)needed.push('plant_age');
 if(ctx.diagnosis_uncertain){
  if(!ctx.crop)needed.push('crop');
  needed.push('affected_part','distribution','onset');
  if(/ราก|น้ำขัง/.test(JSON.stringify(v)))needed.push('water_condition','root_color','root_smell');
  needed.push('recent_spray','recent_fertilizer');
 }
 const missing=[...new Set(needed)].filter(k=>(!v[k]||(k==='water_condition'&&v[k].value==='มีประวัติน้ำขัง'))&&!f.questions_answered?.includes(k));
 const fresh=missing.filter(k=>!f.questions_already_asked?.includes(k));
 return (fresh.length?fresh:missing.slice(0,1)).slice(0,3).map(id=>({id,field:id,text:QUESTIONS[id]}));
}
function recordAsked(context,questions) {
 if(!context.facts)return context;
 context.facts.questions_already_asked=[...new Set([...context.facts.questions_already_asked,...questions.map(q=>q.field)])];return context;
}
module.exports={FIELDS,QUESTIONS,updateFacts,unansweredQuestions,recordAsked};
