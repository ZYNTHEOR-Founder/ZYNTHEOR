import crypto from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_CLOCK_SKEW_SECONDS,
  MAX_TOKEN_LENGTH,
  SovereignTokenError,
  signHmacToken,
  verify_hmac_token,
} from '../sovereign_token.ts';

const TRUSTED_SECRET = 'zyntheor-sovereign-test-secret-key-at-least-32-bytes-long!';
const ATTACKER_SECRET = 'attacker-forged-secret-key-also-at-least-32-bytes-long!!';

function expectTokenError(fn: () => unknown, expectedCode: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(SovereignTokenError);
  expect((caught as SovereignTokenError).code).toBe(expectedCode);
}

describe('verify_hmac_token (TypeScript Sovereign Token Security Suite)', () => {
  it('verifies a legitimately signed token and preserves claims', () => {
    const now = 1_750_000_000;
    const { token } = signHmacToken(
      { sub: 'usr_alpha', tenantId: 'tenant_alpha', role: 'admin', scope: ['train:run'] },
      { secret: TRUSTED_SECRET, ttlSeconds: 300, nowSeconds: now }
    );

    const claims = verify_hmac_token(token, {
      secret: TRUSTED_SECRET,
      expectedTenantId: 'tenant_alpha',
      requiredRole: 'developer',
      nowSeconds: now + 60,
    });

    expect(claims.sub).toBe('usr_alpha');
    expect(claims.tenantId).toBe('tenant_alpha');
    expect(claims.role).toBe('admin');
    expect(claims.exp).toBe(now + 300);
    expect(claims.scope).toEqual(['train:run']);
  });

  describe('Forged token simulations', () => {
    it('rejects tokens signed with an untrusted/attacker secret', () => {
      const now = 1_750_000_000;
      const { token: forgedToken } = signHmacToken(
        { sub: 'usr_rogue', tenantId: 'tenant_alpha', role: 'admin' },
        { secret: ATTACKER_SECRET, ttlSeconds: 600, nowSeconds: now }
      );

      expectTokenError(
        () => verify_hmac_token(forgedToken, { secret: TRUSTED_SECRET, nowSeconds: now }),
        'SIGNATURE_MISMATCH'
      );
    });

    it('rejects tokens with bit-flipped or truncated HMAC signatures', () => {
      const now = 1_750_000_000;
      const { token } = signHmacToken(
        { sub: 'usr_1', tenantId: 'tenant_alpha', role: 'developer' },
        { secret: TRUSTED_SECRET, ttlSeconds: 600, nowSeconds: now }
      );
      const [h, p, s] = token.split('.');
      const flippedChar = s.endsWith('A') ? 'B' : 'A';
      const bitFlippedToken = `${h}.${p}.${s.slice(0, -1)}${flippedChar}`;
      const truncatedSigToken = `${h}.${p}.${s.slice(0, 10)}`;

      expectTokenError(
        () => verify_hmac_token(bitFlippedToken, { secret: TRUSTED_SECRET, nowSeconds: now }),
        'SIGNATURE_MISMATCH'
      );
      expectTokenError(
        () => verify_hmac_token(truncatedSigToken, { secret: TRUSTED_SECRET, nowSeconds: now }),
        'SIGNATURE_MISMATCH'
      );
    });

    it('rejects alg=none downgrade attacks', () => {
      const now = 1_750_000_000;
      const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'ZY-TOKEN' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'hacker', tenantId: 'tenant_alpha', role: 'admin', iat: now, exp: now + 600 })
      ).toString('base64url');

      expectTokenError(
        () => verify_hmac_token(`${noneHeader}.${payload}.`, { secret: TRUSTED_SECRET, nowSeconds: now }),
        'MALFORMED_STRUCTURE'
      );

      const signedWithTrustedKeyButWrongAlg = crypto
        .createHmac('sha256', Buffer.from(TRUSTED_SECRET, 'utf8'))
        .update(`${noneHeader}.${payload}`, 'ascii')
        .digest('base64url');

      expectTokenError(
        () =>
          verify_hmac_token(`${noneHeader}.${payload}.${signedWithTrustedKeyButWrongAlg}`, {
            secret: TRUSTED_SECRET,
            nowSeconds: now,
          }),
        'UNSUPPORTED_ALGORITHM'
      );
    });
  });

  describe('Payload tampering attempts (Verify-Before-Parse)', () => {
    it('rejects privilege escalation when payload is swapped without re-signing', () => {
      const now = 1_750_000_000;
      const { token } = signHmacToken(
        { sub: 'usr_dev', tenantId: 'tenant_alpha', role: 'developer' },
        { secret: TRUSTED_SECRET, ttlSeconds: 600, nowSeconds: now }
      );
      const [headerB64, , sigB64] = token.split('.');
      const tamperedPayloadB64 = Buffer.from(
        JSON.stringify({
          sub: 'usr_dev',
          tenantId: 'tenant_alpha',
          role: 'admin',
          iat: now,
          exp: now + 600,
        })
      ).toString('base64url');

      expectTokenError(
        () => verify_hmac_token(`${headerB64}.${tamperedPayloadB64}.${sigB64}`, { secret: TRUSTED_SECRET, nowSeconds: now }),
        'SIGNATURE_MISMATCH'
      );
    });

    it('rejects malformed non-JSON payload BEFORE JSON.parse on signature mismatch', () => {
      const now = 1_750_000_000;
      const { token } = signHmacToken(
        { sub: 'usr_1', tenantId: 'tenant_alpha', role: 'developer' },
        { secret: TRUSTED_SECRET, ttlSeconds: 600, nowSeconds: now }
      );
      const [headerB64, , sigB64] = token.split('.');
      const garbagePayloadB64 = Buffer.from('{not-valid-json!!!', 'utf8').toString('base64url');

      // Must fail with SIGNATURE_MISMATCH rather than MALFORMED_JSON (proving verify-before-parse)
      expectTokenError(
        () => verify_hmac_token(`${headerB64}.${garbagePayloadB64}.${sigB64}`, { secret: TRUSTED_SECRET, nowSeconds: now }),
        'SIGNATURE_MISMATCH'
      );
    });

    it('rejects claim type confusion even if signed by an insider', () => {
      const now = 1_750_000_000;
      const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'ZY-TOKEN' })).toString('base64url');
      const confusedPayloadB64 = Buffer.from(
        JSON.stringify({
          sub: 'usr_1',
          tenantId: ['tenant_alpha'], // invalid array instead of string
          role: 'admin',
          iat: now,
          exp: '9999999999', // invalid string instead of number
        })
      ).toString('base64url');
      const sigB64 = crypto
        .createHmac('sha256', Buffer.from(TRUSTED_SECRET, 'utf8'))
        .update(`${headerB64}.${confusedPayloadB64}`, 'ascii')
        .digest('base64url');

      expectTokenError(
        () => verify_hmac_token(`${headerB64}.${confusedPayloadB64}.${sigB64}`, { secret: TRUSTED_SECRET, nowSeconds: now }),
        'INVALID_CLAIMS'
      );
    });
  });

  describe('Expired tokens & Clock Skew leeway', () => {
    it('rejects tokens expired past the 30-second clock skew leeway', () => {
      const now = 1_750_000_000;
      const { token } = signHmacToken(
        { sub: 'usr_exp', tenantId: 'tenant_alpha', role: 'developer' },
        { secret: TRUSTED_SECRET, ttlSeconds: 60, nowSeconds: now }
      );

      // exp = now + 60; at now + 60 + 30 (exp + 30 <= current) it must be rejected
      expectTokenError(
        () =>
          verify_hmac_token(token, {
            secret: TRUSTED_SECRET,
            nowSeconds: now + 60 + DEFAULT_CLOCK_SKEW_SECONDS,
          }),
        'TOKEN_EXPIRED'
      );
    });

    it('allows tokens within the 30s clock skew window by default and rejects when leeway=0', () => {
      const now = 1_750_000_000;
      const { token } = signHmacToken(
        { sub: 'usr_skew', tenantId: 'tenant_alpha', role: 'developer' },
        { secret: TRUSTED_SECRET, ttlSeconds: 60, nowSeconds: now }
      );

      // 15 seconds past exp -> accepted under 30s leeway
      const claims = verify_hmac_token(token, {
        secret: TRUSTED_SECRET,
        nowSeconds: now + 75,
      });
      expect(claims.sub).toBe('usr_skew');

      // Rejected when strict clockSkewSeconds = 0
      expectTokenError(
        () =>
          verify_hmac_token(token, {
            secret: TRUSTED_SECRET,
            nowSeconds: now + 75,
            clockSkewSeconds: 0,
          }),
        'TOKEN_EXPIRED'
      );
    });

    it('rejects tokens issued in the future beyond clock skew leeway', () => {
      const now = 1_750_000_000;
      const { token } = signHmacToken(
        { sub: 'usr_future', tenantId: 'tenant_alpha', role: 'developer' },
        { secret: TRUSTED_SECRET, ttlSeconds: 600, nowSeconds: now + 120 }
      );

      expectTokenError(
        () => verify_hmac_token(token, { secret: TRUSTED_SECRET, nowSeconds: now }),
        'TOKEN_NOT_YET_VALID'
      );
    });
  });

  describe('DoS guards, tenant isolation, RBAC & secret hardening', () => {
    it('rejects oversized tokens exceeding MAX_TOKEN_LENGTH (4096) to prevent DoS', () => {
      const hugeToken = 'a'.repeat(MAX_TOKEN_LENGTH + 1);
      expectTokenError(
        () => verify_hmac_token(hugeToken, { secret: TRUSTED_SECRET }),
        'TOKEN_TOO_LONG'
      );
    });

    it('blocks cross-tenant replay and insufficient roles', () => {
      const now = 1_750_000_000;
      const { token } = signHmacToken(
        { sub: 'usr_dev', tenantId: 'tenant_alpha', role: 'developer' },
        { secret: TRUSTED_SECRET, ttlSeconds: 300, nowSeconds: now }
      );

      expectTokenError(
        () =>
          verify_hmac_token(token, {
            secret: TRUSTED_SECRET,
            expectedTenantId: 'tenant_beta',
            nowSeconds: now,
          }),
        'TENANT_MISMATCH'
      );

      expectTokenError(
        () =>
          verify_hmac_token(token, {
            secret: TRUSTED_SECRET,
            expectedTenantId: 'tenant_alpha',
            requiredRole: 'admin',
            nowSeconds: now,
          }),
        'UNAUTHORIZED_ROLE'
      );
    });

    it('fails closed when secret is missing or shorter than 32 bytes', () => {
      const prevTokenSecret = process.env.ZYNTHEOR_TOKEN_SECRET;
      const prevMasterSecret = process.env.ZYNTHEOR_MASTER_SECRET;
      delete process.env.ZYNTHEOR_TOKEN_SECRET;
      delete process.env.ZYNTHEOR_MASTER_SECRET;

      try {
        expectTokenError(() => verify_hmac_token('a.b.c'), 'MISSING_SECRET');
        expectTokenError(() => verify_hmac_token('a.b.c', { secret: 'short-secret' }), 'WEAK_SECRET');
      } finally {
        if (prevTokenSecret !== undefined) process.env.ZYNTHEOR_TOKEN_SECRET = prevTokenSecret;
        if (prevMasterSecret !== undefined) process.env.ZYNTHEOR_MASTER_SECRET = prevMasterSecret;
      }
    });
  });
});
