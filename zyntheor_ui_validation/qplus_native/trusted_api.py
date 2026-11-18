# -*- coding: utf-8 -*-
"""Hardened HMAC-SHA256 Sovereign Token verification & signing for Python runtime."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import time
import uuid
from typing import Any, Mapping, Sequence

MAX_TOKEN_LENGTH = 4096
MIN_SECRET_BYTES = 32
DEFAULT_CLOCK_SKEW_SECONDS = 30

ROLE_HIERARCHY: dict[str, int] = {
    "guest": 1,
    "developer": 2,
    "operator": 3,
    "auditor": 4,
    "admin": 5,
}

_BASE64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class SovereignTokenError(ValueError):
    """Raised when a sovereign HMAC token fails cryptographic or policy validation."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(segment: str) -> bytes:
    if not segment or not _BASE64URL_RE.fullmatch(segment):
        raise SovereignTokenError("MALFORMED_STRUCTURE", "Segment is not valid base64url.")
    padding = "=" * ((4 - len(segment) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(segment + padding)
    except Exception as exc:
        raise SovereignTokenError("MALFORMED_STRUCTURE", "Failed to base64url-decode segment.") from exc


def _resolve_secret(secret: str | bytes | None) -> bytes:
    raw = secret
    if raw is None:
        raw = os.environ.get("ZYNTHEOR_TOKEN_SECRET") or os.environ.get("ZYNTHEOR_MASTER_SECRET")
    if raw is None:
        raise SovereignTokenError("MISSING_SECRET", "Token secret is not configured.")
    secret_bytes = raw.strip().encode("utf-8") if isinstance(raw, str) else bytes(raw)
    if not secret_bytes:
        raise SovereignTokenError("MISSING_SECRET", "Token secret is empty.")
    if len(secret_bytes) < MIN_SECRET_BYTES:
        raise SovereignTokenError(
            "WEAK_SECRET",
            f"Token secret must be at least {MIN_SECRET_BYTES} bytes (got {len(secret_bytes)}).",
        )
    return secret_bytes


def constant_time_str_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _is_finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def sign_hmac_token(
    *,
    sub: str,
    tenant_id: str,
    role: str,
    secret: str | bytes | None = None,
    ttl_seconds: int = 3600,
    now_seconds: float | None = None,
    jti: str | None = None,
    scope: Sequence[str] | None = None,
) -> str:
    secret_bytes = _resolve_secret(secret)
    if not isinstance(sub, str) or not sub:
        raise SovereignTokenError("INVALID_CLAIMS", "sub must be a non-empty string.")
    if not isinstance(tenant_id, str) or not tenant_id:
        raise SovereignTokenError("INVALID_CLAIMS", "tenantId must be a non-empty string.")
    if not isinstance(role, str) or role not in ROLE_HIERARCHY:
        raise SovereignTokenError("INVALID_CLAIMS", f"Unsupported role: {role!r}")

    now = int(time.time()) if now_seconds is None else int(now_seconds)
    header = {"alg": "HS256", "typ": "ZY-TOKEN"}
    payload: dict[str, Any] = {
        "sub": sub,
        "tenantId": tenant_id,
        "role": role,
        "iat": now,
        "exp": now + int(ttl_seconds),
        "jti": jti or str(uuid.uuid4()),
    }
    if scope is not None:
        payload["scope"] = list(scope)

    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    preimage = f"{header_b64}.{payload_b64}"
    sig = hmac.new(secret_bytes, preimage.encode("ascii"), hashlib.sha256).digest()
    return f"{preimage}.{_b64url_encode(sig)}"


def verify_hmac_token(
    token: str,
    *,
    secret: str | bytes | None = None,
    expected_tenant_id: str | None = None,
    required_role: str | None = None,
    now_seconds: float | None = None,
    clock_skew_seconds: float = DEFAULT_CLOCK_SKEW_SECONDS,
    max_token_length: int = MAX_TOKEN_LENGTH,
) -> dict[str, Any]:
    """Verify an HS256 ZY-TOKEN using Verify-Before-Parse and constant-time checks."""
    if not isinstance(token, str) or not token:
        raise SovereignTokenError("MALFORMED_STRUCTURE", "Token string is empty or missing.")

    # 1. DoS Protection: limit max token length before splitting, decoding, or hashing.
    if len(token) > max_token_length:
        raise SovereignTokenError(
            "TOKEN_TOO_LONG",
            f"Token length {len(token)} exceeds maximum allowed {max_token_length}.",
        )

    # 2. Fail-closed secret check (>= 32 bytes).
    secret_bytes = _resolve_secret(secret)

    # 3. Strict 3-segment structure check.
    parts = token.split(".")
    if len(parts) != 3:
        raise SovereignTokenError(
            "MALFORMED_STRUCTURE",
            f"Expected 3 segments (header.payload.signature), got {len(parts)}.",
        )
    header_b64, payload_b64, signature_b64 = parts
    if (
        not header_b64
        or not payload_b64
        or not signature_b64
        or not _BASE64URL_RE.fullmatch(header_b64)
        or not _BASE64URL_RE.fullmatch(payload_b64)
        or not _BASE64URL_RE.fullmatch(signature_b64)
    ):
        raise SovereignTokenError("MALFORMED_STRUCTURE", "Token contains empty or invalid base64url segments.")

    # 4. Verify-Before-Parse: validate HMAC-SHA256 over exact raw preimage BEFORE json.loads.
    preimage = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_sig = hmac.new(secret_bytes, preimage, hashlib.sha256).digest()
    actual_sig = _b64url_decode(signature_b64)

    if (
        _b64url_encode(actual_sig) != signature_b64
        or len(actual_sig) != len(expected_sig)
        or not hmac.compare_digest(actual_sig, expected_sig)
    ):
        raise SovereignTokenError("SIGNATURE_MISMATCH", "HMAC-SHA256 signature verification failed.")

    # 5. Safe header parsing & algorithm validation.
    try:
        header_obj = json.loads(_b64url_decode(header_b64).decode("utf-8"))
    except Exception as exc:
        raise SovereignTokenError("MALFORMED_JSON", "Header is not valid JSON.") from exc

    if not isinstance(header_obj, Mapping) or header_obj.get("alg") != "HS256" or header_obj.get("typ") != "ZY-TOKEN":
        raise SovereignTokenError("UNSUPPORTED_ALGORITHM", "Unsupported header alg or typ.")

    # 6. Safe payload parsing & strict claim type validation.
    try:
        payload_obj = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception as exc:
        raise SovereignTokenError("MALFORMED_JSON", "Payload is not valid JSON.") from exc

    if not isinstance(payload_obj, dict):
        raise SovereignTokenError("MALFORMED_JSON", "Payload must be a JSON object.")

    sub = payload_obj.get("sub")
    tenant_id = payload_obj.get("tenantId")
    role = payload_obj.get("role")
    exp = payload_obj.get("exp")
    iat = payload_obj.get("iat")

    if not isinstance(sub, str) or not sub:
        raise SovereignTokenError("INVALID_CLAIMS", "Claim 'sub' must be a non-empty string.")
    if not isinstance(tenant_id, str) or not tenant_id:
        raise SovereignTokenError("INVALID_CLAIMS", "Claim 'tenantId' must be a non-empty string.")
    if not isinstance(role, str) or role not in ROLE_HIERARCHY:
        raise SovereignTokenError("INVALID_CLAIMS", "Claim 'role' is missing or invalid.")
    if not _is_finite_number(exp):
        raise SovereignTokenError("INVALID_CLAIMS", "Claim 'exp' must be a finite number.")
    if iat is not None and not _is_finite_number(iat):
        raise SovereignTokenError("INVALID_CLAIMS", "Claim 'iat' must be a finite number.")

    # 7. Expiration & clock skew leeway (default 30s).
    now = time.time() if now_seconds is None else float(now_seconds)
    if float(exp) + float(clock_skew_seconds) <= now:
        raise SovereignTokenError("TOKEN_EXPIRED", f"Token expired at {exp} (now={now}).")
    if iat is not None and float(iat) - float(clock_skew_seconds) > now:
        raise SovereignTokenError("TOKEN_NOT_YET_VALID", f"Token issued in the future (iat={iat}, now={now}).")

    # 8. Constant-time tenant isolation check.
    if expected_tenant_id is not None and not constant_time_str_equal(tenant_id, expected_tenant_id):
        raise SovereignTokenError(
            "TENANT_MISMATCH",
            f"Cross-tenant token rejected: expected '{expected_tenant_id}'.",
        )

    # 9. Role authorization check.
    if required_role is not None:
        if ROLE_HIERARCHY[role] < ROLE_HIERARCHY.get(required_role, 999):
            raise SovereignTokenError(
                "UNAUTHORIZED_ROLE",
                f"Role '{role}' lacks required privilege '{required_role}'.",
            )

    return payload_obj
