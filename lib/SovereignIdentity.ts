/**
 * ZYNTHEOR Sovereign Identity & Access Layer
 * Hardened First-Party Cryptographic Token Validator & RBAC Engine.
 * 
 * Strict Security Invariants:
 * 1. No hardcoded default secrets (must load from env or fail-closed).
 * 2. Constant-time signature comparison using crypto.timingSafeEqual().
 * 3. Strict token expiration (exp) and issue-time (iat) verification.
 * 4. Algorithm validation (enforces HS256, rejects "none" and spoofed headers).
 * 5. Strict 3-part token structure validation.
 * 6. Safe JSON parsing with comprehensive exception boundaries.
 * 7. Tenant isolation enforcement (prevents cross-tenant token replay).
 * 8. Role-based authorization & privilege escalation prevention.
 */

import crypto from 'crypto';
import { AuditLedger } from './AuditLedger';

export type SovereignRole = 'guest' | 'developer' | 'operator' | 'admin' | 'auditor';

export interface TokenHeader {
  alg: 'HS256';
  typ: 'ZY-TOKEN';
}

export interface TokenPayload {
  sub: string;             // Subject (User / Agent ID)
  tenantId: string;        // Tenant isolation domain
  role: SovereignRole;     // Authorized role
  iat: number;             // Issued at (unix seconds)
  exp: number;             // Expiration (unix seconds)
  jti?: string;            // Unique JWT ID to prevent replay attacks
  scope?: string[];        // Authorized scopes
}

export interface VerificationResult {
  valid: boolean;
  code: 
    | 'VERIFIED'
    | 'MISSING_SECRET'
    | 'MALFORMED_STRUCTURE'
    | 'INVALID_HEADER'
    | 'UNSUPPORTED_ALGORITHM'
    | 'MALFORMED_JSON'
    | 'SIGNATURE_MISMATCH'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_NOT_YET_VALID'
    | 'TENANT_MISMATCH'
    | 'UNAUTHORIZED_ROLE';
  reason: string;
  payload?: TokenPayload;
  latencyMs?: number;
}

export class SovereignIdentity {
  private static instance: SovereignIdentity | null = null;
  private masterSecret: Buffer;

  private static readonly ROLE_HIERARCHY: Record<SovereignRole, number> = {
    guest: 1,
    developer: 2,
    operator: 3,
    auditor: 4,
    admin: 5
  };

  private constructor() {
    // 1. Secret Management: MUST load from environment or generate a secure ephemeral 32-byte secret.
    // ABSOLUTE BAN on weak hardcoded strings like 'zyntheor-sovereign-master-secret'.
    const envSecret = process.env.ZYNTHEOR_MASTER_SECRET;
    if (envSecret && envSecret.trim().length >= 32) {
      this.masterSecret = Buffer.from(envSecret.trim(), 'utf8');
    } else {
      // Ephemeral crypto-random 256-bit key if not specified
      this.masterSecret = crypto.randomBytes(32);
      AuditLedger.append('SYSTEM', 'IDENTITY_EPHEMERAL_SECRET_GENERATED', {
        bits: 256,
        source: 'crypto.randomBytes(32)',
        warning: 'Set ZYNTHEOR_MASTER_SECRET in environment for cross-reboot persistence.'
      });
    }
  }

  public static getInstance(): SovereignIdentity {
    if (!SovereignIdentity.instance) {
      SovereignIdentity.instance = new SovereignIdentity();
    }
    return SovereignIdentity.instance;
  }

  /**
   * Helper: base64url encode Buffer or string
   */
  private base64UrlEncode(input: Buffer | string): string {
    const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    return buf.toString('base64url');
  }

  /**
   * Helper: base64url decode with safety check
   */
  private base64UrlDecode(str: string): Buffer {
    return Buffer.from(str, 'base64url');
  }

