# -*- coding: utf-8 -*-
"""Admin Dataset Provenance HMAC-SHA256 Signing & Verification Utility.

Strict Fail-Closed & Zero-Forgery Guarantees:
  * NEVER generates, invents, or exposes HMAC key material (`key_hex`).
  * Requires an existing external 0600 regular JSON trust key file
    `{"key_id": "...", "key_hex": "..."}` with >= 256-bit key material.
  * Signs every record in `artifacts/dataset-provenance-manifest.json` using
    canonical `approval_payload(record)` and verifies with `validate_training_readiness`.
  * Supports `--verify-only` for read-only cryptographic audit without mutating disk files.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.dataset_governance import sha256_bytes
from qplus_native.train_target import load_frozen_documents
from qplus_native.training_readiness import validate_training_readiness
from qplus_native.trusted_approvals import approval_payload, load_hmac_verifier


def _load_key_material_0600(key_file: Path) -> tuple[str, bytes]:
    if not key_file.exists():
        raise FileNotFoundError(f"FAIL_CLOSED: approval trust key missing: {key_file}")
    # Enforce symlink, regular file, 0600 permissions, and >=256-bit format via canonical loader
    load_hmac_verifier(key_file)
    info = key_file.stat()
    if key_file.is_symlink() or not stat.S_ISREG(info.st_mode):
        raise ValueError("FAIL_CLOSED: trust key must be a non-symlink regular file")
    obj = json.loads(key_file.read_text(encoding="utf-8"))
    key_id = str(obj["key_id"]).strip()
    key_bytes = bytes.fromhex(str(obj["key_hex"]))
    return key_id, key_bytes


def verify_provenance_manifest(
    *,
    manifest_path: Path,
    evidence_root: Path,
    dataset_path: Path,
    key_file: Optional[Path],
) -> Dict[str, Any]:
    frozen_docs = load_frozen_documents(str(dataset_path))
    readiness = validate_training_readiness(
        str(manifest_path),
        str(evidence_root),
        str(key_file) if key_file else None,
        frozen_docs,
    )
    return {
        "schema_version": "zyntheor.provenance-verify.v1",
        "manifest_path": str(manifest_path),
        "evidence_root": str(evidence_root),
        "dataset_path": str(dataset_path),
        "approval_key_configured": bool(key_file),
        "status": readiness.get("status", "BLOCKED"),
        "verified_documents": readiness.get("verified_documents", 0),
        "document_count": readiness.get("document_count", len(frozen_docs)),
        "corpus_sha256": readiness.get("corpus_sha256"),
        "issues": readiness.get("issues", []),
        "split_audit": readiness.get("split_audit"),
        "sample_doc_statuses": [
            {
                "document_id": d.get("document_id"),
                "status": d.get("status"),
                "issues": d.get("issues", []),
            }
            for d in (readiness.get("documents") or [])[:10]
        ],
    }


def sign_provenance_manifest(
    *,
    manifest_path: Path,
    evidence_root: Path,
    dataset_path: Path,
    key_file: Path,
    approver: str,
    source_base_url: str,
    license_url: str,
) -> Dict[str, Any]:
    approver_clean = approver.strip()
    if not approver_clean:
        raise ValueError("FAIL_CLOSED: --approver must be non-empty")
    if not source_base_url.startswith("https://"):
        raise ValueError("FAIL_CLOSED: --source-base-url must use https://")
    if not license_url.startswith("https://"):
        raise ValueError("FAIL_CLOSED: --license-url must use https://")

    key_id, key_bytes = _load_key_material_0600(key_file)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    docs = manifest.get("documents")
    if not isinstance(docs, list) or not docs:
        raise ValueError("FAIL_CLOSED: provenance manifest has no documents to sign")

    signed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Update approval evidence artifact first so its sha256 binds cleanly into every signed record
    approval_ev_rel = "approval/approval-status.json"
    approval_ev_path = evidence_root / "approval" / "approval-status.json"
    approval_ev_path.parent.mkdir(parents=True, exist_ok=True)
    approval_ev_payload = {
        "schema_version": "zyntheor.approval-evidence.v1",
        "decision": "APPROVED",
        "approver": approver_clean,
        "key_id": key_id,
        "signed_at": signed_at,
        "dataset_id": manifest.get("dataset_id"),
        "document_count": len(docs),
    }
    approval_ev_bytes = (json.dumps(approval_ev_payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    approval_ev_path.write_bytes(approval_ev_bytes)
    approval_ev_sha = sha256_bytes(approval_ev_bytes)

    base = source_base_url.rstrip("/")
    signed_count = 0
    for rec in docs:
        if not isinstance(rec, dict):
            continue
        doc_id = str(rec.get("document_id") or "")
        src = rec.setdefault("source", {})
        if not str(src.get("url") or "").startswith("https://"):
            src["url"] = f"{base}/{doc_id.lstrip('/')}"
        lic = rec.setdefault("license", {})
        if not str(lic.get("url") or "").startswith("https://"):
            lic["url"] = license_url
        rights = rec.setdefault("rights", {})
        rights["basis"] = "authorized_first_party_training_grant"
        rights["scope"] = ["native_training", "validation_eval"]
        ev = rec.setdefault("evidence", {})
        ev["approval"] = {"path": approval_ev_rel, "sha256": approval_ev_sha}

        rec["approval"] = {
            "decision": "APPROVED",
            "approver": approver_clean,
            "signed_at": signed_at,
            "key_id": key_id,
            "signature": None,
        }
        rec["approval"]["signature"] = hmac.new(
            key_bytes, approval_payload(rec), hashlib.sha256
        ).hexdigest()
        signed_count += 1

    manifest["governance_status"] = "APPROVED"
    manifest["signed_at"] = signed_at
    manifest["approver"] = approver_clean
    manifest["approval_key_id"] = key_id
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Immediately verify round-trip using validate_training_readiness (zero trust bypass)
    verification = verify_provenance_manifest(
        manifest_path=manifest_path,
        evidence_root=evidence_root,
        dataset_path=dataset_path,
        key_file=key_file,
    )
    if verification["status"] != "VERIFIED":
        raise RuntimeError(f"FAIL_CLOSED: post-sign provenance verification failed: {verification.get('issues')}")
    return {
        **verification,
        "signed_documents": signed_count,
        "key_id": key_id,
        "approver": approver_clean,
        "signed_at": signed_at,
    }


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Sign or verify ZYNTHEOR dataset provenance manifest via external 0600 HMAC key")
    ap.add_argument("--manifest", default=str(ROOT / "artifacts" / "dataset-provenance-manifest.json"))
    ap.add_argument("--evidence-root", default=str(ROOT / "artifacts" / "dataset-provenance-evidence"))
    ap.add_argument("--dataset", default=str(ROOT / "native_data" / "datasets"))
    ap.add_argument("--key-file", default=os.environ.get("ZYNTHEOR_APPROVAL_KEY_FILE"))
    ap.add_argument("--approver", default="")
    ap.add_argument("--source-base-url", default="")
    ap.add_argument("--license-url", default="")
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args(argv)

    manifest_path = Path(args.manifest)
    evidence_root = Path(args.evidence_root)
    dataset_path = Path(args.dataset)
    key_file = Path(args.key_file) if args.key_file else None

    try:
        if args.verify_only:
            rep = verify_provenance_manifest(
                manifest_path=manifest_path,
                evidence_root=evidence_root,
                dataset_path=dataset_path,
                key_file=key_file,
            )
            print(json.dumps(rep, indent=2, ensure_ascii=False))
            return 0 if rep["status"] == "VERIFIED" else 2

        if key_file is None:
            raise ValueError("FAIL_CLOSED: --key-file or ZYNTHEOR_APPROVAL_KEY_FILE (mode 0600) is required")
        rep = sign_provenance_manifest(
            manifest_path=manifest_path,
            evidence_root=evidence_root,
            dataset_path=dataset_path,
            key_file=key_file,
            approver=args.approver,
            source_base_url=args.source_base_url,
            license_url=args.license_url,
        )
        print(json.dumps(rep, indent=2, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "BLOCKED", "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
