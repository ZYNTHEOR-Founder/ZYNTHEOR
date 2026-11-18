# -*- coding: utf-8 -*-
"""External trust-root loader for dataset approvals; never creates/signs approvals."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import stat
from pathlib import Path
from typing import Any, Mapping

from qplus_native.dataset_governance import canonical_json


def approval_payload(record: Mapping[str, Any]) -> bytes:
    """Canonical signed content binds an approval to exact content/rights/evidence hashes."""
    approval = record.get("approval")
    if not isinstance(approval, Mapping):
        raise ValueError("full provenance record with approval is required")
    approval_fields = {k: v for k, v in approval.items() if k != "signature"}
    evidence = record.get("evidence")
    evidence_hashes = {}
    if isinstance(evidence, Mapping):
        for kind, item in evidence.items():
            if isinstance(item, Mapping):
                evidence_hashes[kind] = {"path": item.get("path"), "sha256": item.get("sha256")}
    signed = {
        "document_id": record.get("document_id"),
        "document_sha256": record.get("document_sha256"),
        "split": record.get("split"),
        "source": record.get("source"),
        "license": record.get("license"),
        "rights": record.get("rights"),
        "evidence": evidence_hashes,
        "approval": approval_fields,
    }
    if not signed["document_id"] or not signed["document_sha256"]:
        raise ValueError("document_id and document_sha256 must be bound into approval")
    return canonical_json(signed)


def load_hmac_verifier(key_file: str | os.PathLike[str]):
    """Load a 0600 JSON trust file {key_id, key_hex}; return signature verifier callback.

    This verifier only validates signatures. It does not assert that a signer is legally
    authorized; that responsibility belongs to the external key-issuance process.
    """
    p = Path(key_file)
    if p.is_symlink():
        raise ValueError("approval trust key must not be a symlink")
    info = p.stat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("approval trust key must be a regular file")
    if os.name == "posix" and (stat.S_IMODE(info.st_mode) & 0o077):
        raise PermissionError("approval trust key must have mode 0600 or stricter")
    obj = json.loads(p.read_text(encoding="utf-8"))
    key_id, key_hex = obj.get("key_id"), obj.get("key_hex")
    if not isinstance(key_id, str) or not key_id or not isinstance(key_hex, str):
        raise ValueError("trust key file requires key_id and key_hex")
    key = bytes.fromhex(key_hex)
    if len(key) < 32:
        raise ValueError("trust key must contain at least 256 bits")

    def verify(record: Mapping[str, Any]) -> bool:
        approval = record.get("approval")
        if not isinstance(approval, Mapping) or approval.get("key_id") != key_id or not isinstance(approval.get("signature"), str):
            return False
        try:
            expected = hmac.new(key, approval_payload(record), hashlib.sha256).hexdigest()
        except (TypeError, ValueError):
            return False
        return hmac.compare_digest(expected, approval["signature"].lower())
    return verify
