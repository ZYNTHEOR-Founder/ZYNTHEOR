/**
 * ZYNTHEOR VIVID ECOSYSTEM - TYPE DEFINITIONS
 */

export type ModuleId =
  | 'command_center'
  | 'autonomous_execution'
  | 'cognitive_operations'
  | 'conversational_intelligence'
  | 'intelligence_core'
  | 'dev_studio'
  | 'research_lab'
  | 'automation_center'
  | 'knowledge_hub'
  | 'model_laboratory'
  | 'experiment_center'
  | 'api_platform'
  | 'marketplace'
  | 'subscription_billing'
  | 'analytics_bi'
  | 'governance_security'
  | 'user_settings'
  | 'admin_console';

export type RuntimeLifecycleState =
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'NOT_LOADED'
  | 'NOT_TRAINED'
  | 'INITIALIZING'
  | 'READY'
  | 'QUALITY_BLOCKED'
  | 'FAILED';

export type StatusLevel =
  | 'IMPLEMENTED'
  | 'VERIFIED'
  | 'ACTIVE'
  | 'ONLINE'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'FAILED'
  | 'NOT IMPLEMENTED'
  | 'NOT RUN';

export interface Citation {
  docTitle: string;
  collection: string;
  chunkIndex: number;
  score: number;
  snippet: string;
}

export interface ChatMessageProvenance {
  inferenceOrigin?: 'native_model_logits' | 'orchestrator_structured' | string;
  weightsRole?: 'learned_sequence_lm' | 'subgraph_forward_only' | 'unloaded' | string;
  groundingOrigin?: 'rag_retrieval' | 'none' | string;
  cancelled?: boolean;
  promptTruncated?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  thought?: string;
  citations?: Citation[];
  correlationId?: string;
  provenance?: ChatMessageProvenance;
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
  tokensPerSec?: number | null;
  lastInferenceLatencyMs?: number | null;
  telemetryStatus?: 'MEASURED' | 'UNAVAILABLE';
  // Compatibility fields
  cpuPercent?: number;
  vramMb?: number;
  ramUsedMb?: number;
  ramTotalMb?: number;
}

export type BridgeLifecycleState =
  | 'Initializing'
  | 'Connecting'
  | 'Connected'
  | 'Degraded'
  | 'Reconnecting'
  | 'Unreachable'
  | 'Initialization Error'
  | 'Session Timeout'
  | 'Service Error';

export type BridgeFailureCategory =
  | 'none'
  | 'unreachable'
  | 'initialization_error'
  | 'session_timeout';

export interface BridgeLifecycleTelemetry {
  state: BridgeLifecycleState;
  previousState: BridgeLifecycleState | null;
  failureCategory?: BridgeFailureCategory;
  backoffPolicy?: {
    category: BridgeFailureCategory;
    baseDelayMs: number;
    maxDelayMs: number;
    multiplier: number;
  };
  transitionAt: string;
  pid: number | null;
  heartbeatIntervalMs: number;
  lastHeartbeatAt: string | null;
  lastVerifiedHeartbeatAt?: string | null;
  lastHeartbeatLatencyMs: number | null;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  nextRetryDelayMs: number | null;
  nextRetryAt: string | null;
  consecutiveFailures: number;
  totalPings: number;
  totalFailures: number;
  lastError: string | null;
  cloudConfigValid?: boolean;
  cloudConfigMissingKeys?: string[];
  cloudConfigError?: string | null;
}

