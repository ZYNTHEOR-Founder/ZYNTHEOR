import crypto from 'node:crypto';

export type SovereignRole = 'guest' | 'developer' | 'operator' | 'auditor' | 'admin';

export const MAX_TOKEN_LENGTH = 4096;
export const MIN_SECRET_BYTES = 32;
export const DEFAULT_CLOCK_SKEW_SECONDS = 30;

export const ROLE_HIERARCHY: Readonly<Record<SovereignRole, number>> = {
  guest: 1,
  developer: 2,
  operator: 3,
  auditor: 4,
  admin: 5,
};

export interface TokenHeader {
  alg: 'HS256';
  typ: 'ZY-TOKEN';
}

export interface SovereignTokenClaims {
  sub: string;
  tenantId: string;
  role: SovereignRole;
  iat: number;
  exp: number;
  jti?: string;
  scope?: string[];
}

export type TokenErrorCode =
  | 'MISSING_SECRET'
  | 'WEAK_SECRET'
  | 'TOKEN_TOO_LONG'
  | 'MALFORMED_STRUCTURE'
  | 'SIGNATURE_MISMATCH'
  | 'UNSUPPORTED_ALGORITHM'
  | 'MALFORMED_JSON'
  | 'INVALID_CLAIMS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_YET_VALID'
  | 'TENANT_MISMATCH'
  | 'UNAUTHORIZED_ROLE';

export class SovereignTokenError extends Error {
  public readonly code: TokenErrorCode;

  constructor(code: TokenErrorCode, message: string) {
    super(message);
    this.name = 'SovereignTokenError';
    this.code = code;
  }
}

export interface SignTokenOptions {
  secret?: string | Buffer;
  ttlSeconds?: number;
  nowSeconds?: number;
  jti?: string;
  scope?: string[];
}

export interface VerifyTokenOptions {
  secret?: string | Buffer;
  expectedTenantId?: string;
  requiredRole?: SovereignRole;
  nowSeconds?: number;
  clockSkewSeconds?: number;
  maxTokenLength?: number;
}

const BASE64URL_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function resolveSecretBuffer(secret?: string | Buffer): Buffer {
  const raw =
    secret !== undefined
      ? secret
      : process.env.ZYNTHEOR_TOKEN_SECRET ?? process.env.ZYNTHEOR_MASTER_SECRET;

  if (raw === undefined || raw === null) {
    throw new SovereignTokenError('MISSING_SECRET', 'Token secret is not configured.');
  }

  const buf = typeof raw === 'string' ? Buffer.from(raw.trim(), 'utf8') : raw;
  if (buf.length === 0) {
    throw new SovereignTokenError('MISSING_SECRET', 'Token secret is empty.');
  }
  if (buf.length < MIN_SECRET_BYTES) {
    throw new SovereignTokenError(
      'WEAK_SECRET',
      `Token secret must be at least ${MIN_SECRET_BYTES} bytes (got ${buf.length}).`
    );
  }
  return buf;
}

function hasDangerousKeys(obj: unknown, seen = new Set<unknown>()): boolean {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return false;
  seen.add(obj);
  if (Array.isArray(obj)) {
    return obj.some((item) => hasDangerousKeys(item, seen));
  }
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    const val = (obj as Record<string, unknown>)[key];
    if (hasDangerousKeys(val, seen)) return true;
  }
  return false;
}

