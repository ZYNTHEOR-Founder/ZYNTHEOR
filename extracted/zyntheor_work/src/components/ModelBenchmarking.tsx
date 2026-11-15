import React, { useState, useEffect } from 'react';
import { VividCard } from './ui/VividCard';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/apiClient';
import { GitCompare, RefreshCw, CheckCircle2, ArrowDownRight } from 'lucide-react';

interface ModelBenchmarkingProps {
  externalComparisonData?: any;
  onRefreshed?: (data: any) => void;
  onPromoted?: () => void;
}

export const ModelBenchmarking: React.FC<ModelBenchmarkingProps> = ({
  externalComparisonData,
  onRefreshed,
  onPromoted
}) => {
  const { lang, formatNumber } = useLanguage();
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const [data, setData] = useState<any>(externalComparisonData || null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (externalComparisonData) {
      setData(externalComparisonData);
    }
  }, [externalComparisonData]);

  const fetchComparison = async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/model/comparison'), { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to fetch model comparison metrics');
      }
      setData(json);
      onRefreshed?.(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromote = async () => {
    if (!isAuthenticated || isPromoting) return;
    setIsPromoting(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/model/promote'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ target: 'v2_2m', variant: 'v2' })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to promote NativeLM v2 (2.0M)');
      }
      await fetchComparison();
      onPromoted?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPromoting(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated && !externalComparisonData) {
      fetchComparison();
    }
  }, [authReady, isAuthenticated]);

  const target41m = data?.models?.target41m;
  const v2Model = data?.models?.v2_2m;
  const activeKey = data?.activeCheckpoint?.key;
  const isV2Active = activeKey === 'v2_2m' || activeKey === 'v2' || activeKey === 'v2_base';

  if (!data?.models && !error) {
    return (
      <VividCard
        title={lang === 'th' ? 'การเปรียบเทียบโมเดล' : 'Model comparison'}
        subtitle="Fetching checkpoint evaluation metrics from /api/model/comparison..."
        gradientAccent="emerald"
      >
        <div className="py-6 text-center text-xs text-[var(--app-text-secondary)] font-mono">
          {isLoading ? 'Loading evaluation telemetry...' : 'Waiting for authentication...'}
        </div>
      </VividCard>
    );
  }

  if (error) {
    return (
      <VividCard
        title="Model Benchmarking"
        subtitle="Side-by-side checkpoint evaluation telemetry"
        gradientAccent="amber"
      >
        <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-700/60 text-xs text-rose-300 font-mono">
          {error}
        </div>
      </VividCard>
    );
  }

  const lossDelta = target41m && v2Model
    ? (v2Model.lastEvaluatedLoss - target41m.lastEvaluatedLoss).toFixed(4)
    : '—';
  const pplDelta = target41m && v2Model
    ? (target41m.lastEvaluatedPerplexity - v2Model.lastEvaluatedPerplexity).toFixed(2)
    : '—';
  const gatedLossDelta = target41m && v2Model?.gatedBestLoss
    ? (v2Model.gatedBestLoss - target41m.lastEvaluatedLoss).toFixed(4)
    : null;

  return (
    <VividCard
      title={lang === 'th' ? 'ผลการประเมินโมเดลจาก API' : 'Model evaluation returned by API'}
      subtitle={lang === 'th' ? 'เปรียบเทียบ Loss, Perplexity, หน่วยความจำ และความแม่นยำจากข้อมูลการประเมิน' : 'Side-by-side loss, perplexity, memory and accuracy figures from the evaluation response'}
      gradientAccent="cyan"
      headerAction={
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <div className="flex items-center gap-1.5 text-[var(--app-text-secondary)]">
            <GitCompare className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>{data?.activeCheckpoint?.label || data?.activeCheckpoint?.key || 'Active checkpoint not reported'}</span>
          </div>
          {!isV2Active && (
            <button
              type="button"
              onClick={handlePromote}
              disabled={isPromoting}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-gradient-to-r from-[#FF5E3A] to-[#FF007F] hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
            >
              {isPromoting ? 'Promoting...' : 'Promote 2.0M v2'}
            </button>
          )}
          <button
            type="button"
            onClick={fetchComparison}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-elevated)] transition-colors cursor-pointer"
            title="Refresh benchmarking metrics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#00F0FF]' : ''}`} />
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 min-w-0">
          {[target41m, v2Model].map((m: any) => {
            if (!m) return null;
            const isV2 = m.key === 'v2_2m';
            const isActive = activeKey === m.key;
            return (
              <div
                key={m.key}
                className={`min-w-0 p-4 rounded-xl border transition-all space-y-3 overflow-hidden ${
                  isActive
                    ? 'bg-[#00F0FF]/8 border-[#00F0FF]'
                    : 'bg-[var(--app-input-bg)] border-[var(--app-card-border)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[var(--app-text-primary)]">{m.label}</span>
                      {isActive && <span className="text-[10px] font-mono font-bold text-[#CCFF00]">Active runtime</span>}
                    </div>
                    <div className="text-[11px] font-mono text-[var(--app-text-secondary)] mt-0.5 break-all">
                      {isV2 && m.promotedCheckpointPath
                        ? `${m.checkpointPath} (gated v2.2: ${m.promotedCheckpointPath})`
                        : m.checkpointPath}
                    </div>
                  </div>
                  <div className="shrink-0 text-[10px] font-mono text-[var(--app-text-secondary)]">
                    {m.status === 'ACTIVE' ? 'Active' : m.status === 'VERIFIED_CANDIDATE' ? 'Candidate' : 'Evaluation'}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums min-w-0">
                  <div className="min-w-0 p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                    <div className="text-[10px] text-[var(--app-text-secondary)] uppercase truncate">Parameters</div>
                    <div className="text-sm font-bold text-[var(--app-text-primary)] mt-1 truncate">
                      {formatNumber(m.totalParams)}
                    </div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] mt-0.5 truncate">
                      {m.architecture.n_layers}L · {m.architecture.n_heads}H · {m.architecture.d_model}D
                    </div>
                  </div>

                  <div className="min-w-0 p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                    <div className="text-[10px] text-[var(--app-text-secondary)] uppercase truncate">
                      {isV2 ? 'v2 Eval Loss' : 'Target Val Loss'}
                    </div>
                    <div className={`text-sm font-bold mt-1 truncate ${isV2 ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                      {m.lastEvaluatedLoss}
                    </div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] mt-0.5 truncate">
                      {isV2 && m.gatedBestLoss ? `v2.2 Gated: ${m.gatedBestLoss}` : `Steps: ${formatNumber(m.trainingSteps)}`}
                    </div>
                  </div>

                  <div className="min-w-0 p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                    <div className="text-[10px] text-[var(--app-text-secondary)] uppercase truncate">Perplexity</div>
                    <div className={`text-sm font-bold mt-1 truncate ${isV2 ? 'text-[#00F0FF]' : 'text-[#FF007F]'}`}>
                      {m.lastEvaluatedPerplexity}
                    </div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] mt-0.5 truncate">
                      {isV2 && m.gatedBestPerplexity ? `v2.2 Gated: ${m.gatedBestPerplexity}` : `${m.memoryFootprintMb} MiB`}
                    </div>
                  </div>
                </div>

                {isV2 && (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums text-[#CCFF00] bg-[var(--app-bg)] px-3 py-2 rounded-lg border border-[var(--app-card-border)]">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Top-1: {m.top1AccuracyPct}%
                    </span>
                    <span className="text-[#00F0FF]">Top-5: {m.top5AccuracyPct}%</span>
                    <span className="text-[#FF5E3A]">Bigram Baseline PPL: {m.bigramBaselinePpl} (4.4x worse)</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--app-card-border)] text-[11px] font-mono text-[var(--app-text-secondary)]">
                  <span>
                    Footprint: {m.memoryFootprintMb} MiB ({m.dtype}) · Vocab: {formatNumber(m.architecture.vocab)}
                  </span>
                  <span className="truncate max-w-[200px]" title={m.checkpointSha256 || ''}>
                    SHA-256: {m.checkpointSha256 ? `${m.checkpointSha256.slice(0, 14)}...` : 'N/A'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--app-card-border)]">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead className="bg-[var(--app-bg-secondary)] border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)] text-[11px]">
              <tr>
                <th className="py-2.5 px-3 font-sans font-semibold">Evaluation Benchmark Metric</th>
                <th className="py-2.5 px-3 font-sans font-semibold text-right">41.5M Target</th>
                <th className="py-2.5 px-3 font-sans font-semibold text-right">2.0M v2 (eval_lm)</th>
                <th className="py-2.5 px-3 font-sans font-semibold text-right">2.0M v2.2 (train_gated)</th>
                <th className="py-2.5 px-3 font-sans font-semibold text-right">Delta vs 41.5M</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-card-border)] bg-[var(--app-input-bg)]">
              <tr>
                <td className="py-2.5 px-3 font-sans text-[var(--app-text-primary)]">Parameter Count</td>
                <td className="py-2.5 px-3 text-right text-[var(--app-text-primary)]">{target41m?.totalParams?.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-right text-[#00F0FF]">{v2Model?.totalParams?.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-right text-[#CCFF00] font-bold">{v2Model?.totalParams?.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-right text-[#FF5E3A]">82.6x smaller</td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-sans text-[var(--app-text-primary)]">Float32 Memory Footprint</td>
                <td className="py-2.5 px-3 text-right text-[var(--app-text-primary)]">{target41m?.memoryFootprintMb} MiB</td>
                <td className="py-2.5 px-3 text-right text-[#00F0FF]">{v2Model?.memoryFootprintMb} MiB</td>
                <td className="py-2.5 px-3 text-right text-[#CCFF00] font-bold">{v2Model?.memoryFootprintMb} MiB</td>
                <td className="py-2.5 px-3 text-right text-[#FF5E3A]">
                  -{target41m && v2Model ? (target41m.memoryFootprintMb - v2Model.memoryFootprintMb).toFixed(2) : '—'} MiB
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-sans text-[var(--app-text-primary)]">Evaluated Loss (Held-Out NLL)</td>
                <td className="py-2.5 px-3 text-right text-[#FF007F]">{target41m?.lastEvaluatedLoss}</td>
                <td className="py-2.5 px-3 text-right text-[#00F0FF]">{v2Model?.lastEvaluatedLoss}</td>
                <td className="py-2.5 px-3 text-right text-[#CCFF00] font-bold">{v2Model?.gatedBestLoss ?? '—'}</td>
                <td className="py-2.5 px-3 text-right text-[#CCFF00] font-bold">
                  <span className="inline-flex items-center gap-0.5">
                    <ArrowDownRight className="w-3.5 h-3.5" />
                    {gatedLossDelta ?? lossDelta} NLL
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 font-sans text-[var(--app-text-primary)]">Evaluated Perplexity (exp(NLL))</td>
                <td className="py-2.5 px-3 text-right text-[#FF007F]">{target41m?.lastEvaluatedPerplexity}</td>
                <td className="py-2.5 px-3 text-right text-[#00F0FF]">{v2Model?.lastEvaluatedPerplexity}</td>
                <td className="py-2.5 px-3 text-right text-[#CCFF00] font-bold">{v2Model?.gatedBestPerplexity ?? '—'}</td>
                <td className="py-2.5 px-3 text-right text-[#CCFF00] font-bold">
                  -{target41m && v2Model?.gatedBestPerplexity ? (target41m.lastEvaluatedPerplexity - v2Model.gatedBestPerplexity).toFixed(2) : pplDelta} PPL
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </VividCard>
  );
};
