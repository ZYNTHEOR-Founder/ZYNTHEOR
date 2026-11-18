# ZYNTHEOR — Product UI Redesign Report

วันที่: 14 พฤศจิกายน 2026  
Source ตั้งต้น: `automatic-memory (1).zip`  
SHA-256 ของไฟล์ตั้งต้น: `82f7aabcfd318a59adc00cf58044f5854faa8af69d840f3de7e14d6e6bbe39a7`

## สิ่งที่ปรับปรุง

1. **Application shell และพื้นที่ใช้งาน**
   - แก้ระยะเว้นด้านซ้ายที่ซ้ำกับความกว้าง Sidebar ซึ่งทำให้พื้นที่เนื้อหาถูกดันและเกิดช่องว่างขนาดใหญ่
   - ปรับ Context Rail ให้เริ่มต้นแบบยุบ ลดสิ่งรบกวนบนหน้าจอ
   - คงการจัดวาง Sidebar, Header และพื้นที่ทำงานให้รองรับ Desktop/Mobile

2. **Customer Overview**
   - ปรับหน้าแรกเป็น Overview สำหรับผลิตภัณฑ์ Autonomous Intelligence & Execution
   - เพิ่มเส้นทางเข้าหน้า Autonomous Execution โดยตรง และ Quick Task
   - แสดงตัวเลขจาก System Status เท่านั้น; ไม่มีค่า fallback ที่ทำให้ดูเหมือนมีงานสำเร็จหรือโมเดลโหลดอยู่ทั้งที่ไม่มีข้อมูล

3. **Autonomous Execution Dashboard**
   - เพิ่มหน้าใน Navigation และเชื่อม Component กับ API ที่มีอยู่ใน Source: execute, queue, run-next, tasks, metrics, cycles, workspace และ deliverables
   - แก้การแสดง Metrics ให้ตรงกับโครงสร้างข้อมูล Execution Metrics ของ Backend
   - แก้การอ่าน Package Artifact ให้รองรับผลลัพธ์ที่อยู่ใต้ `executionCycle.packageArtifact`
   - จำกัดการโหลด Workspace ตาม Role ที่ Endpoint รองรับ
   - คงการแสดง Error/ผลลัพธ์ตามที่ API ส่งกลับ ไม่เติมสถานะสำเร็จจำลอง

4. **ลดป้ายและความรกของ UI**
   - ลด StatusBadge ให้เป็นข้อความสถานะเรียบ ไม่ใช้ป้ายแคปซูลซ้ำซ้อน
   - ปรับตัวกรอง Success/Warning/Error ใน Execution Log เป็นข้อความกดได้ แทนแคปซูลสีหลายชั้น
   - ลดป้าย Priority, Cluster, Task ID และ Duration ใน Log/Result/History
   - ลดป้ายใน Research Evidence และหัวหน้า Conversational Intelligence โดยคงข้อความความหมายไว้

5. **ข้อมูล Native Model และ Telemetry**
   - แยก Target Architecture 41,527,808 parameters เป็น Roadmap Specification ไม่แสดงว่าเป็นน้ำหนักโมเดลที่ Active
   - ปรับ Intelligence Core ให้แสดง Parameter Count, Architecture, Checkpoint Integrity และ Weight Availability จากข้อมูล Runtime
   - ลบค่า SHA-256, Model Size, Tensor Count และ Parameter Count สำรองที่ถูกกำหนดตายตัวในหน้า Model Laboratory
   - แก้ Inference result ให้ใช้ field ที่ Backend ส่งจริง เช่น `response`, `outputTokens`, `latency_ms`, `tokens_per_sec`, `totalParams` และ `checkpointHash`
   - ปรับ Hardware Monitor ให้แสดงเฉพาะ CPU/Process/Host Memory ที่ API รายงาน ไม่แสดงงบ RAM 512 MB หรือป้าย BOUNDED OK ที่ไม่ได้ยืนยันจาก Runtime
   - Resource Monitor ไม่แสดงค่า 0 หรือสถานะ Standby แทนข้อมูล Telemetry ที่ยังไม่ได้รับ

## การตรวจสอบ

- ZIP ต้นฉบับ: ผ่านการตรวจโครงสร้าง ZIP ก่อนแก้ไข
- TypeScript/TSX syntax pass: ตรวจไฟล์ Source 57 ไฟล์ด้วย TypeScript `transpileModule`; พบ Syntax Diagnostics = 0
- API route consistency: ตรวจพบเส้นทางหลักของ Autonomous Execution ทั้ง 8 กลุ่มใน `server.ts`
- **Build/Lint/Automated tests: NOT VERIFIED** — การติดตั้ง Dependencies (`npm ci`) ใช้เวลาเกินขีดจำกัดของสภาพแวดล้อมและหยุดก่อนติดตั้ง Vite/React สำเร็จ; ทดลอง `npm run build` แล้วพบ `vite: not found` และ `npm run lint` แล้วพบว่า TypeScript definition `vite/client` ไม่มี จึงยังสรุปว่า Build/Type-check ผ่านไม่ได้
- Runtime / End-to-end: **NOT VERIFIED** — ไม่ได้มี Backend Runtime ที่กำลังทำงานให้ยิงทดสอบจริงในสภาพแวดล้อมนี้

