# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 20 — Sovereign Release Candidate & Honest Gate H Audit
Audits Batches 17-24 artifacts plus local/cloud runtime prerequisites (Gate H).
Strictly enforces Zero-Simulation Policy: marks overall release status BLOCKED when
checkpoint .pt weights, Cloud Object Storage env vars, or DATABASE_URL are not provisioned.
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_json_if_exists(rel: str) -> Dict[str, Any]:
    p = ROOT / rel
    if not p.exists():
        return {"available": False, "path": rel}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        data["available"] = True
        return data
    except Exception as exc:
        return {"available": False, "path": rel, "error": str(exc)}


def main() -> None:
    os.makedirs(ROOT / "native_data", exist_ok=True)
    b21 = _load_json_if_exists("native_data/batch21_24_integrity_audit.json")
    b21_corr = _load_json_if_exists("native_data/batch21_24_corrected_results.json")
    b17 = _load_json_if_exists("native_data/batch17_cognitive_reliability_report.json")
    b18 = _load_json_if_exists("native_data/batch18_generalization_adaptation_report.json")
    b19 = _load_json_if_exists("native_data/batch19_autonomous_evolution_report.json")
    lm_eval = _load_json_if_exists("artifacts/lm-v2-eval.json")

    seq_ckpt = ROOT / "native_data" / "model_checkpoint_seq_pure.pt"
    v2_ckpt = ROOT / "native_data" / "model_checkpoint_v2.pt"
    has_cloud_url = bool(os.environ.get("ZYNTHEOR_CLOUD_CHECKPOINT_URL") or os.environ.get("ZYNTHEOR_S3_BUCKET"))
    has_database_url = bool(os.environ.get("DATABASE_URL") or os.environ.get("CLOUD_SQL_CONNECTION_NAME"))

    checks = {
        "local_seq_pure_checkpoint": {
            "path": "native_data/model_checkpoint_seq_pure.pt",
            "present": seq_ckpt.exists(),
        },
        "local_lm_v2_checkpoint": {
            "path": "native_data/model_checkpoint_v2.pt",
            "present": v2_ckpt.exists(),
        },
        "cloud_checkpoint_storage_env": {
            "configured": has_cloud_url,
            "env_vars_checked": ["ZYNTHEOR_CLOUD_CHECKPOINT_URL", "ZYNTHEOR_S3_BUCKET"],
        },
        "relational_database_env": {
            "configured": has_database_url,
            "env_vars_checked": ["DATABASE_URL", "CLOUD_SQL_CONNECTION_NAME"],
        },
    }

    gate_a_pass = bool(b21.get("available") and b21.get("overall_integrity_passed"))
    gate_b_pass = bool(b21.get("available") and b21.get("numerical_gradient_verification", {}).get("passed"))
    gate_c_pass = bool(b17.get("available") and b17.get("calibration") and b17.get("separation_neural_vs_memory"))
    gate_d_pass = bool(b18.get("available") and len(b18.get("domains_evaluated", [])) == 7)
    gate_e_pass = bool(b19.get("available") and b19.get("rollback_integrity_verified"))
    gate_f_pass = bool(lm_eval.get("available"))
    gate_g_pass = (ROOT / "lib" / "ConnectivityMonitor.ts").exists()
    gate_h_pass = seq_ckpt.exists() and (has_cloud_url or v2_ckpt.exists()) and has_database_url

    blockers: List[str] = []
    if not seq_ckpt.exists():
        blockers.append("Missing native_data/model_checkpoint_seq_pure.pt (unprovisioned binary model weights).")
    if not has_cloud_url:
        blockers.append("Cloud checkpoint object storage env vars (ZYNTHEOR_CLOUD_CHECKPOINT_URL / ZYNTHEOR_S3_BUCKET) not configured.")
    if not has_database_url:
        blockers.append("DATABASE_URL / CLOUD_SQL_CONNECTION_NAME not configured for persistent PostgreSQL runtime.")

    gates = {
        "Gate_A_Zero_Sim_Source_Integrity": "PASS" if gate_a_pass else "BLOCKED",
        "Gate_B_Analytical_Gradient_Proof": "PASS" if gate_b_pass else "BLOCKED",
        "Gate_C_Calibration_and_Isolated_Memory": "PASS" if gate_c_pass else "BLOCKED",
        "Gate_D_Seven_Domain_Generalization": "PASS" if gate_d_pass else "BLOCKED",
        "Gate_E_Bounded_Evolution_Rollback": "PASS" if gate_e_pass else "BLOCKED",
        "Gate_F_Bilingual_LM_Artifact_Audit": "PASS" if gate_f_pass else "BLOCKED",
        "Gate_G_Online_Fail_Closed_Architecture": "PASS" if gate_g_pass else "BLOCKED",
        "Gate_H_Production_Infrastructure_Readiness": "PASS" if gate_h_pass else "BLOCKED",
    }

    release_status = "READY" if all(v == "PASS" for v in gates.values()) else "BLOCKED"

    manifest = {
        "schema": "ZYNTHEOR_RELEASE_MANIFEST_V1",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "release_status": release_status,
        "zero_simulation_policy": "ENFORCED",
        "gates": gates,
        "checks": checks,
        "blockers": blockers,
        "evidence_files": {
            "batch17": "native_data/batch17_cognitive_reliability_report.json",
            "batch18": "native_data/batch18_generalization_adaptation_report.json",
            "batch19": "native_data/batch19_autonomous_evolution_report.json",
            "batch21_24_audit": "native_data/batch21_24_integrity_audit.json",
            "batch21_24_results": "native_data/batch21_24_corrected_results.json",
            "champion_record": "native_data/cognitive_champion.json",
        },
        "champion_snapshot": b19.get("final_champion", {}),
    }

    report = {
        "batch": "BATCH_20_SOVEREIGN_RELEASE_CANDIDATE",
        "generated_at": manifest["generated_at"],
        "release_status": release_status,
        "gates": gates,
        "checks": checks,
        "blockers": blockers,
        "honest_capabilities_summary": {
            "batch17_neural_acc": b17.get("separation_neural_vs_memory", {}).get("neural_only_accuracy", {}),
            "batch18_id_acc": b18.get("overall", {}).get("native_id_accuracy", {}),
            "batch18_ood_acc": b18.get("overall", {}).get("native_ood_accuracy", {}),
            "batch19_rollback_verified": b19.get("rollback_integrity_verified"),
            "batch21_24_integrity_passed": b21.get("overall_integrity_passed"),
        },
    }

    (ROOT / "native_data" / "ZYNTHEOR_RELEASE_MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (ROOT / "native_data" / "batch20_sovereign_release_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    md = [
        "# ZYNTHEOR Batch 20 — Sovereign Release Candidate Audit",
        "",
        f"- **Generated At:** {manifest['generated_at']}",
        f"- **Release Status:** `{release_status}`",
        "",
        "## Release Gate Audit",
        "| Gate | Status |",
        "|---|---|",
        *[f"| `{k}` | `{v}` |" for k, v in gates.items()],
        "",
        "## Exact Gate H Blockers (Zero Simulation Enforcement)",
        *([f"- **BLOCKED:** {b}" for b in blockers] if blockers else ["- None. All infrastructure prerequisites satisfied."]),
        "",
    ]
    (ROOT / "native_data" / "batch20_sovereign_release_report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps({"release_status": release_status, "gates": gates, "blockers": blockers}, indent=2))


if __name__ == "__main__":
    main()
