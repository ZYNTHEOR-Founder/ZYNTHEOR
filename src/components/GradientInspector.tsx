import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VividCard } from './ui/VividCard';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/apiClient';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Layers,
  Play,
  RefreshCw,
  ShieldCheck,
  TrendingDown
} from 'lucide-react';

interface TensorManifestItem {
  name: string;
  shape: number[];
  params: number;
  dtype: string;
  sha256: string;
}

interface LatestTrainingStep {
  training_step?: number;
  tokens_processed?: number;
  epochs?: number;
  loss_before?: number;
  loss_after?: number;
  loss_reduction_pct?: number;
  initial_param_norm?: number;
  final_param_norm?: number;
  param_mutation_delta?: number;
  param_changed_verified?: boolean;
  avg_gradient_norm?: number;
  layer_count?: number;
  layer_gradient_norms?: Record<string, number>;
  layer_gradient_norms_pre_clip?: Record<string, number>;
  grad_clip_max_norm?: number;
  model_name?: string;
  total_params?: number;
  forward_graph?: string;
  executed_runtime_bridge?: string;
  timestamp?: number;
}

interface InspectResponse {
  success: boolean;
  exists?: boolean;
  status?: string;
  payload_sha256?: string;
  payload_float32_count?: number;
  sha256_match?: boolean;
  parameter_count_match?: boolean;
  manifest_count_match?: boolean;
  metadata?: {
    model_name?: string;
    architecture?: string;
    total_params?: number;
    tensors_manifest?: TensorManifestItem[];
  };
  latest_training_step?: LatestTrainingStep | null;
}

interface TrainingPoint {
  step: number;
  trainLoss: number;
  valLoss: number;
  gradNorm?: number | null;
}

interface LiveStepPoint {
  trainingStep: number;
  timestamp: number;
  lossBefore: number;
  lossAfter: number;
  lossReductionPct: number;
  paramMutationDelta: number;
  initialParamNorm: number;
  finalParamNorm: number;
  avgGradientNorm: number;
}

interface TrainingLogsResponse {
  success: boolean;
  v2_2m?: {
    params: number;
    bestValLoss: number;
    bestValPerplexity: number;
    checkpointSha256: string | null;
    points: TrainingPoint[];
    gatedPoints?: TrainingPoint[];
  };
  liveSteps?: LiveStepPoint[];
  latestStep?: LatestTrainingStep | null;
}

type LayerGroupFilter = 'all' | 'embeddings' | 'block0' | 'block1' | 'norms';

