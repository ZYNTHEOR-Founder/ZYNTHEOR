# ZYNTHEOR Execution Dashboard

ไฟล์: `public/dashboard.html` (ไฟล์เดียว ไม่มี build step)

## เปิดใช้
- dev:  `npm run dev` แล้วเปิด `http://localhost:<PORT>/dashboard.html`
- prod: `npm run build` (Vite คัดลอก public/ ไป dist/) แล้วรันเซิร์ฟเวอร์ตามปกติ
- โหมด `ZYNTHEOR_API_ONLY=1` เซิร์ฟเวอร์ไม่เสิร์ฟไฟล์ static — ให้โฮสต์ไฟล์นี้ที่อื่น
  แล้วใส่ API Base URL ในหน้าเชื่อมต่อ (ต้องเปิด CORS ที่เซิร์ฟเวอร์)

## API ที่ใช้
/api/health, /api/auth/login|session, /api/agent/execute|queue|queue/run-next|tasks|cycles|metrics|deliverables/:file,
/api/agent/tasks/:id/resume, /api/workspace/files|file

## ก่อนเปิดให้ลูกค้า
`POST /api/auth/login` ออก token ให้ทุกบทบาทโดยไม่ต้องยืนยันตัวตน — ต้องป้องกันก่อนใช้งานจริง
