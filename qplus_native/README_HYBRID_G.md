# ZYNTHEOR HYBRID (ก) — วางแพตช์ยังไง

ป้าย: HYBRID / EXTERNAL-BRAIN — ไม่ใช่ Native (ข) ยังแยกอยู่

## ไฟล์ในแพตช์นี้ (วางเพิ่มอย่างเดียว ห้ามทับของเดิม)
- qplus_native/hybrid_brain.py  <- ไฟล์ hybrid_brain.py
- qplus_native/stage_bench.py   <- ไฟล์ stage_bench.py
- qplus_native/test_hybrid.py   <- ไฟล์ test_hybrid.py (รันในเครื่องก่อน push)

## รันทดสอบก่อนวาง
python3 qplus_native/test_hybrid.py
# ต้องได้: ALL 5 HYBRID TESTS PASSED (FIXTURE — not real brain)
# อันนี้พิสูจน์ logic adapter/bench ไม่ใช่พิสูจน์สมองจริง

## ต่อสมองจริง (ออนไลน์เท่านั้น)
# ในโค้ดที่เรียกใช้ ห้าม hardcode key:
#   import os
#   from qplus_native.hybrid_brain import HybridBrain
#   from qplus_native.brain import make_http_complete  # ถ้ามีในไฟล์ตัวเต็ม brain.py
#   complete = make_http_complete(provider=os.environ["ZYNTHEOR_BRAIN_PROVIDER"], api_key=os.environ["ZYNTHEOR_BRAIN_API_KEY"])
#   brain = HybridBrain(complete, planner, orchestrator, repair, sandbox)
# ถ้าไม่มี key / offline -> HybridBrain ต้อง raise BrainError ทันที ห้าม fallback Template

## วัดแยกขั้นของจริง
# from qplus_native.stage_bench import run_bench
# out = run_bench(brain)
# ดู out["tasks"][i] แยก understand/plan/build/test/repair/deliver + delivered/hidden_ok/false_success
# ห้ามรวมเป็น 100/100

## ข้อจำกัดที่ต้องเช็กก่อน merge
- แพตช์นี้อ้างอิง API ที่เห็นจริงแค่ brain.py 1-81 + agent_bench.py 1-72 เท่านั้น
- ยังไม่เห็นไฟล์ตัวเต็ม planner.py / orchestrator.py / repair.py / safe_exec.py
- จึงใช้ DI (ฉีด planner/orchestrator/repair/sandbox เข้าทาง constructor) ไม่ import ตรง
- ก่อน merge ให้เทียบชื่อฟังก์ชัน: validate_plan, plan_project, package_deliverable, Sandbox.run_tests, SelfRepairEngine.repair กับไฟล์ตัวเต็ม
- ถ้าชื่อไม่ตรง ให้แก้เฉพาะจุดฉีด ไม่ต้องแก้ logic ใน hybrid_brain.py
