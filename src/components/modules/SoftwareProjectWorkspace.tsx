import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DeploymentHistoryTimelineItem,
  ProjectIntegrationBinding,
  SoftwareBenchmarkSuiteReport,
  SoftwareCapabilityStatusEntry,
  SoftwareProjectRecord,
  SystemStatusData,
  VisualElementNode,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiUrl } from '../../lib/apiClient';
import { StatusDot, MinimalIndicatorState } from '../ui/StatusBadge';
import { DeploymentHistoryTimeline } from '../DeploymentHistoryTimeline';
import { WorkspaceLayout } from '../Workspace/WorkspaceLayout';
import { ProjectExplorer } from '../Workspace/ProjectExplorer';
import {
  Activity,
  AlertTriangle,
  AppWindow,
  Award,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Code2,
  Crosshair,
  Database,
  Eye,
  Globe,
  History,
  KeyRound,
  Lock,
  Monitor,
  PackageSearch,
  PlugZap,
  Rocket,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  Wrench,
} from 'lucide-react';

interface SoftwareProjectWorkspaceProps {
  initialCapabilities?: SoftwareCapabilityStatusEntry[];
  statusData?: SystemStatusData | null;
  onAuditUpdated?: () => void;
}

type ProjectSubTab =
  | 'preview'
  | 'code'
  | 'database'
  | 'internet'
  | 'checks'
  | 'deploy'
  | 'capabilities';

interface DomainPreset {
  id: string;
  label: string;
  stack: 'node_fullstack' | 'static_web' | 'node_api' | 'python_service';
  prompt: string;
}

const DOMAIN_PRESETS: DomainPreset[] = [
  {
    id: 'saas',
    label: 'SaaS',
    stack: 'node_fullstack',
    prompt:
      'Build a SaaS operations & incident management web application with live KPI overview, searchable records, analytics, and team user registration',
  },
  {
    id: 'ecommerce',
    label: 'E-Commerce',
    stack: 'node_fullstack',
    prompt:
      'Build an e-commerce storefront and order fulfillment application with catalog inventory, customer orders, revenue metrics, and operator registration',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    stack: 'node_fullstack',
    prompt:
      'Build a real-time executive KPI & analytics dashboard application with multi-view workspace tabs, metric filtering, and audit status tracking',
  },
  {
    id: 'database',
    label: 'Database',
    stack: 'node_fullstack',
    prompt:
      'Build a financial ledger & database management web application with validated record creation, persistent data store, and summary breakdowns',
  },
  {
    id: 'webapp',
    label: 'Web App',
    stack: 'static_web',
    prompt:
      'Build a responsive interactive portal web application with overview cards, record workflows, analytics, and team settings',
  },
  {
    id: 'education',
    label: 'Education',
    stack: 'node_fullstack',
    prompt:
      'Build an educational learning platform with course module tracking, student progress metrics, analytics, and learner enrollment',
  },
];

