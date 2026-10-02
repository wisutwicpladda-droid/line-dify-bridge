# Regression QA สำหรับน้องลัดดา

regression_cases.json เป็นชุดเคสถาวร 31 เคสตามแผน p88 รวมเคส p86 เดิม, response-budget ของ p87, Product Assistant First และ character feel cases

ตรวจ contract ของ prompt, DSL และ bridge:

    node tests/regression_check.js "C:\Users\artwi\OneDrive\Documents\ChatGPT\น้องลัดดา"

ตรวจ contract ของ p87 ที่เพิ่มกติกาคำตอบสั้น:

    node tests/regression_check_p87.js "C:\Users\artwi\OneDrive\Documents\ChatGPT\น้องลัดดา"

ตรวจ contract ของ p88 ที่ปรับ persona และ routing ให้ Product Assistant First:

    node tests/regression_check_p88.js "C:\Users\artwi\OneDrive\Documents\ChatGPT\น้องลัดดา"

QA สดหลัง import/publish DSL:
1. รันทั้ง 31 คำถามใน Dify Preview และบันทึกคำตอบจริง
2. รันเคส 2, 4, 6, 7, 8, 10, 12, 13 และ 14 ผ่าน LINE Bridge
3. ตรวจว่าเคสถามอัตราเท่านั้นที่มีตัวเลขอัตรา
4. ตรวจว่าเคสใช้เว็บมีข้อมูลรองรับภายในระบบ แต่คำตอบลูกค้าไม่แสดงแหล่งอ้างอิง URL หรือ citation และข้อมูลบริษัทไม่ถูกแทนด้วยเว็บ
5. ตรวจว่าไม่มีชื่อสินค้า สูตร อัตรา เบอร์ หรือสถานะขายที่แต่งขึ้น
