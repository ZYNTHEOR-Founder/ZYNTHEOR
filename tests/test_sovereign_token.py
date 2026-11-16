# -*- coding: utf-8 -*-
"""Unit tests for qplus_native.trusted_api.verify_hmac_token (forged, expired, tampered tokens)."""

import base64
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.trusted_api import (
    DEFAULT_CLOCK_SKEW_SECONDS,
    MAX_TOKEN_LENGTH,
    SovereignTokenError,
    sign_hmac_token,
    verify_hmac_token,
)

TRUSTED_SECRET = "zyntheor-sovereign-test-secret-key-at-least-32-bytes-long!"
ATTACKER_SECRET = "attacker-forged-secret-key-also-at-least-32-bytes-long!!"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class SovereignTokenTests(unittest.TestCase):
    def test_valid_token_verifies_claims(self):
        now = 1_750_000_000
        token = sign_hmac_token(
            sub="usr_alpha",
            tenant_id="tenant_alpha",
            role="admin",
            secret=TRUSTED_SECRET,
            ttl_seconds=300,
            now_seconds=now,
            scope=["train:run"],
        )

        claims = verify_hmac_token(
            token,
            secret=TRUSTED_SECRET,
            expected_tenant_id="tenant_alpha",
            required_role="developer",
            now_seconds=now + 60,
        )
        self.assertEqual(claims["sub"], "usr_alpha")
        self.assertEqual(claims["tenantId"], "tenant_alpha")
        self.assertEqual(claims["role"], "admin")
        self.assertEqual(claims["exp"], now + 300)
        self.assertEqual(claims["scope"], ["train:run"])

    def test_forged_token_with_untrusted_secret_rejected(self):
        now = 1_750_000_000
        forged_token = sign_hmac_token(
            sub="usr_rogue",
            tenant_id="tenant_alpha",
            role="admin",
            secret=ATTACKER_SECRET,
            ttl_seconds=600,
            now_seconds=now,
        )
        with self.assertRaises(SovereignTokenError) as ctx:
            verify_hmac_token(forged_token, secret=TRUSTED_SECRET, now_seconds=now)
        self.assertEqual(ctx.exception.code, "SIGNATURE_MISMATCH")

    def test_forged_signature_bit_flip_and_truncation_rejected(self):
        now = 1_750_000_000
        token = sign_hmac_token(
            sub="usr_1",
            tenant_id="tenant_alpha",
            role="developer",
            secret=TRUSTED_SECRET,
            ttl_seconds=600,
            now_seconds=now,
        )
        h, p, s = token.split(".")
        flipped_head = ("B" if s[0] == "A" else "A") + s[1:]
        flipped_tail = s[:-1] + ("B" if s.endswith("A") else "A")
        truncated = f"{h}.{p}.{s[:10]}"

        for bad_sig in (flipped_head, flipped_tail):
            with self.assertRaises(SovereignTokenError) as ctx:
                verify_hmac_token(f"{h}.{p}.{bad_sig}", secret=TRUSTED_SECRET, now_seconds=now)
            self.assertEqual(ctx.exception.code, "SIGNATURE_MISMATCH")

        with self.assertRaises(SovereignTokenError) as ctx_trunc:
            verify_hmac_token(truncated, secret=TRUSTED_SECRET, now_seconds=now)
        self.assertEqual(ctx_trunc.exception.code, "SIGNATURE_MISMATCH")

    def test_alg_none_downgrade_attack_rejected(self):
        now = 1_750_000_000
        none_header = _b64url(json.dumps({"alg": "none", "typ": "ZY-TOKEN"}).encode("utf-8"))
        payload = _b64url(
            json.dumps(
                {"sub": "hacker", "tenantId": "tenant_alpha", "role": "admin", "iat": now, "exp": now + 600}
            ).encode("utf-8")
        )

        with self.assertRaises(SovereignTokenError) as ctx1:
            verify_hmac_token(f"{none_header}.{payload}.", secret=TRUSTED_SECRET, now_seconds=now)
        self.assertEqual(ctx1.exception.code, "MALFORMED_STRUCTURE")

        sig = _b64url(
            hmac.new(TRUSTED_SECRET.encode("utf-8"), f"{none_header}.{payload}".encode("ascii"), hashlib.sha256).digest()
        )
        with self.assertRaises(SovereignTokenError) as ctx2:
            verify_hmac_token(f"{none_header}.{payload}.{sig}", secret=TRUSTED_SECRET, now_seconds=now)
        self.assertEqual(ctx2.exception.code, "UNSUPPORTED_ALGORITHM")

    def test_payload_tampering_without_resigning_rejected(self):
        now = 1_750_000_000
        token = sign_hmac_token(
            sub="usr_dev",
            tenant_id="tenant_alpha",
            role="developer",
            secret=TRUSTED_SECRET,
            ttl_seconds=600,
            now_seconds=now,
        )
        header_b64, _, sig_b64 = token.split(".")
        tampered_payload_b64 = _b64url(
            json.dumps(
                {"sub": "usr_dev", "tenantId": "tenant_alpha", "role": "admin", "iat": now, "exp": now + 600}
            ).encode("utf-8")
        )
        with self.assertRaises(SovereignTokenError) as ctx:
            verify_hmac_token(f"{header_b64}.{tampered_payload_b64}.{sig_b64}", secret=TRUSTED_SECRET, now_seconds=now)
        self.assertEqual(ctx.exception.code, "SIGNATURE_MISMATCH")

    def test_verify_before_parse_rejects_invalid_json_at_hmac_stage(self):
        now = 1_750_000_000
        token = sign_hmac_token(
            sub="usr_1",
            tenant_id="tenant_alpha",
            role="developer",
            secret=TRUSTED_SECRET,
            ttl_seconds=600,
            now_seconds=now,
        )
        header_b64, _, sig_b64 = token.split(".")
        garbage_payload_b64 = _b64url(b"{not-valid-json!!!")

        with self.assertRaises(SovereignTokenError) as ctx:
            verify_hmac_token(f"{header_b64}.{garbage_payload_b64}.{sig_b64}", secret=TRUSTED_SECRET, now_seconds=now)
        self.assertEqual(ctx.exception.code, "SIGNATURE_MISMATCH")

    def test_claim_type_confusion_rejected_including_bool_for_exp(self):
        now = 1_750_000_000
        header_b64 = _b64url(json.dumps({"alg": "HS256", "typ": "ZY-TOKEN"}).encode("utf-8"))
        # In Python isinstance(True, int) is True; verify_hmac_token must explicitly reject bools.
        payload_b64 = _b64url(
            json.dumps(
                {"sub": "usr_1", "tenantId": "tenant_alpha", "role": "admin", "iat": now, "exp": True}
            ).encode("utf-8")
        )
        sig_b64 = _b64url(
            hmac.new(TRUSTED_SECRET.encode("utf-8"), f"{header_b64}.{payload_b64}".encode("ascii"), hashlib.sha256).digest()
        )
        with self.assertRaises(SovereignTokenError) as ctx:
            verify_hmac_token(f"{header_b64}.{payload_b64}.{sig_b64}", secret=TRUSTED_SECRET, now_seconds=now)
        self.assertEqual(ctx.exception.code, "INVALID_CLAIMS")

    def test_expired_token_and_clock_skew_leeway(self):
        now = 1_750_000_000
        token = sign_hmac_token(
            sub="usr_exp",
            tenant_id="tenant_alpha",
            role="developer",
            secret=TRUSTED_SECRET,
            ttl_seconds=60,
            now_seconds=now,
        )

        # Within 30s leeway (15s past exp) -> passes
        claims = verify_hmac_token(token, secret=TRUSTED_SECRET, now_seconds=now + 75)
        self.assertEqual(claims["sub"], "usr_exp")

        # Strict mode (0s leeway) -> rejected
        with self.assertRaises(SovereignTokenError) as ctx_strict:
            verify_hmac_token(token, secret=TRUSTED_SECRET, now_seconds=now + 75, clock_skew_seconds=0)
        self.assertEqual(ctx_strict.exception.code, "TOKEN_EXPIRED")

        # Beyond 30s leeway -> rejected
        with self.assertRaises(SovereignTokenError) as ctx_expired:
            verify_hmac_token(
                token,
                secret=TRUSTED_SECRET,
                now_seconds=now + 60 + DEFAULT_CLOCK_SKEW_SECONDS,
            )
        self.assertEqual(ctx_expired.exception.code, "TOKEN_EXPIRED")

    def test_future_iat_rejected_beyond_leeway(self):
        now = 1_750_000_000
        token = sign_hmac_token(
            sub="usr_future",
            tenant_id="tenant_alpha",
            role="developer",
            secret=TRUSTED_SECRET,
            ttl_seconds=600,
            now_seconds=now + 120,
        )
        with self.assertRaises(SovereignTokenError) as ctx:
            verify_hmac_token(token, secret=TRUSTED_SECRET, now_seconds=now)
        self.assertEqual(ctx.exception.code, "TOKEN_NOT_YET_VALID")

    def test_oversized_token_rejected_before_parsing(self):
        huge_token = "a" * (MAX_TOKEN_LENGTH + 1)
        with self.assertRaises(SovereignTokenError) as ctx:
            verify_hmac_token(huge_token, secret=TRUSTED_SECRET)
        self.assertEqual(ctx.exception.code, "TOKEN_TOO_LONG")

    def test_tenant_isolation_and_rbac_enforcement(self):
        now = 1_750_000_000
        token = sign_hmac_token(
            sub="usr_dev",
            tenant_id="tenant_alpha",
            role="developer",
            secret=TRUSTED_SECRET,
            ttl_seconds=300,
            now_seconds=now,
        )

        with self.assertRaises(SovereignTokenError) as ctx_tenant:
            verify_hmac_token(
                token,
                secret=TRUSTED_SECRET,
                expected_tenant_id="tenant_beta",
                now_seconds=now,
            )
        self.assertEqual(ctx_tenant.exception.code, "TENANT_MISMATCH")

        with self.assertRaises(SovereignTokenError) as ctx_role:
            verify_hmac_token(
                token,
                secret=TRUSTED_SECRET,
                expected_tenant_id="tenant_alpha",
                required_role="admin",
                now_seconds=now,
            )
        self.assertEqual(ctx_role.exception.code, "UNAUTHORIZED_ROLE")

    def test_cross_language_ts_token_verified_in_python(self):
        node_bin = shutil.which("node")
        tsx_bin = os.path.join(ROOT, "node_modules", ".bin", "tsx")
        if not node_bin or not os.path.exists(tsx_bin):
            self.skipTest("node/tsx not available for cross-language check")

        now = 1_750_000_000
        script = (
            "import { signHmacToken } from './src/auth/sovereign_token.ts';"
            f"const {{ token }} = signHmacToken({{ sub: 'usr_xlang', tenantId: 'tenant_alpha', role: 'operator' }}, "
            f"{{ secret: {json.dumps(TRUSTED_SECRET)}, ttlSeconds: 300, nowSeconds: {now} }});"
            "console.log(token);"
        )
        res = subprocess.run(
            [tsx_bin, "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        ts_token = res.stdout.strip()
        claims = verify_hmac_token(
            ts_token,
            secret=TRUSTED_SECRET,
            expected_tenant_id="tenant_alpha",
            required_role="developer",
            now_seconds=now + 10,
        )
        self.assertEqual(claims["sub"], "usr_xlang")
        self.assertEqual(claims["role"], "operator")


if __name__ == "__main__":
    unittest.main(verbosity=2)