  /**
   * Issues a signed sovereign token with strict header, exp, iat, and tenant invariants.
   */
  public signToken(params: {
    sub: string;
    tenantId: string;
    role: SovereignRole;
    ttlSeconds?: number;
    scope?: string[];
  }): { token: string; payload: TokenPayload } {
    const now = Math.floor(Date.now() / 1000);
    const ttl = params.ttlSeconds || 3600; // Default 1 hour TTL

    const header: TokenHeader = {
      alg: 'HS256',
      typ: 'ZY-TOKEN'
    };

    const payload: TokenPayload = {
      sub: params.sub,
      tenantId: params.tenantId,
      role: params.role,
      iat: now,
      exp: now + ttl,
      jti: crypto.randomUUID(),
      scope: params.scope || ['workspace:read', 'workspace:execute']
    };

    const headerB64 = this.base64UrlEncode(JSON.stringify(header));
    const payloadB64 = this.base64UrlEncode(JSON.stringify(payload));
    const signaturePreimage = `${headerB64}.${payloadB64}`;

    const signature = crypto
      .createHmac('sha256', this.masterSecret)
      .update(signaturePreimage)
      .digest();

    const signatureB64 = signature.toString('base64url');
    const token = `${signaturePreimage}.${signatureB64}`;

    AuditLedger.append('COMMERCIAL', 'TOKEN_ISSUED', {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      exp: payload.exp,
      jti: payload.jti
    });

    return { token, payload };
  }

