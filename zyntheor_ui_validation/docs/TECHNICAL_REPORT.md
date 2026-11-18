# ZYNTHEOR Candidate Remediation — Technical Report

**ตรวจเมื่อ:** 2026-11-16 (UTC+7)  
**ขอบเขต:** ทำงานบน extracted working copy ที่ `/home/ubuntu/zyntheor_remediation/source/` เท่านั้น  
**Training run:** ไม่ได้เริ่ม  
**Candidate inference:** ไม่ได้รัน

## สรุปสถานะ

| Priority | สถานะ | หลักฐาน / ข้อจำกัด |
|---|---|---|
| Dataset Governance | **IMPLEMENTED / BLOCKED สำหรับข้อมูลจริง** | มี schema, provenance/evidence hash verifier, HMAC trust-root, exact/near-duplicate split audit และ fail-closed gate ใน trainer; แต่ยังไม่มี manifest/evidence/approval key ที่ใช้กับ corpus จริง จึงห้ามฝึก |
| Intelligence Benchmark | **IMPLEMENTED / BLOCKED สำหรับผลประเมิน** | มี test-only task framework ครบ 7 domains, exact/hash/leakage gate และ rubric mode ที่ไม่ให้คะแนนอัตโนมัติ; template ยังว่าง ไม่มี licensed/approved test set จึงไม่มี baseline/score |
| Checkpoint Resume Integrity | **IMPLEMENTED / PARTIAL** | immutable bundle เก็บ weights แบบ dtype เดิม, AdamW moments/step, scheduler, PCG64 RNG, global step, corpus/config hashes; round-trip restore tests ผ่าน 2 ชุด; ยังไม่ได้เริ่ม optimizer update ต่อจาก bundle จึงยังไม่มี trajectory-equivalence test |
| Candidate 502,912 parameters | **PARTIAL** | raw-byte audit ผ่าน structural integrity; candidate ระบุ 502,912 parameters แยกจาก target 41,527,808; runtime compatibility เป็น `PARTIAL_STRUCTURAL_SUPPORT`; ไม่ได้โหลด candidate เข้า runtime/รัน inference และไม่ได้วัดคุณภาพ |
| Training Readiness | **BLOCKED** | ต้องมี provenance manifest ที่ตรง corpus, evidence files ทุกชนิด, HMAC key จากผู้อนุมัติที่เชื่อถือได้ และ split train/validation/test ครบก่อน trainer จะยอมเริ่ม |

## สิ่งที่เปลี่ยนใน source

1. `qplus_native/dataset_governance.py` เพิ่ม document/evidence SHA-256 validation, HTTPS/source/license/rights fields, trusted approval requirement และ exact/near-duplicate scan ข้าม split (`validate_document`: L78; `audit_splits`: L168; `validate_manifest`: L211) โดยไม่ยกระดับสถานะเมื่อไม่มี trusted verifier.
2. `qplus_native/trusted_approvals.py` ตรวจ HMAC-SHA256 จาก external JSON trust key ซึ่งต้องเป็น regular file โหมด `0600` หรือเข้มกว่า และผูก signature กับ document id/hash, split, source, license, rights และ evidence hashes (`approval_payload`: L16; `load_hmac_verifier`: L43). โค้ดนี้ตรวจ signature เท่านั้น ไม่ยืนยันสิทธิ์ทางกฎหมายของผู้ถือ key; การออก/ควบคุม key เป็นงานภายนอก.
3. `qplus_native/training_readiness.py` ใช้ fail-closed gate ตรวจ provenance เทียบกับ frozen document text และ split จริง (`validate_training_readiness`: L13).
4. `qplus_native/train_lm.py` บังคับ provenance/approval/test split ก่อนทำ training, กันเขียนทับ checkpoint/resume bundle, แยก `--init` แบบ weights-only ออกจาก `--resume-state` แบบ exact-state, ตรวจ scheduler/config/corpus hashes และไม่ tokenize test documents (gate/output: L88–L116; restore/scheduler: L129–L157).
5. `qplus_native/train_gated.py` ใช้ gate เดียวกัน, ตรวจ manifest/split consistency, ปฏิเสธ output ที่มีอยู่ และคง metadata `optimizer_state_restored: false` สำหรับ `--init` แบบ warm-start (L112–L137, L200–L201). **Trainer นี้ยังเป็น warm-start เท่านั้น**; exact resume อยู่ใน `train_lm.py`.
6. `qplus_native/training_state.py` เพิ่ม immutable resume bundle โดยไม่ใช้ pickle; เก็บ exact model arrays พร้อม dtype, optimizer arrays/state, scheduler, RNG, step และ hashes; loader ตรวจ member list, hash, shape, dtype, finite values, tokenizer/config/corpus consistency และ step synchronization (`save_resume_bundle`: L35; `load_resume_bundle`: L128).
7. `qplus_native/benchmark_framework.py` และ schemas กำหนด test-only tasks 7 domains, hash/provenance checks, near-duplicate scan เทียบ reference training/validation text, paired report hash gates และ `human_rubric` ที่อยู่ในสถานะ unscored จนกว่าจะมี review (`validate_benchmark_manifest`: L29; `score_responses`: L119; `compare_reports`: L153).
8. `qplus_native/candidate_audit.py` ตรวจ checkpoint จาก raw bytes โดยไม่โหลดหรือรัน model (`inspect_checkpoint`: L29). เพิ่ม CLI สำหรับ audit แบบอ่านอย่างเดียว.

