/**
 * ZYNTHEOR VIVID ECOSYSTEM - TYPE DEFINITIONS
 */

export type ModuleId =
  | 'command_center'
  | 'conversational_intelligence'
  | 'intelligence_core'
  | 'proof_of_intelligence'
  | 'dev_studio'
  | 'research_lab'
  | 'automation_center'
  | 'knowledge_hub'
  | 'model_laboratory'
  | 'experiment_center'
  | 'infrastructure_cloud'
  | 'api_platform'
  | 'marketplace'
  | 'subscription_billing'
  | 'analytics_bi'
  | 'governance_security'
  | 'user_settings'
  | 'admin_console';

export type StatusLevel = 'IMPLEMENTED' | 'VERIFIED' | 'PARTIAL' | 'BLOCKED' | 'UNVERIFIED' | 'NOT IMPLEMENTED' | 'NOT_CONFIGURED';

export interface EvidenceDrawerItem {
  id?: string;
  title: string;
  subtitle?: string;
  status: string;
  hash?: string | null;
  timestamp?: string | null;
  source?: string | null;
  details: Array<{ label: string; value: string }>;
  remediation?: string[];
  rawJson?: unknown;
  targetModule?: ModuleId;
  targetLabel?: string;
}

export interface Citation {
  docTitle: string;
  collection: string;
  chunkIndex: number;
  score: number;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  thought?: string;
  citations?: Citation[];
  correlationId?: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ResourceSample {
  timestamp: string;
  timeLabel: string;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  cpuCores: number;
  processHeapUsedMb: number;
  processHeapTotalMb: number;
  processRssMb: number;
  systemRamUsedMb: number;
  systemRamTotalMb: number;
  systemRamFreeMb: number;
  tokensPerSec?: number;
  lastInferenceLatencyMs?: number;
  // Compatibility fields
  cpuPercent?: number;
  vramMb?: number;
  ramUsedMb?: number;
  ramTotalMb?: number;
}

export interface ConnectivityHealthState {
  online: boolean;
  onlineConnectivityRequired: boolean;
  failClosed?: boolean;
  browserOnline: boolean;
  status: string;
  runtimeState: string;
  internetReachable?: boolean;
  internetStatus?: 'ONLINE' | 'OFFLINE';
  internetProbeDetail?: string;
  modelConnectivityReady?: boolean;
  remediationSteps?: string[];
  executionVerified: boolean;
  executionError?: string | null;
  trainedProvenance?: string | null;
  weightsRole?: string | null;
  code?: string | null;
  reason?: string | null;
  cloudSource?: string | null;
  cloudSourceUri?: string | null;
  cloudStorageConfigured?: boolean;
  cloudStorageReachable?: boolean;
  cloudConfigValid?: boolean;
  cloudConfigProvider?: string;
  cloudConfigMissingKeys?: string[];
  cloudConfigError?: string | null;
  pythonBridgeReachable?: boolean;
  bridgeLifecycle?: string;
  weightsLoaded: boolean;
  weightsSource?: string | null;
  checkpointPath?: string | null;
  checkpointSha256?: string | null;
  tokenizerSha256?: string | null;
  activeRuntimeId?: string | null;
  totalParams: number;
  modelName?: string | null;
  latencyMs?: number;
  lastCheckedAt?: string | null;
  lastOnlineAt?: string | null;
}

export interface EndToEndVerificationStage {
  id:
    | 'dns_lookup'
    | 'https_probe'
    | 'cloud_storage'
    | 'cloud_runtime_health'
    | 'checkpoint_load_verify'
    | 'native_inference';
  order: number;
  label: string;
  status: 'PASS' | 'BLOCKED' | 'FAIL';
  latencyMs: number;
  evidence: Record<string, any>;
  error: string | null;
}

export interface SubsystemOnlinePolicyEntry {
  id: string;
  name: string;
  status: 'VERIFIED' | 'IMPLEMENTED' | 'BLOCKED' | 'NOT_CONFIGURED';
  onlineRequired: boolean;
  sovereignControlled: boolean;
  failClosedOnNetworkLoss: boolean;
  evidence: string;
  blocker: string | null;
}

export interface EndToEndVerificationReport {
  overallStatus: 'VERIFIED' | 'BLOCKED' | 'FAILED';
  onlineReady: boolean;
  internetConnected: boolean;
  cloudConnected: boolean;
  checkpointVerified: boolean;
  inferenceVerified: boolean;
  executedAt: string;
  totalLatencyMs: number;
  stages: EndToEndVerificationStage[];
  subsystemPolicyMatrix: SubsystemOnlinePolicyEntry[];
  remediationSteps: string[];
}

export interface CloudPreflightReport {
  passed: boolean;
  status: 'PREFLIGHT_PASS' | 'PREFLIGHT_BLOCKED';
  checks: {
    credentialsValid: boolean;
    bucketAvailable: boolean;
    checkpointExists: boolean;
    checkpointAccessible: boolean;
    readWriteVerified: boolean;
  };
  bucket: string | null;
  region: string;
  endpoint: string | null;
  checkpointKey: string;
  checkpointSizeBytes: number | null;
  checkpointETag: string | null;
  checkpointLastModified: string | null;
  headerMagicValid: boolean | null;
  httpStatusCode: number | null;
  missingCredentials: string[];
  blockers: string[];
  error: string | null;
  latencyMs: number;
  checkedAt: string;
}

export interface TrainingProgressAlert {
  id: 'stalled_progress' | 'val_loss_rising';
  severity: 'warning';
  title: string;
  detail: string;
  detectedAt: string;
}

export interface TimeToEpochEstimate {
  windowSteps: number;
  maxWindowSteps: number;
  averageStepSeconds: number | null;
  remainingStepsInEpoch: number;
  estimatedSecondsToEpoch: number | null;
  recentStepDurationsSec: number[];
  basis: 'last_10_steps' | 'completed' | 'awaiting_step_history';
}

export interface TrainingPipelineProgressSummary {
  pipelineId: string | null;
  status: 'RUNNING' | 'VERIFIED' | 'FAILED' | 'READY' | 'BLOCKED';
  running: boolean;
  trainingCompletedVerified: boolean;
  currentStep: number;
  targetSteps: number;
  currentEpoch?: number | null;
  totalEpochs?: number | null;
  elapsedSeconds?: number | null;
  estimatedSecondsRemaining?: number | null;
  secondsPerStep?: number | null;
  timeToEpoch?: TimeToEpochEstimate | null;
  lastStepAdvanceAt?: string | null;
  stalledMinutes?: number | null;
  valLossDelta?: number | null;
  recentValLosses?: number[];
  alerts?: TrainingProgressAlert[];
  evalEvery: number;
  saveEvery: number;
  targetParams: number;
  evaluationsRecorded: number;
  verifiedCheckpointsCount: number;
  plannedCheckpointsCount: number;
  latestTrainLoss: number | null;
  latestValLoss: number | null;
  latestPerplexity: number | null;
  latestGradNorm: number | null;
  latestLr: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  initializedAt: string | null;
  gatesPassed: number;
  gatesTotal: number;
  blockers: string[];
  error: string | null;
}

export interface SystemStatusData {
  success: boolean;
  model: {
    name: string;
    architecture: string;
    totalParams: number;
    activeParams: number | null;
    targetParams?: number | null;
    checkpointHash: string;
    checkpointPath?: string | null;
    checkpointSha256?: string | null;
    tokenizerSha256?: string | null;
    activeRuntimeId?: string | null;
    weightsLoaded: boolean;
    inferenceReady: boolean;
    runtimeState: string;
    readinessReason?: string;
    executionVerified?: boolean;
    onlineConnectivityRequired?: boolean;
    failClosedReason?: string;
  };
  audit: {
    totalRecords: number;
    chainValid: boolean;
    headHash: string;
  };
  commercial: {
    currentPhase: 'PRIVATE_BETA' | 'PUBLIC_BETA' | 'COMMERCIAL_LAUNCH';
    activeTenantId: string;
    activePlanId: string;
    tasksCompleted: number;
    tasksFailed: number;
    taskCompletionRate: number;
    totalTokensProcessed: number;
    cloudApiCostUsd: number;
    nativeComputeCostUsd: number;
    simulatedRevenueUsd: number;
    grossMarginPct: number;
    readinessChecklist: Record<string, { passed: boolean; evidence: string }>;
  };
  sandbox: {
    path: string;
    fileCount: number;
    files: string[];
  };
  resources?: {
    current: ResourceSample;
    history: ResourceSample[];
  };
  training?: TrainingPipelineProgressSummary | null;
  connectivity?: ConnectivityHealthState | null;
  cloudPreflight?: CloudPreflightReport | null;
  truthDashboard?: any;
  serverTime: string;
  uptimeSeconds: number;
}

export interface VerificationSuiteData {
  verified: boolean;
  total_tests: number;
  passed_tests: number;
  checkpoint_hash: string;
  timestamp: number;
  results: Array<{
    test_id: string;
    name: string;
    status: 'PASS' | 'FAIL';
    evidence: string;
    duration_ms: number;
  }>;
}

export interface AuditRecord {
  index: number;
  timestamp: string;
  prev_hash: string;
  role: 'SYSTEM' | 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER' | 'EVOLVER' | 'COMMERCIAL' | 'GOVERNANCE';
  action: string;
  payload_digest: string;
  payload: Record<string, any>;
  entry_hash: string;
}

export interface EvolutionRecord {
  cycle_id: string;
  timestamp: number;
  domain: string;
  score_before: number;
  score_after: number;
  improvement_pct: number;
  stages: Array<{
    stage: string;
    action: string;
    findings?: string;
    score_before?: string;
    score_after?: string;
    delta?: string;
    status?: string;
    evidence?: string;
  }>;
}

export interface WorkspaceFileDetail {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface OrchestrationEvent {
  type: 'init' | 'step' | 'chunk' | 'review' | 'test' | 'done' | 'error';
  role?: 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER';
  message: string;
  data?: any;
  timestamp: string;
}

export interface VisualElementNode {
  zId: string;
  tagName: string;
  label: string;
  textContent: string;
  className?: string;
  styles: {
    color?: string;
    backgroundColor?: string;
    padding?: string;
    fontSize?: string;
    [key: string]: string | undefined;
  };
}

export interface VisualPropertyPatchInput {
  targetId: string;
  textContent?: string;
  color?: string;
  backgroundColor?: string;
  padding?: string;
  fontSize?: string;
  message?: string;
  runChecks?: boolean;
  styles?: Record<string, string | null | undefined>;
}

export interface ProjectRepairResult {
  project: any;
  revision: any;
  repaired: boolean;
  modifiedFiles: string[];
  diagnoses: string[];
  summary: string;
}

export interface SoftwareBenchmarkDimensionScore {
  dimension: string;
  status: string;
  scorePct: number | null;
  measurement: string;
  evidenceSource: string;
}

export interface SoftwareBenchmarkTaskResult {
  level: number;
  taskId: string;
  title: string;
  stack: string;
  passed: boolean;
  durationMs: number;
  buildVerified: boolean;
  testsPassed: number;
  testsTotal: number;
  securityFindingsHighMedium: number;
  uiContractChecksPassed: number;
  uiContractChecksTotal: number;
  evidenceHash: string;
  summary: string;
}

export interface SoftwareBenchmarkSuiteReport {
  runId: string;
  executedAt: string;
  environment: string;
  totalDurationMs: number;
  levelsAttempted: number;
  levelsPassed: number;
  dimensions: SoftwareBenchmarkDimensionScore[];
  tasks: SoftwareBenchmarkTaskResult[];
  reproducibility: string;
}

export interface PersistentTaskRecord {
  taskId: string;
  goal: string;
  priority: 'High' | 'Medium' | 'Low';
  lifecycleStatus: 'Planned' | 'Running' | 'Blocked' | 'Delivered' | 'Failed';
  resumable: boolean;
  blockedReason?: string | null;
  ownerUserId: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  executionCycle?: any;
}

export interface ProjectIntegrationBinding {
  integrationId: string;
  type: 'http_api' | 'websocket' | 'database' | 'auth' | 'registry_pkg';
  name: string;
  endpoint: string;
  secretRefAlias?: string | null;
  secretHeaderName?: string | null;
  notes?: string;
  createdAt: string;
  lastTestedAt?: string | null;
  lastStatus?: 'VERIFIED' | 'UNVERIFIED' | 'BLOCKED' | 'FAILED';
  lastHttpStatus?: number | null;
  lastLatencyMs?: number | null;
  lastResponseSha256?: string | null;
  lastError?: string | null;
}

export interface DeploymentHistoryTimelineItem {
  deploymentId: string;
  revisionId: string;
  executionId: string;
  timestamp: string;
  status: 'NOT_CONFIGURED' | 'BLOCKED' | 'PENDING_APPROVAL' | 'DEPLOYED' | 'FAILED';
  targetProvider: string | null;
  targetEndpoint: string | null;
  approvalRequestId: string | null;
  artifactZip: string | null;
  artifactSha256: string | null;
  runtimeHttpStatus: number | null;
  runtimeResponseSha256?: string | null;
  latencyMs?: number | null;
  reason: string;
  evidenceHash: string;
  linkedLogIds: string[];
  projectId: string;
  projectName: string;
  projectSlug: string;
  stack: SoftwareProjectRecord['stack'];
  verificationState: 'VERIFIED' | 'UNVERIFIED' | 'BLOCKED';
  logsUrl: string;
  linkedLogs: Array<{
    logId: string;
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR';
    source: string;
    message: string;
    deploymentId?: string;
    executionId?: string;
    stage?: string;
  }>;
  verificationEvidence: {
    deploymentHash: {
      artifactSha256: string | null;
      evidenceHash: string;
      artifactZip: string | null;
      revisionId: string;
      hashVerified: boolean;
    };
    cloudRuntimeResponse: {
      state: 'VERIFIED' | 'UNVERIFIED' | 'BLOCKED';
      endpoint: string | null;
      provider: string | null;
      httpStatus: number | null;
      responseSha256: string | null;
      latencyMs: number | null;
      summary: string;
    };
    automatedTestResults: {
      state: 'VERIFIED' | 'UNVERIFIED' | 'BLOCKED';
      status: 'VERIFIED' | 'FAILED' | 'UNVERIFIED';
      passed: number;
      total: number;
      summary: string;
      executedAt: string | null;
    };
  };
}

export interface SoftwareCapabilityStatusEntry {
  id: string;
  name: string;
  status: 'IMPLEMENTED' | 'PARTIAL' | 'BLOCKED' | 'UNVERIFIED' | 'NOT_IMPLEMENTED' | 'NOT_CONFIGURED';
  evidenceSource: string;
  lastVerifiedAt: string;
  detail: string;
  missingDependency?: string;
}

export interface SoftwareProjectRecord {
  projectId: string;
  tenantId: string;
  ownerUserId: string;
  name: string;
  slug: string;
  description: string;
  stack: 'node_fullstack' | 'node_api' | 'python_service' | 'static_web';
  attribution: 'deterministic_engineering_engine' | 'native_cloud_model_assisted';
  nativeNeuralState: string;
  workspaceDir: string;
  currentRevision: string;
  createdAt: string;
  updatedAt: string;
  requirementsSpec: {
    rawPrompt: string;
    objectives: string[];
    endpoints: Array<{ method: string; path: string; purpose: string }>;
    dependencies: string[];
    risks: string[];
    architectureSummary: string;
  };
  stages: Array<{
    stage: string;
    order: number;
    label: string;
    status: string;
    completedAt: string | null;
    summary: string;
    artifactReference: string | null;
    evidenceHash: string | null;
  }>;
  stageExecutions: Array<any>;
  revisions: Array<{
    revisionId: string;
    revisionNumber: number;
    createdAt: string;
    createdBy: string;
    message: string;
    treeSha256: string;
    files: Array<{
      relativePath: string;
      bytes: number;
      sha256: string;
      snapshotId: string | null;
    }>;
  }>;
  evidenceHistory: Array<any>;
  lastBuild: {
    status: string;
    executedAt: string | null;
    durationMs: number;
    checkedFiles: number;
    summary: string;
    output: string;
  } | null;
  lastTests: {
    status: string;
    executedAt: string | null;
    durationMs: number;
    passed: number;
    total: number;
    summary: string;
    output: string;
  } | null;
  lastSecurityScan: {
    status: string;
    scannedAt: string | null;
    findings: Array<{ severity: string; file: string; rule: string; detail: string }>;
    summary: string;
  } | null;
  deployment: {
    status: 'NOT_CONFIGURED' | 'BLOCKED' | 'PENDING_APPROVAL' | 'DEPLOYED' | 'FAILED';
    approvalRequestId: string | null;
    targetProvider: string | null;
    targetEndpoint: string | null;
    artifactZip: string | null;
    artifactSha256: string | null;
    deployedAt: string | null;
    runtimeVerifiedAt: string | null;
    runtimeHttpStatus: number | null;
    runtimeResponseSha256?: string | null;
    latencyMs?: number | null;
    lastDeploymentId?: string | null;
    lastExecutionId?: string | null;
    reason: string;
  };
  deploymentHistory: Array<any>;
  integrations?: ProjectIntegrationBinding[];
  researchNotes?: Array<any>;
  runtimeLogs: Array<{
    logId: string;
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR';
    source: string;
    message: string;
    deploymentId?: string;
    executionId?: string;
    stage?: string;
  }>;
}
