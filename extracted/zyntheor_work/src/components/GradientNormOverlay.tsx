import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Play, ShieldCheck, X } from 'lucide-react';
import { StatusDot } from './ui/StatusBadge';

export interface LayerGradientNorm {
  layer: string;
  norm: number;
  rawNorm?: number;
}

interface GradientNormOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  layerNorms: LayerGradientNorm[];
  trainingStep?: number;
  executedBridge?: string;
  totalParams?: number;
  forwardGraph?: string;
  auditBlockIndex?: number;
  isTraining?: boolean;
  onRunSingleStep?: () => void;
}

export const GradientNormOverlay: React.FC<GradientNormOverlayProps> = ({
  isOpen,
  onClose,
  layerNorms,
  trainingStep,
  executedBridge,
  totalParams,
  forwardGraph,
  auditBlockIndex,
  isTraining = false,
  onRunSingleStep
}) => {
  if (!isOpen) return null;

  const healthyCount = layerNorms.filter((item) => item.norm >= 1e-5 && item.norm <= 10.0).length;
  const maxNorm = layerNorms.reduce((acc, item) => Math.max(acc, item.norm), 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--app-card-border)] bg-[var(--app-input-bg)]">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#00F0FF]" />
            <h3 className="text-sm font-bold text-[var(--app-text-primary)]">
              Per-Layer Gradient Norm Inspector
            </h3>
            {layerNorms.length > 0 && (
              <StatusDot
                status={healthyCount === layerNorms.length ? 'VERIFIED' : 'PARTIAL'}
                label={`${healthyCount}/${layerNorms.length} HEALTHY`}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            {onRunSingleStep && (
              <button
                type="button"
                onClick={onRunSingleStep}
                disabled={isTraining}
                className="min-h-[36px] px-3 py-1 rounded-lg text-[11px] font-bold bg-[#00F0FF] text-[#070B19] hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer flex items-center gap-1"
              >
                <Play className="w-3 h-3" />
                <span>{isTraining ? 'Running Step...' : 'Run Single Step'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-[var(--app-card-border)] bg-[#070B19] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[var(--app-text-secondary)] tabular-nums">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#00F0FF] shrink-0" />
            <span>
              {`Autograd Graph: ${forwardGraph || 'NativeLM Cloud'} (${(totalParams ?? 0).toLocaleString()} Float32 params · ${layerNorms.length} tensors · ${executedBridge || 'Cloud Storage'})`}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[#FF5E3A]">
            {typeof trainingStep === 'number' && <span>Step #{trainingStep}</span>}
            {typeof auditBlockIndex === 'number' && <span>Audit Block #{auditBlockIndex}</span>}
          </div>
        </div>

        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto tabular-nums">
          {layerNorms.length === 0 ? (
            <div className="text-xs text-[var(--app-text-secondary)] italic space-y-3">
              <p>No gradient norms recorded yet. Run a native training step to inspect layer-wise gradient flow.</p>
              {onRunSingleStep && (
                <button
                  type="button"
                  onClick={onRunSingleStep}
                  disabled={isTraining}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#00F0FF] text-[#070B19] hover:opacity-90 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isTraining ? 'Executing Forward + Backward Pass...' : 'Execute Single Training Step'}</span>
                </button>
              )}
            </div>
          ) : (
            layerNorms.map((item) => {
              const isVanishing = item.norm < 1e-5;
              const isExploding = item.norm > 10.0;
              const normalizedDenom = Math.max(maxNorm, 0.01);
              const barWidth = Math.min(100, Math.max(6, Math.round((item.norm / normalizedDenom) * 100)));
              return (
                <div
                  key={item.layer}
                  className="p-3 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-[var(--app-text-primary)] font-semibold">{item.layer}</span>
                    <div className="flex items-center gap-2">
                      {typeof item.rawNorm === 'number' && (
                        <span className="text-[10px] text-[var(--app-text-secondary)]">
                          pre-clip {item.rawNorm.toFixed(4)}
                        </span>
                      )}
                      {isVanishing || isExploding ? (
                        <span className="flex items-center gap-1 text-[10px] text-[#FF007F] font-bold">
                          <AlertTriangle className="w-3 h-3" />
                          {isExploding ? 'EXPLODING' : 'VANISHING'}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-[#CCFF00] font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          HEALTHY
                        </span>
                      )}
                      <span className="text-[#00F0FF]">{item.norm.toFixed(6)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#070B19] overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        isVanishing || isExploding ? 'bg-[#FF007F]' : 'bg-gradient-to-r from-[#00F0FF] to-[#CCFF00]'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