## Candidate audit — ผลที่วัดได้จริง

อ่าน checkpoint ที่ `native_data/model_checkpoint_v2_candidate.pt` ใน extracted copy แบบ raw bytes เท่านั้น:

- `integrity_status`: `STRUCTURAL_CHECKS_PASS` — payload SHA-256, tensor hashes, tensor names/shapes/counts และ finite float32 values ตรงกับ metadata/graph ที่ auditor คาดไว้.
- `runtime_compatibility`: `PARTIAL_STRUCTURAL_SUPPORT` — storage mode และ architecture ตรงกับโครงสร้างที่ runtime รู้จัก แต่ยังไม่ได้เรียก runtime loader หรือ forward pass; จึงไม่ใช่ผลยืนยัน compatibility.
- `quality_status`: `NOT_EVALUATED`; `inference_executed`: `false`.
- Raw checkpoint metadata ระบุ `total_params=502,912`, `target_total_params=41,527,808`, `training_steps_total=1,800`, `validation_loss=3.1719096076`, `validation_perplexity=23.8529907457`, corpus hash `c3a71c…47313d`. ค่า step/loss/perplexity เป็น **metadata claims จาก checkpoint** ไม่ได้ตรวจยืนยันจาก training logs หรือ benchmark run อิสระ จึงไม่ถือเป็นผลประเมิน.
- Candidate มี config `vocab=532, d_model=128, n_layers=2, n_heads=4, d_ffn=384, ctx=64` และ tokenizer fingerprint `fb6922…331d6` ตาม metadata.

## Tests และ checks ที่รัน

คำสั่ง: `python3 -m unittest discover -s tests -p 'test_candidate_remediation.py' -v`  
ผล: **12 tests passed**.

ขอบเขต tests: governance/hash/exact+near-duplicate leakage fail-closed, HMAC binding, empty benchmark blocking, scorer behavior, resume bundle exact array/state round-trip, refusal เมื่อ corpus/config hash drift, และ candidate raw-byte integrity. Resume test สร้าง state fixture โดยตั้งค่า arrays โดยตรง; **ไม่มี `optimizer.step`, ไม่มี training loop และไม่มี model inference**. ดังนั้นยังไม่ได้พิสูจน์ trajectory equivalence หลัง update จริง.

เพิ่มเติม: AST ของ Python files ผ่าน; JSON files parse ได้; help-only ของ `train_lm.py` และ `train_gated.py` แสดง CLI ได้โดยไม่เริ่มฝึก. JSON Schema ถูก parse และตรวจ draft/template structure แต่ไม่มี `jsonschema` package ติดตั้ง จึงยังไม่ได้รัน full JSON-Schema validation.

## สิ่งที่ยัง BLOCKED

- ไม่มี dataset provenance manifest ที่ลงนามและเทียบกับเอกสารใน corpus จริง; ไม่มี source/license/rights/approval evidence ที่ตรวจสิทธิ์ได้ครบ.
- ไม่มี external trusted approval key. ไม่มีการสร้าง signature หรือหลักฐานอนุมัติแทนมนุษย์.
- Benchmark manifest มีเพียง blank template; ไม่มีชุดข้อสอบภาษาไทย/อังกฤษ/คณิตศาสตร์/วิทยาศาสตร์/Coding/reasoning/planning/self-correction ที่ผ่าน license review และ test-set contamination check.
- จึงไม่มี baseline evaluation จริง, before/after comparison หรือ capability claim.
- Runtime load/inference compatibility ของ candidate ยังไม่ทดสอบ. การยืนยันต้องรอข้อมูลและการอนุมัติที่เกี่ยวข้อง; ไม่ได้ทำในรอบนี้.
- `train_gated.py` ยังคงไม่ restore AdamW state เมื่อใช้ `--init`; metadata จะระบุ `optimizer_state_restored=false`. ใช้ exact-state path ใน `train_lm.py` เท่านั้น และยังต้องทดสอบการดำเนินต่อจริงภายหลังเมื่อได้รับอนุมัติ.

## การรักษาไฟล์ต้นฉบับ

การเปลี่ยนแปลงทั้งหมดอยู่ใน extracted working copy; ไม่แก้ Source ZIP หรือ Candidate ZIP ที่แนบ และไม่เขียนทับ Candidate checkpoint. SHA-256 ที่ตรวจหลังการทดสอบ:

- Source ZIP `ZYNTHEOR-VIVID-INTELLIGENCE-FINAL-2026-11-15.zip`: `fcaebd25daf23d8e4502d28c2979f6dff1b063958e30fc0edd49a79b40e980f5`
- Candidate ZIP `ZYNTHEOR-VIVID-INTELLIGENCE-TRAINED-CANDIDATE-2026-11-15.zip`: `646b4990617f4d10f28a8f4f2fae3012be6d7360709ae4d4dffe98ab57860716`
- Extracted candidate checkpoint: `cccbf386c5861a00633cc08612d330b063c568e9dadb7189ba429878b44c810c`

ไม่มี training, benchmark inference, dataset creation หรือ license evidence fabrication ในงานนี้. ไม่ควรเริ่ม training จนกว่าจะเติม evidence จริง ได้รับ human approval และตรวจ gate ผ่านครบ.
