import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { EvolutionRecord } from '../../types';
import {
  Microscope,
  Play,
  TrendingUp,
  RefreshCw,
  CheckCircle2,
  Cpu,
  Brain,
  ShieldCheck,
  Zap,
  ArrowRight
} from 'lucide-react';

export const ExperimentCenter: React.FC = () => {
  const [isEvolving, setIsEvolving] = useState(false);
  const [currentEvolution, setCurrentEvolution] = useState<EvolutionRecord | null>(null);
  const [selectedDomain, setSelectedDomain] = useState('algorithm_resilience');

  const handleRunSelfEvolution = async () => {
    setIsEvolving(true);
    try {
      const res = await fetch('/api/self-evolve/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: selectedDomain })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentEvolution(data.evolution);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsEvolving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Self-Evolution Hero Card */}
      <VividCard
        gradientAccent="cyan"
        className="!p-8"
        headerAction={
          <div className="flex items-center gap-2">
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="text-xs bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl px-3 py-2 font-medium text-[var(--app-text-primary)]"
            >
              <option value="algorithm_resilience">Domain: Algorithm Resilience</option>
              <option value="token_optimization">Domain: Tokenizer Optimization</option>
              <option value="cache_concurrency">Domain: Concurrency & Cache Safety</option>
            </select>
            <button
              onClick={handleRunSelfEvolution}
              disabled={isEvolving}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-[var(--app-text-primary)] vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              {isEvolving ? 'Running 5-Stage Evolution...' : 'Trigger Self-Evolution Loop'}
            </button>
          </div>
        }
      >
        <div className="max-w-2xl">
          <div className="text-[11px] font-bold text-[var(--app-accent)] ">
            ZYNTHEOR Q+ Autonomic Engine
          </div>
          <h2 className="text-xl md:text-2xl font-black text-[var(--app-text-primary)] mt-1">
            Self-Evolving Native Intelligence Loop
          </h2>
          <p className="text-xs text-[var(--app-text-primary)] mt-2 leading-relaxed">
            "Learn from the world. Improve one's own architecture, tokenizer, weights, and pipeline.
            Prove improvement with empirical before-and-after evidence. Never wait for human prompts alone."
          </p>
        </div>

        {/* 5-Stage Visualizer */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mt-6">
          {[
            { step: '1. LEARN', desc: 'Harvests execution failures & logs', color: 'from-[var(--app-accent)] to-[var(--app-accent)]' },
            { step: '2. ANALYZE', desc: 'Identifies cognitive bottlenecks', color: 'from-[var(--app-accent)] to-[var(--app-accent)]' },
            { step: '3. SELF-DEVELOP', desc: 'Synthesizes code & weight deltas', color: 'from-[var(--app-accent)] to-[var(--app-accent)]' },
            { step: '4. EVALUATE', desc: 'Executes before vs after benchmarks', color: 'from-[var(--z-danger)] to-[var(--z-danger)]' },
            { step: '5. IMPROVE', desc: 'Commits verified capability delta', color: 'from-[var(--z-ok)] to-[var(--app-accent)]' }
          ].map((s, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-[var(--app-surface-elevated)] border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)] space-y-1">
              <div className={`text-xs font-black bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>
                {s.step}
              </div>
              <div className="text-[11px] text-[var(--app-text-secondary)] leading-tight">{s.desc}</div>
            </div>
          ))}
        </div>
      </VividCard>

      {/* Evolution Result Display */}
      {currentEvolution && (
        <VividCard
          title={`Evolution Record: ${currentEvolution.cycle_id}`}
          subtitle={`Empirical verification in domain '${currentEvolution.domain}'`}
          gradientAccent="energy"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between p-4 bg-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_60%,transparent)] rounded-xl">
              <div>
                <span className="text-xs font-semibold text-[var(--z-ok)]">Capability Benchmark Delta</span>
                <div className="text-2xl font-black font-mono text-[var(--z-ok)]">
                  +{currentEvolution.improvement_pct}% Improvement
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-[var(--app-text-secondary)]">Benchmark Score:</span>
                <div className="font-mono text-sm font-bold text-[var(--app-text-primary)]">
                  {currentEvolution.score_before}% → <span className="text-[var(--z-ok)]">{currentEvolution.score_after}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {currentEvolution.stages.map((st, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-[var(--app-surface-elevated)] border border-[color-mix(in_srgb,var(--app-card-border)_50%,transparent)] text-xs flex items-start gap-3">
                  <span className="font-mono font-bold text-[var(--app-accent)] shrink-0">{st.stage}</span>
                  <div className="flex-1">
                    <div className="text-[var(--app-text-primary)]">{st.action}</div>
                    {st.findings && <div className="text-[var(--app-text-secondary)] text-[11px] mt-0.5">{st.findings}</div>}
                    {st.evidence && <div className="text-[var(--z-ok)] font-bold text-[11px] mt-0.5">{st.evidence}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </VividCard>
      )}
    </div>
  );
};
