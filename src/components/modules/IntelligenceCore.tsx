import React, { useState, useEffect } from 'react';
import { SystemStatusData } from '../../types';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge, StatusDot } from '../ui/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
import { consumeNdjsonStream } from '../../lib/ndjson';
import { Cpu, Binary, Layers, ShieldCheck, Activity, Terminal, Send, Check, RefreshCw, HardDrive, FlaskConical } from 'lucide-react';

interface IntelligenceCoreProps {
  statusData: SystemStatusData | null;
}

export const IntelligenceCore: React.FC<IntelligenceCoreProps> = ({ statusData }) => {
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const model = statusData?.model;
  const [testPrompt, setTestPrompt] = useState('Verify sovereign neural tensor projection');
  const [isInferring, setIsInferring] = useState(false);
  const [inferenceResult, setInferenceResult] = useState<any>(null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  // Checkpoint Loading & Memory Allocation Diagnostics State
  const [diagnostics, setDiagnostics] = useState<any | null>(null);
  const [isLoadingDiag, setIsLoadingDiag] = useState(false);
  const [isProbingReload, setIsProbingReload] = useState(false);
  const [probeProgressPct, setProbeProgressPct] = useState<number>(0);
  const [probeStageLabel, setProbeStageLabel] = useState<string>('');
  const [probeEvents, setProbeEvents] = useState<Array<{ stage: string; label: string; progressPct: number; timestamp: string }>>([]);
  const [diagError, setDiagError] = useState<string | null>(null);

  // Batch 27 Reproducible Evaluation State
  const [batch27Report, setBatch27Report] = useState<any | null>(null);
  const [isRunningEval, setIsRunningEval] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const fetchBatch27Eval = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(apiUrl('/api/evaluation/batch27'), { headers: authHeaders() });
      const data = await res.json();
      if (res.ok && data.success && data.report) {
        setBatch27Report(data.report);
      }
    } catch {
      // Optional cached report may not exist yet
    }
  };

  const handleRunBatch27Eval = async () => {
    if (!isAuthenticated || isRunningEval) return;
    setIsRunningEval(true);
    setEvalError(null);
    try {
      const res = await fetch(apiUrl('/api/evaluation/batch27'), {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Batch 27 evaluation failed');
      setBatch27Report(data.report);
    } catch (err: any) {
      setEvalError(err?.message || 'Batch 27 evaluation failed');
    } finally {
      setIsRunningEval(false);
    }
  };

  const fetchDiagnostics = async () => {
    if (!isAuthenticated) return;
    setIsLoadingDiag(true);
    setDiagError(null);
    try {
      const res = await fetch(apiUrl('/api/model/checkpoint-diagnostics'), { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to read checkpoint diagnostics');
      setDiagnostics(data.diagnostics);
      setProbeProgressPct(data.diagnostics.weights_loaded ? 100 : 0);
      setProbeStageLabel(
        data.diagnostics.weights_loaded
          ? `Resident in memory (${data.diagnostics.runtime_tensor_mb} MiB ${data.diagnostics.runtime_dtype} across ${data.diagnostics.tensor_count} tensors)`
          : 'Not loaded'
      );
    } catch (err: any) {
      setDiagError(err.message);
      setProbeProgressPct(0);
      setProbeStageLabel(`Fail-closed: ${err.message}`);
    } finally {
      setIsLoadingDiag(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      fetchDiagnostics();
      fetchBatch27Eval();
    }
  }, [authReady, isAuthenticated]);

  const handleRunReloadProbe = async () => {
    if (!isAuthenticated || isProbingReload) return;
    setIsProbingReload(true);
    setDiagError(null);
    setProbeEvents([]);
    setProbeProgressPct(5);
    setProbeStageLabel('Initiating live checkpoint reload probe...');

    try {
      const response = await fetch(apiUrl('/api/model/checkpoint-diagnostics/probe'), {
        method: 'POST',
        headers: authHeaders()
      });
      if (!response.body) throw new Error('Readable stream unavailable from diagnostic probe');

      await consumeNdjsonStream<{
        stage: string;
        label: string;
        progressPct: number;
        timestamp: string;
        error?: string;
        diagnostics?: unknown;
      }>(response, (ev) => {
          setProbeProgressPct(ev.progressPct ?? 0);
          setProbeStageLabel(ev.label ?? ev.stage);
          setProbeEvents((prev) => [...prev, ev]);
          if (ev.error) throw new Error(ev.error);
          if (ev.diagnostics) {
            setDiagnostics(ev.diagnostics);
          }
      });
    } catch (err: any) {
      setDiagError(err.message);
      setProbeProgressPct(0);
      setProbeStageLabel(`Fail-closed: ${err.message}`);
    } finally {
      setIsProbingReload(false);
    }
  };

  const runTensorTest = async () => {
    setIsInferring(true);
    setInferenceResult(null);
    setInferenceError(null);
    try {
      const res = await fetch(apiUrl('/api/native/inference'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt: testPrompt, role: 'chat' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.message || 'Native inference failed');
      setInferenceResult(data);
    } catch (err: any) {
      setInferenceError(err?.message || 'Native inference failed');
    } finally {
      setIsInferring(false);
    }
  };

  const runtimeState = model?.runtimeState || statusData?.connectivity?.runtimeState || (model?.weightsLoaded ? 'READY' : 'NOT_LOADED');
  const executionVerified = model?.executionVerified ?? statusData?.connectivity?.executionVerified ?? false;

  return (
    <div className="space-y-8">
      {/* 7-State Execution-Gated Lifecycle Banner */}
      <VividCard
        title="Native Runtime Lifecycle & Verification"
        subtitle="Execution-gated readiness: READY requires SHA-256 verification, shape validation, and a live forward pass producing finite logits."
        gradientAccent="cyan"
        headerAction={
          <StatusDot
            status={runtimeState as any}
            label={runtimeState}
            detail={model?.executionError || model?.failClosedReason || undefined}
            pulse={runtimeState === 'INITIALIZING'}
          />
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] uppercase text-[var(--app-text-secondary)]">Runtime State</div>
            <div className={`font-bold mt-1 ${runtimeState === 'READY' ? 'text-[#CCFF00]' : runtimeState === 'FAILED' || runtimeState === 'NOT_FOUND' ? 'text-[#FF007F]' : 'text-[#FF8C73]'}`}>
              {runtimeState}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] uppercase text-[var(--app-text-secondary)]">Execution Verified</div>
            <div className={`font-bold mt-1 ${executionVerified ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
              {executionVerified ? 'TRUE (Forward Pass OK)' : 'FALSE'}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] uppercase text-[var(--app-text-secondary)]">Weights Role</div>
            <div className="font-bold mt-1 text-[#00F0FF] truncate">{model?.weightsRole || 'unloaded'}</div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] uppercase text-[var(--app-text-secondary)]">Trained Provenance</div>
            <div className="font-bold mt-1 text-[var(--app-text-primary)] truncate">{model?.trainedProvenance || 'none'}</div>
          </div>
        </div>
        {(model?.executionError || model?.failClosedReason) && (
          <div className="mt-3 p-3 rounded-xl bg-[#FF007F]/10 border border-[#FF007F]/35 text-xs font-mono text-[#FF99C8] break-words">
            {model.executionError || model.failClosedReason}
          </div>
        )}
      </VividCard>

      {/* Runtime overview — never substitute target specifications for active model facts */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
        <MetricCard
          title="Loaded Parameters"
          value={model?.weightsLoaded ? model.totalParams.toLocaleString() : '—'}
          subtitle={model?.weightsLoaded ? 'Reported by active runtime' : 'No loaded-weight count reported'}
          icon={<Binary className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Model Architecture"
          value={model?.architecture || '—'}
          subtitle={model?.name || 'Awaiting runtime information'}
          icon={<Layers className="w-5 h-5" />}
          accentColor="blue"
        />
        <MetricCard
          title="Checkpoint Integrity"
          value={!model ? '—' : model.signatureMatchesExpected === true ? 'Matched' : model.signatureMatchesExpected === false ? 'Mismatch' : 'Unreported'}
          subtitle={model?.checkpointHash ? `SHA-256 ${model.checkpointHash.slice(0, 12)}…` : 'Fingerprint unavailable'}
          icon={<ShieldCheck className="w-5 h-5" />}
          accentColor="purple"
        />
        <MetricCard
          title="Weight Availability"
          value={!model ? '—' : executionVerified && model.weightsLoaded ? 'READY' : runtimeState}
          subtitle={model?.weightsSource || model?.runtimeBridgeSource || 'Source not reported'}
          icon={<Cpu className="w-5 h-5" />}
          accentColor="lime"
        />
      </div>

      {/* Deep Architecture Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <VividCard
            title="Target Architecture Specification"
            subtitle="Roadmap target only — these dimensions are not presented as active runtime weights."
            gradientAccent="cyan"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] uppercase font-semibold">
                    <th className="pb-3 pl-1">Tensor Component</th>
                    <th className="pb-3">Matrix Dimensions</th>
                    <th className="pb-3">Parameter Count</th>
                    <th className="pb-3 text-right pr-1">Storage Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                  <tr><td className="py-2.5 pl-1 font-semibold text-[var(--app-text-primary)]">Tied Token &amp; Positional Embeddings</td><td className="py-2.5">16,384 × 512 + 64 × 512</td><td className="py-2.5">8,421,376</td><td className="py-2.5 text-right pr-1">Planned</td></tr>
                  <tr><td className="py-2.5 pl-1 font-semibold text-[var(--app-text-primary)]">10-Layer Multi-Head Attention</td><td className="py-2.5">10 × 4 × 512 × 512 projections</td><td className="py-2.5">10,485,760</td><td className="py-2.5 text-right pr-1">Planned</td></tr>
                  <tr><td className="py-2.5 pl-1 font-semibold text-[var(--app-text-primary)]">10-Layer SwiGLU Feed-Forward</td><td className="py-2.5">10 × (512 → 1,472 → 512)</td><td className="py-2.5">22,609,920</td><td className="py-2.5 text-right pr-1">Planned</td></tr>
                  <tr><td className="py-2.5 pl-1 font-semibold text-[var(--app-text-primary)]">21 RMSNorm Vectors</td><td className="py-2.5">21 × 512 (pre-attn/FFN + final)</td><td className="py-2.5">10,752</td><td className="py-2.5 text-right pr-1">Planned</td></tr>
                  <tr className="bg-[var(--app-surface-elevated)] font-bold"><td className="py-3 pl-1 text-[var(--app-text-primary)]">Target configuration</td><td className="py-3 text-[var(--app-text-primary)]">10 blocks / 8 heads / 512 dims</td><td className="py-3 text-[#00F0FF]">41,527,808</td><td className="py-3 text-right pr-1 text-[var(--app-text-secondary)]">Roadmap only</td></tr>
                </tbody>
              </table>
            </div>
          </VividCard>

          {/* Interactive Latent Space Tester */}
          <VividCard
            title="Native Model Inference"
            subtitle="Requests the current runtime inference endpoint; results and active checkpoint details come from the server."
            gradientAccent="violet"
          >
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  placeholder="Enter prompt to compute native tensor projection..."
                  className="flex-1 min-h-[44px] px-4 py-2.5 text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:border-[#00F0FF] text-[var(--app-text-primary)] font-mono"
                />
                <button
                  onClick={runTensorTest}
                  disabled={isInferring}
                  className="min-h-[44px] px-5 py-2.5 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isInferring ? 'Computing...' : 'Project'}
                </button>
              </div>

              {inferenceError && (
                <div role="alert" className="text-sm text-[#FF007F] font-mono">{inferenceError}</div>
              )}
              {inferenceResult && (
                <div className="p-4 rounded-xl bg-[var(--app-input-bg)] text-[var(--app-text-primary)] font-mono text-xs space-y-2 border border-[var(--app-card-border)] tabular-nums">
                  <div className="flex items-center justify-between text-[var(--app-text-secondary)] border-b border-[var(--app-card-border)] pb-2">
                    <span className="text-[#00F0FF] font-semibold">Runtime inference response</span>
                    <span className="text-[var(--app-text-secondary)]">{inferenceResult.model || 'Native model'}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                    <div>
                      <span className="text-[var(--app-text-secondary)]">Tokens:</span>{' '}
                      <span className="text-[var(--app-text-primary)] font-bold">{inferenceResult.outputTokens ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-[var(--app-text-secondary)]">Latent Norm:</span>{' '}
                      <span className="text-[var(--app-text-primary)] font-bold">{inferenceResult.latentNorm ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-[var(--app-text-secondary)]">Throughput:</span>{' '}
                      <span className="text-[#CCFF00] font-bold">{typeof inferenceResult.tokens_per_sec === 'number' ? `${inferenceResult.tokens_per_sec.toFixed(2)} tok/s` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-[var(--app-text-secondary)]">Latency:</span>{' '}
                      <span className="text-[#00F0FF] font-bold">{inferenceResult.latency_ms != null ? `${inferenceResult.latency_ms} ms` : '—'}</span>
                    </div>
                  </div>
                  {inferenceResult.response && (
                    <div className="mt-2 border-t border-[var(--app-card-border)] pt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--app-text-primary)]">
                      {inferenceResult.response}
                    </div>
                  )}
                  <div className="text-[10px] text-[var(--app-text-secondary)] pt-1 space-y-1">
                    <div>Parameters: {inferenceResult.totalParams?.toLocaleString?.() ?? '—'}</div>
                    <div>Checkpoint: {inferenceResult.checkpointHash || 'Not reported'}</div>
                  </div>
                </div>
              )}
            </div>
          </VividCard>
        </div>

        {/* Right Col: Sovereign Invariants & Cryptographic Seal */}
        <div className="space-y-6">
          <VividCard title="Checkpoint Evidence" subtitle="Values reported by the runtime" gradientAccent="coral">
            <div className="space-y-4 text-xs">
              <div className="rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] p-3">
                <div className="text-[var(--app-text-secondary)] text-[10px] uppercase font-bold">Checkpoint source</div>
                <div className="font-mono text-[var(--app-text-primary)] text-[11px] mt-0.5 break-all">
                  {model?.weightsSource || model?.runtimeBridgeSource || 'Not reported by runtime'}
                </div>
              </div>
              <div className="rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] p-3">
                <div className="text-[var(--app-text-secondary)] text-[10px] uppercase font-bold">SHA-256 digest</div>
                <div className="font-mono text-[#00F0FF] text-[11px] mt-0.5 break-all">
                  {model?.checkpointHash || 'Fingerprint unavailable'}
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--app-text-secondary)]">
                <ShieldCheck className="w-4 h-4 shrink-0 text-[#00F0FF]" />
                <span>{!model ? 'Runtime status unavailable.' : model.weightsLoaded ? 'Runtime reports weights loaded.' : 'Runtime reports weights are not loaded; inference should remain fail-closed.'}</span>
              </div>
            </div>
          </VividCard>
        </div>
      </div>

      {/* Real-Time Checkpoint Loading Progress & Memory Allocation Diagnostic View */}
      <VividCard
        title="Checkpoint Loading & Memory Allocation Diagnostics"
        subtitle={diagnostics?.checkpoint_path || "Telemetry reported for the current runtime checkpoint"}
        gradientAccent="lime"
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={diagnostics?.weights_loaded ? 'VERIFIED' : diagError ? 'BLOCKED' : 'PARTIAL'} />
            <button
              onClick={fetchDiagnostics}
              disabled={isLoadingDiag || isProbingReload || !isAuthenticated}
              className="min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--app-input-bg)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[#00F0FF] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Refresh Snapshot
            </button>
            <button
              onClick={handleRunReloadProbe}
              disabled={isProbingReload || !isAuthenticated}
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white vivid-gradient-brand rounded-lg shadow-sm hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isProbingReload ? 'animate-spin' : ''}`} />
              <span>{isProbingReload ? 'Reloading Checkpoint...' : 'Run Live Reload Probe'}</span>
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          {diagError && (
            <div className="p-3 rounded-xl bg-[#FF007F]/10 border border-[#FF007F]/40 text-xs text-[#FF007F] font-mono">
              {diagError}
            </div>
          )}

          {/* Real-Time Loading Progress Bar */}
          <div className="p-4 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-[var(--app-text-primary)]">
                <HardDrive className="w-4 h-4 text-[#00F0FF]" />
                <span>{probeStageLabel || 'Inspecting the current runtime checkpoint...'}</span>
              </div>
              <span className="font-mono font-bold text-[#CCFF00] tabular-nums">
                {probeProgressPct}% {diagnostics?.total_load_ms ? `(${diagnostics.total_load_ms} ms)` : ''}
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-[#070B19] border border-[var(--app-card-border)] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#00F0FF] via-[#7B2CBF] to-[#CCFF00] transition-all duration-200"
                style={{ width: `${Math.min(100, Math.max(0, probeProgressPct))}%` }}
              />
            </div>

            {diagnostics?.stages && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {diagnostics.stages.map((st: any) => (
                  <div key={st.id} className="p-2.5 rounded-lg bg-[#070B19] border border-[var(--app-card-border)] flex items-center justify-between text-[11px]">
                    <span className="text-[var(--app-text-primary)] truncate pr-2">{st.label}</span>
                    <span className="font-mono text-[#00F0FF] tabular-nums shrink-0">{st.duration_ms} ms</span>
                  </div>
                ))}
              </div>
            )}

            {probeEvents.length > 0 && (
              <div className="pt-2 border-t border-[var(--app-card-border)] space-y-1 font-mono text-[11px] text-[var(--app-text-secondary)]">
                {probeEvents.map((ev, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate">[{ev.timestamp.slice(11, 19)}] {ev.stage}: {ev.label}</span>
                    <span className="text-[#CCFF00] tabular-nums shrink-0">{ev.progressPct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Memory Allocation Summary Metrics */}
          {diagnostics && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                  <div className="text-[11px] text-[var(--app-text-secondary)]">Disk Float32 Payload</div>
                  <div className="text-base font-bold text-[var(--app-text-primary)] font-mono tabular-nums mt-0.5">
                    {diagnostics.disk_float32_mb} MiB
                  </div>
                  <div className="text-[10px] text-[var(--app-text-secondary)] font-mono tabular-nums">
                    {diagnostics.file_size_bytes?.toLocaleString()} bytes on disk
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                  <div className="text-[11px] text-[var(--app-text-secondary)]">Runtime Tensor Buffers</div>
                  <div className="text-base font-bold text-[#CCFF00] font-mono tabular-nums mt-0.5">
                    {diagnostics.runtime_tensor_mb} MiB
                  </div>
                  <div className="text-[10px] text-[var(--app-text-secondary)] font-mono tabular-nums">
                    {diagnostics.tensor_count} tensors ({diagnostics.runtime_dtype})
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                  <div className="text-[11px] text-[var(--app-text-secondary)]">Python Bridge RSS</div>
                  <div className="text-base font-bold text-[#00F0FF] font-mono tabular-nums mt-0.5">
                    {diagnostics.python_process_rss_mb} MiB
                  </div>
                  <div className="text-[10px] text-[var(--app-text-secondary)] font-mono tabular-nums">
                    Node RSS: {diagnostics.node_process_rss_mb} MiB
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                  <div className="text-[11px] text-[var(--app-text-secondary)]">Host RAM Free / Total</div>
                  <div className="text-base font-bold text-[#FF5E3A] font-mono tabular-nums mt-0.5">
                    {diagnostics.system_free_ram_mb?.toLocaleString()} MiB
                  </div>
                  <div className="text-[10px] text-[var(--app-text-secondary)] font-mono tabular-nums">
                    of {diagnostics.system_total_ram_mb?.toLocaleString()} MiB total
                  </div>
                </div>
              </div>

              {/* Component-Level Tensor Allocation Table */}
              <div className="overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--app-input-bg)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Tensor Group</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Tensors</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Parameters</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Disk (Float32)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Runtime Allocation</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Memory Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-surface)] font-mono tabular-nums text-[11px] text-[var(--app-text-primary)]">
                    {(diagnostics.components || []).map((comp: any) => (
                      <tr key={comp.key}>
                        <td className="py-2.5 px-3 font-sans font-medium text-[var(--app-text-primary)]">{comp.label}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--app-text-secondary)]">{comp.tensors}</td>
                        <td className="py-2.5 px-3 text-right">{comp.params.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--app-text-secondary)]">{comp.disk_float32_mb.toFixed(2)} MiB</td>
                        <td className="py-2.5 px-3 text-right text-[#00F0FF] font-bold">{comp.runtime_mb.toFixed(2)} MiB</td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-[var(--app-input-bg)] overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-[#00F0FF] to-[#7B2CBF]" style={{ width: `${comp.share_pct}%` }} />
                            </div>
                            <span>{comp.share_pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </VividCard>

      {/* Batch 27 Reproducible Evaluation Runner */}
      <VividCard
        title="Batch 27 Reproducible Evaluation"
        subtitle="Zero-simulation benchmark: runtime readiness, Thai/EN/mixed tokenizer, PPL/TTFT, RAG Precision@3 & MRR, memory integrity, and security invariants."
        gradientAccent="violet"
        headerAction={
          <div className="flex items-center gap-2">
            {batch27Report && (
              <StatusBadge
                status={
                  batch27Report.status === 'VERIFIED'
                    ? 'VERIFIED'
                    : batch27Report.status === 'FAILED'
                    ? 'FAILED'
                    : 'PARTIAL'
                }
                label={batch27Report.status}
              />
            )}
            <button
              onClick={handleRunBatch27Eval}
              disabled={isRunningEval || !isAuthenticated}
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white vivid-gradient-brand rounded-lg shadow-sm hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <FlaskConical className={`w-3.5 h-3.5 ${isRunningEval ? 'animate-spin' : ''}`} />
              <span>{isRunningEval ? 'Evaluating...' : 'Run Batch 27 Evaluation'}</span>
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {evalError && (
            <div className="p-3 rounded-xl bg-[#FF007F]/10 border border-[#FF007F]/40 text-xs text-[#FF66B2] font-mono">
              {evalError}
            </div>
          )}

          {!batch27Report && !evalError && (
            <div className="p-4 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-secondary)]">
              Click <span className="text-[#00F0FF] font-semibold">Run Batch 27 Evaluation</span> to execute reproducible tokenizer, runtime, RAG, memory, and security checks. Weight-dependent checks report BLOCKED until cloud weights are READY.
            </div>
          )}

          {batch27Report && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                  <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Checks Summary</div>
                  <div className="font-bold mt-1 text-[#CCFF00]">
                    {batch27Report.summary?.passed} PASS · {batch27Report.summary?.blocked} BLOCKED · {batch27Report.summary?.failed} FAIL
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                  <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">RAG Precision@3 / MRR</div>
                  <div className="font-bold mt-1 text-[#00F0FF]">
                    P@3={batch27Report.knowledgeMetrics?.precisionAt3} · MRR={batch27Report.knowledgeMetrics?.mrr}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                  <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Tokenizer Roundtrip</div>
                  <div className="font-bold mt-1 text-[#CCFF00]">
                    {batch27Report.pythonEval?.tokenizer?.roundtrip_accuracy != null
                      ? `${(Number(batch27Report.pythonEval.tokenizer.roundtrip_accuracy) * 100).toFixed(1)}% (${(Number(batch27Report.pythonEval.tokenizer.unk_rate || 0) * 100).toFixed(2)}% UNK)`
                      : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
                  <div className="text-[10px] text-[var(--app-text-secondary)] uppercase">Memory &amp; Audit SHA</div>
                  <div className={`font-bold mt-1 ${batch27Report.memoryMetrics?.integrityValid && batch27Report.securityMetrics?.auditChainValid ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                    Mem={String(batch27Report.memoryMetrics?.integrityValid)} · Audit={String(batch27Report.securityMetrics?.auditChainValid)}
                  </div>
                </div>
              </div>

              <div className="text-[11px] font-mono text-[var(--app-text-secondary)] bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl p-3 flex flex-wrap gap-x-6 gap-y-1">
                <span>runId: <strong className="text-[var(--app-text-primary)]">{batch27Report.runId}</strong></span>
                <span>dataset: <strong className="text-[var(--app-text-primary)]">{batch27Report.provenance?.datasetVersion}</strong></span>
                <span>runtimeState: <strong className="text-[#00F0FF]">{batch27Report.provenance?.runtimeState}</strong></span>
                <span>hardware: <strong className="text-[var(--app-text-primary)]">{batch27Report.provenance?.hardware?.platform}/{batch27Report.provenance?.hardware?.arch} ({batch27Report.provenance?.hardware?.cpus} CPU)</strong></span>
                {batch27Report.provenance?.checkpointSha256 && (
                  <span>ckptSha: <strong className="text-[#CCFF00]">{batch27Report.provenance.checkpointSha256.slice(0, 16)}…</strong></span>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--app-input-bg)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Check ID</th>
                      <th className="py-2.5 px-3 font-semibold">Category</th>
                      <th className="py-2.5 px-3 font-semibold">Verification</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                      <th className="py-2.5 px-3 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-surface)] text-[11px]">
                    {(batch27Report.checks || []).map((chk: any) => (
                      <tr key={chk.id}>
                        <td className="py-2.5 px-3 font-mono font-bold text-[#00F0FF] whitespace-nowrap">{chk.id}</td>
                        <td className="py-2.5 px-3 font-mono text-[var(--app-text-secondary)] uppercase">{chk.category}</td>
                        <td className="py-2.5 px-3 font-semibold text-[var(--app-text-primary)]">{chk.name}</td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <StatusDot
                            status={chk.status === 'PASS' ? 'VERIFIED' : chk.status === 'FAIL' ? 'FAILED' : 'BLOCKED'}
                            label={chk.status}
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[var(--app-text-secondary)] break-words max-w-md">{chk.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {batch27Report.baselineComparison && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] font-mono tabular-nums">
                  <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[10px] uppercase text-[var(--app-text-secondary)]">Baseline Artifact: LM v2 (502K)</div>
                    {batch27Report.baselineComparison.lmV2Baseline ? (
                      <>
                        <div className="text-[var(--app-text-primary)] font-bold">
                          Val PPL={batch27Report.baselineComparison.lmV2Baseline.valPerplexity.toFixed(2)} · Top1={(batch27Report.baselineComparison.lmV2Baseline.top1Accuracy * 100).toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-[var(--app-text-secondary)]">
                          Thai PPL={batch27Report.baselineComparison.lmV2Baseline.thaiValPerplexity.toFixed(2)} · SHA={batch27Report.baselineComparison.lmV2Baseline.checkpointSha256.slice(0, 10)}
                        </div>
                      </>
                    ) : (
                      <div className="text-[var(--app-text-secondary)]">Artifact unavailable</div>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[10px] uppercase text-[var(--app-text-secondary)]">Baseline Artifact: Target 41.5M</div>
                    {batch27Report.baselineComparison.target41mBaseline ? (
                      <>
                        <div className="text-[var(--app-text-primary)] font-bold">
                          Best Val Loss={batch27Report.baselineComparison.target41mBaseline.bestValLoss.toFixed(3)} ({batch27Report.baselineComparison.target41mBaseline.stepsRecorded} steps)
                        </div>
                        <div className="text-[10px] text-[var(--app-text-secondary)]">
                          Params={batch27Report.baselineComparison.target41mBaseline.params.toLocaleString()} · SHA={batch27Report.baselineComparison.target41mBaseline.checkpointSha256.slice(0, 10)}
                        </div>
                      </>
                    ) : (
                      <div className="text-[var(--app-text-secondary)]">Artifact unavailable</div>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
                    <div className="text-[10px] uppercase text-[var(--app-text-secondary)]">Current Live Runtime (TH / EN)</div>
                    {batch27Report.baselineComparison.currentLiveRuntime?.executionVerified ? (
                      <>
                        <div className="text-[#CCFF00] font-bold">
                          PPL={batch27Report.baselineComparison.currentLiveRuntime.perplexity ?? '—'} · Acc={batch27Report.baselineComparison.currentLiveRuntime.nextTokenAccuracy != null ? `${(batch27Report.baselineComparison.currentLiveRuntime.nextTokenAccuracy * 100).toFixed(1)}%` : '—'}
                        </div>
                        <div className="text-[10px] text-[var(--app-text-secondary)]">
                          TH PPL={batch27Report.baselineComparison.currentLiveRuntime.thaiPerplexity ?? '—'} · EN PPL={batch27Report.baselineComparison.currentLiveRuntime.englishPerplexity ?? '—'}
                        </div>
                      </>
                    ) : (
                      <div className="text-[#FF8C73] font-bold">
                        BLOCKED ({batch27Report.baselineComparison.currentLiveRuntime?.runtimeState || 'NOT_CONFIGURED'})
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </VividCard>

      {/* Data Sovereignty Section */}
      <VividCard
        title="Data Sovereignty"
        subtitle="Visualize, export, or permanently delete conversational history, knowledge collections & agent memory"
        gradientAccent="cyan"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="space-y-1">
            <div className="font-semibold text-[var(--app-text-primary)]">
              Online Sovereign Storage (Browser + Native Disk)
            </div>
            <div className="text-[11px] text-[var(--app-text-secondary)] font-mono">
              Session Logs &amp; Snapshots: {typeof window !== 'undefined' && localStorage.getItem('zyntheor_quick_logs') ? 'Present' : 'Empty'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const bundle = {
                  exportedAt: new Date().toISOString(),
                  quickLogs: JSON.parse(localStorage.getItem('zyntheor_quick_logs') || '[]'),
                  snapshots: JSON.parse(localStorage.getItem('zyntheor_log_snapshots') || '[]')
                };
                const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `zyntheor-data-sovereignty-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold bg-[var(--app-input-bg)] text-[var(--app-text-primary)] border border-[var(--app-card-border)] hover:border-[#00F0FF] cursor-pointer"
            >
              Export Data (JSON)
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && window.confirm('Confirm permanent wipe of cloud session logs and snapshots? Model weights, Knowledge Workspace, and Audit Ledger will NOT be affected.')) {
                  localStorage.removeItem('zyntheor_quick_logs');
                  localStorage.removeItem('zyntheor_log_snapshots');
                }
              }}
              className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold bg-[#FF007F]/15 text-[#FF007F] border border-[#FF007F]/40 hover:bg-[#FF007F]/25 cursor-pointer"
            >
              Wipe Cloud Session Data
            </button>
          </div>
        </div>
      </VividCard>
    </div>
  );
};
