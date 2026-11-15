# ZYNTHEOR Candidate Remediation Package

แพ็กนี้ประกอบด้วย source files ที่เพิ่ม/แก้, schemas/templates, non-training tests, raw candidate audit summary, test log และ technical report. รวมไฟล์เข้ากับ repository โดยรักษา relative paths ภายใน `source_changes/`.

## ตรวจสอบ

```bash
sha256sum -c SHA256SUMS.txt
python3 -m unittest discover -s tests -p 'test_candidate_remediation.py' -v
```

หมายเหตุ: ใน ZIP จะวาง tests ไว้ที่ `source_changes/tests/`; รันหลังรวมไฟล์เข้ากับ repository root ตามคำสั่งด้านบน.

ตรวจ candidate แบบ raw bytes (ไม่โหลด model):

```bash
python3 qplus_native/candidate_audit.py native_data/model_checkpoint_v2_candidate.pt
```

`train_lm.py` และ `train_gated.py` มี fail-closed governance gate. ห้ามเริ่ม training จนกว่าจะมี provenance manifest จากข้อมูลจริง, evidence ที่ hash ตรง, external trusted approval key ที่ออกโดยผู้มีอำนาจ และผล split/leakage audit ผ่าน. ไม่มี approval key หรือ dataset evidence แนบมาในแพ็กนี้.

`--init` เป็น weights-only warm start ไม่ใช่ exact resume. Exact resume bundle support อยู่ใน `qplus_native/train_lm.py`; exact training continuation ยังไม่ได้รัน/ทดสอบ trajectory ในรอบนี้. `train_gated.py` ระบุ `optimizer_state_restored=false` สำหรับ warm-start.

ดูสถานะและข้อจำกัดทั้งหมดใน [TECHNICAL_REPORT.md](TECHNICAL_REPORT.md).