import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VividCard } from '../ui/VividCard';
import { StatusBadge, StatusDot, MinimalIndicatorState } from '../ui/StatusBadge';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { BenchmarkArena } from './BenchmarkArena';
import { ProjectExplorer, ProjectFileEntry } from '../Workspace/ProjectExplorer';
import { OrchestrationEvent, SoftwareProjectRecord, WorkspaceFileDetail } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  Play,
  FileCode,
  Terminal,
  ShieldCheck,
  Check,
  Copy,
  Save,
  Trash2,
  Plus,
  RefreshCw,
  Activity,
  History,
  GitBranch,
  UploadCloud,
  AlertTriangle,
  FolderGit2,
  Eye,
  Wrench,
  Download,
  RotateCcw,
  Database,
  Layers,
  Rocket
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

interface DeliveryTargetInfo {
  id: string;
  labelTh: string;
  labelEn: string;
  status: string;
  detailTh: string;
  detailEn: string;
}

interface PreviewPayloadState {
  rawHtml: string;
  html: string;
  endpoints: Array<{ method: string; path: string; purpose: string }>;
}

interface DatabaseInspectState {
  projectId: string;
  stack: string;
  persistenceMode: string;
  cloudSqlConfigured: boolean;
  schema: Record<string, unknown> | null;
  dataFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
  databaseIntegrations: Array<any>;
}

export interface DevStudioProps {
  initialProjectId?: string | null;
}

function mapStatusToDotState(raw: string | undefined | null): MinimalIndicatorState {
  const s = (raw || '').toUpperCase();
  if (s === 'VERIFIED' || s === 'DEPLOYED' || s === 'COMPLETED' || s === 'DELIVERED') return 'VERIFIED';
  if (s === 'IMPLEMENTED') return 'IMPLEMENTED';
  if (s === 'PARTIAL' || s === 'PENDING_APPROVAL' || s === 'PENDING' || s === 'REPAIRED') return 'PARTIAL';
  if (s === 'BLOCKED' || s === 'FAILED') return s as MinimalIndicatorState;
  if (s === 'NOT_CONFIGURED' || s === 'NOT_IMPLEMENTED') return s as MinimalIndicatorState;
  return 'UNVERIFIED';
}

