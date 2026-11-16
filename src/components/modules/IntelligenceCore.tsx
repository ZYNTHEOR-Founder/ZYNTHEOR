import React, { useState } from 'react';
import { SystemStatusData } from '../../types';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { Activity, BrainCircuit, Cloud, Layers3, Send, ShieldCheck } from 'lucide-react';

interface IntelligenceCoreProps {
  statusData: SystemStatusData | null;
}

const TARGET_PARAMS = 41_527_808;
const count = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

export const IntelligenceCore: React.FC<IntelligenceCoreProps> = ({ statusData }) => {
  const { authHeaders } = useAuth();
  const model = statusData?.model;
  const ready = Boolean(model?.weightsLoaded && model?.inferenceReady);
  const [prompt, setPrompt] = useState('Explain how to verify a native model checkpoint.');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const runInference = async () => {
    if (!ready || !prompt.trim() || busy) return;
    setBusy(true);
    setResult(null);
    setError('');
    try {
      const response = await fetch('/api/native/inference', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt: prompt.trim(), role: 'analysis' })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || data.code || `HTTP ${response.status}`);
      setResult(data);
    } catch (err: any) {
      setError(err?.message || 'Native inference was not completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard title="Active parameters" value={count(model?.activeParams ?? model?.totalParams)} subtitle={ready ? 'Loaded and verified by Cloud Runtime' : 'No verified active weights'} icon={<BrainCircuit className="w-5 h-5" />} accentColor="cyan" />
        <MetricCard title="Target architecture" value={count(model?.targetParams ?? TARGET_PARAMS)} subtitle="Design target · not active weights" icon={<Layers3 className="w-5 h-5" />} accentColor="purple" />
        <MetricCard title="Inference runtime" value={ready ? 'READY' : 'BLOCKED'} subtitle={model?.runtimeState || 'No runtime telemetry'} icon={<Cloud className="w-5 h-5" />} accentColor={ready ? 'lime' : 'coral'} />
        <MetricCard title="Checkpoint seal" value={model?.checkpointHash ? 'PRESENT' : 'NOT LOADED'} subtitle={model?.checkpointHash ? model.checkpointHash.slice(0, 16) + '…' : 'Cloud checkpoint fingerprint unavailable'} icon={<ShieldCheck className="w-5 h-5" />} accentColor="cyan" />
      </div>

      <VividCard title="Native Intelligence Runtime" subtitle="Active graph and target architecture are reported separately. Inference calls the real Native Cloud Runtime." gradientAccent="cyan">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2"><span className={`vivid-status-dot ${ready ? 'is-ready' : 'is-blocked'}`} /><span className="text-sm font-semibold text-[var(--app-text-primary)]">{model?.runtimeState || 'RUNTIME STATUS UNAVAILABLE'}</span></div>
          <StatusBadge status={ready ? 'VERIFIED' : model ? 'BLOCKED' : 'UNVERIFIED'} />
        </div>
        <p className="text-sm leading-6 text-[var(--app-text-secondary)] mb-5">
          {ready
            ? 'The Cloud Runtime reports a loaded checkpoint and enabled inference. This status applies to the active payload only.'
            : model?.readinessReason || 'Native inference remains blocked until a valid checkpoint is loaded and verified from the configured Cloud Runtime.'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5 text-xs">
          <div className="rounded-xl p-3 bg-[var(--app-surface-elevated)]"><div className="text-[var(--app-text-secondary)]">Target width</div><div className="mt-1 font-semibold text-[var(--app-text-primary)]">512 dimensions</div></div>
          <div className="rounded-xl p-3 bg-[var(--app-surface-elevated)]"><div className="text-[var(--app-text-secondary)]">Target depth</div><div className="mt-1 font-semibold text-[var(--app-text-primary)]">10 layers</div></div>
          <div className="rounded-xl p-3 bg-[var(--app-surface-elevated)]"><div className="text-[var(--app-text-secondary)]">Target attention</div><div className="mt-1 font-semibold text-[var(--app-text-primary)]">8 heads</div></div>
          <div className="rounded-xl p-3 bg-[var(--app-surface-elevated)]"><div className="text-[var(--app-text-secondary)]">Target FFN</div><div className="mt-1 font-semibold text-[var(--app-text-primary)]">1,472 width</div></div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={!ready || busy} className="flex-1 min-w-0 px-4 py-3 rounded-xl text-sm bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] disabled:opacity-60" placeholder="Enter a real inference request" />
          <button type="button" onClick={runInference} disabled={!ready || busy || !prompt.trim()} className="px-4 py-3 rounded-xl text-sm font-semibold vivid-gradient-brand text-white disabled:opacity-40 flex items-center justify-center gap-2"><Send className="w-4 h-4" />{busy ? 'Running…' : 'Run inference'}</button>
        </div>
        {error && <p className="mt-3 text-sm text-[var(--z-danger)]">{error}</p>}
        {result && <div className="mt-4 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-4 space-y-3"><div className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)]"><Activity className="w-4 h-4" />Actual response · {count(result.outputTokens)} output tokens · {result.latency_ms ?? '—'} ms</div><div className="text-sm whitespace-pre-wrap leading-6 text-[var(--app-text-primary)]">{result.response}</div><p className="text-[10px] font-mono break-all text-[var(--app-text-secondary)]">Checkpoint SHA-256: {result.checkpointHash}</p></div>}
      </VividCard>
    </div>
  );
};