## ข้อจำกัดที่ต้องทราบ

- Source นี้มี API routes ที่หน้า Autonomous Execution เรียกใช้ แต่การตรวจเส้นทางจาก Source ไม่ใช่หลักฐานว่า API ทำงานครบใน Deployment จริง
- Environment ตรวจงานใช้ Node.js `v22.16.0`; Firebase packages ใน Lockfile แจ้งข้อกำหนด Node.js `>=24.12.0`
- ไฟล์ต้นฉบับที่ผู้ใช้อัปโหลดไม่ได้ถูกเขียนทับ การเปลี่ยนแปลงทั้งหมดอยู่ในชุดส่งมอบใหม่นี้

## ไฟล์ที่แก้ไข

- `src/App.tsx`
- `src/components/HardwareMonitor.tsx`
- `src/components/Header.tsx`
- `src/components/MobileNav.tsx`
- `src/components/ModelBenchmarking.tsx`
- `src/components/ResourceMonitor.tsx`
- `src/components/Sidebar.tsx`
- `src/components/modules/AutonomousExecutionDashboard.tsx`
- `src/components/modules/CommandCenter.tsx`
- `src/components/modules/ConversationalIntelligence.tsx`
- `src/components/modules/IntelligenceCore.tsx`
- `src/components/modules/ModelLaboratory.tsx`
- `src/components/modules/ResearchLab.tsx`
- `src/components/ui/StatusBadge.tsx`
- `src/context/LanguageContext.tsx`
- `src/index.css`
- `src/types.ts`

รวม 17 ไฟล์ที่แก้ไข ไม่มีการลบไฟล์ Source เดิม

## Security hardening — follow-up pass (14 พ.ย. 2026)

จากการตรวจ Backend เพิ่มเติมพบว่า Execution Orchestrator เก็บ Task/Queue/Cycle/Deliverable ใน shared process-wide store โดย `PersistentTaskRecord` ยังไม่มี `tenantId` หรือ `ownerUserId` และ API เดิมอนุญาต role `guest` ให้เรียกดู/เปลี่ยนข้อมูลชุดเดียวกันได้ จึงมีความเสี่ยง cross-tenant data exposure และ task interference

การแก้ไขในรอบนี้:
- ยกระดับ `/api/agent/execute`, `/api/agent/metrics`, `/api/agent/cycles`, `/api/agent/tasks`, `/api/agent/queue`, `/api/agent/queue/run-next`, `/api/agent/tasks/:taskId/resume` และ `/api/agent/deliverables/:filename` เป็น Developer-only ชั่วคราวจนกว่าจะมี tenant-scoped persistence และ ownership enforcement
- ปิด `/api/auth/login` ที่ให้ client เลือก role เองใน Production และปิดเป็นค่าเริ่มต้นทุก environment; เปิดได้เฉพาะ non-production เมื่อกำหนด `ZYNTHEOR_ENABLE_DEV_LOGIN=true`

ข้อจำกัด/งานค้าง:
- Customer task execution ถูกจำกัดชั่วคราว ไม่ควรเปิด customer beta จนกว่าจะเพิ่ม owner/tenant ลงใน task schema, filter list/get/resume/queue/run-next และตรวจสิทธิ์ไฟล์ deliverable ทุกครั้ง
- ต้องย้ายการ bootstrap identity ไปใช้ Firebase/Identity Provider ที่ตรวจ credential จริง; development login ไม่ใช่ระบบยืนยันตัวตนลูกค้า
- Build และ runtime E2E ยัง NOT VERIFIED ตามข้อจำกัด environment ที่ระบุไว้ก่อนหน้า

### Security regression evidence

- Added `tests/security-hardening-static.test.mjs` and `npm run test:security-static`.
- Result: **8/8 PASS** — production role-selectable login gate, explicit development opt-in, developer-only shared execution routes, and disabled-by-default environment template.
- Python source syntax compilation: **PASS** for `qplus_native/*.py` and `tests/*.py`.
- These are source/static checks only; they do not replace live HTTP authorization tests or a production deployment review.

### Explicit identity-provider sign-in

- Removed automatic privileged Administrator token bootstrap from `AuthContext`.
- Added a sign-in gate in the application shell with an explicit Google identity-provider action backed by the existing Firebase session exchange endpoint.
- No role selector is exposed on the sign-in screen; server-issued claims remain authoritative.
- Static regression checks now **10/10 PASS**.
- TypeScript transpile syntax checks: `server.ts`, `src/App.tsx`, `src/context/AuthContext.tsx` — **0 syntax diagnostics** each.
- Firebase project/provider configuration and real sign-in were not exercised in this environment; identity-provider login remains **NOT VERIFIED** until tested with the deployed Firebase project.