export interface ConnectivityHealthState {
  online: boolean;
  onlineConnectivityRequired: boolean;
  browserOnline?: boolean;
  status: string;
  runtimeState?: RuntimeLifecycleState;
  executionVerified?: boolean;
  executionError?: string | null;
  trainedProvenance?: string | null;
  weightsRole?: string | null;
  code?: string | null;
  reason?: string | null;
  cloudSource?: string | null;
  cloudStorageConfigured?: boolean;
  cloudStorageReachable?: boolean;
  cloudConfigValid?: boolean;
  cloudConfigProvider?: string;
  cloudConfigMissingKeys?: string[];
  cloudConfigError?: string | null;
  pythonBridgeReachable?: boolean;
  bridgeLifecycle?: BridgeLifecycleTelemetry;
  weightsLoaded: boolean;
  weightsSource?: string | null;
  checkpointPath?: string | null;
  checkpointSha256?: string | null;
  tokenizerSha256?: string | null;
  activeRuntimeId?: string | null;
  lastInferenceEvidence?: {
    checkpointPath: string | null;
    checkpointSha256: string | null;
    tokenizerSha256: string | null;
    activeRuntimeId: string | null;
    inferenceTimestamp: string;
    executionDurationMs: number;
  } | null;
  totalParams?: number;
  modelName?: string | null;
  latencyMs?: number;
  lastCheckedAt?: string | null;
  lastOnlineAt?: string | null;
}

export type TruthOperationalState =
  | 'VERIFIED'
  | 'UNVERIFIED'
  | 'BLOCKED'
  | 'NOT_IMPLEMENTED'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE';

export type SubsystemImplementationState =
  | 'IMPLEMENTED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'UNVERIFIED'
  | 'NOT_IMPLEMENTED'
  | 'NOT_CONFIGURED';

export interface SoftwareCapabilityStatusEntry {
  id: string;
  name: string;
  status: SubsystemImplementationState;
  evidenceSource: string;
  lastVerifiedAt: string;
  detail: string;
  missingDependency?: string;
}

export interface ProjectExecutionEvidenceRecord {
  projectId: string;
  taskId: string;
  executionId: string;
  sourceRevision: string;
  operationType: string;
  startTimestamp: string;
  completionTimestamp: string;
  actualDurationMs: number;
  buildOrTestResult: string;
  artifactReference: string;
  evidenceHash: string;
  verificationStatus: 'VERIFIED' | 'BLOCKED' | 'FAILED' | 'UNVERIFIED';
  stdoutSnippet?: string;
  stderrSnippet?: string;
  exitCode?: number | null;
}

export interface SoftwareProjectRecord {
  projectId: string;
  tenantId: string;
  ownerUserId: string;
  name: string;
  slug: string;
  description: string;
  stack: 'node_fullstack' | 'node_api' | 'python_service' | 'static_web';
  attribution: string;
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
  revisions: Array<{
    revisionId: string;
    revisionNumber: number;
    createdAt: string;
    createdBy: string;
    message: string;
    treeSha256: string;
    files: Array<{ relativePath: string; bytes: number; sha256: string; snapshotId: string | null }>;
  }>;
  evidenceHistory: ProjectExecutionEvidenceRecord[];
  lastBuild: {
    status: 'VERIFIED' | 'FAILED' | 'UNVERIFIED';
    executedAt: string | null;
    durationMs: number;
    checkedFiles: number;
    summary: string;
    output: string;
  } | null;
  lastTests: {
    status: 'VERIFIED' | 'FAILED' | 'UNVERIFIED';
    executedAt: string | null;
    durationMs: number;
    passed: number;
    total: number;
    summary: string;
    output: string;
  } | null;
  lastSecurityScan: {
    status: 'VERIFIED' | 'BLOCKED' | 'UNVERIFIED';
    scannedAt: string | null;
    findings: Array<{ severity: 'HIGH' | 'MEDIUM' | 'LOW'; file: string; rule: string; detail: string }>;
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
    reason: string;
  };
  runtimeLogs: Array<{ timestamp: string; level: 'INFO' | 'WARN' | 'ERROR'; source: string; message: string }>;
}

