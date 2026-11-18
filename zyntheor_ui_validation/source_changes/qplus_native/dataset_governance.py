# -*- coding: utf-8 -*-
"""Fail-closed dataset provenance, split, duplicate, and leakage validation.

This module records evidence; it does not decide legal rights. VERIFIED requires an
external trusted approval_verifier callback. Presence of local files alone can never
produce VERIFIED. No dataset is created or bundled by this module.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

SCHEMA_VERSION = "zyntheor.dataset-provenance.v1"
SPLITS = {"train", "validation", "test"}
_REQUIRED_EVIDENCE = ("source", "license", "rights", "approval")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def content_sha256(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def _https_url(value: Any) -> bool:
    try:
        p = urlparse(str(value or ""))
        return p.scheme == "https" and bool(p.netloc) and not p.username and not p.password
    except Exception:
        return False


def _evidence_file(root: Path, item: Any, label: str, issues: List[str]) -> bool:
    if not isinstance(item, dict):
        issues.append(f"{label}_evidence_missing")
        return False
    rel = item.get("path")
    digest = item.get("sha256")
    if not isinstance(rel, str) or not rel or "\\" in rel:
        issues.append(f"{label}_evidence_path_invalid")
        return False
    pp = PurePosixPath(rel)
    if pp.is_absolute() or ".." in pp.parts:
        issues.append(f"{label}_evidence_path_unsafe")
        return False
    if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
        issues.append(f"{label}_evidence_hash_invalid")
        return False
    base = root.resolve()
    target = (base / Path(*pp.parts)).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        issues.append(f"{label}_evidence_path_escapes_root")
        return False
    if not target.is_file():
        issues.append(f"{label}_evidence_file_missing")
        return False
    actual = sha256_bytes(target.read_bytes())
    if actual != digest:
        issues.append(f"{label}_evidence_hash_mismatch")
        return False
    return True


def validate_document(
    record: Mapping[str, Any],
    text: str,
    evidence_root: str | os.PathLike[str],
    approval_verifier: Optional[Callable[[Mapping[str, Any]], bool]] = None,
) -> Dict[str, Any]:
    """Validate one record and its locally pinned evidence. Never infers rights from a URL."""
    issues: List[str] = []
    doc_id = record.get("document_id")
    if not isinstance(doc_id, str) or not doc_id.strip():
        issues.append("document_id_missing")
    actual_doc_hash = content_sha256(text)
    declared = record.get("document_sha256")
    if not isinstance(declared, str) or not _SHA256.fullmatch(declared):
        issues.append("document_sha256_missing_or_invalid")
    elif declared != actual_doc_hash:
        issues.append("document_sha256_mismatch")

    split = record.get("split")
    if split not in SPLITS:
        issues.append("split_invalid")

    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    license_info = record.get("license") if isinstance(record.get("license"), dict) else {}
    rights = record.get("rights") if isinstance(record.get("rights"), dict) else {}
    approval = record.get("approval") if isinstance(record.get("approval"), dict) else {}
    if not _https_url(source.get("url")):
        issues.append("source_url_missing_or_not_https")
    if not isinstance(source.get("publisher"), str) or not source.get("publisher", "").strip():
        issues.append("source_publisher_missing")
    if not isinstance(license_info.get("id"), str) or license_info.get("id", "").strip().lower() in {"", "unknown", "none", "n/a", "tbd"}:
        issues.append("license_id_missing_or_unknown")
    if not _https_url(license_info.get("url")):
        issues.append("license_url_missing_or_not_https")
    if not isinstance(rights.get("basis"), str) or not rights.get("basis", "").strip():
        issues.append("rights_basis_missing")
    if not isinstance(rights.get("scope"), list) or not rights.get("scope") or not all(isinstance(x, str) and x.strip() for x in rights.get("scope", [])):
        issues.append("rights_scope_missing")
    if approval.get("decision") != "APPROVED":
        issues.append("human_approval_not_approved")
    if not isinstance(approval.get("approver"), str) or not approval.get("approver", "").strip():
        issues.append("approver_missing")
    if not isinstance(approval.get("signed_at"), str) or not approval.get("signed_at", "").strip():
        issues.append("approval_timestamp_missing")
    if not isinstance(approval.get("signature"), str) or not approval.get("signature", "").strip():
        issues.append("approval_signature_missing")
    if not isinstance(approval.get("key_id"), str) or not approval.get("key_id", "").strip():
        issues.append("approval_key_id_missing")

    root = Path(evidence_root)
    evidence = record.get("evidence") if isinstance(record.get("evidence"), dict) else {}
    evidence_ok = True
    for label in _REQUIRED_EVIDENCE:
        if not _evidence_file(root, evidence.get(label), label, issues):
            evidence_ok = False
    if issues:
        status = "BLOCKED"
    elif approval_verifier is None:
        status = "EVIDENCE_PRESENT_REVIEW_REQUIRED"
        issues.append("trusted_approval_verifier_not_configured")
    else:
        try:
            # The verifier receives the full record so the signature can bind to the
            # exact document hash, split, rights declaration, and evidence hashes.
            trusted = approval_verifier(record) is True
        except Exception:
            trusted = False
        if trusted and evidence_ok:
            status = "VERIFIED"
        else:
            status = "BLOCKED"
            issues.append("approval_signature_not_verified_by_trusted_key")
    return {
        "document_id": doc_id,
        "status": status,
        "issues": issues,
        "computed_document_sha256": actual_doc_hash,
        "declared_document_sha256": declared,
        "split": split,
    }


def _char_shingles(text: str, width: int = 5) -> set[str]:
    normalized = unicodedata.normalize("NFC", text).casefold()
    normalized = " ".join(normalized.split())
    if len(normalized) < width:
        return {normalized} if normalized else set()
    return {normalized[i:i + width] for i in range(len(normalized) - width + 1)}


def audit_splits(
    records: Sequence[Mapping[str, Any]],
    texts: Mapping[str, str],
    near_duplicate_threshold: float = 0.90,
) -> Dict[str, Any]:
    """Detect exact duplicates across any split and near-duplicates across splits."""
    errors: List[Dict[str, str]] = []
    by_hash: Dict[str, List[Tuple[str, str]]] = {}
    valid_records = []
    for r in records:
        doc_id, split = r.get("document_id"), r.get("split")
        text = texts.get(str(doc_id))
        if not isinstance(text, str):
            errors.append({"type": "document_text_missing", "document_id": str(doc_id)})
            continue
        if split not in SPLITS:
            errors.append({"type": "invalid_split", "document_id": str(doc_id)})
            continue
        digest = content_sha256(text)
        by_hash.setdefault(digest, []).append((str(doc_id), str(split)))
        valid_records.append((str(doc_id), str(split), text))
    exact = []
    for items in by_hash.values():
        if len(items) > 1:
            exact.append({"documents": [x[0] for x in items], "splits": sorted({x[1] for x in items})})
    near = []
    shingles = [(doc_id, split, _char_shingles(text)) for doc_id, split, text in valid_records]
    for i, (id_a, split_a, sh_a) in enumerate(shingles):
        for id_b, split_b, sh_b in shingles[i + 1:]:
            if split_a == split_b or not sh_a or not sh_b:
                continue
            # Exact duplicates are already reported above.
            score = len(sh_a & sh_b) / max(1, len(sh_a | sh_b))
            if score >= near_duplicate_threshold:
                near.append({"document_a": id_a, "split_a": split_a, "document_b": id_b, "split_b": split_b, "jaccard": round(score, 6)})
    counts = {s: sum(1 for r in records if r.get("split") == s) for s in sorted(SPLITS)}
    missing_splits = sorted(s for s, n in counts.items() if n == 0)
    ready = not errors and not exact and not near and not missing_splits
    return {"status": "READY_FOR_REVIEW" if ready else "BLOCKED", "split_counts": counts,
            "missing_splits": missing_splits, "exact_duplicates": exact, "cross_split_near_duplicates": near,
            "errors": errors, "near_duplicate_threshold": near_duplicate_threshold}


def validate_manifest(
    manifest: Mapping[str, Any],
    corpus_texts: Mapping[str, str],
    evidence_root: str | os.PathLike[str],
    approval_verifier: Optional[Callable[[Mapping[str, Any]], bool]] = None,
) -> Dict[str, Any]:
    """Validate a complete frozen manifest against the actual documents and trust root."""
    issues: List[str] = []
    if manifest.get("schema_version") != SCHEMA_VERSION:
        issues.append("unsupported_schema_version")
    if not isinstance(manifest.get("dataset_id"), str) or not manifest.get("dataset_id", "").strip():
        issues.append("dataset_id_missing")
    docs = manifest.get("documents")
    if not isinstance(docs, list) or not docs:
        issues.append("documents_missing")
        docs = []
    raw_ids = [d.get("document_id") for d in docs if isinstance(d, dict)]
    ids = [x for x in raw_ids if isinstance(x, str) and x]
    if len(ids) != len(raw_ids):
        issues.append("document_id_invalid")
    if len(ids) != len(set(ids)):
        issues.append("duplicate_document_ids")
    expected_ids, declared_ids = set(corpus_texts), set(ids)
    if expected_ids != declared_ids:
        issues.append("manifest_corpus_document_set_mismatch")
    per_doc = []
    for r in docs:
        if not isinstance(r, dict):
            issues.append("document_record_not_object")
            continue
        doc_id = r.get("document_id")
        text = corpus_texts.get(doc_id) if isinstance(doc_id, str) else None
        if text is None:
            per_doc.append({"document_id": doc_id, "status": "BLOCKED", "issues": ["document_not_in_corpus"]})
        else:
            per_doc.append(validate_document(r, text, evidence_root, approval_verifier))
    threshold = manifest.get("near_duplicate_threshold", 0.90)
    if not isinstance(threshold, (int, float)) or not 0.5 <= float(threshold) <= 1.0:
        issues.append("near_duplicate_threshold_invalid")
        threshold = 0.90
    leakage_records = [r for r in docs if isinstance(r, dict)]
    leakage = audit_splits(leakage_records, corpus_texts, float(threshold))
    bad_docs = [d for d in per_doc if d["status"] != "VERIFIED"]
    if issues or bad_docs or leakage["status"] != "READY_FOR_REVIEW":
        status = "BLOCKED"
    else:
        status = "VERIFIED"
    manifest_rows = [(r.get("document_id"), r.get("document_sha256"), r.get("split"))
                     for r in docs if isinstance(r, dict) and isinstance(r.get("document_id"), str)]
    manifest_rows.sort(key=lambda row: row[0])
    return {"status": status, "issues": issues, "documents": per_doc, "split_audit": leakage,
            "corpus_sha256": sha256_bytes(canonical_json(manifest_rows)),
            "verified_documents": sum(1 for d in per_doc if d["status"] == "VERIFIED"),
            "document_count": len(per_doc)}


def manifest_template() -> Dict[str, Any]:
    """Return an empty draft template; intentionally contains no fabricated data/evidence."""
    return {"schema_version": SCHEMA_VERSION, "dataset_id": "", "near_duplicate_threshold": 0.90, "documents": []}
