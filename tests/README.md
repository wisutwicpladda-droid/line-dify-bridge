# เทสของ line-dify-bridge

รันทุกตัวก่อน merge เข้า main เพราะ Railway deploy ทันทีที่ merge

    npm test

ผ่านครบจะขึ้น "N/N passed" ถ้ามีตัวไหนตกจะแสดงบรรทัดท้ายของตัวนั้น เทสทั้งหมดรันในเครื่องกับ LINE, Dify และ Knowledge จำลอง ไม่ต้องใช้ key จริง ไม่ส่งข้อความถึงใคร ใช้เวลาประมาณ 15 วินาที รันทีละไฟล์ได้ด้วย node tests/<ไฟล์>

| ไฟล์ | ตรวจอะไร |
|---|---|
| turn_flow_check.js | เปิด server.js จริงกับ LINE และ Dify จำลอง: ข้อความที่ส่งติดกันได้คำตอบเดียว ตอบทีละคำถาม รูปพร้อมคำบรรยายถึง Dify เป็นคำถามเดียว สตรีมหลุดแล้วยังได้คำตอบ ขอทีมขาย ปุ่มทีมขายเมื่อไม่มีคำแนะนำ และจุด "กำลังพิมพ์" ต่อเวลาระหว่างรอจนส่งคำตอบ |
| dify_stream_check.js | อ่านสตรีมจาก Dify และรายงานสตรีมที่ขาดหรือล้ม |
| kb_index_check.js | สร้างดัชนี dify_icpladda_index จากชีท และสลับเอกสารใน Knowledge โดยเก็บตัวเก่าไว้จนตัวใหม่พร้อม |
| kb_health_check.js | แจ้ง LINE เมื่อเครดิต OpenAI หมด เมื่อเอกสารใน Knowledge ค้าง Error หรือซิงก์จากชีทล้ม 3 รอบติด และแจ้งเมื่อกลับมาปกติ |
| admin_guard_check.js | ล็อก IP ที่ใส่รหัสแอดมินผิดหลายครั้ง ทั้งแบบหน่วยและเปิด server.js จริง |
| kb_status_check.js | เอกสารสินค้าใน Knowledge มีเฉพาะสินค้าที่เปิดขาย |
| product_validation_check.js | ตรวจความครบของข้อมูลสินค้าในชีท |
| sheet_context_check.js | ข้อมูลระยะพืชและสินค้าที่แนบไปกับคำถาม |
| unreleased_guard_check.js | ซ่อนสินค้าที่ยังไม่เปิดขาย |
| rate_guard_check.js | ตัดอัตราใช้ที่ลูกค้าไม่ได้ถาม และเก็บไว้เมื่อถาม |
| response_compactor_check.js | ย่อคำตอบทั่วไป แต่ไม่ย่อเมื่อลูกค้าขอรายละเอียด |
| citation_visibility_check.js | ไม่ให้แหล่งอ้างอิงหลุดถึงลูกค้า |
| team_ask_check.js | คำขอทีมขายตอบจากตารางทีมขาย |
| crm_province_input_check.js | ส่งจังหวัดจากโปรไฟล์ CRM ให้ Dify |
| image_buttons_persist_check.js | ปุ่มขอรูปสินค้าอยู่ครบและหมดอายุเมื่อถามเรื่องใหม่ |
| sales_leads_check.js | การ์ดลูกค้าสนใจซื้อสำหรับทีมขาย |
| turn_queue_check.js | คิวข้อความรายแชท |

เพิ่มเทสใหม่ได้โดยตั้งชื่อไฟล์ลงท้าย _check.js แล้ว npm test จะรันให้เอง

คำตอบของบอทจาก Dify มีชุดทดสอบแยก อยู่ที่ regression_tests ในโฟลเดอร์งานน้องลัดดา (ต้องใช้ API key ของแอปทดสอบ) ใช้ก่อน Publish ใน Dify

27 ต.ค. 2569 ลบเทสที่ตรวจ prompt และ DSL รุ่น p86–p88 ได้แก่ image_support_check, line_qa_check, regression_check, regression_check_p87, regression_check_p88 และไฟล์เคส line_qa_cases.json, regression_cases.json เพราะไฟล์ prompt และ DSL ที่เทสเหล่านี้อ่านไม่อยู่ใน repo และแอป Dify เปลี่ยนเป็นเวอร์ชันใหม่แล้ว เส้นทางรูปภาพยังตรวจอยู่ใน turn_flow_check ดูไฟล์เดิมได้จาก git history