export interface TruthDashboardSnapshot {
  generatedAt: string;
  policy: string;
  systemStatusOverview: Array<{
    id: string;
    label: string;
    state: TruthOperationalState;
    lastVerifiedAt: string;
    evidenceSource: string;
    failureReason: string | null;
  }>;
  nativeIntelligenceGates: Array<{
    id: string;
    order: number;
    name: string;
    state: TruthOperationalState;
    lastVerifiedAt: string | null;
    evidenceSource: string;
    reason: string;
  }>;
  activeBlockers: Array<{
    id: string;
    component: string;
    currentState: TruthOperationalState;
    reason: string;
    requiredDependency: string;
    verificationStatus: TruthOperationalState;
  }>;
  realRuntimeMetrics: Array<{
    id: string;
    label: string;
    value: number | string | null;
    unit: string;
    status: 'VERIFIED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
    source: string;
    collectedAt: string;
  }>;
  cognitiveSystems: Array<{
    id: string;
    name: string;
    status: SubsystemImplementationState;
    evidence: string;
    lastVerifiedAt: string;
  }>;
  executionAndAutonomy: {
    status: SubsystemImplementationState;
    taskSuccessRatePct: number | null;
    recoverySuccessRatePct: number | null;
    verificationSuccessRatePct: number | null;
    dataAvailability: 'VERIFIED' | 'NOT_ENOUGH_DATA';
    activeJobs: Array<{ jobId: string; goal: string; state: string; updatedAt: string }>;
    history: Array<{
      executionId: string;
      taskId: string;
      source: string;
      startTimestamp: string;
      completionTimestamp: string;
      actualDurationMs: number;
      executionResult: string;
      evidenceHash: string;
      verificationResult: TruthOperationalState;
    }>;
  };
  truthAndAudit: {
    totalRecords: number;
    chainValid: boolean;
    headHash: string;
    evidenceRecordsCount: number;
    rejectedEvidenceCount: number;
    classificationSummary: {
      totalClaims: number;
      verifiedFacts: number;
      inferred: number;
      unverified: number;
      blocked: number;
    };
    recentVerificationEvents: Array<{
      id: number;
      timestamp: string;
      eventType: string;
      actor: string;
      entryHash: string;
    }>;
  };
  multimodalCapabilities: Array<{
    id: string;
    label: string;
    status: 'PARTIAL' | 'NOT_IMPLEMENTED' | 'IMPLEMENTED';
    evidenceSource: string;
    notes: string;
  }>;
  onlineRuntimeConnectivity: {
    configured: boolean;
    connected: boolean;
    operational: boolean;
    lastSuccessfulOnlineVerification: string | null;
    items: Array<{
      id: string;
      label: string;
      configured: boolean;
      connected: boolean;
      operational: boolean;
      state: TruthOperationalState;
      detail: string;
    }>;
  };
  softwareEngineering: {
    checkedAt: string;
    capabilities: SoftwareCapabilityStatusEntry[];
    summary: {
      implemented: number;
      partial: number;
      blocked: number;
      notConfigured: number;
      notImplemented: number;
      total: number;
    };
    projectsCount: number;
    recentEvidence: ProjectExecutionEvidenceRecord[];
  };
}

