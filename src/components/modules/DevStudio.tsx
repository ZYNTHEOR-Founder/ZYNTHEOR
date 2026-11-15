import React, { useState, useEffect, useRef } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusBadge } from '../ui/StatusBadge';
import { BenchmarkArena } from './BenchmarkArena';
import { OrchestrationEvent, WorkspaceFileDetail } from '../../types';
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
  History
} from 'lucide-react';

interface AuditRecord {
  index: number;
  timestamp: string;
  prev_hash: string;
  role: string;
  action: string;
  payload_digest: string;
  entry_hash: string;
}

export const DevStudio: React.FC = () => {
  const [goal, setGoal] = useState('Build a resilient In-Memory LRU Cache with TTL and unit test verification');
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<OrchestrationEvent[]>([]);
  const [activeTab, setActiveTab] = useState<'editor' | 'terminal' | 'sandbox' | 'audit' | 'benchmarks'>('editor');
  const [selectedFile, setSelectedFile] = useState<string>('solution.js');
  const [fileContent, setFileContent] = useState<string>('// Select or generate code to inspect');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileDetail[]>([]);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  // Active Role State Tracker
  const [activeAgentRole, setActiveAgentRole] = useState<'IDLE' | 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER'>('IDLE');
  const [roleStatuses, setRoleStatuses] = useState<Record<string, 'IDLE' | 'ACTIVE' | 'SUCCESS' | 'RETRY' | 'ERROR'>>({
    PLANNER: 'IDLE',
    CODER: 'IDLE',
    REVIEWER: 'IDLE',
    TESTER: 'IDLE'
  });

  // Sandbox Runner State
  const [sandboxCmd, setSandboxCmd] = useState('node');
  const [sandboxArgs, setSandboxArgs] = useState('solution.js');
  const [isExecutingSandbox, setIsExecutingSandbox] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<any>(null);

  // Audit Records State
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [auditChainValid, setAuditChainValid] = useState<boolean | null>(null);

  // Terminal Filter State
  const [terminalRoleFilter, setTerminalRoleFilter] = useState<'ALL' | 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER'>('ALL');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const presets = [
    { label: 'In-Memory LRU Cache', goal: 'Build a resilient In-Memory LRU Cache with TTL and unit test verification' },
    { label: 'Matrix Multiplier', goal: 'Synthesize a high-throughput Float64 matrix multiplication engine with dimension assertion' },
    { label: 'Cryptographic Token Validator', goal: 'Create a sovereign cryptographic token validator with HMAC-SHA256 signature verification' }
  ];

  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/workspace/files');
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
    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(fileName)}`);
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
      const res = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(fileName)}`, {
        method: 'DELETE'
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
      const res = await fetch('/api/workspace/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    try {
      const res = await fetch('/api/audit?limit=25');
      const data = await res.json();
      if (data.success) {
        setAuditRecords(data.records || []);
        setAuditChainValid(data.integrity?.valid ?? true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchFiles();
    fetchAuditRecords();
  }, []);

  const handleRunAgent = async () => {
    if (!goal || isRunning) return;
    setIsRunning(true);
    setEvents([]);
    setActiveAgentRole('PLANNER');
    setRoleStatuses({
      PLANNER: 'ACTIVE',
      CODER: 'IDLE',
      REVIEWER: 'IDLE',
      TESTER: 'IDLE'
    });
    setActiveTab('terminal');

    try {
      const response = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal })
      });

      if (!response.body) {
        throw new Error('No readable stream returned from /api/agent/execute');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev: OrchestrationEvent = JSON.parse(line);
            setEvents((prev) => [...prev, ev]);

            // Update role active states
            if (ev.role) {
              setActiveAgentRole(ev.role);
              setRoleStatuses((prev) => {
                const updated = { ...prev };
                if (ev.role === 'PLANNER') {
                  updated.PLANNER = ev.type === 'step' && ev.message.includes('ready') ? 'SUCCESS' : 'ACTIVE';
                } else if (ev.role === 'CODER') {
                  updated.PLANNER = 'SUCCESS';
                  updated.CODER = 'ACTIVE';
                } else if (ev.role === 'REVIEWER') {
                  updated.CODER = 'SUCCESS';
                  if (ev.data?.reviewStatus === 'APPROVED') {
                    updated.REVIEWER = 'SUCCESS';
                  } else if (ev.data?.reviewStatus === 'REJECTED') {
                    updated.REVIEWER = 'RETRY';
                  } else {
                    updated.REVIEWER = 'ACTIVE';
                  }
                } else if (ev.role === 'TESTER') {
                  updated.REVIEWER = 'SUCCESS';
                  if (ev.type === 'test') {
                    updated.TESTER = ev.data?.exitCode === 0 ? 'SUCCESS' : 'ERROR';
                  } else {
                    updated.TESTER = 'ACTIVE';
                  }
                }
                return updated;
              });
            }

            if (ev.type === 'done') {
              setActiveAgentRole('IDLE');
              setRoleStatuses((prev) => ({
                ...prev,
                TESTER: 'SUCCESS'
              }));
            }

            if (terminalEndRef.current) {
              terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
          } catch (err) {
            console.error('Failed to parse NDJSON line:', line);
          }
        }
      }

      await fetchFiles();
      await fetchFileContent('solution.js');
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

  return (
    <div className="space-y-6">
      {/* Task Dispatcher Toolbar */}
      <VividCard className="!p-4" gradientAccent="emerald">
        <div className="space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Enter software engineering goal for Multi-Agent Orchestrator..."
              className="flex-1 px-4 py-2.5 text-xs md:text-sm bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] font-medium text-[var(--app-text-primary)] placeholder-[#A7BDB2]/60"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleRunAgent}
                disabled={isRunning}
                className="flex items-center gap-2 px-6 py-2.5 text-xs md:text-sm font-bold text-[var(--app-text-primary)] vivid-gradient-emerald rounded-xl shadow-md  hover:opacity-95 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>{isRunning ? `Orchestrating (${activeAgentRole})...` : 'Execute Sovereign Multi-Agent'}</span>
              </button>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--app-text-secondary)] font-semibold text-[11px] ">Goal Presets:</span>
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setGoal(preset.goal)}
                className="px-2.5 py-1 rounded-lg bg-[var(--app-surface-elevated)] hover:bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-accent)] transition-colors text-[11px] font-medium cursor-pointer"
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
            className="!p-4"
            headerAction={
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsCreatingFile(!isCreatingFile)}
                  title="New File"
                  className="p-1 rounded-lg hover:bg-[var(--app-surface-elevated)] text-[var(--app-accent)] transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={fetchFiles}
                  title="Refresh Files"
                  className="p-1 rounded-lg hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            }
          >
            {/* Create File Form */}
            {isCreatingFile && (
              <form onSubmit={handleCreateFile} className="mb-3 p-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-2">
                <input
                  type="text"
                  required
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="e.g. validator.js or test.py"
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-lg text-[var(--app-text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
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
                    className="px-2.5 py-1 text-[11px] font-bold text-white bg-[var(--z-ok)] rounded-lg hover:bg-[var(--z-ok)] cursor-pointer"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold text-[var(--app-text-secondary)] ">
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
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] font-bold border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <button
                      onClick={() => fetchFileContent(file.path)}
                      className="flex items-center gap-2 truncate text-left flex-1 cursor-pointer"
                    >
                      <FileCode className="w-3.5 h-3.5 shrink-0 text-[var(--app-accent)]" />
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
                        className="opacity-0 group-hover:opacity-100 p-1 text-[var(--z-danger)] hover:text-[var(--z-danger)] transition-opacity cursor-pointer"
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
          <VividCard title="Multi-Agent 4-Role State" subtitle="Real-Time State Machine (Zero-Mock)" className="!p-4">
            <div className="space-y-2 text-xs">
              {/* Role 1: PLANNER */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                roleStatuses.PLANNER === 'ACTIVE'
                  ? 'bg-[color-mix(in_srgb,var(--z-ok)_60%,transparent)] border-[var(--z-ok)] shadow-sm '
                  : roleStatuses.PLANNER === 'SUCCESS'
                  ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                  : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[var(--z-ok)] flex items-center gap-1.5">
                    1. PLANNER
                    {roleStatuses.PLANNER === 'ACTIVE' && <Activity className="w-3 h-3 text-[var(--z-ok)] animate-pulse" />}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    roleStatuses.PLANNER === 'SUCCESS' ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)]' : 'text-[var(--app-text-secondary)]'
                  }`}>
                    {roleStatuses.PLANNER}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">Formulates step-by-step sovereign architecture</div>
              </div>

              {/* Role 2: CODER */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                roleStatuses.CODER === 'ACTIVE'
                  ? 'bg-[color-mix(in_srgb,var(--app-amber)_60%,transparent)] border-[var(--app-amber)] shadow-sm shadow-amber-900/40'
                  : roleStatuses.CODER === 'SUCCESS'
                  ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                  : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[var(--app-amber)] flex items-center gap-1.5">
                    2. CODER
                    {roleStatuses.CODER === 'ACTIVE' && <Activity className="w-3 h-3 text-[var(--app-amber)] animate-pulse" />}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    roleStatuses.CODER === 'SUCCESS' ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)]' : 'text-[var(--app-text-secondary)]'
                  }`}>
                    {roleStatuses.CODER}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">Synthesizes executable code via streaming</div>
              </div>

              {/* Role 3: REVIEWER */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                roleStatuses.REVIEWER === 'ACTIVE'
                  ? 'bg-[color-mix(in_srgb,var(--z-ok)_60%,transparent)] border-[var(--z-ok)] shadow-sm shadow-teal-900/40'
                  : roleStatuses.REVIEWER === 'RETRY'
                  ? 'bg-[color-mix(in_srgb,var(--app-amber)_60%,transparent)] border-[var(--app-amber)]'
                  : roleStatuses.REVIEWER === 'SUCCESS'
                  ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                  : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[var(--z-ok)] flex items-center gap-1.5">
                    3. REVIEWER
                    {roleStatuses.REVIEWER === 'ACTIVE' && <Activity className="w-3 h-3 text-[var(--z-ok)] animate-pulse" />}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    roleStatuses.REVIEWER === 'SUCCESS'
                      ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)]'
                      : roleStatuses.REVIEWER === 'RETRY'
                      ? 'bg-[color-mix(in_srgb,var(--app-amber)_20%,transparent)] text-[var(--app-amber)]'
                      : 'text-[var(--app-text-secondary)]'
                  }`}>
                    {roleStatuses.REVIEWER}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">Validates security invariants & no-eval policy</div>
              </div>

              {/* Role 4: TESTER */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                roleStatuses.TESTER === 'ACTIVE'
                  ? 'bg-[color-mix(in_srgb,var(--z-ok)_60%,transparent)] border-[var(--z-ok)] shadow-sm '
                  : roleStatuses.TESTER === 'SUCCESS'
                  ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                  : roleStatuses.TESTER === 'ERROR'
                  ? 'bg-[color-mix(in_srgb,var(--z-danger)_60%,transparent)] border-[var(--z-danger)]'
                  : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[var(--z-ok)] flex items-center gap-1.5">
                    4. TESTER
                    {roleStatuses.TESTER === 'ACTIVE' && <Activity className="w-3 h-3 text-[var(--z-ok)] animate-pulse" />}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    roleStatuses.TESTER === 'SUCCESS'
                      ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)]'
                      : roleStatuses.TESTER === 'ERROR'
                      ? 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)]'
                      : 'text-[var(--app-text-secondary)]'
                  }`}>
                    {roleStatuses.TESTER}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">Runs sandbox execution via ToolGateway</div>
              </div>
            </div>
          </VividCard>
        </div>

        {/* Center / Main Column: Code Editor, Terminal, Sandbox & Audit (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-[var(--app-surface-elevated)] rounded-2xl border border-[var(--app-card-border)] shadow-sm overflow-hidden">
            {/* Tab Bar */}
            <div className="px-4 py-2.5 border-b border-[var(--app-card-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--app-surface)]">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setActiveTab('editor')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'editor'
                      ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] shadow-sm border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                      : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Editor ({selectedFile || 'None'})</span>
                  {hasUnsavedChanges && <span className="w-2 h-2 rounded-full bg-[var(--app-amber)]" title="Unsaved changes" />}
                </button>

                <button
                  onClick={() => setActiveTab('terminal')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                    activeTab === 'terminal'
                      ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] shadow-sm border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                      : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Agent Stream ({events.length})</span>
                </button>

                <button
                  onClick={() => setActiveTab('sandbox')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                    activeTab === 'sandbox'
                      ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] shadow-sm border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                      : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 text-[var(--app-amber)]" />
                  <span>Sandbox Runner</span>
                </button>

                <button
                  onClick={() => setActiveTab('benchmarks')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                    activeTab === 'benchmarks'
                      ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] shadow-sm border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                      : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                  <span>Battle Arena</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('audit');
                    fetchAuditRecords();
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                    activeTab === 'audit'
                      ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] shadow-sm border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                      : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  }`}
                >
                  <History className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                  <span>Audit Trail</span>
                </button>
              </div>

              {/* Editor Actions */}
              {activeTab === 'editor' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveFile}
                    disabled={isSaving || !hasUnsavedChanges}
                    className={`flex items-center gap-1 text-xs px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      hasUnsavedChanges
                        ? 'bg-[var(--z-ok)] hover:bg-[var(--z-ok)] text-white shadow-sm'
                        : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'}</span>
                  </button>

                  <button
                    onClick={copyCode}
                    className="flex items-center gap-1 text-xs text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] px-2 py-1 rounded hover:bg-[var(--app-surface-elevated)] cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[var(--z-ok)]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Evidence-gated L1-L4 benchmark workspace */}
            {activeTab === 'benchmarks' && (
              <div className="p-4 bg-[var(--app-bg)] min-h-[460px]">
                <BenchmarkArena />
              </div>
            )}

            {/* TAB 1: SOURCE EDITOR */}
            {activeTab === 'editor' && (
              <div className="p-0 bg-[var(--app-bg)] flex flex-col min-h-[460px]">
                <div className="px-4 py-1.5 bg-[var(--app-surface)] border-b border-[var(--app-card-border)] text-[11px] font-mono text-[var(--app-text-secondary)] flex items-center justify-between">
                  <span>Target: /workspace/{selectedFile || 'solution.js'}</span>
                  <span>{fileContent.split('\n').length} lines · {new TextEncoder().encode(fileContent).length} bytes</span>
                </div>
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full flex-1 p-4 bg-[var(--app-bg)] text-[var(--app-text-primary)] font-mono text-xs leading-relaxed focus:outline-none resize-none min-h-[420px]"
                  placeholder="// Type code here or execute an agent to generate..."
                />
              </div>
            )}

            {/* TAB 2: LIVE AGENT STREAM */}
            {activeTab === 'terminal' && (
              <div className="p-4 bg-[var(--app-bg)] text-[var(--app-text-primary)] font-mono text-xs overflow-y-auto max-h-[480px] min-h-[460px] space-y-3">
                <div className="flex flex-wrap items-center justify-between pb-2 border-b border-[var(--app-card-border)] gap-2">
                  <span className="text-[var(--app-text-secondary)] text-[11px] font-bold">
                    === 4-AGENT ORCHESTRATION EVENT STREAM ===
                  </span>
                  {/* Role filter pills */}
                  <div className="flex items-center gap-1 text-[10px]">
                    {(['ALL', 'PLANNER', 'CODER', 'REVIEWER', 'TESTER'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setTerminalRoleFilter(r)}
                        className={`px-2 py-0.5 rounded cursor-pointer ${
                          terminalRoleFilter === r
                            ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] font-bold border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                            : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredEvents.length === 0 ? (
                  <div className="text-[color-mix(in_srgb,var(--app-text-secondary)_60%,transparent)] text-center py-16 italic">
                    Ready to stream. Click "Execute Sovereign Multi-Agent" above to initiate.
                  </div>
                ) : (
                  filteredEvents.map((ev, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-[color-mix(in_srgb,var(--app-text-secondary)_80%,transparent)] font-mono">[{ev.timestamp.slice(11, 19)}]</span>
                        {ev.role && (
                          <span
                            className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                              ev.role === 'PLANNER'
                                ? 'bg-[var(--z-ok)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_50%,transparent)]'
                                : ev.role === 'CODER'
                                ? 'bg-[var(--app-amber)] text-[var(--app-amber)] border border-[color-mix(in_srgb,var(--app-amber)_50%,transparent)]'
                                : ev.role === 'REVIEWER'
                                ? 'bg-[var(--z-ok)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_50%,transparent)]'
                                : 'bg-[var(--z-ok)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_50%,transparent)]'
                            }`}
                          >
                            {ev.role}
                          </span>
                        )}
                        <span className={ev.type === 'error' ? 'text-[var(--z-danger)] font-bold' : 'text-[var(--app-text-primary)]'}>
                          {ev.message}
                        </span>
                      </div>
                      {ev.data?.stdout && (
                        <div className="ml-4 p-2 bg-[var(--app-surface)] rounded border border-[var(--app-card-border)] text-[11px] text-[var(--app-accent)] whitespace-pre-wrap">
                          {ev.data.stdout}
                        </div>
                      )}
                      {ev.data?.stderr && (
                        <div className="ml-4 p-2 bg-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] rounded border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] text-[11px] text-[var(--z-danger)] whitespace-pre-wrap">
                          {ev.data.stderr}
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
              <div className="p-4 bg-[var(--app-bg)] space-y-4 min-h-[460px]">
                <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-3">
                  <div className="text-xs font-bold text-[var(--app-text-primary)] flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[var(--app-amber)]" />
                    <span>Execute Sandbox Command via ToolGateway</span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={sandboxCmd}
                      onChange={(e) => setSandboxCmd(e.target.value)}
                      className="px-3 py-2 bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl text-xs text-[var(--app-text-primary)] font-mono focus:outline-none focus:border-[var(--app-accent)]"
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
                      className="flex-1 px-3 py-2 bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl text-xs text-[var(--app-text-primary)] font-mono focus:outline-none focus:border-[var(--app-accent)]"
                    />

                    <button
                      onClick={handleRunSandbox}
                      disabled={isExecutingSandbox}
                      className="px-5 py-2 text-xs font-bold text-white bg-[var(--app-amber)] hover:bg-[var(--app-amber)] rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>{isExecutingSandbox ? 'Executing...' : 'Run in Sandbox'}</span>
                    </button>
                  </div>
                </div>

                {/* Sandbox Output Console */}
                {sandboxResult && (
                  <div className="p-4 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between text-[11px] pb-1 border-b border-[var(--app-card-border)]">
                      <span className="font-bold text-[var(--app-text-primary)]">
                        Exit Code: <span className={sandboxResult.exitCode === 0 ? 'text-[var(--app-accent)]' : 'text-[var(--z-danger)]'}>{sandboxResult.exitCode}</span>
                      </span>
                      <span className="text-[var(--app-text-secondary)]">Duration: {sandboxResult.durationMs ?? 0} ms</span>
                    </div>

                    {sandboxResult.stdout && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-[var(--app-accent)] font-bold">Standard Output (STDOUT):</div>
                        <pre className="p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-accent)] whitespace-pre-wrap overflow-x-auto">
                          {sandboxResult.stdout}
                        </pre>
                      </div>
                    )}

                    {sandboxResult.stderr && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-[var(--z-danger)] font-bold">Standard Error (STDERR):</div>
                        <pre className="p-3 rounded-lg bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] text-[var(--z-danger)] whitespace-pre-wrap overflow-x-auto">
                          {sandboxResult.stderr}
                        </pre>
                      </div>
                    )}

                    {sandboxResult.error && (
                      <div className="p-3 rounded-lg bg-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] border border-[var(--z-danger)] text-[var(--z-danger)]">
                        {sandboxResult.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: SOVEREIGNTY AUDIT TRAIL */}
            {activeTab === 'audit' && (
              <div className="p-4 bg-[var(--app-bg)] space-y-3 min-h-[460px] max-h-[480px] overflow-y-auto">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--app-card-border)]">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[var(--app-accent)]" />
                    <span className="text-xs font-bold text-[var(--app-text-primary)]">SHA-256 Chained Audit Ledger</span>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                    auditChainValid ? 'bg-[color-mix(in_srgb,var(--z-ok)_20%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]' : 'bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] text-[var(--z-danger)]'
                  }`}>
                    {auditChainValid ? 'CHAIN VALID' : 'TAMPER DETECTED'}
                  </span>
                </div>

                <div className="space-y-2">
                  {auditRecords.map((rec) => (
                    <div
                      key={rec.index}
                      className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] font-mono text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[var(--app-accent)]">
                          #{rec.index} · {rec.action}
                        </span>
                        <span className="text-[var(--app-text-secondary)] text-[10px]">
                          [{rec.timestamp.slice(11, 19)}]
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[var(--app-text-secondary)]">
                        <span>Role: <strong className="text-[var(--app-text-primary)]">{rec.role}</strong></span>
                        <span className="truncate max-w-[200px]" title={rec.entry_hash}>
                          Hash: {rec.entry_hash.slice(0, 16)}...
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Execution Evidence & Test Assertions (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          <VividCard title="Sandbox Verification" subtitle="ToolGateway Invariant Assertions" className="!p-4">
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                <div className="flex items-center justify-between font-bold text-[var(--app-text-primary)]">
                  <span>Execution Barrier</span>
                  <span className="text-[var(--app-accent)] font-mono">5000ms</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)]">
                  Hardware timeout kill enforced
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                <div className="flex items-center justify-between font-bold text-[var(--app-text-primary)]">
                  <span>Sovereignty Audit</span>
                  <span className="text-[var(--app-accent)] font-mono">ENFORCED</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)]">
                  Appended to native_data/audit_log.jsonl
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                <div className="flex items-center justify-between font-bold text-[var(--app-text-primary)]">
                  <span>Sandbox Directory</span>
                  <span className="text-[var(--app-amber)] font-mono">/workspace</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)]">
                  Zero path traversal escape allowed
                </div>
              </div>
            </div>
          </VividCard>

          {/* Honest Architecture Disclosure Card */}
          <VividCard title="Native Model Attribution" subtitle="Zero-Fake Engineering Baseline" className="!p-4">
            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                <div className="flex items-center justify-between font-bold text-[var(--app-text-primary)]">
                  <span>Model Topology</span>
                  <span className="text-[var(--app-accent)] font-mono">41.5M TARGET</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)]">
                  10 Layers · 8 Heads · 512D · SwiGLU
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                <div className="flex items-center justify-between font-bold text-[var(--app-text-primary)]">
                  <span>Checkpoint Status</span>
                  <span className="text-[var(--app-amber)] font-mono text-[10px] font-bold">PARTIAL</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)]">
                  Seed descriptor only; not a loadable tensor checkpoint.
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                <div className="flex items-center justify-between font-bold text-[var(--app-text-primary)]">
                  <span>Autograd Subgraph</span>
                  <span className="text-[var(--app-amber)] font-mono text-[10px] font-bold">IMPLEMENTED</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-secondary)]">
                  Gradient implementation is present; full numerical-gradient regression evidence is pending
                </div>
              </div>
            </div>
          </VividCard>
        </div>
      </div>
    </div>
  );
};
