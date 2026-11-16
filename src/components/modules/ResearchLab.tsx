import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { useAuth } from '../../context/AuthContext';
import {
  Search,
  Network,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Globe,
} from 'lucide-react';

export const ResearchLab: React.FC = () => {
  const { authHeaders, isAuthenticated } = useAuth();
  const [researchTopic, setResearchTopic] = useState('Thai-English tokenizer and sequence-model evaluation');
  const [includeWeb, setIncludeWeb] = useState(false);
  const [activeTab, setActiveTab] = useState<'evidence' | 'graph' | 'report' | 'benchmarks'>('evidence');
  const [isRunningBenchmarks, setIsRunningBenchmarks] = useState(false);
  const [benchmarkResults, setBenchmarkResults] = useState<any[] | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [nativeInspect, setNativeInspect] = useState<any>(null);
  const [investigation, setInvestigation] = useState<any>(null);
  const [investigateError, setInvestigateError] = useState('');

  const evidenceItems = [
    {
      type: 'PARTIAL',
      title: 'Subword Tokenizer Roundtrip Consistency',
      evidence: 'Sovereign tokenizer encodes Thai + English 16k vocabulary; runtime roundtrip benchmark pending full corpus sweep.',
      source: 'qplus_native/tokenizer.py',
      confidence: 0,
    },
    {
      type: 'UNVERIFIED',
      title: 'Native Forward-Pass Numerical Stability',
      evidence: 'The active runtime numerical-stability benchmark has not been executed against a verified Cloud checkpoint.',
      source: 'qplus_native/model.py · Cloud Runtime evaluation pending',
      confidence: 0,
    },
    {
      type: 'UNVERIFIED',
      title: 'Quantization to 4-bit INT4 without Perplexity Loss',
      evidence: 'Preliminary tensor truncation hypothesis suggests memory reduction on edge devices.',
      source: 'Literature Review / Hypothesis',
      confidence: 0,
    },
    {
      type: 'HYPOTHESIS',
      title: 'Dynamic Multi-Head Pruning during Inference',
      evidence: 'Hypothesis that layers 7-9 can dynamically bypass attention heads on pure arithmetic queries.',
      source: 'Autonomous Research Engine',
      confidence: 0,
    },
  ];

  const verifiedAxiomsCount = investigation?.knowledgeHits?.results?.length || 0;
  const hypothesesCount = evidenceItems.filter((i) => i.type === 'HYPOTHESIS' || i.type === 'UNVERIFIED').length;
  const confidenceVal =
    typeof investigation?.reasoning?.calibratedConfidence === 'number'
      ? Math.round(investigation.reasoning.calibratedConfidence * 100)
      : null;

  const handleAnalyze = async () => {
    if (!researchTopic.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setInvestigateError('');
    try {
      const [invRes, inspRes] = await Promise.all([
        fetch('/api/research/investigate', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ query: researchTopic.trim(), includeWeb }),
        }),
        fetch('/api/model/inspect', { headers: authHeaders() }),
      ]);
      const invData = await invRes.json();
      if (!invRes.ok || !invData.success) {
        throw new Error(invData.error || `Research investigation failed (HTTP ${invRes.status})`);
      }
      setInvestigation(invData);
      if (inspRes.ok) {
        const inspData = await inspRes.json();
        if (inspData.success) setNativeInspect(inspData);
      }
    } catch (err: any) {
      setInvestigateError(err?.message || 'Unable to execute research investigation.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunBenchmarks = async () => {
    setIsRunningBenchmarks(true);
    try {
      const res = await fetch('/api/verify/language-integrity', {
        method: 'POST',
        headers: authHeaders(),
      });
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

  const knowledgeResults: any[] = investigation?.knowledgeHits?.results || [];
  const graphPaths: any[] = investigation?.graphPaths?.paths || [];

  return (
    <div className="space-y-8">
      {/* Research Search & Topic Banner */}
      <VividCard gradientAccent="sunset" className="!p-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="w-full md:w-2/3">
            <h2 className="text-xl font-bold text-[var(--app-text-primary)]">Sovereign Intelligence Research Lab</h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              Grounded Knowledge Workspace retrieval, multi-hop graph traversal, adaptive reasoning verification, and runtime inspection.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="text"
                value={researchTopic}
                onChange={(e) => setResearchTopic(e.target.value)}
                placeholder="Enter AI research inquiry..."
                className="flex-1 min-w-[220px] px-4 py-2 text-xs bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] font-medium text-[var(--app-text-primary)]"
              />
              <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWeb}
                  onChange={(e) => setIncludeWeb(e.target.checked)}
                />
                <Globe className="w-3.5 h-3.5" />
                <span>Include Web</span>
              </label>
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !isAuthenticated}
                className="px-4 py-2 text-xs font-bold text-white bg-[var(--z-danger)] rounded-xl shadow-md hover:opacity-95 transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                {isAnalyzing ? 'Investigating...' : 'Investigate'}
              </button>
            </div>
            {!isAuthenticated && (
              <div className="mt-2 text-[11px] font-mono text-[var(--app-amber)]">
                Sign in as Developer or Admin to run /api/research/investigate
              </div>
            )}
            {investigateError && (
              <div className="mt-2 text-[11px] font-mono text-[var(--z-danger)]">{investigateError}</div>
            )}
            {nativeInspect && (
              <div className="mt-2 text-[11px] font-mono text-[var(--z-ok)]">
                Cloud Runtime checkpoint: {nativeInspect.total_params?.toLocaleString() || '—'} active parameters · Status: {nativeInspect.status || 'UNVERIFIED'}
              </div>
            )}
          </div>

          <div className="flex gap-4 border-t md:border-t-0 md:border-l border-[var(--app-card-border)] pt-4 md:pt-0 md:pl-6 w-full md:w-1/3 justify-between tabular-nums">
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)]">Grounded Hits</div>
              <div className="text-2xl font-bold font-mono text-[var(--z-ok)]">{verifiedAxiomsCount}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)]">Open Claims</div>
              <div className="text-2xl font-bold font-mono text-[var(--z-danger)]">{hypothesesCount}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-[var(--app-text-secondary)]">Confidence</div>
              <div className="text-2xl font-bold font-mono text-[var(--app-text-primary)]">
                {confidenceVal !== null ? `${confidenceVal}%` : '—'}
              </div>
            </div>
          </div>
        </div>
      </VividCard>

      {/* Live Investigation Result Banner */}
      {investigation && (
        <VividCard
          title="Live Research Investigation Findings"
          subtitle={`Verifier: ${investigation.reasoning?.verifierAttribution || 'adaptive_reasoning'} · External Brain: ${investigation.externalBrain?.configured ? investigation.externalBrain.provider : 'NOT_CONFIGURED'}`}
          gradientAccent="cyan"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] leading-relaxed text-[var(--app-text-primary)]">
              {investigation.reasoning?.answerSummary || 'No grounded summary produced.'}
            </div>
            {knowledgeResults.length > 0 && (
              <div className="space-y-2">
                <div className="font-bold text-[var(--app-text-secondary)]">Grounded Citations ({knowledgeResults.length})</div>
                {knowledgeResults.map((r: any, idx: number) => (
                  <div key={idx} className="p-3 rounded-xl bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)]">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="font-bold text-[var(--app-accent)]">{r.documentTitle}</span>
                      <span className="tabular-nums text-[var(--app-text-secondary)]">score {r.score}</span>
                    </div>
                    <p className="mt-1 text-[var(--app-text-secondary)]">{r.citation?.snippet || r.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </VividCard>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-card-border)] pb-2">
        <button
          onClick={() => setActiveTab('evidence')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'evidence'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] shadow-sm border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          Evidence Classification ({evidenceItems.length})
        </button>
        <button
          onClick={() => setActiveTab('graph')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'graph'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] shadow-sm border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          Knowledge Graph Paths ({graphPaths.length})
        </button>
        <button
          onClick={() => setActiveTab('report')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'report'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] shadow-sm border border-[var(--app-card-border)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          Research Briefing
        </button>
        <button
          onClick={() => setActiveTab('benchmarks')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'benchmarks'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] shadow-sm border border-[var(--app-card-border)]'
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
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-[var(--z-ok)] text-[var(--z-ok)]">
                      <CheckCircle2 className="w-3 h-3" />
                      VERIFIED AXIOM
                    </span>
                  )}
                  {(item.type === 'UNVERIFIED' || item.type === 'PARTIAL') && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-[var(--app-amber)] text-[var(--app-amber)]">
                      <HelpCircle className="w-3 h-3" />
                      {item.type}
                    </span>
                  )}
                  {item.type === 'HYPOTHESIS' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-[var(--app-accent)] text-[var(--app-accent)]">
                      <Lightbulb className="w-3 h-3" />
                      HYPOTHESIS
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
        <VividCard title="Multi-Hop Knowledge Graph Traversal" subtitle="Verified graph paths from /api/research/investigate">
          {graphPaths.length === 0 ? (
            <div className="p-8 bg-[var(--app-surface)] rounded-xl text-center space-y-3">
              <Network className="w-12 h-12 text-[var(--app-accent)] mx-auto" />
              <div className="max-w-md mx-auto text-xs text-[var(--app-text-secondary)]">
                Run <strong>Investigate</strong> to traverse Knowledge Graph relationships across ingested documents.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {graphPaths.map((p: any, idx: number) => (
                <div key={idx} className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-xs font-mono">
                  <div className="text-[var(--app-accent)] font-bold">Path #{idx + 1} · score {p.totalWeight ?? '—'}</div>
                  <div className="mt-1 text-[var(--app-text-secondary)]">
                    {(p.hops || []).map((h: any) => h.documentTitle || h.documentId).join(' -> ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </VividCard>
      )}

      {activeTab === 'report' && (
        <VividCard title="Executive Research Report" subtitle="Evidence and hypotheses · not a certified capability report">
          <div className="space-y-4 text-xs text-[var(--app-text-primary)] leading-relaxed font-sans max-w-2xl">
            <h3 className="text-sm font-bold text-[var(--app-text-primary)]">Executive Summary</h3>
            <p>
              Native model evaluation, grounded Knowledge Workspace retrieval, and Adaptive Reasoning verification remain strictly separated from unverified hypotheses.
            </p>
            <p className="text-[var(--app-text-secondary)]">
              No PDF export is offered here until a real report-generation endpoint exists.
            </p>
            {investigation?.reasoning && (
              <pre className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[11px] font-mono overflow-auto">
                {JSON.stringify(investigation.reasoning, null, 2)}
              </pre>
            )}
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
                disabled={isRunningBenchmarks || !isAuthenticated}
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
