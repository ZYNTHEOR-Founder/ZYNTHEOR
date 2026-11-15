import React, { useState, useEffect } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { VerificationSuiteData } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
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
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const [isRunningSuite, setIsRunningSuite] = useState(false);
  const [suiteData, setSuiteData] = useState<VerificationSuiteData | null>(null);
  const [healthHistory, setHealthHistory] = useState<Array<{ time: string; cpu: number; ram: number; vram: number }>>([]);
  const [auditEntries, setAuditEntries] = useState<any[]>([]);

  useEffect(() => {
    if (!authReady || !isAuthenticated) return;
    const loadAdminData = async () => {
      try {
        const [statusRes, auditRes] = await Promise.all([
          fetch(apiUrl('/api/system/status')).then((r) => r.json()),
          fetch(apiUrl('/api/audit?limit=20'), { headers: authHeaders() }).then((r) => r.json())
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
  }, [authReady, isAuthenticated]);

  const handleRunVerificationSuite = async () => {
    setIsRunningSuite(true);
    try {
      const res = await fetch(apiUrl('/api/verify/suite'), { method: 'POST', headers: authHeaders() });
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
    <div className="space-y-6 sm:space-y-8">
      {/* Verification Suite Header */}
      <VividCard
        gradientAccent="cyan"
        className="!p-5 sm:!p-6"
        headerAction={
          <button
            onClick={handleRunVerificationSuite}
            disabled={isRunningSuite}
            className="min-h-[44px] flex items-center gap-2 px-5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            {isRunningSuite ? 'Running 8 Real Proofs...' : 'Execute Full Verification Suite'}
          </button>
        }
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-mono font-bold text-[#00F0FF] uppercase tracking-wider">
              Empirical Proof Engine
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              Real-World Execution Verification Standard
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              "We do not build systems to pass mock tests. We build systems that run real execution and prove capability with evidence."
            </p>
          </div>

          <div className="flex items-center gap-3 p-3.5 bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl shrink-0">
            <ShieldCheck className="w-6 h-6 text-[#CCFF00] shrink-0" />
            <div className="tabular-nums">
              <div className="text-xs font-bold text-[var(--app-text-primary)]">
                {suiteData ? `${suiteData.passed_tests} / ${suiteData.total_tests} Tests Passed` : 'No verification run recorded'}
              </div>
              <div className={`text-[10px] font-mono font-bold ${suiteData?.verified ? 'text-[#CCFF00]' : suiteData ? 'text-[#FF5E3A]' : 'text-[#00F0FF]'}`}>
                {suiteData?.verified ? 'ALL REPORTED CHECKS PASSED' : suiteData ? 'REVIEW BLOCKED / PARTIAL CHECKS' : 'Awaiting an actual runtime result'}
              </div>
            </div>
          </div>
        </div>
      </VividCard>

      {/* 8 Proofs Table */}
      <VividCard
        title="Sovereign AI Proof Verification Matrix"
        subtitle="Results from the latest executed verification request; no pre-filled pass states"
        gradientAccent="violet"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] uppercase font-semibold text-[11px]">
                <th className="pb-3 pl-1">Requirement / Standard</th>
                <th className="pb-3">Proof Target</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Runtime Evidence / Metric</th>
                <th className="pb-3 text-right pr-1">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)] font-sans">
              {(suiteData?.results || []).map((t: any) => (
                <tr key={t.test_id} className="hover:bg-[var(--app-surface-elevated)]/60 transition-colors">
                  <td className="py-3 pl-1 font-bold text-[var(--app-text-primary)]">
                    <div>{t.name}</div>
                    <div className="text-[10px] font-mono text-[var(--app-text-secondary)]">{t.test_id}</div>
                  </td>
                  <td className="py-3 text-[#00F0FF] font-mono text-[11px]">
                    {t.test_id.includes('WEIGHTS') ? 'model_checkpoint_target_41m.pt' : t.test_id.includes('TOKEN') ? 'tokenizer.py' : t.test_id.includes('MEMORY') ? 'memory_store.json' : 'Python Bridge'}
                  </td>
                  <td className="py-3">
                    <StatusBadge status={t.status === 'PASS' ? 'VERIFIED' : t.status === 'PARTIAL' ? 'PARTIAL' : 'BLOCKED'} />
                  </td>
                  <td className="py-3 text-[var(--app-text-secondary)] text-[11px] font-mono max-w-md truncate">
                    {t.evidence}
                  </td>
                  <td className="py-3 text-right pr-1 font-mono tabular-nums text-[var(--app-text-secondary)]">
                    {t.duration_ms}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!suiteData?.results?.length && (
            <p className="py-6 text-center text-xs text-[var(--app-text-secondary)]">
              No verification evidence is available yet. Run the suite to display results from the live runtime.
            </p>
          )}
        </div>
      </VividCard>

      {/* System Health (Recharts) */}
      <VividCard
        title="System Health (CPU / RAM / VRAM)"
        subtitle="Real-time infrastructure telemetry from /api/system/status"
        gradientAccent="blue"
      >
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={healthHistory}>
              <XAxis dataKey="time" stroke="#9AA8C7" fontSize={10} />
              <YAxis stroke="#9AA8C7" fontSize={10} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0D1326',
                  borderColor: '#1E294A',
                  borderRadius: '0.75rem',
                  color: '#F4F7FF',
                  fontSize: '11px',
                }}
              />
              <Area type="monotone" dataKey="cpu" stroke="#00F0FF" fill="#00F0FF" fillOpacity={0.2} name="CPU %" />
              <Area type="monotone" dataKey="ram" stroke="#FF5E3A" fill="#FF5E3A" fillOpacity={0.16} name="RSS (×10MB)" />
              <Area type="monotone" dataKey="vram" stroke="#7B2CBF" fill="#7B2CBF" fillOpacity={0.18} name="Heap (×10MB)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </VividCard>

      {/* Session administration is intentionally not simulated. */}
      <VividCard
        title="Session Administration"
        subtitle="Session listing and revocation require a server-backed administrative endpoint"
        gradientAccent="coral"
      >
        <p className="text-xs text-[var(--app-text-secondary)] leading-relaxed">
          This console does not display fabricated sessions or simulate token revocation. Use the identity and token-revocation APIs; an administrative session UI will be enabled when the server exposes an authorized session-management endpoint.
        </p>
      </VividCard>

      {/* Admin Audit Log */}
      <VividCard
        title="Admin Audit Log"
        subtitle="Recent critical actions sourced from AuditLedger"
        gradientAccent="magenta"
      >
        <div className="max-h-56 overflow-y-auto space-y-1.5 font-mono text-[11px]">
          {auditEntries.length === 0 ? (
            <div className="text-[var(--app-text-secondary)] italic">No audit entries loaded.</div>
          ) : (
            auditEntries.map((entry, idx) => (
              <div
                key={entry.id || idx}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--app-input-bg)] border border-[var(--app-card-border)]"
              >
                <span className="text-[#00F0FF] font-bold truncate">[{entry.actor || 'SYSTEM'}] {entry.action}</span>
                <span className="text-[var(--app-text-secondary)] tabular-nums shrink-0">{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}</span>
              </div>
            ))
          )}
        </div>
      </VividCard>
    </div>
  );
};
