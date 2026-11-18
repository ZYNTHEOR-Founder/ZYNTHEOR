/** Tenant- and identity-scoped fixed-window rate limiting.
 * In-process by design for a single runtime. Multi-instance deployments MUST
 * replace the store with a shared atomic backend before enabling horizontal scale.
 */
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './AuthMiddleware';
import { AuditLedger } from './AuditLedger';

type Bucket = { windowStartedAt: number; count: number };
const buckets = new Map<string, Bucket>();
const lastSweep = { at: 0 };

const DEFAULTS: Record<string, { limit: number; windowMs: number }> = {
  inference: { limit: 30, windowMs: 60_000 },
  chat: { limit: 20, windowMs: 60_000 },
  agent: { limit: 8, windowMs: 60_000 },
  knowledge: { limit: 20, windowMs: 60_000 },
  general: { limit: 120, windowMs: 60_000 }
};

function configured(scope: string) {
  const base = DEFAULTS[scope] || DEFAULTS.general;
  const prefix = `ZYNTHEOR_RATE_${scope.toUpperCase()}`;
  const limit = Number(process.env[`${prefix}_LIMIT`]);
  const windowSeconds = Number(process.env[`${prefix}_WINDOW_SECONDS`]);
  return {
    limit: Number.isSafeInteger(limit) && limit > 0 ? limit : base.limit,
    windowMs: Number.isSafeInteger(windowSeconds) && windowSeconds > 0 ? windowSeconds * 1000 : base.windowMs
  };
}

export function enforceRateLimit(scope: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const policy = configured(scope);
    const now = Date.now();
    const identity = `${req.sovereignTenantId || 'no-tenant'}:${req.sovereignUserId || 'no-user'}:${scope}`;
    let bucket = buckets.get(identity);
    if (!bucket || now - bucket.windowStartedAt >= policy.windowMs) {
      bucket = { windowStartedAt: now, count: 0 };
      buckets.set(identity, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, policy.limit - bucket.count);
    const resetAt = bucket.windowStartedAt + policy.windowMs;
    res.setHeader('RateLimit-Limit', String(policy.limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
    res.setHeader('RateLimit-Policy', `${policy.limit};w=${Math.ceil(policy.windowMs / 1000)}`);

    if (bucket.count > policy.limit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      AuditLedger.append('GOVERNANCE', 'RATE_LIMIT_REJECTED', {
        scope, tenantId: req.sovereignTenantId, userId: req.sovereignUserId,
        limit: policy.limit, windowMs: policy.windowMs, retryAfter
      });
      return res.status(429).json({
        success: false, code: 'RATE_LIMIT_EXCEEDED', scope,
        message: 'Request limit exceeded. Retry after the indicated interval.', retryAfter
      });
    }

    if (now - lastSweep.at > 60_000) {
      lastSweep.at = now;
      for (const [key, value] of buckets) {
        const scopeName = key.slice(key.lastIndexOf(':') + 1);
        const ttl = configured(scopeName).windowMs;
        if (now - value.windowStartedAt > ttl * 2) buckets.delete(key);
      }
    }
    next();
  };
}

export function rateLimitPolicies() {
  return Object.fromEntries(Object.keys(DEFAULTS).map((scope) => [scope, configured(scope)]));
}
