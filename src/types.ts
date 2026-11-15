/**
 * ZYNTHEOR VIVID ECOSYSTEM - TYPE DEFINITIONS
 */

export type ModuleId =
  | 'command_center'
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

export type StatusLevel = 'IMPLEMENTED' | 'VERIFIED' | 'PARTIAL' | 'BLOCKED' | 'NOT IMPLEMENTED';

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

export interface SystemStatusData {
  success: boolean;
  model: {
    name: string;
    architecture: string;
    totalParams: number;
    checkpointHash: string;
    weightsLoaded: boolean;
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
