/**
 * ZYNTHEOR Section 10 — Internet Integration, Web Research & Secret Reference Engine
 *
 * Provides controlled, SSRF-hardened outbound HTTP/HTTPS connectivity,
 * package registry lookups (npm / PyPI), web research retrieval, and
 * encrypted/masked secret reference management for Native Software Creation.
 *
 * Security Invariants:
 *  - Every outbound URL is checked via validateCloudUrl() AND DNS resolution
 *    to block private/loopback/link-local/cloud-metadata IPs (SSRF protection).
 *  - Every HTTP redirect hop (max 2) is manually validated before following.
 *  - Secret tokens are stored server-side only (AES-256-GCM encrypted or env ref)
 *    and NEVER returned in plaintext to clients or written into workspace code.
 *  - Every outbound request & secret mutation is logged to AuditLedger.
 */

import crypto from 'crypto';
import dns from 'dns/promises';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { AuditLedger } from './AuditLedger.ts';
import { validateCloudUrl } from './ConnectivityMonitor.ts';

export interface SecretRefSummary {
  alias: string;
  envVarName: string;
  provider: string;
  tenantId: string;
  configured: boolean;
  maskedPreview: string;
  source: 'env' | 'vault';
  updatedAt: string;
}

interface StoredSecretRecord {
  alias: string;
  envVarName: string;
  provider: string;
  tenantId: string;
  encryptedValue?: string;
  iv?: string;
  authTag?: string;
  maskedPreview: string;
  updatedAt: string;
}

export interface OutboundFetchResult {
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number | null;
  statusText: string;
  latencyMs: number;
  contentType: string;
  contentSha256: string | null;
  byteLength: number;
  headers: Record<string, string>;
  bodyPreview: string;
  blockedByPolicy: boolean;
  error: string | null;
  fetchedAt: string;
}

export interface WebResearchItem {
  id: string;
  source: 'url' | 'wikipedia' | 'github' | 'npm' | 'pypi';
  title: string;
  url: string;
  snippet: string;
  sha256: string;
  fetchedAt: string;
}

export interface RegistryPackageInfo {
  registry: 'npm' | 'pypi';
  name: string;
  version: string;
  description: string;
  license: string;
  homepage: string | null;
  tarballUrl: string | null;
  integrity: string | null;
  fetchedAt: string;
}

function isRestrictedIpAddress(ip: string): { restricted: boolean; reason?: string } {
  const clean = ip.replace(/^::ffff:/i, '');
  const ver = net.isIP(clean);
  if (ver === 4) {
    const oct = clean.split('.').map(Number);
    if (
      oct[0] === 0 ||
      oct[0] === 10 ||
      oct[0] === 127 ||
      (oct[0] === 169 && oct[1] === 254) ||
      (oct[0] === 172 && oct[1] >= 16 && oct[1] <= 31) ||
      (oct[0] === 192 && oct[1] === 168) ||
      (oct[0] === 100 && oct[1] >= 64 && oct[1] <= 127)
    ) {
      return { restricted: true, reason: `SSRF_BLOCKED: Resolved IPv4 '${clean}' is private/reserved` };
    }
    return { restricted: false };
  }
  if (ver === 6) {
    const lower = clean.toLowerCase();
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd')
    ) {
      return { restricted: true, reason: `SSRF_BLOCKED: Resolved IPv6 '${clean}' is loopback/link-local/ULA` };
    }
    return { restricted: false };
  }
  return { restricted: true, reason: `SSRF_BLOCKED: Unrecognized IP '${ip}'` };
}

function maskSecretValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'UNSET';
  if (trimmed.length <= 6) return '***';
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-4)}`;
}

export class InternetIntegrationEngine {
  private static instance: InternetIntegrationEngine | null = null;
  private readonly secretsPath: string;
  private readonly encryptionKey: Buffer;
  private secrets: StoredSecretRecord[] = [];

  private constructor() {
    const dir = path.resolve(process.cwd(), 'native_data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.secretsPath = path.join(dir, 'integration_secrets.json');
    const master = process.env.ZYNTHEOR_MASTER_SECRET || 'zyntheor-ephemeral-vault-key-do-not-commit';
    this.encryptionKey = crypto.createHash('sha256').update(master, 'utf8').digest();
    this.loadSecrets();
  }

  public static getInstance(): InternetIntegrationEngine {
    if (!InternetIntegrationEngine.instance) {
      InternetIntegrationEngine.instance = new InternetIntegrationEngine();
    }
    return InternetIntegrationEngine.instance;
  }

  private loadSecrets(): void {
    try {
      if (fs.existsSync(this.secretsPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.secretsPath, 'utf8'));
        if (Array.isArray(parsed?.secrets)) {
          this.secrets = parsed.secrets;
        }
      }
    } catch {
      this.secrets = [];
    }
  }

  private saveSecrets(): void {
    const dir = path.dirname(this.secretsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${this.secretsPath}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ updatedAt: new Date().toISOString(), secrets: this.secrets }, null, 2),
      'utf8'
    );
    fs.renameSync(tmp, this.secretsPath);
  }

  private encryptSecret(plaintext: string): { encryptedValue: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      encryptedValue: enc.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  private decryptSecret(rec: StoredSecretRecord): string | null {
    if (!rec.encryptedValue || !rec.iv || !rec.authTag) return null;
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(rec.iv, 'base64')
      );
      decipher.setAuthTag(Buffer.from(rec.authTag, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(rec.encryptedValue, 'base64')),
        decipher.final(),
      ]);
      return plain.toString('utf8');
    } catch {
      return null;
    }
  }

  public getPolicySnapshot(tenantId: string): {
    ssrfProtection: string;
    blockedCidrs: string[];
    allowedSchemes: string[];
    maxRedirects: number;
    timeoutMs: number;
    maxResponseBytes: number;
    secrets: SecretRefSummary[];
  } {
    return {
      ssrfProtection: 'STRICT_PUBLIC_DNS_AND_IP_FILTER',
      blockedCidrs: ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', '::1', 'fc00::/7', 'fe80::/10', 'metadata.google.internal'],
      allowedSchemes: ['https:', 'http:'],
      maxRedirects: 2,
      timeoutMs: 6000,
      maxResponseBytes: 131072,
      secrets: this.listSecretRefs(tenantId),
    };
  }

  public listSecretRefs(tenantId: string): SecretRefSummary[] {
    return this.secrets
      .filter((s) => s.tenantId === tenantId)
      .map((s) => {
        const envVal = s.envVarName ? process.env[s.envVarName] : undefined;
        const hasEnv = Boolean(envVal && envVal.trim());
        const hasVault = Boolean(s.encryptedValue);
        return {
          alias: s.alias,
          envVarName: s.envVarName,
          provider: s.provider,
          tenantId: s.tenantId,
          configured: hasEnv || hasVault,
          maskedPreview: hasEnv ? maskSecretValue(envVal!) : s.maskedPreview,
          source: hasEnv ? 'env' : 'vault',
          updatedAt: s.updatedAt,
        };
      });
  }

  public registerSecretRef(
    input: { alias: string; envVarName?: string; provider?: string; secretValue?: string },
    tenantId: string,
    actorUserId: string
  ): SecretRefSummary {
    const alias = input.alias.trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
    if (!alias) {
      throw new Error('INVALID_SECRET_ALIAS: Alias is required');
    }
    const envVarName = (input.envVarName || alias.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
      .trim()
      .slice(0, 80);
    const provider = (input.provider || 'custom_api').trim().slice(0, 48);
    const now = new Date().toISOString();

    const existingIdx = this.secrets.findIndex((s) => s.tenantId === tenantId && s.alias === alias);
    const prev = existingIdx >= 0 ? this.secrets[existingIdx] : undefined;

    let encryptedFields: Partial<StoredSecretRecord> = {};
    let maskedPreview = prev?.maskedPreview || 'ENV_REF_ONLY';
    if (typeof input.secretValue === 'string' && input.secretValue.trim()) {
      const enc = this.encryptSecret(input.secretValue.trim());
      encryptedFields = enc;
      maskedPreview = maskSecretValue(input.secretValue.trim());
    } else if (prev?.encryptedValue) {
      encryptedFields = {
        encryptedValue: prev.encryptedValue,
        iv: prev.iv,
        authTag: prev.authTag,
      };
    }

    const record: StoredSecretRecord = {
      alias,
      envVarName,
      provider,
      tenantId,
      ...encryptedFields,
      maskedPreview,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      this.secrets[existingIdx] = record;
    } else {
      this.secrets.unshift(record);
    }
    this.saveSecrets();

    AuditLedger.append('GOVERNANCE', 'INTEGRATION_SECRET_REF_UPDATED', {
      tenantId,
      actorUserId,
      alias,
      envVarName,
      provider,
      hasVaultToken: Boolean(record.encryptedValue),
    });

    const envVal = process.env[envVarName];
    const hasEnv = Boolean(envVal && envVal.trim());
    return {
      alias,
      envVarName,
      provider,
      tenantId,
      configured: hasEnv || Boolean(record.encryptedValue),
      maskedPreview: hasEnv ? maskSecretValue(envVal!) : record.maskedPreview,
      source: hasEnv ? 'env' : 'vault',
      updatedAt: now,
    };
  }

  public resolveSecretValue(alias: string, tenantId: string): string | null {
    const rec = this.secrets.find((s) => s.tenantId === tenantId && s.alias === alias);
    if (!rec) {
      const envCandidate = process.env[alias];
      return envCandidate && envCandidate.trim() ? envCandidate.trim() : null;
    }
    if (rec.envVarName && process.env[rec.envVarName]?.trim()) {
      return process.env[rec.envVarName]!.trim();
    }
    return this.decryptSecret(rec);
  }

  public async validateOutboundTarget(
    rawUrl: string,
    opts: { allowLoopback?: boolean } = {}
  ): Promise<{ ok: boolean; parsed?: URL; reason?: string }> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return { ok: false, reason: 'SSRF_BLOCKED: Malformed target URL' };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, reason: `SSRF_BLOCKED: Disallowed scheme '${parsed.protocol}'` };
    }
    const host = parsed.hostname.toLowerCase();
    const isLoopbackHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLoopbackHost && !opts.allowLoopback) {
      return { ok: false, reason: `SSRF_BLOCKED: Loopback host '${host}' blocked for outbound internet requests` };
    }

    const baseCheck = validateCloudUrl(parsed.href);
    if (!baseCheck.ok) {
      return { ok: false, reason: baseCheck.reason };
    }

    if (isLoopbackHost && opts.allowLoopback) {
      return { ok: true, parsed };
    }

    // Perform DNS resolution check to prevent DNS rebinding into private/internal networks
    if (net.isIP(host) === 0) {
      try {
        const records = await dns.lookup(host, { all: true });
        if (!records || records.length === 0) {
          return { ok: false, reason: `DNS_UNRESOLVED: No DNS records for '${host}'` };
        }
        for (const rec of records) {
          const ipCheck = isRestrictedIpAddress(rec.address);
          if (ipCheck.restricted) {
            return { ok: false, reason: ipCheck.reason };
          }
        }
      } catch (err: any) {
        return { ok: false, reason: `DNS_LOOKUP_FAILED: ${err?.message || err}` };
      }
    } else {
      const ipCheck = isRestrictedIpAddress(host);
      if (ipCheck.restricted) {
        return { ok: false, reason: ipCheck.reason };
      }
    }

    return { ok: true, parsed };
  }

  public async fetchExternalUrl(
    input: {
      url: string;
      method?: 'GET' | 'HEAD' | 'POST';
      headers?: Record<string, string>;
      body?: string;
      secretRefAlias?: string;
      secretHeaderName?: string;
      timeoutMs?: number;
      allowLoopback?: boolean;
    },
    scope: { tenantId: string; userId: string }
  ): Promise<OutboundFetchResult> {
    const started = Date.now();
    const nowIso = new Date(started).toISOString();
    const method = input.method || 'GET';
    const timeoutMs = Math.min(12000, Math.max(1000, Number(input.timeoutMs) || 6000));

    const firstCheck = await this.validateOutboundTarget(input.url, {
      allowLoopback: Boolean(input.allowLoopback),
    });
    if (!firstCheck.ok || !firstCheck.parsed) {
      AuditLedger.append('GOVERNANCE', 'INTERNET_FETCH_BLOCKED', {
        tenantId: scope.tenantId,
        userId: scope.userId,
        url: input.url,
        reason: firstCheck.reason,
      });
      return {
        ok: false,
        url: input.url,
        finalUrl: input.url,
        status: null,
        statusText: 'BLOCKED',
        latencyMs: Math.max(1, Date.now() - started),
        contentType: '',
        contentSha256: null,
        byteLength: 0,
        headers: {},
        bodyPreview: '',
        blockedByPolicy: true,
        error: firstCheck.reason || 'SSRF_BLOCKED',
        fetchedAt: nowIso,
      };
    }

    const reqHeaders: Record<string, string> = {
      'User-Agent': 'ZYNTHEOR-InternetEngine/1.0',
      Accept: 'application/json, text/plain, text/html, */*',
    };
    if (input.headers) {
      for (const [k, v] of Object.entries(input.headers)) {
        if (typeof k === 'string' && typeof v === 'string' && k.toLowerCase() !== 'host') {
          reqHeaders[k] = v;
        }
      }
    }
    if (input.secretRefAlias) {
      const secretVal = this.resolveSecretValue(input.secretRefAlias, scope.tenantId);
      if (!secretVal) {
        return {
          ok: false,
          url: input.url,
          finalUrl: input.url,
          status: null,
          statusText: 'MISSING_SECRET',
          latencyMs: Math.max(1, Date.now() - started),
          contentType: '',
          contentSha256: null,
          byteLength: 0,
          headers: {},
          bodyPreview: '',
          blockedByPolicy: true,
          error: `SECRET_NOT_CONFIGURED: Secret reference '${input.secretRefAlias}' has no configured value.`,
          fetchedAt: nowIso,
        };
      }
      const headerName = (input.secretHeaderName || 'Authorization').trim();
      reqHeaders[headerName] =
        headerName.toLowerCase() === 'authorization' && !secretVal.toLowerCase().startsWith('bearer ')
          ? `Bearer ${secretVal}`
          : secretVal;
    }

    let currentUrl = firstCheck.parsed.href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for (let hop = 0; hop <= 2; hop++) {
        const res = await fetch(currentUrl, {
          method,
          headers: reqHeaders,
          body: method === 'POST' && input.body ? input.body : undefined,
          redirect: 'manual',
          signal: controller.signal,
        });

        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) {
            clearTimeout(timer);
            return {
              ok: false,
              url: input.url,
              finalUrl: currentUrl,
              status: res.status,
              statusText: res.statusText,
              latencyMs: Math.max(1, Date.now() - started),
              contentType: '',
              contentSha256: null,
              byteLength: 0,
              headers: {},
              bodyPreview: '',
              blockedByPolicy: true,
              error: 'SSRF_BLOCKED: Redirect response missing Location header',
              fetchedAt: nowIso,
            };
          }
          const resolvedUrl = new URL(loc, currentUrl).href;
          const hopCheck = await this.validateOutboundTarget(resolvedUrl, {
            allowLoopback: Boolean(input.allowLoopback),
          });
          if (!hopCheck.ok) {
            clearTimeout(timer);
            return {
              ok: false,
              url: input.url,
              finalUrl: resolvedUrl,
              status: res.status,
              statusText: 'BLOCKED',
              latencyMs: Math.max(1, Date.now() - started),
              contentType: '',
              contentSha256: null,
              byteLength: 0,
              headers: {},
              bodyPreview: '',
              blockedByPolicy: true,
              error: hopCheck.reason || 'SSRF_BLOCKED: Redirect target rejected',
              fetchedAt: nowIso,
            };
          }
          if (hop >= 2) {
            clearTimeout(timer);
            return {
              ok: false,
              url: input.url,
              finalUrl: resolvedUrl,
              status: res.status,
              statusText: 'TOO_MANY_REDIRECTS',
              latencyMs: Math.max(1, Date.now() - started),
              contentType: '',
              contentSha256: null,
              byteLength: 0,
              headers: {},
              bodyPreview: '',
              blockedByPolicy: true,
              error: 'SSRF_BLOCKED: Too many HTTP redirects',
              fetchedAt: nowIso,
            };
          }
          currentUrl = resolvedUrl;
          continue;
        }

        const rawBuf = Buffer.from(await res.arrayBuffer());
        clearTimeout(timer);
        const capped = rawBuf.subarray(0, 131072);
        const text = capped.toString('utf8');
        const digest = crypto.createHash('sha256').update(capped).digest('hex');
        const safeHeaders: Record<string, string> = {};
        res.headers.forEach((val, key) => {
          const lk = key.toLowerCase();
          if (lk !== 'set-cookie' && lk !== 'authorization') {
            safeHeaders[key] = val;
          }
        });

        const latencyMs = Math.max(1, Date.now() - started);
        const ok = res.status >= 200 && res.status < 400;
        AuditLedger.append('SYSTEM', 'INTERNET_FETCH_EXECUTED', {
          tenantId: scope.tenantId,
          userId: scope.userId,
          method,
          finalUrl: currentUrl,
          status: res.status,
          latencyMs,
          contentSha256: digest,
          ok,
        });

        return {
          ok,
          url: input.url,
          finalUrl: currentUrl,
          status: res.status,
          statusText: res.statusText,
          latencyMs,
          contentType: res.headers.get('content-type') || 'application/octet-stream',
          contentSha256: digest,
          byteLength: rawBuf.length,
          headers: safeHeaders,
          bodyPreview: text.slice(0, 4000),
          blockedByPolicy: false,
          error: ok ? null : `HTTP ${res.status} ${res.statusText}`,
          fetchedAt: new Date().toISOString(),
        };
      }
      clearTimeout(timer);
      return {
        ok: false,
        url: input.url,
        finalUrl: currentUrl,
        status: null,
        statusText: 'EXHAUSTED',
        latencyMs: Math.max(1, Date.now() - started),
        contentType: '',
        contentSha256: null,
        byteLength: 0,
        headers: {},
        bodyPreview: '',
        blockedByPolicy: false,
        error: 'HTTP redirect loop exhausted',
        fetchedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      clearTimeout(timer);
      return {
        ok: false,
        url: input.url,
        finalUrl: currentUrl,
        status: null,
        statusText: 'NETWORK_ERROR',
        latencyMs: Math.max(1, Date.now() - started),
        contentType: '',
        contentSha256: null,
        byteLength: 0,
        headers: {},
        bodyPreview: '',
        blockedByPolicy: false,
        error: err?.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err?.message || String(err),
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  public async lookupPackageRegistry(
    registry: 'npm' | 'pypi',
    packageName: string,
    scope: { tenantId: string; userId: string }
  ): Promise<RegistryPackageInfo> {
    const cleanName = packageName.trim();
    if (!cleanName || !/^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(cleanName)) {
      throw new Error('INVALID_PACKAGE_NAME: Provide a valid npm or PyPI package name.');
    }

    const url =
      registry === 'npm'
        ? `https://registry.npmjs.org/${encodeURIComponent(cleanName).replace('%2F', '/')}`
        : `https://pypi.org/pypi/${encodeURIComponent(cleanName)}/json`;

    const fetched = await this.fetchExternalUrl({ url, method: 'GET', timeoutMs: 6000 }, scope);
    if (!fetched.ok) {
      throw new Error(`REGISTRY_LOOKUP_FAILED: ${fetched.error || `HTTP ${fetched.status}`}`);
    }
    const data = JSON.parse(fetched.bodyPreview);

    if (registry === 'npm') {
      const latest = data?.['dist-tags']?.latest || Object.keys(data?.versions || {}).pop() || 'unknown';
      const meta = data?.versions?.[latest] || data;
      return {
        registry: 'npm',
        name: data?.name || cleanName,
        version: String(latest),
        description: String(data?.description || meta?.description || ''),
        license: typeof meta?.license === 'string' ? meta.license : meta?.license?.type || 'UNSPECIFIED',
        homepage: data?.homepage || null,
        tarballUrl: meta?.dist?.tarball || null,
        integrity: meta?.dist?.integrity || meta?.dist?.shasum || null,
        fetchedAt: fetched.fetchedAt,
      };
    }

    const info = data?.info || {};
    const urls = Array.isArray(data?.urls) ? data.urls : [];
    const wheelOrSdist = urls.find((u: any) => u?.packagetype === 'bdist_wheel') || urls[0];
    return {
      registry: 'pypi',
      name: String(info.name || cleanName),
      version: String(info.version || 'unknown'),
      description: String(info.summary || ''),
      license: String(info.license || 'UNSPECIFIED'),
      homepage: info.home_page || info.project_url || null,
      tarballUrl: wheelOrSdist?.url || null,
      integrity: wheelOrSdist?.digests?.sha256 || null,
      fetchedAt: fetched.fetchedAt,
    };
  }

  public async researchWebTopic(
    queryOrUrl: string,
    scope: { tenantId: string; userId: string }
  ): Promise<{ items: WebResearchItem[]; warnings: string[] }> {
    const trimmed = queryOrUrl.trim();
    if (!trimmed) {
      throw new Error('INVALID_RESEARCH_QUERY: Query or URL is required.');
    }
    const items: WebResearchItem[] = [];
    const warnings: string[] = [];

    if (/^https?:\/\//i.test(trimmed)) {
      const res = await this.fetchExternalUrl({ url: trimmed, method: 'GET' }, scope);
      if (!res.ok) {
        throw new Error(res.error || `Failed to fetch ${trimmed}`);
      }
      const titleMatch = res.bodyPreview.match(/<title[^>]*>([^<]+)<\/title>/i);
      const stripped = res.bodyPreview
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      items.push({
        id: `res_${Date.now().toString(36)}`,
        source: 'url',
        title: titleMatch?.[1]?.trim() || res.finalUrl,
        url: res.finalUrl,
        snippet: stripped.slice(0, 600),
        sha256: res.contentSha256 || '',
        fetchedAt: res.fetchedAt,
      });
      return { items, warnings };
    }

    // Query live npm registry search + GitHub public repository search in parallel
    const npmSearchUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(trimmed)}&size=3`;
    const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmed)}&srlimit=3&format=json`;

    const [npmRes, wikiRes] = await Promise.all([
      this.fetchExternalUrl({ url: npmSearchUrl, method: 'GET', timeoutMs: 5000 }, scope),
      this.fetchExternalUrl({ url: wikiSearchUrl, method: 'GET', timeoutMs: 5000 }, scope),
    ]);

    if (npmRes.ok) {
      try {
        const parsed = JSON.parse(npmRes.bodyPreview);
        for (const obj of parsed?.objects || []) {
          const pkg = obj?.package;
          if (!pkg?.name) continue;
          const snippet = `${pkg.description || ''} (v${pkg.version || 'latest'})`;
          items.push({
            id: `npm_${pkg.name}`,
            source: 'npm',
            title: `npm: ${pkg.name}@${pkg.version || 'latest'}`,
            url: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
            snippet: snippet.trim(),
            sha256: crypto.createHash('sha256').update(JSON.stringify(pkg)).digest('hex'),
            fetchedAt: npmRes.fetchedAt,
          });
        }
      } catch {
        warnings.push('Unable to parse npm search response');
      }
    } else if (npmRes.error) {
      warnings.push(`npm search unavailable: ${npmRes.error}`);
    }

    if (wikiRes.ok) {
      try {
        const parsed = JSON.parse(wikiRes.bodyPreview);
        for (const hit of parsed?.query?.search || []) {
          const cleanSnippet = String(hit.snippet || '').replace(/<[^>]+>/g, '');
          const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(String(hit.title || '').replace(/\s+/g, '_'))}`;
          items.push({
            id: `wiki_${hit.pageid}`,
            source: 'wikipedia',
            title: String(hit.title || 'Reference'),
            url: pageUrl,
            snippet: cleanSnippet,
            sha256: crypto.createHash('sha256').update(cleanSnippet).digest('hex'),
            fetchedAt: wikiRes.fetchedAt,
          });
        }
      } catch {
        warnings.push('Unable to parse Wikipedia search response');
      }
    } else if (wikiRes.error) {
      warnings.push(`Web reference search unavailable: ${wikiRes.error}`);
    }

    return { items, warnings };
  }
}
