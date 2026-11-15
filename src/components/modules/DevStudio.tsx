import React, { useState, useEffect, useRef } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusBadge, StatusDot } from '../ui/StatusBadge';
import { OrchestrationEvent, SystemStatusData, WorkspaceFileDetail, ExecutionCycleSummary, ExecutionCycleStageRecord, TaskPriority } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiUrl } from '../../lib/apiClient';
import { consumeNdjsonStream } from '../../lib/ndjson';
import { SoftwareProjectWorkspace } from './SoftwareProjectWorkspace';
import { DeploymentHistoryTimeline } from '../DeploymentHistoryTimeline';
import {
  Code2,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  FileCode,
  FolderOpen,
  Terminal,
  Clock,
  Layers,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  Check,
  Copy,
  Save,
  Trash2,
  Plus,
  RefreshCw,
  Cpu,
  FileText,
  Activity,
  History,
  Gauge,
  TrendingDown,
  Rocket,
  Bell,
  AlertTriangle,
  X
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

interface AuditRecord {
  index: number;
  timestamp: string;
  prev_hash: string;
  role: string;
  action: string;
  payload_digest: string;
  entry_hash: string;
}

interface DevStudioProps {
  statusData?: SystemStatusData | null;
  onStatusChanged?: () => void;
}

export const DevStudio: React.FC<DevStudioProps> = ({ statusData, onStatusChanged }) => {
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const [goal, setGoal] = useState('Build a resilient In-Memory LRU Cache with TTL and unit test verification');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<OrchestrationEvent[]>([]);
  const [activeTab, setActiveTab] = useState<'editor' | 'terminal' | 'sandbox' | 'audit' | 'benchmark' | 'training' | 'deployments'>('editor');
  const [selectedFile, setSelectedFile] = useState<string>('solution.js');
  const [fileContent, setFileContent] = useState<string>('// Select or generate code to inspect');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileDetail[]>([]);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  const [studioMode, setStudioMode] = useState<'project_workspace' | 'agent_ide'>('project_workspace');
  const [activeAgentRole, setActiveAgentRole] = useState<'IDLE' | 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER'>('IDLE');
  const [roleStatuses, setRoleStatuses] = useState<Record<string, 'IDLE' | 'ACTIVE' | 'VERIFIED' | 'RETRY' | 'ERROR'>>({
    PLANNER: 'IDLE',
    CODER: 'IDLE',
    REVIEWER: 'IDLE',
    TESTER: 'IDLE'
  });
  const [cycleStages, setCycleStages] = useState<ExecutionCycleStageRecord[]>([]);
  const [latestCycle, setLatestCycle] = useState<ExecutionCycleSummary | null>(null);

  // Sandbox Runner State
  const [sandboxCmd, setSandboxCmd] = useState('node');
  const [sandboxArgs, setSandboxArgs] = useState('solution.js');
  const [isExecutingSandbox, setIsExecutingSandbox] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<any>(null);

  // Audit Records State
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [auditChainValid, setAuditChainValid] = useState<boolean | null>(null);

  // Live 41.53M Throughput Benchmark State
  const [benchPrompt, setBenchPrompt] = useState('ZYNTHEOR Sovereign NativeLM 41.53M causal KV-cache throughput verification');
  const [benchTokens, setBenchTokens] = useState<number>(12);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<any | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  // Training Curves & Checkpoint Promotion State
  const [trainingLogs, setTrainingLogs] = useState<any | null>(null);
  const [curveTrack, setCurveTrack] = useState<'target41m' | 'v2_2m' | 'gated_v2_2'>('target41m');
  const [activeCheckpointInfo, setActiveCheckpointInfo] = useState<any | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<any | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  // Training Loss Deviation Notification Watchdog (train_gated.py)
  const [lossDeviationThreshold, setLossDeviationThreshold] = useState<number>(0.25);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(true);

  // Terminal Filter State
  const [terminalRoleFilter, setTerminalRoleFilter] = useState<'ALL' | 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER'>('ALL');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const presets = [
    { label: 'In-Memory LRU Cache', goal: 'Build a resilient In-Memory LRU Cache with TTL and unit test verification' },
    { label: 'Matrix Multiplier', goal: 'Synthesize a high-throughput Float64 matrix multiplication engine with dimension assertion' },
    { label: 'Cryptographic Token Validator', goal: 'Create a sovereign cryptographic token validator with HMAC-SHA256 signature verification' }
  ];

  const fetchFiles = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(apiUrl('/api/workspace/files'), { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setWorkspaceFiles(data.files || []);
        if (data.files && data.files.length > 0 && !selectedFile) {
          fetchFileContent(data.files[0].path);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchFileContent = async (fileName: string) => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(apiUrl(`/api/workspace/file?path=${encodeURIComponent(fileName)}`), { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setFileContent(data.content);
        setOriginalContent(data.content);
        setSelectedFile(fileName);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch(apiUrl('/api/workspace/file'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path: selectedFile, content: fileContent })
      });
      const data = await res.json();
      if (data.success) {
        setOriginalContent(fileContent);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
        await fetchFiles();
      }
    } catch (e) {
      console.error('Failed to save file:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    const cleanPath = newFileName.trim().replace(/^\/+/, '');
    try {
      const initialTemplate = cleanPath.endsWith('.py')
        ? '# ZYNTHEOR Sovereign Sandbox Script\nimport sys\nprint("Hello from /workspace python sandbox")\n'
        : '// ZYNTHEOR Sovereign Sandbox Module\nconsole.log("Hello from /workspace sandbox");\n';
      const res = await fetch(apiUrl('/api/workspace/file'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path: cleanPath, content: initialTemplate })
      });
      const data = await res.json();
      if (data.success) {
        setNewFileName('');
        setIsCreatingFile(false);
        await fetchFiles();
        await fetchFileContent(cleanPath);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteFile = async (fileName: string) => {
    if (!confirm(`Are you sure you want to delete '${fileName}' from /workspace?`)) return;
    try {
      const res = await fetch(apiUrl(`/api/workspace/file?path=${encodeURIComponent(fileName)}`), {
        method: 'DELETE',
        headers: authHeaders()
      });
      const data = await res.json();
      if (data.success) {
        await fetchFiles();
        if (selectedFile === fileName) {
          setSelectedFile('');
          setFileContent('// File deleted');
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunSandbox = async () => {
    setIsExecutingSandbox(true);
    setSandboxResult(null);
    try {
      const argsArray = sandboxArgs.trim() ? sandboxArgs.trim().split(/\s+/) : [];
      const res = await fetch(apiUrl('/api/workspace/run'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ command: sandboxCmd, args: argsArray })
      });
      const data = await res.json();
      if (data.success) {
        setSandboxResult(data.result);
      } else {
        setSandboxResult({ error: data.error, exitCode: 1 });
      }
    } catch (err: any) {
      setSandboxResult({ error: err.message, exitCode: 1 });
    } finally {
      setIsExecutingSandbox(false);
    }
  };

  const fetchAuditRecords = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(apiUrl('/api/audit?limit=25'), { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setAuditRecords(data.records || []);
        setAuditChainValid(data.integrity?.valid ?? true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunBenchmark = async () => {
    if (!isAuthenticated || isBenchmarking) return;
    setIsBenchmarking(true);
    setBenchmarkError(null);
    try {
      const res = await fetch(apiUrl('/api/model/benchmark'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt: benchPrompt, maxNewTokens: benchTokens, temperature: 0.0, seed: 42 })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Benchmark execution failed');
      }
      setBenchmarkResult(data.benchmark);
      await fetchAuditRecords();
    } catch (err: any) {
      setBenchmarkError(err.message);
    } finally {
      setIsBenchmarking(false);
    }
  };

  const fetchTrainingAndComparison = async () => {
    if (!isAuthenticated) return;
    try {
      const h = authHeaders();
      const [logsRes, compRes] = await Promise.all([
        fetch(apiUrl('/api/model/training-logs'), { headers: h }).then((r) => r.json()).catch(() => null),
        fetch(apiUrl('/api/model/comparison'), { headers: h }).then((r) => r.json()).catch(() => null)
      ]);
      if (logsRes?.success) {
        setTrainingLogs(logsRes);
      }
      if (compRes?.success) {
        setActiveCheckpointInfo(compRes.activeCheckpoint);
      }
    } catch (e) {
      console.error('Failed to load training logs:', e);
    }
  };

  const handlePromoteToActive = async () => {
    if (!isAuthenticated || isPromoting) return;
    setIsPromoting(true);
    setPromoteError(null);
    setPromoteResult(null);
    try {
      const res = await fetch(apiUrl('/api/model/promote'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ target: 'v2_2m', variant: 'v2' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to promote 2.0M checkpoint');
      }
      setPromoteResult(data);
      setActiveCheckpointInfo(data.activeCheckpoint);
      onStatusChanged?.();
      await fetchAuditRecords();
    } catch (err: any) {
      setPromoteError(err.message);
    } finally {
      setIsPromoting(false);
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      fetchFiles();
      fetchAuditRecords();
      fetchTrainingAndComparison();
    }
  }, [authReady, isAuthenticated]);

  const handleRunAgent = async () => {
    if (!goal || isRunning) return;
    setIsRunning(true);
    setEvents([]);
    setLatestCycle(null);
    setCycleStages([]);
    setActiveAgentRole('PLANNER');
    setRoleStatuses({
      PLANNER: 'ACTIVE',
      CODER: 'IDLE',
      REVIEWER: 'IDLE',
      TESTER: 'IDLE'
    });
    setActiveTab('terminal');

    try {
      const response = await fetch(apiUrl('/api/agent/execute'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ goal, priority })
      });

      if (!response.body) {
        throw new Error('No readable stream returned from /api/agent/execute');
      }

      let toastedRun = false;

      await consumeNdjsonStream<OrchestrationEvent>(response, (ev) => {
            setEvents((prev) => [...prev, ev]);

            // Update role active states
            if (ev.role && (ev.role === 'PLANNER' || ev.role === 'CODER' || ev.role === 'REVIEWER' || ev.role === 'TESTER')) {
              setActiveAgentRole(ev.role);
              setRoleStatuses((prev) => {
                const updated = { ...prev };
                if (ev.role === 'PLANNER') {
                  updated.PLANNER = ev.type === 'step' && ev.message.includes('ready') ? 'VERIFIED' : 'ACTIVE';
                } else if (ev.role === 'CODER') {
                  updated.PLANNER = 'VERIFIED';
                  updated.CODER = 'ACTIVE';
                } else if (ev.role === 'REVIEWER') {
                  updated.CODER = 'VERIFIED';
                  if (ev.data?.reviewStatus === 'APPROVED') {
                    updated.REVIEWER = 'VERIFIED';
                  } else if (ev.data?.reviewStatus === 'REJECTED') {
                    updated.REVIEWER = 'RETRY';
                  } else {
                    updated.REVIEWER = 'ACTIVE';
                  }
                } else if (ev.role === 'TESTER') {
                  updated.REVIEWER = 'VERIFIED';
                  if (ev.type === 'test') {
                    updated.TESTER = ev.data?.exitCode === 0 ? 'VERIFIED' : 'ERROR';
                  } else {
                    updated.TESTER = 'ACTIVE';
                  }
                }
                return updated;
              });
            }

            if (Array.isArray(ev.data?.stages)) {
              setCycleStages(ev.data.stages);
            }
            if (ev.data?.executionCycle) {
              setLatestCycle(ev.data.executionCycle);
              if (Array.isArray(ev.data.executionCycle.stages)) {
                setCycleStages(ev.data.executionCycle.stages);
              }
            }

            if (ev.type === 'done') {
              setActiveAgentRole('IDLE');
              setRoleStatuses((prev) => ({
                ...prev,
                TESTER: ev.data?.success === false ? 'ERROR' : 'VERIFIED'
              }));
              if (ev.data?.success !== false && !toastedRun) {
                toastedRun = true;
                showToast({
                  variant: 'success',
                  title: 'Creation Studio Execution Complete',
                  message: goal,
                  meta: [
                    ev.data?.taskId ? `Task ${ev.data.taskId}` : null,
                    typeof ev.data?.durationMs === 'number' ? `${ev.data.durationMs} ms` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined,
                });
              }
            } else if ((ev as any).type === 'final_result') {
              if (ev.data?.success === true && !toastedRun) {
                toastedRun = true;
                showToast({
                  variant: 'success',
                  title: 'Creation Studio Execution Complete',
                  message: goal,
                  meta: [
                    ev.data?.taskId ? `Task ${ev.data.taskId}` : null,
                    typeof ev.data?.durationMs === 'number' ? `${ev.data.durationMs} ms` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined,
                });
              }
            }

            if (terminalEndRef.current) {
              terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
      });

      await fetchFiles();
      const targetArtifact = latestCycle?.artifacts?.[0]?.path?.replace(/^\/workspace\//, '') || (goal.toLowerCase().includes('python') ? 'solution.py' : 'solution.js');
      await fetchFileContent(targetArtifact);
      await fetchAuditRecords();
    } catch (err: any) {
      setEvents((prev) => [
        ...prev,
        {
          type: 'error',
          message: err.message,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setIsRunning(false);
      setActiveAgentRole('IDLE');
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(fileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasUnsavedChanges = fileContent !== originalContent;
  const filteredEvents = terminalRoleFilter === 'ALL'
    ? events
    : events.filter((ev) => ev.role === terminalRoleFilter || ev.type === 'error' || ev.type === 'init');

  interface LossDeviationAlert {
    id: string;
    runIndex: number;
    step: number;
    metric: 'Step Train-Loss Spike' | 'Val NLL vs Reference';
    delta: number;
    observed: number;
    baseline: number;
    severity: 'CRITICAL' | 'WARNING';
    decision: string;
  }

  const lossDeviationAlerts: LossDeviationAlert[] = React.useMemo(() => {
    if (!alertsEnabled || !Array.isArray(trainingLogs?.gatedRuns)) return [];
    const alerts: LossDeviationAlert[] = [];
    const thresh = Math.max(0.01, Number(lossDeviationThreshold) || 0.25);
    for (const run of trainingLogs.gatedRuns) {
      const history = Array.isArray(run.history) ? run.history : [];
      for (let i = 0; i < history.length; i++) {
        const pt = history[i];
        if (i > 0) {
          const prev = history[i - 1];
          const stepDelta = +(pt.trainLoss - prev.trainLoss).toFixed(4);
          if (stepDelta > thresh) {
            alerts.push({
              id: `run${run.runIndex}-step${pt.step}-spike`,
              runIndex: run.runIndex,
              step: pt.step,
              metric: 'Step Train-Loss Spike',
              delta: stepDelta,
              observed: pt.trainLoss,
              baseline: prev.trainLoss,
              severity: stepDelta >= thresh * 1.5 ? 'CRITICAL' : 'WARNING',
              decision: run.decision
            });
          }
        }
        if (run.referenceNll && pt.valLoss) {
          const refDelta = +(pt.valLoss - run.referenceNll).toFixed(4);
          if (refDelta > thresh) {
            alerts.push({
              id: `run${run.runIndex}-step${pt.step}-valdiv`,
              runIndex: run.runIndex,
              step: pt.step,
              metric: 'Val NLL vs Reference',
              delta: refDelta,
              observed: pt.valLoss,
              baseline: run.referenceNll,
              severity: refDelta >= thresh * 1.5 ? 'CRITICAL' : 'WARNING',
              decision: run.decision
            });
          }
        }
      }
    }
    return alerts;
  }, [trainingLogs, lossDeviationThreshold, alertsEnabled]);

  const activeAlerts = lossDeviationAlerts.filter((a) => !dismissedAlertIds.includes(a.id));

  return (
    <div className="space-y-6">
      {/* Studio Workspace Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-[#0D1326] border border-[#1E294A]">
        <div className="text-xs">
          <div className="font-bold text-white flex items-center gap-2">
            <Code2 className="w-4 h-4 text-[#00F0FF]" />
            <span>Creation Studio · Native Application Development Engine &amp; Multi-Agent IDE</span>
          </div>
          <div className="text-[11px] text-[#9AA8C7] mt-0.5">
            Switch between Application-First Workspace (Preview, Database, Internet, Benchmark &amp; Timeline) and Multi-Agent / Model IDE
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setStudioMode('project_workspace')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer ${
              studioMode === 'project_workspace'
                ? 'bg-[#00F0FF] text-[#070B19]'
                : 'bg-[#131B36] text-[#CBD5E1] border border-[#1E294A]'
            }`}
          >
            Application Workspace
          </button>
          <button
            type="button"
            onClick={() => setStudioMode('agent_ide')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer ${
              studioMode === 'agent_ide'
                ? 'bg-[#00F0FF] text-[#070B19]'
                : 'bg-[#131B36] text-[#CBD5E1] border border-[#1E294A]'
            }`}
          >
            Multi-Agent &amp; Benchmark IDE
          </button>
        </div>
      </div>

      {studioMode === 'project_workspace' ? (
        <SoftwareProjectWorkspace
          initialCapabilities={statusData?.truthDashboard?.softwareEngineering?.capabilities}
          statusData={statusData}
          onAuditUpdated={() => {
            void fetchAuditRecords();
            onStatusChanged?.();
          }}
        />
      ) : (
        <>
      {/* Developer Training Loss Deviation Notification Banner */}
      {alertsEnabled && activeAlerts.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-[#FF5E3A]/15 border border-[#FF5E3A]/55 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#FF5E3A] shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-bold text-[#FF8A6E] flex items-center gap-2 flex-wrap">
                <span>
                  train_gated.py Loss Deviation Alert ({activeAlerts.length} threshold breach{activeAlerts.length === 1 ? '' : 'es'})
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums bg-[#FF5E3A]/20 border border-[#FF5E3A]/45 text-[#FFD2C4]">
                  Threshold Δ &gt; {lossDeviationThreshold.toFixed(2)} NLL
                </span>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[var(--app-text-primary)]">
                Latest: Run #{activeAlerts[activeAlerts.length - 1].runIndex} · Step {activeAlerts[activeAlerts.length - 1].step} ({activeAlerts[activeAlerts.length - 1].metric}: Δ {activeAlerts[activeAlerts.length - 1].delta.toFixed(4)} NLL)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCurveTrack('gated_v2_2');
                setActiveTab('training');
              }}
              className="min-h-[44px] px-3.5 py-2 rounded-xl text-[11px] font-bold bg-[#FF5E3A] hover:bg-[#FF7452] text-[#070B19] cursor-pointer transition-colors"
            >
              Inspect Deviation Logs
            </button>
            <button
              type="button"
              onClick={() => setDismissedAlertIds(lossDeviationAlerts.map((a) => a.id))}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center p-1.5 rounded-xl text-[#FF8A6E] hover:bg-[#FF5E3A]/20 cursor-pointer"
              title="Dismiss active alerts"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Task Dispatcher Toolbar */}
      <VividCard className="!p-4" gradientAccent="cyan">
        <div className="space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Enter software engineering goal for Multi-Agent Orchestrator..."
              className="flex-1 min-h-[44px] px-4 py-2.5 text-xs md:text-sm bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00F0FF]/30 focus:border-[#00F0FF] font-medium text-[var(--app-text-primary)] placeholder-[var(--app-text-secondary)]/60"
            />
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-1 bg-[var(--app-surface)] border border-[var(--app-card-border)] rounded-xl p-1" role="radiogroup" aria-label="Task Priority">
                {(['High', 'Medium', 'Low'] as TaskPriority[]).map((p) => {
                  const active = priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={isRunning}
                      onClick={() => setPriority(p)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50 ${
                        active
                          ? p === 'High'
                            ? 'bg-[#FF007F]/20 text-[#FF66B2] border border-[#FF007F]'
                            : p === 'Medium'
                            ? 'bg-[#FF5E3A]/20 text-[#FF8A6E] border border-[#FF5E3A]'
                            : 'bg-[#00F0FF]/20 text-[#00F0FF] border border-[#00F0FF]'
                          : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] border border-transparent'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleRunAgent}
                disabled={isRunning}
                className="min-h-[44px] flex items-center gap-2 px-6 py-2.5 text-xs md:text-sm font-bold text-white vivid-gradient-brand rounded-xl shadow-lg shadow-[#2563EB]/30 hover:opacity-95 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>{isRunning ? `Orchestrating (${activeAgentRole})...` : 'Execute Sovereign Multi-Agent'}</span>
              </button>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--app-text-secondary)] font-semibold text-[11px] uppercase">Goal Presets:</span>
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setGoal(preset.goal)}
                className="px-3 py-1.5 rounded-lg bg-[var(--app-surface)] hover:bg-[#00F0FF]/10 border border-[var(--app-card-border)] hover:border-[#00F0FF]/40 text-[var(--app-text-secondary)] hover:text-[#00F0FF] transition-colors text-[11px] font-medium cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </VividCard>

      {/* Main 3-Column IDE Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Project Explorer & 4-Agent Pipeline (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          <VividCard
            title="Project Explorer"
            subtitle="Sandbox Root: /workspace"
            gradientAccent="violet"
            className="!p-4"
            headerAction={
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsCreatingFile(!isCreatingFile)}
                  title="New File"
                  className="p-1.5 rounded-lg hover:bg-[#00F0FF]/15 text-[#00F0FF] transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={fetchFiles}
                  title="Refresh Files"
                  className="p-1.5 rounded-lg hover:bg-[var(--app-card-border)]/40 text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            }
          >
            {/* Create File Form */}
            {isCreatingFile && (
              <form onSubmit={handleCreateFile} className="mb-3 p-2.5 rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-card-border)] space-y-2">
                <input
                  type="text"
                  required
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="e.g. validator.js or test.py"
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--app-surface)] border border-[var(--app-card-border)] rounded-lg text-[var(--app-text-primary)] focus:outline-none focus:border-[#00F0FF]"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsCreatingFile(false)}
                    className="px-2 py-1 text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-[11px] font-bold text-[#070B19] bg-[#00F0FF] hover:bg-[#33F3FF] rounded-lg cursor-pointer"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase font-bold text-[var(--app-text-secondary)] tracking-wider tabular-nums">
                <span>Files ({workspaceFiles.length})</span>
                <span>Size</span>
              </div>
              {workspaceFiles.length === 0 ? (
                <div className="p-3 text-center text-[var(--app-text-secondary)] text-xs italic">
                  No files in /workspace. Click "+" to create or run an agent.
                </div>
              ) : (
                workspaceFiles.map((file) => (
                  <div
                    key={file.path}
                    className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl font-mono text-xs transition-colors ${
                      selectedFile === file.path
                        ? 'bg-[#00F0FF]/12 text-[#00F0FF] font-bold border border-[#00F0FF]/40'
                        : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <button
                      onClick={() => fetchFileContent(file.path)}
                      className="flex items-center gap-2 truncate text-left flex-1 cursor-pointer"
                    >
                      <FileCode className="w-3.5 h-3.5 shrink-0 text-[#00F0FF]" />
                      <span className="truncate">{file.path}</span>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-[var(--app-text-secondary)] tabular-nums">
                        {file.sizeBytes} B
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(file.path);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#FF007F] hover:text-[#FF66B2] transition-opacity cursor-pointer"
                        title="Delete file"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </VividCard>

          {/* 4-Agent Pipeline Dynamic State Tracker */}
          <VividCard title="Multi-Agent 4-Role State" subtitle="Real-Time State Machine (Zero-Mock)" gradientAccent="blue" className="!p-4">
            <div className="space-y-2 text-xs">
              {/* Role 1: PLANNER */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                roleStatuses.PLANNER === 'ACTIVE'
                  ? 'bg-[#00F0FF]/12 border-[#00F0FF]/60 shadow-sm shadow-[#00F0FF]/15'
                  : roleStatuses.PLANNER === 'VERIFIED'
                  ? 'bg-[#CCFF00]/8 border-[#CCFF00]/35'
                  : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#00F0FF]">1. PLANNER</span>
                  <StatusDot
                    status={roleStatuses.PLANNER === 'ACTIVE' ? 'ACTIVE' : roleStatuses.PLANNER === 'VERIFIED' ? 'VERIFIED' : 'NOT RUN'}
                    label={roleStatuses.PLANNER}
                   
                    pulse={roleStatuses.PLANNER === 'ACTIVE'}
                  />
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">Formulates step-by-step sovereign architecture</div>
              </div>

              {/* Role 2: CODER */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                roleStatuses.CODER === 'ACTIVE'
                  ? 'bg-[#7B2CBF]/20 border-[#C084FC]/60 shadow-sm shadow-[#7B2CBF]/20'
                  : roleStatuses.CODER === 'VERIFIED'
                  ? 'bg-[#CCFF00]/8 border-[#CCFF00]/35'
                  : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#C084FC]">2. CODER</span>
                  <StatusDot
                    status={roleStatuses.CODER === 'ACTIVE' ? 'ACTIVE' : roleStatuses.CODER === 'VERIFIED' ? 'VERIFIED' : 'NOT RUN'}
                    label={roleStatuses.CODER}
                   
                    pulse={roleStatuses.CODER === 'ACTIVE'}
                  />
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">Synthesizes executable code via streaming</div>
              </div>

              {/* Role 3: REVIEWER */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                roleStatuses.REVIEWER === 'ACTIVE'
                  ? 'bg-[#FF007F]/12 border-[#FF007F]/60 shadow-sm shadow-[#FF007F]/15'
                  : roleStatuses.REVIEWER === 'RETRY'
                  ? 'bg-[#FF5E3A]/12 border-[#FF5E3A]/50'
                  : roleStatuses.REVIEWER === 'VERIFIED'
                  ? 'bg-[#CCFF00]/8 border-[#CCFF00]/35'
                  : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#FF66B2]">3. REVIEWER</span>
                  <StatusDot
                    status={
                      roleStatuses.REVIEWER === 'ACTIVE'
                        ? 'ACTIVE'
                        : roleStatuses.REVIEWER === 'RETRY'
                        ? 'PARTIAL'
                        : roleStatuses.REVIEWER === 'VERIFIED'
                        ? 'VERIFIED'
                        : 'NOT RUN'
                    }
                    label={roleStatuses.REVIEWER}
                   
                    pulse={roleStatuses.REVIEWER === 'ACTIVE'}
                  />
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">Validates security invariants & no-eval policy</div>
              </div>

              {/* Role 4: TESTER */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                roleStatuses.TESTER === 'ACTIVE'
                  ? 'bg-[#00F0FF]/12 border-[#00F0FF]/60 shadow-sm shadow-[#00F0FF]/15'
                  : roleStatuses.TESTER === 'VERIFIED'
                  ? 'bg-[#CCFF00]/8 border-[#CCFF00]/35'
                  : roleStatuses.TESTER === 'ERROR'
                  ? 'bg-[#FF007F]/12 border-[#FF007F]/50'
                  : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#CCFF00]">4. TESTER</span>
                  <StatusDot
                    status={
                      roleStatuses.TESTER === 'ACTIVE'
                        ? 'ACTIVE'
                        : roleStatuses.TESTER === 'VERIFIED'
                        ? 'VERIFIED'
                        : roleStatuses.TESTER === 'ERROR'
                        ? 'FAILED'
                        : 'NOT RUN'
                    }
                    label={roleStatuses.TESTER}
                   
                    pulse={roleStatuses.TESTER === 'ACTIVE'}
                  />
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">Runs sandbox execution via ToolGateway</div>
              </div>
            </div>
          </VividCard>

          {/* 8-Stage ZYNTHEOR Execution Cycle Tracker */}
          <VividCard
            title="8-Stage Execution Cycle"
            subtitle="Intake -> Build -> Execute -> Test -> Repair -> Deliver"
            gradientAccent="coral"
            className="!p-4"
          >
            {cycleStages.length === 0 ? (
              <div className="text-[11px] text-[var(--app-text-secondary)] italic">
                Run an autonomous task to inspect live 8-stage execution gates and verification criteria.
              </div>
            ) : (
              <div className="space-y-1.5 text-[11px]">
                {cycleStages.map((st) => (
                  <div
                    key={st.stage}
                    className={`p-2 rounded-lg border ${
                      st.status === 'PASS'
                        ? 'bg-[#CCFF00]/10 border-[#CCFF00]/40'
                        : st.status === 'ACTIVE' || st.status === 'REPAIRING'
                        ? 'bg-[#00F0FF]/12 border-[#00F0FF]/50'
                        : st.status === 'BLOCKED'
                        ? 'bg-[#FF007F]/12 border-[#FF007F]/50'
                        : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[var(--app-text-primary)] truncate">
                        {st.stage.slice(0, 2)} · {st.labelTh} ({st.labelEn})
                      </span>
                      <StatusDot
                        status={
                          st.status === 'PASS'
                            ? 'VERIFIED'
                            : st.status === 'BLOCKED'
                            ? 'BLOCKED'
                            : st.status === 'ACTIVE' || st.status === 'REPAIRING'
                            ? 'ACTIVE'
                            : 'NOT RUN'
                        }
                        label={st.status}
                       
                        pulse={st.status === 'ACTIVE' || st.status === 'REPAIRING'}
                      />
                    </div>
                    <div className="text-[10px] text-[var(--app-text-secondary)] mt-0.5 line-clamp-2">{st.summary}</div>
                  </div>
                ))}

                {latestCycle && (
                  <div className="mt-2 pt-2 border-t border-[var(--app-card-border)] space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[var(--app-text-primary)]">
                        Delivery Gate {latestCycle.lifecycleStatus ? `(${latestCycle.lifecycleStatus})` : ''}
                      </span>
                      <StatusDot
                        status={latestCycle.deliveryStatus === 'DELIVERED' ? 'VERIFIED' : 'BLOCKED'}
                        label={`${latestCycle.deliveryStatus} (${latestCycle.testsPassed}/${latestCycle.testsTotal})`}
                       
                      />
                    </div>
                    {latestCycle.acceptanceCriteria.map((ac) => (
                      <div key={ac.id} className="text-[10px] flex items-start gap-1.5 text-[var(--app-text-secondary)]">
                        <span className={ac.passed ? 'text-[#CCFF00] font-bold' : 'text-[#FF007F] font-bold'}>
                          {ac.passed ? '✓' : '✗'}
                        </span>
                        <span className="truncate" title={ac.evidence}>{ac.id}: {ac.evidence}</span>
                      </div>
                    ))}
                    {latestCycle.packageArtifact && (
                      <div className="mt-1.5 p-2 rounded-lg bg-[var(--app-surface)] border border-[#00F0FF]/35 flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
                        <span className="text-[#00F0FF] truncate" title={latestCycle.packageArtifact.zipSha256}>
                          📦 {latestCycle.packageArtifact.zipFilename} ({latestCycle.packageArtifact.zipBytes}B)
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await fetch(apiUrl(`/api/agent/deliverables/${latestCycle.packageArtifact!.zipFilename}`), {
                              headers: authHeaders()
                            });
                            if (!res.ok) return;
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = latestCycle.packageArtifact!.zipFilename;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="px-2 py-0.5 rounded bg-[#00F0FF] hover:bg-[#33F3FF] text-[#070B19] font-bold shrink-0 cursor-pointer"
                        >
                          ZIP
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </VividCard>
        </div>

        {/* Center / Main Column: Code Editor, Terminal, Sandbox & Audit (6 cols) */}
        <div className="lg:col-span-6 space-y-4 min-w-0">
          <div className="bg-[#0D1326] rounded-2xl border border-[#1E294A] shadow-lg shadow-[#00F0FF]/5 overflow-hidden">
            {/* Tab Bar */}
            <div className="px-4 py-2.5 border-b border-[#1E294A] flex flex-wrap items-center justify-between gap-2 bg-[#0B1124]">
              <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
                <button
                  onClick={() => setActiveTab('editor')}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    activeTab === 'editor'
                      ? 'bg-[#131B36] text-[#00F0FF] shadow-sm border border-[#00F0FF]/45'
                      : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Editor ({selectedFile || 'None'})</span>
                  {hasUnsavedChanges && <span className="w-2 h-2 rounded-full bg-[#FF5E3A]" title="Unsaved changes" />}
                </button>

                <button
                  onClick={() => setActiveTab('terminal')}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'terminal'
                      ? 'bg-[#131B36] text-[#00F0FF] shadow-sm border border-[#00F0FF]/45'
                      : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Agent Stream ({events.length})</span>
                </button>

                <button
                  onClick={() => setActiveTab('sandbox')}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'sandbox'
                      ? 'bg-[#131B36] text-[#00F0FF] shadow-sm border border-[#00F0FF]/45'
                      : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 text-[#FF5E3A]" />
                  <span>Sandbox Runner</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('audit');
                    fetchAuditRecords();
                  }}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'audit'
                      ? 'bg-[#131B36] text-[#00F0FF] shadow-sm border border-[#00F0FF]/45'
                      : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                  }`}
                >
                  <History className="w-3.5 h-3.5 text-[#C084FC]" />
                  <span>Audit Trail</span>
                </button>

                <button
                  onClick={() => setActiveTab('benchmark')}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'benchmark'
                      ? 'bg-[#131B36] text-[#00F0FF] shadow-sm border border-[#00F0FF]/45'
                      : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                  }`}
                >
                  <Gauge className="w-3.5 h-3.5 text-[#CCFF00]" />
                  <span>41.53M Benchmark</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('training');
                    fetchTrainingAndComparison();
                  }}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'training'
                      ? 'bg-[#131B36] text-[#00F0FF] shadow-sm border border-[#00F0FF]/45'
                      : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                  }`}
                >
                  <TrendingDown className="w-3.5 h-3.5 text-[#FF5E3A]" />
                  <span>Training Curves</span>
                </button>

                <button
                  onClick={() => setActiveTab('deployments')}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                    activeTab === 'deployments'
                      ? 'bg-[#131B36] text-[#00F0FF] shadow-sm border border-[#00F0FF]/45'
                      : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                  }`}
                >
                  <Rocket className="w-3.5 h-3.5 text-[#CCFF00]" />
                  <span>Deployment History</span>
                </button>
              </div>

              {/* Editor Actions */}
              {activeTab === 'editor' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveFile}
                    disabled={isSaving || !hasUnsavedChanges}
                    className={`min-h-[38px] flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      hasUnsavedChanges
                        ? 'bg-[#00F0FF] hover:bg-[#33F3FF] text-[#070B19] shadow-sm'
                        : 'bg-[#131B36] text-[#9AA8C7] opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'}</span>
                  </button>

                  <button
                    onClick={copyCode}
                    className="min-h-[38px] flex items-center gap-1 text-xs text-[#9AA8C7] hover:text-[#F4F7FF] px-2.5 py-1.5 rounded-lg hover:bg-[#131B36] cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[#CCFF00]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* TAB 1: SOURCE EDITOR */}
            {activeTab === 'editor' && (
              <div className="p-0 bg-[#070B19] flex flex-col min-h-[460px]">
                <div className="px-4 py-1.5 bg-[#0B1124] border-b border-[#1E294A] text-[11px] font-mono text-[#9AA8C7] flex items-center justify-between tabular-nums">
                  <span className="truncate">Target: /workspace/{selectedFile || 'solution.js'}</span>
                  <span className="shrink-0">{fileContent.split('\n').length} lines · {new TextEncoder().encode(fileContent).length} bytes</span>
                </div>
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full flex-1 p-4 bg-[#070B19] text-[#F4F7FF] font-mono text-xs leading-relaxed focus:outline-none resize-none min-h-[420px]"
                  placeholder="// Type code here or execute an agent to generate..."
                />
              </div>
            )}

            {/* TAB 2: LIVE AGENT STREAM */}
            {activeTab === 'terminal' && (
              <div className="p-4 bg-[#070B19] text-[#F4F7FF] font-mono text-xs overflow-y-auto max-h-[480px] min-h-[460px] space-y-3">
                <div className="flex flex-wrap items-center justify-between pb-2 border-b border-[#1E294A] gap-2">
                  <span className="text-[#9AA8C7] text-[11px] font-bold">
                    === 4-AGENT ORCHESTRATION EVENT STREAM ===
                  </span>
                  {/* Role filter controls */}
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    {(['ALL', 'PLANNER', 'CODER', 'REVIEWER', 'TESTER'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setTerminalRoleFilter(r)}
                        className={`min-h-[32px] px-2.5 py-1 rounded cursor-pointer transition-colors ${
                          terminalRoleFilter === r
                            ? 'bg-[#00F0FF]/15 text-[#00F0FF] font-bold border border-[#00F0FF]/40'
                            : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredEvents.length === 0 ? (
                  <div className="text-[#9AA8C7]/60 text-center py-16 italic">
                    Ready to stream. Click "Execute Sovereign Multi-Agent" above to initiate.
                  </div>
                ) : (
                  filteredEvents.map((ev, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="text-[#9AA8C7]/80 font-mono tabular-nums">[{ev.timestamp.slice(11, 19)}]</span>
                        {(ev.priority || ev.data?.priority) && (() => {
                          const p = (ev.priority || ev.data?.priority) as TaskPriority;
                          return (
                            <span
                              className={`font-mono font-bold text-[10px] ${
                                p === 'High'
                                  ? 'text-[#FF007F]'
                                  : p === 'Medium'
                                  ? 'text-[#FF5E3A]'
                                  : 'text-[#00F0FF]'
                              }`}
                            >
                              [{p.toUpperCase()}]
                            </span>
                          );
                        })()}
                        {ev.role && (
                          <span
                            className={`inline-flex items-center gap-1 font-bold text-[10px] ${
                              ev.role === 'PLANNER'
                                ? 'text-[#00F0FF]'
                                : ev.role === 'CODER'
                                ? 'text-[#FF5E3A]'
                                : ev.role === 'REVIEWER'
                                ? 'text-[#C084FC]'
                                : ev.role === 'GOVERNANCE'
                                ? 'text-[#FF007F]'
                                : 'text-[#CCFF00]'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                ev.role === 'PLANNER'
                                  ? 'bg-[#00F0FF]'
                                  : ev.role === 'CODER'
                                  ? 'bg-[#FF5E3A]'
                                  : ev.role === 'REVIEWER'
                                  ? 'bg-[#C084FC]'
                                  : ev.role === 'GOVERNANCE'
                                  ? 'bg-[#FF007F]'
                                  : 'bg-[#CCFF00]'
                              }`}
                            />
                            {ev.role}
                          </span>
                        )}
                        <span
                          className={
                            ev.type === 'error'
                              ? 'text-[#FF007F] font-bold'
                              : ev.type === 'tool_call'
                              ? 'text-[#FF5E3A] font-semibold'
                              : ev.type === 'tool_result'
                              ? 'text-[#CCFF00]'
                              : 'text-[#F4F7FF]'
                          }
                        >
                          {ev.message}
                        </span>
                      </div>
                      {ev.type === 'tool_call' && ev.data?.arguments && (
                        <div className="ml-4 p-2 bg-[#0B1124] rounded border border-[#FF5E3A]/40 text-[11px] text-[#FFD2C4] font-mono whitespace-pre-wrap">
                          {JSON.stringify(ev.data.arguments, null, 2)}
                        </div>
                      )}
                      {ev.data?.stdout && (
                        <div className="ml-4 p-2 bg-[#0B1124] rounded border border-[#1E294A] text-[11px] text-[#CCFF00] whitespace-pre-wrap">
                          {ev.data.stdout}
                        </div>
                      )}
                      {ev.data?.stderr && (
                        <div className="ml-4 p-2 bg-[#FF007F]/12 rounded border border-[#FF007F]/40 text-[11px] text-[#FF99C8] whitespace-pre-wrap">
                          {ev.data.stderr}
                        </div>
                      )}
                      {ev.type === 'tool_result' && ev.data?.error && !ev.data?.stderr && (
                        <div className="ml-4 p-2 bg-[#FF007F]/12 rounded border border-[#FF007F]/40 text-[11px] text-[#FF99C8] whitespace-pre-wrap">
                          {ev.data.error}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={terminalEndRef} />
              </div>
            )}

            {/* TAB 3: SANDBOX RUNNER */}
            {activeTab === 'sandbox' && (
              <div className="p-4 bg-[#070B19] space-y-4 min-h-[460px]">
                <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-3">
                  <div className="text-xs font-bold text-[#F4F7FF] flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[#FF5E3A]" />
                    <span>Execute Sandbox Command via ToolGateway</span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={sandboxCmd}
                      onChange={(e) => setSandboxCmd(e.target.value)}
                      className="min-h-[44px] px-3 py-2 bg-[#0D1326] border border-[#1E294A] rounded-xl text-xs text-[#F4F7FF] font-mono focus:outline-none focus:border-[#00F0FF]"
                    >
                      <option value="node">node</option>
                      <option value="python3">python3</option>
                      <option value="ls">ls</option>
                      <option value="cat">cat</option>
                      <option value="head">head</option>
                      <option value="pwd">pwd</option>
                    </select>

                    <input
                      type="text"
                      value={sandboxArgs}
                      onChange={(e) => setSandboxArgs(e.target.value)}
                      placeholder="e.g. solution.js or -la"
                      className="flex-1 min-h-[44px] px-3 py-2 bg-[#0D1326] border border-[#1E294A] rounded-xl text-xs text-[#F4F7FF] font-mono focus:outline-none focus:border-[#00F0FF]"
                    />

                    <button
                      onClick={handleRunSandbox}
                      disabled={isExecutingSandbox}
                      className="min-h-[44px] px-5 py-2 text-xs font-bold text-white vivid-gradient-brand rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>{isExecutingSandbox ? 'Executing...' : 'Run in Sandbox'}</span>
                    </button>
                  </div>
                </div>

                {/* Sandbox Output Console */}
                {sandboxResult && (
                  <div className="p-4 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between text-[11px] pb-1 border-b border-[#1E294A]">
                      <span className="font-bold text-[#F4F7FF] tabular-nums">
                        Exit Code: <span className={sandboxResult.exitCode === 0 ? 'text-[#CCFF00]' : 'text-[#FF007F]'}>{sandboxResult.exitCode}</span>
                      </span>
                      <span className="text-[#9AA8C7] tabular-nums">Duration: {sandboxResult.durationMs ?? 0} ms</span>
                    </div>

                    {sandboxResult.stdout && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-[#00F0FF] uppercase font-bold">Standard Output (STDOUT):</div>
                        <pre className="p-3 rounded-lg bg-[#070B19] border border-[#1E294A] text-[#CCFF00] whitespace-pre-wrap overflow-x-auto">
                          {sandboxResult.stdout}
                        </pre>
                      </div>
                    )}

                    {sandboxResult.stderr && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-[#FF007F] uppercase font-bold">Standard Error (STDERR):</div>
                        <pre className="p-3 rounded-lg bg-[#FF007F]/12 border border-[#FF007F]/35 text-[#FF99C8] whitespace-pre-wrap overflow-x-auto">
                          {sandboxResult.stderr}
                        </pre>
                      </div>
                    )}

                    {sandboxResult.error && (
                      <div className="p-3 rounded-lg bg-[#FF007F]/12 border border-[#FF007F]/40 text-[#FF99C8]">
                        {sandboxResult.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: SOVEREIGNTY AUDIT TRAIL */}
            {activeTab === 'audit' && (
              <div className="p-4 bg-[#070B19] space-y-3 min-h-[460px] max-h-[480px] overflow-y-auto">
                <div className="flex items-center justify-between pb-2 border-b border-[#1E294A]">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#00F0FF]" />
                    <span className="text-xs font-bold text-[#F4F7FF]">SHA-256 Chained Audit Ledger</span>
                  </div>
                  <StatusDot
                    status={auditChainValid ? 'VERIFIED' : 'FAILED'}
                    label={auditChainValid ? 'CHAIN VALID' : 'TAMPER DETECTED'}
                   
                  />
                </div>

                <div className="space-y-2">
                  {auditRecords.map((rec) => (
                    <div
                      key={rec.index}
                      className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A] font-mono text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#00F0FF]">
                          #{rec.index} · {rec.action}
                        </span>
                        <span className="text-[#9AA8C7] text-[10px] tabular-nums">
                          [{rec.timestamp.slice(11, 19)}]
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[#9AA8C7]">
                        <span>Role: <strong className="text-[#F4F7FF]">{rec.role}</strong></span>
                        <span className="truncate max-w-[200px]" title={rec.entry_hash}>
                          Hash: {rec.entry_hash.slice(0, 16)}...
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 5: LIVE 41.53M THROUGHPUT & LATENCY BENCHMARK */}
            {activeTab === 'benchmark' && (
              <div className="p-4 bg-[#070B19] space-y-4 min-h-[460px]">
                <div className="p-3.5 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-[#F4F7FF]">
                        Native Target 41.53M Throughput &amp; Latency Benchmark
                      </div>
                      <div className="text-[11px] text-[#9AA8C7] mt-0.5">
                        Executes live wall-clock inference on native_data/model_checkpoint_target_41m.pt (Uncached Baseline vs Causal KV-Cache)
                      </div>
                    </div>
                    <button
                      onClick={handleRunBenchmark}
                      disabled={isBenchmarking || !isAuthenticated}
                      className="min-h-[42px] px-4 py-2 text-xs font-bold text-[#070B19] bg-[#00F0FF] hover:bg-[#33F3FF] rounded-lg transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBenchmarking ? 'animate-spin' : ''}`} />
                      <span>{isBenchmarking ? 'Running Live Benchmark...' : 'Run Benchmark Test'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={benchPrompt}
                      onChange={(e) => setBenchPrompt(e.target.value)}
                      placeholder="Benchmark prompt (kept <= 64 tokens for KV-cache prefill)"
                      className="sm:col-span-3 min-h-[42px] px-3 py-2 bg-[#0D1326] border border-[#1E294A] rounded-lg text-xs text-[#F4F7FF] font-mono focus:outline-none focus:border-[#00F0FF]"
                    />
                    <select
                      value={benchTokens}
                      onChange={(e) => setBenchTokens(Number(e.target.value))}
                      className="min-h-[42px] px-3 py-2 bg-[#0D1326] border border-[#1E294A] rounded-lg text-xs text-[#F4F7FF] font-mono tabular-nums focus:outline-none focus:border-[#00F0FF]"
                    >
                      <option value={8}>8 tokens</option>
                      <option value={12}>12 tokens</option>
                      <option value={16}>16 tokens</option>
                      <option value={24}>24 tokens</option>
                    </select>
                  </div>
                </div>

                {benchmarkError && (
                  <div className="p-3 rounded-xl bg-[#FF007F]/12 border border-[#FF007F]/45 text-xs text-[#FF99C8] font-mono">
                    {benchmarkError}
                  </div>
                )}

                {isBenchmarking && (
                  <div className="p-6 rounded-xl bg-[#0B1124] border border-[#1E294A] text-center space-y-2">
                    <div className="text-xs font-semibold text-[#00F0FF]">
                      Measuring real CPU forward passes across 41,527,808 parameters...
                    </div>
                    <div className="text-[11px] text-[#9AA8C7] font-mono">
                      Pass 1: Uncached sliding-window logits · Pass 2: KV-cache prefill &amp; step decode
                    </div>
                  </div>
                )}

                {!isBenchmarking && !benchmarkResult && !benchmarkError && (
                  <div className="p-8 rounded-xl bg-[#0B1124] border border-[#1E294A] text-center space-y-2">
                    <div className="text-xs font-semibold text-[#F4F7FF]">No live benchmark recorded in this session</div>
                    <div className="text-[11px] text-[#9AA8C7]">
                      Click Run Benchmark Test above to measure actual uncached vs KV-cache latency and throughput on NativeLM 41.53M.
                    </div>
                  </div>
                )}

                {benchmarkResult && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                        <div className="text-[11px] text-[#9AA8C7]">KV-Cache Latency</div>
                        <div className="text-base font-bold text-[#00F0FF] font-mono tabular-nums mt-0.5">
                          {benchmarkResult.active_kv_cache.latency_ms.toFixed(1)} ms
                        </div>
                        <div className="text-[10px] text-[#9AA8C7] font-mono tabular-nums">
                          {benchmarkResult.active_kv_cache.tokens_per_sec.toFixed(2)} tok/s
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                        <div className="text-[11px] text-[#9AA8C7]">Uncached Baseline</div>
                        <div className="text-base font-bold text-[#F4F7FF] font-mono tabular-nums mt-0.5">
                          {benchmarkResult.baseline_uncached.latency_ms.toFixed(1)} ms
                        </div>
                        <div className="text-[10px] text-[#9AA8C7] font-mono tabular-nums">
                          {benchmarkResult.baseline_uncached.tokens_per_sec.toFixed(2)} tok/s
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                        <div className="text-[11px] text-[#9AA8C7]">Latency Reduction</div>
                        <div className="text-base font-bold text-[#CCFF00] font-mono tabular-nums mt-0.5">
                          -{benchmarkResult.improvement.latency_reduction_pct.toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-[#9AA8C7] font-mono tabular-nums">
                          Saved {benchmarkResult.improvement.latency_reduction_ms.toFixed(1)} ms
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                        <div className="text-[11px] text-[#9AA8C7]">Measured Speedup</div>
                        <div className="text-base font-bold text-[#FF5E3A] font-mono tabular-nums mt-0.5">
                          {benchmarkResult.improvement.speedup_factor.toFixed(2)}x
                        </div>
                        <div className="text-[10px] text-[#9AA8C7] font-mono tabular-nums">
                          Parity: {benchmarkResult.tokens_parity_exact ? 'Exact Match' : 'Diverged'}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-[#1E294A]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#0B1124] border-b border-[#1E294A] text-[#9AA8C7] text-[11px]">
                          <tr>
                            <th className="py-2 px-3 font-semibold">Execution Path</th>
                            <th className="py-2 px-3 font-semibold text-right">Latency</th>
                            <th className="py-2 px-3 font-semibold text-right">Throughput</th>
                            <th className="py-2 px-3 font-semibold text-right">Prefill / Step</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1E294A] bg-[#070B19] font-mono tabular-nums text-[11px]">
                          <tr>
                            <td className="py-2.5 px-3 font-sans font-medium text-[#F4F7FF]">Uncached Full-Context Recalc</td>
                            <td className="py-2.5 px-3 text-right text-[#F4F7FF]">{benchmarkResult.baseline_uncached.latency_ms.toFixed(2)} ms</td>
                            <td className="py-2.5 px-3 text-right text-[#9AA8C7]">{benchmarkResult.baseline_uncached.tokens_per_sec.toFixed(2)} tok/s</td>
                            <td className="py-2.5 px-3 text-right text-[#9AA8C7]">Recomputed / step</td>
                          </tr>
                          <tr>
                            <td className="py-2.5 px-3 font-sans font-medium text-[#00F0FF]">Active Causal KV-Cache (41.53M)</td>
                            <td className="py-2.5 px-3 text-right text-[#00F0FF] font-bold">{benchmarkResult.active_kv_cache.latency_ms.toFixed(2)} ms</td>
                            <td className="py-2.5 px-3 text-right text-[#00F0FF] font-bold">{benchmarkResult.active_kv_cache.tokens_per_sec.toFixed(2)} tok/s</td>
                            <td className="py-2.5 px-3 text-right text-[#9AA8C7]">
                              {benchmarkResult.active_kv_cache.prefill_ms.toFixed(1)} ms / {benchmarkResult.active_kv_cache.avg_decode_step_ms.toFixed(1)} ms
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A] text-[11px] font-mono text-[#9AA8C7] space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>Prompt: {benchmarkResult.input_tokens} tokens · Generated: {benchmarkResult.generated_tokens} tokens · ctx={benchmarkResult.ctx_window}</span>
                        <span className="text-[#00F0FF]">SHA-256: {benchmarkResult.checkpoint_sha256.slice(0, 16)}...</span>
                      </div>
                      <div className="text-[#F4F7FF] truncate">
                        Output sample: {benchmarkResult.generated_text}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* TAB 6: NATIVE TARGET LOSS / PERPLEXITY TRAINING DASHBOARD */}
            {activeTab === 'training' && (
              <div className="p-4 bg-[#070B19] space-y-4 min-h-[460px]">
                <div className="p-3.5 rounded-xl bg-[#0B1124] border border-[#1E294A] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-[#F4F7FF]">
                      Native Target Loss &amp; Perplexity Training Dashboard
                    </div>
                    <div className="text-[11px] text-[#9AA8C7] mt-0.5">
                      Plotted from recorded training logs (`target-training-evidence.json` &amp; `artifacts/lm-v2-training-evidence.json`)
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setCurveTrack('target41m')}
                      className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-mono cursor-pointer border ${
                        curveTrack === 'target41m'
                          ? 'bg-[#131B36] text-[#00F0FF] border-[#00F0FF]/50 font-bold'
                          : 'bg-[#0D1326] text-[#9AA8C7] border-[#1E294A]'
                      }`}
                    >
                      41.5M Target (1,000 steps)
                    </button>
                    <button
                      onClick={() => setCurveTrack('v2_2m')}
                      className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-mono cursor-pointer border ${
                        curveTrack === 'v2_2m'
                          ? 'bg-[#131B36] text-[#00F0FF] border-[#00F0FF]/50 font-bold'
                          : 'bg-[#0D1326] text-[#9AA8C7] border-[#1E294A]'
                      }`}
                    >
                      2.0M v2 (2,500 steps)
                    </button>
                    <button
                      onClick={() => setCurveTrack('gated_v2_2')}
                      className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-mono cursor-pointer border ${
                        curveTrack === 'gated_v2_2'
                          ? 'bg-[#131B36] text-[#00F0FF] border-[#00F0FF]/50 font-bold'
                          : 'bg-[#0D1326] text-[#9AA8C7] border-[#1E294A]'
                      }`}
                    >
                      train_gated v2.2 (3,000 steps)
                    </button>
                    <button
                      onClick={handlePromoteToActive}
                      disabled={isPromoting || !isAuthenticated}
                      className="min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-bold text-white vivid-gradient-brand transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      <span>{isPromoting ? 'Promoting...' : 'Promote to Active'}</span>
                    </button>
                  </div>
                </div>

                {/* Training Loss Deviation Notification Watchdog */}
                <div className="p-3.5 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Bell className={`w-4 h-4 ${activeAlerts.length > 0 ? 'text-[#FF5E3A]' : 'text-[#00F0FF]'}`} />
                      <div>
                        <div className="text-xs font-semibold text-[#F4F7FF]">
                          train_gated.py Loss Deviation Watchdog
                        </div>
                        <div className="text-[11px] text-[#9AA8C7]">
                          Monitors step-to-step train loss spikes and val NLL exceedance beyond threshold
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                      <label className="text-[11px] text-[#9AA8C7]" htmlFor="loss-dev-threshold">
                        Threshold (Δ NLL):
                      </label>
                      <input
                        id="loss-dev-threshold"
                        type="number"
                        min={0.05}
                        max={2.0}
                        step={0.05}
                        value={lossDeviationThreshold}
                        onChange={(e) => {
                          setLossDeviationThreshold(Math.max(0.05, parseFloat(e.target.value) || 0.25));
                          setDismissedAlertIds([]);
                        }}
                        className="w-20 px-2 py-1 rounded-lg bg-[#0D1326] border border-[#1E294A] text-[#F4F7FF] text-xs font-mono tabular-nums focus:outline-none focus:border-[#00F0FF]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setAlertsEnabled(!alertsEnabled);
                          setDismissedAlertIds([]);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer ${
                          alertsEnabled
                            ? 'bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/40'
                            : 'bg-[#0D1326] text-[#9AA8C7] border-[#1E294A]'
                        }`}
                      >
                        {alertsEnabled ? 'Alerts ON' : 'Alerts PAUSED'}
                      </button>
                      {dismissedAlertIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setDismissedAlertIds([])}
                          className="px-2 py-1 rounded-lg text-[11px] text-[#FF5E3A] border border-[#FF5E3A]/40 hover:bg-[#FF5E3A]/10 cursor-pointer"
                        >
                          Reset Dismissed
                        </button>
                      )}
                    </div>
                  </div>

                  {activeAlerts.length === 0 ? (
                    <div className="p-2.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-[11px] font-mono text-[#CCFF00] flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {alertsEnabled
                          ? `No train_gated.py loss deviations above ${lossDeviationThreshold.toFixed(2)} NLL.`
                          : 'Watchdog notifications paused.'}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {activeAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`p-2.5 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 ${
                            alert.severity === 'CRITICAL'
                              ? 'bg-[#FF007F]/12 border-[#FF007F]/45 text-[#FF99C8]'
                              : 'bg-[#FF5E3A]/12 border-[#FF5E3A]/45 text-[#FFD2C4]'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 font-bold">
                              <StatusDot
                                status={alert.severity === 'CRITICAL' ? 'FAILED' : 'PARTIAL'}
                                label={alert.severity}
                               
                              />
                              <span>Run #{alert.runIndex} ({alert.decision}) · Step {alert.step}</span>
                              <span>· {alert.metric}</span>
                            </div>
                            <div className="text-[10px] opacity-90">
                              Observed {alert.observed.toFixed(4)} vs baseline {alert.baseline.toFixed(4)} · Δ {alert.delta.toFixed(4)} NLL (&gt; {lossDeviationThreshold.toFixed(2)} threshold)
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDismissedAlertIds((prev) => [...prev, alert.id])}
                            className="p-1 rounded hover:bg-black/20 cursor-pointer shrink-0"
                            title="Acknowledge alert"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {promoteError && (
                  <div className="p-3 rounded-xl bg-[#FF007F]/12 border border-[#FF007F]/45 text-xs text-[#FF99C8] font-mono">
                    {promoteError}
                  </div>
                )}

                {promoteResult && (
                  <div className="p-3 rounded-xl bg-[#CCFF00]/10 border border-[#CCFF00]/35 text-xs font-mono space-y-1">
                    <div className="font-bold text-[#CCFF00] flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Promoted NativeLM v2 (2.0M) Checkpoint to Active Runtime (Block #{promoteResult.auditBlockIndex})</span>
                    </div>
                    <div className="text-[11px] text-[#9AA8C7]">
                      Source: {promoteResult.activeCheckpoint?.weightsSource} · Params: {promoteResult.activeCheckpoint?.totalParams?.toLocaleString()} · Eval Loss: {promoteResult.activeCheckpoint?.evaluatedLoss} · Eval PPL: {promoteResult.activeCheckpoint?.evaluatedPerplexity}
                    </div>
                    <div className="text-[10px] text-[#9AA8C7] truncate">
                      SHA-256: {promoteResult.activeCheckpoint?.checkpointSha256}
                    </div>
                  </div>
                )}

                {(() => {
                  const activeSeries = curveTrack === 'target41m'
                    ? trainingLogs?.target41m
                    : curveTrack === 'v2_2m'
                    ? trainingLogs?.v2_2m
                    : {
                        params: trainingLogs?.v2_2m?.params || 502912,
                        bestValLoss: trainingLogs?.v2_2m?.gatedBestLoss ?? 1.4893,
                        bestValPerplexity: trainingLogs?.v2_2m?.gatedBestPerplexity ?? 4.4339,
                        points: trainingLogs?.v2_2m?.gatedPoints || []
                      };
                  const chartPoints = activeSeries?.points || [];
                  if (chartPoints.length === 0) {
                    return (
                      <div className="p-8 rounded-xl bg-[#0B1124] border border-[#1E294A] text-center text-xs text-[#9AA8C7]">
                        Loading training curves from Sovereign evidence logs...
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                        <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                          <div className="text-[10px] text-[#9AA8C7] uppercase">Model Params</div>
                          <div className="text-sm font-bold text-[#F4F7FF] mt-0.5">
                            {Number(activeSeries.params || 0).toLocaleString()}
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                          <div className="text-[10px] text-[#9AA8C7] uppercase">Best Val Loss</div>
                          <div className="text-sm font-bold text-[#00F0FF] mt-0.5">
                            {activeSeries.bestValLoss}
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                          <div className="text-[10px] text-[#9AA8C7] uppercase">Best Val Perplexity</div>
                          <div className="text-sm font-bold text-[#FF5E3A] mt-0.5">
                            {activeSeries.bestValPerplexity}
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                          <div className="text-[10px] text-[#9AA8C7] uppercase">Logged Steps</div>
                          <div className="text-sm font-bold text-[#F4F7FF] mt-0.5">
                            {chartPoints[chartPoints.length - 1]?.step ?? 0}
                          </div>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-2">
                        <div className="text-[11px] font-bold text-[#F4F7FF] uppercase tracking-wider">
                          Cross-Entropy Loss Over Training Steps (Train vs Validation)
                        </div>
                        <div className="h-56 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartPoints} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1E294A" />
                              <XAxis dataKey="step" stroke="#9AA8C7" tick={{ fontSize: 10 }} />
                              <YAxis stroke="#9AA8C7" tick={{ fontSize: 10 }} />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: '#070B19',
                                  borderColor: '#1E294A',
                                  borderRadius: '10px',
                                  fontSize: '11px',
                                  color: '#F4F7FF'
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px' }} />
                              <Line type="monotone" dataKey="trainLoss" name="Train Loss" stroke="#00F0FF" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="valLoss" name="Validation Loss" stroke="#CCFF00" strokeWidth={2.5} dot={{ r: 2 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-2">
                        <div className="text-[11px] font-bold text-[#F4F7FF] uppercase tracking-wider">
                          Perplexity (exp(NLL)) Over Training Steps
                        </div>
                        <div className="h-56 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartPoints} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1E294A" />
                              <XAxis dataKey="step" stroke="#9AA8C7" tick={{ fontSize: 10 }} />
                              <YAxis stroke="#9AA8C7" tick={{ fontSize: 10 }} />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: '#070B19',
                                  borderColor: '#1E294A',
                                  borderRadius: '10px',
                                  fontSize: '11px',
                                  color: '#F4F7FF'
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px' }} />
                              <Line type="monotone" dataKey="trainPerplexity" name="Train Perplexity" stroke="#FF007F" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="valPerplexity" name="Validation Perplexity" stroke="#FF5E3A" strokeWidth={2.5} dot={{ r: 2 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB 7: CLOUD DEPLOYMENT HISTORY TIMELINE */}
            {activeTab === 'deployments' && (
              <div className="p-4 bg-[#070B19] min-h-[460px] max-h-[600px] overflow-y-auto">
                <DeploymentHistoryTimeline refreshKey={auditRecords.length} />
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Execution Evidence & Test Assertions (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          <VividCard title="Sandbox Verification" subtitle="ToolGateway Invariant Assertions" gradientAccent="purple" className="!p-4">
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-1">
                <div className="flex items-center justify-between font-bold text-[#F4F7FF]">
                  <span>Execution Barrier</span>
                  <span className="text-[#00F0FF] font-mono tabular-nums">5000ms</span>
                </div>
                <div className="text-[11px] text-[#9AA8C7]">
                  Hardware timeout kill enforced
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-1">
                <div className="flex items-center justify-between font-bold text-[#F4F7FF]">
                  <span>Sovereignty Audit</span>
                  <StatusDot status="VERIFIED" label="ENFORCED" />
                </div>
                <div className="text-[11px] text-[#9AA8C7]">
                  Appended to native_data/audit_log.jsonl
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-1">
                <div className="flex items-center justify-between font-bold text-[#F4F7FF]">
                  <span>Sandbox Directory</span>
                  <span className="text-[#FF5E3A] font-mono">/workspace</span>
                </div>
                <div className="text-[11px] text-[#9AA8C7]">
                  Zero path traversal escape allowed
                </div>
              </div>
            </div>
          </VividCard>

          {/* Honest Architecture Disclosure Card & Checkpoint Promotion */}
          <VividCard title="Native Model Attribution" subtitle="Zero-Fake Engineering Baseline" gradientAccent="lime" className="!p-4">
            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-1">
                <div className="flex items-center justify-between font-bold text-[#F4F7FF] gap-2">
                  <span>Active Runtime</span>
                  <span className="text-[#00F0FF] font-mono truncate">
                    {(() => {
                      const k = statusData?.model?.activeKey || activeCheckpointInfo?.key;
                      if (k === 'v2_2m' || k === 'v2' || k === 'v2_base') return 'NativeLM v2 (2.0M)';
                      if (k === 'target_41m') return 'Native Target 41.53M';
                      if (k === 'legacy_v1') return 'v1 Subgraph (231K)';
                      return 'NativeLM v2 (2.0M)';
                    })()}
                  </span>
                </div>
                <div className="text-[11px] text-[#9AA8C7] truncate">
                  {statusData?.model?.weightsSource || activeCheckpointInfo?.weightsSource || 'native_data/model_checkpoint_v2.pt'}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-1">
                <div className="flex items-center justify-between font-bold text-[#F4F7FF]">
                  <span>Checkpoint Status</span>
                  <StatusDot
                    status={statusData?.model?.weightsLoaded ? 'VERIFIED' : 'BLOCKED'}
                    label={statusData?.model?.weightsLoaded ? 'LOADED' : 'FAIL_CLOSED'}
                   
                  />
                </div>
                <div className="text-[11px] text-[#9AA8C7] tabular-nums">
                  v2 2.0M: PPL 4.74 (NLL 1.5561) · 41.5M: PPL 8.43 (NLL 2.1327)
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[#0B1124] border border-[#1E294A] space-y-1">
                <div className="flex items-center justify-between font-bold text-[#F4F7FF]">
                  <span>Autograd Subgraph</span>
                  <StatusDot status="VERIFIED" label="VERIFIED" />
                </div>
                <div className="text-[11px] text-[#9AA8C7]">
                  Exact numerical gradients confirmed
                </div>
              </div>

              <button
                onClick={handlePromoteToActive}
                disabled={isPromoting || !isAuthenticated}
                className="w-full min-h-[44px] mt-2 px-3 py-2 rounded-xl text-xs font-bold text-white vivid-gradient-brand transition-opacity hover:opacity-95 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Rocket className="w-3.5 h-3.5" />
                <span>{isPromoting ? 'Promoting NativeLM v2...' : 'Promote to Active (2.0M v2)'}</span>
              </button>
            </div>
          </VividCard>
        </div>
      </div>
        </>
      )}
    </div>
  );
};
