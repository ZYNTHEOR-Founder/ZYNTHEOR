# -*- coding: utf-8 -*-
"""Read-only Dataset Governance & Admission Audit for ZYNTHEOR NativeLM training.

Inspects all provenance manifests, approval records, local dataset files, and
workspace corpus sources using `qplus_native.dataset_governance` and
`qplus_native.training_readiness`.

Hard fail-closed rules:
  * Never fabricates licenses, rights, source URLs, trust keys, or signatures.
  * Separates strictly VERIFIED (approved) vs BLOCKED documents.
  * Produces an unfilled `zyntheor.dataset-provenance.v1` pending manifest template
    with zero invented evidence when governance prerequisites are incomplete.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.corpus import build_corpus
from qplus_native.dataset_governance import (
    SCHEMA_VERSION,
    audit_splits,
    canonical_json,
    content_sha256,
    manifest_template,
    validate_document,
    validate_manifest,
)
from qplus_native.training_readiness import validate_training_readiness

DEFAULT_MANIFEST = ROOT / "source" / "artifacts" / "dataset-provenance-manifest.json"
DEFAULT_EVIDENCE_ROOT = ROOT / "source" / "artifacts" / "dataset-provenance-evidence"
DEFAULT_APPROVAL_RECORD = DEFAULT_EVIDENCE_ROOT / "approval" / "approval.json"
DEFAULT_REAL_DATASET = ROOT / "native_data" / "real_dataset.jsonl"
DEFAULT_AUDIT_OUT = ROOT / "artifacts" / "dataset-governance-audit.json"
DEFAULT_PENDING_MANIFEST_OUT = ROOT / "artifacts" / "dataset-provenance-manifest.pending.json"


def _sha256_file(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _audit_legacy_manifest(
    manifest_path: Path,
    evidence_root: Path,
    approval_key_file: Optional[str],
) -> Dict[str, Any]:
    if not manifest_path.is_file():
        return {
            "exists": False,
            "path": str(manifest_path),
            "status": "BLOCKED",
            "issues": ["dataset_provenance_manifest_missing"],
            "approved_documents": [],
            "blocked_documents": [],
        }

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    docs = raw.get("documents", []) if isinstance(raw, dict) else []
    schema_version = raw.get("schema_version") if isinstance(raw, dict) else None
    approved: List[Dict[str, Any]] = []
    blocked: List[Dict[str, Any]] = []
    manifest_issues: List[str] = []

    if schema_version != SCHEMA_VERSION:
        manifest_issues.append(
            f"legacy_or_unsupported_schema_version:{schema_version or 'missing'}"
        )

    for idx, rec in enumerate(docs):
        if not isinstance(rec, dict):
            blocked.append(
                {
                    "document_id": f"index_{idx}",
                    "status": "BLOCKED",
                    "issues": ["document_record_not_object"],
                }
            )
            continue

        # Legacy records use id/source/license/hash instead of document_id/document_sha256/...
        doc_id = rec.get("document_id") or rec.get("id") or f"index_{idx}"
        src = rec.get("source")
        src_path = (
            ROOT / src
            if isinstance(src, str) and not Path(src).is_absolute()
            else (Path(src) if isinstance(src, str) else None)
        )

        if schema_version == SCHEMA_VERSION and src_path and src_path.is_file():
            text = src_path.read_text(encoding="utf-8", errors="ignore")
            res = validate_document(rec, text, evidence_root, approval_verifier=None)
            if res["status"] == "VERIFIED":
                approved.append(res)
            else:
                blocked.append(res)
            continue

        issues = list(manifest_issues)
        file_exists = bool(src_path and src_path.is_file())
        if not file_exists:
            issues.append(f"source_file_missing:{src}")
        if not isinstance(rec.get("document_id"), str):
            issues.append("missing_schema_field:document_id")
        if not isinstance(rec.get("document_sha256"), str):
            issues.append("missing_schema_field:document_sha256")
        if rec.get("split") not in {"train", "validation", "test"}:
            issues.append("split_missing_or_invalid")
        if not isinstance(rec.get("source"), dict):
            issues.append("source_url_https_and_publisher_missing")
        if not isinstance(rec.get("license"), dict):
            issues.append("license_url_https_and_spdx_missing")
        if not isinstance(rec.get("rights"), dict):
            issues.append("rights_basis_and_scope_missing")
        if not isinstance(rec.get("evidence"), dict):
            issues.append("pinned_evidence_bundle_missing_source_license_rights")
        if not approval_key_file or not Path(approval_key_file).is_file():
            issues.append("trusted_approval_key_missing")

        blocked.append(
            {
                "document_id": doc_id,
                "declared_source": src,
                "declared_license": rec.get("license"),
                "declared_hash": rec.get("hash") or rec.get("document_sha256"),
                "source_file_present": file_exists,
                "actual_file_sha256": _sha256_file(src_path) if src_path else None,
                "status": "BLOCKED",
                "issues": sorted(set(issues)),
            }
        )

    approval_record_status: Dict[str, Any] = {
        "path": str(DEFAULT_APPROVAL_RECORD),
        "exists": DEFAULT_APPROVAL_RECORD.is_file(),
    }
    if DEFAULT_APPROVAL_RECORD.is_file():
        app_raw = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        approval_record_status.update(
            {
                "sha256": _sha256_file(DEFAULT_APPROVAL_RECORD),
                "signed_by": app_raw.get("signed_by"),
                "declared_hash": app_raw.get("hash"),
                "status_field": app_raw.get("status"),
                "signature_verifiable_against_trusted_key": False,
                "reason": (
                    "External trusted HMAC key file is absent and legacy approval.json does not follow "
                    "zyntheor.dataset-provenance.v1 canonical approval payload bound to document_id/split/rights/evidence."
                ),
            }
        )

    # Run formal readiness gate as well to record authoritative gate output
    readiness = validate_training_readiness(
        str(manifest_path),
        str(evidence_root),
        approval_key_file,
        {},
    )

    return {
        "exists": True,
        "path": str(manifest_path),
        "sha256": _sha256_file(manifest_path),
        "schema_version": schema_version,
        "required_schema_version": SCHEMA_VERSION,
        "status": "VERIFIED" if approved and not blocked and readiness.get("status") == "VERIFIED" else "BLOCKED",
        "readiness_gate": readiness,
        "approval_artifact": approval_record_status,
        "approved_documents": approved,
        "blocked_documents": blocked,
    }


def _audit_workspace_corpus(root: Path = ROOT) -> Dict[str, Any]:
    corpus = build_corpus(str(root))
    docs = corpus["docs"]
    texts = {d["id"]: d["text"] for d in docs}
    records = [
        {"document_id": d["id"], "split": "validation" if d["split"] == "val" else d["split"]}
        for d in docs
    ]
    split_audit = audit_splits(records, texts)
    blocked_entries = []
    for d in docs:
        blocked_entries.append(
            {
                "document_id": d["id"],
                "kind": d["kind"],
                "split": "validation" if d["split"] == "val" else d["split"],
                "chars": d["chars"],
                "sha256": d["sha256"],
                "source": {"url": None, "local_path": d["id"], "publisher": None},
                "license": {"id": None, "url": None},
                "rights": {"basis": None, "scope": []},
                "provenance_schema": None,
                "admission_bucket": "BLOCKED",
                "status": "BLOCKED",
                "issues": [
                    "not_enrolled_in_zyntheor.dataset-provenance.v1_manifest",
                    "missing_external_https_source_license_rights_evidence",
                    "missing_trusted_human_approval_signature",
                    "missing_test_split_in_corpus_builder",
                ],
            }
        )
    return {
        "source": "qplus_native.corpus.build_corpus",
        "corpus_sha256": corpus["corpus_sha256"],
        "summary": corpus["summary"],
        "excluded_by_corpus_filter": corpus["excluded"],
        "split_leakage_audit": split_audit,
        "approved_count": 0,
        "needs_review_count": 0,
        "blocked_count": len(blocked_entries),
        "blocked_summary_by_kind": {
            kind: sum(1 for d in docs if d["kind"] == kind)
            for kind in sorted({d["kind"] for d in docs})
        },
        "blocked_documents": blocked_entries,
        "blocked_sample_ids": [d["id"] for d in docs[:10]],
    }


def _scan_local_dataset_files(root: Path = ROOT) -> List[Dict[str, Any]]:
    candidates = [
        root / "native_data" / "real_dataset.jsonl",
        root / "native_data" / "tool_call_dataset.jsonl",
        root / "native_data" / "knowledge" / "documents.json",
    ]
    datasets_dir = root / "native_data" / "datasets"
    if datasets_dir.is_dir():
        candidates.extend(sorted(datasets_dir.rglob("*")))

    found: List[Dict[str, Any]] = []
    for p in candidates:
        if p.is_dir():
            continue
        rel = str(p.relative_to(root)) if p.exists() else str(p.relative_to(root))
        found.append(
            {
                "path": rel,
                "exists": p.is_file(),
                "bytes": p.stat().st_size if p.is_file() else 0,
                "sha256": _sha256_file(p),
                "approved_for_training": False,
                "reason": "file_missing_on_disk" if not p.is_file() else "unprovenanced_local_file_no_signed_manifest",
            }
        )
    return found


def run_audit(
    manifest_path: Path = DEFAULT_MANIFEST,
    evidence_root: Path = DEFAULT_EVIDENCE_ROOT,
    approval_key_file: Optional[str] = None,
    audit_out: Optional[Path] = DEFAULT_AUDIT_OUT,
    pending_manifest_out: Optional[Path] = DEFAULT_PENDING_MANIFEST_OUT,
) -> Dict[str, Any]:
    manifest_audit = _audit_legacy_manifest(manifest_path, evidence_root, approval_key_file)
    corpus_audit = _audit_workspace_corpus(ROOT)
    local_files = _scan_local_dataset_files(ROOT)

    all_manifest_docs = manifest_audit["approved_documents"] + manifest_audit["blocked_documents"]
    approved_bucket = [
        doc for doc in all_manifest_docs if doc.get("status") == "VERIFIED"
    ]
    needs_review_bucket = [
        doc for doc in all_manifest_docs if doc.get("status") == "EVIDENCE_PRESENT_REVIEW_REQUIRED"
    ]
    blocked_bucket = [
        {**doc, "admission_bucket": "BLOCKED"}
        for doc in manifest_audit["blocked_documents"]
        if doc.get("status") not in {"VERIFIED", "EVIDENCE_PRESENT_REVIEW_REQUIRED"}
    ] + corpus_audit["blocked_documents"]

    pending_template = {
        **manifest_template(),
        "dataset_id": "zyntheor-native-41m-pending-review",
        "governance_status": "PENDING_HUMAN_REVIEW_AND_TRUSTED_APPROVAL",
        "required_actions": [
            "Provide actual dataset content file(s) with immutable SHA-256 matching document_sha256",
            "Split non-overlapping documents into train, validation, and test (zero exact or near-duplicate leakage >= 0.90)",
            "Attach verified https:// source URL, publisher, SPDX license id + https:// URL, rights basis/scope",
            "Pin local evidence files under evidence/{source,license,rights,approval} with exact SHA-256",
            "Sign each document record via external trusted HMAC key (mode 0600, NOT committed to repo)",
        ],
    }

    report = {
        "schema_version": "zyntheor.dataset-governance-audit.v1",
        "status": "BLOCKED",
        "training_admission_allowed": False,
        "approved_document_count": len(approved_bucket),
        "needs_review_document_count": len(needs_review_bucket),
        "blocked_document_count": len(blocked_bucket),
        "total_inspected_documents": len(approved_bucket) + len(needs_review_bucket) + len(blocked_bucket),
        "excluded_by_corpus_filter_count": len(corpus_audit["excluded_by_corpus_filter"]),
        "bucket_counts": {
            "APPROVED": len(approved_bucket),
            "NEEDS_REVIEW": len(needs_review_bucket),
            "BLOCKED": len(blocked_bucket),
        },
        "buckets": {
            "APPROVED": approved_bucket,
            "NEEDS_REVIEW": needs_review_bucket,
            "BLOCKED": blocked_bucket,
        },
        "approved_documents": approved_bucket,
        "manifest_audit": manifest_audit,
        "workspace_corpus_audit": corpus_audit,
        "local_dataset_files": local_files,
        "pending_manifest_template_path": str(pending_manifest_out) if pending_manifest_out else None,
        "blocking_reasons": sorted(
            {
                *manifest_audit.get("readiness_gate", {}).get("issues", []),
                *(
                    issue
                    for doc in manifest_audit["blocked_documents"]
                    for issue in doc.get("issues", [])
                ),
                "workspace_corpus_unapproved_and_missing_test_split",
            }
        ),
    }

    if audit_out is not None:
        audit_out.parent.mkdir(parents=True, exist_ok=True)
        audit_out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if pending_manifest_out is not None:
        pending_manifest_out.parent.mkdir(parents=True, exist_ok=True)
        pending_manifest_out.write_text(
            json.dumps(pending_template, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    return report


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Audit all datasets and provenance records for ZYNTHEOR NativeLM.")
    ap.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    ap.add_argument("--evidence-root", default=str(DEFAULT_EVIDENCE_ROOT))
    ap.add_argument("--approval-key-file", default=os.environ.get("ZYNTHEOR_APPROVAL_KEY_FILE"))
    ap.add_argument("--out", default=str(DEFAULT_AUDIT_OUT))
    ap.add_argument("--pending-manifest-out", default=str(DEFAULT_PENDING_MANIFEST_OUT))
    args = ap.parse_args(argv)

    report = run_audit(
        manifest_path=Path(args.manifest),
        evidence_root=Path(args.evidence_root),
        approval_key_file=args.approval_key_file,
        audit_out=Path(args.out),
        pending_manifest_out=Path(args.pending_manifest_out),
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
