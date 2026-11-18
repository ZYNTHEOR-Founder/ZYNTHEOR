#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ZYNTHEOR Native Training Dataset Preparation (Read-Only Source Audit -> Clean Splits).

Prepares traceable, non-overlapping, leakage-audited JSONL splits from existing
first-party repository assets and existing datasets without fabricating data,
without starting or resuming training, without altering the 5,800-step plan or
checkpoints, and without deleting or overwriting any original dataset files.

Outputs written:
  - native_data/datasets/train.jsonl
  - native_data/datasets/validation.jsonl
  - native_data/datasets/test.jsonl
  - artifacts/dataset-provenance-manifest.json
  - artifacts/dataset-provenance-evidence/{README.md,source/,license/,rights/,approval/}
  - artifacts/dataset-quality-report.json
  - artifacts/dataset-sha256.txt
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import sys
import unicodedata
import zlib
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.dataset_governance import (  # noqa: E402
    SCHEMA_VERSION as PROVENANCE_SCHEMA_VERSION,
    _char_shingles,
    audit_splits,
    canonical_json,
    content_sha256,
    sha256_bytes,
    validate_manifest,
)
from qplus_native.execution_corpus import EXECUTION_SEEDS  # noqa: E402
from qplus_native.train_target import load_frozen_documents  # noqa: E402

# Contamination, secret, PII, and control-character filters (aligned with corpus_ingest.py)
SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|secret|passw(?:or)?d|token|bearer)\w*\s*[:=]\s*['\"][A-Za-z0-9_\-+/=]{16,}['\"]"
)
PRIVATE_KEY_RE = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?KEY-----")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b\u200c\u200d\ufeff]")
RBAC_PROBE_RE = re.compile(r"(?i)(?:TenantA\s+Secret|cross-tenant\s+isolation\s+probe)")
SYNTHETIC_MARKER_RE = re.compile(r"(?i)\b(?:SYNTHETIC_ORIGIN|Synthetic\s+machine\s+generated\s+data)\b")

REQUIRED_DOMAINS: Tuple[str, ...] = (
    "Thai Language",
    "English Language",
    "Thai-English Mixed Language",
    "Reasoning and Problem Solving",
    "Mathematics",
    "Science",
    "Research and Analysis",
    "Programming and Software Engineering",
    "Planning and Multi-step Execution",
    "Error Detection and Correction",
    "Context Understanding",
)

# First-party repository file patterns (strictly excluding backups, archives, fixtures, binaries)
FIRST_PARTY_PATTERNS: Tuple[Tuple[str, str], ...] = (
    ("README.md", "doc"),
    ("docs/*.md", "doc"),
    ("docs/reports/*.md", "doc"),
    ("qplus_native/*.py", "code"),
    ("lib/*.ts", "code"),
    ("server.ts", "code"),
    ("server/*.ts", "code"),
    ("scripts/*.py", "code"),
)

# Pre-locked files excluded as exact duplicates or superseded by atomic seed extraction
EXCLUDED_PATHS_WITH_REASON: Dict[str, str] = {
    "qplus_native/execution_corpus.py": "SUPERSEDED_BY_INDIVIDUAL_EXECUTION_SEEDS",
    "scripts/prepare_native_datasets.py": "SELF_PREPARATION_SCRIPT_EXCLUDED",
}

DATASET_ID = "zyntheor-native-41m-prepared-candidate-v1"
NEAR_DUPLICATE_CLUSTER_THRESHOLD = 0.85
GOVERNANCE_THRESHOLD = 0.90
MIN_DOC_CHARS = 40
MAX_DOC_CHARS = 120_000


