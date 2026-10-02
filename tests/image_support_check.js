'use strict';

const fs = require('fs');
const path = require('path');

const bridge = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const dsl = fs.readFileSync(path.join(root, 'dify', 'app_b_hybrid_p88.yml'), 'utf8');
const prompt = fs.readFileSync(path.join(root, 'work', 'main_prompt_p88.txt'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(bridge.includes("ev.message.type === 'image'"), 'Bridge ยังไม่รับ event รูปภาพจาก LINE');
assert(bridge.includes('requestBuffer'), 'Bridge ยังไม่มีการดาวน์โหลดไฟล์ภาพแบบไบนารี');
assert(bridge.includes('uploadLineImageToDify'), 'Bridge ยังไม่อัปโหลดรูปเข้า Dify');
assert(bridge.includes('payload.files = files'), 'Bridge ยังไม่ส่ง files เข้า Dify chat-messages');
assert(bridge.includes('transfer_method: \'local_file\''), 'Bridge ยังไม่ใช้ไฟล์ที่อัปโหลดกับ Dify');
assert(/file_upload:\s+enabled:\s+true/.test(dsl), 'Dify ยังไม่เปิด file upload');
assert(/file_upload:[\s\S]*?image:\s+enabled:\s+true/.test(dsl), 'Dify ยังไม่เปิด image input');
assert((dsl.match(/vision:\s+enabled:\s+true/g) || []).length >= 2, 'LLM ที่ใช้กับภาพยังเปิด vision ไม่ครบ');
assert(prompt.includes('การอ่านภาพจากลูกค้า'), 'Prompt ยังไม่มีกติกาอ่านภาพ');
assert(prompt.includes('ห้ามเดาชื่อโรค แมลง วัชพืช สินค้า สูตร หรืออัตราจากภาพที่ไม่ชัด'), 'Prompt ยังไม่กันการเดาจากภาพ');
assert(prompt.includes('ถามข้อมูลเป็นข้อความเพิ่มเพียง 1 ข้อ'), 'Prompt ยังไม่กำหนด fallback เมื่อภาพไม่พอ');

console.log('PASS: image input contract, LINE binary download, Dify upload and vision rules verified');
