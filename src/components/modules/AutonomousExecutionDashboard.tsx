/**
 * ZYNTHEOR Autonomous Execution Engine — Customer Dashboard
 *
 * Purpose: Platform for issuing real engineering work to the Autonomous Execution Engine.
 * Not a chatbot UI.
 *
 * Connects only to real REST APIs present in this codebase:
 *   POST /api/agent/execute          — run a goal (NDJSON stream)
 *   POST /api/agent/queue            — enqueue with priority
 *   POST /api/agent/queue/run-next   — drain next queued task
 *   GET  /api/agent/tasks            — task history / queue state
 *   GET  /api/agent/metrics          — execution metrics
 *   GET  /api/agent/cycles           — cycle history
 *   GET  /api/workspace/files        — project workspace
 *   GET  /api/agent/deliverables/:f  — download verified deliverable
 *
 * No simulated success states. If the API is unreachable or returns an error,
 * the UI surfaces the failure honestly.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  Terminal,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  RefreshCw,
  ListOrdered,
  Activity,
  FileCode2,
  Wrench,
  Package,
  ChevronRight,
  Loader2,
  CheckSquare,
  Trash2,
  Printer,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiUrl } from '../../lib/apiClient';
import { consumeNdjsonStream } from '../../lib/ndjson';
import { SystemStatusData } from '../../types';
import {
  PrintableSessionAudit,
  buildSystemMetadataSnapshot,
  usePrintAudit,
} from '../PrintableSessionAudit';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';

// ---------------------------------------------------------------------------
// Types aligned with server / TaskOrchestrator
// ---------------------------------------------------------------------------

type TaskPriority = 'High' | 'Medium' | 'Low';

type StageId =
  | '01_INTAKE'
  | '02_ANALYZE'
  | '03_PLAN'
  | '04_BUILD'
  | '05_EXECUTE'
  | '06_TEST'
  | '07_REPAIR'
  | '08_DELIVER';

interface StageInfo {
  id: StageId;
  labelTh: string;
  labelEn: string;
}

const STAGE_CATALOG: StageInfo[] = [
  { id: '01_INTAKE', labelTh: 'รับโจทย์', labelEn: 'Intake & Objective' },
  { id: '02_ANALYZE', labelTh: 'คิดและวิเคราะห์', labelEn: 'Analyze Risks & Context' },
  { id: '03_PLAN', labelTh: 'วางแผน', labelEn: 'Plan & Acceptance Criteria' },
  { id: '04_BUILD', labelTh: 'สร้าง', labelEn: 'Build Source & Tests' },
  { id: '05_EXECUTE', labelTh: 'ลงมือ', labelEn: 'Execute in Sandbox' },
  { id: '06_TEST', labelTh: 'ทดสอบ', labelEn: 'Independent Verification' },
  { id: '07_REPAIR', labelTh: 'แก้ไข', labelEn: 'Autonomous Repair Loop' },
  { id: '08_DELIVER', labelTh: 'ส่งมอบ', labelEn: 'Verified Delivery Gate' },
];

interface OrchestrationEvent {
  type: string;
  role?: string;
  message: string;
  data?: any;
  timestamp: string;
  /** Preferred field emitted by TaskOrchestrator */
  cycleStage?: StageId;
  /** Legacy / fallback */
  stage?: StageId;
  priority?: TaskPriority;
}

interface PersistentTaskRecord {
  taskId: string;
  goal: string;
  priority: TaskPriority;
  lifecycleStatus: string;
  success?: boolean;
  createdAt?: string;
  updatedAt?: string;
  resumable?: boolean;
  packageArtifact?: { zipFilename?: string; zipSha256?: string; filename?: string; sha256?: string } | null;
}

interface WorkspaceFile {
  name: string;
  size?: number;
  modified?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AutonomousExecutionDashboard: React.FC<{ statusData?: SystemStatusData | null }> = ({ statusData = null }) => {
  const { authHeaders, authReady, isAuthenticated, role, session } = useAuth();
  const { showToast } = useToast();
  const { printPayload, triggerPrintAudit } = usePrintAudit();

  // Task Command Center
  const [goal, setGoal] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [isRunning, setIsRunning] = useState(false);

  // Live Execution Monitor
  const [events, setEvents] = useState<OrchestrationEvent[]>([]);
  const [currentStage, setCurrentStage] = useState<StageId | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<StageId>>(new Set());
  const [finalResult, setFinalResult] = useState<any>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [approvalRequestIdInput, setApprovalRequestIdInput] = useState('');
  const [activePlan, setActivePlan] = useState<any | null>(null);

  // Task History + Metrics
  const [taskList, setTaskList] = useState<PersistentTaskRecord[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const plannedTasks = taskList.filter((t) => t.lifecycleStatus === 'Planned');

  // Batch selection & delete for completed tasks
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);

  // Project Workspace
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Data loaders (real APIs only)
  // -----------------------------------------------------------------------

  const loadTasks = useCallback(async () => {
    if (!authReady) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(apiUrl('/api/agent/tasks'), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Task history unavailable (${res.status})`);
      const data = await res.json();
      if (Array.isArray(data)) setTaskList(data);
      else if (Array.isArray(data?.tasks)) setTaskList(data.tasks);
      else if (data?.success && Array.isArray(data.data)) setTaskList(data.data);
    } catch (e: any) {
      // surface network failure honestly
      setLastError(`Failed to load task history: ${e.message}`);
    } finally {
      setHistoryLoading(false);
    }
  }, [authReady, authHeaders]);

  const loadMetrics = useCallback(async () => {
    if (!authReady) return;
    try {
      const res = await fetch(apiUrl('/api/agent/metrics'), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Execution metrics unavailable (${res.status})`);
      const data = await res.json();
      setMetrics(data?.metrics || data);
    } catch {
      /* non-critical */
    }
  }, [authReady, authHeaders]);

