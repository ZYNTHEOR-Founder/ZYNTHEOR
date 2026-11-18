# -*- coding: utf-8 -*-
"""Shared fail-closed gate for NativeLM training entrypoints."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from qplus_native.dataset_governance import validate_manifest
from qplus_native.trusted_approvals import load_hmac_verifier


def validate_training_readiness(
    provenance_manifest_path: str,
    evidence_root: str,
    approval_key_file: Optional[str],
    frozen_documents: Mapping[str, Mapping[str, Any]],
) -> Dict[str, Any]:
    """Validate provenance records against frozen docs and their exact split assignments.

    `frozen_documents` maps document IDs to {text, split}; split may be train/val/validation/test.
    A trusted key is mandatory to produce VERIFIED. This function never writes artifacts.
    """
    if not Path(provenance_manifest_path).is_file():
        return {"status": "BLOCKED", "issues": ["dataset_provenance_manifest_missing"], "documents": []}
    if not approval_key_file or not Path(approval_key_file).is_file():
        return {"status": "BLOCKED", "issues": ["trusted_approval_key_missing"], "documents": []}
    try:
        manifest = json.loads(Path(provenance_manifest_path).read_text(encoding="utf-8"))
        verifier = load_hmac_verifier(approval_key_file)
    except Exception as exc:
        return {"status": "BLOCKED", "issues": [f"manifest_or_trust_key_invalid:{type(exc).__name__}"], "documents": []}

    texts = {doc_id: str(value.get("text", "")) for doc_id, value in frozen_documents.items()}
    result = validate_manifest(manifest, texts, evidence_root, verifier)
    issues = list(result.get("issues", []))
    declared = {r.get("document_id"): r for r in manifest.get("documents", []) if isinstance(r, dict)}
    for doc_id, frozen in frozen_documents.items():
        record = declared.get(doc_id)
        if record is None:
            issues.append(f"frozen_document_missing_from_provenance:{doc_id}")
            continue
        fsplit = "validation" if frozen.get("split") == "val" else frozen.get("split")
        if record.get("split") != fsplit:
            issues.append(f"frozen_split_mismatch:{doc_id}")
    if not any(r.get("split") == "test" for r in manifest.get("documents", []) if isinstance(r, dict)):
        issues.append("test_split_missing")
    if issues or result.get("status") != "VERIFIED":
        result["status"] = "BLOCKED"
    result["issues"] = issues
    result["test_documents_excluded_from_training"] = True
    return result
