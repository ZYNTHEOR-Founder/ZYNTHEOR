import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import { GradientInspector } from '../GradientInspector';
import { EvolutionRecord } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
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
  const { authHeaders } = useAuth();
  const [isEvolving, setIsEvolving] = useState(false);
  const [currentEvolution, setCurrentEvolution] = useState<EvolutionRecord | null>(null);
  const [selectedDomain, setSelectedDomain] = useState('algorithm_resilience');

  const handleRunSelfEvolution = async () => {
    setIsEvolving(true);
    try {
      const res = await fetch(apiUrl('/api/self-evolve/run'), {
        method: 'POST',
        headers: authHeaders(),
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
        className="!p-6 sm:!p-8"
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="min-h-[44px] text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl px-3 py-2 font-medium text-[var(--app-text-primary)] focus:outline-none focus:border-[#00F0FF]"
            >
              <option value="algorithm_resilience">Domain: Algorithm Resilience</option>
              <option value="token_optimization">Domain: Tokenizer Optimization</option>
              <option value="cache_concurrency">Domain: Concurrency &amp; Cache Safety</option>
            </select>
            <button
              onClick={handleRunSelfEvolution}
              disabled={isEvolving}
              className="min-h-[44px] flex items-center gap-2 px-5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              {isEvolving ? 'Running 5-Stage Evolution...' : 'Trigger Self-Evolution Loop'}
            </button>
          </div>
        }
      >
        <div className="max-w-2xl">
          <div className="text-[11px] font-bold text-[#00F0FF] uppercase tracking-wider">
            ZYNTHEOR Q+ Autonomic Engine
          </div>
          <h2 className="text-xl md:text-2xl font-black text-[var(--app-text-primary)] mt-1">
            Self-Evolving Native Intelligence Loop
          </h2>
          <p className="text-xs text-[var(--app-text-secondary)] mt-2 leading-relaxed">
            &quot;Learn from the world. Improve one&apos;s own architecture, tokenizer, weights, and pipeline.
            Prove improvement with empirical before-and-after evidence. Never wait for human prompts alone.&quot;
          </p>
        </div>

        {/* 5-Stage Visualizer */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mt-6">
          {[
            { step: '1. LEARN', desc: 'Harvests execution failures & logs', color: 'from-[#00F0FF] to-[#2563EB]' },
            { step: '2. ANALYZE', desc: 'Identifies cognitive bottlenecks', color: 'from-[#2563EB] to-[#7B2CBF]' },
            { step: '3. SELF-DEVELOP', desc: 'Synthesizes code & weight deltas', color: 'from-[#7B2CBF] to-[#FF007F]' },
            { step: '4. EVALUATE', desc: 'Executes before vs after benchmarks', color: 'from-[#FF007F] to-[#FF5E3A]' },
            { step: '5. IMPROVE', desc: 'Commits verified capability delta', color: 'from-[#CCFF00] to-[#00F0FF]' }
          ].map((s, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-1">
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
          gradientAccent="coral"
        >
          <div className="space-y-4 tabular-nums">
            <div className="flex flex-wrap items-center justify-between p-4 bg-[var(--app-input-bg)] border border-[#CCFF00]/40 rounded-xl">
              <div>
                <span className="text-xs font-semibold text-[#00F0FF]">Capability Benchmark Delta</span>
                <div className="text-2xl font-black font-mono text-[#CCFF00]">
                  +{currentEvolution.improvement_pct}% Improvement
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-[var(--app-text-secondary)]">Benchmark Score:</span>
                <div className="font-mono text-sm font-bold text-[var(--app-text-primary)]">
                  {currentEvolution.score_before}% → <span className="text-[#CCFF00]">{currentEvolution.score_after}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {currentEvolution.stages.map((st, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-[var(--app-input-bg)] border border-[var(--app-card-border)] text-xs flex items-start gap-3">
                  <span className="font-mono font-bold text-[#00F0FF] shrink-0">{st.stage}</span>
                  <div className="flex-1">
                    <div className="text-[var(--app-text-primary)]">{st.action}</div>
                    {st.findings && <div className="text-[var(--app-text-secondary)] text-[11px] mt-0.5">{st.findings}</div>}
                    {st.evidence && <div className="text-[#CCFF00] font-bold text-[11px] mt-0.5">{st.evidence}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </VividCard>
      )}

      {/* Real 2.0M Weight & Gradient Inspector + Loss/Update Sparkline */}
      <GradientInspector />
    </div>
  );
};
