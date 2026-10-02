# Regression QA สำหรับน้องลัดดา

regression_cases.json เป็นชุดเคสถาวร 10 เคสตามแผน p77

ตรวจ contract ของ prompt, DSL และ bridge:

    node tests/regression_check.js "C:\Users\artwi\OneDrive\Documents\ChatGPT\น้องลัดดา"

QA สดหลัง import/publish DSL:
1. รันทั้ง 10 คำถามใน Dify Preview และบันทึกคำตอบจริง
2. รันเคส 2, 6, 7, 8 และ 10 ผ่าน LINE Bridge
3. ตรวจว่าเคสถามอัตราเท่านั้นที่มีตัวเลขอัตรา
4. ตรวจว่าเคสใช้เว็บมีแหล่งอ้างอิงจริง และข้อมูลบริษัทไม่ถูกแทนด้วยเว็บ
5. ตรวจว่าไม่มีชื่อสินค้า สูตร อัตรา เบอร์ หรือสถานะขายที่แต่งขึ้น
