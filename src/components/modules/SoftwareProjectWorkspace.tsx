import React, { useEffect, useState } from 'react';
import {
  SoftwareCapabilityStatusEntry,
  SoftwareProjectRecord,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiUrl } from '../../lib/apiClient';
import { VividCard } from '../ui/VividCard';
import { StatusDot, MinimalIndicatorState } from '../ui/StatusBadge';
import {
  Activity,
  CheckCircle2,
  Clock,
  Code2,
  Eye,
  FileCode,
  FolderOpen,
  History,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';

interface SoftwareProjectWorkspaceProps {
  initialCapabilities?: SoftwareCapabilityStatusEntry[];
  onAuditUpdated?: () => void;
}

type ProjectSubTab = 'explorer' | 'checks' | 'preview' | 'deploy' | 'capabilities';

function toDotState(raw: string | undefined | null): MinimalIndicatorState {
  switch (raw) {
    case 'VERIFIED':
    case 'IMPLEMENTED':
    case 'PARTIAL':
    case 'BLOCKED':
    case 'UNVERIFIED':
    case 'NOT_CONFIGURED':
    case 'NOT_IMPLEMENTED':
    case 'UNAVAILABLE':
    case 'FAILED':
      return raw;
    default:
      return 'UNVERIFIED';
  }
}

export const SoftwareProjectWorkspace: React.FC<SoftwareProjectWorkspaceProps> = ({
  initialCapabilities,
  onAuditUpdated,
}) => {
  const { authHeaders, authReady, isAuthenticated, session } = useAuth();
  const { showToast } = useToast();

  const [capabilities, setCapabilities] = useState<SoftwareCapabilityStatusEntry[]>(
    initialCapabilities || []
  );
  const [projects, setProjects] = useState<SoftwareProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [subTab, setSubTab] = useState<ProjectSubTab>('explorer');

  // Create project form state
  const [projectName, setProjectName] = useState('');
  const [projectPrompt, setProjectPrompt] = useState(
    'Build a service health tracker dashboard with REST API endpoints for incidents and SLA metrics'
  );
  const [projectStack, setProjectStack] = useState<
    'node_fullstack' | 'node_api' | 'python_service' | 'static_web'
  >('node_fullstack');
  const [runInitialChecks, setRunInitialChecks] = useState(true);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  // Explorer / Editor state
  const [selectedRelPath, setSelectedRelPath] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [originalEditorContent, setOriginalEditorContent] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('Update source file');
  const [newFileRelPath, setNewFileRelPath] = useState<string>('');
  const [isSavingFile, setIsSavingFile] = useState(false);

  // Checks / Deploy / Preview state
  const [isRunningCheck, setIsRunningCheck] = useState<'build' | 'test' | 'security' | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewEndpoints, setPreviewEndpoints] = useState<
    Array<{ method: string; path: string; purpose: string }>
  >([]);
  const [approvalIdInput, setApprovalIdInput] = useState<string>('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [isVerifyingRuntime, setIsVerifyingRuntime] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState<string | null>(null);
  const [activeDeploymentFilter, setActiveDeploymentFilter] = useState<{
    deploymentId: string;
    executionId: string;
    logIds: string[];
  } | null>(null);
  const [showAllStageExecs, setShowAllStageExecs] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedProject =
    projects.find((p) => p.projectId === selectedProjectId) || projects[0] || null;

  const latestFiles =
    selectedProject?.revisions[selectedProject.revisions.length - 1]?.files || [];

  const fetchCapabilities = async () => {
    try {
      const res = await fetch(apiUrl('/api/engineering/capabilities'), {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setCapabilities(json.capabilities || []);
      }
    } catch {
      // Ignore network hiccup; handled on next refresh
    }
  };

  const fetchProjects = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(apiUrl('/api/engineering/projects'), {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const list: SoftwareProjectRecord[] = json.projects || [];
        setProjects(list);
        if (list.length > 0 && !selectedProjectId) {
          setSelectedProjectId(list[0].projectId);
        }
      } else if (res.status === 401 || res.status === 403) {
        setErrorMessage(
          json.error || 'Developer role authentication is required to manage software projects.'
        );
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const refreshSelectedProject = async (projectId: string) => {
    if (!isAuthenticated || !projectId) return;
    try {
      const res = await fetch(
        apiUrl(`/api/engineering/projects/${encodeURIComponent(projectId)}`),
        { headers: authHeaders() }
      );
      const json = await res.json();
      if (res.ok && json.success && json.project) {
        setProjects((prev) =>
          prev.some((p) => p.projectId === projectId)
            ? prev.map((p) => (p.projectId === projectId ? json.project : p))
            : [json.project, ...prev]
        );
      }
    } catch {
      // noop
    }
  };

  const loadFile = async (projectId: string, relPath: string) => {
    if (!isAuthenticated || !projectId || !relPath) return;
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(
          `/api/engineering/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(
            relPath
          )}`
        ),
        { headers: authHeaders() }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to read ${relPath}`);
      }
      setSelectedRelPath(relPath);
      setEditorContent(json.content ?? '');
      setOriginalEditorContent(json.content ?? '');
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const loadPreview = async (projectId: string) => {
    if (!isAuthenticated || !projectId) return;
    try {
      const res = await fetch(
        apiUrl(`/api/engineering/projects/${encodeURIComponent(projectId)}/preview`),
        { headers: authHeaders() }
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setPreviewHtml(json.html || '');
        setPreviewEndpoints(json.endpoints || []);
      }
    } catch {
      // noop
    }
  };

  useEffect(() => {
    if (initialCapabilities && initialCapabilities.length > 0 && capabilities.length === 0) {
      setCapabilities(initialCapabilities);
    }
  }, [initialCapabilities]);

  useEffect(() => {
    if (authReady && isAuthenticated) {
      void fetchCapabilities();
      void fetchProjects();
    }
  }, [authReady, isAuthenticated]);

  useEffect(() => {
    setActiveDeploymentFilter(null);
    if (selectedProject && isAuthenticated) {
      setApprovalIdInput(selectedProject.deployment.approvalRequestId || '');
      const files =
        selectedProject.revisions[selectedProject.revisions.length - 1]?.files || [];
      if (files.length > 0) {
        const stillExists = files.some((f) => f.relativePath === selectedRelPath);
        if (!stillExists) {
          void loadFile(selectedProject.projectId, files[0].relativePath);
        }
      } else {
        setSelectedRelPath('');
        setEditorContent('');
        setOriginalEditorContent('');
      }
      if (subTab === 'preview') {
        void loadPreview(selectedProject.projectId);
      }
    }
  }, [selectedProject?.projectId, subTab, isAuthenticated]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || isCreatingProject || !projectPrompt.trim()) return;
    setIsCreatingProject(true);
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/engineering/projects'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: projectName.trim() || undefined,
          prompt: projectPrompt.trim(),
          stack: projectStack,
          runChecks: runInitialChecks,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to plan and scaffold project');
      }
      const created: SoftwareProjectRecord = json.project;
      setProjects((prev) => [created, ...prev.filter((p) => p.projectId !== created.projectId)]);
      setSelectedProjectId(created.projectId);
      setProjectName('');
      const firstFile = created.revisions[created.revisions.length - 1]?.files[0]?.relativePath;
      if (firstFile) {
        await loadFile(created.projectId, firstFile);
      }
      await fetchCapabilities();
      onAuditUpdated?.();
      showToast({
        variant: 'success',
        title: 'Software Project Scaffolded',
        message: `${created.name} (${created.stack})`,
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleSaveFile = async (targetPath?: string, targetContent?: string) => {
    if (!selectedProject || !isAuthenticated) return;
    const relPath = (targetPath ?? selectedRelPath).trim();
    const content = targetContent ?? editorContent;
    if (!relPath) return;
    setIsSavingFile(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/file`),
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            path: relPath,
            content,
            message: commitMessage.trim() || `Update ${relPath}`,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to save file');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      }
      setSelectedRelPath(relPath);
      setEditorContent(content);
      setOriginalEditorContent(content);
      onAuditUpdated?.();
      showToast({
        variant: 'success',
        title: 'Revision Committed',
        message: `${relPath} saved to project sandbox`,
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleCreateNewFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFileRelPath.trim().replace(/^\/+/, '');
    if (!cleaned || !selectedProject) return;
    const starter = cleaned.endsWith('.py')
      ? '# Module created in ZYNTHEOR Project Workspace\n'
      : cleaned.endsWith('.json')
        ? '{\n  "notes": "Created in ZYNTHEOR Project Workspace"\n}\n'
        : '// Created in ZYNTHEOR Project Workspace\n';
    setNewFileRelPath('');
    await handleSaveFile(cleaned, starter);
  };

  const handleDeleteFile = async (relPath: string) => {
    if (!selectedProject || !isAuthenticated) return;
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(
          `/api/engineering/projects/${encodeURIComponent(
            selectedProject.projectId
          )}/file?path=${encodeURIComponent(relPath)}`
        ),
        {
          method: 'DELETE',
          headers: authHeaders(),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to delete file');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      }
      if (selectedRelPath === relPath) {
        setSelectedRelPath('');
        setEditorContent('');
        setOriginalEditorContent('');
      }
      onAuditUpdated?.();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleRunCheck = async (kind: 'build' | 'test' | 'security') => {
    if (!selectedProject || !isAuthenticated || isRunningCheck) return;
    setIsRunningCheck(kind);
    setErrorMessage(null);
    const endpoint =
      kind === 'build'
        ? 'build'
        : kind === 'test'
          ? 'test'
          : 'security-validate';
    try {
      const res = await fetch(
        apiUrl(
          `/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/${endpoint}`
        ),
        {
          method: 'POST',
          headers: authHeaders(),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to run ${kind}`);
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      } else {
        await refreshSelectedProject(selectedProject.projectId);
      }
      onAuditUpdated?.();
      setSubTab('checks');
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsRunningCheck(null);
    }
  };

  const handleDeploy = async () => {
    if (!selectedProject || !isAuthenticated || isDeploying) return;
    setIsDeploying(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/deploy`),
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            approvalRequestId: approvalIdInput.trim() || undefined,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Deployment workflow failed');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
        setApprovalIdInput(json.project.deployment?.approvalRequestId || '');
      }
      await fetchCapabilities();
      onAuditUpdated?.();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleVerifyRuntime = async () => {
    if (!selectedProject || !isAuthenticated || isVerifyingRuntime) return;
    setIsVerifyingRuntime(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(
          `/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/verify-runtime`
        ),
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({}),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Runtime probe failed');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      }
      await fetchCapabilities();
      onAuditUpdated?.();
      showToast({
        variant: 'info',
        title: 'Runtime Verification Executed',
        message: json.project?.deployment?.reason || 'Runtime probe logged',
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsVerifyingRuntime(false);
    }
  };

  const focusDeploymentLogs = (rec: {
    deploymentId: string;
    executionId: string;
    linkedLogIds: string[];
  }) => {
    setActiveDeploymentFilter({
      deploymentId: rec.deploymentId,
      executionId: rec.executionId,
      logIds: rec.linkedLogIds || [],
    });
    const targetEl = document.getElementById('project-runtime-logs');
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const handleRollback = async (revisionId: string) => {
    if (!selectedProject || !isAuthenticated || isRollingBack) return;
    setIsRollingBack(revisionId);
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/rollback`),
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ revisionId }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Rollback failed');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
        const first =
          json.project.revisions[json.project.revisions.length - 1]?.files[0]?.relativePath;
        if (first) {
          await loadFile(json.project.projectId, first);
        }
      }
      onAuditUpdated?.();
      showToast({
        variant: 'info',
        title: 'Project Rolled Back',
        message: `Restored snapshot ${revisionId}`,
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsRollingBack(null);
    }
  };

  const hasUnsaved = editorContent !== originalEditorContent;

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-[#FF007F]/12 border border-[#FF007F]/45 text-xs font-mono text-[#FF99C8] flex items-center justify-between gap-3">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-bold underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Project Creation & Natural Language Planner */}
      <VividCard
        title="Section 10 · Full-Stack Application Planner & Scaffolder"
        subtitle="Creates sandboxed projects under /workspace/projects/<projectId> and runs real build, test, and security verification."
        gradientAccent="cyan"
      >
        {!isAuthenticated ? (
          <div className="p-4 rounded-xl bg-[#070B19] border border-[#1E294A] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-[#CBD5E1]">
              <Lock className="w-4 h-4 text-[#FF5E3A] shrink-0" />
              <span>
                Sign in with a Developer or Administrator account to create, edit, build, test, or deploy cloud software projects.
              </span>
            </div>
            <StatusDot status="BLOCKED" label="AUTH REQUIRED" />
          </div>
        ) : (
          <form onSubmit={handleCreateProject} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name (optional, auto-derived from prompt)"
                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#070B19] border border-[#1E294A] text-xs text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF]"
              />
              <select
                value={projectStack}
                onChange={(e) => setProjectStack(e.target.value as any)}
                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#070B19] border border-[#1E294A] text-xs font-mono text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF]"
              >
                <option value="node_fullstack">node_fullstack (API + UI + Unit Tests)</option>
                <option value="node_api">node_api (HTTP REST Service + Tests)</option>
                <option value="python_service">python_service (Python 3 Service + unittest)</option>
                <option value="static_web">static_web (Frontend SPA + Validation)</option>
              </select>
              <label className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#070B19] border border-[#1E294A] flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                <input
                  type="checkbox"
                  checked={runInitialChecks}
                  onChange={(e) => setRunInitialChecks(e.target.checked)}
                />
                <span>Execute Build, Test &amp; Security Scan automatically</span>
              </label>
            </div>

            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                required
                value={projectPrompt}
                onChange={(e) => setProjectPrompt(e.target.value)}
                placeholder="Describe software requirements, architecture goals, API endpoints, and persistence needs..."
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#070B19] border border-[#1E294A] text-xs md:text-sm text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF]"
              />
              <button
                type="submit"
                disabled={isCreatingProject}
                className="min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold text-[#070B19] bg-[#00F0FF] hover:bg-[#33F3FF] transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{isCreatingProject ? 'Planning & Scaffolding...' : 'Plan & Scaffold Project'}</span>
              </button>
            </div>
            <div className="text-[11px] font-mono text-[#9AA8C7]">
              Scope: tenant <span className="text-[#00F0FF]">{session?.tenantId || 'default'}</span> · attribution recorded honestly per runtime state
            </div>
          </form>
        )}
      </VividCard>

      {/* Main Project Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Rail: Tenant Projects & 13-Stage Pipeline */}
        <div className="lg:col-span-4 space-y-4">
          <VividCard
            title="Cloud Sandbox Projects"
            subtitle={`${projects.length} tenant project(s)`}
            gradientAccent="violet"
            headerAction={
              <button
                type="button"
                onClick={() => void fetchProjects()}
                className="p-1.5 rounded-lg text-[#9AA8C7] hover:text-white cursor-pointer"
                title="Refresh projects"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            }
          >
            {projects.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#9AA8C7]">
                No software projects created in this tenant yet.
              </div>
            ) : (
              <div className="divide-y divide-[#1E294A]">
                {projects.map((p) => {
                  const active = p.projectId === selectedProject?.projectId;
                  return (
                    <button
                      key={p.projectId}
                      type="button"
                      onClick={() => setSelectedProjectId(p.projectId)}
                      className={`w-full py-2.5 px-2 text-left transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                        active ? 'bg-[#00F0FF]/10 rounded-lg' : 'hover:bg-[#131B36]/60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#F4F7FF] truncate">{p.name}</div>
                        <div className="text-[10px] font-mono text-[#9AA8C7] truncate">
                          {p.stack} · {p.currentRevision}
                        </div>
                      </div>
                      <StatusDot
                        status={
                          p.lastTests?.status === 'VERIFIED'
                            ? 'VERIFIED'
                            : p.lastBuild?.status === 'FAILED' || p.lastTests?.status === 'FAILED'
                              ? 'BLOCKED'
                              : 'UNVERIFIED'
                        }
                        label={p.lastTests?.status || 'UNVERIFIED'}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </VividCard>

          {selectedProject && (
            <VividCard
              title="13-Stage Lifecycle Pipeline"
              subtitle={`Attribution: ${selectedProject.attribution} · ${(selectedProject.stageExecutions || []).length} execution record(s)`}
              gradientAccent="blue"
              headerAction={
                <button
                  type="button"
                  onClick={() => setShowAllStageExecs((v) => !v)}
                  className="text-[10px] font-mono text-[#00F0FF] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {showAllStageExecs ? 'Stage Summary' : 'Execution Records'}
                </button>
              }
            >
              {showAllStageExecs ? (
                <div className="divide-y divide-[#1E294A] max-h-[420px] overflow-y-auto text-[10px] font-mono">
                  {(selectedProject.stageExecutions || []).length === 0 ? (
                    <div className="py-4 text-[#9AA8C7]">No stage execution records recorded yet.</div>
                  ) : (
                    (selectedProject.stageExecutions || []).map((se) => (
                      <div key={se.executionId} className="py-2 first:pt-0 last:pb-0 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white font-bold truncate">
                            {String(se.order).padStart(2, '0')}. {se.stage}
                          </span>
                          <StatusDot status={toDotState(se.status)} label={se.status} />
                        </div>
                        <div className="text-[#CBD5E1] line-clamp-2">{se.summary}</div>
                        <div className="text-[#9AA8C7] tabular-nums">
                          {se.executionId} · {se.revisionId} · {se.durationMs}ms · sha256:{se.evidenceHash.slice(0, 10)}…
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="divide-y divide-[#1E294A] text-[11px]">
                  {selectedProject.stages.map((st) => {
                    const latestExec = (selectedProject.stageExecutions || []).find(
                      (se) => se.stage === st.stage
                    );
                    return (
                      <div key={st.stage} className="py-2 first:pt-0 last:pb-0 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#F4F7FF]">
                            {String(st.order).padStart(2, '0')}. {st.label}
                          </span>
                          <StatusDot
                            status={toDotState(st.status)}
                            label={st.status}
                          />
                        </div>
                        <div className="text-[10px] text-[#9AA8C7] line-clamp-2">{st.summary}</div>
                        {latestExec && (
                          <div className="text-[10px] font-mono text-[#64748B] tabular-nums">
                            {latestExec.executionId} · {latestExec.timestamp.slice(11, 19)}Z · {latestExec.evidenceHash.slice(0, 10)}…
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </VividCard>
          )}
        </div>

        {/* Right / Center Workspace */}
        <div className="lg:col-span-8 space-y-4 min-w-0">
          <div className="bg-[#0D1326] rounded-2xl border border-[#1E294A] overflow-hidden">
            {/* Sub-tab header */}
            <div className="px-4 py-2.5 bg-[#0B1124] border-b border-[#1E294A] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {(
                  [
                    { id: 'explorer', label: 'Explorer & Editor', icon: FolderOpen },
                    { id: 'checks', label: 'Build, Test & Security', icon: Terminal },
                    { id: 'preview', label: 'Preview & API Inspector', icon: Eye },
                    { id: 'deploy', label: 'Deploy, Rollback & Logs', icon: Rocket },
                    { id: 'capabilities', label: '13 Capabilities Status', icon: ShieldCheck },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  const isActive = subTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSubTab(t.id)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                        isActive
                          ? 'bg-[#131B36] text-[#00F0FF] border border-[#00F0FF]/45'
                          : 'text-[#9AA8C7] hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {selectedProject && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleRunCheck('build')}
                    disabled={Boolean(isRunningCheck)}
                    className="min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#131B36] border border-[#1E294A] hover:border-[#00F0FF] text-[#00F0FF] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isRunningCheck === 'build' ? 'Building...' : 'Build'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRunCheck('test')}
                    disabled={Boolean(isRunningCheck)}
                    className="min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#131B36] border border-[#1E294A] hover:border-[#CCFF00] text-[#CCFF00] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isRunningCheck === 'test' ? 'Testing...' : 'Run Tests'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRunCheck('security')}
                    disabled={Boolean(isRunningCheck)}
                    className="min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#131B36] border border-[#1E294A] hover:border-[#C084FC] text-[#C084FC] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isRunningCheck === 'security' ? 'Scanning...' : 'Security Scan'}
                  </button>
                </div>
              )}
            </div>

            {/* Sub-tab 1: Explorer & Source Code Editor */}
            {subTab === 'explorer' && (
              <div className="p-4 bg-[#070B19]">
                {!selectedProject ? (
                  <div className="py-12 text-center text-xs text-[#9AA8C7]">
                    Select or scaffold a project to inspect and edit source files.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-4 space-y-3">
                      <form onSubmit={handleCreateNewFile} className="flex gap-1.5">
                        <input
                          type="text"
                          value={newFileRelPath}
                          onChange={(e) => setNewFileRelPath(e.target.value)}
                          placeholder="src/helper.js"
                          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#0D1326] border border-[#1E294A] text-xs font-mono text-white focus:outline-none focus:border-[#00F0FF]"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1.5 rounded-lg bg-[#00F0FF] text-[#070B19] text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          + File
                        </button>
                      </form>

                      <div className="divide-y divide-[#1E294A] bg-[#0D1326] rounded-xl border border-[#1E294A] overflow-hidden">
                        {latestFiles.map((f) => {
                          const active = f.relativePath === selectedRelPath;
                          return (
                            <div
                              key={f.relativePath}
                              className={`flex items-center justify-between gap-2 px-3 py-2 text-xs font-mono ${
                                active ? 'bg-[#00F0FF]/12 text-[#00F0FF]' : 'text-[#CBD5E1]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => void loadFile(selectedProject.projectId, f.relativePath)}
                                className="flex items-center gap-2 truncate text-left flex-1 cursor-pointer"
                              >
                                <FileCode className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{f.relativePath}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteFile(f.relativePath)}
                                className="p-1 text-[#9AA8C7] hover:text-[#FF007F] cursor-pointer shrink-0"
                                title="Delete file"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="md:col-span-8 flex flex-col space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#9AA8C7]">
                        <span>
                          File: <strong className="text-white">{selectedRelPath || 'None'}</strong>
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            placeholder="Revision message"
                            className="px-2.5 py-1 rounded bg-[#0D1326] border border-[#1E294A] text-[11px] text-white"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveFile()}
                            disabled={!selectedRelPath || isSavingFile || !hasUnsaved}
                            className="px-3 py-1 rounded bg-[#00F0FF] text-[#070B19] font-bold text-xs flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>{isSavingFile ? 'Saving...' : 'Commit Revision'}</span>
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={editorContent}
                        onChange={(e) => setEditorContent(e.target.value)}
                        className="w-full min-h-[380px] p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] font-mono text-xs text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Sub-tab 2: Build, Test & Security Execution Output */}
            {subTab === 'checks' && (
              <div className="p-4 bg-[#070B19] space-y-4">
                {!selectedProject ? (
                  <div className="py-12 text-center text-xs text-[#9AA8C7]">
                    Select a project to inspect real build, automated test, and static security outputs.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">Build Syntax Check</span>
                          <StatusDot
                            status={selectedProject.lastBuild?.status || 'UNVERIFIED'}
                            label={selectedProject.lastBuild?.status || 'UNVERIFIED'}
                          />
                        </div>
                        <div className="text-[11px] font-mono text-[#9AA8C7]">
                          {selectedProject.lastBuild?.summary || 'Not executed yet'}
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">Automated Tests</span>
                          <StatusDot
                            status={selectedProject.lastTests?.status || 'UNVERIFIED'}
                            label={
                              selectedProject.lastTests
                                ? `${selectedProject.lastTests.passed}/${selectedProject.lastTests.total}`
                                : 'UNVERIFIED'
                            }
                          />
                        </div>
                        <div className="text-[11px] font-mono text-[#9AA8C7]">
                          {selectedProject.lastTests?.summary || 'Not executed yet'}
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">Security Validation</span>
                          <StatusDot
                            status={selectedProject.lastSecurityScan?.status || 'UNVERIFIED'}
                            label={selectedProject.lastSecurityScan?.status || 'UNVERIFIED'}
                          />
                        </div>
                        <div className="text-[11px] font-mono text-[#9AA8C7]">
                          {selectedProject.lastSecurityScan?.summary || 'Not scanned yet'}
                        </div>
                      </div>
                    </div>

                    {selectedProject.lastBuild?.output && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-mono uppercase text-[#00F0FF] font-bold">
                          Build Verification Output
                        </div>
                        <pre className="p-3 rounded-xl bg-[#0D1326] border border-[#1E294A] text-[11px] font-mono text-[#CBD5E1] whitespace-pre-wrap overflow-x-auto max-h-48">
                          {selectedProject.lastBuild.output}
                        </pre>
                      </div>
                    )}

                    {selectedProject.lastTests?.output && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-mono uppercase text-[#CCFF00] font-bold">
                          Automated Test Runner Output
                        </div>
                        <pre className="p-3 rounded-xl bg-[#0D1326] border border-[#1E294A] text-[11px] font-mono text-[#CCFF00] whitespace-pre-wrap overflow-x-auto max-h-56">
                          {selectedProject.lastTests.output}
                        </pre>
                      </div>
                    )}

                    {selectedProject.lastSecurityScan &&
                      selectedProject.lastSecurityScan.findings.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-mono uppercase text-[#FF007F] font-bold">
                            Static Security Findings ({selectedProject.lastSecurityScan.findings.length})
                          </div>
                          <div className="divide-y divide-[#1E294A] rounded-xl bg-[#0D1326] border border-[#1E294A]">
                            {selectedProject.lastSecurityScan.findings.map((f, idx) => (
                              <div key={idx} className="p-3 text-xs font-mono space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[#FF8C73] font-bold">
                                    [{f.severity}] {f.rule}
                                  </span>
                                  <span className="text-[#9AA8C7]">{f.file}</span>
                                </div>
                                <div className="text-[#CBD5E1]">{f.detail}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}

            {/* Sub-tab 3: Application Preview & API Inspector */}
            {subTab === 'preview' && (
              <div className="p-4 bg-[#070B19] space-y-4">
                {!selectedProject ? (
                  <div className="py-12 text-center text-xs text-[#9AA8C7]">
                    Select a project to preview rendered HTML and inspect planned REST endpoints.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-[#00F0FF]" />
                        Sandboxed Application Preview (public/index.html)
                      </span>
                      <button
                        type="button"
                        onClick={() => void loadPreview(selectedProject.projectId)}
                        className="px-3 py-1 rounded-lg bg-[#131B36] border border-[#1E294A] text-xs font-semibold text-[#00F0FF] cursor-pointer"
                      >
                        Reload Preview
                      </button>
                    </div>

                    <div className="rounded-xl border border-[#1E294A] overflow-hidden bg-white">
                      <iframe
                        title={`${selectedProject.name} Preview`}
                        sandbox="allow-scripts"
                        srcDoc={previewHtml}
                        className="w-full h-72 bg-[#070B19]"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-bold text-white">API Contract Inspector</div>
                      <div className="overflow-x-auto rounded-xl border border-[#1E294A]">
                        <table className="w-full text-left text-xs font-mono">
                          <thead className="bg-[#0B1124] border-b border-[#1E294A] text-[#9AA8C7]">
                            <tr>
                              <th className="py-2 px-3">Method</th>
                              <th className="py-2 px-3">Path</th>
                              <th className="py-2 px-3">Purpose</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1E294A] bg-[#0D1326]">
                            {previewEndpoints.map((ep, i) => (
                              <tr key={i}>
                                <td className="py-2 px-3 text-[#CCFF00] font-bold">{ep.method}</td>
                                <td className="py-2 px-3 text-[#00F0FF]">{ep.path}</td>
                                <td className="py-2 px-3 font-sans text-[#CBD5E1]">{ep.purpose}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Sub-tab 4: Deployments, Rollback & Runtime Logs */}
            {subTab === 'deploy' && (
              <div className="p-4 bg-[#070B19] space-y-5">
                {!selectedProject ? (
                  <div className="py-12 text-center text-xs text-[#9AA8C7]">
                    Select a project to inspect deployment approvals, revision rollback, and runtime logs.
                  </div>
                ) : (
                  <>
                    {/* Deployment & ApprovalGate Controls */}
                    <div className="p-4 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-white">
                            Cloud Deployment Control (ApprovalGate + Bundle SHA-256)
                          </div>
                          <div className="text-[11px] font-mono text-[#9AA8C7] mt-0.5">
                            {selectedProject.deployment.reason}
                          </div>
                        </div>
                        <StatusDot
                          status={
                            selectedProject.deployment.status === 'DEPLOYED'
                              ? 'VERIFIED'
                              : selectedProject.deployment.status === 'PENDING_APPROVAL'
                                ? 'UNVERIFIED'
                                : selectedProject.deployment.status === 'NOT_CONFIGURED'
                                  ? 'NOT_CONFIGURED'
                                  : 'BLOCKED'
                          }
                          label={selectedProject.deployment.status}
                        />
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={approvalIdInput}
                          onChange={(e) => setApprovalIdInput(e.target.value)}
                          placeholder="ApprovalGate Request ID (auto-created on first deploy click)"
                          className="flex-1 min-h-[40px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                        />
                        <button
                          type="button"
                          onClick={() => void handleDeploy()}
                          disabled={isDeploying}
                          className="min-h-[40px] px-4 py-2 rounded-lg text-xs font-bold text-[#070B19] bg-[#00F0FF] hover:bg-[#33F3FF] flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          <Rocket className="w-3.5 h-3.5" />
                          <span>
                            {isDeploying
                              ? 'Evaluating Approval & Target...'
                              : approvalIdInput
                                ? 'Execute Approved Cloud Deploy'
                                : 'Request Deployment Approval'}
                          </span>
                        </button>
                        {selectedProject.deployment.targetEndpoint && (
                          <button
                            type="button"
                            onClick={() => void handleVerifyRuntime()}
                            disabled={isVerifyingRuntime}
                            className="min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-bold text-[#CCFF00] bg-[#131B36] border border-[#1E294A] hover:border-[#CCFF00] flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <Activity className="w-3.5 h-3.5" />
                            <span>{isVerifyingRuntime ? 'Probing...' : 'Probe Runtime'}</span>
                          </button>
                        )}
                      </div>

                      {selectedProject.deployment.artifactZip && (
                        <div className="text-[11px] font-mono text-[#00F0FF] tabular-nums">
                          Bundle: {selectedProject.deployment.artifactZip} · SHA-256:{' '}
                          {selectedProject.deployment.artifactSha256?.slice(0, 20)}…
                          {selectedProject.deployment.runtimeHttpStatus !== null && (
                            <span className="text-[#CBD5E1]">
                              {' '}· Runtime HTTP {selectedProject.deployment.runtimeHttpStatus}
                              {selectedProject.deployment.latencyMs ? ` (${selectedProject.deployment.latencyMs}ms)` : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Historical Deployment Timeline */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-bold text-white flex items-center gap-2">
                          <Clock className="w-4 h-4 text-[#00F0FF]" />
                          Historical Deployment Timeline
                        </div>
                        <span className="text-[10px] font-mono text-[#9AA8C7] tabular-nums">
                          {(selectedProject.deploymentHistory || []).length} recorded event(s)
                        </span>
                      </div>

                      {(() => {
                        const timelineItems =
                          selectedProject.deploymentHistory && selectedProject.deploymentHistory.length > 0
                            ? selectedProject.deploymentHistory
                            : selectedProject.evidenceHistory
                                .filter(
                                  (ev) =>
                                    ev.operationType === 'DEPLOY_PREP' ||
                                    ev.operationType === 'CLOUD_DEPLOY' ||
                                    ev.operationType === 'RUNTIME_VERIFY'
                                )
                                .map((ev) => ({
                                  deploymentId: ev.executionId,
                                  revisionId: ev.sourceRevision,
                                  executionId: ev.executionId,
                                  timestamp: ev.completionTimestamp,
                                  status:
                                    ev.verificationStatus === 'VERIFIED'
                                      ? ('DEPLOYED' as const)
                                      : ev.verificationStatus === 'FAILED'
                                        ? ('FAILED' as const)
                                        : ('BLOCKED' as const),
                                  targetProvider: selectedProject.deployment.targetProvider,
                                  targetEndpoint: selectedProject.deployment.targetEndpoint,
                                  approvalRequestId: selectedProject.deployment.approvalRequestId,
                                  artifactZip: selectedProject.deployment.artifactZip,
                                  artifactSha256: selectedProject.deployment.artifactSha256,
                                  runtimeHttpStatus: selectedProject.deployment.runtimeHttpStatus,
                                  latencyMs: ev.actualDurationMs,
                                  reason: ev.buildOrTestResult,
                                  evidenceHash: ev.evidenceHash,
                                  linkedLogIds: [] as string[],
                                }));

                        if (timelineItems.length === 0) {
                          return (
                            <div className="p-4 rounded-xl bg-[#0D1326] border border-[#1E294A] text-xs font-mono text-[#9AA8C7]">
                              No deployment history recorded yet. Trigger Request Deployment Approval above to record the first timeline event.
                            </div>
                          );
                        }

                        return (
                          <div className="rounded-xl bg-[#0D1326] border border-[#1E294A] p-4">
                            <ol className="relative border-l border-[#1E294A] ml-2 space-y-5">
                              {timelineItems.map((item) => {
                                const dotState: MinimalIndicatorState =
                                  item.status === 'DEPLOYED'
                                    ? 'VERIFIED'
                                    : item.status === 'PENDING_APPROVAL'
                                      ? 'UNVERIFIED'
                                      : item.status === 'NOT_CONFIGURED'
                                        ? 'NOT_CONFIGURED'
                                        : item.status === 'FAILED'
                                          ? 'FAILED'
                                          : 'BLOCKED';
                                const matchingLogsCount = selectedProject.runtimeLogs.filter(
                                  (log) =>
                                    (log.logId && item.linkedLogIds.includes(log.logId)) ||
                                    log.deploymentId === item.deploymentId ||
                                    log.executionId === item.executionId
                                ).length;
                                const isSelectedFilter =
                                  activeDeploymentFilter?.deploymentId === item.deploymentId &&
                                  activeDeploymentFilter?.executionId === item.executionId;

                                return (
                                  <li key={`${item.deploymentId}_${item.executionId}`} className="pl-5 relative">
                                    <span
                                      className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border border-[#070B19] ${
                                        item.status === 'DEPLOYED'
                                          ? 'bg-[#CCFF00]'
                                          : item.status === 'PENDING_APPROVAL'
                                            ? 'bg-[#FF8C73]'
                                            : item.status === 'NOT_CONFIGURED'
                                              ? 'bg-[#9AA8C7]'
                                              : 'bg-[#FF007F]'
                                      }`}
                                    />
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="space-y-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono">
                                          <StatusDot status={dotState} label={item.status} />
                                          <span className="text-white font-bold tabular-nums">
                                            {item.timestamp}
                                          </span>
                                          <span className="text-[#00F0FF]">{item.revisionId}</span>
                                          <span className="text-[#9AA8C7]">{item.deploymentId}</span>
                                        </div>
                                        <div className="text-xs text-[#CBD5E1]">{item.reason}</div>
                                        <div className="text-[10px] font-mono text-[#9AA8C7] tabular-nums flex flex-wrap gap-x-2 gap-y-0.5">
                                          <span>exec:{item.executionId}</span>
                                          {item.targetEndpoint && <span>· endpoint:{item.targetEndpoint}</span>}
                                          {item.runtimeHttpStatus !== null && (
                                            <span>· HTTP {item.runtimeHttpStatus}</span>
                                          )}
                                          {item.latencyMs !== null && item.latencyMs !== undefined && (
                                            <span>· {item.latencyMs}ms</span>
                                          )}
                                          {item.approvalRequestId && (
                                            <span>· gate:{item.approvalRequestId}</span>
                                          )}
                                          <span>· sha256:{item.evidenceHash.slice(0, 12)}…</span>
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => focusDeploymentLogs(item)}
                                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                                          isSelectedFilter
                                            ? 'bg-[#00F0FF]/15 border-[#00F0FF] text-[#00F0FF]'
                                            : 'bg-[#131B36] border-[#1E294A] hover:border-[#00F0FF] text-[#CBD5E1] hover:text-white'
                                        }`}
                                      >
                                        View Linked Runtime Logs ({matchingLogsCount})
                                      </button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ol>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Version History & Rollback */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <History className="w-4 h-4 text-[#C084FC]" />
                        Version History &amp; Controlled Rollback
                      </div>
                      <div className="divide-y divide-[#1E294A] rounded-xl bg-[#0D1326] border border-[#1E294A]">
                        {[...selectedProject.revisions].reverse().map((rev) => (
                          <div
                            key={rev.revisionId}
                            className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                          >
                            <div className="min-w-0">
                              <div className="text-white font-bold">
                                {rev.revisionId} · {rev.message}
                              </div>
                              <div className="text-[10px] text-[#9AA8C7] tabular-nums">
                                {rev.createdAt} · tree {rev.treeSha256.slice(0, 14)}… ({rev.files.length} files)
                              </div>
                            </div>
                            {rev.revisionId !== selectedProject.currentRevision ? (
                              <button
                                type="button"
                                onClick={() => void handleRollback(rev.revisionId)}
                                disabled={Boolean(isRollingBack)}
                                className="px-2.5 py-1 rounded bg-[#131B36] border border-[#1E294A] hover:border-[#FF5E3A] text-[#FF8C73] text-[11px] font-bold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>{isRollingBack === rev.revisionId ? 'Rolling back...' : 'Rollback'}</span>
                              </button>
                            ) : (
                              <StatusDot status="VERIFIED" label="CURRENT" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Runtime Logs */}
                    <div id="project-runtime-logs" className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-bold text-white">
                          Runtime Logs &amp; Execution Evidence
                          {activeDeploymentFilter && (
                            <span className="ml-2 text-[11px] font-mono font-normal text-[#00F0FF]">
                              · Filtered to {activeDeploymentFilter.deploymentId} ({activeDeploymentFilter.executionId})
                            </span>
                          )}
                        </div>
                        {activeDeploymentFilter && (
                          <button
                            type="button"
                            onClick={() => setActiveDeploymentFilter(null)}
                            className="px-2.5 py-1 rounded bg-[#131B36] border border-[#1E294A] hover:border-[#00F0FF] text-[11px] font-mono text-[#00F0FF] whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Clear Filter · Show All Logs
                          </button>
                        )}
                      </div>
                      <div className="max-h-60 overflow-y-auto rounded-xl bg-[#0D1326] border border-[#1E294A] divide-y divide-[#1E294A] font-mono text-[11px]">
                        {(() => {
                          const orderedLogs = [...selectedProject.runtimeLogs].reverse();
                          const displayedLogs = activeDeploymentFilter
                            ? orderedLogs.filter(
                                (log) =>
                                  (log.logId && activeDeploymentFilter.logIds.includes(log.logId)) ||
                                  log.deploymentId === activeDeploymentFilter.deploymentId ||
                                  log.executionId === activeDeploymentFilter.executionId
                              )
                            : orderedLogs;

                          if (displayedLogs.length === 0) {
                            return (
                              <div className="px-3 py-4 text-[#9AA8C7]">
                                {activeDeploymentFilter
                                  ? 'No runtime logs directly linked to this legacy deployment record.'
                                  : 'No runtime logs recorded yet.'}
                              </div>
                            );
                          }

                          return displayedLogs.map((log, i) => (
                            <div
                              key={log.logId || i}
                              className={`px-3 py-2 flex items-start justify-between gap-3 ${
                                activeDeploymentFilter ? 'bg-[#00F0FF]/5' : ''
                              }`}
                            >
                              <span className="text-[#CBD5E1] min-w-0">
                                <span
                                  className={
                                    log.level === 'ERROR'
                                      ? 'text-[#FF66B2] font-bold'
                                      : log.level === 'WARN'
                                        ? 'text-[#FF8C73] font-bold'
                                        : 'text-[#00F0FF] font-bold'
                                  }
                                >
                                  [{log.level}]
                                </span>{' '}
                                <span className="text-[#9AA8C7]">({log.source})</span> {log.message}
                                {log.deploymentId && (
                                  <span className="ml-2 text-[10px] text-[#64748B]">
                                    [{log.deploymentId}]
                                  </span>
                                )}
                              </span>
                              <span className="text-[#64748B] shrink-0 tabular-nums">
                                {log.timestamp.slice(11, 19)}
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Sub-tab 5: All 13 Honest Section 10 Capabilities */}
            {subTab === 'capabilities' && (
              <div className="p-4 bg-[#070B19]">
                <div className="divide-y divide-[#1E294A]">
                  {capabilities.map((cap) => (
                    <div key={cap.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-white">{cap.name}</span>
                        <StatusDot
                          status={cap.status === 'IMPLEMENTED' ? 'IMPLEMENTED' : cap.status}
                          label={cap.status}
                        />
                      </div>
                      <div className="text-[11px] text-[#CBD5E1]">{cap.detail}</div>
                      {cap.missingDependency && (
                        <div className="text-[10px] font-mono text-[#FF8C73]">
                          Missing dependency: {cap.missingDependency}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SoftwareProjectWorkspace;