  const loadWorkspace = useCallback(async () => {
    if (!authReady) return;
    if (role === 'User') {
      setWorkspaceFiles([]);
      setWsLoading(false);
      return;
    }
    setWsLoading(true);
    try {
      const res = await fetch(apiUrl('/api/workspace/files'), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Workspace unavailable (${res.status})`);
      const data = await res.json();
      const files = Array.isArray(data) ? data : data?.files || data?.data || [];
      setWorkspaceFiles(
        files.map((f: any) =>
          typeof f === 'string' ? { name: f } : { name: f.name || f.path, size: f.size, modified: f.modified }
        )
      );
    } catch (e: any) {
      setLastError(`Workspace load failed: ${e.message}`);
    } finally {
      setWsLoading(false);
    }
  }, [authReady, authHeaders, role]);

  const loadLatestPlan = useCallback(async (taskId?: string) => {
    if (!authReady || !isAuthenticated || role === 'User') return;
    try {
      const endpoint = taskId ? `/api/agent/plans/${encodeURIComponent(taskId)}` : '/api/agent/plans';
      const res = await fetch(apiUrl(endpoint), { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.plan) setActivePlan(data.plan);
      else if (Array.isArray(data.plans) && data.plans.length > 0) setActivePlan(data.plans[0]);
    } catch {
      /* non-critical */
    }
  }, [authReady, isAuthenticated, role, authHeaders]);

  useEffect(() => {
    if (authReady && isAuthenticated) {
      loadTasks();
      loadMetrics();
      loadLatestPlan();
      if (role !== 'User') loadWorkspace();
    }
  }, [authReady, isAuthenticated, role, loadTasks, loadMetrics, loadLatestPlan, loadWorkspace]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const isTaskCompleted = useCallback(
    (t: PersistentTaskRecord) => t.lifecycleStatus === 'Delivered' || Boolean(t.success),
    []
  );

  // Keep selectedTaskIds synchronized with currently available completed tasks
  useEffect(() => {
    const validCompletedIds = new Set(taskList.filter(isTaskCompleted).map((t) => t.taskId));
    setSelectedTaskIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validCompletedIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [taskList, isTaskCompleted]);

  // -----------------------------------------------------------------------
  // Stage inference from events (honest mapping only)
  // -----------------------------------------------------------------------

  const isValidStage = (id: unknown): id is StageId =>
    typeof id === 'string' && STAGE_CATALOG.some((s) => s.id === id);

  const inferStageFromEvent = (ev: OrchestrationEvent): StageId | null => {
    // Prefer authoritative cycleStage from TaskOrchestrator
    if (isValidStage(ev.cycleStage)) return ev.cycleStage;
    if (isValidStage(ev.stage)) return ev.stage;
    if (isValidStage(ev.data?.cycleStage)) return ev.data.cycleStage;
    if (isValidStage(ev.data?.stage)) return ev.data.stage;

    // Fallback heuristics only when server did not emit cycleStage
    const msg = (ev.message || '').toLowerCase();
    const role = (ev.role || '').toUpperCase();
    if (ev.type === 'init' || msg.includes('intake') || msg.includes('initiating')) return '01_INTAKE';
    if (msg.includes('analy') || msg.includes('risk') || msg.includes('context')) return '02_ANALYZE';
    if (role === 'PLANNER' || (msg.includes('plan') && !msg.includes('repair'))) return '03_PLAN';
    if (role === 'CODER' || msg.includes('build') || msg.includes('synthes')) return '04_BUILD';
    if (msg.includes('execute') || msg.includes('sandbox') || msg.includes('run ')) return '05_EXECUTE';
    if (role === 'TESTER' || msg.includes('test') || msg.includes('verif')) return '06_TEST';
    if (msg.includes('repair') || msg.includes('retry') || msg.includes('fix')) return '07_REPAIR';
    if (ev.type === 'done' || msg.includes('deliver') || msg.includes('package')) return '08_DELIVER';
    return null;
  };

  // -----------------------------------------------------------------------
  // Run task via real streaming API
  // -----------------------------------------------------------------------

  const runGoal = async (mode: 'execute' | 'queue' = 'execute') => {
    if (!goal.trim() || isRunning) return;
    setIsRunning(true);
    setEvents([]);
    setFinalResult(null);
    setLastError(null);
    setQueueNotice(null);
    setCurrentStage(null);
    setCompletedStages(new Set());

    try {
      if (mode === 'queue') {
        const res = await fetch(apiUrl('/api/agent/queue'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ goal: goal.trim(), priority }),
        });
        const data = await res.json();
        if (!res.ok || data.success === false) {
          throw new Error(data.error || data.message || `Queue failed (${res.status})`);
        }
        setEvents((prev) => [
          ...prev,
          {
            type: 'info',
            message: `Task enqueued with priority ${priority}. Use "Run Next" to execute.`,
            timestamp: new Date().toISOString(),
          },
        ]);
        showToast({
          variant: 'info',
          title: 'Task Queued',
          message: goal.trim(),
          meta: [data.task?.taskId ? `Task ${data.task.taskId}` : null, `Priority: ${priority}`]
            .filter(Boolean)
            .join(' · '),
        });
        await loadTasks();
        return;
      }

      // Live execute with NDJSON stream
      const response = await fetch(apiUrl('/api/agent/execute'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          goal: goal.trim(),
          priority,
          ...(approvalRequestIdInput.trim() ? { approvalRequestId: approvalRequestIdInput.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || errBody.message || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No readable stream returned from /api/agent/execute');
      }

      let toastedRun = false;

      await consumeNdjsonStream<OrchestrationEvent>(response, (ev) => {
            setEvents((prev) => [...prev, ev]);

            const stage = inferStageFromEvent(ev);
            if (stage) {
              setCurrentStage(stage);
              setCompletedStages((prev) => {
                const next = new Set(prev);
                // mark all stages before this one as completed
                const idx = STAGE_CATALOG.findIndex((s) => s.id === stage);
                for (let i = 0; i < idx; i++) next.add(STAGE_CATALOG[i].id);
                return next;
              });
            }

            if (ev.type === 'done' && ev.data?.success === true && !toastedRun) {
              toastedRun = true;
              showToast({
                variant: 'success',
                title: 'Autonomous Task Delivered',
                message: goal.trim(),
                meta: [
                  ev.data?.taskId ? `Task ${ev.data.taskId}` : null,
                  typeof ev.data?.durationMs === 'number' ? `${ev.data.durationMs} ms` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined,
              });
            }

            if (ev.type === 'final_result') {
              setFinalResult(ev.data);
              const ok = Boolean(ev.data?.success);
              if (ok) {
                setCompletedStages(new Set(STAGE_CATALOG.map((s) => s.id)));
                setCurrentStage('08_DELIVER');
                if (!toastedRun) {
                  toastedRun = true;
                  showToast({
                    variant: 'success',
                    title: 'Autonomous Task Delivered',
                    message: goal.trim(),
                    meta: [
                      ev.data?.taskId ? `Task ${ev.data.taskId}` : null,
                      typeof ev.data?.durationMs === 'number' ? `${ev.data.durationMs} ms` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined,
                  });
                }
              } else {
                // Fail-closed: do not paint all stages green on failure
                setCurrentStage((prev) => prev || '07_REPAIR');
              }
            }
            if (ev.type === 'error') {
              setLastError(ev.message || 'Execution error');
            }
      });
    } catch (e: any) {
      setLastError(e.message || String(e));
      setEvents((prev) => [
        ...prev,
        {
          type: 'error',
          message: e.message || String(e),
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsRunning(false);
      loadTasks();
      loadMetrics();
      loadLatestPlan();
      loadWorkspace();
    }
  };

  const runNextQueued = async () => {
    if (isRunning) return;
    if (plannedTasks.length === 0) {
      setLastError(null);
      setQueueNotice(
        'ไม่มีงานสถานะ Planned ใน Priority Queue — กรุณาพิมพ์โจทย์ด้านบนแล้วกด Enqueue เพื่อเพิ่มงานเข้าคิวก่อน (No Planned tasks remain in the priority queue).'
      );
      return;
    }
    setIsRunning(true);
    setLastError(null);
    setQueueNotice(null);
    setFinalResult(null);
    setCurrentStage(null);
    setCompletedStages(new Set());
    try {
      const response = await fetch(apiUrl('/api/agent/queue/run-next'), {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const errMsg = errBody.error || errBody.message || `HTTP ${response.status}`;
        if (response.status === 404 && String(errMsg).includes('No Planned tasks')) {
          setQueueNotice(
            'ไม่มีงานสถานะ Planned ใน Priority Queue — กรุณาพิมพ์โจทย์ด้านบนแล้วกด Enqueue เพื่อเพิ่มงานเข้าคิวก่อน (No Planned tasks remain in the priority queue).'
          );
          return;
        }
        throw new Error(errMsg);
      }
      // If the server streams, consume it the same way
      if (response.body && response.headers.get('content-type')?.includes('ndjson')) {
        let toastedQueued = false;
        setEvents([]);
        await consumeNdjsonStream<OrchestrationEvent>(response, (ev) => {
              setEvents((prev) => [...prev, ev]);
              const inferred = inferStageFromEvent(ev);
              if (inferred) {
                setCurrentStage((prev) => {
                  if (prev && prev !== inferred) {
                    setCompletedStages((cs) => new Set([...Array.from(cs), prev]));
                  }
                  return inferred;
                });
              }
              if ((ev.type === 'done' || ev.type === 'final_result') && ev.data?.success === true) {
                if (ev.type === 'done') {
                  setCompletedStages(new Set(STAGE_CATALOG.map((s) => s.id)));
                  setCurrentStage('08_DELIVER');
                }
                if (!toastedQueued) {
                  toastedQueued = true;
                  showToast({
                    variant: 'success',
                    title: 'Queued Task Completed',
                    message: ev.data?.goal || 'Highest-priority queued task delivered.',
                    meta: [
                      ev.data?.taskId ? `Task ${ev.data.taskId}` : null,
                      typeof ev.data?.durationMs === 'number' ? `${ev.data.durationMs} ms` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined,
                  });
                }
              }
              if (ev.type === 'final_result') setFinalResult(ev.data);
              if (ev.type === 'error') setLastError(ev.message);
        });
      } else {
        const data = await response.json();
        setFinalResult(data);
        if (data?.success === true) {
          showToast({
            variant: 'success',
            title: 'Queued Task Completed',
            message: data?.goal || 'Highest-priority queued task delivered.',
          });
        }
      }
    } catch (e: any) {
      setLastError(e.message);
    } finally {
      setIsRunning(false);
      loadTasks();
      loadMetrics();
      loadLatestPlan();
      loadWorkspace();
    }
  };

  const openFile = async (name: string) => {
    if (role === 'User') return;
    setSelectedFile(name);
    try {
      const res = await fetch(apiUrl(`/api/workspace/file?path=${encodeURIComponent(name)}`), {
        headers: authHeaders(),
      });
      const data = await res.json();
      setFileContent(data?.content ?? data?.data ?? JSON.stringify(data, null, 2));
    } catch (e: any) {
      setFileContent(`// Failed to load: ${e.message}`);
    }
  };

  const downloadDeliverable = async (filename: string) => {
    try {
      const res = await fetch(apiUrl(`/api/agent/deliverables/${encodeURIComponent(filename)}`), {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setLastError(`Deliverable download failed: ${e.message}`);
    }
  };

  // -----------------------------------------------------------------------
  // Batch selection & deletion for completed tasks
  // -----------------------------------------------------------------------

  const completedTasks = taskList.filter(isTaskCompleted);
  const allCompletedSelected =
    completedTasks.length > 0 && completedTasks.every((t) => selectedTaskIds.has(t.taskId));

  const toggleSelectMode = () => {
    setBatchNotice(null);
    setConfirmBatchDelete(false);
    setSelectedTaskIds(new Set());
    setIsSelectMode((prev) => !prev);
  };

  const toggleTaskSelection = (taskId: string) => {
    setConfirmBatchDelete(false);
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleSelectAllCompleted = () => {
    setConfirmBatchDelete(false);
    if (allCompletedSelected) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(completedTasks.map((t) => t.taskId)));
    }
  };

  const handleBatchDeleteCompleted = async () => {
    if (selectedTaskIds.size === 0 || isBatchDeleting) return;
    setIsBatchDeleting(true);
    setLastError(null);
    setBatchNotice(null);

    try {
      const targetIds = Array.from(selectedTaskIds);
      const res = await fetch(apiUrl('/api/agent/tasks/batch-delete'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ taskIds: targetIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || `Batch delete failed (${res.status})`);
      }

      const deletedSet = new Set<string>(Array.isArray(data.deletedIds) ? data.deletedIds : targetIds);
      if (Array.isArray(data.tasks)) {
        setTaskList(data.tasks);
      } else {
        setTaskList((prev) => prev.filter((t) => !deletedSet.has(t.taskId)));
      }

      const deletedCount = typeof data.deletedCount === 'number' ? data.deletedCount : deletedSet.size;
      setSelectedTaskIds(new Set());
      setConfirmBatchDelete(false);
      setIsSelectMode(false);
      setBatchNotice(`Deleted ${deletedCount} completed task${deletedCount === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setLastError(`Batch delete failed: ${e.message}`);
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const stageStatus = (id: StageId): 'pending' | 'active' | 'done' | 'error' => {
    if (lastError && currentStage === id) return 'error';
    if (completedStages.has(id)) return 'done';
    if (currentStage === id) return 'active';
    return 'pending';
  };

  const deliveredPackage = finalResult?.executionCycle?.packageArtifact ?? finalResult?.packageArtifact ?? null;
  const deliveredFilename = deliveredPackage?.zipFilename ?? deliveredPackage?.filename ?? null;
  const deliveredSha = deliveredPackage?.zipSha256 ?? deliveredPackage?.sha256 ?? null;

  // -----------------------------------------------------------------------
  // UI
  // -----------------------------------------------------------------------

  const handleExportSessionPdf = () => {
    if (events.length === 0) return;
    triggerPrintAudit({
      metadata: buildSystemMetadataSnapshot({
        reportTitle: 'Autonomous Execution Session Audit Log',
        reportSubtitle: 'Live 8-Stage Execution Trace & Verification Summary',
        session,
        role,
        statusData,
        taskId: finalResult?.taskId ?? null,
        goal: finalResult?.goal || goal || null,
        priority: finalResult?.priority || priority,
        executionLatencyMs: typeof finalResult?.durationMs === 'number' ? finalResult.durationMs : null,
        verificationSummary: finalResult
          ? `${finalResult.success ? 'DELIVERED / VERIFIED' : 'BLOCKED / FAILED'} · Stage ${currentStage || '08_DELIVER'}`
          : `Active Stage: ${currentStage || 'In Progress'}`,
        activeFilterSummary: `${events.length} execution trace events`,
      }),
      entries: events.map((ev, i) => ({
        index: i + 1,
        timestamp: ev.timestamp ? ev.timestamp.replace('T', ' ').slice(0, 19) : '—',
        role: ev.role || ev.type.toUpperCase(),
        action: ev.cycleStage || ev.stage || ev.type.toUpperCase(),
        detail: ev.message,
        hash: ev.data?.executionCycle?.packageArtifact?.zipSha256 || deliveredSha || undefined,
      })),
    });
  };

  return (
    <div className="space-y-6 p-1">
      <PrintableSessionAudit payload={printPayload} />
      {/* Header */}
      <div className="rounded-2xl border border-[#1E294A] bg-gradient-to-br from-[#070B19] via-[#0D1326] to-[#15173B] p-5 sm:p-6 text-[#F4F7FF] shadow-lg shadow-black/25">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-mono font-semibold uppercase tracking-[0.16em] text-[#00F0FF]">ZYNTHEOR · Autonomous Execution</p>
            <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">
              Task Command Platform
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[#9AA8C7]">
              สั่งงาน AI ให้ลงมือวิเคราะห์ วางแผน สร้าง ทดสอบ ซ่อมแซม และส่งมอบจริง
              — ไม่ใช่หน้าต่างแชท เชื่อมต่อ API จริงเท่านั้น ไม่จำลองสถานะสำเร็จ
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { loadTasks(); loadMetrics(); loadWorkspace(); }}
              className="min-h-[44px] flex items-center gap-2 rounded-xl border border-[#1E294A] bg-[#131B36] px-4 py-2 text-sm font-medium text-[#F4F7FF] hover:border-[#00F0FF]/60 transition-colors cursor-pointer"
            >
              <RefreshCw className="h-4 w-4 text-[#00F0FF]" /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Error banner (honest) */}
      {lastError && (
        <div className="flex items-start gap-3 rounded-xl border border-[#FF007F]/45 bg-[#FF007F]/10 px-4 py-3 text-sm text-[#FF99C8]">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#FF007F]" />
          <div>
            <div className="font-semibold">Execution / API Error</div>
            <div className="mt-0.5 opacity-90">{lastError}</div>
          </div>
        </div>
      )}

      {/* Informational Priority Queue Notice */}
      {queueNotice && !lastError && (
        <div className="flex items-start gap-3 rounded-xl border border-[#00F0FF]/40 bg-[#00F0FF]/10 px-4 py-3 text-sm text-[#D6FAFF]">
          <ListOrdered className="mt-0.5 h-5 w-5 shrink-0 text-[#00F0FF]" />
          <div className="flex-1">
            <div className="font-semibold text-[#00F0FF]">Priority Queue Empty</div>
            <div className="mt-0.5 opacity-90">{queueNotice}</div>
          </div>
          <button
            type="button"
            onClick={() => setQueueNotice(null)}
            className="text-xs font-mono text-[#9AA8C7] hover:text-white cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* ============================================================
            LEFT: Task Command Center + Pipeline
            ============================================================ */}
        <div className="space-y-6 xl:col-span-2">
          {/* Task Command Center */}
          <VividCard gradientAccent="cyan">
            <div className="mb-3 flex items-center gap-2">
              <Terminal className="h-5 w-5 text-[#00F0FF]" />
              <h2 className="text-lg font-bold text-[var(--app-text-primary)]">Task Command Center</h2>
            </div>
            <p className="mb-3 text-xs text-[var(--app-text-secondary)]">
              ป้อนเป้าหมายทางวิศวกรรม ระบบจะรันวงจร 8 ขั้นผ่าน API จริง
            </p>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Example: Build a resilient in-memory LRU cache with TTL and unit tests"
              rows={3}
              className="w-full resize-none rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-4 py-3 text-sm text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] focus:border-[#00F0FF] focus:outline-none"
              disabled={isRunning}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                disabled={isRunning}
                className="min-h-[44px] rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-3 py-2 text-sm text-[var(--app-text-primary)]"
              >
                <option value="High">Priority: High</option>
                <option value="Medium">Priority: Medium</option>
                <option value="Low">Priority: Low</option>
              </select>
              <input
                type="text"
                value={approvalRequestIdInput}
                onChange={(e) => setApprovalRequestIdInput(e.target.value)}
                disabled={isRunning}
                placeholder="Optional Approval ID (apr_...)"
                className="min-h-[44px] w-48 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] px-3 py-2 text-xs font-mono text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] focus:border-[#00F0FF] focus:outline-none"
              />
              <button
                onClick={() => runGoal('execute')}
                disabled={isRunning || !goal.trim()}
                className="min-h-[44px] flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#00F0FF] to-[#CCFF00] px-5 py-2.5 text-sm font-bold text-[#070B19] hover:brightness-105 disabled:opacity-40 cursor-pointer"
              >
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {isRunning ? 'Executing…' : 'Execute Now'}
              </button>
              <button
                onClick={() => runGoal('queue')}
                disabled={isRunning || !goal.trim()}
                className="min-h-[44px] flex items-center gap-2 rounded-xl border border-[#7B2CBF]/60 bg-[#7B2CBF]/15 px-4 py-2.5 text-sm font-semibold text-[#F4F7FF] hover:bg-[#7B2CBF]/25 disabled:opacity-40 cursor-pointer"
              >
                <ListOrdered className="h-4 w-4 text-[#00F0FF]" /> Enqueue
              </button>
              <button
                onClick={runNextQueued}
                disabled={isRunning || plannedTasks.length === 0}
                title={
                  plannedTasks.length === 0
                    ? 'No Planned tasks in queue — enter a goal and click Enqueue first'
                    : `Run highest-priority Planned task (${plannedTasks.length} queued)`
                }
                className="min-h-[44px] flex items-center gap-2 rounded-xl border border-[#CCFF00]/45 bg-[#CCFF00]/10 px-4 py-2.5 text-sm font-semibold text-[#CCFF00] hover:bg-[#CCFF00]/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" /> Run Next Queued ({plannedTasks.length})
              </button>
            </div>
            {plannedTasks.length === 0 && !isRunning && (
              <p className="mt-2.5 text-[11px] font-mono text-[var(--app-text-secondary)]">
                คิวว่าง (0 Planned) — พิมพ์โจทย์ด้านบนแล้วกด <span className="text-[#00F0FF]">Enqueue</span> เพื่อเพิ่มงานเข้าคิว หรือกด <span className="text-[#CCFF00]">Execute Now</span> เพื่อรันทันที
              </p>
            )}
          </VividCard>

          {/* Execution Pipeline */}
          <VividCard gradientAccent="violet">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-[#7B2CBF]" />
              <h2 className="text-lg font-bold text-[var(--app-text-primary)]">Execution Pipeline</h2>
              <span className="ml-auto text-xs font-mono text-[var(--app-text-secondary)]">8-Stage Cycle</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {STAGE_CATALOG.map((s) => {
                const st = stageStatus(s.id);
                const shortEn = s.labelEn.split(' ')[0];
                const color =
                  st === 'done'
                    ? 'border-[#CCFF00]/55 bg-[#CCFF00]/10 text-[#CCFF00]'
                    : st === 'active'
                    ? 'border-[#00F0FF] bg-[#00F0FF]/12 text-[#00F0FF] ring-1 ring-[#00F0FF]/40'
                    : st === 'error'
                    ? 'border-[#FF007F]/60 bg-[#FF007F]/15 text-[#FF007F]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-input-bg)] text-[var(--app-text-secondary)]';
                return (
                  <div
                    key={s.id}
                    title={`${s.labelEn} / ${s.labelTh}`}
                    className={`rounded-xl border px-2 py-3 text-center transition-colors ${color}`}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="text-[10px] font-mono font-medium opacity-75">{s.id.split('_')[0]}</span>
                      <StatusDot
                        status={
                          st === 'done'
                            ? 'VERIFIED'
                            : st === 'active'
                            ? 'ACTIVE'
                            : st === 'error'
                            ? 'FAILED'
                            : 'NOT RUN'
                        }
                        label={st === 'error' ? 'ERR' : st.toUpperCase()}
                        dotOnly={st !== 'error'}
                        pulse={st === 'active'}
                      />
                    </div>
                    <div className="mt-1.5 text-xs font-semibold leading-tight">{shortEn}</div>
                    <div className="mt-0.5 text-[10px] opacity-70">{s.labelTh}</div>
                  </div>
                );
              })}
            </div>
            {activePlan && (
              <div className="mt-4 rounded-xl border border-[#1E294A] bg-[#070B19] p-3.5 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5 text-[#00F0FF]" />
                    <span className="font-mono font-bold text-[#F4F7FF]">
                      DAG Plan: {activePlan.planId}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#131B36] border border-[#1E294A] font-mono text-[10px] text-[#00F0FF]">
                      {activePlan.status}
                    </span>
                  </div>
                  {activePlan.budget && (
                    <span className="font-mono text-[11px] tabular-nums text-[#9AA8C7]">
                      Tools {activePlan.budget.usedToolCalls}/{activePlan.budget.maxToolCalls} · Retries{' '}
                      {activePlan.budget.usedRetries}/{activePlan.budget.maxRetries} · Revisions{' '}
                      {Array.isArray(activePlan.revisions) ? activePlan.revisions.length : 0}
                    </span>
                  )}
                </div>
                {Array.isArray(activePlan.steps) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {activePlan.steps.map((st: any) => (
                      <div
                        key={st.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[#1E294A] bg-[#0D1326] px-2.5 py-1.5"
                      >
                        <span className="truncate text-[#F4F7FF]">
                          <span className="font-mono text-[10px] text-[#9AA8C7] mr-1.5">P{st.priority}</span>
                          {st.title}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[10px] font-bold ${
                            st.status === 'COMPLETED'
                              ? 'text-[#CCFF00]'
                              : st.status === 'FAILED'
                              ? 'text-[#FF007F]'
                              : 'text-[#00F0FF]'
                          }`}
                        >
                          {st.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </VividCard>

          {/* Live Execution Monitor */}
          <VividCard gradientAccent="coral">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <Terminal className="h-5 w-5 text-[#FF5E3A]" />
              <h2 className="text-lg font-bold text-[var(--app-text-primary)]">Live Execution Monitor</h2>
              <div className="ml-auto flex items-center gap-2.5">
                {events.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportSessionPdf}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-input-bg)] hover:border-[#00F0FF] text-[11px] font-semibold text-[var(--app-text-primary)] transition-colors cursor-pointer"
                    title="Export current session log & metadata as high-contrast PDF"
                  >
                    <Printer className="h-3.5 w-3.5 text-[#00F0FF]" />
                    <span>Export PDF Audit</span>
                  </button>
                )}
                <StatusDot
                  status={isRunning ? 'ACTIVE' : lastError ? 'FAILED' : finalResult?.success ? 'VERIFIED' : 'NOT RUN'}
                  label={isRunning ? 'Live' : lastError ? 'Error' : finalResult?.success ? 'Complete' : 'Idle'}
                  pulse={isRunning}
                />
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-xl border border-[#1E294A] bg-[#070B19] p-3 font-mono text-xs leading-relaxed space-y-1.5">
              {events.length === 0 && !isRunning && (
                <div className="py-8 text-center text-[#9AA8C7]">
                  ยังไม่มี event — กด Execute Now เพื่อเริ่มงานจริงผ่าน API
                </div>
              )}
              {events.map((ev, i) => (
                <div
                  key={i}
                  className={`rounded-lg border px-3 py-1.5 ${
                    ev.type === 'error'
                      ? 'border-[#FF007F]/40 bg-[#FF007F]/10 text-[#FF99C8]'
                      : ev.type === 'done' || ev.type === 'final_result'
                      ? 'border-[#CCFF00]/40 bg-[#CCFF00]/10 text-[#CCFF00]'
                      : 'border-[#1E294A] bg-[#0D1326] text-[#F4F7FF]'
                  }`}
                >
                  <span className="text-[#9AA8C7] tabular-nums">
                    {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : ''}
                  </span>{' '}
                  {ev.role && (
                    <span className="font-semibold text-[#00F0FF]">[{ev.role}] </span>
                  )}
                  <span>{ev.message}</span>
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>
          </VividCard>

          {/* Verification & Delivery */}
          <VividCard gradientAccent="lime">
            <div className="mb-3 flex items-center gap-2">
              <Package className="h-5 w-5 text-[#CCFF00]" />
              <h2 className="text-lg font-bold text-[var(--app-text-primary)]">Verification & Delivery</h2>
            </div>
            {!finalResult && !lastError && (
              <p className="text-sm text-[var(--app-text-secondary)]">
                ผลทดสอบ หลักฐาน และไฟล์ส่งมอบจะปรากฏที่นี่เมื่อรอบ execution เสร็จสิ้น
              </p>
            )}
            {finalResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3 items-center">
                  <span className={`inline-flex items-center gap-2 text-sm font-semibold ${finalResult.success ? 'text-[#CCFF00]' : 'text-[#FF007F]'}`}>
                    {finalResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    {finalResult.success ? 'Completed' : 'Failed'}
                  </span>
                  {finalResult.taskId && (
                    <span className="text-xs text-[var(--app-text-secondary)] font-mono">{finalResult.taskId}</span>
                  )}
                  {finalResult.durationMs != null && (
                    <span className="text-xs font-mono tabular-nums text-[var(--app-text-secondary)]">{finalResult.durationMs} ms</span>
                  )}
                </div>
                {finalResult.plan && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-[var(--app-text-secondary)]">Plan</div>
                    <pre className="max-h-32 overflow-auto rounded-lg border border-[#1E294A] bg-[#070B19] p-3 text-xs text-[#F4F7FF]">
                      {typeof finalResult.plan === 'string'
                        ? finalResult.plan
                        : JSON.stringify(finalResult.plan, null, 2)}
                    </pre>
                  </div>
                )}
                {finalResult.testResult && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-[var(--app-text-secondary)]">Test Result</div>
                    <pre className="max-h-40 overflow-auto rounded-lg border border-[#1E294A] bg-[#070B19] p-3 text-xs text-[#F4F7FF]">
                      exitCode: {finalResult.testResult.exitCode}
                      {'\n'}
                      {finalResult.testResult.stdout || ''}
                      {finalResult.testResult.stderr || ''}
                    </pre>
                  </div>
                )}
                {deliveredFilename && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <button
                      onClick={() => downloadDeliverable(deliveredFilename)}
                      className="inline-flex items-center gap-2 font-semibold text-[#CCFF00] hover:underline cursor-pointer"
                    >
                      <Download className="h-4 w-4" />
                      Download {deliveredFilename}
                    </button>
                    {deliveredSha && (
                      <span className="text-xs font-mono text-[var(--app-text-secondary)]">SHA {deliveredSha.slice(0, 12)}…</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </VividCard>
        </div>

        {/* ============================================================
            RIGHT: Workspace + History + Metrics
            ============================================================ */}
        <div className="space-y-6">
          {/* Metrics snapshot */}
          {metrics && (
            <VividCard gradientAccent="blue">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-[#00F0FF]" />
                <h3 className="font-bold text-[var(--app-text-primary)]">Execution Metrics</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs tabular-nums">
                <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-2.5">
                  <div className="text-lg font-bold font-mono text-[var(--app-text-primary)]">
                    {metrics.totalCycles ?? '—'}
                  </div>
                  <div className="text-[var(--app-text-secondary)]">Total cycles</div>
                </div>
                <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-2.5">
                  <div className="text-lg font-bold font-mono text-[#CCFF00]">
                    {metrics.succeededCycles ?? '—'}
                  </div>
                  <div className="text-[var(--app-text-secondary)]">Succeeded</div>
                </div>
                <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-2.5">
                  <div className="text-lg font-bold font-mono text-[#FF5E3A]">
                    {metrics.selfRepairsAttempted ?? '—'}
                  </div>
                  <div className="text-[var(--app-text-secondary)]">Repairs</div>
                </div>
                <div className="rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)] p-2.5">
                  <div className="text-lg font-bold font-mono text-[#00F0FF]">
                    {Array.isArray(metrics.recentCycles) && metrics.recentCycles.length > 0
                      ? `${Math.round(metrics.recentCycles.reduce((sum: number, cycle: any) => sum + (Number(cycle.durationMs) || 0), 0) / metrics.recentCycles.length)}ms`
                      : '—'}
                  </div>
                  <div className="text-[var(--app-text-secondary)]">Avg duration</div>
                </div>
              </div>
            </VividCard>
          )}

          {/* Project Workspace — API is restricted to Developer / Administrator */}
          {role !== 'User' && <VividCard gradientAccent="coral">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-[#FF5E3A]" />
                <h3 className="font-bold text-[var(--app-text-primary)]">Project Workspace</h3>
              </div>
              <button
                onClick={loadWorkspace}
                className="text-xs text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                disabled={wsLoading}
              >
                {wsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--app-card-border)] bg-[var(--app-input-bg)]">
              {workspaceFiles.length === 0 && (
                <div className="p-4 text-center text-xs text-[var(--app-text-secondary)]">
                  {wsLoading ? 'Loading files…' : 'No files are available yet.'}
                </div>
              )}
              {workspaceFiles.map((f) => (
                <button
                  key={f.name}
                  onClick={() => openFile(f.name)}
                  className={`flex w-full items-center gap-2 border-b border-[var(--app-card-border)] px-3 py-2 text-left text-xs hover:bg-[var(--app-surface-elevated)] cursor-pointer ${
                    selectedFile === f.name ? 'bg-[var(--app-surface-elevated)] text-[#00F0FF] font-semibold' : 'text-[var(--app-text-primary)]'
                  }`}
                >
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
            {selectedFile && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-[#1E294A] bg-[#070B19] p-2.5 text-[10px] leading-relaxed text-[#9AA8C7]">
                {fileContent || '// empty'}
              </pre>
            )}
          </VividCard>}

          {/* Task History */}
          <VividCard gradientAccent="magenta">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#00F0FF]" />
                <h3 className="font-bold text-[var(--app-text-primary)]">Task History</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectMode}
                  disabled={completedTasks.length === 0 && !isSelectMode}
                  title={
                    completedTasks.length === 0 && !isSelectMode
                      ? 'No completed tasks available to select'
                      : isSelectMode
                      ? 'Exit multi-select mode'
                      : 'Select multiple completed tasks'
                  }
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isSelectMode
                      ? 'border-[#00F0FF]/60 bg-[#00F0FF]/15 text-[#00F0FF] hover:bg-[#00F0FF]/25'
                      : 'border-[var(--app-card-border)] bg-[var(--app-input-bg)] text-[var(--app-text-primary)] hover:border-[#00F0FF]/50'
                  }`}
                >
                  {isSelectMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
                  {isSelectMode ? 'Cancel' : 'Select Multiple'}
                </button>
                <button
                  type="button"
                  onClick={loadTasks}
                  className="text-xs text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                  disabled={historyLoading || isBatchDeleting}
                >
                  {historyLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            {batchNotice && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-[#CCFF00]/45 bg-[#CCFF00]/10 px-3 py-2 text-xs text-[#CCFF00]">
                <span>{batchNotice}</span>
                <button
                  type="button"
                  onClick={() => setBatchNotice(null)}
                  className="rounded p-0.5 hover:bg-white/10 cursor-pointer"
                  aria-label="Dismiss notice"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {isSelectMode && (
              <div className="mb-3 space-y-2 rounded-xl border border-[#1E294A] bg-[#070B19] p-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium text-[#00F0FF] tabular-nums">
                    {selectedTaskIds.size}/{completedTasks.length} completed selected
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleSelectAllCompleted}
                      disabled={completedTasks.length === 0 || isBatchDeleting}
                      className="rounded-md border border-[#1E294A] bg-[#131B36] px-2 py-1 text-[11px] font-medium text-[#F4F7FF] hover:border-[#00F0FF]/50 cursor-pointer disabled:opacity-40"
                    >
                      {allCompletedSelected ? 'Deselect All' : 'Select All Completed'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmBatchDelete(true)}
                      disabled={selectedTaskIds.size === 0 || isBatchDeleting}
                      className="flex items-center gap-1 rounded-md border border-[#FF007F]/50 bg-[#FF007F]/20 px-2.5 py-1 text-[11px] font-semibold text-[#FF99C8] hover:bg-[#FF007F]/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete Selected ({selectedTaskIds.size})
                    </button>
                  </div>
                </div>
                {confirmBatchDelete && selectedTaskIds.size > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#FF007F]/45 bg-[#FF007F]/15 px-2.5 py-2 text-[11px] text-[#FF99C8]">
                    <span>
                      Delete {selectedTaskIds.size} completed task{selectedTaskIds.size === 1 ? '' : 's'}?
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmBatchDelete(false)}
                        disabled={isBatchDeleting}
                        className="rounded border border-[#1E294A] bg-[#131B36] px-2 py-0.5 text-[#F4F7FF] hover:bg-[#1E294A] cursor-pointer"
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        onClick={handleBatchDeleteCompleted}
                        disabled={isBatchDeleting}
                        className="flex items-center gap-1 rounded bg-[#FF007F] px-2.5 py-0.5 font-semibold text-white hover:brightness-110 cursor-pointer disabled:opacity-50"
                      >
                        {isBatchDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
                        {isBatchDeleting ? 'Deleting…' : 'Confirm Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="max-h-72 space-y-2 overflow-y-auto">
              {taskList.length === 0 && (
                <div className="py-6 text-center text-xs text-[var(--app-text-secondary)]">
                  ยังไม่มีประวัติงาน (หรือยังโหลดจาก API ไม่ได้)
                </div>
              )}
              {taskList.map((t) => {
                const completed = isTaskCompleted(t);
                const selected = selectedTaskIds.has(t.taskId);
                return (
                  <div
                    key={t.taskId}
                    onClick={() => {
                      if (isSelectMode && completed && !isBatchDeleting) {
                        toggleTaskSelection(t.taskId);
                      }
                    }}
                    className={`rounded-xl border p-3 text-xs transition-colors ${
                      isSelectMode && completed
                        ? selected
                          ? 'cursor-pointer border-[#00F0FF]/70 bg-[#00F0FF]/10 ring-1 ring-[#00F0FF]/30'
                          : 'cursor-pointer border-[var(--app-card-border)] bg-[var(--app-input-bg)] hover:border-[#00F0FF]/40'
                        : isSelectMode && !completed
                        ? 'border-[var(--app-card-border)] bg-[var(--app-input-bg)] opacity-60'
                        : 'border-[var(--app-card-border)] bg-[var(--app-input-bg)]'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isSelectMode && (
                          <button
                            type="button"
                            disabled={!completed || isBatchDeleting}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (completed) toggleTaskSelection(t.taskId);
                            }}
                            aria-label={`Select task ${t.taskId}`}
                            aria-pressed={selected}
                            title={
                              completed
                                ? 'Toggle task selection'
                                : 'Only completed tasks can be selected for batch deletion'
                            }
                            className="shrink-0 text-[var(--app-text-secondary)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                          >
                            {selected ? (
                              <CheckSquare className="h-4 w-4 text-[#00F0FF]" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        )}
                        <span className="truncate font-mono text-[10px] text-[var(--app-text-secondary)]">{t.taskId}</span>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-semibold ${
                          t.lifecycleStatus === 'Delivered' || t.success
                            ? 'text-[#CCFF00]'
                            : t.lifecycleStatus === 'Failed' || t.success === false
                            ? 'text-[#FF007F]'
                            : 'text-[var(--app-text-secondary)]'
                        }`}
                      >
                        {t.lifecycleStatus || (t.success ? 'OK' : '—')}
                      </span>
                    </div>
                    <div className="line-clamp-2 text-[var(--app-text-primary)]">{t.goal}</div>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--app-text-secondary)]">
                      <span>{t.priority}</span>
                      {(t.packageArtifact?.zipFilename || t.packageArtifact?.filename) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadDeliverable((t.packageArtifact!.zipFilename || t.packageArtifact!.filename)!);
                          }}
                          className="flex items-center gap-1 text-[#00F0FF] hover:underline cursor-pointer"
                        >
                          <Download className="h-3 w-3" /> Artifact
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </VividCard>
        </div>
      </div>

      {/* Footer note */}
      <p className="text-center text-[11px] text-[var(--app-text-secondary)]">
        หน้านี้เชื่อมต่อเฉพาะ REST API จริงของ Autonomous Execution Engine
        — ไม่มีการจำลองสถานะสำเร็จเมื่อ engine ยังไม่ทำงาน
      </p>
    </div>
  );
};

export default AutonomousExecutionDashboard;