  /**
   * Verifies token with constant-time comparison, header verification, expiration checks, and JSON safety.
   */
  public verifyToken(
    rawToken: string,
    options: {
      expectedTenantId?: string;
      requiredRole?: SovereignRole;
      currentTimestamp?: number;
    } = {}
  ): VerificationResult {
    const startTime = Date.now();

    if (!rawToken || typeof rawToken !== 'string') {
      return {
        valid: false,
        code: 'MALFORMED_STRUCTURE',
        reason: 'Token string is empty or missing.',
        latencyMs: Date.now() - startTime
      };
    }

    // 1. Strict 3-part structure check
    const parts = rawToken.split('.');
    if (parts.length !== 3) {
      return {
        valid: false,
        code: 'MALFORMED_STRUCTURE',
        reason: `Expected exactly 3 segments (header.payload.signature), received ${parts.length}.`,
        latencyMs: Date.now() - startTime
      };
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) {
      return {
        valid: false,
        code: 'MALFORMED_STRUCTURE',
        reason: 'One or more token segments are zero-length.',
        latencyMs: Date.now() - startTime
      };
    }

    // 2. Safe Header Parse & Algorithm Validation
    let header: TokenHeader;
    try {
      const headerJson = this.base64UrlDecode(headerB64).toString('utf8');
      header = JSON.parse(headerJson);
    } catch {
      return {
        valid: false,
        code: 'MALFORMED_JSON',
        reason: 'Header is not valid JSON.',
        latencyMs: Date.now() - startTime
      };
    }

    if (header.alg !== 'HS256' || header.typ !== 'ZY-TOKEN') {
      AuditLedger.append('SYSTEM', 'SECURITY_UNSUPPORTED_ALGORITHM_REJECTED', {
        attemptedAlg: header.alg,
        attemptedTyp: header.typ
      });
      return {
        valid: false,
        code: 'UNSUPPORTED_ALGORITHM',
        reason: `Unsupported algorithm or token type. Expected HS256/ZY-TOKEN, got ${header.alg}/${header.typ}.`,
        latencyMs: Date.now() - startTime
      };
    }

    // 3. Constant-Time Cryptographic Signature Check (timingSafeEqual)
    const preimage = `${headerB64}.${payloadB64}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.masterSecret)
      .update(preimage)
      .digest();

    let actualSignature: Buffer;
    try {
      actualSignature = this.base64UrlDecode(signatureB64);
    } catch {
      return {
        valid: false,
        code: 'SIGNATURE_MISMATCH',
        reason: 'Malformed signature encoding.',
        latencyMs: Date.now() - startTime
      };
    }

    // Buffer length must match before timingSafeEqual to avoid RangeError
    if (
      actualSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(actualSignature, expectedSignature)
    ) {
      AuditLedger.append('SYSTEM', 'SECURITY_SIGNATURE_TAMPER_DETECTED', {
        reason: 'Cryptographic HMAC mismatch'
      });
      return {
        valid: false,
        code: 'SIGNATURE_MISMATCH',
        reason: 'HMAC signature verification failed. Token has been tampered with or signed with an untrusted key.',
        latencyMs: Date.now() - startTime
      };
    }

    // 4. Safe Payload Parse
    let payload: TokenPayload;
    try {
      const payloadJson = this.base64UrlDecode(payloadB64).toString('utf8');
      payload = JSON.parse(payloadJson);
    } catch {
      return {
        valid: false,
        code: 'MALFORMED_JSON',
        reason: 'Payload is not valid JSON.',
        latencyMs: Date.now() - startTime
      };
    }

    // 5. Expiration & Temporal Validity
    const now = options.currentTimestamp !== undefined ? options.currentTimestamp : Math.floor(Date.now() / 1000);

    if (typeof payload.exp !== 'number' || payload.exp < now) {
      return {
        valid: false,
        code: 'TOKEN_EXPIRED',
        reason: `Token expired at unix ${payload.exp} (current time is ${now}).`,
        payload,
        latencyMs: Date.now() - startTime
      };
    }

    if (typeof payload.iat !== 'number' || payload.iat > now + 60) {
      return {
        valid: false,
        code: 'TOKEN_NOT_YET_VALID',
        reason: `Token issued in the future (iat: ${payload.iat}, current: ${now}).`,
        payload,
        latencyMs: Date.now() - startTime
      };
    }

    // 6. Tenant Isolation Enforcement
    if (options.expectedTenantId && payload.tenantId !== options.expectedTenantId) {
      AuditLedger.append('SYSTEM', 'SECURITY_CROSS_TENANT_VIOLATION_BLOCKED', {
        tokenTenant: payload.tenantId,
        requestedTenant: options.expectedTenantId,
        sub: payload.sub
      });
      return {
        valid: false,
        code: 'TENANT_MISMATCH',
        reason: `Cross-tenant access forbidden. Token belongs to tenant '${payload.tenantId}', requested resource is in '${options.expectedTenantId}'.`,
        payload,
        latencyMs: Date.now() - startTime
      };
    }

    // 7. Role Authorization Enforcement
    if (options.requiredRole) {
      const tokenLevel = SovereignIdentity.ROLE_HIERARCHY[payload.role] || 0;
      const requiredLevel = SovereignIdentity.ROLE_HIERARCHY[options.requiredRole] || 999;

      if (tokenLevel < requiredLevel) {
        AuditLedger.append('SYSTEM', 'SECURITY_PRIVILEGE_ESCALATION_BLOCKED', {
          sub: payload.sub,
          currentRole: payload.role,
          requiredRole: options.requiredRole
        });
        return {
          valid: false,
          code: 'UNAUTHORIZED_ROLE',
          reason: `Insufficient privileges. Role '${payload.role}' lacks level required for '${options.requiredRole}'.`,
          payload,
          latencyMs: Date.now() - startTime
        };
      }
    }

    return {
      valid: true,
      code: 'VERIFIED',
      reason: 'Token passed all cryptographic, temporal, tenant, and role invariants.',
      payload,
      latencyMs: Date.now() - startTime
    };
  }

  /**
   * Executes the 6-test Sovereign Security Attack Simulation Suite to verify true hardening.
   */
  public runSecuritySimulation(): Array<{
    testId: string;
    attackVector: string;
    simulatedBehavior: string;
    expectedResult: string;
    actualResult: string;
    status: 'PASS' | 'FAIL';
    evidence: string;
  }> {
    const results: Array<{
      testId: string;
      attackVector: string;
      simulatedBehavior: string;
      expectedResult: string;
      actualResult: string;
      status: 'PASS' | 'FAIL';
      evidence: string;
    }> = [];

    // Test 1: Tampered Signature
    const { token: legitToken } = this.signToken({
      sub: 'usr_001',
      tenantId: 'tenant_alpha',
      role: 'developer'
    });
    const tamperedSigToken = legitToken.slice(0, -6) + 'xxxxxx';
    const res1 = this.verifyToken(tamperedSigToken);
    results.push({
      testId: 'SEC-01',
      attackVector: 'Tampered Signature & Bit Flip',
      simulatedBehavior: 'Attacker flips characters in HMAC segment',
      expectedResult: 'SIGNATURE_MISMATCH via crypto.timingSafeEqual()',
      actualResult: res1.code,
      status: res1.code === 'SIGNATURE_MISMATCH' ? 'PASS' : 'FAIL',
      evidence: res1.reason
    });

    // Test 2: Expired Token
    const { token: expiredToken } = this.signToken({
      sub: 'usr_002',
      tenantId: 'tenant_alpha',
      role: 'developer',
      ttlSeconds: -10 // Already expired 10s ago
    });
    const res2 = this.verifyToken(expiredToken);
    results.push({
      testId: 'SEC-02',
      attackVector: 'Expired Token Replay',
      simulatedBehavior: 'Client presents token with exp < now',
      expectedResult: 'TOKEN_EXPIRED rejection',
      actualResult: res2.code,
      status: res2.code === 'TOKEN_EXPIRED' ? 'PASS' : 'FAIL',
      evidence: res2.reason
    });

    // Test 3: Wrong Secret / Untrusted Issuer
    const foreignSecret = crypto.randomBytes(32);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'ZY-TOKEN' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'usr_rogue', tenantId: 'tenant_alpha', role: 'admin', exp: Date.now() + 10000 })).toString('base64url');
    const foreignSig = crypto.createHmac('sha256', foreignSecret).update(`${header}.${body}`).digest('base64url');
    const rogueToken = `${header}.${body}.${foreignSig}`;
    const res3 = this.verifyToken(rogueToken);
    results.push({
      testId: 'SEC-03',
      attackVector: 'Untrusted Secret Key Signature',
      simulatedBehavior: 'Attacker signs token with own external secret',
      expectedResult: 'SIGNATURE_MISMATCH',
      actualResult: res3.code,
      status: res3.code === 'SIGNATURE_MISMATCH' ? 'PASS' : 'FAIL',
      evidence: res3.reason
    });

    // Test 4: Malformed Structure & Injected JSON
    const malformedToken = `eyJhbGciOiJub25lIn0.invalid-json-payload-not-base64.extra-garbage`;
    const res4 = this.verifyToken(malformedToken);
    results.push({
      testId: 'SEC-04',
      attackVector: 'Malformed Structure & None-Alg Injection',
      simulatedBehavior: 'Attacker injects alg:none and malformed JSON',
      expectedResult: 'UNSUPPORTED_ALGORITHM or MALFORMED_JSON',
      actualResult: res4.code,
      status: (res4.code === 'UNSUPPORTED_ALGORITHM' || res4.code === 'MALFORMED_JSON') ? 'PASS' : 'FAIL',
      evidence: res4.reason
    });

    // Test 5: Cross-Tenant Isolation Breach
    const { token: tenantBToken } = this.signToken({
      sub: 'usr_tenant_b',
      tenantId: 'tenant_finance',
      role: 'admin'
    });
    // Attempting to access tenant_health resource
    const res5 = this.verifyToken(tenantBToken, { expectedTenantId: 'tenant_health' });
    results.push({
      testId: 'SEC-05',
      attackVector: 'Cross-Tenant Resource Access',
      simulatedBehavior: 'Admin of Tenant B attempts to read Tenant A private resources',
      expectedResult: 'TENANT_MISMATCH violation blocked',
      actualResult: res5.code,
      status: res5.code === 'TENANT_MISMATCH' ? 'PASS' : 'FAIL',
      evidence: res5.reason
    });

    // Test 6: Privilege Escalation
    const { token: devToken } = this.signToken({
      sub: 'usr_dev',
      tenantId: 'tenant_alpha',
      role: 'developer'
    });
    // Attempting an admin-only operation
    const res6 = this.verifyToken(devToken, { requiredRole: 'admin' });
    results.push({
      testId: 'SEC-06',
      attackVector: 'Privilege Escalation Attempt',
      simulatedBehavior: 'Developer-tier token calls Admin-tier system endpoint',
      expectedResult: 'UNAUTHORIZED_ROLE blocked',
      actualResult: res6.code,
      status: res6.code === 'UNAUTHORIZED_ROLE' ? 'PASS' : 'FAIL',
      evidence: res6.reason
    });

    return results;
  }
}