export const DevStudio: React.FC<DevStudioProps> = ({ initialProjectId = null }) => {
  const { authHeaders, authReady, isAuthenticated, role } = useAuth();
  const { lang } = useLanguage();
  const th = lang === 'th';
  const isDevOrAdmin = role === 'Developer' || role === 'Administrator';

  const [workspaceMode, setWorkspaceMode] = useState<'app_projects' | 'sandbox'>('app_projects');

  // --- App Projects (SoftwareProjectManager) State ---
  const [projects, setProjects] = useState<SoftwareProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId);
  const [selectedProject, setSelectedProject] = useState<SoftwareProjectRecord | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [selectedProjectFilePath, setSelectedProjectFilePath] = useState<string>('');
  const [projectFileContent, setProjectFileContent] = useState<string>('');
  const [projectFileOriginal, setProjectFileOriginal] = useState<string>('');
  const [loadingProjectFilePath, setLoadingProjectFilePath] = useState<string | null>(null);
  const [projectTab, setProjectTab] = useState<'code' | 'preview' | 'pipeline' | 'database'>('code');
  const [projectPrompt, setProjectPrompt] = useState<string>(
    'สร้างเว็บแอปจัดการคลินิกและการนัดหมายพร้อมระบบค้นหาและแดชบอร์ดสรุปผล'
  );
  const [projectStack, setProjectStack] = useState<'node_fullstack' | 'node_api' | 'python_service' | 'static_web'>('node_fullstack');
  const [projectBusyAction, setProjectBusyAction] = useState<string | null>(null);
  const [projectNotice, setProjectNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [previewPayload, setPreviewPayload] = useState<PreviewPayloadState | null>(null);
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseInspectState | null>(null);
  const [deliveryTargets, setDeliveryTargets] = useState<DeliveryTargetInfo[]>([]);
  const projectPromptInputRef = useRef<HTMLInputElement | null>(null);

  // --- Legacy Sandbox & Multi-Agent State ---
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
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState<{ kind: 'project' | 'workspace'; path: string } | null>(null);
  const [deleteTargetError, setDeleteTargetError] = useState<string | null>(null);

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

  // GitHub Sync State (GitHub-First Workflow)
  const [githubPanelOpen, setGithubPanelOpen] = useState(false);
  const [githubStatus, setGithubStatus] = useState<any>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubSyncing, setGithubSyncing] = useState(false);
  const [githubBranchInput, setGithubBranchInput] = useState('tidy-root');
  const [githubCommitMessage, setGithubCommitMessage] = useState('chore(zyntheor): sync workspace changes from DevStudio');
  const [githubSyncScope, setGithubSyncScope] = useState<'all_safe' | 'workspace_only'>('all_safe');
  const [githubSyncResult, setGithubSyncResult] = useState<any>(null);

  // Terminal Filter State
  const [terminalRoleFilter, setTerminalRoleFilter] = useState<'ALL' | 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER'>('ALL');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const presets = [
    {
      label: th ? 'LRU Cache ในหน่วยความจำ' : 'In-Memory LRU Cache',
      goal: 'Build a resilient In-Memory LRU Cache with TTL and unit test verification'
    },
    {
      label: th ? 'ตัวคูณเมทริกซ์ Float64' : 'Matrix Multiplier',
      goal: 'Synthesize a high-throughput Float64 matrix multiplication engine with dimension assertion'
    },
    {
      label: th ? 'ตัวตรวจสอบโทเคน HMAC-SHA256' : 'Cryptographic Token Validator',
      goal: 'Create a sovereign cryptographic token validator with HMAC-SHA256 signature verification'
    }
  ];

  // --- App Projects API Handlers ---
  const loadProjectFile = useCallback(async (projectId: string, relPath: string) => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    setLoadingProjectFilePath(relPath);
    try {
      const res = await fetch(
        `/api/engineering/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(relPath)}`,
        { headers: authHeaders(), cache: 'no-store' }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setSelectedProjectFilePath(relPath);
        setProjectFileContent(data.content ?? '');
        setProjectFileOriginal(data.content ?? '');
      }
    } catch (err: any) {
      setProjectNotice({ kind: 'err', text: err?.message || 'Unable to load project file.' });
    } finally {
      setLoadingProjectFilePath(null);
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin]);

  const loadProjectDetails = useCallback(async (projectId: string, preferredFile?: string) => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    try {
      const [detailRes, previewRes, dbRes] = await Promise.all([
        fetch(`/api/engineering/projects/${encodeURIComponent(projectId)}`, { headers: authHeaders(), cache: 'no-store' }),
        fetch(`/api/engineering/projects/${encodeURIComponent(projectId)}/preview`, { headers: authHeaders(), cache: 'no-store' }).catch(() => null),
        fetch(`/api/engineering/projects/${encodeURIComponent(projectId)}/database`, { headers: authHeaders(), cache: 'no-store' }).catch(() => null),
      ]);
      const detailJson = await detailRes.json();
      if (detailRes.ok && detailJson.success) {
        const proj: SoftwareProjectRecord = detailJson.project;
        const files: ProjectFileEntry[] = detailJson.files || [];
        setSelectedProject(proj);
        setSelectedProjectId(proj.projectId);
        setProjectFiles(files);

        const targetFile =
          preferredFile && files.some((f) => f.relativePath === preferredFile)
            ? preferredFile
            : files.find((f) => f.relativePath === selectedProjectFilePath)?.relativePath ||
              files.find((f) => f.relativePath === 'public/index.html')?.relativePath ||
              files[0]?.relativePath ||
              '';
        if (targetFile) {
          void loadProjectFile(proj.projectId, targetFile);
        } else {
          setSelectedProjectFilePath('');
          setProjectFileContent('');
          setProjectFileOriginal('');
        }
      }
      if (previewRes && previewRes.ok) {
        const pJson = await previewRes.json();
        if (pJson.success) {
          setPreviewPayload({
            rawHtml: pJson.rawHtml || '',
            html: pJson.html || '',
            endpoints: pJson.endpoints || [],
          });
        }
      }
      if (dbRes && dbRes.ok) {
        const dJson = await dbRes.json();
        if (dJson.success) {
          setDatabaseInfo(dJson.database || null);
        }
      }
    } catch (err: any) {
      setProjectNotice({ kind: 'err', text: err?.message || 'Unable to load project workspace.' });
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin, loadProjectFile, selectedProjectFilePath]);

  const fetchEngineeringProjects = useCallback(async (forceSelectId?: string | null) => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    try {
      const [projRes, capRes] = await Promise.all([
        fetch('/api/engineering/projects', { headers: authHeaders(), cache: 'no-store' }),
        fetch('/api/engineering/capabilities', { headers: authHeaders(), cache: 'no-store' }).catch(() => null),
      ]);
      const projJson = await projRes.json();
      if (projRes.ok && projJson.success) {
        const list: SoftwareProjectRecord[] = projJson.projects || [];
        setProjects(list);
        const targetId =
          forceSelectId ||
          (selectedProjectId && list.some((p) => p.projectId === selectedProjectId) ? selectedProjectId : list[0]?.projectId || null);
        if (targetId) {
          void loadProjectDetails(targetId);
        } else {
          setSelectedProject(null);
          setProjectFiles([]);
        }
      }
      if (capRes && capRes.ok) {
        const capJson = await capRes.json();
        if (Array.isArray(capJson.deliveryTargets)) {
          setDeliveryTargets(capJson.deliveryTargets);
        }
      }
    } catch (err: any) {
      console.error('Engineering projects fetch error:', err);
    }
  }, [authHeaders, isAuthenticated, isDevOrAdmin, loadProjectDetails, selectedProjectId]);

  useEffect(() => {
    if (initialProjectId) {
      setWorkspaceMode('app_projects');
      setSelectedProjectId(initialProjectId);
      if (authReady && isAuthenticated && isDevOrAdmin) {
        void fetchEngineeringProjects(initialProjectId);
      }
    }
  }, [initialProjectId, authReady, isAuthenticated, isDevOrAdmin]);

  const handleCreateAppProject = async () => {
    if (!projectPrompt.trim() || projectBusyAction) return;
    setProjectBusyAction('create');
    setProjectNotice(null);
    try {
      const res = await fetch('/api/engineering/projects', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt: projectPrompt.trim(), stack: projectStack, runChecks: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const created: SoftwareProjectRecord = data.project;
      setProjectNotice({
        kind: 'ok',
        text: th
          ? `สร้างโปรเจกต์ "${created.name}" (${created.currentRevision}) พร้อม Build/Test/Scan เสร็จสิ้น`
          : `Created "${created.name}" (${created.currentRevision}) and verified build/tests.`,
      });
      await fetchEngineeringProjects(created.projectId);
    } catch (err: any) {
      setProjectNotice({ kind: 'err', text: err?.message || 'Failed to create project.' });
    } finally {
      setProjectBusyAction(null);
    }
  };

  const handleIterateAppProject = async () => {
    if (!selectedProject || !projectPrompt.trim() || projectBusyAction) return;
    setProjectBusyAction('iterate');
    setProjectNotice(null);
    try {
      const res = await fetch(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/iterate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ instruction: projectPrompt.trim(), runChecks: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setProjectNotice({
        kind: 'ok',
        text: th
          ? `ต่อยอดโปรเจกต์สู่ ${data.project?.currentRevision || 'เวอร์ชันใหม่'} แล้ว`
          : `Iterated project to ${data.project?.currentRevision || 'new revision'}.`,
      });
      await fetchEngineeringProjects(selectedProject.projectId);
    } catch (err: any) {
      setProjectNotice({ kind: 'err', text: err?.message || 'Failed to iterate project.' });
    } finally {
      setProjectBusyAction(null);
    }
  };

  const handleSaveProjectFile = async () => {
    if (!selectedProject || !selectedProjectFilePath || projectBusyAction) return;
    setProjectBusyAction('save_file');
    setProjectNotice(null);
    try {
      const res = await fetch(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/file`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          path: selectedProjectFilePath,
          content: projectFileContent,
          message: `Edit ${selectedProjectFilePath} in DevStudio`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setProjectFileOriginal(projectFileContent);
      setProjectNotice({
        kind: 'ok',
        text: th
          ? `บันทึก ${selectedProjectFilePath} (${data.revision?.revisionId || 'revision ใหม่'}) แล้ว`
          : `Saved ${selectedProjectFilePath} (${data.revision?.revisionId || 'new revision'}).`,
      });
      await fetchEngineeringProjects(selectedProject.projectId);
    } catch (err: any) {
      setProjectNotice({ kind: 'err', text: err?.message || 'Unable to save file.' });
    } finally {
      setProjectBusyAction(null);
    }
  };

  const handleCreateProjectFile = async (relativePath: string) => {
    if (!selectedProject) return;
    const starter = relativePath.endsWith('.py')
      ? '# Module created in ZYNTHEOR DevStudio\n'
      : relativePath.endsWith('.html')
      ? '<!DOCTYPE html><html><body><h1>Module</h1></body></html>\n'
      : '// Module created in ZYNTHEOR DevStudio\nexport const ready = true;\n';
    const res = await fetch(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/file`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ path: relativePath, content: starter, message: `Add ${relativePath}` }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setProjectNotice({ kind: 'err', text: data.error || 'Unable to create file.' });
      return;
    }
    await loadProjectDetails(selectedProject.projectId, relativePath);
  };

  const handleDeleteProjectFile = async (relativePath: string) => {
    if (!selectedProject) return;
    setDeleteTargetError(null);
    const res = await fetch(
      `/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/file?path=${encodeURIComponent(relativePath)}`,
      { method: 'DELETE', headers: authHeaders() }
    );
    const data = await res.json();
    if (!res.ok || !data.success) {
      const msg = data.error || (th ? 'ไม่สามารถลบไฟล์ได้' : 'Unable to delete file.');
      setDeleteTargetError(msg);
      setProjectNotice({ kind: 'err', text: msg });
      return;
    }
    setPendingDeleteTarget(null);
    await loadProjectDetails(selectedProject.projectId);
  };

  const runEngineeringStageAction = async (
    action: 'build' | 'test' | 'security-scan' | 'repair' | 'deploy',
    body?: Record<string, unknown>
  ) => {
    if (!selectedProject || projectBusyAction) return;
    setProjectBusyAction(action);
    setProjectNotice(null);
    try {
      const res = await fetch(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/${action}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body || {}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const statusText = data.evidence?.verificationStatus || data.project?.deployment?.status || 'DONE';
      const detail = data.summary || data.evidence?.buildOrTestResult || data.project?.deployment?.reason || statusText;
      setProjectNotice({
        kind: statusText === 'BLOCKED' || statusText === 'PENDING_APPROVAL' ? 'warn' : 'ok',
        text: `${action.toUpperCase()}: ${detail}`,
      });
      await fetchEngineeringProjects(selectedProject.projectId);
    } catch (err: any) {
      setProjectNotice({ kind: 'err', text: err?.message || `${action} failed.` });
    } finally {
      setProjectBusyAction(null);
    }
  };

  const handleRollbackProject = async (revisionId: string) => {
    if (!selectedProject || projectBusyAction) return;
    setProjectBusyAction(`rollback:${revisionId}`);
    setProjectNotice(null);
    try {
      const res = await fetch(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/rollback`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ revisionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setProjectNotice({
        kind: 'ok',
        text: th ? `ย้อนกลับสู่เวอร์ชัน ${revisionId} เรียบร้อยแล้ว` : `Rolled back to ${revisionId}.`,
      });
      await fetchEngineeringProjects(selectedProject.projectId);
    } catch (err: any) {
      setProjectNotice({ kind: 'err', text: err?.message || 'Rollback failed.' });
    } finally {
      setProjectBusyAction(null);
    }
  };

  const handleDownloadProjectZip = async () => {
    if (!selectedProject || projectBusyAction) return;
    setProjectBusyAction('download');
    setProjectNotice(null);
    try {
      const res = await fetch(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/deliverable`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedProject.slug}-${selectedProject.currentRevision}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setProjectNotice({
        kind: 'ok',
        text: th
          ? `ดาวน์โหลดแพ็กเกจ ${selectedProject.slug}-${selectedProject.currentRevision}.zip เรียบร้อยแล้ว`
          : `Downloaded ${selectedProject.slug}-${selectedProject.currentRevision}.zip.`,
      });
    } catch (err: any) {
      setProjectNotice({ kind: 'err', text: err?.message || 'Unable to export deliverable ZIP.' });
    } finally {
      setProjectBusyAction(null);
    }
  };

  // --- Legacy /workspace Sandbox Handlers ---
  const fetchFiles = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch('/api/workspace/files', { headers: authHeaders() });
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
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(fileName)}`, {
        headers: authHeaders(),
      });
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
    if (!selectedFile || !isAuthenticated) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/workspace/file', {
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
      const res = await fetch('/api/workspace/file', {
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
    if (!isAuthenticated) return;
    setDeleteTargetError(null);
    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || (th ? 'ไม่สามารถลบไฟล์ได้' : 'Unable to delete file.'));
      }
      setPendingDeleteTarget(null);
      await fetchFiles();
      if (selectedFile === fileName) {
        setSelectedFile('');
        setFileContent('// File deleted');
      }
    } catch (e: any) {
      console.error(e);
      setDeleteTargetError(e?.message || (th ? 'ไม่สามารถลบไฟล์ได้' : 'Unable to delete file.'));
    }
  };

  const handleRunSandbox = async () => {
    if (!isAuthenticated) return;
    setIsExecutingSandbox(true);
    setSandboxResult(null);
    try {
      const argsArray = sandboxArgs.trim() ? sandboxArgs.trim().split(/\s+/) : [];
      const res = await fetch('/api/workspace/run', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ command: sandboxCmd, args: argsArray })
      });
      const responseText = await res.text();
      let data: any;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(`Command service returned an unreadable response (HTTP ${res.status}). Check the API service and server logs.`);
      }
      if (!res.ok || !data.success) {
        setSandboxResult({ error: data.error || data.message || `Command rejected (HTTP ${res.status})`, exitCode: 1 });
      } else {
        setSandboxResult(data.result);
      }
    } catch (err: any) {
      setSandboxResult({ error: err.message || 'Command execution failed. Check the server connection.', exitCode: 1 });
    } finally {
      setIsExecutingSandbox(false);
    }
  };

  const fetchAuditRecords = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch('/api/audit?limit=25', { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setAuditRecords(data.records || []);
        setAuditChainValid(data.integrity?.valid ?? true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchGithubStatus = async (branchName = githubBranchInput) => {
    if (!isAuthenticated || !isDevOrAdmin) return;
    setGithubLoading(true);
    try {
      const res = await fetch(`/api/github/status?branch=${encodeURIComponent(branchName || 'tidy-root')}`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = await res.json();
      setGithubStatus(data);
    } catch (err: any) {
      setGithubStatus({
        gitAvailable: false,
        connected: false,
        status: 'BLOCKED',
        reason: err?.message || 'Unable to reach GitHub sync status endpoint.',
      });
    } finally {
      setGithubLoading(false);
    }
  };

  const handleSyncWithGithub = async () => {
    if (!isAuthenticated || !isDevOrAdmin || githubSyncing) return;
    setGithubSyncing(true);
    setGithubSyncResult(null);
    try {
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          branch: githubBranchInput.trim() || 'tidy-root',
          commitMessage: githubCommitMessage.trim() || 'chore(zyntheor): sync workspace changes from DevStudio',
          scope: githubSyncScope,
        }),
      });
      const data = await res.json();
      setGithubSyncResult(data);
      if (data?.state) {
        setGithubStatus(data.state);
      } else {
        await fetchGithubStatus(githubBranchInput.trim() || 'tidy-root');
      }
      await fetchAuditRecords();
    } catch (err: any) {
      setGithubSyncResult({
        success: false,
        status: 'BLOCKED',
        pushStatus: 'BLOCKED',
        error: err?.message || 'GitHub sync request failed.',
      });
    } finally {
      setGithubSyncing(false);
    }
  };

  const handleOpenGithubSync = () => {
    const next = !githubPanelOpen;
    setGithubPanelOpen(next);
    if (next && isAuthenticated && isDevOrAdmin) {
      void fetchGithubStatus();
    }
  };

  useEffect(() => {
    if (authReady && isAuthenticated) {
      fetchFiles();
      fetchAuditRecords();
      if (isDevOrAdmin) {
        void fetchGithubStatus();
        void fetchEngineeringProjects(initialProjectId);
      }
    }
  }, [authReady, isAuthenticated, role]);

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
        headers: authHeaders(),
        body: JSON.stringify({ goal })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || errBody.message || `Execution failed (HTTP ${response.status})`);
      }

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
          } catch {
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

  const copyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasUnsavedChanges = fileContent !== originalContent;
  const hasUnsavedProjectFile = projectFileContent !== projectFileOriginal;
  const filteredEvents = terminalRoleFilter === 'ALL'
    ? events
    : events.filter((ev) => ev.role === terminalRoleFilter || ev.type === 'error' || ev.type === 'init');

  const renderGithubSyncBanner = () => (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--app-card-border)]">
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)]">
        <button
          type="button"
          onClick={() => setWorkspaceMode('app_projects')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            workspaceMode === 'app_projects'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{th ? `โปรเจกต์แอป & ซอฟต์แวร์ (${projects.length})` : `App Projects (${projects.length})`}</span>
        </button>
        <button
          type="button"
          onClick={() => setWorkspaceMode('sandbox')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            workspaceMode === 'sandbox'
              ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
              : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
          }`}
        >
          <FolderGit2 className="w-3.5 h-3.5" />
          <span>{th ? 'แซนด์บ็อกซ์ /workspace' : '/workspace Sandbox'}</span>
        </button>
      </div>

      <button
        type="button"
        data-testid="sync-with-github-btn"
        aria-label="Sync with GitHub"
        onClick={handleOpenGithubSync}
        className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[var(--app-text-primary)] bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] rounded-xl transition-colors cursor-pointer whitespace-nowrap"
      >
        <GitBranch className="w-4 h-4 text-[var(--app-accent)]" />
        <span>{th ? 'ซิงก์กับ GitHub' : 'Sync with GitHub'}</span>
        {githubStatus?.branch && (
          <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
            · {githubStatus.branch}
          </span>
        )}
      </button>
    </div>
  );

  const renderGithubSyncDrawer = () =>
    githubPanelOpen && (
      <div
        data-testid="github-sync-panel"
        className="mt-3 pt-3 border-t border-[var(--app-card-border)] space-y-3 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-[var(--app-accent)]" />
            <span className="font-semibold text-[var(--app-text-primary)]">
              {th ? 'เวิร์กโฟลว์ซิงก์ GitHub (GitHub-First Workflow)' : 'GitHub-First Repository Sync'}
            </span>
            <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
              {githubStatus?.gitAvailable
                ? `${githubStatus.branch || 'HEAD'} → origin/${githubBranchInput || 'tidy-root'}${githubStatus.headSha ? ` (${githubStatus.headSha})` : ''}`
                : th
                ? 'ไม่พบ .git ในสภาพแวดล้อมนี้'
                : 'No .git repository detected'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge
              status={
                githubStatus?.connected
                  ? 'VERIFIED'
                  : githubStatus?.gitAvailable === false
                  ? 'BLOCKED'
                  : 'UNVERIFIED'
              }
            />
            <button
              type="button"
              onClick={() => void fetchGithubStatus()}
              disabled={githubLoading || !isAuthenticated || !isDevOrAdmin}
              className="p-1.5 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] disabled:opacity-40 cursor-pointer"
              title={th ? 'รีเฟรชสถานะ Git' : 'Refresh Git status'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${githubLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {!isAuthenticated || !isDevOrAdmin ? (
          <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] text-[var(--app-text-secondary)] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--app-amber)] shrink-0" />
            <span>
              {th
                ? 'ต้องเข้าสู่ระบบด้วยสิทธิ์ Developer หรือ Administrator เพื่อดูสถานะและ Push โค้ดกลับ GitHub'
                : 'Sign in as Developer or Administrator to inspect repository status and push changes to GitHub.'}
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 font-mono text-[11px]">
              <div className="p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">
                  {th ? 'รีโมต (origin)' : 'Remote (origin)'}
                </div>
                <div className="mt-0.5 text-[var(--app-text-primary)] truncate" title={githubStatus?.remoteUrl || ''}>
                  {githubStatus?.remoteUrl || (th ? 'ไม่ได้เชื่อมต่อ' : 'Not configured')}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">
                  {th ? 'ไฟล์ที่เปลี่ยนแปลง' : 'Pending Changes'}
                </div>
                <div className="mt-0.5 text-[var(--app-text-primary)] tabular-nums">
                  {githubStatus?.gitAvailable
                    ? `${githubStatus.changedFiles?.length ?? 0} ${th ? 'ไฟล์' : 'files'} (${githubStatus.safeStageableCount ?? 0} ${th ? 'ปลอดภัย' : 'safe'})`
                    : '—'}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--app-surface)] border border-[var(--app-card-border)]">
                <div className="text-[10px] text-[var(--app-text-secondary)]">
                  {th ? 'คอมมิตนำหน้า / ตามหลัง' : 'Ahead / Behind'}
                </div>
                <div className="mt-0.5 text-[var(--app-text-primary)] tabular-nums">
                  {githubStatus?.gitAvailable
                    ? `+${githubStatus.aheadCount ?? 0} / -${githubStatus.behindCount ?? 0}`
                    : '—'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <input
                type="text"
                value={githubBranchInput}
                onChange={(e) => setGithubBranchInput(e.target.value)}
                placeholder="tidy-root"
                aria-label={th ? 'Branch ปลายทาง' : 'Target Git branch'}
                className="md:col-span-3 px-3 py-2 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs font-mono text-[var(--app-text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
              />
              <input
                type="text"
                value={githubCommitMessage}
                onChange={(e) => setGithubCommitMessage(e.target.value)}
                placeholder={th ? 'ข้อความ Commit...' : 'Commit message...'}
                aria-label={th ? 'ข้อความ Commit' : 'Commit message'}
                className="md:col-span-5 px-3 py-2 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
              />
              <select
                value={githubSyncScope}
                onChange={(e) => setGithubSyncScope(e.target.value as 'all_safe' | 'workspace_only')}
                aria-label={th ? 'ขอบเขตไฟล์ที่ส่ง' : 'Sync file scope'}
                className="md:col-span-2 px-2.5 py-2 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-xs text-[var(--app-text-primary)]"
              >
                <option value="all_safe">{th ? 'ไฟล์ซอร์สที่ปลอดภัย' : 'All safe changes'}</option>
                <option value="workspace_only">{th ? 'เฉพาะ /workspace' : '/workspace only'}</option>
              </select>
              <button
                type="button"
                data-testid="github-push-execute-btn"
                onClick={() => void handleSyncWithGithub()}
                disabled={githubSyncing}
                className="md:col-span-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--app-accent-deep)] text-white font-semibold hover:opacity-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>
                  {githubSyncing
                    ? th
                      ? 'กำลังซิงก์...'
                      : 'Syncing...'
                    : th
                    ? 'Push กลับ GitHub'
                    : 'Push to GitHub'}
                </span>
              </button>
            </div>

            {(githubSyncResult || githubStatus?.reason) && (
              <div
                data-testid="github-sync-outcome"
                className={`p-2.5 rounded-lg border text-[11px] font-mono break-words ${
                  githubSyncResult?.success
                    ? 'border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_8%,transparent)] text-[var(--z-ok)]'
                    : githubSyncResult && !githubSyncResult.success
                    ? 'border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_8%,transparent)] text-[var(--z-danger)]'
                    : 'border-[var(--app-card-border)] bg-[var(--app-surface)] text-[var(--app-text-secondary)]'
                }`}
              >
                {githubSyncResult ? (
                  githubSyncResult.success ? (
                    <span>
                      {githubSyncResult.pushStatus} · branch={githubSyncResult.branch} · commit={githubSyncResult.commitSha || '—'} ·{' '}
                      {githubSyncResult.pushSummary}
                    </span>
                  ) : (
                    <span>
                      {githubSyncResult.pushStatus || 'BLOCKED'}: {githubSyncResult.error || githubStatus?.reason}
                    </span>
                  )
                ) : (
                  <span>{githubStatus?.reason}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );

  return (
    <div className="space-y-6">
      <VividCard className="!p-4" gradientAccent="emerald">
        <div className="space-y-3">
          {renderGithubSyncBanner()}

          {workspaceMode === 'app_projects' ? (
            <div className="space-y-3">
              <div className="flex flex-col lg:flex-row gap-2.5">
                <select
                  value={projectStack}
                  onChange={(e) => setProjectStack(e.target.value as typeof projectStack)}
                  aria-label={th ? 'เลือกสถาปัตยกรรมแอป' : 'Application Stack'}
                  className="px-3 py-2.5 text-xs font-mono bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl text-[var(--app-text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
                >
                  <option value="node_fullstack">Node Fullstack (Web + API)</option>
                  <option value="node_api">Node Backend API</option>
                  <option value="python_service">Python Service</option>
                  <option value="static_web">Static Web App</option>
                </select>
                <input
                  ref={projectPromptInputRef}
                  type="text"
                  value={projectPrompt}
                  onChange={(e) => setProjectPrompt(e.target.value)}
                  placeholder={
                    th
                      ? 'อธิบายแอปที่ต้องการสร้าง หรือคำสั่งต่อยอดโปรเจกต์ที่เลือก...'
                      : 'Describe a new application to scaffold, or an iteration instruction...'
                  }
                  className="flex-1 px-4 py-2.5 text-xs md:text-sm bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:border-[var(--app-accent)] text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]"
                />
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleCreateAppProject()}
                    disabled={Boolean(projectBusyAction) || !projectPrompt.trim()}
                    className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[var(--app-accent-deep)] rounded-xl hover:opacity-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    <span>
                      {projectBusyAction === 'create'
                        ? th
                          ? 'กำลังสร้าง...'
                          : 'Creating...'
                        : th
                        ? 'สร้างแอปใหม่'
                        : 'Create App'}
                    </span>
                  </button>
                  {selectedProject && (
                    <button
                      type="button"
                      onClick={() => void handleIterateAppProject()}
                      disabled={Boolean(projectBusyAction) || !projectPrompt.trim()}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-[var(--app-text-primary)] bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] rounded-xl disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      <Wrench className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                      <span>
                        {projectBusyAction === 'iterate'
                          ? th
                            ? 'กำลังปรับปรุง...'
                            : 'Iterating...'
                          : th
                          ? 'ต่อยอดโปรเจกต์'
                          : 'Iterate'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {projectNotice && (
                <div
                  className={`px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                    projectNotice.kind === 'ok'
                      ? 'border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_8%,transparent)] text-[var(--z-ok)]'
                      : projectNotice.kind === 'warn'
                      ? 'border-[color-mix(in_srgb,var(--app-amber)_40%,transparent)] bg-[color-mix(in_srgb,var(--app-amber)_8%,transparent)] text-[var(--app-amber)]'
                      : 'border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_8%,transparent)] text-[var(--z-danger)]'
                  }`}
                >
                  <span>{projectNotice.text}</span>
                  <button
                    type="button"
                    onClick={() => setProjectNotice(null)}
                    className="text-[11px] opacity-75 hover:opacity-100 cursor-pointer"
                  >
                    {th ? 'ปิด' : 'Dismiss'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  type="text"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder={
                    th
                      ? 'ระบุเป้าหมายงานวิศวกรรมซอฟต์แวร์สำหรับ Multi-Agent Orchestrator...'
                      : 'Enter software engineering goal for Multi-Agent Orchestrator...'
                  }
                  className="flex-1 px-4 py-2.5 text-xs md:text-sm bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl focus:outline-none focus:border-[var(--app-accent)] font-medium text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)]"
                />
                <button
                  type="button"
                  onClick={handleRunAgent}
                  disabled={isRunning}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs md:text-sm font-semibold text-white bg-[var(--app-accent-deep)] rounded-xl hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>
                    {isRunning
                      ? th
                        ? `กำลังทำงาน (${activeAgentRole})...`
                        : `Orchestrating (${activeAgentRole})...`
                      : th
                      ? 'สั่งงาน Multi-Agent'
                      : 'Execute Multi-Agent'}
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[var(--app-text-secondary)] font-semibold text-[11px]">
                  {th ? 'เทมเพลตคำสั่ง:' : 'Goal Presets:'}
                </span>
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setGoal(preset.goal)}
                    className="px-2.5 py-1 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-accent)] transition-colors text-[11px] font-medium cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {renderGithubSyncDrawer()}
        </div>
      </VividCard>

      {workspaceMode === 'app_projects' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 rounded-xl border border-[var(--app-card-border)] overflow-hidden bg-[var(--app-surface)] min-h-[540px]">
            <ProjectExplorer
              projects={projects}
              selectedProject={selectedProject}
              onSelectProject={(projectId) => void loadProjectDetails(projectId)}
              onRefreshProjects={() => void fetchEngineeringProjects(selectedProjectId)}
              onNewApp={() => projectPromptInputRef.current?.focus()}
              files={projectFiles}
              selectedFilePath={selectedProjectFilePath}
              loadingFilePath={loadingProjectFilePath}
              onSelectFile={(relPath) =>
                selectedProject ? loadProjectFile(selectedProject.projectId, relPath) : undefined
              }
              onCreateFile={(relPath) => handleCreateProjectFile(relPath)}
              onDeleteFile={(relPath) => {
                setDeleteTargetError(null);
                setPendingDeleteTarget({ kind: 'project', path: relPath });
              }}
              toDotState={mapStatusToDotState}
            />
          </div>

          <div className="lg:col-span-8 space-y-4">
            <div className="bg-[var(--app-surface-elevated)] rounded-xl border border-[var(--app-card-border)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--app-card-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--app-surface)]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setProjectTab('code')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                      projectTab === 'code'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>{th ? 'โค้ด & เวอร์ชัน' : 'Code & Revisions'}</span>
                    {hasUnsavedProjectFile && <span className="w-2 h-2 rounded-full bg-[var(--app-amber)]" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setProjectTab('preview')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                      projectTab === 'preview'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{th ? 'พรีวิว & API' : 'Live Preview & API'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setProjectTab('pipeline')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                      projectTab === 'pipeline'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    <span>{th ? 'ทดสอบ & ส่งมอบ' : 'Verify & Deliver'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setProjectTab('database')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                      projectTab === 'database'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>{th ? 'ฐานข้อมูล & หลักฐาน' : 'Database & Proof'}</span>
                  </button>
                </div>

                {selectedProject && (
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <StatusDot
                      status={mapStatusToDotState(selectedProject.lastBuild?.status)}
                      label={`BUILD:${selectedProject.lastBuild?.status || 'NOT_RUN'}`}
                    />
                    <StatusDot
                      status={mapStatusToDotState(selectedProject.lastTests?.status)}
                      label={`TEST:${selectedProject.lastTests?.status || 'NOT_RUN'}`}
                    />
                    <StatusDot
                      status={mapStatusToDotState(selectedProject.lastSecurityScan?.status)}
                      label={`SEC:${selectedProject.lastSecurityScan?.status || 'NOT_RUN'}`}
                    />
                  </div>
                )}
              </div>

              {!selectedProject ? (
                <div className="p-10 text-center text-xs text-[var(--app-text-secondary)] space-y-2 min-h-[460px] flex flex-col items-center justify-center">
                  <Layers className="w-8 h-8 opacity-40 text-[var(--app-accent)]" />
                  <p className="font-semibold text-[var(--app-text-primary)]">
                    {th ? 'เลือกโปรเจกต์จากด้านซ้าย หรือพิมพ์ความต้องการด้านบนเพื่อสร้างแอปใหม่' : 'Select a project on the left or describe a new app above.'}
                  </p>
                  <p className="max-w-md opacity-80">
                    {th
                      ? 'ระบบสร้างโปรเจกต์จริงจะสร้างโค้ด, API, สกีมาข้อมูล, ชุดทดสอบอัตโนมัติ และแพ็กเกจ .zip พร้อมแฮช SHA-256'
                      : 'Creates runnable fullstack/API/web projects with automated tests, security validation, and SHA-256 deliverable ZIP bundles.'}
                  </p>
                </div>
              ) : (
                <>
                  {projectTab === 'code' && (
                    <div className="p-0 bg-[var(--app-bg)] flex flex-col min-h-[480px]">
                      <div className="px-4 py-2 bg-[var(--app-surface)] border-b border-[var(--app-card-border)] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                        <span className="text-[var(--app-text-secondary)] truncate">
                          {selectedProject.slug}/{selectedProjectFilePath || '—'} ({selectedProject.currentRevision})
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveProjectFile()}
                            disabled={!hasUnsavedProjectFile || Boolean(projectBusyAction)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                              hasUnsavedProjectFile
                                ? 'bg-[var(--app-accent-deep)] text-white'
                                : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] opacity-60 cursor-not-allowed'
                            }`}
                          >
                            <Save className="w-3 h-3" />
                            <span>
                              {projectBusyAction === 'save_file'
                                ? th
                                  ? 'กำลังบันทึก...'
                                  : 'Saving...'
                                : th
                                ? 'บันทึกเป็นเวอร์ชันใหม่'
                                : 'Save Revision'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => copyCode(projectFileContent)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                          >
                            {copied ? <Check className="w-3 h-3 text-[var(--z-ok)]" /> : <Copy className="w-3 h-3" />}
                            <span>{copied ? (th ? 'คัดลอกแล้ว' : 'Copied') : (th ? 'คัดลอก' : 'Copy')}</span>
                          </button>
                        </div>
                      </div>

                      <textarea
                        value={projectFileContent}
                        onChange={(e) => setProjectFileContent(e.target.value)}
                        className="w-full flex-1 p-4 bg-[var(--app-bg)] text-[var(--app-text-primary)] font-mono text-xs leading-relaxed focus:outline-none resize-none min-h-[340px]"
                        placeholder={th ? '// เลือกไฟล์จาก Project Explorer ด้านซ้าย' : '// Select a file from Project Explorer'}
                      />

                      <div className="px-4 py-3 border-t border-[var(--app-card-border)] bg-[var(--app-surface)] space-y-2">
                        <div className="text-[11px] font-semibold text-[var(--app-text-secondary)]">
                          {th ? `ประวัติเวอร์ชัน (${selectedProject.revisions.length})` : `Revision History (${selectedProject.revisions.length})`}
                        </div>
                        <div className="max-h-32 overflow-y-auto divide-y divide-[var(--app-card-border)] text-[11px] font-mono">
                          {selectedProject.revisions.slice(0, 6).map((rev) => (
                            <div key={rev.revisionId} className="py-1.5 flex items-center justify-between gap-2">
                              <div className="min-w-0 truncate">
                                <span className="text-[var(--app-accent)] font-semibold">{rev.revisionId}</span>
                                <span className="text-[var(--app-text-secondary)]"> · {rev.message}</span>
                              </div>
                              {rev.revisionId !== selectedProject.currentRevision ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRollbackProject(rev.revisionId)}
                                  disabled={Boolean(projectBusyAction)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-accent)] cursor-pointer shrink-0"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>{th ? 'ย้อนกลับ' : 'Rollback'}</span>
                                </button>
                              ) : (
                                <span className="text-[10px] text-[var(--z-ok)] shrink-0">
                                  {th ? 'ปัจจุบัน' : 'ACTIVE'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {projectTab === 'preview' && (
                    <div className="p-4 bg-[var(--app-bg)] space-y-4 min-h-[480px]">
                      <div className="rounded-xl border border-[var(--app-card-border)] overflow-hidden bg-white">
                        <div className="px-3 py-1.5 bg-[var(--app-surface)] border-b border-[var(--app-card-border)] text-[11px] font-mono text-[var(--app-text-secondary)] flex items-center justify-between">
                          <span>{th ? 'หน้าตัวอย่างแบบ Sandbox (allow-scripts)' : 'Sandboxed App Preview (allow-scripts)'}</span>
                          <span>{selectedProject.stack}</span>
                        </div>
                        <iframe
                          title="App Live Preview"
                          sandbox="allow-scripts"
                          srcDoc={previewPayload?.html || ''}
                          className="w-full h-[360px] bg-white"
                        />
                      </div>

                      <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
                        <div className="text-xs font-semibold text-[var(--app-text-primary)]">
                          {th ? 'API Endpoints ที่ออกแบบไว้' : 'Scaffolded API Endpoints'}
                        </div>
                        <div className="space-y-1 font-mono text-[11px]">
                          {(previewPayload?.endpoints || selectedProject.requirementsSpec.endpoints || []).map((ep, idx) => (
                            <div key={`${ep.method}-${ep.path}-${idx}`} className="flex items-center gap-2 text-[var(--app-text-secondary)]">
                              <span className="px-1.5 py-0.5 rounded bg-[var(--app-surface-elevated)] text-[var(--app-accent)] font-semibold">
                                {ep.method}
                              </span>
                              <span className="text-[var(--app-text-primary)]">{ep.path}</span>
                              <span className="truncate opacity-80">— {ep.purpose}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {projectTab === 'pipeline' && (
                    <div className="p-4 bg-[var(--app-bg)] space-y-4 min-h-[480px]">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void runEngineeringStageAction('build')}
                          disabled={Boolean(projectBusyAction)}
                          className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
                        >
                          {projectBusyAction === 'build' ? '...' : th ? '1. ตรวจ Build' : '1. Run Build'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runEngineeringStageAction('test')}
                          disabled={Boolean(projectBusyAction)}
                          className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
                        >
                          {projectBusyAction === 'test' ? '...' : th ? '2. รันชุดทดสอบ' : '2. Run Tests'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runEngineeringStageAction('security-scan')}
                          disabled={Boolean(projectBusyAction)}
                          className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
                        >
                          {projectBusyAction === 'security-scan' ? '...' : th ? '3. สแกนความปลอดภัย' : '3. Security Scan'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runEngineeringStageAction('repair')}
                          disabled={Boolean(projectBusyAction)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--app-surface)] border border-[var(--app-card-border)] hover:border-[var(--app-amber)] text-[var(--app-amber)] cursor-pointer disabled:opacity-50"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          <span>{projectBusyAction === 'repair' ? '...' : th ? 'ซ่อมแซมอัตโนมัติ' : 'Auto-Repair'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDownloadProjectZip()}
                          disabled={Boolean(projectBusyAction)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--app-accent-deep)] text-white hover:opacity-95 cursor-pointer disabled:opacity-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{projectBusyAction === 'download' ? '...' : th ? 'ดาวน์โหลด .zip' : 'Export .zip'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void runEngineeringStageAction('deploy')}
                          disabled={Boolean(projectBusyAction)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] cursor-pointer disabled:opacity-50"
                        >
                          <Rocket className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                          <span>{projectBusyAction === 'deploy' ? '...' : th ? 'ยื่น Deploy (ApprovalGate)' : 'Deploy (ApprovalGate)'}</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">Build</span>
                            <StatusDot status={mapStatusToDotState(selectedProject.lastBuild?.status)} label={selectedProject.lastBuild?.status || 'NOT_RUN'} />
                          </div>
                          <p className="text-[11px] text-[var(--app-text-secondary)]">
                            {selectedProject.lastBuild?.summary || (th ? 'ยังไม่เคยรัน Build' : 'Not executed yet')}
                          </p>
                        </div>

                        <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">Automated Tests</span>
                            <StatusDot status={mapStatusToDotState(selectedProject.lastTests?.status)} label={selectedProject.lastTests?.status || 'NOT_RUN'} />
                          </div>
                          <p className="text-[11px] text-[var(--app-text-secondary)] tabular-nums">
                            {selectedProject.lastTests
                              ? `${selectedProject.lastTests.passed}/${selectedProject.lastTests.total} · ${selectedProject.lastTests.summary}`
                              : th
                              ? 'ยังไม่เคยรันทดสอบ'
                              : 'Not executed yet'}
                          </p>
                        </div>

                        <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">Security Scan</span>
                            <StatusDot status={mapStatusToDotState(selectedProject.lastSecurityScan?.status)} label={selectedProject.lastSecurityScan?.status || 'NOT_RUN'} />
                          </div>
                          <p className="text-[11px] text-[var(--app-text-secondary)]">
                            {selectedProject.lastSecurityScan?.summary || (th ? 'ยังไม่เคยสแกน' : 'Not scanned yet')}
                          </p>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[var(--app-text-primary)]">
                            {th ? 'สถานะการ Deploy จริง' : 'Real Deployment Status'}
                          </span>
                          <StatusDot status={mapStatusToDotState(selectedProject.deployment?.status)} label={selectedProject.deployment?.status || 'NOT_CONFIGURED'} />
                        </div>
                        <p className="text-[11px] text-[var(--app-text-secondary)] font-mono break-words">
                          {selectedProject.deployment?.reason || '—'}
                        </p>
                      </div>

                      {deliveryTargets.length > 0 && (
                        <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2 text-xs">
                          <div className="font-semibold text-[var(--app-text-primary)]">
                            {th ? 'ความพร้อมการส่งมอบข้ามแพลตฟอร์ม (สถานะจริงของโฮสต์)' : 'Cross-Platform Delivery Readiness (Live Host Truth)'}
                          </div>
                          <div className="divide-y divide-[var(--app-card-border)]">
                            {deliveryTargets.map((target) => (
                              <div key={target.id} className="py-2 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-semibold text-[var(--app-text-primary)]">{th ? target.labelTh : target.labelEn}</div>
                                  <div className="text-[11px] text-[var(--app-text-secondary)]">{th ? target.detailTh : target.detailEn}</div>
                                </div>
                                <StatusDot status={mapStatusToDotState(target.status)} label={target.status} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {projectTab === 'database' && (
                    <div className="p-4 bg-[var(--app-bg)] space-y-4 min-h-[480px] text-xs">
                      <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[var(--app-text-primary)]">
                            {th ? 'โหมดจัดเก็บข้อมูลจริง' : 'Persistence Backend'}
                          </span>
                          <span className="font-mono text-[var(--app-accent)]">
                            {databaseInfo?.persistenceMode || 'inspecting...'}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--app-text-secondary)]">
                          Cloud SQL / PostgreSQL (DATABASE_URL):{' '}
                          <strong className="text-[var(--app-text-primary)]">
                            {databaseInfo?.cloudSqlConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED'}
                          </strong>
                        </div>
                        {databaseInfo?.schema && (
                          <pre className="p-2.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] font-mono text-[11px] overflow-x-auto max-h-44">
                            {JSON.stringify(databaseInfo.schema, null, 2)}
                          </pre>
                        )}
                      </div>

                      <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2">
                        <div className="font-semibold text-[var(--app-text-primary)]">
                          {th ? `บันทึกหลักฐาน SHA-256 (${selectedProject.evidenceHistory.length})` : `Execution Evidence Ledger (${selectedProject.evidenceHistory.length})`}
                        </div>
                        <div className="max-h-56 overflow-y-auto divide-y divide-[var(--app-card-border)] font-mono text-[11px]">
                          {selectedProject.evidenceHistory.slice(0, 10).map((ev: any) => (
                            <div key={ev.executionId} className="py-2 flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[var(--app-text-primary)] truncate">
                                  {ev.operationType} · {ev.sourceRevision}
                                </div>
                                <div className="text-[10px] text-[var(--app-text-secondary)] truncate">
                                  SHA-256: {ev.evidenceHash?.slice(0, 24)}...
                                </div>
                              </div>
                              <StatusDot status={mapStatusToDotState(ev.verificationStatus)} label={ev.verificationStatus} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-3 space-y-4">
            <VividCard
              title={th ? 'ไฟล์โปรเจกต์' : 'Project Explorer'}
              subtitle={th ? 'พาธหลัก Sandbox: /workspace' : 'Sandbox Root: /workspace'}
              className="!p-4"
              headerAction={
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingFile(!isCreatingFile)}
                    title={th ? 'สร้างไฟล์ใหม่' : 'New File'}
                    className="p-1 rounded-lg hover:bg-[var(--app-surface-elevated)] text-[var(--app-accent)] transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={fetchFiles}
                    title={th ? 'รีเฟรชรายการไฟล์' : 'Refresh Files'}
                    className="p-1 rounded-lg hover:bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              }
            >
              {isCreatingFile && (
                <form onSubmit={handleCreateFile} className="mb-3 p-2 rounded-xl bg-[var(--app-bg)] border border-[var(--app-card-border)] space-y-2">
                  <input
                    type="text"
                    required
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder={th ? 'เช่น validator.js หรือ test.py' : 'e.g. validator.js or test.py'}
                    className="w-full px-2.5 py-1.5 text-xs bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-lg text-[var(--app-text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsCreatingFile(false)}
                      className="px-2 py-1 text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
                    >
                      {th ? 'ยกเลิก' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-[var(--app-accent-deep)] rounded-lg hover:opacity-90 cursor-pointer"
                    >
                      {th ? 'สร้าง' : 'Create'}
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-[var(--app-text-secondary)]">
                  <span>{th ? `ไฟล์ (${workspaceFiles.length})` : `Files (${workspaceFiles.length})`}</span>
                  <span>{th ? 'ขนาด' : 'Size'}</span>
                </div>
                {workspaceFiles.length === 0 ? (
                  <div className="p-3 text-center text-[var(--app-text-secondary)] text-xs">
                    {th
                      ? 'ยังไม่มีไฟล์ใน /workspace กด "+" เพื่อสร้างหรือสั่งงานเอเจนต์'
                      : 'No files in /workspace. Click "+" to create or run an agent.'}
                  </div>
                ) : (
                  workspaceFiles.map((file) => (
                    <div
                      key={file.path}
                      className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl font-mono text-xs transition-colors ${
                        selectedFile === file.path
                          ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] font-semibold border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                          : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-elevated)] hover:text-[var(--app-text-primary)]'
                      }`}
                    >
                      <button
                        type="button"
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
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTargetError(null);
                            setPendingDeleteTarget({ kind: 'workspace', path: file.path });
                          }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-[var(--z-danger)] transition-opacity cursor-pointer"
                          title={th ? 'ลบไฟล์' : 'Delete file'}
                          aria-label={th ? `ลบไฟล์ ${file.path}` : `Delete ${file.path}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </VividCard>

            <VividCard
              title={th ? 'สถานะเอเจนต์ 4 บทบาท' : 'Multi-Agent 4-Role State'}
              subtitle={th ? 'ติดตามสถานะการทำงานแบบเรียลไทม์' : 'Real-Time State Machine'}
              className="!p-4"
            >
              <div className="space-y-2 text-xs">
                <div className={`p-2.5 rounded-xl border transition-colors ${
                  roleStatuses.PLANNER === 'ACTIVE'
                    ? 'bg-[color-mix(in_srgb,var(--z-ok)_14%,transparent)] border-[var(--z-ok)]'
                    : roleStatuses.PLANNER === 'SUCCESS'
                    ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                    : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--z-ok)] flex items-center gap-1.5">
                      1. PLANNER
                      {roleStatuses.PLANNER === 'ACTIVE' && <Activity className="w-3 h-3 text-[var(--z-ok)]" />}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      roleStatuses.PLANNER === 'SUCCESS' ? 'bg-[color-mix(in_srgb,var(--z-ok)_16%,transparent)] text-[var(--z-ok)]' : 'text-[var(--app-text-secondary)]'
                    }`}>
                      {roleStatuses.PLANNER}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">
                    {th ? 'วางโครงสร้างและแผนงานทีละขั้นตอน' : 'Formulates step-by-step architecture'}
                  </div>
                </div>

                <div className={`p-2.5 rounded-xl border transition-colors ${
                  roleStatuses.CODER === 'ACTIVE'
                    ? 'bg-[color-mix(in_srgb,var(--app-amber)_14%,transparent)] border-[var(--app-amber)]'
                    : roleStatuses.CODER === 'SUCCESS'
                    ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                    : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--app-amber)] flex items-center gap-1.5">
                      2. CODER
                      {roleStatuses.CODER === 'ACTIVE' && <Activity className="w-3 h-3 text-[var(--app-amber)]" />}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      roleStatuses.CODER === 'SUCCESS' ? 'bg-[color-mix(in_srgb,var(--z-ok)_16%,transparent)] text-[var(--z-ok)]' : 'text-[var(--app-text-secondary)]'
                    }`}>
                      {roleStatuses.CODER}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">
                    {th ? 'สร้างโค้ดที่รันได้จริงแบบ Streaming' : 'Synthesizes executable code via streaming'}
                  </div>
                </div>

                <div className={`p-2.5 rounded-xl border transition-colors ${
                  roleStatuses.REVIEWER === 'ACTIVE'
                    ? 'bg-[color-mix(in_srgb,var(--z-ok)_14%,transparent)] border-[var(--z-ok)]'
                    : roleStatuses.REVIEWER === 'RETRY'
                    ? 'bg-[color-mix(in_srgb,var(--app-amber)_14%,transparent)] border-[var(--app-amber)]'
                    : roleStatuses.REVIEWER === 'SUCCESS'
                    ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                    : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--z-ok)] flex items-center gap-1.5">
                      3. REVIEWER
                      {roleStatuses.REVIEWER === 'ACTIVE' && <Activity className="w-3 h-3 text-[var(--z-ok)]" />}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      roleStatuses.REVIEWER === 'SUCCESS'
                        ? 'bg-[color-mix(in_srgb,var(--z-ok)_16%,transparent)] text-[var(--z-ok)]'
                        : roleStatuses.REVIEWER === 'RETRY'
                        ? 'bg-[color-mix(in_srgb,var(--app-amber)_16%,transparent)] text-[var(--app-amber)]'
                        : 'text-[var(--app-text-secondary)]'
                    }`}>
                      {roleStatuses.REVIEWER}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">
                    {th ? 'ตรวจความปลอดภัยและข้อบังคับโค้ด' : 'Validates security invariants & policy'}
                  </div>
                </div>

                <div className={`p-2.5 rounded-xl border transition-colors ${
                  roleStatuses.TESTER === 'ACTIVE'
                    ? 'bg-[color-mix(in_srgb,var(--z-ok)_14%,transparent)] border-[var(--z-ok)]'
                    : roleStatuses.TESTER === 'SUCCESS'
                    ? 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]'
                    : roleStatuses.TESTER === 'ERROR'
                    ? 'bg-[color-mix(in_srgb,var(--z-danger)_14%,transparent)] border-[var(--z-danger)]'
                    : 'bg-[var(--app-surface)] border-[var(--app-card-border)]'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--z-ok)] flex items-center gap-1.5">
                      4. TESTER
                      {roleStatuses.TESTER === 'ACTIVE' && <Activity className="w-3 h-3 text-[var(--z-ok)]" />}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      roleStatuses.TESTER === 'SUCCESS'
                        ? 'bg-[color-mix(in_srgb,var(--z-ok)_16%,transparent)] text-[var(--z-ok)]'
                        : roleStatuses.TESTER === 'ERROR'
                        ? 'bg-[color-mix(in_srgb,var(--z-danger)_16%,transparent)] text-[var(--z-danger)]'
                        : 'text-[var(--app-text-secondary)]'
                    }`}>
                      {roleStatuses.TESTER}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)] mt-0.5">
                    {th ? 'รันทดสอบจริงผ่าน ToolGateway Sandbox' : 'Runs sandbox execution via ToolGateway'}
                  </div>
                </div>
              </div>
            </VividCard>
          </div>

          <div className="lg:col-span-6 space-y-4">
            <div className="bg-[var(--app-surface-elevated)] rounded-xl border border-[var(--app-card-border)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--app-card-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--app-surface)]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab('editor')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'editor'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>{th ? `ตัวแก้ไข (${selectedFile || 'ว่าง'})` : `Editor (${selectedFile || 'None'})`}</span>
                    {hasUnsavedChanges && <span className="w-2 h-2 rounded-full bg-[var(--app-amber)]" title={th ? 'ยังไม่บันทึก' : 'Unsaved changes'} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('terminal')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'terminal'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>{th ? `ติดตามผลการทำงาน (${events.length})` : `Execution Trace (${events.length})`}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('sandbox')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'sandbox'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 text-[var(--app-amber)]" />
                    <span>{th ? 'รันคำสั่ง Sandbox' : 'Sandbox Runner'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('benchmarks')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'benchmarks'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--z-ok)]" />
                    <span>{th ? 'สนาม Benchmark' : 'Benchmark Arena'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('audit');
                      fetchAuditRecords();
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'audit'
                        ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]'
                        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                    }`}
                  >
                    <History className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                    <span>{th ? 'ประวัติตรวจสอบ' : 'Audit Trail'}</span>
                  </button>
                </div>

                {activeTab === 'editor' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveFile}
                      disabled={isSaving || !hasUnsavedChanges}
                      className={`flex items-center gap-1 text-xs px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                        hasUnsavedChanges
                          ? 'bg-[var(--app-accent-deep)] hover:opacity-90 text-white'
                          : 'bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSaving ? (th ? 'กำลังบันทึก...' : 'Saving...') : saveSuccess ? (th ? 'บันทึกแล้ว!' : 'Saved!') : (th ? 'บันทึก' : 'Save')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => copyCode(fileContent)}
                      className="flex items-center gap-1 text-xs text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] px-2 py-1 rounded hover:bg-[var(--app-surface-elevated)] cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-[var(--z-ok)]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? (th ? 'คัดลอกแล้ว' : 'Copied') : (th ? 'คัดลอก' : 'Copy')}</span>
                    </button>
                  </div>
                )}
              </div>

              {activeTab === 'benchmarks' && (
                <div className="p-4 bg-[var(--app-bg)] min-h-[460px]">
                  <BenchmarkArena />
                </div>
              )}

              {activeTab === 'editor' && (
                <div className="p-0 bg-[var(--app-bg)] flex flex-col min-h-[460px]">
                  <div className="px-4 py-1.5 bg-[var(--app-surface)] border-b border-[var(--app-card-border)] text-[11px] font-mono text-[var(--app-text-secondary)] flex items-center justify-between">
                    <span>{th ? 'เป้าหมาย:' : 'Target:'} /workspace/{selectedFile || 'solution.js'}</span>
                    <span>
                      {fileContent.split('\n').length} {th ? 'บรรทัด' : 'lines'} · {new TextEncoder().encode(fileContent).length} {th ? 'ไบต์' : 'bytes'}
                    </span>
                  </div>
                  <textarea
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    className="w-full flex-1 p-4 bg-[var(--app-bg)] text-[var(--app-text-primary)] font-mono text-xs leading-relaxed focus:outline-none resize-none min-h-[420px]"
                    placeholder={th ? '// พิมพ์โค้ดที่นี่ หรือสั่งงานเอเจนต์เพื่อสร้างโค้ด...' : '// Type code here or execute an agent to generate...'}
                  />
                </div>
              )}

              {activeTab === 'terminal' && (
                <section className="bg-[var(--app-bg)] text-[var(--app-text-primary)] font-mono text-xs min-h-[420px] flex flex-col" aria-label="Execution trace">
                  <div className="px-3 sm:px-4 py-3 border-b border-[var(--app-card-border)] bg-[var(--app-surface)] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${isRunning ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-text-secondary)]'}`} />
                        <span className="font-semibold text-[var(--app-text-primary)]">
                          {th ? 'ติดตามการทำงานจริง (Execution Trace)' : 'Execution Trace'}
                        </span>
                        <span className="text-[var(--app-text-secondary)]">
                          {events.length} {th ? 'เหตุการณ์' : 'events'}
                        </span>
                        {isRunning && <span className="text-[var(--app-accent)]">{th ? 'กำลังสตรีม' : 'Streaming'}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="sr-only" htmlFor="terminal-role-filter">
                          {th ? 'กรองตามบทบาท' : 'Filter execution role'}
                        </label>
                        <select
                          id="terminal-role-filter"
                          value={terminalRoleFilter}
                          onChange={(e) => setTerminalRoleFilter(e.target.value as typeof terminalRoleFilter)}
                          className="max-w-[145px] px-2.5 py-1.5 rounded-lg border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] text-[var(--app-text-primary)] text-[11px]"
                        >
                          <option value="ALL">{th ? 'ทุกเหตุการณ์' : 'All events'}</option>
                          <option value="PLANNER">PLANNER</option>
                          <option value="CODER">CODER</option>
                          <option value="REVIEWER">REVIEWER</option>
                          <option value="TESTER">TESTER</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(filteredEvents.map((ev) => `[${ev.timestamp || ''}] ${ev.role || ev.type}: ${ev.message}${ev.data?.stdout ? `\n${ev.data.stdout}` : ''}${ev.data?.stderr ? `\n${ev.data.stderr}` : ''}`).join('\n\n'))}
                          disabled={filteredEvents.length === 0}
                          className="px-2.5 py-1.5 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] disabled:opacity-40 cursor-pointer"
                          title={th ? 'คัดลอกบันทึกที่แสดงอยู่' : 'Copy visible trace'}
                        >
                          {th ? 'คัดลอก' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEvents([])}
                          disabled={isRunning || events.length === 0}
                          className="px-2.5 py-1.5 rounded-lg border border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--z-danger)] disabled:opacity-40 cursor-pointer"
                          title={th ? 'ล้างบันทึกที่แสดง' : 'Clear displayed events'}
                        >
                          {th ? 'ล้าง' : 'Clear'}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--app-text-secondary)]">
                      <span>PLANNER → CODER → REVIEWER → TESTER</span>
                      <span>{filteredEvents.length} {th ? 'รายการที่แสดง' : 'visible'}</span>
                      <span>{events.filter((ev) => ev.type === 'error').length} {th ? 'ข้อผิดพลาด' : 'errors'}</span>
                    </div>
                  </div>

                  <div className="px-3 sm:px-4 py-3 overflow-y-auto max-h-[560px] min-h-[340px] space-y-2" aria-live="polite" aria-relevant="additions">
                    {filteredEvents.length === 0 ? (
                      <div className="text-[var(--app-text-secondary)] text-center py-16 space-y-2">
                        <Terminal className="w-6 h-6 mx-auto opacity-50" />
                        <p>
                          {events.length
                            ? th
                              ? 'ไม่มีเหตุการณ์ที่ตรงกับตัวกรอง'
                              : 'No events match this filter.'
                            : th
                            ? 'ยังไม่มีบันทึก Execution Trace'
                            : 'Execution trace is empty.'}
                        </p>
                        <p className="text-[11px] opacity-75">
                          {th ? 'สั่งรันงานเพื่อดูเหตุการณ์จริงแบบสตรีมที่นี่' : 'Start an execution to stream real orchestration events here.'}
                        </p>
                      </div>
                    ) : filteredEvents.map((ev, idx) => (
                      <article key={`${ev.timestamp}-${idx}`} className={`rounded-lg border px-3 py-2 space-y-1.5 ${ev.type === 'error' ? 'border-[color-mix(in_srgb,var(--z-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_7%,transparent)]' : 'border-[var(--app-card-border)] bg-[var(--app-surface)]'}`}>
                        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                          <time className="text-[10px] text-[var(--app-text-secondary)] shrink-0">{ev.timestamp && !Number.isNaN(Date.parse(ev.timestamp)) ? new Date(ev.timestamp).toLocaleTimeString() : '--:--:--'}</time>
                          <span className="text-[10px] uppercase tracking-wide text-[var(--app-accent)] shrink-0">{ev.role || ev.type}</span>
                          <p className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${ev.type === 'error' ? 'text-[var(--z-danger)] font-semibold' : 'text-[var(--app-text-primary)]'}`}>{ev.message}</p>
                        </div>
                        {ev.data?.stdout && <pre className="max-h-48 overflow-auto rounded-md bg-[var(--app-bg-secondary)] border border-[var(--app-card-border)] p-2 text-[11px] leading-relaxed text-[var(--app-accent)] whitespace-pre-wrap break-words">{ev.data.stdout}</pre>}
                        {ev.data?.stderr && <pre className="max-h-48 overflow-auto rounded-md bg-[color-mix(in_srgb,var(--z-danger)_7%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_30%,transparent)] p-2 text-[11px] leading-relaxed text-[var(--z-danger)] whitespace-pre-wrap break-words">{ev.data.stderr}</pre>}
                        {ev.data?.exitCode !== undefined && <p className="text-[10px] text-[var(--app-text-secondary)]">Exit code: {String(ev.data.exitCode)}</p>}
                      </article>
                    ))}
                    <div ref={terminalEndRef} />
                  </div>
                </section>
              )}

              {activeTab === 'sandbox' && (
                <div className="p-4 bg-[var(--app-bg)] space-y-4 min-h-[460px]">
                  <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-3">
                    <div className="text-xs font-semibold text-[var(--app-text-primary)] flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-[var(--app-amber)]" />
                      <span>{th ? 'ตัวรันคำสั่งจำกัดสิทธิ์ (Restricted Sandbox)' : 'Restricted Command Runner'}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        value={sandboxCmd}
                        onChange={(e) => setSandboxCmd(e.target.value)}
                        className="px-3 py-2 bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-lg text-xs text-[var(--app-text-primary)] font-mono focus:outline-none focus:border-[var(--app-accent)]"
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
                        placeholder={th ? 'อาร์กิวเมนต์ เช่น solution.js หรือ -la' : 'Arguments, e.g. solution.js or -la'}
                        className="flex-1 px-3 py-2 bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-lg text-xs text-[var(--app-text-primary)] font-mono focus:outline-none focus:border-[var(--app-accent)]"
                      />

                      <button
                        type="button"
                        onClick={handleRunSandbox}
                        disabled={isExecutingSandbox}
                        className="px-4 py-2 text-xs font-semibold text-white bg-[var(--app-accent-deep)] rounded-lg hover:opacity-95 transition-opacity cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <Play className="w-3.5 h-3.5 fill-white" />
                        <span>{isExecutingSandbox ? (th ? 'กำลังรัน...' : 'Running...') : (th ? 'รันคำสั่ง' : 'Run command')}</span>
                      </button>
                    </div>
                    <p className="text-[10px] leading-relaxed text-[var(--app-text-secondary)]">
                      {th
                        ? 'รันได้เฉพาะคำสั่งที่อยู่ในรายการอนุญาตเท่านั้น ไม่รองรับ shell operator, pipe หรือ interactive shell'
                        : 'Allowlisted commands only. Arguments are passed directly to the command runner; shell operators, pipes and interactive shell sessions are not supported.'}
                    </p>
                  </div>

                  {sandboxResult && (
                    <div className="p-4 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-2 font-mono text-xs">
                      <div className="flex items-center justify-between text-[11px] pb-1 border-b border-[var(--app-card-border)]">
                        <span className="font-semibold text-[var(--app-text-primary)]">
                          Exit Code: <span className={sandboxResult.exitCode === 0 ? 'text-[var(--app-accent)]' : 'text-[var(--z-danger)]'}>{sandboxResult.exitCode}</span>
                        </span>
                        <span className="text-[var(--app-text-secondary)]">
                          {th ? 'เวลา:' : 'Duration:'} {sandboxResult.durationMs ?? 0} ms
                        </span>
                      </div>

                      {sandboxResult.stdout && (
                        <div className="space-y-1">
                          <div className="text-[10px] text-[var(--app-accent)] font-bold">STDOUT:</div>
                          <pre className="p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[var(--app-accent)] whitespace-pre-wrap overflow-x-auto">
                            {sandboxResult.stdout}
                          </pre>
                        </div>
                      )}

                      {sandboxResult.stderr && (
                        <div className="space-y-1">
                          <div className="text-[10px] text-[var(--z-danger)] font-bold">STDERR:</div>
                          <pre className="p-3 rounded-lg bg-[color-mix(in_srgb,var(--z-danger)_15%,transparent)] border border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] text-[var(--z-danger)] whitespace-pre-wrap overflow-x-auto">
                            {sandboxResult.stderr}
                          </pre>
                        </div>
                      )}

                      {sandboxResult.error && (
                        <div className="p-3 rounded-lg bg-[color-mix(in_srgb,var(--z-danger)_20%,transparent)] border border-[var(--z-danger)] text-[var(--z-danger)]">
                          {sandboxResult.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'audit' && (
                <div className="p-4 bg-[var(--app-bg)] space-y-3 min-h-[460px] max-h-[480px] overflow-y-auto">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--app-card-border)]">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[var(--app-accent)]" />
                      <span className="text-xs font-semibold text-[var(--app-text-primary)]">
                        {th ? 'สมุดตรวจสอบโซ่แฮช SHA-256' : 'SHA-256 Chained Audit Ledger'}
                      </span>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                      auditChainValid ? 'bg-[color-mix(in_srgb,var(--z-ok)_18%,transparent)] text-[var(--z-ok)] border border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)]' : 'bg-[color-mix(in_srgb,var(--z-danger)_18%,transparent)] text-[var(--z-danger)]'
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
                          <span className="font-semibold text-[var(--app-accent)]">
                            #{rec.index} · {rec.action}
                          </span>
                          <span className="text-[var(--app-text-secondary)] text-[10px]">
                            [{rec.timestamp.slice(11, 19)}]
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[var(--app-text-secondary)]">
                          <span>{th ? 'บทบาท:' : 'Role:'} <strong className="text-[var(--app-text-primary)]">{rec.role}</strong></span>
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

          <div className="lg:col-span-3 space-y-4">
            <VividCard
              title={th ? 'การยืนยัน Sandbox' : 'Sandbox Verification'}
              subtitle={th ? 'ข้อกำหนดความปลอดภัย ToolGateway' : 'ToolGateway Invariant Assertions'}
              className="!p-4"
            >
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                  <div className="flex items-center justify-between font-semibold text-[var(--app-text-primary)]">
                    <span>{th ? 'จำกัดเวลารัน' : 'Execution Barrier'}</span>
                    <span className="text-[var(--app-accent)] font-mono">5000ms</span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)]">
                    {th ? 'บังคับหยุดอัตโนมัติเมื่อเกินกำหนดเวลา' : 'Hardware timeout kill enforced'}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                  <div className="flex items-center justify-between font-semibold text-[var(--app-text-primary)]">
                    <span>{th ? 'บันทึกการตรวจสอบ' : 'Audit Logging'}</span>
                    <span className="text-[var(--app-accent)] font-mono">ENFORCED</span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)]">
                    {th ? 'บันทึกต่อท้ายลง native_data/audit_log.jsonl' : 'Appended to native_data/audit_log.jsonl'}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                  <div className="flex items-center justify-between font-semibold text-[var(--app-text-primary)]">
                    <span>{th ? 'ไดเรกทอรี Sandbox' : 'Sandbox Directory'}</span>
                    <span className="text-[var(--app-amber)] font-mono">/workspace</span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)]">
                    {th ? 'ป้องกันการเข้าถึงนอกขอบเขตพาธ' : 'Zero path traversal escape allowed'}
                  </div>
                </div>
              </div>
            </VividCard>

            <VividCard
              title={th ? 'ข้อมูลสถาปัตยกรรมโมเดล' : 'Native Model Attribution'}
              subtitle={th ? 'โครงสร้างอ้างอิงตามสถานะจริง' : 'Engineering Baseline'}
              className="!p-4"
            >
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                  <div className="flex items-center justify-between font-semibold text-[var(--app-text-primary)]">
                    <span>{th ? 'โครงสร้างโมเดล' : 'Model Topology'}</span>
                    <span className="text-[var(--app-accent)] font-mono">41.5M TARGET</span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)]">
                    10 Layers · 8 Heads · 512D · SwiGLU
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                  <div className="flex items-center justify-between font-semibold text-[var(--app-text-primary)]">
                    <span>{th ? 'สถานะ Checkpoint' : 'Checkpoint Status'}</span>
                    <span className="text-[var(--app-amber)] font-mono text-[10px] font-bold">PARTIAL</span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)]">
                    {th ? 'เป็น descriptor เริ่มต้น ยังไม่ใช่ tensor checkpoint ที่โหลดใช้งานเต็ม' : 'Seed descriptor only; not a loadable tensor checkpoint.'}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-card-border)] space-y-1">
                  <div className="flex items-center justify-between font-semibold text-[var(--app-text-primary)]">
                    <span>Autograd Subgraph</span>
                    <span className="text-[var(--app-amber)] font-mono text-[10px] font-bold">IMPLEMENTED</span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-secondary)]">
                    {th ? 'มีโครงสร้าง Gradient แล้ว รอผลทดสอบ regression เชิงตัวเลข' : 'Gradient implementation is present; full numerical-gradient regression evidence is pending'}
                  </div>
                </div>
              </div>
            </VividCard>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDeleteTarget)}
        title={th ? 'ยืนยันการลบไฟล์' : 'Delete File'}
        description={
          pendingDeleteTarget?.kind === 'project'
            ? th
              ? 'ไฟล์นี้จะถูกลบออกจากโปรเจกต์อย่างถาวร และไม่สามารถกู้คืนได้เว้นแต่จะย้อน Revision'
              : 'This file will be deleted from the engineering project.'
            : th
            ? 'ไฟล์นี้จะถูกลบออกจากพื้นที่ /workspace sandbox อย่างถาวร'
            : 'This file will be permanently deleted from the /workspace sandbox.'
        }
        targetLabel={pendingDeleteTarget?.path}
        confirmLabel={th ? 'ลบไฟล์' : 'Delete File'}
        error={deleteTargetError}
        onCancel={() => {
          setPendingDeleteTarget(null);
          setDeleteTargetError(null);
        }}
        onConfirm={async () => {
          if (!pendingDeleteTarget) return;
          if (pendingDeleteTarget.kind === 'project') {
            await handleDeleteProjectFile(pendingDeleteTarget.path);
          } else {
            await handleDeleteFile(pendingDeleteTarget.path);
          }
        }}
      />
    </div>
  );
};