function toDotState(raw: string | undefined | null): MinimalIndicatorState {
  switch (raw) {
    case 'VERIFIED':
    case 'IMPLEMENTED':
    case 'ONLINE':
    case 'READY':
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

function gatePillClass(state: string | undefined | null): string {
  switch (state) {
    case 'VERIFIED':
    case 'DEPLOYED':
    case 'IMPLEMENTED':
    case 'ONLINE':
    case 'READY':
      return 'border-[#CCFF00]/60 bg-[#CCFF00]/12 text-[#CCFF00]';
    case 'FAILED':
    case 'BLOCKED':
    case 'QUALITY_BLOCKED':
      return 'border-[#FF007F]/60 bg-[#FF007F]/12 text-[#FF66B2]';
    case 'PARTIAL':
    case 'PENDING_APPROVAL':
      return 'border-[#FF5E3A]/55 bg-[#FF5E3A]/10 text-[#FF8C73]';
    default:
      return 'border-dashed border-[#475569] bg-[#0B1124] text-[#9AA8C7]';
  }
}

export const SoftwareProjectWorkspace: React.FC<SoftwareProjectWorkspaceProps> = ({
  initialCapabilities,
  statusData,
  onAuditUpdated,
}) => {
  const { authHeaders, authReady, isAuthenticated, session } = useAuth();
  const { showToast } = useToast();
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  const [capabilities, setCapabilities] = useState<SoftwareCapabilityStatusEntry[]>(
    initialCapabilities || []
  );
  const [projects, setProjects] = useState<SoftwareProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [subTab, setSubTab] = useState<ProjectSubTab>('preview');

  // Application-First builder state
  const [selectedDomainId, setSelectedDomainId] = useState<string>('saas');
  const [projectName, setProjectName] = useState('');
  const [projectPrompt, setProjectPrompt] = useState(DOMAIN_PRESETS[0].prompt);
  const [projectStack, setProjectStack] = useState<
    'node_fullstack' | 'node_api' | 'python_service' | 'static_web'
  >('node_fullstack');
  const [runInitialChecks, setRunInitialChecks] = useState(true);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  // Project Explorer / Code Editor state
  const [selectedRelPath, setSelectedRelPath] = useState<string>('');
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState<string>('');
  const [originalEditorContent, setOriginalEditorContent] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('Update source file');
  const [isSavingFile, setIsSavingFile] = useState(false);

  // Live Preview + Visual Inspector state
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewEndpoints, setPreviewEndpoints] = useState<
    Array<{ method: string; path: string; purpose: string }>
  >([]);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [inspectMode, setInspectMode] = useState<boolean>(false);
  const [showSecondaryApiContract, setShowSecondaryApiContract] = useState(false);
  const [showExecutionLogs, setShowExecutionLogs] = useState(true);
  const [iterationInstruction, setIterationInstruction] = useState('');
  const [isIteratingApp, setIsIteratingApp] = useState(false);

  // Right Column Visual Inspector
  const [visualElements, setVisualElements] = useState<VisualElementNode[]>([]);
  const [selectedVisualId, setSelectedVisualId] = useState<string>('');
  const [visualText, setVisualText] = useState<string>('');
  const [visualColor, setVisualColor] = useState<string>('');
  const [visualBgColor, setVisualBgColor] = useState<string>('');
  const [visualPadding, setVisualPadding] = useState<string>('');
  const [visualFontSize, setVisualFontSize] = useState<string>('');
  const [visualClassName, setVisualClassName] = useState<string>('');
  const [visualCommitMsg, setVisualCommitMsg] = useState<string>('');
  const [lastVisualEvidence, setLastVisualEvidence] = useState<{
    revisionId: string;
    evidenceHash: string;
  } | null>(null);
  const [isApplyingVisual, setIsApplyingVisual] = useState(false);

  // Debug & Auto-Repair state
  const [isRepairing, setIsRepairing] = useState(false);
  const [lastRepairSummary, setLastRepairSummary] = useState<{
    repaired: boolean;
    summary: string;
    diagnoses: string[];
  } | null>(null);

  // Database Workspace state
  const [dbInspector, setDbInspector] = useState<{
    persistenceMode: string;
    cloudSqlConfigured: boolean;
    schema: Record<string, unknown> | null;
    dataFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
    databaseIntegrations: ProjectIntegrationBinding[];
  } | null>(null);

  // Internet & Integrations Engine state
  const [internetPolicy, setInternetPolicy] = useState<{
    ssrfProtection?: string;
    blockedCidrs: string[];
    secrets: Array<{
      alias: string;
      provider: string;
      maskedPreview: string;
      envVarName: string;
      configured: boolean;
    }>;
  } | null>(null);
  const [probeUrl, setProbeUrl] = useState('https://registry.npmjs.org/zod/latest');
  const [probeMethod, setProbeMethod] = useState<'GET' | 'HEAD' | 'POST'>('GET');
  const [probeSecretAlias, setProbeSecretAlias] = useState('');
  const [isProbingUrl, setIsProbingUrl] = useState(false);
  const [probeResult, setProbeResult] = useState<any | null>(null);

  const [researchQuery, setResearchQuery] = useState('Node.js HTTP security best practices');
  const [isResearching, setIsResearching] = useState(false);
  const [researchResults, setResearchResults] = useState<
    Array<{ source: string; title: string; url: string; snippet: string; sha256: string }>
  >([]);

  const [registryEcosystem, setRegistryEcosystem] = useState<'npm' | 'pypi'>('npm');
  const [registryPackage, setRegistryPackage] = useState('express');
  const [isLookingUpPkg, setIsLookingUpPkg] = useState(false);
  const [registryResult, setRegistryResult] = useState<any | null>(null);

  const [secretAlias, setSecretAlias] = useState('');
  const [secretProvider, setSecretProvider] = useState('external_api');
  const [secretValue, setSecretValue] = useState('');
  const [secretEnvFallback, setSecretEnvFallback] = useState('');
  const [isSavingSecret, setIsSavingSecret] = useState(false);

  const [intType, setIntType] = useState<ProjectIntegrationBinding['type']>('http_api');
  const [intName, setIntName] = useState('');
  const [intEndpoint, setIntEndpoint] = useState('');
  const [intSecretAlias, setIntSecretAlias] = useState('');
  const [intHeaderName, setIntHeaderName] = useState('Authorization');
  const [isAttachingIntegration, setIsAttachingIntegration] = useState(false);
  const [testingIntegrationId, setTestingIntegrationId] = useState<string | null>(null);

  // Checks, Benchmark & Deploy state
  const [isRunningCheck, setIsRunningCheck] = useState<'build' | 'test' | 'security' | null>(null);
  const [benchmarkReport, setBenchmarkReport] = useState<SoftwareBenchmarkSuiteReport | null>(null);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState(false);

  const [approvalIdInput, setApprovalIdInput] = useState<string>('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [isVerifyingRuntime, setIsVerifyingRuntime] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState<string | null>(null);
  const [activeDeploymentFilter, setActiveDeploymentFilter] = useState<{
    deploymentId: string;
    executionId: string;
    logIds: string[];
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedProject =
    projects.find((p) => p.projectId === selectedProjectId) || projects[0] || null;

  // Newest revision is stored at index 0 via revisions.unshift(...)
  const latestFiles = selectedProject?.revisions[0]?.files || [];

  const selectedVisualNode = useMemo(
    () => visualElements.find((v) => v.zId === selectedVisualId) || null,
    [visualElements, selectedVisualId]
  );

  const isJsxSourceSelected = /\.(tsx|jsx)$/i.test(selectedRelPath);

  const syncVisualFormFromNode = (node: VisualElementNode | null) => {
    if (!node) {
      setVisualText('');
      setVisualColor('');
      setVisualBgColor('');
      setVisualPadding('');
      setVisualFontSize('');
      setVisualClassName('');
      return;
    }
    setVisualText(node.textContent || '');
    setVisualColor(node.styles.color || '');
    setVisualBgColor(node.styles.backgroundColor || '');
    setVisualPadding(node.styles.padding || '');
    setVisualFontSize(node.styles.fontSize || '');
    setVisualClassName(node.className || '');
  };

  // Validate postMessage events strictly against our sandboxed preview iframe instance
  useEffect(() => {
    const onWindowMessage = (event: MessageEvent) => {
      if (event.source !== previewIframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== 'ZYNTHEOR_ELEMENT_SELECTED') return;
      const targetId = typeof data.targetId === 'string' ? data.targetId.trim() : '';
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(targetId)) return;

      setSelectedVisualId(targetId);
      const matched = visualElements.find((v) => v.zId === targetId);
      if (matched) {
        syncVisualFormFromNode(matched);
      } else {
        setVisualText(typeof data.textContent === 'string' ? data.textContent : '');
        setVisualColor(typeof data.styles?.color === 'string' ? data.styles.color : '');
        setVisualBgColor(
          typeof data.styles?.backgroundColor === 'string' ? data.styles.backgroundColor : ''
        );
        setVisualPadding(typeof data.styles?.padding === 'string' ? data.styles.padding : '');
        setVisualFontSize(typeof data.styles?.fontSize === 'string' ? data.styles.fontSize : '');
      }
    };
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, [visualElements]);

  // Sync inspectMode into the sandbox="allow-scripts" iframe via typed postMessage
  useEffect(() => {
    if (previewIframeRef.current?.contentWindow) {
      previewIframeRef.current.contentWindow.postMessage(
        { type: 'ZYNTHEOR_SET_INSPECT_MODE', enabled: inspectMode },
        '*'
      );
    }
  }, [inspectMode, previewHtml]);

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
      // ignore transient error
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

  const loadFile = async (projectId: string, relPath: string, openCodeTab = false) => {
    if (!isAuthenticated || !projectId || !relPath) return;
    setErrorMessage(null);
    setLoadingFilePath(relPath);
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
      if (/\.(tsx|jsx)$/i.test(relPath)) {
        try {
          const elRes = await fetch(
            apiUrl(
              `/api/workspace/visual-elements?projectId=${encodeURIComponent(projectId)}&filePath=${encodeURIComponent(relPath)}`
            ),
            { headers: authHeaders() }
          );
          const elJson = await elRes.json();
          if (elRes.ok && elJson.success && Array.isArray(elJson.elements)) {
            setVisualElements(elJson.elements);
            if (elJson.elements.length > 0) {
              setSelectedVisualId(elJson.elements[0].zId);
              syncVisualFormFromNode(elJson.elements[0]);
            } else {
              setSelectedVisualId('');
              syncVisualFormFromNode(null);
            }
          }
        } catch {
          // noop
        }
      }
      if (openCodeTab) {
        setSubTab('code');
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoadingFilePath((prev) => (prev === relPath ? null : prev));
    }
  };

  const loadPreviewAndVisuals = async (projectId: string) => {
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
        if (!isJsxSourceSelected) {
          const elements: VisualElementNode[] = Array.isArray(json.visualElements)
            ? json.visualElements
            : [];
          setVisualElements(elements);
          if (elements.length > 0) {
            const keep = elements.find((el) => el.zId === selectedVisualId) || elements[0];
            setSelectedVisualId(keep.zId);
            syncVisualFormFromNode(keep);
          } else {
            setSelectedVisualId('');
            syncVisualFormFromNode(null);
          }
        }
      }
    } catch {
      // noop
    }
  };

  const loadDatabaseInspector = async (projectId: string) => {
    if (!isAuthenticated || !projectId) return;
    try {
      const res = await fetch(
        apiUrl(`/api/engineering/projects/${encodeURIComponent(projectId)}/database`),
        { headers: authHeaders() }
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setDbInspector(json.database || null);
      }
    } catch {
      // noop
    }
  };

  const loadInternetPolicy = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(apiUrl('/api/engineering/internet/policy'), {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setInternetPolicy(json.policy || null);
      }
    } catch {
      // noop
    }
  };

  const loadLatestBenchmark = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(apiUrl('/api/engineering/benchmark'), {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success && json.report) {
        setBenchmarkReport(json.report);
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
      void loadInternetPolicy();
      void loadLatestBenchmark();
    }
  }, [authReady, isAuthenticated]);

  useEffect(() => {
    setActiveDeploymentFilter(null);
    setLastRepairSummary(null);
    if (selectedProject && isAuthenticated) {
      setApprovalIdInput(selectedProject.deployment.approvalRequestId || '');
      const files = selectedProject.revisions[0]?.files || [];
      if (files.length > 0) {
        const stillExists = files.some((f) => f.relativePath === selectedRelPath);
        if (!stillExists) {
          const preferred =
            files.find((f) => f.relativePath === 'public/index.html')?.relativePath ||
            files[0].relativePath;
          void loadFile(selectedProject.projectId, preferred);
        }
      } else {
        setSelectedRelPath('');
        setEditorContent('');
        setOriginalEditorContent('');
      }
      void loadPreviewAndVisuals(selectedProject.projectId);
      if (subTab === 'database') {
        void loadDatabaseInspector(selectedProject.projectId);
      } else if (subTab === 'internet') {
        void loadInternetPolicy();
      } else if (subTab === 'checks') {
        void loadLatestBenchmark();
      }
    }
  }, [selectedProject?.projectId, selectedProject?.currentRevision, subTab, isAuthenticated]);

  const handleSelectDomainPreset = (preset: DomainPreset) => {
    setSelectedDomainId(preset.id);
    setProjectStack(preset.stack);
    setProjectPrompt(preset.prompt);
    promptInputRef.current?.focus();
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || isCreatingProject || !projectPrompt.trim()) return;
    setIsCreatingProject(true);
    setErrorMessage(null);
    setLastRepairSummary(null);
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
        throw new Error(json.error || 'Failed to plan and create application');
      }
      const created: SoftwareProjectRecord = json.project;
      setProjects((prev) => [created, ...prev.filter((p) => p.projectId !== created.projectId)]);
      setSelectedProjectId(created.projectId);
      setProjectName('');
      setSubTab('preview');
      await loadPreviewAndVisuals(created.projectId);
      const files = created.revisions[0]?.files || [];
      const firstFile =
        files.find((f) => f.relativePath === 'public/index.html')?.relativePath ||
        files[0]?.relativePath;
      if (firstFile) {
        await loadFile(created.projectId, firstFile);
      }
      await fetchCapabilities();
      onAuditUpdated?.();
      showToast({
        variant: 'success',
        title: 'Application Created',
        message: `${created.name} (${created.stack})`,
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleIterateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !isAuthenticated || isIteratingApp || !iterationInstruction.trim()) return;
    setIsIteratingApp(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/iterate`),
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ instruction: iterationInstruction.trim(), runChecks: true }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to apply application iteration');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      }
      setIterationInstruction('');
      await loadPreviewAndVisuals(selectedProject.projectId);
      onAuditUpdated?.();
      showToast({
        variant: 'success',
        title: 'Application Updated & Verified',
        message: json.summary || 'Revision committed and checks re-executed',
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsIteratingApp(false);
    }
  };

  const handleApplyVisualPatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !isAuthenticated || !selectedVisualId || isApplyingVisual) return;
    setIsApplyingVisual(true);
    setErrorMessage(null);
    try {
      if (isJsxSourceSelected) {
        const res = await fetch(apiUrl('/api/workspace/visual-edit'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            projectId: selectedProject.projectId,
            filePath: selectedRelPath,
            targetId: selectedVisualId,
            textContent: selectedVisualNode?.textContent !== undefined ? visualText : undefined,
            color: visualColor,
            backgroundColor: visualBgColor,
            padding: visualPadding,
            fontSize: visualFontSize,
            ...(visualClassName !== (selectedVisualNode?.className || '')
              ? { className: visualClassName }
              : {}),
            message: visualCommitMsg.trim() || `AST Visual Edit: ${selectedVisualId}`,
            runChecks: false,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Failed to apply Babel AST visual edit');
        }
        if (json.project) {
          setProjects((prev) =>
            prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
          );
        }
        if (Array.isArray(json.visualElements)) {
          setVisualElements(json.visualElements);
        }
        if (typeof json.updatedCode === 'string') {
          setEditorContent(json.updatedCode);
          setOriginalEditorContent(json.updatedCode);
        }
        setLastVisualEvidence({
          revisionId: json.revisionId,
          evidenceHash: json.evidenceHash,
        });
        setVisualCommitMsg('');
        onAuditUpdated?.();
        showToast({
          variant: 'success',
          title: 'Babel AST Visual Edit Committed',
          message: `${selectedVisualId} saved at ${json.revisionId} (${String(json.evidenceHash || '').slice(0, 12)}…)`,
        });
      } else {
        const res = await fetch(
          apiUrl(
            `/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/visual-patch`
          ),
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              targetId: selectedVisualId,
              textContent: selectedVisualNode?.textContent ? visualText : undefined,
              color: visualColor,
              backgroundColor: visualBgColor,
              padding: visualPadding,
              fontSize: visualFontSize,
              message: visualCommitMsg.trim() || `Visual Edit: ${selectedVisualId}`,
              runChecks: true,
            }),
          }
        );
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Failed to apply visual patch to source');
        }
        if (json.project) {
          setProjects((prev) =>
            prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
          );
        }
        if (Array.isArray(json.visualElements)) {
          setVisualElements(json.visualElements);
        }
        setLastVisualEvidence(
          json.revision
            ? {
                revisionId: json.revision.revisionId,
                evidenceHash: json.revision.treeSha256,
              }
            : null
        );
        setVisualCommitMsg('');
        await loadPreviewAndVisuals(selectedProject.projectId);
        if (selectedRelPath === 'public/index.html') {
          await loadFile(selectedProject.projectId, 'public/index.html');
        }
        onAuditUpdated?.();
        showToast({
          variant: 'success',
          title: 'Visual Patch Committed',
          message: `${selectedVisualId} saved at ${json.revision?.revisionId || 'latest revision'}`,
        });
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsApplyingVisual(false);
    }
  };

  const handleAutoRepair = async () => {
    if (!selectedProject || !isAuthenticated || isRepairing) return;
    setIsRepairing(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(`/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/repair`),
        {
          method: 'POST',
          headers: authHeaders(),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Auto-repair diagnostic failed');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      }
      setLastRepairSummary({
        repaired: Boolean(json.repaired),
        summary: json.summary || 'Repair cycle finished',
        diagnoses: Array.isArray(json.diagnoses) ? json.diagnoses : [],
      });
      await loadPreviewAndVisuals(selectedProject.projectId);
      if (selectedRelPath) {
        await loadFile(selectedProject.projectId, selectedRelPath);
      }
      onAuditUpdated?.();
      showToast({
        variant: json.repaired ? 'success' : 'info',
        title: json.repaired ? 'Auto-Repair Verified' : 'Diagnostic Complete',
        message: json.summary,
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsRepairing(false);
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
      if (relPath === 'public/index.html') {
        await loadPreviewAndVisuals(selectedProject.projectId);
      }
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

  const handleCreateFileByPath = async (relPath: string) => {
    const cleaned = relPath.trim().replace(/^\/+/, '');
    if (!cleaned || !selectedProject) return;
    const starter = cleaned.endsWith('.py')
      ? '# Module created in ZYNTHEOR Project Workspace\n'
      : cleaned.endsWith('.json')
        ? '{\n  "notes": "Created in ZYNTHEOR Project Workspace"\n}\n'
        : '// Created in ZYNTHEOR Project Workspace\n';
    await handleSaveFile(cleaned, starter);
    setSubTab('code');
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
      kind === 'build' ? 'build' : kind === 'test' ? 'test' : 'security-validate';
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
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsRunningCheck(null);
    }
  };

  const handleRunBenchmarkSuite = async () => {
    if (!isAuthenticated || isRunningBenchmark) return;
    setIsRunningBenchmark(true);
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/engineering/benchmark'), {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Software benchmark suite execution failed');
      }
      setBenchmarkReport(json.report);
      onAuditUpdated?.();
      showToast({
        variant: 'info',
        title: 'Software Benchmark Complete',
        message: `${json.report.levelsPassed}/${json.report.levelsAttempted} benchmark levels passed`,
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsRunningBenchmark(false);
    }
  };

  const handleProbeInternetUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || isProbingUrl || !probeUrl.trim()) return;
    setIsProbingUrl(true);
    setProbeResult(null);
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/engineering/internet/fetch'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          url: probeUrl.trim(),
          method: probeMethod,
          secretRefAlias: probeSecretAlias.trim() || undefined,
        }),
      });
      const json = await res.json();
      setProbeResult(json.result || json);
      onAuditUpdated?.();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsProbingUrl(false);
    }
  };

  const handleWebResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || isResearching || !researchQuery.trim()) return;
    setIsResearching(true);
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/engineering/internet/research'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ query: researchQuery.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Web research query failed');
      }
      setResearchResults(json.items || json.results || []);
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsResearching(false);
    }
  };

  const handleAttachResearch = async (item: {
    source: string;
    title: string;
    url: string;
    snippet: string;
    sha256: string;
  }) => {
    if (!selectedProject || !isAuthenticated) return;
    try {
      const res = await fetch(
        apiUrl(
          `/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/research`
        ),
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ query: researchQuery.trim(), ...item }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to attach research note');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      }
      showToast({ variant: 'success', title: 'Research Attached', message: item.title });
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleLookupRegistry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || isLookingUpPkg || !registryPackage.trim()) return;
    setIsLookingUpPkg(true);
    setRegistryResult(null);
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/engineering/internet/registry-lookup'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          registry: registryEcosystem,
          packageName: registryPackage.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setRegistryResult({
          found: false,
          name: registryPackage.trim(),
          error: json.error || 'Package lookup failed',
        });
      } else {
        setRegistryResult({ found: true, ...(json.package || json.lookup || json) });
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsLookingUpPkg(false);
    }
  };

  const handleSaveSecretRef = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || isSavingSecret || !secretAlias.trim() || !secretValue.trim()) return;
    setIsSavingSecret(true);
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/engineering/internet/secrets'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          alias: secretAlias.trim(),
          provider: secretProvider.trim() || 'external_api',
          secretValue: secretValue.trim(),
          envVarName: secretEnvFallback.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to store secret reference');
      }
      setSecretAlias('');
      setSecretValue('');
      setSecretEnvFallback('');
      await loadInternetPolicy();
      showToast({
        variant: 'success',
        title: 'Secret Reference Stored (AES-256-GCM)',
        message: `${json.secret?.alias} (${json.secret?.maskedPreview})`,
      });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSavingSecret(false);
    }
  };

  const handleAttachIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !selectedProject ||
      !isAuthenticated ||
      isAttachingIntegration ||
      !intName.trim() ||
      !intEndpoint.trim()
    ) {
      return;
    }
    setIsAttachingIntegration(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(
          `/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/integrations`
        ),
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            type: intType,
            name: intName.trim(),
            endpoint: intEndpoint.trim(),
            secretRefAlias: intSecretAlias.trim() || undefined,
            secretHeaderName: intHeaderName.trim() || undefined,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to attach external integration');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      }
      setIntName('');
      setIntEndpoint('');
      onAuditUpdated?.();
      showToast({ variant: 'success', title: 'Integration Bound', message: json.integration?.name });
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsAttachingIntegration(false);
    }
  };

  const handleTestIntegration = async (integrationId: string) => {
    if (!selectedProject || !isAuthenticated || testingIntegrationId) return;
    setTestingIntegrationId(integrationId);
    setErrorMessage(null);
    try {
      const res = await fetch(
        apiUrl(
          `/api/engineering/projects/${encodeURIComponent(
            selectedProject.projectId
          )}/integrations/${encodeURIComponent(integrationId)}/test`
        ),
        { method: 'POST', headers: authHeaders() }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Integration connectivity probe failed');
      }
      if (json.project) {
        setProjects((prev) =>
          prev.map((p) => (p.projectId === selectedProject.projectId ? json.project : p))
        );
      }
      onAuditUpdated?.();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setTestingIntegrationId(null);
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
      setSubTab('deploy');
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
          `/api/engineering/projects/${encodeURIComponent(
            selectedProject.projectId
          )}/verify-runtime`
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

  const focusDeploymentLogs = (item: DeploymentHistoryTimelineItem) => {
    setActiveDeploymentFilter({
      deploymentId: item.deploymentId,
      executionId: item.executionId,
      logIds: item.linkedLogIds || [],
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
        apiUrl(
          `/api/engineering/projects/${encodeURIComponent(selectedProject.projectId)}/rollback`
        ),
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
        const first = json.project.revisions[0]?.files[0]?.relativePath;
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

  const hasActiveFailure = Boolean(
    selectedProject &&
      (selectedProject.lastBuild?.status === 'FAILED' ||
        selectedProject.lastTests?.status === 'FAILED' ||
        selectedProject.lastSecurityScan?.status === 'BLOCKED')
  );

  // Separated truth indicators: Cloud App Engine vs Native Neural Intelligence
  const cloudOnline = Boolean(
    statusData?.truthDashboard?.onlineRuntimeConnectivity?.connected ||
      statusData?.connectivity?.online ||
      isAuthenticated
  );
  const cloudLabel = statusData?.connectivity?.cloudStorageConfigured
    ? cloudOnline
      ? 'Cloud Runtime Online'
      : 'Cloud Degraded'
    : isAuthenticated
      ? 'App Engine Connected'
      : 'Auth Required';

  const nativeModelState = statusData?.model?.runtimeState || 'NOT_CONFIGURED';
  const nativeExecutionOk = Boolean(statusData?.model?.executionVerified);
  const nativeIntelligenceGates = statusData?.truthDashboard?.nativeIntelligenceGates || [];

  const allPreDeployChecksVerified = Boolean(
    selectedProject &&
      selectedProject.lastBuild?.status === 'VERIFIED' &&
      selectedProject.lastTests?.status === 'VERIFIED' &&
      selectedProject.lastSecurityScan?.status === 'VERIFIED'
  );

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="p-3 rounded-xl bg-[#FF007F]/12 border border-[#FF007F]/45 text-xs font-mono text-[#FF99C8] flex items-center justify-between gap-3">
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

      {/* TOP WORKSPACE HEADER: Dual Separated Status + Prompt-Driven App Builder */}
      <section className="rounded-2xl bg-[#0D1326] border border-[#1E294A] p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#1E294A]">
          <div>
            <h2 className="text-sm font-bold text-[#F4F7FF] tracking-tight">
              ZYNTHEOR Application Engineering Workspace
            </h2>
            <p className="text-xs text-[#9AA8C7] mt-0.5">
              Analyze, generate, visually edit, test, auto-repair, and verify real full-stack applications in isolated sandboxes.
            </p>
          </div>

          {/* Strictly Separated Truth Status Indicators */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[#9AA8C7]">App Engine &amp; Cloud:</span>
              <StatusDot
                status={cloudOnline ? 'ONLINE' : 'UNAVAILABLE'}
                label={cloudLabel}
                pulse={false}
              />
            </div>
            <span className="text-[#334155]" aria-hidden="true">
              |
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[#9AA8C7]">Native Intelligence:</span>
              <StatusDot
                status={nativeExecutionOk ? 'READY' : toDotState(nativeModelState)}
                label={nativeExecutionOk ? 'READY (VERIFIED)' : nativeModelState}
                pulse={false}
              />
            </div>
          </div>
        </div>

        {!isAuthenticated ? (
          <div className="p-3.5 rounded-xl bg-[#070B19] border border-[#1E294A] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-[#CBD5E1]">
              <Lock className="w-4 h-4 text-[#FF5E3A] shrink-0" />
              <span>
                Sign in with a Developer or Administrator account to create, visually inspect, test, repair, or deploy applications.
              </span>
            </div>
            <StatusDot status="BLOCKED" label="AUTH REQUIRED" />
          </div>
        ) : (
          <form onSubmit={handleCreateProject} className="space-y-3">
            {/* Domain Segmented Selector + Stack Options */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#070B19] border border-[#1E294A]"
                role="group"
                aria-label="Application Domain Presets"
              >
                {DOMAIN_PRESETS.map((preset) => {
                  const active = selectedDomainId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectDomainPreset(preset)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-[#00F0FF] text-[#070B19]'
                          : 'text-[#9AA8C7] hover:text-[#F4F7FF]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="App name (auto-derived)"
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF] w-44"
                />
                <select
                  value={projectStack}
                  onChange={(e) => setProjectStack(e.target.value as any)}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF]"
                >
                  <option value="node_fullstack">Full-Stack Web App (UI + Store + Tests)</option>
                  <option value="static_web">Interactive Frontend App + Contract Tests</option>
                  <option value="node_api">Node Service + Automated Tests</option>
                  <option value="python_service">Python 3 Service + unittest</option>
                </select>
                <label className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={runInitialChecks}
                    onChange={(e) => setRunInitialChecks(e.target.checked)}
                  />
                  <span>Auto-Verify Build &amp; Tests</span>
                </label>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-2.5">
              <input
                ref={promptInputRef}
                type="text"
                required
                value={projectPrompt}
                onChange={(e) => setProjectPrompt(e.target.value)}
                placeholder="Describe the application to build (user flows, views, data schema, integrations)..."
                className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-[#070B19] border border-[#1E294A] text-xs md:text-sm text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF]"
              />
              <button
                type="submit"
                disabled={isCreatingProject}
                className="min-h-[44px] px-5 py-2 rounded-xl text-xs font-bold text-[#070B19] bg-[#00F0FF] hover:bg-[#33F3FF] transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <AppWindow className="w-4 h-4" />
                <span>{isCreatingProject ? 'Building Application...' : 'Execute Application Task'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#9AA8C7] tabular-nums">
              <span>Analyze &rarr; Build &rarr; Test &rarr; Debug &rarr; Verify</span>
              <span>
                Tenant: <strong className="text-[#00F0FF]">{session?.tenantId || 'default'}</strong> · Sandbox: /workspace/projects
              </span>
            </div>
          </form>
        )}
      </section>

      {/* 3-COLUMN RESIZABLE WORKSPACE SHELL */}
      <WorkspaceLayout
        explorerLabel="Project Explorer"
        editorLabel="Editor & Live Preview"
        inspectorLabel="Visual Inspector"
        explorer={
          <ProjectExplorer
            projects={projects}
            selectedProject={selectedProject}
            onSelectProject={setSelectedProjectId}
            onRefreshProjects={() => void fetchProjects()}
            onNewApp={() => promptInputRef.current?.focus()}
            files={latestFiles}
            selectedFilePath={selectedRelPath}
            loadingFilePath={loadingFilePath}
            onSelectFile={(relPath) =>
              selectedProject
                ? loadFile(selectedProject.projectId, relPath, true)
                : undefined
            }
            onCreateFile={handleCreateFileByPath}
            onDeleteFile={handleDeleteFile}
            toDotState={toDotState}
          />
        }
        editor={
          <div className="h-full bg-[#0D1326] min-w-0">
          {/* Tab Bar + Quick Verification Controls */}
          <div className="px-3.5 py-2.5 bg-[#0B1124] border-b border-[#1E294A] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              {(
                [
                  { id: 'preview', label: 'Live Preview', icon: Eye },
                  { id: 'code', label: 'Code', icon: Code2 },
                  { id: 'database', label: 'Database', icon: Database },
                  { id: 'internet', label: 'Internet', icon: Globe },
                  { id: 'checks', label: 'Tests & Benchmark', icon: Terminal },
                  { id: 'deploy', label: 'Deploy & Timeline', icon: Rocket },
                  { id: 'capabilities', label: 'Capabilities', icon: ShieldCheck },
                ] as const
              ).map((t) => {
                const Icon = t.icon;
                const isActive = subTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSubTab(t.id)}
                    className={`min-h-[34px] px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
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
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleRunCheck('build')}
                  disabled={Boolean(isRunningCheck)}
                  className="min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#131B36] border border-[#1E294A] hover:border-[#00F0FF] text-[#00F0FF] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isRunningCheck === 'build' ? 'Building...' : 'Build'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunCheck('test')}
                  disabled={Boolean(isRunningCheck)}
                  className="min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#131B36] border border-[#1E294A] hover:border-[#CCFF00] text-[#CCFF00] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isRunningCheck === 'test' ? 'Testing...' : 'Test'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunCheck('security')}
                  disabled={Boolean(isRunningCheck)}
                  className="min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#131B36] border border-[#1E294A] hover:border-[#C084FC] text-[#C084FC] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isRunningCheck === 'security' ? 'Scanning...' : 'Scan'}
                </button>
              </div>
            )}
          </div>

          {/* Debug & Auto-Repair Banner whenever a Build, Test, or Security Scan fails */}
          {selectedProject && hasActiveFailure && (
            <div className="mx-4 mt-4 p-3.5 rounded-xl bg-[#FF007F]/10 border border-[#FF007F]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-bold text-[#FF66B2] flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Verification Failure Detected on {selectedProject.currentRevision}</span>
                </div>
                <div className="text-[11px] font-mono text-[#CBD5E1] line-clamp-2">
                  {selectedProject.lastSecurityScan?.status === 'BLOCKED'
                    ? selectedProject.lastSecurityScan.summary
                    : selectedProject.lastBuild?.status === 'FAILED'
                      ? selectedProject.lastBuild.summary
                      : selectedProject.lastTests?.summary}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleAutoRepair()}
                disabled={isRepairing}
                className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-[#FF007F] hover:bg-[#FF3399] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>{isRepairing ? 'Diagnosing & Repairing...' : 'Ask ZYNTHEOR to Fix'}</span>
              </button>
            </div>
          )}

          {lastRepairSummary && (
            <div className="mx-4 mt-3 p-3 rounded-xl bg-[#070B19] border border-[#1E294A] text-[11px] font-mono space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className={lastRepairSummary.repaired ? 'text-[#CCFF00] font-bold' : 'text-[#FF8C73] font-bold'}>
                  Auto-Repair Outcome: {lastRepairSummary.summary}
                </span>
                <button
                  type="button"
                  onClick={() => setLastRepairSummary(null)}
                  className="text-[#9AA8C7] hover:text-white underline cursor-pointer"
                >
                  Close
                </button>
              </div>
              {lastRepairSummary.diagnoses.map((d, i) => (
                <div key={i} className="text-[#9AA8C7] truncate">
                  · {d}
                </div>
              ))}
            </div>
          )}

          {/* SUB-TAB 1: LIVE INTERACTIVE PREVIEW & EXECUTION LOG */}
          {subTab === 'preview' && (
            <div className="p-4 bg-[#070B19] space-y-4">
              {!selectedProject ? (
                <div className="py-16 text-center space-y-2">
                  <div className="text-xs font-semibold text-[#F4F7FF]">
                    No Application Selected
                  </div>
                  <div className="text-xs text-[#9AA8C7] max-w-md mx-auto">
                    Choose a domain preset above or describe what you want to build and click Execute Application Task to scaffold and verify your app.
                  </div>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {/* Natural Language App Evolution */}
                  <form
                    onSubmit={handleIterateApp}
                    className="p-3 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#00F0FF]" />
                        Refine Application in Natural Language
                      </span>
                      <span className="text-[10px] font-mono text-[#9AA8C7]">
                        Preserves source + commits SHA-256 revision
                      </span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={iterationInstruction}
                        onChange={(e) => setIterationInstruction(e.target.value)}
                        placeholder="e.g. Add SLA export workflow banner or customer priority filter..."
                        className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs text-white focus:outline-none focus:border-[#00F0FF]"
                      />
                      <button
                        type="submit"
                        disabled={isIteratingApp || !iterationInstruction.trim()}
                        className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#00F0FF] text-[#070B19] font-bold text-xs whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {isIteratingApp ? 'Applying...' : 'Apply Change'}
                      </button>
                    </div>
                  </form>

                  {/* Interactive Preview Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-white flex items-center gap-2">
                      <span>Interactive App Preview</span>
                      <span className="text-[11px] font-mono text-[#9AA8C7] tabular-nums">
                        {selectedProject.currentRevision}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setInspectMode((v) => !v)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border cursor-pointer whitespace-nowrap shrink-0 ${
                          inspectMode
                            ? 'bg-[#CCFF00] text-[#070B19] border-[#CCFF00]'
                            : 'bg-[#131B36] text-[#CBD5E1] border-[#1E294A] hover:border-[#00F0FF]'
                        }`}
                        title="Toggle click-to-inspect element selection inside the preview"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>{inspectMode ? 'Inspecting UI' : 'Select Element'}</span>
                      </button>

                      {(
                        [
                          { id: 'desktop', icon: Monitor, label: 'Desktop' },
                          { id: 'tablet', icon: Tablet, label: 'Tablet' },
                          { id: 'mobile', icon: Smartphone, label: 'Mobile' },
                        ] as const
                      ).map((vp) => {
                        const Icon = vp.icon;
                        return (
                          <button
                            key={vp.id}
                            type="button"
                            onClick={() => setPreviewViewport(vp.id)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-mono flex items-center gap-1 border cursor-pointer whitespace-nowrap shrink-0 ${
                              previewViewport === vp.id
                                ? 'bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]'
                                : 'bg-[#131B36] text-[#9AA8C7] border-[#1E294A]'
                            }`}
                          >
                            <Icon className="w-3 h-3" />
                            <span>{vp.label}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => void loadPreviewAndVisuals(selectedProject.projectId)}
                        className="px-2.5 py-1 rounded-lg bg-[#131B36] border border-[#1E294A] text-[11px] font-semibold text-[#00F0FF] cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Reload
                      </button>
                    </div>
                  </div>

                  {/* Strictly Sandboxed Preview Iframe (allow-scripts allow-forms WITHOUT allow-same-origin) */}
                  <div className="rounded-xl border border-[#1E294A] overflow-hidden bg-[#0B1124] flex justify-center p-2">
                    <iframe
                      ref={previewIframeRef}
                      title={`${selectedProject.name} Preview`}
                      sandbox="allow-scripts allow-forms"
                      srcDoc={previewHtml}
                      className={`h-[430px] bg-[#070B19] rounded-lg border border-[#1E294A] transition-all ${
                        previewViewport === 'mobile'
                          ? 'w-[375px] max-w-full'
                          : previewViewport === 'tablet'
                            ? 'w-[768px] max-w-full'
                            : 'w-full'
                      }`}
                    />
                  </div>

                  {/* Compact Live Execution Log Strip */}
                  <div className="rounded-xl bg-[#0D1326] border border-[#1E294A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowExecutionLogs((v) => !v)}
                      className="w-full px-3.5 py-2 bg-[#0B1124] flex items-center justify-between text-xs font-semibold text-[#F4F7FF] cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-[#00F0FF]" />
                        <span>
                          Execution Log ({selectedProject.evidenceHistory.length} execution(s) ·{' '}
                          {selectedProject.runtimeLogs.length} log entry)
                        </span>
                      </span>
                      {showExecutionLogs ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#9AA8C7]" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#9AA8C7]" />
                      )}
                    </button>
                    {showExecutionLogs && (
                      <div className="p-2.5 max-h-44 overflow-y-auto divide-y divide-[#1E294A] font-mono text-[11px]">
                        {selectedProject.runtimeLogs.slice(0, 12).map((log, i) => (
                          <div
                            key={log.logId || i}
                            className="py-1.5 flex items-start justify-between gap-3"
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
                            </span>
                            <span className="text-[#64748B] shrink-0 tabular-nums">
                              {log.timestamp.slice(11, 19)}Z
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Secondary Backend API Contract */}
                  <div className="rounded-xl bg-[#0D1326] border border-[#1E294A] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#CBD5E1]">
                        Supporting Backend Routes ({previewEndpoints.length} endpoint(s))
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSecondaryApiContract((v) => !v)}
                        className="text-[11px] font-mono text-[#00F0FF] hover:underline cursor-pointer"
                      >
                        {showSecondaryApiContract ? 'Hide Routes' : 'Inspect Routes'}
                      </button>
                    </div>
                    {showSecondaryApiContract && (
                      <div className="overflow-x-auto rounded-lg border border-[#1E294A]">
                        <table className="w-full text-left text-xs font-mono">
                          <thead className="bg-[#0B1124] border-b border-[#1E294A] text-[#9AA8C7]">
                            <tr>
                              <th className="py-2 px-3">Method</th>
                              <th className="py-2 px-3">Path</th>
                              <th className="py-2 px-3">Purpose</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1E294A] bg-[#070B19]">
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
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 2: SOURCE CODE EDITOR */}
          {subTab === 'code' && (
            <div className="p-4 bg-[#070B19]">
              {!selectedProject ? (
                <div className="py-12 text-center text-xs text-[#9AA8C7]">
                  Select or create an application, then pick any file from the left Project Explorer to edit it.
                </div>
              ) : (
                <div className="flex flex-col space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#9AA8C7]">
                    <span className="truncate">
                      File: <strong className="text-white">{selectedRelPath || 'None selected'}</strong>
                      {hasUnsaved && <span className="ml-2 text-[#FF8C73]">(modified)</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Revision commit message"
                        className="px-2.5 py-1.5 rounded-lg bg-[#0D1326] border border-[#1E294A] text-[11px] text-white"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveFile()}
                        disabled={!selectedRelPath || isSavingFile || !hasUnsaved}
                        className="px-3 py-1.5 rounded-lg bg-[#00F0FF] text-[#070B19] font-bold text-xs flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSavingFile ? 'Saving...' : 'Commit Revision'}</span>
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    className="w-full min-h-[440px] p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] font-mono text-xs leading-relaxed text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF]"
                  />
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 3: DATABASE & PERSISTENCE WORKSPACE */}
          {subTab === 'database' && (
            <div className="p-4 bg-[#070B19] space-y-4">
              {!selectedProject ? (
                <div className="py-12 text-center text-xs text-[#9AA8C7]">
                  Select an application to inspect its persistent datastore, schema definition, and database connections.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1">
                      <div className="text-[11px] text-[#9AA8C7]">Persistence Mode</div>
                      <div className="font-mono font-bold text-[#00F0FF]">
                        {dbInspector?.persistenceMode || 'json_file_store'}
                      </div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1">
                      <div className="text-[11px] text-[#9AA8C7]">Managed Cloud SQL</div>
                      <StatusDot
                        status={dbInspector?.cloudSqlConfigured ? 'VERIFIED' : 'NOT_CONFIGURED'}
                        label={dbInspector?.cloudSqlConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED'}
                      />
                    </div>
                    <div className="p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1">
                      <div className="text-[11px] text-[#9AA8C7]">Bound Database Integrations</div>
                      <div className="font-mono font-bold text-white tabular-nums">
                        {dbInspector?.databaseIntegrations?.length || 0} connected
                      </div>
                    </div>
                  </div>

                  {dbInspector?.schema && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-bold text-white">
                        Application Data Schema (data/schema.json)
                      </div>
                      <pre className="p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] font-mono text-[11px] text-[#CCFF00] overflow-x-auto">
                        {JSON.stringify(dbInspector.schema, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="text-xs font-bold text-white">Schema &amp; Persistence Files</div>
                    <div className="divide-y divide-[#1E294A] rounded-xl bg-[#0D1326] border border-[#1E294A] font-mono text-xs">
                      {(dbInspector?.dataFiles || []).length === 0 ? (
                        <div className="p-3 text-[#9AA8C7]">
                          No explicit schema files in this stack revision.
                        </div>
                      ) : (
                        dbInspector!.dataFiles.map((df) => (
                          <div
                            key={df.relativePath}
                            className="p-3 flex items-center justify-between gap-2"
                          >
                            <span className="text-[#00F0FF]">{df.relativePath}</span>
                            <span className="text-[10px] text-[#9AA8C7] tabular-nums">
                              {df.bytes} B · sha256:{df.sha256.slice(0, 14)}…
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 4: INTERNET CONNECTIVITY, WEB RESEARCH, REGISTRY & INTEGRATIONS */}
          {subTab === 'internet' && (
            <div className="p-4 bg-[#070B19] space-y-4">
              <div className="p-3.5 rounded-xl bg-[#0D1326] border border-[#1E294A] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <Globe className="w-4 h-4 text-[#00F0FF]" />
                    Internet Connectivity Engine &amp; SSRF Guardrails
                  </div>
                  <div className="text-[11px] font-mono text-[#9AA8C7] mt-0.5">
                    Blocks loopback/private/metadata CIDRs ({internetPolicy?.blockedCidrs?.slice(0, 4).join(', ') || '127.0.0.0/8, 10.0.0.0/8, 169.254.169.254'}) + DNS rebinding validation
                  </div>
                </div>
                <StatusDot
                  status={internetPolicy ? 'VERIFIED' : 'UNVERIFIED'}
                  label={internetPolicy?.ssrfProtection || 'SSRF GUARD ACTIVE'}
                />
              </div>

              <form
                onSubmit={handleProbeInternetUrl}
                className="p-4 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-3"
              >
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <PlugZap className="w-3.5 h-3.5 text-[#00F0FF]" />
                  Live Outbound HTTP/HTTPS Connectivity Probe
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={probeMethod}
                    onChange={(e) => setProbeMethod(e.target.value as any)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                  >
                    <option value="GET">GET</option>
                    <option value="HEAD">HEAD</option>
                    <option value="POST">POST</option>
                  </select>
                  <input
                    type="url"
                    required
                    value={probeUrl}
                    onChange={(e) => setProbeUrl(e.target.value)}
                    placeholder="https://api.example.com/health"
                    className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                  />
                  <input
                    type="text"
                    value={probeSecretAlias}
                    onChange={(e) => setProbeSecretAlias(e.target.value)}
                    placeholder="Secret alias"
                    className="sm:w-32 min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                  />
                  <button
                    type="submit"
                    disabled={isProbingUrl}
                    className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#00F0FF] text-[#070B19] font-bold text-xs whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    {isProbingUrl ? 'Connecting...' : 'Probe URL'}
                  </button>
                </div>

                {probeResult && (
                  <div className="p-3 rounded-lg bg-[#070B19] border border-[#1E294A] text-[11px] font-mono space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusDot
                        status={
                          probeResult.ok
                            ? 'VERIFIED'
                            : probeResult.blockedByPolicy
                              ? 'BLOCKED'
                              : 'FAILED'
                        }
                        label={
                          probeResult.ok
                            ? `HTTP ${probeResult.status} (${probeResult.latencyMs}ms)`
                            : probeResult.blockedByPolicy
                              ? 'SSRF BLOCKED'
                              : `FAILED (${probeResult.status || 'NET_ERR'})`
                        }
                      />
                      {probeResult.contentSha256 && (
                        <span className="text-[#9AA8C7]">
                          sha256:{String(probeResult.contentSha256).slice(0, 16)}…
                        </span>
                      )}
                    </div>
                    {probeResult.error && (
                      <div className="text-[#FF8C73]">{probeResult.error}</div>
                    )}
                    {(probeResult.bodyPreview || probeResult.bodySnippet) && (
                      <pre className="p-2 rounded bg-[#0D1326] border border-[#1E294A] text-[#CBD5E1] whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {probeResult.bodyPreview || probeResult.bodySnippet}
                      </pre>
                    )}
                  </div>
                )}
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-3">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-[#C084FC]" />
                    Web Research &amp; Retrieval
                  </div>
                  <form onSubmit={handleWebResearch} className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={researchQuery}
                      onChange={(e) => setResearchQuery(e.target.value)}
                      placeholder="Topic or URL to research..."
                      className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs text-white"
                    />
                    <button
                      type="submit"
                      disabled={isResearching}
                      className="px-3 py-1.5 rounded-lg bg-[#C084FC] text-[#070B19] font-bold text-xs whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      {isResearching ? 'Searching...' : 'Search'}
                    </button>
                  </form>

                  {researchResults.length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto text-[11px]">
                      {researchResults.map((r, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-[#070B19] border border-[#1E294A] space-y-1"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-bold text-[#00F0FF]">{r.title}</span>
                            {selectedProject && (
                              <button
                                type="button"
                                onClick={() => void handleAttachResearch(r)}
                                className="px-2 py-0.5 rounded bg-[#131B36] border border-[#1E294A] hover:border-[#00F0FF] text-[10px] font-mono text-[#CCFF00] shrink-0 cursor-pointer"
                              >
                                + Attach
                              </button>
                            )}
                          </div>
                          <div className="text-[#CBD5E1] line-clamp-2">{r.snippet}</div>
                          <div className="text-[10px] font-mono text-[#64748B] truncate">
                            [{r.source}] {r.url}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-3">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <PackageSearch className="w-3.5 h-3.5 text-[#CCFF00]" />
                    Dependency Registry (npm / PyPI)
                  </div>
                  <form onSubmit={handleLookupRegistry} className="flex gap-2">
                    <select
                      value={registryEcosystem}
                      onChange={(e) => setRegistryEcosystem(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                    >
                      <option value="npm">npm</option>
                      <option value="pypi">PyPI</option>
                    </select>
                    <input
                      type="text"
                      required
                      value={registryPackage}
                      onChange={(e) => setRegistryPackage(e.target.value)}
                      placeholder="Package name (e.g. zod, fastapi)"
                      className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                    />
                    <button
                      type="submit"
                      disabled={isLookingUpPkg}
                      className="px-3 py-1.5 rounded-lg bg-[#CCFF00] text-[#070B19] font-bold text-xs whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      {isLookingUpPkg ? 'Looking up...' : 'Lookup'}
                    </button>
                  </form>

                  {registryResult && (
                    <div className="p-2.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-[11px] font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-bold">
                          {registryResult.name || registryResult.packageName}@
                          {registryResult.version || registryResult.latestVersion || 'N/A'}
                        </span>
                        <StatusDot
                          status={registryResult.found ? 'VERIFIED' : 'FAILED'}
                          label={registryResult.found ? 'FOUND' : 'NOT FOUND'}
                        />
                      </div>
                      {registryResult.description && (
                        <div className="text-[#CBD5E1] font-sans">{registryResult.description}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-3">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-[#FF5E3A]" />
                    Secret Reference Vault (AES-256-GCM)
                  </div>
                  <form onSubmit={handleSaveSecretRef} className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={secretAlias}
                        onChange={(e) => setSecretAlias(e.target.value)}
                        placeholder="Alias"
                        className="px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                      />
                      <input
                        type="text"
                        value={secretProvider}
                        onChange={(e) => setSecretProvider(e.target.value)}
                        placeholder="Provider"
                        className="px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                      />
                    </div>
                    <input
                      type="password"
                      required
                      value={secretValue}
                      onChange={(e) => setSecretValue(e.target.value)}
                      placeholder="Secret API key / token"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={secretEnvFallback}
                        onChange={(e) => setSecretEnvFallback(e.target.value)}
                        placeholder="ENV fallback"
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                      />
                      <button
                        type="submit"
                        disabled={isSavingSecret}
                        className="px-3 py-1.5 rounded-lg bg-[#FF5E3A] text-[#070B19] font-bold text-xs whitespace-nowrap cursor-pointer disabled:opacity-50"
                      >
                        {isSavingSecret ? 'Saving...' : 'Store Secret'}
                      </button>
                    </div>
                  </form>
                  <div className="divide-y divide-[#1E294A] text-[10px] font-mono">
                    {(internetPolicy?.secrets || []).map((sr) => (
                      <div key={sr.alias} className="py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[#00F0FF]">
                          {sr.alias} ({sr.provider})
                        </span>
                        <span className="text-[#9AA8C7]">{sr.maskedPreview}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-3">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <PlugZap className="w-3.5 h-3.5 text-[#00F0FF]" />
                    External Service Integrations
                  </div>
                  {!selectedProject ? (
                    <div className="text-xs text-[#9AA8C7]">Select a project to bind services.</div>
                  ) : (
                    <>
                      <form onSubmit={handleAttachIntegration} className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={intType}
                            onChange={(e) => setIntType(e.target.value as any)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                          >
                            <option value="http_api">HTTP API</option>
                            <option value="websocket">WebSocket</option>
                            <option value="database">Database</option>
                            <option value="auth">Auth</option>
                            <option value="registry_pkg">Registry</option>
                          </select>
                          <input
                            type="text"
                            required
                            value={intName}
                            onChange={(e) => setIntName(e.target.value)}
                            placeholder="Service name"
                            className="px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs text-white"
                          />
                        </div>
                        <input
                          type="text"
                          required
                          value={intEndpoint}
                          onChange={(e) => setIntEndpoint(e.target.value)}
                          placeholder="https://... or wss://..."
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                        />
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={intSecretAlias}
                            onChange={(e) => setIntSecretAlias(e.target.value)}
                            placeholder="Secret alias"
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                          />
                          <input
                            type="text"
                            value={intHeaderName}
                            onChange={(e) => setIntHeaderName(e.target.value)}
                            placeholder="Header"
                            className="w-24 px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                          />
                          <button
                            type="submit"
                            disabled={isAttachingIntegration}
                            className="px-3 py-1.5 rounded-lg bg-[#00F0FF] text-[#070B19] font-bold text-xs whitespace-nowrap cursor-pointer disabled:opacity-50"
                          >
                            Bind
                          </button>
                        </div>
                      </form>
                      <div className="divide-y divide-[#1E294A] max-h-36 overflow-y-auto text-[11px] font-mono">
                        {(selectedProject.integrations || []).map((intg) => (
                          <div
                            key={intg.integrationId}
                            className="py-1.5 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-white font-bold truncate">
                                [{intg.type}] {intg.name}
                              </div>
                              <div className="text-[10px] text-[#9AA8C7] truncate">
                                {intg.endpoint}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <StatusDot
                                status={toDotState(intg.lastStatus)}
                                label={intg.lastStatus || 'UNVERIFIED'}
                              />
                              <button
                                type="button"
                                onClick={() => void handleTestIntegration(intg.integrationId)}
                                disabled={testingIntegrationId === intg.integrationId}
                                className="px-2 py-0.5 rounded bg-[#131B36] border border-[#1E294A] text-[10px] text-[#00F0FF] cursor-pointer"
                              >
                                Test
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SUB-TAB 5: TESTS & BENCHMARK */}
          {subTab === 'checks' && (
            <div className="p-4 bg-[#070B19] space-y-4">
              {selectedProject ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">Build</span>
                        <StatusDot
                          status={selectedProject.lastBuild?.status || 'UNVERIFIED'}
                          label={selectedProject.lastBuild?.status || 'UNVERIFIED'}
                        />
                      </div>
                      <div className="text-[11px] font-mono text-[#9AA8C7]">
                        {selectedProject.lastBuild?.summary || 'Not executed'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">Tests</span>
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
                        {selectedProject.lastTests?.summary || 'Not executed'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">Security</span>
                        <StatusDot
                          status={selectedProject.lastSecurityScan?.status || 'UNVERIFIED'}
                          label={selectedProject.lastSecurityScan?.status || 'UNVERIFIED'}
                        />
                      </div>
                      <div className="text-[11px] font-mono text-[#9AA8C7]">
                        {selectedProject.lastSecurityScan?.summary || 'Not scanned'}
                      </div>
                    </div>
                  </div>

                  {selectedProject.lastBuild?.output && (
                    <pre className="p-3 rounded-xl bg-[#0D1326] border border-[#1E294A] text-[11px] font-mono text-[#CBD5E1] whitespace-pre-wrap overflow-x-auto max-h-36">
                      {selectedProject.lastBuild.output}
                    </pre>
                  )}

                  {selectedProject.lastTests?.output && (
                    <pre className="p-3 rounded-xl bg-[#0D1326] border border-[#1E294A] text-[11px] font-mono text-[#CCFF00] whitespace-pre-wrap overflow-x-auto max-h-44">
                      {selectedProject.lastTests.output}
                    </pre>
                  )}

                  {selectedProject.lastSecurityScan &&
                    selectedProject.lastSecurityScan.findings.length > 0 && (
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
                    )}
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-[#9AA8C7]">
                  Select a project to inspect project-level checks.
                </div>
              )}

              <div className="p-4 rounded-xl bg-[#0D1326] border border-[#1E294A] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Award className="w-4 h-4 text-[#CCFF00]" />
                      Software Capability Benchmark (Levels 1–4)
                    </div>
                    <div className="text-[11px] text-[#9AA8C7]">
                      Executes isolated full-stack builds, test suites, UI contract assertions, and SSRF probes.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRunBenchmarkSuite()}
                    disabled={isRunningBenchmark}
                    className="min-h-[36px] px-4 py-1.5 rounded-lg bg-[#CCFF00] text-[#070B19] font-bold text-xs whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    {isRunningBenchmark ? 'Running Suite...' : 'Run Benchmark'}
                  </button>
                </div>

                {benchmarkReport && (
                  <div className="space-y-3">
                    <div className="text-[11px] font-mono text-[#00F0FF] tabular-nums">
                      Run {benchmarkReport.runId} · {benchmarkReport.levelsPassed}/
                      {benchmarkReport.levelsAttempted} levels passed ·{' '}
                      {benchmarkReport.totalDurationMs}ms
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      {benchmarkReport.dimensions.map((d) => (
                        <div
                          key={d.dimension}
                          className="p-2.5 rounded-lg bg-[#070B19] border border-[#1E294A] space-y-1"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-white truncate">{d.dimension}</span>
                            <StatusDot
                              status={toDotState(d.status)}
                              label={d.scorePct !== null ? `${d.scorePct}%` : d.status}
                            />
                          </div>
                          <div className="text-[10px] text-[#9AA8C7]">{d.measurement}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SUB-TAB 6: CLOUD DEPLOYMENT, HISTORY TIMELINE & ROLLBACK */}
          {subTab === 'deploy' && (
            <div className="p-4 bg-[#070B19] space-y-4">
              {!selectedProject ? (
                <div className="py-12 text-center text-xs text-[#9AA8C7]">
                  Select an application to inspect deployments, Verification Evidence timeline, and rollback snapshots.
                </div>
              ) : (
                <>
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
                        placeholder="ApprovalGate Request ID"
                        className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white"
                      />
                      <button
                        type="button"
                        onClick={() => void handleDeploy()}
                        disabled={isDeploying}
                        className="min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-bold text-[#070B19] bg-[#00F0FF] hover:bg-[#33F3FF] flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        <Rocket className="w-3.5 h-3.5" />
                        <span>
                          {isDeploying
                            ? 'Evaluating...'
                            : approvalIdInput
                              ? 'Execute Approved Deploy'
                              : 'Request Deployment Approval'}
                        </span>
                      </button>
                      {selectedProject.deployment.targetEndpoint && (
                        <button
                          type="button"
                          onClick={() => void handleVerifyRuntime()}
                          disabled={isVerifyingRuntime}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold text-[#CCFF00] bg-[#131B36] border border-[#1E294A] hover:border-[#CCFF00] flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          <span>{isVerifyingRuntime ? 'Probing...' : 'Probe Runtime'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <DeploymentHistoryTimeline
                    projectId={selectedProject.projectId}
                    refreshKey={`${selectedProject.updatedAt}_${selectedProject.deploymentHistory?.length || 0}`}
                    activeDeploymentId={activeDeploymentFilter?.deploymentId}
                    onViewProjectLogs={focusDeploymentLogs}
                  />

                  <div className="space-y-2">
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <History className="w-4 h-4 text-[#C084FC]" />
                      Version History &amp; Controlled Rollback
                    </div>
                    <div className="divide-y divide-[#1E294A] rounded-xl bg-[#0D1326] border border-[#1E294A]">
                      {selectedProject.revisions.map((rev) => (
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

                  <div id="project-runtime-logs" className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-white">Runtime Logs</div>
                      {activeDeploymentFilter && (
                        <button
                          type="button"
                          onClick={() => setActiveDeploymentFilter(null)}
                          className="px-2 py-1 rounded bg-[#131B36] border border-[#1E294A] text-[11px] font-mono text-[#00F0FF] cursor-pointer"
                        >
                          Clear Filter
                        </button>
                      )}
                    </div>
                    <div className="max-h-52 overflow-y-auto rounded-xl bg-[#0D1326] border border-[#1E294A] divide-y divide-[#1E294A] font-mono text-[11px]">
                      {(() => {
                        const orderedLogs = [...selectedProject.runtimeLogs];
                        const displayedLogs = activeDeploymentFilter
                          ? orderedLogs.filter(
                              (log) =>
                                (log.logId && activeDeploymentFilter.logIds.includes(log.logId)) ||
                                log.deploymentId === activeDeploymentFilter.deploymentId ||
                                log.executionId === activeDeploymentFilter.executionId
                            )
                          : orderedLogs;
                        if (displayedLogs.length === 0) {
                          return <div className="p-3 text-[#9AA8C7]">No matching runtime logs.</div>;
                        }
                        return displayedLogs.map((log, i) => (
                          <div
                            key={log.logId || i}
                            className="px-3 py-2 flex items-start justify-between gap-3"
                          >
                            <span className="text-[#CBD5E1] min-w-0">
                              <span className="text-[#00F0FF] font-bold">[{log.level}]</span>{' '}
                              <span className="text-[#9AA8C7]">({log.source})</span> {log.message}
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

          {/* SUB-TAB 7: 13 CAPABILITIES MATRIX */}
          {subTab === 'capabilities' && (
            <div className="p-4 bg-[#070B19] divide-y divide-[#1E294A]">
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
          )}
          </div>
        }
        inspector={
          <div className="h-full bg-[#0D1326] min-w-0">
          <div className="px-3.5 py-2.5 bg-[#0B1124] border-b border-[#1E294A] flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-[#F4F7FF] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#00F0FF]" />
                <span>Visual Inspector</span>
              </div>
              <div className="text-[11px] font-mono text-[#9AA8C7] truncate">
                {isJsxSourceSelected
                  ? `Babel AST Patcher · ${selectedRelPath}`
                  : 'Real Source Patcher · public/index.html'}
              </div>
            </div>
            <span className="text-[10px] font-mono text-[#9AA8C7] tabular-nums">
              {visualElements.length} node(s)
            </span>
          </div>

          {!selectedProject ? (
            <div className="p-4 text-xs text-[#9AA8C7]">
              Select or build an application to inspect and edit UI element properties directly in source code.
            </div>
          ) : visualElements.length === 0 ? (
            <div className="p-4 text-xs text-[#9AA8C7]">
              No HTML visual nodes (`data-z-id`) in this stack. Use the Code tab to inspect {selectedProject.stack} modules.
            </div>
          ) : (
            <div className="p-3.5 space-y-3.5">
              {/* Element Selector */}
              <div className="space-y-1.5">
                <label
                  htmlFor="visual-element-select"
                  className="block text-[11px] font-semibold text-[#9AA8C7]"
                >
                  Target UI Element (or click inside Preview)
                </label>
                <select
                  id="visual-element-select"
                  value={selectedVisualId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedVisualId(id);
                    const node = visualElements.find((v) => v.zId === id) || null;
                    syncVisualFormFromNode(node);
                  }}
                  className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-[#F4F7FF] focus:outline-none focus:border-[#00F0FF]"
                >
                  {visualElements.map((el) => (
                    <option key={el.zId} value={el.zId}>
                      &lt;{el.tagName}&gt; {el.label} ({el.zId})
                    </option>
                  ))}
                </select>
              </div>

              {selectedVisualNode && (
                <form onSubmit={handleApplyVisualPatch} className="space-y-3 text-xs">
                  {selectedVisualNode.textContent && (
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-[#CBD5E1]">
                        Text Content
                      </label>
                      <input
                        type="text"
                        value={visualText}
                        onChange={(e) => setVisualText(e.target.value)}
                        className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs text-white focus:outline-none focus:border-[#00F0FF]"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-[#CBD5E1]">
                        Text Color
                      </label>
                      <input
                        type="text"
                        value={visualColor}
                        onChange={(e) => setVisualColor(e.target.value)}
                        placeholder="#F4F7FF"
                        className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white focus:outline-none focus:border-[#00F0FF]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-[#CBD5E1]">
                        Background
                      </label>
                      <input
                        type="text"
                        value={visualBgColor}
                        onChange={(e) => setVisualBgColor(e.target.value)}
                        placeholder="#0D1326"
                        className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white focus:outline-none focus:border-[#00F0FF]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-[#CBD5E1]">
                        Padding
                      </label>
                      <input
                        type="text"
                        value={visualPadding}
                        onChange={(e) => setVisualPadding(e.target.value)}
                        placeholder="0.5rem 1rem"
                        className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white focus:outline-none focus:border-[#00F0FF]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-[#CBD5E1]">
                        Font Size
                      </label>
                      <input
                        type="text"
                        value={visualFontSize}
                        onChange={(e) => setVisualFontSize(e.target.value)}
                        placeholder="1.15rem"
                        className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white focus:outline-none focus:border-[#00F0FF]"
                      />
                    </div>
                  </div>

                  {isJsxSourceSelected && (
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-[#CBD5E1]">
                        className (JSX Prop)
                      </label>
                      <input
                        type="text"
                        value={visualClassName}
                        onChange={(e) => setVisualClassName(e.target.value)}
                        placeholder="px-4 py-2 rounded-lg"
                        className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs font-mono text-white focus:outline-none focus:border-[#00F0FF]"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-[#9AA8C7]">
                      Revision Message (optional)
                    </label>
                    <input
                      type="text"
                      value={visualCommitMsg}
                      onChange={(e) => setVisualCommitMsg(e.target.value)}
                      placeholder={`Visual Edit: ${selectedVisualNode.zId}`}
                      className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-xs text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isApplyingVisual}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-[#070B19] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>
                      {isApplyingVisual
                        ? 'Patching & Re-Verifying...'
                        : isJsxSourceSelected
                          ? 'Patch JSX/TSX AST & Commit'
                          : 'Apply to Source & Commit Revision'}
                    </span>
                  </button>

                  {lastVisualEvidence && (
                    <div className="p-2.5 rounded-lg bg-[#070B19] border border-[#1E294A] text-[10px] font-mono text-[#9AA8C7] space-y-0.5 tabular-nums">
                      <div>
                        Revision: <span className="text-[#CCFF00] font-bold">{lastVisualEvidence.revisionId}</span>
                      </div>
                      <div className="truncate" title={lastVisualEvidence.evidenceHash}>
                        SHA-256: <span className="text-[#00F0FF]">{lastVisualEvidence.evidenceHash}</span>
                      </div>
                    </div>
                  )}
                </form>
              )}
            </div>
          )}
          </div>
        }
      />

      {/* BOTTOM EVIDENCE & NATIVE INTELLIGENCE GATES STRIP */}
      <section className="rounded-2xl bg-[#0D1326] border border-[#1E294A] p-4 space-y-4">
        {/* Row 1: Application Execution & Deployment Verification Strip */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-bold text-[#F4F7FF]">
              Application Verification &amp; Release Evidence
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
              <div
                className={`px-2.5 py-1 rounded-lg border ${gatePillClass(
                  selectedProject?.lastBuild?.status || 'UNVERIFIED'
                )}`}
              >
                Build: {selectedProject?.lastBuild?.status || 'EVIDENCE REQUIRED'}
              </div>
              <span className="text-[#475569]" aria-hidden="true">
                &rarr;
              </span>
              <div
                className={`px-2.5 py-1 rounded-lg border ${gatePillClass(
                  selectedProject?.lastTests?.status || 'UNVERIFIED'
                )}`}
              >
                Tests:{' '}
                {selectedProject?.lastTests
                  ? `${selectedProject.lastTests.status} (${selectedProject.lastTests.passed}/${selectedProject.lastTests.total})`
                  : 'EVIDENCE REQUIRED'}
              </div>
              <span className="text-[#475569]" aria-hidden="true">
                &rarr;
              </span>
              <div
                className={`px-2.5 py-1 rounded-lg border ${gatePillClass(
                  selectedProject?.lastSecurityScan?.status || 'UNVERIFIED'
                )}`}
              >
                Security: {selectedProject?.lastSecurityScan?.status || 'EVIDENCE REQUIRED'}
              </div>
              <span className="text-[#475569]" aria-hidden="true">
                &rarr;
              </span>
              <div
                className={`px-2.5 py-1 rounded-lg border ${gatePillClass(
                  selectedProject?.deployment?.status || 'NOT_CONFIGURED'
                )}`}
              >
                Deploy: {selectedProject?.deployment?.status || 'NOT_CONFIGURED'}
              </div>
            </div>
          </div>

          {selectedProject && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {allPreDeployChecksVerified && selectedProject.deployment.status !== 'DEPLOYED' && (
                <button
                  type="button"
                  onClick={() => void handleDeploy()}
                  disabled={isDeploying}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-[#00F0FF] hover:bg-[#33F3FF] text-[#070B19] text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <Rocket className="w-3.5 h-3.5" />
                  <span>
                    {selectedProject.deployment.status === 'PENDING_APPROVAL'
                      ? 'Pending Admin Approval'
                      : 'Request Deployment Approval'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSubTab('deploy')}
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#131B36] border border-[#1E294A] hover:border-[#00F0FF] text-xs font-semibold text-[#CBD5E1] whitespace-nowrap cursor-pointer"
              >
                Inspect Timeline &amp; Hashes
              </button>
            </div>
          )}
        </div>

        {/* Row 2: Honest Native Intelligence & Production Gates (TruthDashboard-Backed) */}
        <div className="pt-3 border-t border-[#1E294A] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-[#F4F7FF]">
              Native Intelligence &amp; Production Readiness Gates
            </span>
            <span className="text-[11px] font-mono text-[#9AA8C7]">
              Truth-First Runtime Telemetry · Never inferred from Cloud App Engine status
            </span>
          </div>
          {nativeIntelligenceGates.length === 0 ? (
            <div className="text-xs font-mono text-[#9AA8C7] px-3 py-2 rounded-lg border border-dashed border-[#475569] bg-[#0B1124]">
              EVIDENCE REQUIRED: Native Intelligence gate telemetry unavailable in current session snapshot.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
              {nativeIntelligenceGates.map((gate) => (
                <div
                  key={gate.id}
                  title={gate.reason}
                  className={`p-2.5 rounded-xl border text-[11px] space-y-1 ${gatePillClass(
                    gate.state
                  )}`}
                >
                  <div className="flex items-center justify-between gap-1 font-semibold">
                    <span className="truncate">
                      {gate.order}. {gate.name}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] font-bold">{gate.state}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default SoftwareProjectWorkspace;
