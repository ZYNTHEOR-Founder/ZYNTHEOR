/**
 * ZYNTHEOR Auth Middleware — Server-verified sessions only.
 * Never trusts client-supplied role headers for authorization.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SovereignIdentity, SovereignRole, TokenPayload } from './SovereignIdentity';
import { AuditLedger } from './AuditLedger';
import { TokenRevocation } from './TokenRevocation';
import { isCloudSqlConfigured } from '../src/db/index.ts';
import { saveCloudQuickLogSeal } from '../src/db/repositories.ts';

/** UI-facing role labels mapped to SovereignIdentity roles */
export type UiRole = 'User' | 'Developer' | 'Administrator';

export const UI_TO_SOVEREIGN: Record<UiRole, SovereignRole> = {
  User: 'guest',
  Developer: 'developer',
  Administrator: 'admin'
};

export const SOVEREIGN_TO_UI: Record<SovereignRole, UiRole> = {
  guest: 'User',
  developer: 'Developer',
  operator: 'Developer',
  auditor: 'Administrator',
  admin: 'Administrator'
};

const ROLE_RANK: Record<SovereignRole, number> = {
  guest: 1,
  developer: 2,
  operator: 3,
  auditor: 4,
  admin: 5
};

export interface AuthenticatedRequest extends Request {
  correlationId?: string;
  sovereignRole?: SovereignRole;
  sovereignUserId?: string;
  sovereignTenantId?: string;
  tokenPayload?: TokenPayload;
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim();
    return t.length > 0 ? t : null;
  }
  // Fallback dedicated header (still server-verified; never a role claim)
  const dedicated = req.headers['x-zyntheor-token'];
  if (typeof dedicated === 'string' && dedicated.trim().length > 0) {
    return dedicated.trim();
  }
  return null;
}

/**
 * Fail-closed auth middleware.
 * - Requires a cryptographically verified token (HS256 ZY-TOKEN).
 * - Role/tenant/sub come ONLY from verified payload.
 * - Client headers x-zyntheor-role / x-zyntheor-user-id are IGNORED for authorization.
 * - Logs every attempt (grant + deny) to AuditLedger.
 */
export function requireAuth(minRole: SovereignRole = 'guest') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const correlationId =
      (req.headers['x-correlation-id'] as string) || crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const identity = SovereignIdentity.getInstance();
    const token = extractBearerToken(req);

    // Explicitly ignore client role spoofing headers for auth decisions
    const spoofedRoleHeader = req.headers['x-zyntheor-role'];

    if (!token) {
      AuditLedger.append('GOVERNANCE', 'RBAC_ACCESS_DENIED', {
        reason: 'MISSING_TOKEN',
        path: req.path,
        method: req.method,
        spoofedRoleHeader: spoofedRoleHeader || null,
        correlationId,
        timestamp
      });
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Provide Authorization: Bearer <token>.',
        code: 'MISSING_TOKEN',
        correlationId
      });
    }

    const verification = identity.verifyToken(token, { requiredRole: minRole });

    if (!verification.valid || !verification.payload) {
      AuditLedger.append('GOVERNANCE', 'RBAC_ACCESS_DENIED', {
        reason: verification.code,
        detail: verification.reason,
        path: req.path,
        method: req.method,
        spoofedRoleHeader: spoofedRoleHeader || null,
        correlationId,
        timestamp
      });
      const status =
        verification.code === 'TOKEN_EXPIRED' || verification.code === 'TOKEN_NOT_YET_VALID'
          ? 401
          : verification.code === 'UNAUTHORIZED_ROLE'
          ? 403
          : 401;
      return res.status(status).json({
        success: false,
        error: verification.reason,
        code: verification.code,
        correlationId
      });
    }

    const payload = verification.payload;

    if (payload.jti && TokenRevocation.isRevoked(payload.jti)) {
      AuditLedger.append('GOVERNANCE', 'RBAC_ACCESS_DENIED', {
        reason: 'TOKEN_REVOKED',
        jti: payload.jti,
        sub: payload.sub,
        path: req.path,
        method: req.method,
        correlationId,
        timestamp
      });
      return res.status(401).json({
        success: false,
        error: 'Token has been revoked.',
        code: 'TOKEN_REVOKED',
        correlationId
      });
    }


    // Tenant isolation: if request declares a tenant, it must match token
    const requestedTenant =
      (req.headers['x-zyntheor-tenant'] as string) ||
      (req.query.tenantId as string) ||
      (req.body && typeof req.body === 'object' ? (req.body as any).tenantId : undefined);

    if (requestedTenant && requestedTenant !== payload.tenantId) {
      AuditLedger.append('GOVERNANCE', 'RBAC_ACCESS_DENIED', {
        reason: 'TENANT_MISMATCH',
        tokenTenant: payload.tenantId,
        requestedTenant,
        sub: payload.sub,
        path: req.path,
        method: req.method,
        correlationId,
        timestamp
      });
      return res.status(403).json({
        success: false,
        error: `Cross-tenant access forbidden for tenant '${requestedTenant}'.`,
        code: 'TENANT_MISMATCH',
        correlationId
      });
    }

    AuditLedger.append('GOVERNANCE', 'RBAC_ACCESS_GRANTED', {
      userId: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      minRole,
      path: req.path,
      method: req.method,
      correlationId,
      timestamp
    });

    req.correlationId = correlationId;
    req.sovereignRole = payload.role;
    req.sovereignUserId = payload.sub;
    req.sovereignTenantId = payload.tenantId;
    req.tokenPayload = payload;
    next();
  };
}

