/**
 * ZYNTHEOR Batch 29 — Cognitive Operations Workspace
 *
 * Unified operational control surface for:
 *  - Cognitive Context Engine & Cross-Session Continuity
 *  - Adaptive Reasoning Architecture (multi-path, counterexamples, uncertainty, trace redaction)
 *  - Provenance-Aware Knowledge Graph Intelligence (multi-hop + contradictions)
 *  - Reversible Memory Consolidation & Self-Adaptive Performance Engine
 *  - 12-Metric Cognitive Evaluation Lab & Multimodal Capability Honesty Matrix
 *
 * Zero Simulation Policy: every panel renders live backend evidence only.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Brain,
  CheckCircle2,
  Database,
  Download,
  FileCode2,
  GitBranch,
  Layers,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import { SystemStatusData } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { apiUrl } from '../../lib/apiClient';
import {
  Button,
  EmptyStateCard,
  Eyebrow,
  MetricCard,
  PageContainer,
  ResponsiveGrid,
  SectionHeader,
  StatusDot,
  Text,
  VividCard,
} from '../ui';

type CognitiveTab =
  | 'action_engine'
  | 'context_reasoning'
  | 'knowledge_graph'
  | 'memory_performance'
  | 'evaluation_multimodal';

type ActionMissionModeUI =
  | 'engineering_blueprint_execute'
  | 'workspace_verify_repair'
  | 'system_integrity_audit'
  | 'reasoning_verification';

interface CognitiveOperationsProps {
  statusData: SystemStatusData | null;
}

export const CognitiveOperations: React.FC<CognitiveOperationsProps> = ({ statusData }) => {
  const { authHeaders, role } = useAuth();
  const { lang } = useLanguage();
  const isDeveloperPlus = role === 'Developer' || role === 'Administrator';
  const isAdmin = role === 'Administrator';

  const [activeTab, setActiveTab] = useState<CognitiveTab>('action_engine');
  const [opsData, setOpsData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Batch 30: Action-Driven 8-Pillar Engine state
  const [actionMode, setActionMode] = useState<ActionMissionModeUI>('engineering_blueprint_execute');
  const [actionRuntime, setActionRuntime] = useState<'node' | 'python3'>('node');
  const [actionGoal, setActionGoal] = useState(
    'Build an in-memory LRU cache with TTL eviction, unit tests, and verified deliverable package'
  );
  const [actionTargetFile, setActionTargetFile] = useState('');
  const [actionSourceCode, setActionSourceCode] = useState('');
  const [actionUnitTestCode, setActionUnitTestCode] = useState('');
  const [actionApprovalId, setActionApprovalId] = useState('');
  const [showAdvancedInputs, setShowAdvancedInputs] = useState(false);
  const [perceptionSnap, setPerceptionSnap] = useState<any | null>(null);
  const [activeMission, setActiveMission] = useState<any | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [busyDownload, setBusyDownload] = useState(false);

  // Context & Adaptive Reasoning state
  const [contextPrompt, setContextPrompt] = useState(
    'Analyze multi-hop HMAC authentication constraints in TypeScript. Strictly enforce timingSafeEqual max=32.'
  );
  const [contextAnalysis, setContextAnalysis] = useState<any | null>(null);
  const [reasoningOutcome, setReasoningOutcome] = useState<any | null>(null);
  const [reasoningBenchmark, setReasoningBenchmark] = useState<any | null>(null);
  const [busyContext, setBusyContext] = useState(false);
  const [busyReason, setBusyReason] = useState(false);

  // Knowledge Graph state
  const [graphQuery, setGraphQuery] = useState('ZYNTHEOR');
  const [graphMaxHops, setGraphMaxHops] = useState(2);
  const [graphTraversal, setGraphTraversal] = useState<any | null>(null);
  const [graphConsistency, setGraphConsistency] = useState<any | null>(null);
  const [busyGraph, setBusyGraph] = useState(false);

  // Memory & Performance state
  const [consolidationKey, setConsolidationKey] = useState('b29_consolidated_semantic_anchor');
  const [archiveSources, setArchiveSources] = useState(false);
  const [optRetrievalLimit, setOptRetrievalLimit] = useState(6);
  const [optCacheTtlMs, setOptCacheTtlMs] = useState(30000);
  const [optReason, setOptReason] = useState('Tune hybrid retrieval depth and TTL policy');
  const [busyMemPerf, setBusyMemPerf] = useState(false);

  // Evaluation Lab state
  const [busyEval, setBusyEval] = useState(false);

  const loadOperations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [opsRes, verifyRes] = await Promise.all([
        fetch(apiUrl('/api/cognitive/operations'), { headers: authHeaders() }),
        fetch(apiUrl('/api/cognitive/graph/verify'), { headers: authHeaders() }),
      ]);
      const opsJson = await opsRes.json();
      if (!opsRes.ok || !opsJson.success) {
        throw new Error(opsJson.error || `Failed to load cognitive operations (${opsRes.status})`);
      }
      setOpsData(opsJson);
      if (opsJson.performance?.config) {
        setOptRetrievalLimit(opsJson.performance.config.retrievalLimit ?? 5);
        setOptCacheTtlMs(opsJson.performance.config.cacheTtlMs ?? 30000);
      }
      if (verifyRes.ok) {
        const vJson = await verifyRes.json();
        if (vJson.success) setGraphConsistency(vJson.consistency);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load cognitive operations');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  const handleAnalyzeContext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contextPrompt.trim()) return;
    setBusyContext(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/context/analyze'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ input: contextPrompt }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Context analyze error (${res.status})`);
      setContextAnalysis(json.analysis);
    } catch (err: any) {
      setError(err?.message || 'Context analysis failed');
    } finally {
      setBusyContext(false);
    }
  };

  const handleExecuteReasoning = async () => {
    if (!contextPrompt.trim() || !isDeveloperPlus) return;
    setBusyReason(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/reasoning/execute'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt: contextPrompt, maxHops: graphMaxHops }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Reasoning execute error (${res.status})`);
      setReasoningOutcome(json.outcome);
      await loadOperations();
    } catch (err: any) {
      setError(err?.message || 'Adaptive reasoning failed');
    } finally {
      setBusyReason(false);
    }
  };

  const handleRunReasoningBenchmark = async () => {
    if (!isDeveloperPlus) return;
    setBusyReason(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/reasoning/benchmark'), {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Benchmark error (${res.status})`);
      setReasoningBenchmark(json.benchmark);
      setActionMsg(`Independent benchmark completed: ${json.benchmark.passedCases}/${json.benchmark.totalCases} passed.`);
    } catch (err: any) {
      setError(err?.message || 'Independent benchmark failed');
    } finally {
      setBusyReason(false);
    }
  };

  const handleRebuildGraph = async () => {
    if (!isDeveloperPlus) return;
    setBusyGraph(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/graph/build'), {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Graph rebuild failed (${res.status})`);
      setActionMsg(`Knowledge graph rebuilt: ${json.summary.nodeCount} nodes, ${json.summary.edgeCount} edges.`);
      await loadOperations();
    } catch (err: any) {
      setError(err?.message || 'Knowledge graph rebuild failed');
    } finally {
      setBusyGraph(false);
    }
  };

  const handleTraverseGraph = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!graphQuery.trim()) return;
    setBusyGraph(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/graph/traverse'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ query: graphQuery, maxHops: graphMaxHops, limit: 8 }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Graph traversal failed (${res.status})`);
      setGraphTraversal(json.traversal);
    } catch (err: any) {
      setError(err?.message || 'Graph traversal failed');
    } finally {
      setBusyGraph(false);
    }
  };

  const handleConsolidateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDeveloperPlus || !consolidationKey.trim()) return;
    setBusyMemPerf(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/memory/consolidate'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          targetKey: consolidationKey.trim(),
          sourceCategory: 'episodic',
          archiveSourcesFromActive: archiveSources,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Memory consolidation failed (${res.status})`);
      setActionMsg(
        json.sourceKeys?.length
          ? `Archived ${json.sourceKeys.length} episodic record(s) into ${json.consolidationId}.`
          : 'No eligible episodic records found in this tenant scope.'
      );
      await loadOperations();
    } catch (err: any) {
      setError(err?.message || 'Memory consolidation failed');
    } finally {
      setBusyMemPerf(false);
    }
  };

  const handleRollbackConsolidation = async (consolidationId: string) => {
    if (!isAdmin) return;
    setBusyMemPerf(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/memory/rollback'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ consolidationId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Rollback failed (${res.status})`);
      setActionMsg(`Rolled back ${consolidationId}: restored ${json.restoredKeys?.length ?? 0} source record(s).`);
      await loadOperations();
    } catch (err: any) {
      setError(err?.message || 'Memory consolidation rollback failed');
    } finally {
      setBusyMemPerf(false);
    }
  };

  const handleApplyOptimization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setBusyMemPerf(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/performance/optimize'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          reason: optReason.trim() || 'Operator tuning',
          updates: { retrievalLimit: Number(optRetrievalLimit), cacheTtlMs: Number(optCacheTtlMs) },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Optimization failed (${res.status})`);
      setActionMsg(`Applied reversible optimization snapshot ${json.snapshot.snapshotId}.`);
      await loadOperations();
    } catch (err: any) {
      setError(err?.message || 'Optimization update failed');
    } finally {
      setBusyMemPerf(false);
    }
  };

  const handleRollbackOptimization = async (snapshotId: string) => {
    if (!isAdmin) return;
    setBusyMemPerf(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/performance/rollback'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ snapshotId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Rollback failed (${res.status})`);
      setActionMsg(`Restored configuration prior to snapshot ${snapshotId}.`);
      await loadOperations();
    } catch (err: any) {
      setError(err?.message || 'Optimization rollback failed');
    } finally {
      setBusyMemPerf(false);
    }
  };

  const handleRunEvaluation = async () => {
    if (!isDeveloperPlus) return;
    setBusyEval(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/evaluation'), {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Evaluation run failed (${res.status})`);
      setActionMsg(`Batch 29 evaluation ${json.report.runId} finished: ${json.report.summary.passed}/${json.report.summary.total} passed.`);
      await loadOperations();
    } catch (err: any) {
      setError(err?.message || 'Evaluation run failed');
    } finally {
      setBusyEval(false);
    }
  };

  const handleApplyActionPreset = (preset: {
    mode: ActionMissionModeUI;
    runtime: 'node' | 'python3';
    goal: string;
    targetFile?: string;
    sourceCode?: string;
    unitTestCode?: string;
  }) => {
    setActionMode(preset.mode);
    setActionRuntime(preset.runtime);
    setActionGoal(preset.goal);
    setActionTargetFile(preset.targetFile || '');
    setActionSourceCode(preset.sourceCode || '');
    setActionUnitTestCode(preset.unitTestCode || '');
    setShowAdvancedInputs(Boolean(preset.targetFile || preset.sourceCode || preset.unitTestCode));
    setError(null);
    setActionMsg(null);
  };

  const handlePerceiveAction = async () => {
    setBusyAction(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl('/api/action/perceive'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ goal: actionGoal.trim() || 'Inspect runtime environment' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Perception failed (${res.status})`);
      setPerceptionSnap(json.perception);
      setActionMsg(
        `Perception captured: ${json.perception.workspaceFileCount} workspace files, Neural=${json.perception.connectivity?.runtimeState}, Audit=${json.perception.auditIntegrity?.valid ? 'VALID' : 'INVALID'}.`
      );
    } catch (err: any) {
      setError(err?.message || 'Environment perception failed');
    } finally {
      setBusyAction(false);
    }
  };

  const handleExecuteActionMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDeveloperPlus || !actionGoal.trim()) return;
    setBusyAction(true);
    setError(null);
    setActionMsg(null);
    try {
      const payload: Record<string, unknown> = {
        goal: actionGoal.trim(),
        mode: actionMode,
        runtime: actionRuntime,
      };
      if (actionTargetFile.trim()) payload.targetFile = actionTargetFile.trim();
      if (actionSourceCode.trim()) payload.sourceCode = actionSourceCode;
      if (actionUnitTestCode.trim()) payload.unitTestCode = actionUnitTestCode;
      if (actionApprovalId.trim()) payload.approvalRequestId = actionApprovalId.trim();

      const res = await fetch(apiUrl('/api/action/missions/run'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Action mission failed (${res.status})`);
      setActiveMission(json.mission);
      setPerceptionSnap(json.mission.perception || null);
      setActionMsg(
        `Mission ${json.mission.missionId} finished with status ${json.mission.status} (${json.mission.durationMs} ms).`
      );
      await loadOperations();
    } catch (err: any) {
      setError(err?.message || 'Action mission failed');
    } finally {
      setBusyAction(false);
    }
  };

  const handleInspectMission = async (missionId: string) => {
    setBusyAction(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/action/missions/${encodeURIComponent(missionId)}`), {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed to load mission (${res.status})`);
      setActiveMission(json.mission);
      setPerceptionSnap(json.mission.perception || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to inspect mission');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDownloadDeliverable = async (zipFilename: string) => {
    setBusyDownload(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/agent/deliverables/${encodeURIComponent(zipFilename)}`), {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Failed to download deliverable package');
    } finally {
      setBusyDownload(false);
    }
  };

  const runtimeState = opsData?.connectivity?.runtimeState || statusData?.model?.runtimeState || 'NOT_CONFIGURED';
  const runtimeDotStatus = opsData?.connectivity?.executionVerified ? 'READY' : 'BLOCKED';
  const kgSummary = opsData?.knowledgeGraph;
  const memSummary = opsData?.memory;
  const perfTelemetry = opsData?.performance;
  const latestEval = opsData?.evaluation;
  const multimodal = opsData?.multimodal;
  const actionCaps = opsData?.actionDriven?.capabilities;
  const recentMissions = opsData?.actionDriven?.recentMissions || [];

  const tabs: Array<{ id: CognitiveTab; label: string }> = [
    { id: 'action_engine', label: lang === 'th' ? 'ระบบลงมือทำ 8 ขั้นตอน (Action Engine)' : 'Action Engine (8 Pillars)' },
    { id: 'context_reasoning', label: lang === 'th' ? 'บริบทและการให้เหตุผล' : 'Context & Reasoning' },
    { id: 'knowledge_graph', label: lang === 'th' ? 'กราฟความรู้และ Provenance' : 'Knowledge Graph' },
    { id: 'memory_performance', label: lang === 'th' ? 'ความจำและประสิทธิภาพ' : 'Memory & Performance' },
    { id: 'evaluation_multimodal', label: lang === 'th' ? 'ผลประเมิน 12 ตัวชี้วัด & มัลติโมดัล' : 'Evaluation & Multimodal' },
  ];

  return (
    <PageContainer maxWidth="7xl">
      <SectionHeader
        eyebrow="COGNITIVE INTELLIGENCE LAYER"
        title={lang === 'th' ? 'ศูนย์ปฏิบัติการพุทธิปัญญาและสถาปัตยกรรมปรับตัว' : 'Cognitive Intelligence & Adaptive Operations'}
        subtitle={
          lang === 'th'
            ? 'แยกการทำงานเชิงกำหนด (Deterministic Preprocessor) ออกจากสถานะโมเดลจริงอย่างโปร่งใส ตามนโยบาย Zero Simulation'
            : 'Separating deterministic verification, knowledge provenance, and native model readiness under strict Zero Simulation guarantees.'
        }
        accentColor="cyan"
        action={
          <div className="flex items-center gap-2.5">
            <StatusDot
              status={loading ? 'CHECKING' : (runtimeDotStatus as any)}
              label={`Cloud Neural: ${runtimeState}`}
              detail={opsData?.connectivity?.reason || 'Cloud checkpoint status'}
              pulse={loading}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={loading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void loadOperations()}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="rounded-xl border border-[color-mix(in_srgb,var(--z-danger)_50%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] px-4 py-3 text-xs text-[var(--z-danger)] flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {actionMsg && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] px-4 py-3 text-xs text-[var(--app-text-primary)] flex items-center justify-between gap-3">
          <span>{actionMsg}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionMsg(null)}>
            Close
          </Button>
        </div>
      )}

      {/* Top Overview KPI Strip */}
      <ResponsiveGrid cols={4}>
        <MetricCard
          title="Context Sessions"
          value={opsData?.context?.stats?.activeSessions ?? 0}
          subtitle={`${opsData?.context?.stats?.totalTurns ?? 0} turns · ${opsData?.context?.stats?.pinnedFactsCount ?? 0} pinned`}
          icon={<Layers className="w-4 h-4" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Knowledge Graph"
          value={kgSummary ? `${kgSummary.nodeCount} / ${kgSummary.edgeCount}` : '0 / 0'}
          subtitle={`Nodes / Edges · ${kgSummary?.contradictionsCount ?? 0} contradictions`}
          icon={<Network className="w-4 h-4" />}
          accentColor="violet"
        />
        <MetricCard
          title="Memory Store"
          value={memSummary?.stats?.totalItems ?? 0}
          subtitle={`Integrity ${memSummary?.integrity?.valid ? 'Verified' : 'Check'} · ${memSummary?.duplicates?.length ?? 0} near-dups`}
          icon={<Database className="w-4 h-4" />}
          accentColor="lime"
        />
        <MetricCard
          title="Eval Lab (12 Metrics)"
          value={latestEval ? `${latestEval.summary.passed}/${latestEval.summary.total}` : 'Not run'}
          subtitle={
            latestEval
              ? `${latestEval.summary.blocked} blocked · ${latestEval.durationMs} ms`
              : 'Execute 12-metric cognitive suite'
          }
          icon={<ShieldCheck className="w-4 h-4" />}
          accentColor="coral"
        />
      </ResponsiveGrid>

      {/* Segmented Navigation Bar (Interactive Filter Tabs) */}
      <div
        role="tablist"
        aria-label="Cognitive operation domains"
        className="flex items-center gap-1 p-1 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] overflow-x-auto"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-gradient-to-r from-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] via-[color-mix(in_srgb,var(--app-accent-deep)_25%,transparent)] to-[color-mix(in_srgb,var(--app-accent-deep)_25%,transparent)] text-[var(--app-text-primary)] border border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)]'
                  : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* PANEL 0: Batch 30 Action-Driven 8-Pillar Engine */}
      {activeTab === 'action_engine' && (
        <div className="space-y-6">
          <VividCard
            title={lang === 'th' ? 'ภารกิจปฏิบัติการจริง 8 เสาหลัก (Perception → Autonomy)' : 'Action-Driven 8-Pillar Execution Console'}
            subtitle={
              lang === 'th'
                ? 'รับรู้สภาพแวดล้อมจริง วิเคราะห์ วางแผน สร้างไฟล์ใน /workspace ทดสอบโค้ด ซ่อมแซมอัตโนมัติ และปิดงานพร้อมหลักฐาน Audit'
                : 'Real workspace mutation, syntax/runtime verification, deterministic self-repair, PII-scrubbed learning, and SHA-256 ZIP delivery'
            }
            gradientAccent="cyan"
            variant="midnight"
            headerAction={
              <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                <span className="text-[var(--app-text-secondary)]">
                  Attribution: <span className="text-[var(--app-accent)]">deterministic_action_engine</span>
                </span>
                <span className="text-[var(--app-text-secondary)]">
                  Delivered: <span className="text-[var(--z-ok)]">{actionCaps?.recentMissionStats?.delivered ?? 0}/{actionCaps?.recentMissionStats?.total ?? 0}</span>
                </span>
              </div>
            }
          >
            {/* Quick Verified Engineering Presets */}
            <div className="mb-5">
              <div className="text-xs font-semibold text-[var(--app-text-secondary)] mb-2">
                {lang === 'th' ? 'ภารกิจตัวอย่างสำหรับทดสอบการทำงานจริง' : 'Quick Verifiable Missions'}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<FileCode2 className="w-3.5 h-3.5 text-[var(--app-accent)]" />}
                  onClick={() =>
                    handleApplyActionPreset({
                      mode: 'engineering_blueprint_execute',
                      runtime: 'node',
                      goal: 'Build an in-memory LRU cache with TTL eviction, unit tests, and verified deliverable package',
                    })
                  }
                >
                  LRU Cache + TTL (Node)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<ShieldCheck className="w-3.5 h-3.5 text-[var(--app-accent-deep)]" />}
                  onClick={() =>
                    handleApplyActionPreset({
                      mode: 'engineering_blueprint_execute',
                      runtime: 'node',
                      goal: 'Build a constant-time HMAC-SHA256 webhook signature verifier with unit tests',
                    })
                  }
                >
                  HMAC Verifier (Node)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<GitBranch className="w-3.5 h-3.5 text-[var(--z-ok)]" />}
                  onClick={() =>
                    handleApplyActionPreset({
                      mode: 'engineering_blueprint_execute',
                      runtime: 'python3',
                      goal: 'Build a topological DAG dependency scheduler in Python with cycle detection unit tests',
                    })
                  }
                >
                  DAG Scheduler (Python)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<Wrench className="w-3.5 h-3.5 text-[var(--z-warn)]" />}
                  onClick={() =>
                    handleApplyActionPreset({
                      mode: 'workspace_verify_repair',
                      runtime: 'node',
                      goal: 'Verify and self-repair broken JS config parser removing unsafe eval and closing braces',
                      targetFile: `missions/repair_probe_${Date.now()}.js`,
                      sourceCode:
                        'function parsePayload(raw) {\n  const data = eval("(" + raw + ")");\n  return data.ok;\n\nconsole.log(JSON.stringify({ ok: parsePayload(\'{"ok":true}\') }));',
                    })
                  }
                >
                  Verify & Self-Repair Buggy JS
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<Activity className="w-3.5 h-3.5 text-[var(--app-accent)]" />}
                  onClick={() =>
                    handleApplyActionPreset({
                      mode: 'system_integrity_audit',
                      runtime: 'node',
                      goal: 'Run live system integrity audit across AuditLedger, Memory Store, Knowledge Graph, Docker & SSRF',
                    })
                  }
                >
                  System Integrity Audit
                </Button>
              </div>
            </div>

            <form onSubmit={handleExecuteActionMission} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label htmlFor="action-mode-select" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                    Action Mode
                  </label>
                  <select
                    id="action-mode-select"
                    value={actionMode}
                    onChange={(e) => setActionMode(e.target.value as ActionMissionModeUI)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                  >
                    <option value="engineering_blueprint_execute">Engineering Blueprint — Build, Test & Package ZIP</option>
                    <option value="workspace_verify_repair">Workspace Verify & Self-Repair (Snapshot + Rollback)</option>
                    <option value="system_integrity_audit">Live System Integrity & Security Audit</option>
                    <option value="reasoning_verification">Formal Reasoning & Constraint Verification</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="action-runtime-select" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                    Sandbox Runtime
                  </label>
                  <select
                    id="action-runtime-select"
                    value={actionRuntime}
                    onChange={(e) => setActionRuntime(e.target.value as 'node' | 'python3')}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3 py-2 text-sm font-mono text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                  >
                    <option value="node">node (v22 sandbox)</option>
                    <option value="python3">python3 (-B sandbox)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="action-goal-input" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                  Mission Objective (Thai or English)
                </label>
                <textarea
                  id="action-goal-input"
                  rows={2}
                  value={actionGoal}
                  onChange={(e) => setActionGoal(e.target.value)}
                  className="w-full rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3.5 py-2.5 text-sm text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] focus:border-[var(--app-accent)] focus:outline-none"
                  placeholder="Describe what ZYNTHEOR should build, verify, repair, or audit..."
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvancedInputs((v) => !v)}
                  className="text-xs font-semibold text-[var(--app-accent)] hover:brightness-110 cursor-pointer"
                >
                  {showAdvancedInputs ? 'Hide workspace code & governance inputs' : 'Configure custom workspace file, source code, tests, or Approval ID'}
                </button>
              </div>

              {showAdvancedInputs && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 rounded-xl border border-[var(--app-card-border)] bg-[color-mix(in_srgb,var(--app-bg)_70%,transparent)]">
                  <div>
                    <label htmlFor="action-target-file" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1">
                      Target File (relative inside /workspace)
                    </label>
                    <input
                      id="action-target-file"
                      type="text"
                      value={actionTargetFile}
                      onChange={(e) => setActionTargetFile(e.target.value)}
                      placeholder="e.g. missions/custom_service.js"
                      className="w-full min-h-[38px] rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-1.5 text-xs font-mono text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="action-approval-id" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1">
                      Approval Request ID (required only for high-impact actions)
                    </label>
                    <input
                      id="action-approval-id"
                      type="text"
                      value={actionApprovalId}
                      onChange={(e) => setActionApprovalId(e.target.value)}
                      placeholder="Optional APR-..."
                      className="w-full min-h-[38px] rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-1.5 text-xs font-mono text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="action-source-code" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1">
                      Source Code (optional; overrides generated blueprint)
                    </label>
                    <textarea
                      id="action-source-code"
                      rows={5}
                      value={actionSourceCode}
                      onChange={(e) => setActionSourceCode(e.target.value)}
                      placeholder="Paste JS or Python code to verify or repair..."
                      className="w-full rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-2 text-xs font-mono text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="action-unit-test" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1">
                      Unit Test Code (optional)
                    </label>
                    <textarea
                      id="action-unit-test"
                      rows={5}
                      value={actionUnitTestCode}
                      onChange={(e) => setActionUnitTestCode(e.target.value)}
                      placeholder="Optional assertion test script..."
                      className="w-full rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface)] px-3 py-2 text-xs font-mono text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  loading={busyAction}
                  leftIcon={<Terminal className="w-4 h-4 text-[var(--app-accent)]" />}
                  onClick={() => void handlePerceiveAction()}
                >
                  Perceive Environment
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busyAction}
                  disabled={!isDeveloperPlus}
                  title={!isDeveloperPlus ? 'Developer or Administrator role required to execute sandbox mutations' : undefined}
                  leftIcon={<Zap className="w-4 h-4" />}
                >
                  Execute 8-Pillar Mission
                </Button>
                {!isDeveloperPlus && (
                  <Text size="xs" tone="muted">
                    Execution requires Developer or Administrator role (current: {role}).
                  </Text>
                )}
              </div>
            </form>

            {perceptionSnap && !activeMission && (
              <div className="mt-6 pt-6 border-t border-[var(--app-card-border)] grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <div className="text-[var(--app-text-secondary)]">Workspace Files</div>
                  <div className="font-mono tabular-nums text-[var(--app-text-primary)] mt-0.5">{perceptionSnap.workspaceFileCount}</div>
                </div>
                <div>
                  <div className="text-[var(--app-text-secondary)]">Docker Sandbox</div>
                  <div className="font-mono text-[var(--app-accent)] mt-0.5">
                    {perceptionSnap.dockerStatus?.dockerAvailable ? 'Available' : 'Process Sandbox Only'}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--app-text-secondary)]">Detected Intent</div>
                  <div className="font-mono text-[var(--z-ok)] mt-0.5">{perceptionSnap.contextAnalysis?.intent?.primary}</div>
                </div>
                <div>
                  <div className="text-[var(--app-text-secondary)]">Audit Chain</div>
                  <div className="font-mono text-[var(--app-text-primary)] mt-0.5">
                    {perceptionSnap.auditIntegrity?.valid ? `VALID (${perceptionSnap.auditIntegrity.totalRecords})` : 'INVALID'}
                  </div>
                </div>
              </div>
            )}
          </VividCard>

          {activeMission && (
            <VividCard
              title={`Mission Report · ${activeMission.missionId}`}
              subtitle={activeMission.goal}
              gradientAccent={activeMission.status === 'DELIVERED' ? 'lime' : 'coral'}
              variant="midnight"
              headerAction={
                <div className="flex items-center gap-3">
                  <StatusDot
                    status={activeMission.status === 'DELIVERED' ? 'VERIFIED' : activeMission.status === 'BLOCKED' ? 'BLOCKED' : 'FAILED'}
                    label={activeMission.status}
                  />
                  {activeMission.packageArtifact?.zipFilename && (
                    <Button
                      size="sm"
                      variant="lime"
                      loading={busyDownload}
                      disabled={!isDeveloperPlus}
                      leftIcon={<Download className="w-3.5 h-3.5" />}
                      onClick={() => void handleDownloadDeliverable(activeMission.packageArtifact.zipFilename)}
                    >
                      Download ZIP
                    </Button>
                  )}
                </div>
              }
            >
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs pb-5 border-b border-[var(--app-card-border)]">
                <div>
                  <div className="text-[var(--app-text-secondary)]">Mode</div>
                  <div className="font-mono text-[var(--app-text-primary)] mt-0.5">{activeMission.mode}</div>
                </div>
                <div>
                  <div className="text-[var(--app-text-secondary)]">Runtime</div>
                  <div className="font-mono text-[var(--app-accent)] mt-0.5">{activeMission.runtime}</div>
                </div>
                <div>
                  <div className="text-[var(--app-text-secondary)]">Attribution</div>
                  <div className="font-mono text-[var(--app-text-primary)] mt-0.5">{activeMission.attribution}</div>
                </div>
                <div>
                  <div className="text-[var(--app-text-secondary)]">Duration</div>
                  <div className="font-mono tabular-nums text-[var(--app-text-primary)] mt-0.5">{activeMission.durationMs} ms</div>
                </div>
                <div>
                  <div className="text-[var(--app-text-secondary)]">Audit Hash</div>
                  <div className="font-mono tabular-nums text-[var(--app-text-secondary)] mt-0.5 truncate" title={activeMission.auditEntryHash}>
                    {String(activeMission.auditEntryHash || '').slice(0, 14)}…
                  </div>
                </div>
              </div>

              {activeMission.failureReason && (
                <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--z-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-warn)_10%,transparent)] px-4 py-2.5 text-xs text-[var(--z-danger)]">
                  <strong>Reason / Blocker:</strong> {activeMission.failureReason}
                </div>
              )}

              {/* 8 Pillars Table */}
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                      <th className="py-2 pr-3">Pillar</th>
                      <th className="py-2 pr-4">Stage</th>
                      <th className="py-2 pr-4">Latency</th>
                      <th className="py-2 pr-4">Real Runtime Evidence</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                    {(activeMission.pillars || []).map((p: any) => (
                      <tr key={p.id}>
                        <td className="py-2.5 pr-3 font-mono text-[var(--app-accent)] whitespace-nowrap">{p.id}</td>
                        <td className="py-2.5 pr-4 font-semibold text-[var(--app-text-primary)] whitespace-nowrap">
                          {lang === 'th' ? p.labelTh : p.name}
                        </td>
                        <td className="py-2.5 pr-4 font-mono tabular-nums text-[var(--app-text-secondary)] whitespace-nowrap">
                          {p.durationMs} ms
                        </td>
                        <td className="py-2.5 pr-4 text-[var(--app-text-primary)]">{p.summary}</td>
                        <td className="py-2.5 text-right">
                          <StatusDot
                            status={p.status === 'PASS' ? 'VERIFIED' : p.status === 'REPAIRED' ? 'IMPLEMENTED' : p.status === 'SKIPPED' ? 'PARTIAL' : p.status}
                            label={p.status}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Verification Output & Acceptance Criteria */}
              {activeMission.verificationOutput && (
                <div className="mt-6 pt-5 border-t border-[var(--app-card-border)] grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                  <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] p-3.5 space-y-2">
                    <div className="flex items-center justify-between font-semibold text-[var(--app-text-primary)]">
                      <span>Sandbox Output (exit={String(activeMission.verificationOutput.runtimeExitCode)})</span>
                      <span className="font-mono text-[var(--app-accent)]">
                        Syntax: {activeMission.verificationOutput.syntaxOk ? 'OK' : 'FAIL'}
                      </span>
                    </div>
                    <pre className="font-mono text-[11px] text-[var(--z-ok)] whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {activeMission.verificationOutput.stdout || activeMission.verificationOutput.stderr || '(no output)'}
                    </pre>
                    {activeMission.verificationOutput.unitTestExitCode !== null && (
                      <div className="pt-2 border-t border-[var(--app-card-border)]">
                        <div className="text-[var(--app-text-secondary)] mb-1">
                          Unit Tests (exit={activeMission.verificationOutput.unitTestExitCode})
                        </div>
                        <pre className="font-mono text-[11px] text-[var(--app-text-primary)] whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {activeMission.verificationOutput.unitTestStdout || '(no unit test output)'}
                        </pre>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] p-3.5 space-y-2">
                    <div className="font-semibold text-[var(--app-text-primary)]">Acceptance Criteria & Artifacts</div>
                    <div className="space-y-1.5">
                      {(activeMission.acceptanceCriteria || []).map((ac: any) => (
                        <div key={ac.id} className="flex items-start gap-2">
                          <CheckCircle2
                            className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${ac.passed ? 'text-[var(--z-ok)]' : 'text-[var(--z-danger)]'}`}
                          />
                          <div className="min-w-0">
                            <div className="font-mono text-[var(--app-text-primary)]">{ac.id}</div>
                            <div className="text-[var(--app-text-secondary)] break-words">{ac.evidence}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {activeMission.learningCapture?.captured && (
                      <div className="pt-2 border-t border-[var(--app-card-border)] text-[11px] font-mono text-[var(--app-accent)]">
                        Learned Memory Key: {activeMission.learningCapture.memoryKey}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </VividCard>
          )}

          {/* Recent Action Missions Table */}
          <VividCard
            title={lang === 'th' ? 'ประวัติภารกิจล่าสุด' : 'Recent Action Missions'}
            subtitle={lang === 'th' ? 'คลิกที่ภารกิจเพื่อตรวจสอบหลักฐาน 8 ขั้นตอนย้อนหลัง' : 'Select any tenant-scoped mission to inspect full 8-pillar runtime evidence'}
            gradientAccent="violet"
            variant="midnight"
          >
            {recentMissions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                      <th className="py-2 pr-3">Mission ID</th>
                      <th className="py-2 pr-4">Mode</th>
                      <th className="py-2 pr-4">Goal</th>
                      <th className="py-2 pr-3">Duration</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                    {recentMissions.map((m: any) => (
                      <tr key={m.missionId} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 pr-3 font-mono text-[var(--app-accent)] whitespace-nowrap">{m.missionId}</td>
                        <td className="py-2.5 pr-4 font-mono text-[var(--app-text-secondary)] whitespace-nowrap">{m.mode}</td>
                        <td className="py-2.5 pr-4 text-[var(--app-text-primary)] max-w-md truncate">{m.goal}</td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums whitespace-nowrap">{m.durationMs} ms</td>
                        <td className="py-2.5 pr-3">
                          <StatusDot
                            status={m.status === 'DELIVERED' ? 'VERIFIED' : m.status === 'BLOCKED' ? 'BLOCKED' : 'FAILED'}
                            label={m.status}
                          />
                        </td>
                        <td className="py-2.5 text-right">
                          <Button size="sm" variant="ghost" onClick={() => void handleInspectMission(m.missionId)}>
                            Inspect
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyStateCard
                icon={<Zap className="w-5 h-5" />}
                title={lang === 'th' ? 'ยังไม่มีภารกิจที่บันทึกใน Tenant นี้' : 'No action missions executed yet'}
                description={
                  lang === 'th'
                    ? 'เลือกภารกิจตัวอย่างด้านบนแล้วกด Execute 8-Pillar Mission เพื่อสร้างไฟล์ รันทดสอบ และรับแพ็กเกจ SHA-256 จริง'
                    : 'Choose a preset or enter a goal above and click Execute 8-Pillar Mission to build, test, repair, and verify real software.'
                }
              />
            )}
          </VividCard>
        </div>
      )}

      {/* PANEL 1: Context Engine & Adaptive Reasoning */}
      {activeTab === 'context_reasoning' && (
        <div className="space-y-6">
          <VividCard
            title="Context Segmentation & Adaptive Reasoning Probe"
            subtitle="Deterministic preprocessor segmentation, conflict detection, strategy selection, counterexample verification, and private trace redaction"
            gradientAccent="cyan"
            variant="midnight"
          >
            <form onSubmit={handleAnalyzeContext} className="space-y-4">
              <div>
                <label htmlFor="cognitive-prompt-input" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                  Task Specification or Bilingual Query (Thai / English)
                </label>
                <textarea
                  id="cognitive-prompt-input"
                  rows={3}
                  value={contextPrompt}
                  onChange={(e) => setContextPrompt(e.target.value)}
                  className="w-full rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3.5 py-2.5 text-sm text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] focus:border-[var(--app-accent)] focus:outline-none"
                  placeholder="Enter a technical specification, constraint list, or Thai/English query..."
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={busyContext}
                  leftIcon={<Brain className="w-4 h-4 text-[var(--app-accent)]" />}
                >
                  Analyze Context
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  loading={busyReason}
                  disabled={!isDeveloperPlus}
                  title={!isDeveloperPlus ? 'Developer or Administrator role required' : undefined}
                  leftIcon={<Play className="w-4 h-4" />}
                  onClick={() => void handleExecuteReasoning()}
                >
                  Execute Adaptive Reasoning
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  loading={busyReason}
                  disabled={!isDeveloperPlus}
                  onClick={() => void handleRunReasoningBenchmark()}
                >
                  Run Reasoning Benchmark
                </Button>
                {!isDeveloperPlus && (
                  <Text size="xs" tone="muted">
                    Reasoning execution requires Developer or Administrator role (current: {role}).
                  </Text>
                )}
              </div>
            </form>

            {contextAnalysis && (
              <div className="mt-6 pt-6 border-t border-[var(--app-card-border)] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--app-text-secondary)]">
                  <span className="font-semibold text-[var(--app-text-primary)]">Context Analysis Result</span>
                  <span className="font-mono tabular-nums">
                    {contextAnalysis.attribution} · Neural {contextAnalysis.nativeNeuralState} · Lang {contextAnalysis.language} · Intent {contextAnalysis.intent.primary} ({Math.round((contextAnalysis.intent.confidence ?? 0) * 100)}%)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                        <th className="py-2 pr-4 font-semibold">Kind</th>
                        <th className="py-2 pr-4 font-semibold">Priority</th>
                        <th className="py-2 pr-4 font-semibold">Relevance</th>
                        <th className="py-2 font-semibold">Segment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                      {contextAnalysis.segments.map((seg: any) => (
                        <tr key={seg.segmentId} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 pr-4 font-mono text-[var(--app-accent)] whitespace-nowrap">{seg.kind}</td>
                          <td className="py-2.5 pr-4 font-mono tabular-nums">P{seg.priority}</td>
                          <td className="py-2.5 pr-4 font-mono tabular-nums">{seg.relevanceScore}</td>
                          <td className="py-2.5 text-[var(--app-text-primary)]">{seg.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {contextAnalysis.conflicts?.length > 0 && (
                  <div className="pt-2 text-xs text-[var(--z-warn)]">
                    {contextAnalysis.conflicts.length} conflict(s) detected:{' '}
                    {contextAnalysis.conflicts.map((c: any) => c.description).join(' | ')}
                  </div>
                )}
              </div>
            )}

            {reasoningOutcome && (
              <div className="mt-6 pt-6 border-t border-[var(--app-card-border)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-[var(--app-text-primary)]">
                    Adaptive Reasoning Outcome · Class {reasoningOutcome.problemClass}
                  </div>
                  <StatusDot
                    status={reasoningOutcome.verified ? 'VERIFIED' : reasoningOutcome.uncertainty?.abstentionRecommended ? 'PARTIAL' : 'FAILED'}
                    label={reasoningOutcome.verified ? 'Verified' : reasoningOutcome.uncertainty?.abstentionRecommended ? 'Abstained' : 'Unverified'}
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs pt-1">
                  <div>
                    <div className="text-[var(--app-text-secondary)]">Strategy</div>
                    <div className="font-mono text-[var(--app-accent)] mt-0.5">{reasoningOutcome.selectedStrategy}</div>
                  </div>
                  <div>
                    <div className="text-[var(--app-text-secondary)]">Calibrated Confidence</div>
                    <div className="font-mono tabular-nums text-[var(--app-text-primary)] mt-0.5">
                      {reasoningOutcome.uncertainty?.calibratedConfidence} (U={reasoningOutcome.uncertainty?.epistemicUncertainty})
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--app-text-secondary)]">Counterexample Test</div>
                    <div className="font-mono text-[var(--z-ok)] mt-0.5">
                      {reasoningOutcome.winningHypothesis?.counterexamplePassed ? 'Passed' : 'Flagged'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--app-text-secondary)]">Redacted Trace SHA-256</div>
                    <div className="font-mono tabular-nums text-[var(--app-text-secondary)] mt-0.5 truncate" title={reasoningOutcome.reasoningMetadata?.traceDigestSha256}>
                      {String(reasoningOutcome.reasoningMetadata?.traceDigestSha256 || '').slice(0, 14)}…
                    </div>
                  </div>
                </div>
                <p className="text-xs text-[var(--app-text-primary)] leading-relaxed pt-1">{reasoningOutcome.answerSummary}</p>
              </div>
            )}

            {reasoningBenchmark && (
              <div className="mt-6 pt-6 border-t border-[var(--app-card-border)] space-y-2 text-xs">
                <div className="font-semibold text-[var(--app-text-primary)]">
                  Independent Reasoning Benchmark: {reasoningBenchmark.passedCases}/{reasoningBenchmark.totalCases} passed ({Math.round((reasoningBenchmark.accuracy ?? 0) * 100)}%) · Avg {reasoningBenchmark.avgLatencyMs} ms
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                        <th className="py-2 pr-4">Case</th>
                        <th className="py-2 pr-4">Class</th>
                        <th className="py-2 pr-4">Strategy</th>
                        <th className="py-2 pr-4">Confidence</th>
                        <th className="py-2 text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                      {(reasoningBenchmark.cases || []).map((r: any) => (
                        <tr key={r.caseId}>
                          <td className="py-2 pr-4 font-mono">{r.caseId}</td>
                          <td className="py-2 pr-4 font-mono text-[var(--app-text-secondary)]">{r.problemClass}</td>
                          <td className="py-2 pr-4 font-mono text-[var(--app-accent)]">{r.strategy}</td>
                          <td className="py-2 pr-4 font-mono tabular-nums">{r.calibratedConfidence}</td>
                          <td className="py-2 text-right">
                            <StatusDot status={r.passed ? 'VERIFIED' : 'FAILED'} label={r.passed ? 'PASS' : 'FAIL'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </VividCard>

          <VividCard
            title="Recent Reasoning Audit History"
            subtitle="Traceable public summaries with SHA-256 redacted private reasoning digests"
            gradientAccent="violet"
            variant="midnight"
          >
            {opsData?.reasoning?.recentOutcomes?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                      <th className="py-2 pr-4">Time</th>
                      <th className="py-2 pr-4">Class</th>
                      <th className="py-2 pr-4">Strategy</th>
                      <th className="py-2 pr-4">Confidence</th>
                      <th className="py-2 pr-4">Latency</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                    {opsData.reasoning.recentOutcomes.map((item: any) => (
                      <tr key={item.reasoningId}>
                        <td className="py-2.5 pr-4 font-mono tabular-nums text-[var(--app-text-secondary)] whitespace-nowrap">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 pr-4 font-mono">{item.problemClass}</td>
                        <td className="py-2.5 pr-4 font-mono text-[var(--app-accent)]">{item.selectedStrategy}</td>
                        <td className="py-2.5 pr-4 font-mono tabular-nums">{item.uncertainty?.calibratedConfidence}</td>
                        <td className="py-2.5 pr-4 font-mono tabular-nums">{item.reasoningMetadata?.durationMs} ms</td>
                        <td className="py-2.5 text-right">
                          <StatusDot
                            status={item.verified ? 'VERIFIED' : item.uncertainty?.abstentionRecommended ? 'PARTIAL' : 'FAILED'}
                            label={item.verified ? 'VERIFIED' : item.uncertainty?.abstentionRecommended ? 'ABSTAIN' : 'FAILED'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyStateCard
                icon={<Brain className="w-5 h-5" />}
                title="No adaptive reasoning runs yet"
                description="Run a prompt through Adaptive Reasoning above to inspect strategy selection, counterexample verification, and trace redaction digests."
              />
            )}
          </VividCard>
        </div>
      )}

      {/* PANEL 2: Knowledge Graph & Multi-Hop Retrieval */}
      {activeTab === 'knowledge_graph' && (
        <div className="space-y-6">
          <VividCard
            title="Provenance-Aware Knowledge Graph Traversal"
            subtitle="Bilingual entity canonicalization, 1-to-3 hop BFS paths, document SHA-256 provenance, and contradiction checks"
            gradientAccent="violet"
            variant="midnight"
            headerAction={
              <Button
                variant="secondary"
                size="sm"
                loading={busyGraph}
                disabled={!isDeveloperPlus}
                leftIcon={<GitBranch className="w-3.5 h-3.5 text-[var(--app-accent)]" />}
                onClick={() => void handleRebuildGraph()}
              >
                Rebuild Graph
              </Button>
            }
          >
            <form onSubmit={handleTraverseGraph} className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1 min-w-0">
                <label htmlFor="kg-query-input" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                  Entity or Concept Seed Query
                </label>
                <input
                  id="kg-query-input"
                  type="text"
                  value={graphQuery}
                  onChange={(e) => setGraphQuery(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3.5 py-2 text-sm text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                  placeholder="e.g. ZYNTHEOR, NativeLM, AuditLedger, HMAC..."
                />
              </div>
              <div className="w-full sm:w-32">
                <label htmlFor="kg-hops-select" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                  Max Hops
                </label>
                <select
                  id="kg-hops-select"
                  value={graphMaxHops}
                  onChange={(e) => setGraphMaxHops(Number(e.target.value))}
                  className="w-full min-h-[40px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3 py-2 text-sm font-mono text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                >
                  <option value={1}>1 hop</option>
                  <option value={2}>2 hops</option>
                  <option value={3}>3 hops</option>
                </select>
              </div>
              <Button type="submit" variant="primary" loading={busyGraph} leftIcon={<Network className="w-4 h-4" />}>
                Traverse Graph
              </Button>
            </form>

            {graphTraversal && (
              <div className="mt-6 pt-6 border-t border-[var(--app-card-border)] space-y-3">
                <div className="text-xs text-[var(--app-text-secondary)] font-mono tabular-nums">
                  {graphTraversal.paths.length} traversal path(s) in {graphTraversal.latencyMs} ms · Seed nodes:{' '}
                  {graphTraversal.seedNodes.join(', ') || 'None matched'}
                </div>
                {graphTraversal.paths.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                          <th className="py-2 pr-4">Path Chain</th>
                          <th className="py-2 pr-4">Sources</th>
                          <th className="py-2 pr-4">Provenance Hash</th>
                          <th className="py-2 text-right">Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                        {graphTraversal.paths.map((p: any, idx: number) => (
                          <tr key={idx}>
                            <td className="py-2.5 pr-4 text-[var(--app-text-primary)]">
                              {p.hops.map((h: any) => `${h.fromLabel} —[${h.relation}]→ ${h.toLabel}`).join(' · ')}
                            </td>
                            <td className="py-2.5 pr-4 text-[var(--app-text-secondary)]">
                              {p.hops.map((h: any) => h.documentTitle).join(', ')}
                            </td>
                            <td className="py-2.5 pr-4 font-mono tabular-nums text-[var(--app-accent)]">
                              {String(p.provenanceHashes?.[0] || '').slice(0, 12)}…
                            </td>
                            <td className="py-2.5 text-right font-mono tabular-nums">{p.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Text size="xs">No connected graph paths found for that seed within {graphMaxHops} hop(s).</Text>
                )}
              </div>
            )}

            {graphConsistency && (
              <div className="mt-6 pt-6 border-t border-[var(--app-card-border)] flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3">
                  <StatusDot status={graphConsistency.valid ? 'VERIFIED' : 'FAILED'} label={graphConsistency.valid ? 'Graph Consistent' : 'Inconsistency Detected'} />
                  <span className="font-mono tabular-nums text-[var(--app-text-secondary)]">
                    Dangling edges: {graphConsistency.danglingEdgeIds?.length ?? 0} · Missing provenance: {graphConsistency.missingProvenanceEdgeIds?.length ?? 0} · Contradictions: {graphConsistency.contradictions?.length ?? 0}
                  </span>
                </div>
                <span className="font-mono text-[var(--app-text-secondary)]">{new Date(graphConsistency.checkedAt).toLocaleString()}</span>
              </div>
            )}
          </VividCard>
        </div>
      )}

      {/* PANEL 3: Memory Consolidation & Performance Engine */}
      {activeTab === 'memory_performance' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <VividCard
            title="Reversible Episodic-to-Semantic Consolidation"
            subtitle="Archives verbatim source records in SHA-256 verified snapshots before consolidation; supports full tenant-scoped rollback"
            gradientAccent="lime"
            variant="midnight"
          >
            <form onSubmit={handleConsolidateMemory} className="space-y-4">
              <div>
                <label htmlFor="cons-target-key" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                  Target Semantic Anchor Key
                </label>
                <input
                  id="cons-target-key"
                  type="text"
                  value={consolidationKey}
                  onChange={(e) => setConsolidationKey(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3.5 py-2 text-sm font-mono text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={archiveSources}
                  onChange={(e) => setArchiveSources(e.target.checked)}
                  className="rounded border-[var(--app-card-border)]"
                />
                <span>Move consolidated episodic items out of active index after writing verbatim archive</span>
              </label>
              <Button
                type="submit"
                variant="lime"
                loading={busyMemPerf}
                disabled={!isDeveloperPlus}
                leftIcon={<Database className="w-4 h-4" />}
              >
                Consolidate With Archive Snapshot
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-[var(--app-card-border)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--app-text-primary)]">Importance Tier Breakdown</span>
                <span className="font-mono tabular-nums text-[var(--app-text-secondary)]">
                  Critical {memSummary?.tierCounts?.critical ?? 0} · High {memSummary?.tierCounts?.high ?? 0} · Normal {memSummary?.tierCounts?.normal ?? 0} · Low {memSummary?.tierCounts?.low ?? 0}
                </span>
              </div>

              {memSummary?.archives?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                        <th className="py-2 pr-3">Archive ID</th>
                        <th className="py-2 pr-3">Sources</th>
                        <th className="py-2 pr-3">State</th>
                        <th className="py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                      {memSummary.archives.slice(0, 6).map((arch: any) => (
                        <tr key={arch.consolidationId}>
                          <td className="py-2 pr-3 font-mono text-[var(--app-accent)]">{arch.consolidationId}</td>
                          <td className="py-2 pr-3 font-mono tabular-nums">{arch.sourceCount}</td>
                          <td className="py-2 pr-3 font-mono">{arch.rolledBack ? 'Rolled Back' : 'Archived'}</td>
                          <td className="py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!isAdmin || arch.rolledBack || busyMemPerf}
                              leftIcon={<RotateCcw className="w-3 h-3" />}
                              onClick={() => void handleRollbackConsolidation(arch.consolidationId)}
                            >
                              Rollback
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Text size="xs">No consolidation snapshots created in this tenant yet.</Text>
              )}
            </div>
          </VividCard>

          <VividCard
            title="Self-Adaptive Performance & Reversible Tuning"
            subtitle="Evidence-driven latency profiling, strategy comparisons, tenant-scoped caching, and snapshot rollbacks"
            gradientAccent="coral"
            variant="midnight"
          >
            <form onSubmit={handleApplyOptimization} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="perf-limit" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                    Retrieval Limit (1–20)
                  </label>
                  <input
                    id="perf-limit"
                    type="number"
                    min={1}
                    max={20}
                    value={optRetrievalLimit}
                    onChange={(e) => setOptRetrievalLimit(Number(e.target.value))}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3 py-2 text-sm font-mono tabular-nums text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="perf-ttl" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                    Cache TTL (ms)
                  </label>
                  <input
                    id="perf-ttl"
                    type="number"
                    min={0}
                    max={300000}
                    step={1000}
                    value={optCacheTtlMs}
                    onChange={(e) => setOptCacheTtlMs(Number(e.target.value))}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3 py-2 text-sm font-mono tabular-nums text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="perf-reason" className="block text-xs font-semibold text-[var(--app-text-secondary)] mb-1.5">
                  Change Rationale
                </label>
                <input
                  id="perf-reason"
                  type="text"
                  value={optReason}
                  onChange={(e) => setOptReason(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-bg)] px-3.5 py-2 text-sm text-[var(--app-text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                loading={busyMemPerf}
                disabled={!isAdmin}
                title={!isAdmin ? 'Administrator role required for runtime performance tuning' : undefined}
                leftIcon={<Sliders className="w-4 h-4" />}
              >
                Apply Reversible Optimization
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-[var(--app-card-border)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--app-text-primary)]">Telemetry & Cache Policy</span>
                <span className="font-mono tabular-nums text-[var(--app-text-secondary)]">
                  Samples {perfTelemetry?.totalSamples ?? 0} · Avg{' '}
                  {perfTelemetry?.recentAvgLatencyMs != null ? `${perfTelemetry.recentAvgLatencyMs} ms` : 'UNAVAILABLE'} · Cache Hit{' '}
                  {perfTelemetry?.cachePolicy?.hitRatePct != null ? `${perfTelemetry.cachePolicy.hitRatePct}%` : 'UNAVAILABLE'} · Time Saved{' '}
                  {perfTelemetry?.cachePolicy?.timeSavedStatus || 'UNAVAILABLE'}
                </span>
              </div>

              {perfTelemetry?.snapshots?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                        <th className="py-2 pr-3">Snapshot</th>
                        <th className="py-2 pr-3">Reason</th>
                        <th className="py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                      {perfTelemetry.snapshots.slice(0, 6).map((snap: any) => (
                        <tr key={snap.snapshotId}>
                          <td className="py-2 pr-3 font-mono text-[var(--app-accent)] whitespace-nowrap">{snap.snapshotId}</td>
                          <td className="py-2 pr-3 text-[var(--app-text-primary)]">{snap.reason}</td>
                          <td className="py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!isAdmin || snap.rolledBack || busyMemPerf}
                              leftIcon={<RotateCcw className="w-3 h-3" />}
                              onClick={() => void handleRollbackOptimization(snap.snapshotId)}
                            >
                              {snap.rolledBack ? 'Restored' : 'Rollback'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Text size="xs">No optimization snapshots applied yet.</Text>
              )}
            </div>
          </VividCard>
        </div>
      )}

      {/* PANEL 4: 12-Metric Evaluation Lab & Multimodal Capability Honesty */}
      {activeTab === 'evaluation_multimodal' && (
        <div className="space-y-6">
          <VividCard
            title="Batch 29 Cognitive Evaluation Lab (12 Reproducible Metrics)"
            subtitle="Measures context, adaptive reasoning, multi-hop graph, contradictions, reversible memory, model stability, calibration, and security"
            gradientAccent="energy"
            variant="midnight"
            headerAction={
              <Button
                variant="primary"
                size="sm"
                loading={busyEval}
                disabled={!isDeveloperPlus}
                leftIcon={<Activity className="w-3.5 h-3.5" />}
                onClick={() => void handleRunEvaluation()}
              >
                Run Full Evaluation
              </Button>
            }
          >
            {latestEval ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--app-text-secondary)] font-mono tabular-nums">
                  <span>
                    Run {latestEval.runId} · {latestEval.provenance?.runtimeVersion} · {latestEval.provenance?.datasetVersion}
                  </span>
                  <span>
                    Passed {latestEval.summary.passed}/{latestEval.summary.total} · Blocked {latestEval.summary.blocked} · Failed {latestEval.summary.failed} · {latestEval.durationMs} ms
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                        <th className="py-2 pr-3">ID</th>
                        <th className="py-2 pr-4">Metric</th>
                        <th className="py-2 pr-4">Score</th>
                        <th className="py-2 pr-4">Measured Evidence</th>
                        <th className="py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                      {latestEval.metrics.map((m: any) => (
                        <tr key={m.id}>
                          <td className="py-2.5 pr-3 font-mono text-[var(--app-accent)] whitespace-nowrap">{m.id}</td>
                          <td className="py-2.5 pr-4 font-semibold text-[var(--app-text-primary)]">{m.name}</td>
                          <td className="py-2.5 pr-4 font-mono tabular-nums whitespace-nowrap">
                            {m.score !== null ? `${m.score} ${m.unit}` : '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-[var(--app-text-secondary)]">{m.details}</td>
                          <td className="py-2.5 text-right">
                            <StatusDot status={m.status === 'PASS' ? 'VERIFIED' : (m.status as any)} label={m.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {latestEval.baselineComparison && (
                  <div className="pt-4 border-t border-[var(--app-card-border)] grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="text-[var(--app-text-secondary)]">Batch 27 Baseline</div>
                      <div className="font-mono tabular-nums text-[var(--app-text-primary)] mt-0.5">
                        {latestEval.baselineComparison.batch27
                          ? `${latestEval.baselineComparison.batch27.passed}/${latestEval.baselineComparison.batch27.total} passed (${latestEval.baselineComparison.batch27.status})`
                          : 'No baseline file'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--app-text-secondary)]">Batch 28 Baseline</div>
                      <div className="font-mono tabular-nums text-[var(--app-text-primary)] mt-0.5">
                        {latestEval.baselineComparison.batch28
                          ? `${latestEval.baselineComparison.batch28.passedChecks}/${latestEval.baselineComparison.batch28.totalChecks} passed (${latestEval.baselineComparison.batch28.overallStatus})`
                          : 'No baseline file'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--app-text-secondary)]">LM v2 Baseline</div>
                      <div className="font-mono tabular-nums text-[var(--app-text-primary)] mt-0.5">
                        {latestEval.baselineComparison.lmV2
                          ? `PPL ${latestEval.baselineComparison.lmV2.valPerplexity.toFixed(2)} · Top-1 ${(latestEval.baselineComparison.lmV2.top1Accuracy * 100).toFixed(1)}%`
                          : 'No baseline file'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyStateCard
                icon={<Activity className="w-5 h-5" />}
                title="No Batch 29 evaluation report persisted yet"
                description="Run the 12-metric cognitive evaluation suite to generate verifiable runtime metrics, baseline comparisons, and provenance hashes."
                action={
                  <Button variant="primary" disabled={!isDeveloperPlus} loading={busyEval} onClick={() => void handleRunEvaluation()}>
                    Execute Evaluation Suite
                  </Button>
                }
              />
            )}
          </VividCard>

          <VividCard
            title="Zero-Simulation Capability Gates"
            subtitle="Formal completion gates enforced from live runtime provenance, SHA-256 execution hashes, and multimodal probes"
            gradientAccent="cyan"
            variant="midnight"
          >
            {opsData?.capabilityGates?.gates ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.values(opsData.capabilityGates.gates).map((gate: any) => (
                    <div key={gate.gateId} className="p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-[var(--app-text-primary)]">{gate.gateId}</span>
                        <StatusDot
                          status={gate.status as any}
                          label={gate.status}
                        />
                      </div>
                      <p className="text-xs text-[var(--app-text-secondary)]">{gate.reason}</p>
                    </div>
                  ))}
                </div>
                {opsData.capabilityGates.truthSummary && (
                  <div className="text-xs font-mono text-[var(--app-text-secondary)] flex flex-wrap gap-4 pt-2 border-t border-[var(--app-card-border)]">
                    <span>Truth Kernel Claims: {opsData.capabilityGates.truthSummary.total}</span>
                    <span>VERIFIED_FACT: {opsData.capabilityGates.truthSummary.counts?.VERIFIED_FACT ?? 0}</span>
                    <span>UNVERIFIED: {opsData.capabilityGates.truthSummary.counts?.UNVERIFIED ?? 0}</span>
                    <span>Verified Execution Cycles: {opsData.capabilityGates.verifiedExecutionSummary?.verifiedCyclesCount ?? 0}</span>
                  </div>
                )}
              </div>
            ) : (
              <Text size="xs">Capability gates loading…</Text>
            )}
          </VividCard>

          <VividCard
            title="Multimodal Capability Honesty Registry"
            subtitle="Dynamic binary probes across document parsers, vision encoders, audio ASR, and neural speech synthesis"
            gradientAccent="magenta"
            variant="midnight"
          >
            {multimodal?.modalities?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--app-card-border)] text-[var(--app-text-secondary)]">
                      <th className="py-2 pr-4">Modality</th>
                      <th className="py-2 pr-4">Supported Formats</th>
                      <th className="py-2 pr-4">Missing / Blockers</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)]">
                    {multimodal.modalities.map((mod: any) => (
                      <tr key={mod.modality}>
                        <td className="py-2.5 pr-4 font-semibold text-[var(--app-text-primary)]">
                          <div>{mod.label}</div>
                          <div className="text-[11px] font-normal text-[var(--app-text-secondary)] mt-0.5">{mod.notes}</div>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-[var(--app-accent)]">
                          {mod.supportedFormats?.length ? mod.supportedFormats.join(', ') : 'None'}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-[var(--app-text-secondary)]">
                          {mod.missingDependencies?.length ? mod.missingDependencies.join(', ') : 'None'}
                        </td>
                        <td className="py-2.5 text-right">
                          <StatusDot status={mod.status} label={mod.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Text size="xs">Capability registry loading…</Text>
            )}
          </VividCard>
        </div>
      )}
    </PageContainer>
  );
};