export interface SystemStatusData {
  success: boolean;
  connectivity?: ConnectivityHealthState;
  model: {
    name: string;
    architecture: string;
    activeKey?: string;
    totalParams: number;
    trainedSubgraphParams?: number;
    targetParams?: number;
    memoryFootprintMb?: number;
    storageMode?: string;
    weightsSource?: string;
    checkpointPath?: string | null;
    checkpointHash: string;
    checkpointSha256?: string | null;
    tokenizerSha256?: string | null;
    activeRuntimeId?: string | null;
    lastInferenceEvidence?: ConnectivityHealthState['lastInferenceEvidence'];
    expectedCheckpointHash?: string | null;
    signatureMatchesExpected?: boolean;
    weightsLoaded: boolean;
    runtimeState?: RuntimeLifecycleState;
    executionVerified?: boolean;
    executionError?: string | null;
    trainedProvenance?: string | null;
    weightsRole?: string | null;
    evaluatedLoss?: number;
    evaluatedPerplexity?: number;
    promotedAt?: string | null;
    promotedBy?: string | null;
    runtimeBridgeSource?: string;
    status?: string;
    code?: string | null;
    onlineConnectivityRequired?: boolean;
    failClosedReason?: string | null;
    binaryReplacedOnDisk?: boolean;
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
    simulatedRevenueUsd: number; // Legacy field; now reflects recorded revenue only.
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
  truthDashboard?: TruthDashboardSnapshot;
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

export type ExecutionCycleStageId =
  | '01_INTAKE'
  | '02_ANALYZE'
  | '03_PLAN'
  | '04_BUILD'
  | '05_EXECUTE'
  | '06_TEST'
  | '07_REPAIR'
  | '08_DELIVER';

export interface ExecutionCycleStageRecord {
  stage: ExecutionCycleStageId;
  labelTh: string;
  labelEn: string;
  status: 'PENDING' | 'ACTIVE' | 'PASS' | 'REPAIRING' | 'BLOCKED';
  summary: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  passed: boolean;
  evidence: string;
}

export type TaskPriority = 'High' | 'Medium' | 'Low';

export type TaskLifecycleStatus =
  | 'Planned'
  | 'In Progress'
  | 'Executed'
  | 'Tested'
  | 'Verified'
  | 'Failed'
  | 'Blocked'
  | 'Delivered';

export interface PackageArtifactInfo {
  zipFilename: string;
  zipPath: string;
  zipSha256: string;
  zipBytes: number;
  integrityOk: boolean;
  files: Array<{ path: string; bytes: number; sha256: string }>;
  createdAt: string;
}

export interface PersistentTaskRecord {
  taskId: string;
  goal: string;
  priority: TaskPriority;
  runtime: 'node' | 'python3';
  lifecycleStatus: TaskLifecycleStatus;
  currentStage: ExecutionCycleStageId;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  attempts: number;
  artifacts: Array<{ path: string; bytes: number; runtime: 'node' | 'python3'; verified: boolean }>;
  packageArtifact?: PackageArtifactInfo | null;
  testsPassed: number;
  testsTotal: number;
  failureReason?: string | null;
  resumable: boolean;
}

export interface ExecutionCycleSummary {
  taskId: string;
  goal: string;
  priority?: TaskPriority;
  runtime: 'node' | 'python3';
  lifecycleStatus?: TaskLifecycleStatus;
  deliveryStatus: 'DELIVERED' | 'BLOCKED';
  stages: ExecutionCycleStageRecord[];
  acceptanceCriteria: AcceptanceCriterion[];
  artifacts: Array<{ path: string; bytes: number; runtime: 'node' | 'python3'; verified: boolean }>;
  packageArtifact?: PackageArtifactInfo | null;
  repairHistory: Array<{ attempt: number; failureReason: string; diagnosis: string; patchedBytes: number; resolved: boolean }>;
  limitations: string[];
  testsPassed: number;
  testsTotal: number;
  durationMs: number;
  completedAt: string;
  executionId?: string;
  startTimestamp?: string;
  finishTimestamp?: string;
  executionDurationMs?: number;
  executionResult?: 'DELIVERED' | 'BLOCKED';
  executionEvidenceHash?: string;
}

export interface ExecutionMetricsSummary {
  totalCycles: number;
  succeededCycles: number;
  blockedCycles: number;
  taskSuccessRatePct: number;
  artifactsCreated: number;
  testsPassedCount: number;
  testsTotalCount: number;
  selfRepairsAttempted: number;
  selfRepairsSucceeded: number;
  lastUpdatedAt: string | null;
  recentCycles: ExecutionCycleSummary[];
}

export interface OrchestrationEvent {
  type: 'init' | 'step' | 'chunk' | 'tool_call' | 'tool_result' | 'review' | 'test' | 'security_check' | 'done' | 'error';
  role?: 'PLANNER' | 'CODER' | 'REVIEWER' | 'TESTER' | 'SYSTEM' | 'GOVERNANCE';
  cycleStage?: ExecutionCycleStageId;
  priority?: TaskPriority;
  message: string;
  data?: any;
  timestamp: string;
}