def normalize_text(raw: str) -> str:
    text = unicodedata.normalize("NFC", raw)
    text = CTRL_RE.sub("", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def count_thai_chars(text: str) -> int:
    return sum(1 for ch in text if "\u0e00" <= ch <= "\u0e7f")


def count_ascii_letters(text: str) -> int:
    return sum(1 for ch in text if ("a" <= ch <= "z") or ("A" <= ch <= "Z"))


def detect_language(text: str, declared: Optional[str] = None) -> str:
    th = count_thai_chars(text)
    en = count_ascii_letters(text)
    ratio = th / max(1, th + en)
    if th >= 20 and ratio >= 0.65:
        return "th"
    if th >= 20 and 0.05 <= ratio < 0.65:
        return "th-en"
    if declared in {"th", "th-en"} and th >= 15:
        return declared if ratio < 0.65 else "th"
    if th >= 10 and en < 10:
        return "th"
    return "en"


def classify_domains(doc_id: str, kind: str, language: str, text: str) -> Tuple[str, List[str]]:
    """Classify a verified first-party record deterministically into required domains.

    Honesty guard: Never labels generic TypeScript/Python files as `Science` primary
    corpus when no dedicated primary science corpus exists.
    """
    low_id = doc_id.lower()
    low_head = text[:2000].lower()
    matched: List[str] = []

    if language == "th":
        matched.append("Thai Language")
    elif language == "th-en":
        matched.append("Thai-English Mixed Language")
    elif kind == "doc":
        matched.append("English Language")

    # Domain signal heuristics bound to actual ZYNTHEOR source roles
    if any(k in low_id for k in ("planner", "orchestrator", "taskorchestrator", "toolgateway", "toolregistry", "execution", "goal_plan", "eight_stage", "sandbox", "smoke-train", "smoke-val", "smoke-test")):
        matched.append("Planning and Multi-step Execution")

    if any(k in low_id for k in ("architecture", "lm_v2", "verify_checkpoint", "verify_target", "math", "matrix_multiplier")):
        matched.append("Mathematics")
    elif kind == "code" and re.search(r"(?:gaussian|adamw|perplexity|cross[-_ ]entropy|rmsnorm|swiglu|rope)", low_head):
        matched.append("Mathematics")

    if any(k in low_id for k in ("reasoning", "cognitive_core", "batch28_reasoning", "batch10", "batch11", "batch12", "batch13", "batch17", "batch18", "batch19", "batch6", "batch7", "batch8", "batch9", "hybrid_brain", "external_brain")):
        matched.append("Reasoning and Problem Solving")

    if any(k in low_id for k in ("knowledge", "research", "internetintegration", "eval_", "benchmark", "evaluate_target", "report", "audit", "phase_curriculum", "domain_benchmark")):
        matched.append("Research and Analysis")

    if any(k in low_id for k in ("repair", "integrity", "governance", "admission", "readiness", "candidate_audit", "security", "fail_closed", "approval", "truth", "revocation", "ratelimit")):
        matched.append("Error Detection and Correction")

    if any(k in low_id for k in ("context", "memory", "tokenizer", "bilingual", "cognitive_probe", "compare_models", "train_bilingual")):
        matched.append("Context Understanding")

    if kind in {"code", "execution_seed"} or low_id.endswith((".py", ".ts")):
        matched.append("Programming and Software Engineering")

    if not matched:
        matched.append("English Language" if kind == "doc" else "Programming and Software Engineering")

    # Deduplicate preserving order
    ordered: List[str] = []
    for d in matched:
        if d in REQUIRED_DOMAINS and d not in ordered:
            ordered.append(d)

    # Choose concise primary domain
    primary = ordered[0]
    return primary, ordered


def scan_safety_issues(text: str, extra_flags: Sequence[str] = (), is_synthetic: bool = False) -> List[str]:
    issues: List[str] = []
    if not text or len(text) < MIN_DOC_CHARS:
        issues.append("too_short_below_min_chars")
    if len(text) > MAX_DOC_CHARS:
        issues.append("exceeds_max_chars")
    if "\ufffd" in text:
        replacement_ratio = text.count("\ufffd") / max(1, len(text))
        if replacement_ratio > 0.0:
            issues.append("contains_unicode_replacement_char")
    if is_synthetic or "SYNTHETIC_ORIGIN" in extra_flags:
        issues.append("SYNTHETIC_ORIGIN")
    if SYNTHETIC_MARKER_RE.search(text):
        issues.append("synthetic_marker_in_text")
    if RBAC_PROBE_RE.search(text):
        issues.append("RBAC_ISOLATION_PROBE")
    if SECRET_RE.search(text):
        issues.append("secret_like_literal")
    if PRIVATE_KEY_RE.search(text):
        issues.append("private_key_material")
    if EMAIL_RE.search(text):
        issues.append("contains_email_pii")
    return issues


def jaccard_sim(a: Set[str], b: Set[str]) -> float:
    if not a or not b:
        return 0.0
    la, lb = len(a), len(b)
    if la < lb:
        small, large = a, b
    else:
        small, large = b, a
    if (len(small) / max(1, len(large))) < NEAR_DUPLICATE_CLUSTER_THRESHOLD:
        return 0.0
    inter = len(small & large)
    union = la + lb - inter
    return inter / max(1, union)


def deterministic_split(cluster_key: str) -> str:
    """70% train / 15% validation / 15% test deterministic bucket on cluster key."""
    bucket = zlib.crc32(cluster_key.encode("utf-8")) % 100
    if bucket < 15:
        return "test"
    if bucket < 30:
        return "validation"
    return "train"


def write_evidence_bundle(
    evidence_root: Path,
    manifest_summary: Mapping[str, Any],
    repo_source_paths: Sequence[str],
) -> Dict[str, Dict[str, str]]:
    """Write factual, non-fabricated local governance evidence artifacts.

    Never generates fake approval signatures, fake key_ids, or fake https URLs.
    """
    evidence_root.mkdir(parents=True, exist_ok=True)
    for sub in ("source", "license", "rights", "approval"):
        (evidence_root / sub).mkdir(parents=True, exist_ok=True)

    readme_text = (
        "# Dataset Provenance Evidence Bundle (Prepared Candidate — Pending Admin Review)\n\n"
        "This bundle records factual repository provenance and governance state for the prepared\n"
        f"`{DATASET_ID}` splits under `native_data/datasets/{{train,validation,test}}.jsonl`.\n\n"
        "## Governance State\n"
        "- **Human Approval:** `PENDING_ADMIN_REVIEW` (external `0600` HMAC key not configured; no auto-approval signed).\n"
        "- **Training Status:** NOT STARTED (Preparation only).\n"
        "- **External HTTPS Origin / Third-Party Clearance:** Not applicable / pending for repository-derived files; "
        "no external `https://` source URL or external dataset snapshot was fabricated.\n"
        "- **Primary Science Corpus:** Blocked / not present (`0` dedicated primary Science documents in workspace).\n"
    )
    (evidence_root / "README.md").write_text(readme_text, encoding="utf-8")

    src_file = evidence_root / "source" / "first-party-repo-inventory.json"
    src_payload = {
        "schema": "zyntheor.evidence.source.v1",
        "dataset_id": DATASET_ID,
        "origin_type": "first_party_workspace_repository_and_local_datasets",
        "external_https_snapshot_url": None,
        "record_count": manifest_summary["total_accepted"],
        "split_counts": manifest_summary["split_counts"],
        "source_paths": sorted(set(repo_source_paths)),
    }
    src_file.write_text(json.dumps(src_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    lic_file = evidence_root / "license" / "license-notice.md"
    lic_text = (
        "# ZYNTHEOR First-Party Repository License Notice\n\n"
        "- Repository `README.md` declares: `AGPL-3.0 License`.\n"
        "- Root `package.json` declares: `\"private\": true` (no SPDX `license` field; no standalone `LICENSE` file in root).\n"
        "- `native_data/knowledge/documents.json` entries declare `curatedForTraining: false`.\n"
        "- `docs/reports/NATIVE-LM-V2-TRAINING-REPORT-2026-11-15.md` explicitly records that no separate "
        "third-party license clearance was performed for every source file.\n"
        "- **Governance conclusion:** License clearance for automated model weight redistribution remains `PENDING_ADMIN_REVIEW`.\n"
    )
    lic_file.write_text(lic_text, encoding="utf-8")

    rights_file = evidence_root / "rights" / "governance-rights-status.md"
    rights_text = (
        "# Rights & Training Scope Declaration (Fail-Closed)\n\n"
        "- Scope requested: `train`, `validation`, `test` preparation only (training NOT started).\n"
        "- Leakage isolation: `test.jsonl` strictly isolated from training and model selection.\n"
        "- External distribution or training on `5,800` steps requires explicit Admin approval and trusted `0600` HMAC signing.\n"
    )
    rights_file.write_text(rights_text, encoding="utf-8")

    app_file = evidence_root / "approval" / "approval-status.json"
    app_payload = {
        "schema": "zyntheor.evidence.approval.v1",
        "decision": "PENDING_ADMIN_REVIEW",
        "approved": False,
        "approver": None,
        "key_id": None,
        "signature": None,
        "note": "No trusted external 0600 HMAC key configured. Training MUST NOT start without explicit Admin approval.",
    }
    app_file.write_text(json.dumps(app_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return {
        "source": {
            "path": "source/first-party-repo-inventory.json",
            "sha256": sha256_bytes(src_file.read_bytes()),
        },
        "license": {
            "path": "license/license-notice.md",
            "sha256": sha256_bytes(lic_file.read_bytes()),
        },
        "rights": {
            "path": "rights/governance-rights-status.md",
            "sha256": sha256_bytes(rights_file.read_bytes()),
        },
        "approval": {
            "path": "approval/approval-status.json",
            "sha256": sha256_bytes(app_file.read_bytes()),
        },
    }


def prepare_datasets(root: Path = ROOT) -> Dict[str, Any]:
    candidates: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    seen_hashes: Dict[str, str] = {}

    def consider(
        doc_id: str,
        raw_text: str,
        source_path: str,
        kind: str,
        declared_language: Optional[str] = None,
        locked_split: Optional[str] = None,
        extra_flags: Sequence[str] = (),
        is_synthetic: bool = False,
        provenance_note: str = "",
    ) -> None:
        text = normalize_text(raw_text)
        safety_issues = scan_safety_issues(text, extra_flags=extra_flags, is_synthetic=is_synthetic)
        if safety_issues:
            rejected.append({
                "document_id": doc_id,
                "source": source_path,
                "reasons": safety_issues,
            })
            return
        digest = content_sha256(text)
        if digest in seen_hashes:
            rejected.append({
                "document_id": doc_id,
                "source": source_path,
                "reasons": [f"exact_duplicate_of:{seen_hashes[digest]}"],
                "sha256": digest,
            })
            return
        seen_hashes[digest] = doc_id
        lang = detect_language(text, declared=declared_language)
        primary_domain, all_domains = classify_domains(doc_id, kind, lang, text)
        candidates.append({
            "document_id": doc_id,
            "kind": kind,
            "source": source_path,
            "text": text,
            "sha256": digest,
            "chars": len(text),
            "thai_chars": count_thai_chars(text),
            "ascii_letters": count_ascii_letters(text),
            "language": lang,
            "domain": primary_domain,
            "domains": all_domains,
            "locked_split": locked_split,
            "provenance_note": provenance_note,
            "shingles": _char_shingles(text),
        })

    # ------------------------------------------------------------------
    # 1. Inspect existing JSON datasets & log contaminated / fragmented records
    # ------------------------------------------------------------------
    contaminated_files = [
        ("native_data/datasets/ds_1794922200466.json", "SYNTHETIC_ORIGIN_DATASET"),
        ("native_data/datasets/ds_1794922258067.json", "RBAC_PROBE_AND_DUPLICATE_CHUNKS"),
        ("native_data/datasets/ds_1794922200463.json", "CROSS_SPLIT_CHUNK_OVERLAP_SUPERSEDED_BY_WHOLE_DOCS"),
    ]
    for rel_ds, file_reason in contaminated_files:
        p = root / rel_ds
        if not p.is_file():
            continue
        payload = json.loads(p.read_text(encoding="utf-8"))
        for item in payload.get("items", []):
            item_id = f"{payload.get('manifest', {}).get('datasetId', rel_ds)}:{item.get('id')}"
            reasons = [file_reason]
            reasons.extend(scan_safety_issues(
                str(item.get("text", "")),
                extra_flags=item.get("flags") or (),
                is_synthetic=bool(item.get("isSynthetic")),
            ))
            rejected.append({
                "document_id": item_id,
                "source": rel_ds,
                "original_split": item.get("split"),
                "reasons": sorted(set(reasons)),
            })

    # ------------------------------------------------------------------
    # 2. Existing native_data/training_pipeline/datasets/verified_dataset.jsonl (preserve exact splits!)
    # ------------------------------------------------------------------
    vds_path = root / "native_data" / "training_pipeline" / "datasets" / "verified_dataset.jsonl"
    if vds_path.is_file():
        frozen_existing = load_frozen_documents(str(vds_path))
        for doc_id, rec in sorted(frozen_existing.items()):
            consider(
                doc_id=f"pipeline:{doc_id}",
                raw_text=rec["text"],
                source_path="native_data/training_pipeline/datasets/verified_dataset.jsonl",
                kind="pipeline_seed",
                locked_split=rec["split"],
                provenance_note="First-party ZYNTHEOR continuation/checkpointing dataset (locked original split)",
            )

    # Note ds_v_1794907544271.json duplicates exact same 8 samples -> log provenance trace
    dsv_path = root / "native_data" / "training_pipeline" / "datasets" / "ds_v_1794907544271.json"
    if dsv_path.is_file():
        dsv = json.loads(dsv_path.read_text(encoding="utf-8"))
        for sp_key in ("trainSamples", "valSamples", "testSamples"):
            for idx, sample_txt in enumerate(dsv.get(sp_key, [])):
                consider(
                    doc_id=f"ds_v_1794907544271:{sp_key}:{idx}",
                    raw_text=str(sample_txt),
                    source_path="native_data/training_pipeline/datasets/ds_v_1794907544271.json",
                    kind="pipeline_seed",
                    locked_split="validation" if sp_key == "valSamples" else ("test" if sp_key == "testSamples" else "train"),
                )

    # ------------------------------------------------------------------
    # 3. Clean non-RBAC whole documents from native_data/knowledge/documents.json
    #    Map: 7bj9c -> test (was eval in legacy), osjcn -> validation, gh0qn & 74j0t -> train
    # ------------------------------------------------------------------
    kd_path = root / "native_data" / "knowledge" / "documents.json"
    if kd_path.is_file():
        kdocs = json.loads(kd_path.read_text(encoding="utf-8"))
        knowledge_split_map = {
            "doc_1794904396215_7bj9c": "test",
            "doc_1794904396214_osjcn": "validation",
            "doc_1794904396212_gh0qn": "train",
            "doc_1794904396214_74j0t": "train",
        }
        for d in kdocs:
            did = str(d.get("id", "unknown"))
            is_rbac = str(d.get("collection", "")).upper() == "RBAC" or str(d.get("provenance", "")) == "rbac-test"
            if is_rbac:
                rejected.append({
                    "document_id": f"knowledge:{did}",
                    "source": "native_data/knowledge/documents.json",
                    "reasons": ["RBAC_ISOLATION_PROBE", "tenant_a_test_fixture"],
                })
                continue
            consider(
                doc_id=f"knowledge:{did}",
                raw_text=str(d.get("content", "")),
                source_path=f"native_data/knowledge/documents.json#{did}",
                kind="doc",
                declared_language=d.get("language"),
                locked_split=knowledge_split_map.get(did),
                provenance_note=f"{d.get('provenance', 'ZYNTHEOR knowledge')} (curatedForTraining={d.get('curatedForTraining')})",
            )

    # ------------------------------------------------------------------
    # 4. Authentic Execution Seeds (qplus_native/execution_corpus.py)
    # ------------------------------------------------------------------
    for seed in EXECUTION_SEEDS:
        sid = str(seed.get("id", "seed/unknown"))
        consider(
            doc_id=sid,
            raw_text=str(seed.get("text", "")),
            source_path=f"qplus_native/execution_corpus.py#{sid}",
            kind="execution_seed",
            provenance_note="First-party ZYNTHEOR non-chat autonomous execution seed",
        )

    # ------------------------------------------------------------------
    # 5. Clean First-Party Source & Technical Documentation
    # ------------------------------------------------------------------
    for pattern, kind in FIRST_PARTY_PATTERNS:
        for file_path in sorted(glob.glob(str(root / pattern))):
            p = Path(file_path)
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            if rel in EXCLUDED_PATHS_WITH_REASON:
                rejected.append({
                    "document_id": rel,
                    "source": rel,
                    "reasons": [EXCLUDED_PATHS_WITH_REASON[rel]],
                })
                continue
            raw_body = p.read_text(encoding="utf-8", errors="replace")
            consider(
                doc_id=rel,
                raw_text=raw_body,
                source_path=rel,
                kind=kind,
                provenance_note="First-party ZYNTHEOR source/documentation",
            )

    # ------------------------------------------------------------------
    # 6. Cluster near-duplicates BEFORE splitting so related docs never cross splits
    # ------------------------------------------------------------------
    n = len(candidates)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    near_duplicate_pairs_clustered: List[Dict[str, Any]] = []
    for i in range(n):
        sh_i = candidates[i]["shingles"]
        for j in range(i + 1, n):
            sim = jaccard_sim(sh_i, candidates[j]["shingles"])
            if sim >= NEAR_DUPLICATE_CLUSTER_THRESHOLD:
                union(i, j)
                near_duplicate_pairs_clustered.append({
                    "doc_a": candidates[i]["document_id"],
                    "doc_b": candidates[j]["document_id"],
                    "jaccard": round(sim, 6),
                })

    clusters: Dict[int, List[int]] = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)

    unlocked_by_stratum: Dict[Tuple[str, str], List[Tuple[int, str]]] = {}
    for root_idx, member_indices in clusters.items():
        locked_splits = {candidates[m]["locked_split"] for m in member_indices if candidates[m]["locked_split"]}
        if len(locked_splits) > 1:
            chosen_split = "train"
            for m in member_indices:
                candidates[m]["split"] = chosen_split
        elif len(locked_splits) == 1:
            chosen_split = next(iter(locked_splits))
            for m in member_indices:
                candidates[m]["split"] = chosen_split
        else:
            anchor = candidates[root_idx]
            stratum = (anchor["domain"], anchor["language"])
            sort_digest = hashlib.sha256(anchor["document_id"].encode("utf-8")).hexdigest()
            unlocked_by_stratum.setdefault(stratum, []).append((root_idx, sort_digest))

    for stratum, items in sorted(unlocked_by_stratum.items()):
        ordered_items = [r_idx for r_idx, _ in sorted(items, key=lambda x: (x[1], candidates[x[0]]["document_id"]))]
        total_u = len(ordered_items)
        if total_u == 1:
            splits_for_stratum = [deterministic_split(candidates[ordered_items[0]]["document_id"])]
        elif total_u == 2:
            splits_for_stratum = ["train", "test"]
        else:
            # Target ~70% train, ~15% validation, ~15% test with at least 1 validation and 1 test
            n_val = max(1, round(total_u * 0.15))
            n_test = max(1, round(total_u * 0.15))
            if n_val + n_test >= total_u:
                n_val, n_test = 1, 1
            n_train = total_u - n_val - n_test
            splits_for_stratum = (["train"] * n_train) + (["validation"] * n_val) + (["test"] * n_test)
        for r_idx, chosen_split in zip(ordered_items, splits_for_stratum):
            for m in clusters[r_idx]:
                candidates[m]["split"] = chosen_split

    # Sort deterministically by document_id inside each split
    split_records: Dict[str, List[Dict[str, Any]]] = {"train": [], "validation": [], "test": []}
    all_records_for_audit: List[Dict[str, Any]] = []
    texts_by_id: Dict[str, str] = {}

    license_label = "AGPL-3.0 (README.md declaration; third-party/redistributable clearance PENDING_ADMIN_REVIEW)"
    for c in sorted(candidates, key=lambda x: x["document_id"]):
        rec = {
            "document_id": c["document_id"],
            "split": c["split"],
            "domain": c["domain"],
            "domains": c["domains"],
            "language": c["language"],
            "source": c["source"],
            "license": license_label,
            "sha256": c["sha256"],
            "chars": c["chars"],
            "thai_chars": c["thai_chars"],
            "ascii_letters": c["ascii_letters"],
            "governance_status": "PENDING_ADMIN_APPROVAL",
            "text": c["text"],
        }
        split_records[c["split"]].append(rec)
        all_records_for_audit.append({"document_id": rec["document_id"], "split": rec["split"]})
        texts_by_id[rec["document_id"]] = rec["text"]

    # ------------------------------------------------------------------
    # 7. Authoritative leakage verification via qplus_native.dataset_governance.audit_splits
    # ------------------------------------------------------------------
    split_audit = audit_splits(all_records_for_audit, texts_by_id, near_duplicate_threshold=GOVERNANCE_THRESHOLD)
    if split_audit["status"] != "READY_FOR_REVIEW":
        raise RuntimeError(f"Prepared splits failed leakage audit: {json.dumps(split_audit, ensure_ascii=False)}")

    # ------------------------------------------------------------------
    # 8. Write split JSONL files (non-destructive: leaves all legacy .json & verified_dataset.jsonl intact)
    # ------------------------------------------------------------------
    datasets_dir = root / "native_data" / "datasets"
    datasets_dir.mkdir(parents=True, exist_ok=True)
    split_file_hashes: Dict[str, Dict[str, Any]] = {}
    for sp in ("train", "validation", "test"):
        out_path = datasets_dir / f"{sp}.jsonl"
        lines = [json.dumps(r, ensure_ascii=False) for r in split_records[sp]]
        out_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        # Independent round-trip validation with train_target.load_frozen_documents
        loaded = load_frozen_documents(str(out_path))
        if len(loaded) != len(split_records[sp]):
            raise RuntimeError(f"Loader round-trip count mismatch for {out_path}")
        if any(v["split"] != sp for v in loaded.values()):
            raise RuntimeError(f"Loader split isolation violation in {out_path}")
        split_file_hashes[f"native_data/datasets/{sp}.jsonl"] = {
            "records": len(split_records[sp]),
            "chars": sum(r["chars"] for r in split_records[sp]),
            "thai_chars": sum(r["thai_chars"] for r in split_records[sp]),
            "bytes": out_path.stat().st_size,
            "sha256": sha256_bytes(out_path.read_bytes()),
        }

    # ------------------------------------------------------------------
    # 9. Compute detailed statistics across splits, languages, and all 11 domains
    # ------------------------------------------------------------------
    split_counts = {sp: len(split_records[sp]) for sp in ("train", "validation", "test")}
    lang_counter: Dict[str, Dict[str, int]] = {}
    domain_counter: Dict[str, Dict[str, int]] = {
        d: {"primary_total": 0, "train": 0, "validation": 0, "test": 0, "tagged_occurrences": 0}
        for d in REQUIRED_DOMAINS
    }

    all_accepted = [r for sp in ("train", "validation", "test") for r in split_records[sp]]
    for r in all_accepted:
        sp = r["split"]
        lc = lang_counter.setdefault(r["language"], {"total": 0, "train": 0, "validation": 0, "test": 0, "chars": 0, "thai_chars": 0})
        lc["total"] += 1
        lc[sp] += 1
        lc["chars"] += r["chars"]
        lc["thai_chars"] += r["thai_chars"]

        dom = r["domain"]
        domain_counter[dom]["primary_total"] += 1
        domain_counter[dom][sp] += 1
        for td in r["domains"]:
            domain_counter[td]["tagged_occurrences"] += 1

    # ------------------------------------------------------------------
    # 10. Write artifacts/dataset-provenance-evidence & manifest (honest unapproved state)
    # ------------------------------------------------------------------
    artifacts_dir = root / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    evidence_root = artifacts_dir / "dataset-provenance-evidence"
    evidence_pins = write_evidence_bundle(
        evidence_root=evidence_root,
        manifest_summary={
            "total_accepted": len(all_accepted),
            "split_counts": split_counts,
        },
        repo_source_paths=[r["source"] for r in all_accepted],
    )

    manifest_docs = []
    for r in sorted(all_accepted, key=lambda x: x["document_id"]):
        manifest_docs.append({
            "document_id": r["document_id"],
            "document_sha256": r["sha256"],
            "split": r["split"],
            "domain": r["domain"],
            "language": r["language"],
            "source": {
                "url": None,
                "local_path": r["source"],
                "publisher": "ZYNTHEOR Workspace Repository",
            },
            "license": {
                "id": "AGPL-3.0",
                "url": None,
                "note": "Declared in README.md; package.json is private:true; external clearance pending Admin review",
            },
            "rights": {
                "basis": "first_party_workspace_preparation_only",
                "scope": ["dataset_preparation_audit", "pending_admin_review"],
            },
            "approval": {
                "decision": "PENDING_ADMIN_REVIEW",
                "approver": None,
                "signed_at": None,
                "key_id": None,
                "signature": None,
            },
            "evidence": evidence_pins,
        })

    provenance_manifest = {
        "schema_version": PROVENANCE_SCHEMA_VERSION,
        "dataset_id": DATASET_ID,
        "near_duplicate_threshold": GOVERNANCE_THRESHOLD,
        "governance_status": "PENDING_ADMIN_REVIEW",
        "training_plan_target": {
            "warm_start_steps": 2800,
            "continuation_steps": 3000,
            "total_steps": 5800,
            "target_params": 41527808,
        },
        "documents": manifest_docs,
    }
    manifest_path = artifacts_dir / "dataset-provenance-manifest.json"
    manifest_path.write_text(json.dumps(provenance_manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Run fail-closed governance check on the manifest to record true gate verdict
    gate_validation = validate_manifest(
        provenance_manifest,
        texts_by_id,
        evidence_root,
        approval_verifier=None,
    )

    domain_gaps = [d for d, counts in domain_counter.items() if counts["primary_total"] == 0]
    blocked_items = [
        {
            "id": "TRUSTED_HUMAN_APPROVAL_KEY",
            "status": "BLOCKED",
            "reason": "No external 0600 trusted HMAC approval key configured; approval records remain PENDING_ADMIN_REVIEW.",
        },
        {
            "id": "EXTERNAL_HTTPS_SOURCE_AND_LICENSE_CLEARANCE",
            "status": "BLOCKED",
            "reason": "Records derive from local first-party files under README.md AGPL-3.0 / private:true without https source/SPDX URL pins or formal third-party license clearance.",
        },
        {
            "id": "PRIMARY_SCIENCE_CORPUS_MISSING",
            "status": "BLOCKED" if "Science" in domain_gaps else "PARTIAL",
            "reason": "No independent primary Science dataset/corpus exists in the repository; benchmark schemas only define the domain name.",
        },
        {
            "id": "TRAINING_SCALE_EXTERNAL_BILINGUAL_CORPUS",
            "status": "PARTIAL",
            "reason": f"Prepared repository corpus contains {len(all_accepted)} clean records ({sum(r['chars'] for r in all_accepted):,} chars); approved external Thai/English/Math/Science corpora are needed for full 5,800-step 41.53M generalization.",
        },
    ]

    quality_report = {
        "schema_version": "zyntheor.dataset-quality-report.v1",
        "dataset_id": DATASET_ID,
        "preparation_only": True,
        "training_started": False,
        "training_plan_preserved": {
            "warm_start_steps": 2800,
            "continuation_steps": 3000,
            "total_steps": 5800,
            "target_params": 41527808,
        },
        "split_files": split_file_hashes,
        "record_counts": {
            "total_valid_records": len(all_accepted),
            "invalid_or_rejected_records": len(rejected),
            "by_split": split_counts,
            "test_excluded_from_train_validation": True,
        },
        "language_distribution": lang_counter,
        "domain_distribution": domain_counter,
        "missing_primary_domains": domain_gaps,
        "quality_and_governance_checks": {
            "jsonl_schema_valid": True,
            "nfc_normalized": True,
            "exact_duplicates_in_output": len(split_audit["exact_duplicates"]),
            "cross_split_near_duplicates_in_output": len(split_audit["cross_split_near_duplicates"]),
            "cluster_threshold_applied": NEAR_DUPLICATE_CLUSTER_THRESHOLD,
            "audit_splits_status": split_audit["status"],
            "audit_splits_threshold": split_audit["near_duplicate_threshold"],
            "secret_or_pii_contamination_detected_and_excluded": sum(
                1
                for rej in rejected
                if any(r in {"secret_like_literal", "private_key_material", "contains_email_pii", "RBAC_ISOLATION_PROBE", "SYNTHETIC_ORIGIN"} for r in rej.get("reasons", []))
            ),
            "provenance_coverage_pct": 100.0,
            "trusted_hmac_approval_coverage_pct": 0.0,
            "validate_manifest_gate_status": gate_validation["status"],
            "validate_manifest_sample_issues": sorted({
                iss
                for d in gate_validation["documents"]
                for iss in d.get("issues", [])
            }),
        },
        "near_duplicate_clusters_grouped_into_single_split": near_duplicate_pairs_clustered,
        "rejected_records": rejected,
        "blocked_items": blocked_items,
    }
    quality_path = artifacts_dir / "dataset-quality-report.json"
    quality_path.write_text(json.dumps(quality_report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ------------------------------------------------------------------
    # 11. Write artifacts/dataset-sha256.txt covering all created outputs & evidence
    # ------------------------------------------------------------------
    checksum_targets: List[Path] = [
        datasets_dir / "train.jsonl",
        datasets_dir / "validation.jsonl",
        datasets_dir / "test.jsonl",
        manifest_path,
        quality_path,
        *sorted(p for p in evidence_root.rglob("*") if p.is_file()),
    ]
    sha_lines = [
        f"{sha256_bytes(p.read_bytes())}  {p.relative_to(root).as_posix()}"
        for p in checksum_targets
    ]
    sha_path = artifacts_dir / "dataset-sha256.txt"
    sha_path.write_text("\n".join(sha_lines) + "\n", encoding="utf-8")

    return {
        "dataset_id": DATASET_ID,
        "split_counts": split_counts,
        "total_valid": len(all_accepted),
        "total_rejected": len(rejected),
        "language_distribution": lang_counter,
        "domain_distribution": domain_counter,
        "missing_primary_domains": domain_gaps,
        "split_audit_status": split_audit["status"],
        "manifest_gate_status": gate_validation["status"],
        "sha256_file": "artifacts/dataset-sha256.txt",
        "sha256_entries": len(sha_lines),
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Prepare governed ZYNTHEOR NativeLM dataset splits (no training).")
    ap.add_argument("--root", default=str(ROOT), help="Workspace root directory")
    args = ap.parse_args(argv)
    summary = prepare_datasets(Path(args.root).resolve())
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