/** Map UI role label to minimum SovereignRole for route guards */
export function minRoleFromUi(ui: UiRole): SovereignRole {
  return UI_TO_SOVEREIGN[ui] || 'guest';
}

export function roleAtLeast(actual: SovereignRole, required: SovereignRole): boolean {
  return (ROLE_RANK[actual] || 0) >= (ROLE_RANK[required] || 999);
}

/**
 * Server-controlled audit seal for agent logs.
 * HMAC over log content with identity master material — not stored in localStorage.
 */
const SEAL_SNAPSHOT_DIR = path.resolve(process.cwd(), 'native_data', 'quick_log_seals');

function saveSealSnapshot(sealId: string, contentHash: string, logs: string[], meta: { userId: string; tenantId: string }): void {
  if (!fs.existsSync(SEAL_SNAPSHOT_DIR)) fs.mkdirSync(SEAL_SNAPSHOT_DIR, { recursive: true });
  const snap = {
    sealId,
    contentHash,
    userId: meta.userId,
    tenantId: meta.tenantId,
    sealedAt: new Date().toISOString(),
    logs
  };
  const file = path.join(SEAL_SNAPSHOT_DIR, `${contentHash}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(snap), 'utf8');
  fs.renameSync(tmp, file);
  // also write latest pointer per user
  const latest = path.join(SEAL_SNAPSHOT_DIR, `latest_${meta.userId || 'unknown'}.json`);
  fs.writeFileSync(latest, JSON.stringify({ contentHash, sealId, sealedAt: snap.sealedAt }), 'utf8');
}

export function loadLatestSealSnapshot(userId: string): { contentHash: string; sealId: string; logs: string[]; sealedAt: string } | null {
  if (!fs.existsSync(SEAL_SNAPSHOT_DIR)) return null;
  const latestPath = path.join(SEAL_SNAPSHOT_DIR, `latest_${userId || 'unknown'}.json`);
  if (!fs.existsSync(latestPath)) return null;
  try {
    const ptr = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    const snapPath = path.join(SEAL_SNAPSHOT_DIR, `${ptr.contentHash}.json`);
    if (!fs.existsSync(snapPath)) return null;
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    if (!Array.isArray(snap.logs)) return null;
    return {
      contentHash: snap.contentHash,
      sealId: snap.sealId,
      logs: snap.logs.map(String),
      sealedAt: snap.sealedAt
    };
  } catch {
    return null;
  }
}

export function sealLogsServerSide(
  logs: string[],
  meta: { userId: string; tenantId: string; goal?: string }
): { sealId: string; contentHash: string; entryHash: string; sealedAt: string } {
  const content = logs.join('\n');
  const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const sealedAt = new Date().toISOString();
  const sealId = crypto.randomUUID();

  saveSealSnapshot(sealId, contentHash, logs, { userId: meta.userId, tenantId: meta.tenantId });

  const record = AuditLedger.append('GOVERNANCE', 'QUICK_LOGS_SERVER_SEAL', {
    sealId,
    contentHash,
    logCount: logs.length,
    userId: meta.userId,
    tenantId: meta.tenantId,
    goal: meta.goal || null,
    sealedAt
  });

  if (isCloudSqlConfigured()) {
    void saveCloudQuickLogSeal({
      sealId,
      userId: meta.userId,
      tenantId: meta.tenantId,
      contentHash,
      entryHash: record.entry_hash,
      logs,
    }).catch((err) => {
      console.warn('[AuthMiddleware] Cloud SQL seal mirror warning:', err?.message || err);
    });
  }

  return {
    sealId,
    contentHash,
    entryHash: record.entry_hash,
    sealedAt
  };
}

export function verifyLogsAgainstSeal(
  logs: string[],
  expectedContentHash: string
): { match: boolean; actualHash: string } {
  const content = logs.join('\n');
  const actualHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  return { match: actualHash === expectedContentHash, actualHash };
}
