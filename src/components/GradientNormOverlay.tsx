import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, X } from 'lucide-react';

export interface LayerGradientNorm {
  layer: string;
  norm: number;
}

interface GradientNormOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  layerNorms: LayerGradientNorm[];
}

export const GradientNormOverlay: React.FC<GradientNormOverlayProps> = ({
  isOpen,
  onClose,
  layerNorms
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--app-card-border)] bg-[var(--app-surface-elevated)]">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--app-accent)]" />
            <h3 className="text-sm font-bold text-[var(--app-text-primary)]">
              Per-Layer Gradient Norm Inspector
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto">
          {layerNorms.length === 0 ? (
            <div className="text-xs text-[var(--app-text-secondary)] italic">
              No gradient norms recorded yet. Run a native training step to inspect layer-wise gradient flow.
            </div>
          ) : (
            layerNorms.map((item) => {
              const isVanishing = item.norm < 1e-5;
              const isExploding = item.norm > 10.0;
              const barWidth = Math.min(100, Math.max(4, Math.round(item.norm * 25)));
              return (
                <div
                  key={item.layer}
                  className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-[var(--app-text-primary)] font-semibold">{item.layer}</span>
                    <div className="flex items-center gap-2">
                      {isVanishing || isExploding ? (
                        <span className="flex items-center gap-1 text-[10px] text-[var(--z-danger)] font-bold">
                          <AlertTriangle className="w-3 h-3" />
                          {isExploding ? 'EXPLODING' : 'VANISHING'}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-[var(--z-ok)] font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          HEALTHY
                        </span>
                      )}
                      <span className="text-[var(--app-amber)]">{item.norm.toFixed(5)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--app-surface-elevated)] overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        isVanishing || isExploding ? 'bg-[var(--z-danger)]' : 'bg-[var(--app-accent)]'
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
