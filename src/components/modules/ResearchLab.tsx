import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusBadge } from '../ui/StatusBadge';
import {
  FlaskConical,
  Search,
  BookOpen,
  FileText,
  Network,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  ArrowRight
} from 'lucide-react';

export const ResearchLab: React.FC = () => {
  const [researchTopic, setResearchTopic] = useState('Thai-English tokenizer and sequence-model evaluation');
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
      confidence: 0
    },
    {
      type: 'UNVERIFIED',
      title: 'Native Forward-Pass Numerical Stability',
      evidence: 'The active runtime numerical-stability benchmark has not been executed against a verified Cloud checkpoint.',
      source: 'qplus_native/model.py · Cloud Runtime evaluation pending',
      confidence: 0
    },
    {
      type: 'UNVERIFIED',
      title: 'Quantization to 4-bit INT4 without Perplexity Loss',
      evidence: 'Preliminary tensor truncation hypothesis suggests memory reduction on edge devices.',
      source: 'Literature Review / Hypothesis',
      confidence: 0
    },
    {
      type: 'HYPOTHESIS',
      title: 'Dynamic Multi-Head Pruning during Inference',
      evidence: 'Hypothesis that layers 7-9 can dynamically bypass attention heads on pure arithmetic queries.',
      source: 'Autonomous Research Engine',
      confidence: 0
    }
  ];

  const verifiedAxiomsCount = 0;
  const hypothesesCount = evidenceItems.filter((i) => i.type === 'HYPOTHESIS' || i.type === 'UNVERIFIED').length;
  const avgConfidence = '—';

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/model/inspect');
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

  const handleExportPdf = () => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
          <head><title>ZYNTHEOR Research Briefing</title></head>
          <body style="font-family: sans-serif; padding: 24px;">
            <h2>ZYNTHEOR — Sovereign Intelligence Research Briefing</h2>
            <p><strong>Topic:</strong> ${researchTopic}</p>
            <p><strong>Verified Axioms:</strong> ${verifiedAxiomsCount} | <strong>Hypotheses:</strong> ${hypothesesCount} | <strong>Mean Confidence:</strong> ${avgConfidence === '—' ? 'not scored' : `${avgConfidence}%`}</p>
            <hr/>
            ${evidenceItems
              .map(
                (item) =>
                  `<div style="margin-bottom:12px;"><strong>[${item.type}] ${item.title}</strong> (${item.confidence > 0 ? `${item.confidence}%` : 'not scored'})<br/><small>${item.source}</small><p>${item.evidence}</p></div>`
              )
              .join('')}
          </body>
        </html>
      `);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };

  const handleRunBenchmarks = async () => {
    setIsRunningBenchmarks(true);
    try {
      const res = await fetch('/api/verify/language-integrity', { method: 'POST' });
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
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="w-full md:w-2/3">
            <h2 className="text-xl font-bold text-[var(--app-text-primary)]">Sovereign Intelligence Research Lab</h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              Research workspace for evidence, hypotheses and reproducible runtime evaluations.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={researchTopic}
                onChange={(e) => setResearchTopic(e.target.value)}
                placeholder="Enter AI research inquiry..."
                className="flex-1 px-4 py-2 text-xs bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] font-medium text-[var(--app-text-primary)]"
              />
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="px-4 py-2 text-xs font-bold text-white bg-[var(--z-danger)] rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                {isAnalyzing ? 'Inspecting...' : 'Analyze'}
              </button>
            </div>
            {nativeInspect && (
              <div className="mt-2 text-[11px] font-mono text-[var(--z-ok)]">
                Cloud Runtime checkpoint: {nativeInspect.total_params?.toLocaleString() || '—'} active parameters · Status: {nativeInspect.status || 'UNVERIFIED'}
              </div>
            )}
          </div>

          <div className="flex gap-4 border-t md:border-t-0 md:border-l border-[var(--app-card-border)] pt-4 md:pt-0 md:pl-6 w-full md:w-1/3 justify-between">
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)] ">Verified Axioms</div>
              <div className="text-2xl font-bold font-mono text-[var(--z-ok)]">{verifiedAxiomsCount}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)] ">Hypotheses</div>
              <div className="text-2xl font-bold font-mono text-[var(--z-danger)]">{hypothesesCount}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)] ">Confidence</div>
              <div className="text-2xl font-bold font-mono text-[var(--app-text-primary)]">{avgConfidence}%</div>
            </div>
          </div>
        </div>
      </VividCard>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--app-card-border)] pb-2">
        <button
          onClick={() => setActiveTab('evidence')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'evidence'
              ? 'bg-white text-[var(--app-text-primary)] shadow-sm border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          Evidence Classification ({evidenceItems.length})
        </button>
        <button
          onClick={() => setActiveTab('graph')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'graph'
              ? 'bg-white text-[var(--app-text-primary)] shadow-sm border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          Knowledge Graph Map
        </button>
        <button
          onClick={() => setActiveTab('report')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'report'
              ? 'bg-white text-[var(--app-text-primary)] shadow-sm border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          Research Briefing
        </button>
        <button
          onClick={() => setActiveTab('benchmarks')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'benchmarks'
              ? 'bg-white text-[var(--app-text-primary)] shadow-sm border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          Sovereign Benchmarks
        </button>
      </div>

      {activeTab === 'evidence' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {evidenceItems.map((item, idx) => (
            <VividCard key={idx} className="!p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {item.type === 'VERIFIED' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--z-ok)] text-[var(--z-ok)] border border-[var(--z-ok)]">
                      <CheckCircle2 className="w-3 h-3 text-[var(--z-ok)]" />
                      VERIFIED AXIOM
                    </span>
                  )}
                  {item.type === 'UNVERIFIED' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--app-amber)] text-[var(--app-amber)] border border-[var(--app-amber)]">
                      <HelpCircle className="w-3 h-3 text-[var(--app-amber)]" />
                      UNVERIFIED CLAIM
                    </span>
                  )}
                  {item.type === 'HYPOTHESIS' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--app-accent)] text-[var(--app-accent)] border border-[var(--app-accent)]">
                      <Lightbulb className="w-3 h-3 text-[var(--app-accent)]" />
                      SYNTHETIC HYPOTHESIS
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono font-bold text-[var(--app-text-secondary)]">
                  {item.confidence > 0 ? `${item.confidence}% Match` : 'Not scored'}
                </span>
              </div>

              <h4 className="mt-3 text-sm font-bold text-[var(--app-text-primary)]">{item.title}</h4>
              <p className="mt-1 text-xs text-[var(--app-text-primary)] leading-relaxed">{item.evidence}</p>

              <div className="mt-4 pt-3 border-t border-[var(--app-card-border)] flex items-center justify-between text-[11px] text-[var(--app-text-secondary)]">
                <span className="truncate">Source: <code className="text-[var(--app-text-primary)] font-mono">{item.source}</code></span>
              </div>
            </VividCard>
          ))}
        </div>
      )}

      {activeTab === 'graph' && (
        <VividCard title="Autonomous Knowledge Graph Topology" subtitle="Connected axiomatic nodes in ZYNTHEOR vector space">
          <div className="p-8 bg-[var(--app-surface)] rounded-xl text-center space-y-4">
            <Network className="w-16 h-16 text-[var(--app-accent)] mx-auto animate-pulse" />
            <div className="max-w-md mx-auto text-xs text-[var(--app-text-secondary)]">
              <span className="text-[var(--app-accent)] font-bold">Knowledge Retrieval Graph (IMPLEMENTED / evaluation pending)</span> — separate from learned model weights. Grounding coverage and abstention quality are not yet benchmarked.
            </div>
          </div>
        </VividCard>
      )}

      {activeTab === 'report' && (
        <VividCard title="Executive Research Report" subtitle="Evidence and hypotheses · not a certified capability report">
          <p className="mb-3 text-xs text-[var(--app-text-secondary)]">No PDF export is offered here until a real report-generation endpoint exists.</p>
          <div className="space-y-4 text-xs text-[var(--app-text-primary)] leading-relaxed font-sans max-w-2xl">
            <h3 className="text-sm font-bold text-[var(--app-text-primary)]">Executive Summary</h3>
            <p>
              No domain benchmark report is currently certified by the active runtime. Architecture descriptions and hypotheses are kept separate from measured model capability.
            </p>
            <h3 className="text-sm font-bold text-[var(--app-text-primary)]">Empirical Verification</h3>
            <p>
              No end-to-end benchmark suite result is attached to this report. A claim becomes VERIFIED only when its test output, runtime identity, and checkpoint evidence are recorded.
            </p>
          </div>
        </VividCard>
      )}
      {activeTab === 'benchmarks' && (
        <VividCard
          title="Tokenizer & Runtime Benchmarks (Thai / English)"
          subtitle="Recorded test results from /api/verify/language-integrity"
          gradientAccent="emerald"
        >
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleRunBenchmarks}
                disabled={isRunningBenchmarks}
                className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--app-text-primary)] vivid-gradient-brand cursor-pointer disabled:opacity-50"
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
                    className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] flex items-center justify-between gap-3 text-xs font-mono"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--app-text-primary)]">{b.name}</div>
                      <div className="text-[11px] text-[var(--app-text-secondary)] truncate">{b.evidence}</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        b.status === 'PASS'
                          ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)]'
                          : 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)]'
                      }`}
                    >
                      {b.status} ({b.duration_ms}ms)
                    </span>
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
