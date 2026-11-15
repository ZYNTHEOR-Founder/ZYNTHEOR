# ZYNTHEOR — Visual Identity Refresh (Ink & Saffron)

## สิ่งที่เปลี่ยน
- ชุดสีใหม่ทั้งระบบ: พื้นหมึกครามเข้ม + สัญญาณฟ้าคราม (periwinkle) + ไฮไลต์หญ้าฝรั่น (saffron); โหมดสว่างเป็น "Paper"
- ฟอนต์: IBM Plex Sans Thai (UI ไทย/อังกฤษ) และ IBM Plex Mono (ตัวเลข/ข้อมูล)
- ยกเลิกนีออน, ไล่เฉดสี, เงาเรืองแสง, ตัวพิมพ์ใหญ่เว้นระยะ
- สีฮาร์ดโค้ดกว่า 2,000 จุดใน `src/**/*.tsx` ถูกโยงเข้ากับตัวแปรธีม: `--app-*`, `--z-ok`, `--z-warn`, `--z-danger`
- ธีม 6 แบบ (ชื่อภายในเดิม เพื่อไม่ให้ค่าที่ผู้ใช้บันทึกไว้เสีย): Ink Indigo, Paper, Graphite, Teal Signal, Saffron Dark, System
- มุมโค้งลดลง (การ์ด 14px, ปุ่ม 10px)

## ไฟล์หลักที่แก้
`index.html`, `src/index.css`, `src/components/ui/tokens.ts`, `Button.tsx`, `Typography.tsx`, `VividCard.tsx`, `ThemeSwitcher.tsx`, `Sidebar.tsx` และคอมโพเนนต์ใน `src/components/**`

## ยังไม่ได้ตรวจ
ตรวจไวยากรณ์ TypeScript ผ่านทุกไฟล์ แต่ยังไม่ได้ `npm run build` หรือดูหน้าจอจริง (สภาพแวดล้อมไม่มีเน็ตสำหรับติดตั้งแพ็กเกจ) ควรรัน `npm install && npm run dev` แล้วไล่ดูแต่ละโมดูล

## รอบที่ 2
- แปลงคลาสพาเลตต์ Tailwind (slate/emerald/cyan/indigo/amber/rose ฯลฯ ~1,100 จุด), `text-white` บนพื้นผิว, และสี rgba/hex ในสไตล์อินไลน์ ให้ใช้ตัวแปรธีม เพื่อให้โหมดสว่างอ่านออกและสีไม่ตีกัน
- เมนูข้าง: รายการที่เลือกใช้พื้นอ่อน + แถบสีซ้าย แทนพื้นทึบ, ตัดลูกศร, เพิ่ม `--app-sidebar`
- ยังไม่ได้ build/ดูหน้าจอจริง
