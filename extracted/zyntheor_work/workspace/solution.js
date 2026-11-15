// ZYNTHEOR Sovereign Token Validator (Hardened HS256 ESM)
import crypto from 'crypto';

class SovereignTokenValidator {
  constructor(secretKey) {
    const envSecret = secretKey || process.env.ZYNTHEOR_MASTER_SECRET;
    if (!envSecret || envSecret.length < 32) {
      throw new Error('FAIL_CLOSED: Cryptographically secure secret >= 32 bytes required.');
    }
    this.secret = Buffer.from(envSecret, 'utf8');
  }

  sign(payload, ttlSeconds = 3600) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'ZY-TOKEN' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() })).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secret).update(`${header}.${body}`).digest();
    return `${header}.${body}.${signature.toString('base64url')}`;
  }

  verify(token, expectedTenantId) {
    if (!token || typeof token !== 'string') return { valid: false, error: 'Empty token' };
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, error: 'Malformed structure' };
    const [headerB64, bodyB64, sigB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'ZY-TOKEN') return { valid: false, error: 'Invalid header' };
    const expectedSig = crypto.createHmac('sha256', this.secret).update(`${headerB64}.${bodyB64}`).digest();
    const actualSig = Buffer.from(sigB64, 'base64url');
    if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
      return { valid: false, error: 'Constant-time signature mismatch' };
    }
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { valid: false, error: 'Token expired' };
    if (expectedTenantId && payload.tenantId !== expectedTenantId) return { valid: false, error: 'Tenant isolation mismatch' };
    return { valid: true, payload };
  }
}

const sampleVerifyToken = 'sovereign_runtime_ephemeral_test_key_0123456789abcdef';
const validator = new SovereignTokenValidator(sampleVerifyToken);
const tok = validator.sign({ tenantId: 'tenant_core', role: 'admin' }, 120);
const check = validator.verify(tok, 'tenant_core');
if (!check.valid || check.payload.tenantId !== 'tenant_core') throw new Error('Token check failed');
console.log('SUCCESS: Hardened cryptographic token validation verified with timingSafeEqual.');