function buildSparklinePath(values: number[], width: number, height: number, minVal: number, maxVal: number): string {
  if (values.length === 0) return '';
  if (values.length === 1) {
    const y = height / 2;
    return `M 4 ${y} L ${width - 4} ${y}`;
  }
  const padX = 6;
  const padY = 8;
  const usableW = Math.max(1, width - padX * 2);
  const usableH = Math.max(1, height - padY * 2);
  const span = Math.max(1e-6, maxVal - minVal);
  return values
    .map((val, idx) => {
      const x = padX + (idx / (values.length - 1)) * usableW;
      const norm = (val - minVal) / span;
      const y = padY + (1 - norm) * usableH;
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export const GradientInspector: React.FC = () => {
  const { authReady, isAuthenticated, authHeaders } = useAuth();
  const [inspectData, setInspectData] = useState<InspectResponse | null>(null);
  const [logsData, setLogsData] = useState<TrainingLogsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStepping, setIsStepping] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stepInputText, setStepInputText] = useState(
    'ZYNTHEOR NativeLM v2 2.0M forward and backward autograd gradient verification'
  );
  const [groupFilter, setGroupFilter] = useState<LayerGroupFilter>('all');

  const fetchInspectorData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [inspectRes, logsRes] = await Promise.all([
        fetch(apiUrl('/api/model/inspect'), { headers: authHeaders() }),
        fetch(apiUrl('/api/model/training-logs'), { headers: authHeaders() })
      ]);
      const inspectJson: InspectResponse = await inspectRes.json();
      const logsJson: TrainingLogsResponse = await logsRes.json();
      if (!inspectRes.ok || !inspectJson.success) {
        throw new Error((inspectJson as any)?.error || `Inspect HTTP ${inspectRes.status}`);
      }
      if (!logsRes.ok || !logsJson.success) {
        throw new Error((logsJson as any)?.error || `Logs HTTP ${logsRes.status}`);
      }
      setInspectData(inspectJson);
      setLogsData(logsJson);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load 2.0M model telemetry');
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (authReady && isAuthenticated) {
      void fetchInspectorData();
    }
  }, [authReady, isAuthenticated, fetchInspectorData]);

  const handleRunTrainingStep = async () => {
    if (isStepping) return;
    setIsStepping(true);
    setErrorMsg(null);
    try {
      const res = await fetch(apiUrl('/api/model/train'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          text: stepInputText.trim() || undefined,
          epochs: 1
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Train step HTTP ${res.status}`);
      }
      await fetchInspectorData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Training step failed');
    } finally {
      setIsStepping(false);
    }
  };

  const latestStep = inspectData?.latest_training_step || logsData?.latestStep || null;
  const tensors = inspectData?.metadata?.tensors_manifest || [];
  const clippedNorms = latestStep?.layer_gradient_norms || {};
  const preClipNorms = latestStep?.layer_gradient_norms_pre_clip || {};

  const filteredTensors = useMemo(() => {
    return tensors.filter((t) => {
      if (groupFilter === 'all') return true;
      if (groupFilter === 'embeddings') return t.name === 'tok_emb' || t.name === 'pos_emb';
      if (groupFilter === 'block0') return t.name.startsWith('b0.');
      if (groupFilter === 'block1') return t.name.startsWith('b1.');
      if (groupFilter === 'norms') return t.name.includes('norm');
      return true;
    });
  }, [tensors, groupFilter]);

  const maxClippedNorm = useMemo(() => {
    const vals = Object.values(clippedNorms);
    return vals.length > 0 ? Math.max(...vals, 0.01) : 1.0;
  }, [clippedNorms]);

  // Sparkline series from real v2_2m training history + live steps
  const v2Points = logsData?.v2_2m?.points || [];
  const liveSteps = logsData?.liveSteps || [];

  const sparklineStats = useMemo(() => {
    const trainLosses = v2Points.map((p) => p.trainLoss).filter((n) => Number.isFinite(n) && n > 0);
    const valLosses = v2Points.map((p) => p.valLoss).filter((n) => Number.isFinite(n) && n > 0);
    const liveLosses = liveSteps.flatMap((s) => [s.lossBefore, s.lossAfter]).filter((n) => Number.isFinite(n));
    const allLossVals = [...trainLosses, ...valLosses];
    const minLoss = allLossVals.length > 0 ? Math.min(...allLossVals) : 0;
    const maxLoss = allLossVals.length > 0 ? Math.max(...allLossVals) : 5;

    const width = 420;
    const height = 96;
    const trainPath = buildSparklinePath(trainLosses, width, height, minLoss, maxLoss);
    const valPath = buildSparklinePath(valLosses, width, height, minLoss, maxLoss);

    const paramDeltas = liveSteps.map((s) => s.paramMutationDelta).filter((n) => Number.isFinite(n));
    const minLiveLoss = liveLosses.length > 0 ? Math.min(...liveLosses) : 0;
    const maxLiveLoss = liveLosses.length > 0 ? Math.max(...liveLosses) : 5;
    const liveLossPath = buildSparklinePath(liveLosses, width, 64, minLiveLoss, maxLiveLoss);

    const minDelta = paramDeltas.length > 0 ? Math.min(...paramDeltas) : 0;
    const maxDelta = paramDeltas.length > 0 ? Math.max(...paramDeltas) : 1;
    const deltaPath = buildSparklinePath(paramDeltas, width, 64, Math.min(0, minDelta), Math.max(maxDelta, 1e-6));

    return {
      width,
      height,
      trainLosses,
      valLosses,
      minLoss,
      maxLoss,
      trainPath,
      valPath,
      liveLosses,
      minLiveLoss,
      maxLiveLoss,
      liveLossPath,
      paramDeltas,
      deltaPath
    };
  }, [v2Points, liveSteps]);

  const healthyTensorCount = useMemo(() => {
    return tensors.filter((t) => {
      const n = clippedNorms[t.name];
      return typeof n === 'number' && n >= 1e-5 && n <= 10.0;
    }).length;
  }, [tensors, clippedNorms]);

  return (
    <VividCard
      gradientAccent="cyan"
      className="!p-5 sm:!p-6 md:!p-8"
      title="Gradient Inspector · NativeLM v2 (2.0M)"
      subtitle="Live parameter integrity, loss history sparkline, and 21-tensor backprop gradient inspection"
      headerAction={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchInspectorData()}
            disabled={isLoading}
            className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[var(--app-card-border)] bg-[var(--app-input-bg)] text-[var(--app-text-primary)] hover:border-[#00F0FF] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#00F0FF] ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => void handleRunTrainingStep()}
            disabled={isStepping}
            className="min-h-[40px] flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-[#00F0FF] to-[#CCFF00] text-[#070B19] hover:brightness-105 cursor-pointer disabled:opacity-50 shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isStepping ? 'Stepping 2.0M Autograd...' : 'Run 2.0M Training Step'}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-[#FF007F]/12 border border-[#FF007F]/45 text-[#FF99C8] text-xs font-mono flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#FF007F] shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Top Verification & Runtime Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
          <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#00F0FF]" />
              Checkpoint Params
            </div>
            <div className="mt-1 text-lg font-black font-mono text-[var(--app-text-primary)]">
              {(inspectData?.payload_float32_count ?? inspectData?.metadata?.total_params ?? 502912).toLocaleString()}
            </div>
            <div className="text-[10px] font-mono text-[#CCFF00] mt-0.5">
              {tensors.length} Float32 tensors · {inspectData?.status || 'LOADING'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-[#00F0FF]" />
              Latest Step Loss Delta
            </div>
            <div className="mt-1 text-lg font-black font-mono text-[var(--app-text-primary)]">
              {latestStep?.loss_before !== undefined && latestStep?.loss_after !== undefined
                ? `${latestStep.loss_before.toFixed(4)} → ${latestStep.loss_after.toFixed(4)}`
                : '—'}
            </div>
            <div className="text-[10px] font-mono text-[#00F0FF] mt-0.5">
              {latestStep?.loss_reduction_pct !== undefined
                ? `${latestStep.loss_reduction_pct >= 0 ? '-' : '+'}${Math.abs(latestStep.loss_reduction_pct)}% step reduction`
                : 'Awaiting step'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[#FF5E3A]" />
              Parameter Mutation (L2)
            </div>
            <div className="mt-1 text-lg font-black font-mono text-[#FF5E3A]">
              {latestStep?.param_mutation_delta !== undefined
                ? `Δ ${latestStep.param_mutation_delta.toFixed(6)}`
                : '—'}
            </div>
            <div className="text-[10px] font-mono text-[var(--app-text-secondary)] mt-0.5">
              {latestStep?.initial_param_norm !== undefined && latestStep?.final_param_norm !== undefined
                ? `||W||₂ ${latestStep.initial_param_norm.toFixed(4)} → ${latestStep.final_param_norm.toFixed(4)}`
                : 'Norm unchanged'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)]">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--app-text-secondary)] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#CCFF00]" />
              Autograd Bridge Health
            </div>
            <div className="mt-1 text-lg font-black font-mono text-[#CCFF00]">
              {tensors.length > 0 ? `${healthyTensorCount} / ${tensors.length} HEALTHY` : '—'}
            </div>
            <div className="text-[10px] font-mono text-[var(--app-text-secondary)] mt-0.5 truncate">
              {latestStep?.executed_runtime_bridge
                ? `${latestStep.executed_runtime_bridge} · Step #${latestStep?.training_step ?? 1}`
                : 'Cloud bridge ready'}
            </div>
          </div>
        </div>

        {/* Interactive Training Text Sample for Live Single-Step */}
        <div className="p-3 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] flex flex-col sm:flex-row sm:items-center gap-2.5">
          <label className="text-[11px] font-mono font-bold text-[var(--app-text-secondary)] shrink-0">
            Step Sample:
          </label>
          <input
            type="text"
            value={stepInputText}
            onChange={(e) => setStepInputText(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-[var(--app-text-primary)] focus:outline-none focus:border-[#00F0FF]"
            placeholder="Training sample for real 2.0M forward/backward step..."
          />
          {inspectData?.payload_sha256 && (
            <span
              className="text-[10px] font-mono text-[var(--app-text-secondary)] shrink-0"
              title={inspectData.payload_sha256}
            >
              Cloud SHA: <b className="text-[#00F0FF]">{inspectData.payload_sha256.slice(0, 12)}…</b>
            </span>
          )}
        </div>

        {/* Sparkline Charts: Loss History & Current Parameter Updates */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart 1: v2_2m Corpus Training & Validation Loss Sparkline */}
          <div className="p-4 rounded-2xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-[var(--app-text-primary)]">
                  2.0M Model Loss History Sparkline
                </div>
                <div className="text-[10px] font-mono tabular-nums text-[var(--app-text-secondary)]">
                  {v2Points.length} logged evaluations · Best val loss{' '}
                  {logsData?.v2_2m?.bestValLoss ?? '—'} (PPL {logsData?.v2_2m?.bestValPerplexity ?? '—'})
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="flex items-center gap-1 text-[#00F0FF]">
                  <span className="w-2.5 h-0.5 bg-[#00F0FF] inline-block" /> Train
                </span>
                <span className="flex items-center gap-1 text-[#FF5E3A]">
                  <span className="w-2.5 h-0.5 bg-[#FF5E3A] inline-block border-t border-dashed" /> Val
                </span>
              </div>
            </div>

            {v2Points.length > 0 ? (
              <div className="relative">
                <svg
                  viewBox={`0 0 ${sparklineStats.width} ${sparklineStats.height}`}
                  className="w-full h-24 overflow-visible"
                  role="img"
                  aria-label="2.0M training and validation loss sparkline"
                >
                  <line x1="0" y1="8" x2={sparklineStats.width} y2="8" stroke="#1E294A" strokeDasharray="3 3" />
                  <line
                    x1="0"
                    y1={sparklineStats.height - 8}
                    x2={sparklineStats.width}
                    y2={sparklineStats.height - 8}
                    stroke="#1E294A"
                    strokeDasharray="3 3"
                  />
                  {sparklineStats.valPath && (
                    <path
                      d={sparklineStats.valPath}
                      fill="none"
                      stroke="#FF5E3A"
                      strokeWidth="1.8"
                      strokeDasharray="4 3"
                    />
                  )}
                  {sparklineStats.trainPath && (
                    <path
                      d={sparklineStats.trainPath}
                      fill="none"
                      stroke="#00F0FF"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-[var(--app-text-secondary)]">
                  <span>
                    Step {v2Points[0]?.step}: {v2Points[0]?.trainLoss.toFixed(3)}
                  </span>
                  <span>
                    Range [{sparklineStats.minLoss.toFixed(3)} – {sparklineStats.maxLoss.toFixed(3)}]
                  </span>
                  <span className="text-[#CCFF00] font-bold">
                    Step {v2Points[v2Points.length - 1]?.step}: {v2Points[v2Points.length - 1]?.trainLoss.toFixed(3)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-xs font-mono text-[var(--app-text-secondary)]">
                No v2 training curve recorded yet.
              </div>
            )}
          </div>

          {/* Chart 2: Live Single-Step Loss & Weight Parameter Updates Sparkline */}
          <div className="p-4 rounded-2xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-[var(--app-text-primary)]">
                  Live Parameter Updates & Step Loss Sparkline
                </div>
                <div className="text-[10px] font-mono tabular-nums text-[var(--app-text-secondary)]">
                  {liveSteps.length} live 2.0M step{liveSteps.length === 1 ? '' : 's'} · Avg grad norm{' '}
                  {latestStep?.avg_gradient_norm !== undefined ? latestStep.avg_gradient_norm.toFixed(4) : '—'}
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="flex items-center gap-1 text-[#00F0FF]">
                  <span className="w-2.5 h-0.5 bg-[#00F0FF] inline-block" /> Step Loss
                </span>
                <span className="flex items-center gap-1 text-[#FF007F]">
                  <span className="w-2.5 h-0.5 bg-[#FF007F] inline-block" /> ΔW
                </span>
              </div>
            </div>

            {liveSteps.length > 0 ? (
              <div className="space-y-1.5">
                <svg
                  viewBox={`0 0 ${sparklineStats.width} 64`}
                  className="w-full h-16 overflow-visible"
                  role="img"
                  aria-label="Live step loss and parameter delta sparkline"
                >
                  <line x1="0" y1="56" x2={sparklineStats.width} y2="56" stroke="#1E294A" strokeDasharray="3 3" />
                  {sparklineStats.liveLossPath && (
                    <path
                      d={sparklineStats.liveLossPath}
                      fill="none"
                      stroke="#00F0FF"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  )}
                  {sparklineStats.deltaPath && (
                    <path
                      d={sparklineStats.deltaPath}
                      fill="none"
                      stroke="#FF007F"
                      strokeWidth="1.6"
                      strokeDasharray="3 2"
                    />
                  )}
                </svg>
                <div className="grid grid-cols-3 gap-2 pt-1 text-[10px] font-mono tabular-nums">
                  <div className="px-2 py-1 rounded bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                    <span className="text-[var(--app-text-secondary)] block">Loss Before → After</span>
                    <span className="text-[#00F0FF] font-bold">
                      {liveSteps[liveSteps.length - 1].lossBefore.toFixed(4)} →{' '}
                      {liveSteps[liveSteps.length - 1].lossAfter.toFixed(4)}
                    </span>
                  </div>
                  <div className="px-2 py-1 rounded bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                    <span className="text-[var(--app-text-secondary)] block">Weight Delta (L2)</span>
                    <span className="text-[#FF5E3A] font-bold">
                      +{liveSteps[liveSteps.length - 1].paramMutationDelta.toFixed(6)}
                    </span>
                  </div>
                  <div className="px-2 py-1 rounded bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                    <span className="text-[var(--app-text-secondary)] block">Norm Update</span>
                    <span className="text-[#CCFF00] font-bold">
                      {liveSteps[liveSteps.length - 1].initialParamNorm.toFixed(3)} →{' '}
                      {liveSteps[liveSteps.length - 1].finalParamNorm.toFixed(3)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-xs font-mono text-[var(--app-text-secondary)]">
                Click "Run 2.0M Training Step" to record live parameter deltas.
              </div>
            )}
          </div>
        </div>

        {/* 21-Tensor Weight & Gradient Norm Inspector */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--app-text-primary)]">
              <Layers className="w-4 h-4 text-[#7B2CBF]" />
              <span>2.0M Model Tensor Weights & Gradient Norms ({filteredTensors.length} shown)</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `All (${tensors.length})` },
                  { id: 'embeddings', label: 'Embeddings' },
                  { id: 'block0', label: 'Block 0' },
                  { id: 'block1', label: 'Block 1' },
                  { id: 'norms', label: 'RMSNorms' }
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setGroupFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                    groupFilter === tab.id
                      ? 'bg-[#00F0FF] text-[#070B19] border-[#00F0FF]'
                      : 'bg-[var(--app-input-bg)] text-[var(--app-text-secondary)] border-[var(--app-card-border)] hover:border-[#00F0FF]/60'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-96 overflow-y-auto pr-1">
            {filteredTensors.map((tensor) => {
              const gNorm = clippedNorms[tensor.name];
              const gPre = preClipNorms[tensor.name];
              const hasGrad = typeof gNorm === 'number';
              const isVanishing = hasGrad && gNorm < 1e-5;
              const isExploding = hasGrad && gNorm > 10.0;
              const barPct = hasGrad
                ? Math.min(100, Math.max(4, Math.round((gNorm / maxClippedNorm) * 100)))
                : 0;

              return (
                <div
                  key={tensor.name}
                  className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                    <div className="min-w-0">
                      <span className="font-bold text-[var(--app-text-primary)]">{tensor.name}</span>
                      <span className="ml-2 text-[10px] text-[var(--app-text-secondary)]">
                        [{tensor.shape.join('×')}] · {tensor.params.toLocaleString()}p
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!hasGrad ? (
                        <span className="text-[10px] text-[var(--app-text-secondary)]">NO STEP</span>
                      ) : isVanishing || isExploding ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-[#FF007F]">
                          <AlertTriangle className="w-3 h-3" />
                          {isExploding ? 'EXPLODING' : 'VANISHING'}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-[#CCFF00]">
                          <CheckCircle2 className="w-3 h-3" />
                          HEALTHY
                        </span>
                      )}
                      <span className="text-[#FF5E3A] font-bold">
                        {hasGrad ? gNorm.toFixed(6) : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="h-1.5 rounded-full bg-[var(--app-surface-elevated)] overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        !hasGrad
                          ? 'bg-slate-600'
                          : isVanishing || isExploding
                          ? 'bg-[#FF007F]'
                          : 'bg-gradient-to-r from-[#00F0FF] to-[#CCFF00]'
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-[var(--app-text-secondary)]">
                    <span title={tensor.sha256}>sha256: {tensor.sha256.slice(0, 12)}…</span>
                    <span>
                      {typeof gPre === 'number' ? `pre-clip: ${gPre.toFixed(4)}` : tensor.dtype}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </VividCard>
  );
};
