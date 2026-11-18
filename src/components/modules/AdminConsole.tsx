import React, { useState, useEffect } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { VerificationSuiteData } from '../../types';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import {
  Sliders,
  Play,
  ShieldCheck,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  Activity,
  RotateCcw
} from 'lucide-react';

export const AdminConsole: React.FC = () => {
  const [isRunningSuite, setIsRunningSuite] = useState(false);
  const [suiteData, setSuiteData] = useState<VerificationSuiteData | null>(null);
  const [healthHistory, setHealthHistory] = useState<Array<{ time: string; cpu: number; ram: number; vram: number }>>([]);
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  // does not display fabricated sessions or simulate token revocation; no session API exists yet.
  const [sessions] = useState<Array<{ id: string; actor: string; ip: string; status: string }>>([]);

  useEffect(() => {
    const loadAdminData = async () => {
      try {
        const [statusRes, auditRes] = await Promise.all([
          fetch('/api/system/status').then((r) => r.json()),
          fetch('/api/audit?limit=20').then((r) => r.json())
        ]);
        if (statusRes.success && statusRes.resources) {
          const r = statusRes.resources;
          setHealthHistory((prev) => [
            ...prev.slice(-14),
            {
              time: new Date().toTimeString().slice(0, 8),
              cpu: r.cpuPercent ?? 0,
              ram: Math.round((r.processRssMb ?? 0) / 10),
              vram: Math.round((r.vramMb ?? 0) / 10)
            }
          ]);
        }
        if (auditRes.success && Array.isArray(auditRes.entries)) {
          setAuditEntries(auditRes.entries);
        }
      } catch {
        // ignore transient error
      }
    };
    loadAdminData();
    const interval = setInterval(loadAdminData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRunVerificationSuite = async () => {
    setIsRunningSuite(true);
    try {
      const res = await fetch('/api/verify/suite', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSuiteData(data.suite);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRunningSuite(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Verification Suite Header */}
      <VividCard
        gradientAccent="cyan"
        className="!p-6"
        headerAction={
          <button
            onClick={handleRunVerificationSuite}
            disabled={isRunningSuite}
            className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-[var(--app-text-primary)] vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            {isRunningSuite ? 'Running 8 Real Proofs...' : 'Execute Full Verification Suite'}
          </button>
        }
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold text-[var(--app-accent)] ">
              Empirical Proof Engine
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              Real-World Execution Verification Standard
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              "We do not build systems to pass mock tests. We build systems that run real execution and prove capability with evidence."
            </p>
          </div>

          <div className="flex items-center gap-3 p-3 bg-[var(--app-surface-elevated)] border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)] rounded-xl">
            <ShieldCheck className="w-6 h-6 text-[var(--z-ok)] shrink-0" />
            <div>
              <div className="text-xs font-bold text-[var(--app-text-primary)]">
                {suiteData ? `${suiteData.passed_tests} / ${suiteData.total_tests} Tests Passed` : 'No verification run recorded'}
              </div>
              <div className="text-[10px] text-[var(--z-ok)] font-mono font-bold">
                {suiteData?.verified ? 'EVIDENCE VERIFIED' : 'UNVERIFIED · AWAITING TEST RUN'}
              </div>
            </div>
          </div>
        </div>
      </VividCard>

      {/* 8 Proofs Table */}
      <VividCard
        title="Sovereign AI Proof Verification Matrix"
        subtitle="Live assertions against local Python bridge, weights checkpoint, and ToolGateway sandbox"
        gradientAccent="purple"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] font-semibold">
                <th className="pb-3 pl-1">Requirement / Standard</th>
                <th className="pb-3">Proof Target</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Runtime Evidence / Metric</th>
                <th className="pb-3 text-right pr-1">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)] font-sans">
              {(suiteData?.results || []).map((t: any) => (
                <tr key={t.test_id} className="hover:bg-[var(--app-surface-elevated)] transition-colors">
                  <td className="py-3 pl-1 font-bold text-[var(--app-text-primary)]">
                    <div>{t.name}</div>
                    <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{t.test_id}</div>
                  </td>
                  <td className="py-3 text-[var(--app-text-primary)] font-mono text-[11px]">
                    {t.test_id.includes('WEIGHTS') ? 'model_checkpoint.pt' : t.test_id.includes('TOKEN') ? 'tokenizer.py' : t.test_id.includes('MEMORY') ? 'memory_store.json' : 'Python Bridge'}
                  </td>
                  <td className="py-3">
                    <StatusBadge status={t.status === 'PASS' ? 'VERIFIED' : 'BLOCKED'} />
                  </td>
                  <td className="py-3 text-[var(--app-text-primary)] text-[11px] font-mono max-w-md truncate">
                    {t.evidence}
                  </td>
                  <td className="py-3 text-right pr-1 font-mono text-[var(--app-text-secondary)]">
                    {t.duration_ms}ms
                  </td>
                </tr>
              ))}
              {!suiteData?.results?.length && (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-[var(--app-text-secondary)]">No verification evidence is available yet. Run the verification suite to populate this table.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </VividCard>

      {/* System Health (Recharts) */}
      <VividCard
        title="System Health (CPU / RAM / VRAM)"
        subtitle="Real-time infrastructure telemetry from /api/system/status"
        gradientAccent="emerald"
      >
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={healthHistory}>
              <XAxis dataKey="time" stroke="#A7BDB2" fontSize={10} />
              <YAxis stroke="#A7BDB2" fontSize={10} />
              <Tooltip />
              <Area type="monotone" dataKey="cpu" stroke="var(--app-accent)" fill="var(--app-accent)" fillOpacity={0.2} name="CPU %" />
              <Area type="monotone" dataKey="ram" stroke="var(--app-amber)" fill="var(--app-amber)" fillOpacity={0.15} name="RSS (×10MB)" />
              <Area type="monotone" dataKey="vram" stroke="var(--app-accent)" fill="var(--app-accent)" fillOpacity={0.15} name="Heap (×10MB)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </VividCard>

      {/* Active Sessions & Revoke */}
      <VividCard
        title="Active User Sessions"
        subtitle="Invalidate active session tokens and log to AuditLedger"
        gradientAccent="amber"
      >
        <div className="space-y-2 text-xs font-mono">
          {sessions.length === 0 ? (
            <div className="py-5 text-center text-[var(--app-text-secondary)]">
              No session-management records are available from the server.
            </div>
          ) : sessions.map((s) => (
            <div key={s.id} className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
              <span className="text-[var(--app-text-primary)] font-bold">{s.id}</span>{' '}
              <span className="text-[var(--app-text-secondary)]">({s.actor} · {s.ip} · {s.status})</span>
            </div>
          ))}
        </div>
      </VividCard>

      {/* Admin Audit Log */}
      <VividCard
        title="Admin Audit Log"
        subtitle="Recent critical actions sourced from AuditLedger"
        gradientAccent="emerald"
      >
        <div className="max-h-56 overflow-y-auto space-y-1.5 font-mono text-[11px]">
          {auditEntries.length === 0 ? (
            <div className="text-[var(--app-text-secondary)] italic">No audit entries loaded.</div>
          ) : (
            auditEntries.map((entry, idx) => (
              <div
                key={entry.id || idx}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)]"
              >
                <span className="text-[var(--app-accent)] font-bold">[{entry.actor || 'SYSTEM'}] {entry.action}</span>
                <span className="text-[var(--app-text-secondary)]">{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}</span>
              </div>
            ))
          )}
        </div>
      </VividCard>
    </div>
  );
};
