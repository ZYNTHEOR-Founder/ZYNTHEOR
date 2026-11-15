import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
import { ShoppingBag, CheckCircle2, Download, AlertTriangle } from 'lucide-react';

interface SkillItem {
  id: string;
  name: string;
  category: string;
  author: string;
  description: string;
  fileName: string;
  code: string;
}

export const Marketplace: React.FC = () => {
  const { authHeaders, role } = useAuth();
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<Record<string, { ok: boolean; message: string }>>({});

  const skills: SkillItem[] = [
    {
      id: 'skill-lru',
      name: 'Resilient In-Memory LRU Cache',
      category: 'Data Structures',
      author: 'ZYNTHEOR Core',
      description: 'O(1) lookups, automatic TTL expiration, and Least-Recently-Used eviction logic with zero external dependencies.',
      fileName: 'recipes/lru_cache.js',
      code: `export class LRUCache {
  constructor(capacity = 128, ttlMs = 60000) {
    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
`,
    },
    {
      id: 'skill-crypto',
      name: 'HMAC-SHA256 Token Verifier',
      category: 'Security & Auth',
      author: 'ZYNTHEOR Trust Lab',
      description: 'Timing-safe HMAC-SHA256 token verification using Node native crypto without third-party dependencies.',
      fileName: 'recipes/token_validator.js',
      code: `import crypto from 'node:crypto';

export function signPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return \`\${body}.\${sig}\`;
}

export function verifyToken(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}
`,
    },
    {
      id: 'skill-matrix',
      name: 'Float64 Matrix Multiplier',
      category: 'Mathematical Compute',
      author: 'ZYNTHEOR Neural Team',
      description: 'Row-major Float64 matrix multiplication with strict dimension invariant assertions.',
      fileName: 'recipes/matrix_mult.js',
      code: `export function matmul(a, b, m, k, n) {
  if (a.length !== m * k || b.length !== k * n) {
    throw new Error(\`Dimension mismatch: expected \${m}x\${k} * \${k}x\${n}\`);
  }
  const out = new Float64Array(m * n);
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      const aik = a[i * k + p];
      for (let j = 0; j < n; j++) {
        out[i * n + j] += aik * b[p * n + j];
      }
    }
  }
  return out;
}
`,
    },
    {
      id: 'skill-audit',
      name: 'SHA-256 Hash Chain Verifier',
      category: 'Governance',
      author: 'Audit Committee',
      description: 'Verifies sequential SHA-256 chain linkages across JSONL audit ledger entries.',
      fileName: 'recipes/hash_prober.js',
      code: `import crypto from 'node:crypto';

export function verifyChain(records) {
  let prev = '0'.repeat(64);
  for (const rec of records) {
    if (rec.prev_hash !== prev) return { valid: false, brokenIndex: rec.index };
    const digest = crypto.createHash('sha256').update(JSON.stringify(rec.payload)).digest('hex');
    if (digest !== rec.payload_digest) return { valid: false, brokenIndex: rec.index };
    prev = rec.entry_hash;
  }
  return { valid: true, checked: records.length };
}
`,
    },
  ];

  const handleDeploySkill = async (skill: SkillItem) => {
    setDeployingId(skill.id);
    try {
      const res = await fetch(apiUrl('/api/workspace/file'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          path: skill.fileName,
          content: skill.code,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDeployStatus((prev) => ({
        ...prev,
        [skill.id]: {
          ok: true,
          message: `Written to /workspace/${skill.fileName} (${skill.code.length} bytes)`,
        },
      }));
    } catch (err: any) {
      setDeployStatus((prev) => ({
        ...prev,
        [skill.id]: {
          ok: false,
          message: err?.message || 'Workspace deployment failed',
        },
      }));
    } finally {
      setDeployingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <VividCard gradientAccent="sunset" className="!p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[#FF5E3A] uppercase tracking-wider">
              Sovereign Code Recipes
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              Modular Workspace Recipes & Utilities
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              Deploy self-contained Node.js recipe modules directly into the project /workspace directory via POST /api/workspace/file.
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#FF007F]/15 border border-[#FF007F]/35 text-[#FF007F] flex items-center justify-center shrink-0">
            <ShoppingBag className="w-6 h-6" />
          </div>
        </div>
      </VividCard>

      {/* Grid of Skills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {skills.map((skill) => {
          const status = deployStatus[skill.id];
          const isDeploying = deployingId === skill.id;
          return (
            <VividCard key={skill.id} gradientAccent="cyan" className="flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#00F0FF]">
                    {skill.category}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
                    {skill.fileName}
                  </span>
                </div>
                <h3 className="text-base font-bold text-[var(--app-text-primary)]">{skill.name}</h3>
                <p className="text-xs text-[var(--app-text-secondary)] leading-relaxed">{skill.description}</p>
              </div>

              {status && (
                <div
                  className={`mt-4 p-2.5 rounded-xl border text-[11px] font-mono flex items-center gap-2 ${
                    status.ok
                      ? 'bg-[#CCFF00]/10 border-[#CCFF00]/35 text-[#CCFF00]'
                      : 'bg-[#FF007F]/12 border-[#FF007F]/40 text-rose-200'
                  }`}
                >
                  {status.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                  <span className="truncate">{status.message}</span>
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-[var(--app-card-border)] flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] text-[var(--app-text-secondary)] font-mono">
                  Author: <span className="text-[var(--app-text-primary)]">{skill.author}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeploySkill(skill)}
                  disabled={isDeploying || role === 'User'}
                  title={role === 'User' ? 'Developer or Administrator role required to write /workspace files' : undefined}
                  className="min-h-[44px] flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isDeploying ? 'Writing File...' : role === 'User' ? 'Developer Role Required' : 'Write to /workspace'}</span>
                </button>
              </div>
            </VividCard>
          );
        })}
      </div>
    </div>
  );
};
