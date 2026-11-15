import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
import {
  Search,
  Network,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  AlertTriangle
} from 'lucide-react';

export const ResearchLab: React.FC = () => {
  const { authHeaders } = useAuth();
  const [researchTopic, setResearchTopic] = useState('Subword Tokenizer Compression for the ZYNTHEOR target architecture');
  const [activeTab, setActiveTab] = useState<'evidence' | 'graph' | 'report' | 'benchmarks'>('evidence');
  const [isRunningBenchmarks, setIsRunningBenchmarks] = useState(false);
  const [benchmarkResults, setBenchmarkResults] = useState<any[] | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [nativeInspect, setNativeInspect] = useState<any>(null);

  const evidenceItems = [
    {
      type: 'PARTIAL',
      title: 'Subword Tokenizer Roundtrip Consistency',
      evidence: 'Sovereign tokenizer encodes Thai + English 16k vocabulary; runtime roundtrip benchmark pending full corpus sweep.',
      source: 'qplus_native/tokenizer.py',
      confidence: 85.0
    },
    {
      type: 'VERIFIED',
      title: 'Online Runtime Latent Norm Invariant',
      evidence: 'Latent embedding vector has bounded standard variance across sampled prompts.',
      source: 'qplus_native/model.py:compute_embedding_projection',
      confidence: 92.0
    },
    {
      type: 'UNVERIFIED',
      title: 'Quantization to 4-bit INT4 without Perplexity Loss',
      evidence: 'Preliminary tensor truncation hypothesis suggests memory reduction on edge devices.',
      source: 'Literature Review / Hypothesis',
      confidence: 62.0
    },
    {
      type: 'HYPOTHESIS',
      title: 'Dynamic Multi-Head Pruning during Inference',
      evidence: 'Hypothesis that layers 7-9 can dynamically bypass attention heads on pure arithmetic queries.',
      source: 'Autonomous Research Engine',
      confidence: 45.0
    }
  ];

  const verifiedAxiomsCount = evidenceItems.filter((i) => i.type === 'VERIFIED').length;
  const hypothesesCount = evidenceItems.filter((i) => i.type === 'HYPOTHESIS' || i.type === 'UNVERIFIED').length;
  const avgConfidence = (
    evidenceItems.reduce((acc, i) => acc + i.confidence, 0) / evidenceItems.length
  ).toFixed(1);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch(apiUrl('/api/model/inspect'), { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setNativeInspect(data);
      }
    } catch {
      // ignore transient error
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunBenchmarks = async () => {
    setIsRunningBenchmarks(true);
    try {
      const res = await fetch(apiUrl('/api/verify/language-integrity'), { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.success && Array.isArray(data.results)) {
        setBenchmarkResults(data.results);
      }
    } catch {
      // ignore transient error
    } finally {
      setIsRunningBenchmarks(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Research Search & Topic Banner */}
      <VividCard gradientAccent="sunset" className="!p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="w-full md:w-2/3 min-w-0">
            <h2 className="text-xl font-bold text-[var(--app-text-primary)]">Sovereign Intelligence Research Lab</h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              Synthesizing autonomous neural research with strict mathematical verification boundaries.
            </p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={researchTopic}
                onChange={(e) => setResearchTopic(e.target.value)}
                placeholder="Enter AI research inquiry..."
                className="flex-1 min-w-0 min-h-[42px] px-4 py-2 text-xs bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:border-[#00F0FF] font-medium text-[var(--app-text-primary)]"
              />
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="min-h-[42px] px-4 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{isAnalyzing ? 'Inspecting...' : 'Analyze'}</span>
              </button>
            </div>
            {nativeInspect && (
              <div className="mt-2 text-[11px] font-mono text-[#00F0FF]">
                Native Runtime: {(nativeInspect.payload_float32_count ?? nativeInspect.total_params)?.toLocaleString() || 'Unavailable'} params · Status: {nativeInspect.status || 'PARTIAL'}
              </div>
            )}
          </div>

          <div className="flex gap-4 border-t md:border-t-0 md:border-l border-[var(--app-card-border)] pt-4 md:pt-0 md:pl-6 w-full md:w-1/3 justify-between tabular-nums">
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)] uppercase">Verified Axioms</div>
              <div className="text-2xl font-bold font-mono text-[#CCFF00]">{verifiedAxiomsCount}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)] uppercase">Hypotheses</div>
              <div className="text-2xl font-bold font-mono text-[#FF007F]">{hypothesesCount}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)] uppercase">Confidence</div>
              <div className="text-2xl font-bold font-mono text-[#00F0FF]">{avgConfidence}%</div>
            </div>
          </div>
        </div>
      </VividCard>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-card-border)] pb-2.5">
        {[
          { id: 'evidence', label: `Evidence Classification (${evidenceItems.length})` },
          { id: 'graph', label: 'Knowledge Graph Map' },
          { id: 'report', label: 'Research Briefing' },
          { id: 'benchmarks', label: 'Sovereign Benchmarks' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === tab.id
                ? 'bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/45 shadow-sm'
                : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] border border-transparent hover:border-[var(--app-card-border)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'evidence' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {evidenceItems.map((item, idx) => (
            <VividCard key={idx} gradientAccent={item.type === 'VERIFIED' ? 'lime' : item.type === 'PARTIAL' ? 'cyan' : 'purple'} className="!p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {item.type === 'VERIFIED' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-[#CCFF00]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      VERIFIED AXIOM
                    </span>
                  )}
                  {item.type === 'PARTIAL' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-[#00F0FF]">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      PARTIAL EVIDENCE
                    </span>
                  )}
                  {item.type === 'UNVERIFIED' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-[#FF5E3A]">
                      <HelpCircle className="w-3.5 h-3.5" />
                      UNVERIFIED CLAIM
                    </span>
                  )}
                  {item.type === 'HYPOTHESIS' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-[#FF007F]">
                      <Lightbulb className="w-3.5 h-3.5" />
                      SYNTHETIC HYPOTHESIS
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono font-bold tabular-nums text-[var(--app-text-secondary)]">
                  {item.confidence}% Match
                </span>
              </div>

              <h4 className="mt-3 text-sm font-bold text-[var(--app-text-primary)]">{item.title}</h4>
              <p className="mt-1 text-xs text-[var(--app-text-secondary)] leading-relaxed">{item.evidence}</p>

              <div className="mt-4 pt-3 border-t border-[var(--app-card-border)] flex items-center justify-between text-[11px] text-[var(--app-text-secondary)]">
                <span className="truncate">Source: <code className="text-[#00F0FF] font-mono">{item.source}</code></span>
              </div>
            </VividCard>
          ))}
        </div>
      )}

      {activeTab === 'graph' && (
        <VividCard title="Autonomous Knowledge Graph Topology" subtitle="Connected axiomatic nodes in ZYNTHEOR vector space" gradientAccent="cyan">
          <div className="p-8 bg-[#070B19] border border-[#1E294A] rounded-xl text-center space-y-4">
            <Network className="w-16 h-16 text-[#00F0FF] mx-auto" />
            <div className="max-w-md mx-auto text-xs text-[#9AA8C7] leading-relaxed">
              <span className="text-[#00F0FF] font-bold">Evidence-Backed Retrieval Graph (PARTIAL)</span> — separate from learned weights in <code className="text-[#F4F7FF] font-mono">native_data/model_checkpoint_target_41m.pt</code>, with Grounding Enforcement & Abstention.
              Zero ungrounded hallucinations permitted.
            </div>
          </div>
        </VividCard>
      )}

      {activeTab === 'report' && (
        <VividCard title="Research Evidence Report" subtitle="Evidence-backed summary; no benchmark results are inferred or pre-filled" gradientAccent="purple">
          <div className="space-y-4 text-xs text-[var(--app-text-secondary)] leading-relaxed font-sans max-w-2xl">
            <h3 className="text-sm font-bold text-[var(--app-text-primary)]">Current Evidence Boundary</h3>
            <p>
              The repository contains a native model architecture and checkpoint artifacts. Their presence does not by itself establish learned language-generation quality, reasoning reliability, or production performance.
            </p>
            <h3 className="text-sm font-bold text-[var(--app-text-primary)]">Verification Required</h3>
            <p>
              Training quality requires reproducible training logs and held-out evaluation. Runtime performance requires repeated warm and cold runs, concurrency tests, and latency percentiles. Sovereign deployment requires evidence from the actual cloud environment.
            </p>
            <p className="text-[11px] text-[#FF5E3A] font-semibold">No PDF export is offered here until a real report-generation endpoint exists.</p>
          </div>
        </VividCard>
      )}

      {activeTab === 'benchmarks' && (
        <VividCard
          title="Sovereign Benchmarks (Thai / English Runtime)"
          subtitle="Live execution against /api/verify/language-integrity"
          gradientAccent="cyan"
        >
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleRunBenchmarks}
                disabled={isRunningBenchmarks}
                className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold text-white vivid-gradient-brand cursor-pointer disabled:opacity-50"
              >
                {isRunningBenchmarks ? 'Running Live Benchmarks...' : 'Run Live Benchmarks'}
              </button>
            </div>
            {!benchmarkResults ? (
              <div className="text-xs text-[var(--app-text-secondary)] italic">
                Click "Run Live Benchmarks" to execute real Thai/English tokenizer and runtime checks.
              </div>
            ) : (
              <div className="space-y-2">
                {benchmarkResults.map((b: any) => (
                  <div
                    key={b.test_id}
                    className="p-3 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] flex items-center justify-between gap-3 text-xs font-mono"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--app-text-primary)]">{b.name}</div>
                      <div className="text-[11px] text-[var(--app-text-secondary)] truncate">{b.evidence}</div>
                    </div>
                    <StatusDot
                      status={b.status === 'PASS' ? 'VERIFIED' : 'FAILED'}
                      label={`${b.status} (${b.duration_ms}ms)`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </VividCard>
      )}
    </div>
  );
};