function parseJsonSafe(rawJson: string, label: string): Record<string, unknown> {
  if (/"(?:__proto__|constructor|prototype)"\s*:/.test(rawJson)) {
    throw new SovereignTokenError('MALFORMED_JSON', `${label} contains disallowed prototype key.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new SovereignTokenError('MALFORMED_JSON', `${label} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || hasDangerousKeys(parsed)) {
    throw new SovereignTokenError('MALFORMED_JSON', `${label} must be a plain JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Constant-time UTF-8 string comparison using crypto.timingSafeEqual.
 */
export function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function signHmacToken(
  input: {
    sub: string;
    tenantId: string;
    role: SovereignRole;
    scope?: string[];
  },
  options: SignTokenOptions = {}
): { token: string; claims: SovereignTokenClaims } {
  const secretBuf = resolveSecretBuffer(options.secret);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? 3600;

  if (!input.sub || typeof input.sub !== 'string') {
    throw new SovereignTokenError('INVALID_CLAIMS', 'sub must be a non-empty string.');
  }
  if (!input.tenantId || typeof input.tenantId !== 'string') {
    throw new SovereignTokenError('INVALID_CLAIMS', 'tenantId must be a non-empty string.');
  }
  if (!(input.role in ROLE_HIERARCHY)) {
    throw new SovereignTokenError('INVALID_CLAIMS', `Unsupported role: ${String(input.role)}`);
  }

  const header: TokenHeader = { alg: 'HS256', typ: 'ZY-TOKEN' };
  const claims: SovereignTokenClaims = {
    sub: input.sub,
    tenantId: input.tenantId,
    role: input.role,
    iat: now,
    exp: now + ttl,
    jti: options.jti ?? crypto.randomUUID(),
    ...(input.scope ?? options.scope ? { scope: input.scope ?? options.scope } : {}),
  };

  const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const preimage = `${headerB64}.${payloadB64}`;

  const signatureB64 = crypto
    .createHmac('sha256', secretBuf)
    .update(preimage, 'ascii')
    .digest('base64url');

  return { token: `${preimage}.${signatureB64}`, claims };
}

/**
 * Verifies an HS256 ZY-TOKEN with DoS max-length guard, verify-before-parse HMAC check,
 * constant-time signature & tenant comparison, type validation, and clock-skew leeway.
 */
export function verifyHmacToken(
  rawToken: string,
  options: VerifyTokenOptions = {}
): SovereignTokenClaims {
  const maxLen = options.maxTokenLength ?? MAX_TOKEN_LENGTH;

  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    throw new SovereignTokenError('MALFORMED_STRUCTURE', 'Token string is empty or missing.');
  }

  // 1. DoS Protection: enforce max token length before splitting, decoding, or hashing.
  if (rawToken.length > maxLen) {
    throw new SovereignTokenError(
      'TOKEN_TOO_LONG',
      `Token length ${rawToken.length} exceeds maximum allowed ${maxLen} characters.`
    );
  }

  // 2. Fail-closed secret check (>= 32 bytes).
  const secretBuf = resolveSecretBuffer(options.secret);

  // 3. Strict 3-segment base64url structure check.
  const parts = rawToken.split('.');
  if (parts.length !== 3) {
    throw new SovereignTokenError(
      'MALFORMED_STRUCTURE',
      `Expected 3 segments (header.payload.signature), got ${parts.length}.`
    );
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  if (
    !headerB64 ||
    !payloadB64 ||
    !signatureB64 ||
    !BASE64URL_SEGMENT_RE.test(headerB64) ||
    !BASE64URL_SEGMENT_RE.test(payloadB64) ||
    !BASE64URL_SEGMENT_RE.test(signatureB64)
  ) {
    throw new SovereignTokenError('MALFORMED_STRUCTURE', 'Token contains empty or non-base64url segments.');
  }

  // 4. Verify-Before-Parse: verify HMAC-SHA256 over exact raw preimage BEFORE JSON.parse.
  const preimage = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac('sha256', secretBuf).update(preimage, 'ascii').digest();
  const actualSig = Buffer.from(signatureB64, 'base64url');

  if (
    actualSig.toString('base64url') !== signatureB64 ||
    actualSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(actualSig, expectedSig)
  ) {
    throw new SovereignTokenError(
      'SIGNATURE_MISMATCH',
      'HMAC-SHA256 signature verification failed.'
    );
  }

  // 5. Safe header parsing & algorithm enforcement (only after HMAC succeeds).
  const headerObj = parseJsonSafe(Buffer.from(headerB64, 'base64url').toString('utf8'), 'Header');
  if (headerObj.alg !== 'HS256' || headerObj.typ !== 'ZY-TOKEN') {
    throw new SovereignTokenError(
      'UNSUPPORTED_ALGORITHM',
      `Unsupported header alg/typ: ${String(headerObj.alg)}/${String(headerObj.typ)}.`
    );
  }

  // 6. Safe payload parsing & strict claim type validation.
  const payloadObj = parseJsonSafe(Buffer.from(payloadB64, 'base64url').toString('utf8'), 'Payload');

  if (typeof payloadObj.sub !== 'string' || payloadObj.sub.length === 0) {
    throw new SovereignTokenError('INVALID_CLAIMS', 'Claim "sub" must be a non-empty string.');
  }
  if (typeof payloadObj.tenantId !== 'string' || payloadObj.tenantId.length === 0) {
    throw new SovereignTokenError('INVALID_CLAIMS', 'Claim "tenantId" must be a non-empty string.');
  }
  if (typeof payloadObj.role !== 'string' || !(payloadObj.role in ROLE_HIERARCHY)) {
    throw new SovereignTokenError('INVALID_CLAIMS', 'Claim "role" is missing or invalid.');
  }
  if (typeof payloadObj.exp !== 'number' || !Number.isFinite(payloadObj.exp)) {
    throw new SovereignTokenError('INVALID_CLAIMS', 'Claim "exp" must be a finite number.');
  }
  if (
    payloadObj.iat !== undefined &&
    (typeof payloadObj.iat !== 'number' || !Number.isFinite(payloadObj.iat))
  ) {
    throw new SovereignTokenError('INVALID_CLAIMS', 'Claim "iat" must be a finite number.');
  }
  if (
    payloadObj.scope !== undefined &&
    (!Array.isArray(payloadObj.scope) || payloadObj.scope.some((s) => typeof s !== 'string'))
  ) {
    throw new SovereignTokenError('INVALID_CLAIMS', 'Claim "scope" must be a string array.');
  }

  const claims: SovereignTokenClaims = {
    sub: payloadObj.sub,
    tenantId: payloadObj.tenantId,
    role: payloadObj.role as SovereignRole,
    iat: typeof payloadObj.iat === 'number' ? payloadObj.iat : 0,
    exp: payloadObj.exp,
    ...(typeof payloadObj.jti === 'string' ? { jti: payloadObj.jti } : {}),
    ...(Array.isArray(payloadObj.scope) ? { scope: payloadObj.scope } : {}),
  };

  // 7. Temporal validation with clock skew leeway (default 30s).
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const leeway = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;

  if (claims.exp + leeway <= now) {
    throw new SovereignTokenError(
      'TOKEN_EXPIRED',
      `Token expired at ${claims.exp} (now=${now}, leeway=${leeway}s).`
    );
  }
  if (typeof payloadObj.iat === 'number' && payloadObj.iat - leeway > now) {
    throw new SovereignTokenError(
      'TOKEN_NOT_YET_VALID',
      `Token issued in the future (iat=${payloadObj.iat}, now=${now}, leeway=${leeway}s).`
    );
  }

  // 8. Constant-time tenant isolation check.
  if (
    options.expectedTenantId !== undefined &&
    !constantTimeStringEqual(claims.tenantId, options.expectedTenantId)
  ) {
    throw new SovereignTokenError(
      'TENANT_MISMATCH',
      `Cross-tenant token rejected: expected '${options.expectedTenantId}'.`
    );
  }

  // 9. Role authorization check.
  if (options.requiredRole !== undefined) {
    const actualRank = ROLE_HIERARCHY[claims.role];
    const requiredRank = ROLE_HIERARCHY[options.requiredRole];
    if (actualRank < requiredRank) {
      throw new SovereignTokenError(
        'UNAUTHORIZED_ROLE',
        `Role '${claims.role}' lacks required privilege '${options.requiredRole}'.`
      );
    }
  }

  return claims;
}

export const sign_hmac_token = signHmacToken;
export const verify_hmac_token = verifyHmacToken;
