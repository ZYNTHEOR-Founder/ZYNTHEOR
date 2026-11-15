import React, { useEffect, useState } from 'react';
import {
  SystemStatusData,
  ModuleId,
  TruthOperationalState,
  SubsystemImplementationState,
} from '../../types';
import { VividCard } from '../ui/VividCard';
import { StatusDot } from '../ui/StatusBadge';
import { PageContainer, SectionHeader } from '../ui/LayoutPrimitives';
import { Eyebrow, Heading, Text } from '../ui/Typography';
import { ResourceMonitor } from '../ResourceMonitor';
import { ExpenseSummaryChart } from '../ExpenseSummaryChart';
import { useLanguage } from '../../context/LanguageContext';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Code2,
  Cpu,
  Database,
  DollarSign,
  Eye,
  Play,
  RotateCcw,
  ShieldCheck,
  Wifi,
  Workflow,
} from 'lucide-react';

interface CommandCenterProps {
  statusData: SystemStatusData | null;
  onNavigate: (module: ModuleId) => void;
  onOpenQuickTask: () => void;
}

const formatTimestamp = (iso: string | null | undefined, lang: 'th' | 'en') => {
  if (!iso) return 'UNAVAILABLE';
  try {
    return new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', {
      hour12: false,
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
};

const formatMetricValue = (
  value: number | string | null | undefined,
  unit: string,
  lang: 'th' | 'en'
) => {
  if (value === null || value === undefined || value === '') return 'UNAVAILABLE';
  if (typeof value === 'number') {
    const formatted = new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-US', {
      maximumFractionDigits: 2,
    }).format(value);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return unit ? `${value} ${unit}` : String(value);
};

const toStatusDotState = (
  state: TruthOperationalState | SubsystemImplementationState | 'NOT_ENOUGH_DATA' | string
) => {
  switch (state) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'IMPLEMENTED':
      return 'IMPLEMENTED';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'NOT_CONFIGURED':
      return 'NOT_CONFIGURED';
    case 'NOT_IMPLEMENTED':
      return 'NOT_IMPLEMENTED';
    case 'UNAVAILABLE':
      return 'UNAVAILABLE';
    case 'NOT_ENOUGH_DATA':
      return 'NOT_ENOUGH_DATA';
    case 'UNVERIFIED':
    default:
      return 'UNVERIFIED';
  }
};

interface SessionExpenditureBaseline {
  startedAt: string;
  nativeComputeCostUsd: number;
  cloudApiCostUsd: number;
  totalTokensProcessed: number;
  tasksCompleted: number;
  tasksFailed: number;
}

const SESSION_BASELINE_STORAGE_KEY = 'zyntheor_agent_session_cost_baseline';

const formatUsd = (value: number | null | undefined, lang: 'th' | 'en') => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'UNAVAILABLE';
  return new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
};

export const CommandCenter: React.FC<CommandCenterProps> = ({
  statusData,
  onNavigate,
  onOpenQuickTask,
}) => {
  const { lang } = useLanguage();
  const truth = statusData?.truthDashboard;
  const resources = statusData?.resources;
  const commercial = statusData?.commercial;

  const [sessionBaseline, setSessionBaseline] = useState<SessionExpenditureBaseline | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(SESSION_BASELINE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SessionExpenditureBaseline;
      if (
        typeof parsed.nativeComputeCostUsd === 'number' &&
        typeof parsed.cloudApiCostUsd === 'number' &&
        typeof parsed.totalTokensProcessed === 'number'
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!commercial) return;
    const currentSnapshot: SessionExpenditureBaseline = {
      startedAt: new Date().toISOString(),
      nativeComputeCostUsd: commercial.nativeComputeCostUsd ?? 0,
      cloudApiCostUsd: commercial.cloudApiCostUsd ?? 0,
      totalTokensProcessed: commercial.totalTokensProcessed ?? 0,
      tasksCompleted: commercial.tasksCompleted ?? 0,
      tasksFailed: commercial.tasksFailed ?? 0,
    };

    const needsReset =
      !sessionBaseline ||
      commercial.nativeComputeCostUsd < sessionBaseline.nativeComputeCostUsd ||
      commercial.cloudApiCostUsd < sessionBaseline.cloudApiCostUsd ||
      commercial.totalTokensProcessed < sessionBaseline.totalTokensProcessed;

    if (needsReset) {
      setSessionBaseline(currentSnapshot);
      try {
        window.sessionStorage.setItem(
          SESSION_BASELINE_STORAGE_KEY,
          JSON.stringify(currentSnapshot)
        );
      } catch {
        // ignore storage quota errors
      }
    }
  }, [
    commercial?.nativeComputeCostUsd,
    commercial?.cloudApiCostUsd,
    commercial?.totalTokensProcessed,
    commercial?.tasksCompleted,
    commercial?.tasksFailed,
  ]);

  const handleResetSessionBaseline = () => {
    if (!commercial) return;
    const fresh: SessionExpenditureBaseline = {
      startedAt: new Date().toISOString(),
      nativeComputeCostUsd: commercial.nativeComputeCostUsd ?? 0,
      cloudApiCostUsd: commercial.cloudApiCostUsd ?? 0,
      totalTokensProcessed: commercial.totalTokensProcessed ?? 0,
      tasksCompleted: commercial.tasksCompleted ?? 0,
      tasksFailed: commercial.tasksFailed ?? 0,
    };
    setSessionBaseline(fresh);
    try {
      window.sessionStorage.setItem(SESSION_BASELINE_STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore storage quota errors
    }
  };

  const hasCommercialTelemetry = Boolean(commercial);
  const cumulativeNativeUsd = commercial ? commercial.nativeComputeCostUsd : null;
  const cumulativeCloudUsd = commercial ? commercial.cloudApiCostUsd : null;
  const cumulativeTotalUsd =
    cumulativeNativeUsd !== null && cumulativeCloudUsd !== null
      ? cumulativeNativeUsd + cumulativeCloudUsd
      : null;

  const sessionNativeUsd =
    commercial && sessionBaseline
      ? Math.max(0, commercial.nativeComputeCostUsd - sessionBaseline.nativeComputeCostUsd)
      : null;
  const sessionCloudUsd =
    commercial && sessionBaseline
      ? Math.max(0, commercial.cloudApiCostUsd - sessionBaseline.cloudApiCostUsd)
      : null;
  const sessionTotalUsd =
    sessionNativeUsd !== null && sessionCloudUsd !== null
      ? sessionNativeUsd + sessionCloudUsd
      : null;
  const sessionTokens =
    commercial && sessionBaseline
      ? Math.max(0, commercial.totalTokensProcessed - sessionBaseline.totalTokensProcessed)
      : null;
  const sessionTasks =
    commercial && sessionBaseline
      ? Math.max(
          0,
          commercial.tasksCompleted +
            commercial.tasksFailed -
            (sessionBaseline.tasksCompleted + sessionBaseline.tasksFailed)
        )
      : null;

  const systemOverview = truth?.systemStatusOverview ?? [];
  const blockers = truth?.activeBlockers ?? [];
  const intelligenceGates = truth?.nativeIntelligenceGates ?? [];
  const runtimeMetrics = truth?.realRuntimeMetrics ?? [];
  const cognitiveSystems = truth?.cognitiveSystems ?? [];
  const executionAndAutonomy = truth?.executionAndAutonomy;
  const multimodal = truth?.multimodalCapabilities ?? [];
  const connectivity = truth?.onlineRuntimeConnectivity;
  const swEng = truth?.softwareEngineering;
  const truthAndAudit = truth?.truthAndAudit;

  const cloudOperational = Boolean(connectivity?.operational);
  const overallGateState = cloudOperational
    ? 'VERIFIED'
    : blockers.some((b) => b.currentState === 'BLOCKED')
      ? 'BLOCKED'
      : 'NOT_CONFIGURED';

  return (
    <PageContainer className="command-center space-y-6">
      {/* Compact Truth-First Header Ribbon */}
      <div className="rounded-2xl border border-[#1E294A] bg-[#0D1326] px-5 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow color={cloudOperational ? 'cyan' : 'coral'}>
              {lang === 'th'
                ? 'ZYNTHEOR · แผงควบคุมออนไลน์เน้นหลักฐานจริง'
                : 'ZYNTHEOR · TRUTH-FIRST ONLINE OPERATIONS DASHBOARD'}
            </Eyebrow>
            <StatusDot
              status={toStatusDotState(overallGateState)}
              label={`ONLINE RUNTIME: ${overallGateState}`}
            />
          </div>
          <Heading as="h2" scale="h2" className="text-white">
            {lang === 'th'
              ? 'สถานะระบบจริง หลักฐานการทำงาน และเกตความพร้อมแบบ Online-Only'
              : 'Evidence-Gated System Visibility & Online Cloud Operations'}
          </Heading>
          <Text size="xs" tone="secondary">
            {lang === 'th'
              ? 'Evidence > Claim · Runtime > Configuration · ไม่มีการจำลองค่าหรือ Fallback แบบออฟไลน์'
              : 'Evidence > Claim · Runtime > Configuration · Zero Simulation · Strictly Online-Only Cloud Runtime'}
          </Text>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('dev_studio')}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold text-[#070B19] bg-[#00F0FF] hover:bg-[#33F3FF] transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Code2 className="w-4 h-4" />
            <span>{lang === 'th' ? 'เปิด Creation Studio' : 'Open Creation Studio'}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('autonomous_execution')}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-[#F4F7FF] bg-[#131B36] border border-[#1E294A] hover:border-[#00F0FF]/50 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Workflow className="w-4 h-4 text-[#00F0FF]" />
            <span>{lang === 'th' ? 'Autonomous Execution' : 'Autonomous Execution'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenQuickTask}
            className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold text-[#F4F7FF] bg-[#131B36] border border-[#1E294A] hover:border-[#CCFF00]/50 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 text-[#CCFF00]" />
            <span>{lang === 'th' ? 'ส่งโจทย์ด่วน' : 'Quick Objective'}</span>
          </button>
        </div>
      </div>

      {/* SECTION 1 — SYSTEM STATUS OVERVIEW (TOP) */}
      <section aria-label="Section 1: System Status Overview" className="space-y-3">
        <SectionHeader
          title={lang === 'th' ? '1. ภาพรวมสถานะระบบ (System Status Overview)' : '1. System Status Overview'}
          subtitle={
            truth?.generatedAt
              ? `Measured snapshot · ${formatTimestamp(truth.generatedAt, lang)}`
              : 'Awaiting live /api/system/status snapshot...'
          }
        />
        <VividCard gradientAccent="cyan" className="!p-0 overflow-hidden">
          {systemOverview.length === 0 ? (
            <div className="p-6 text-center text-xs font-mono text-[#9AA8C7]">
              UNAVAILABLE · Loading system status telemetry from runtime...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 divide-y md:divide-y-0 md:gap-px bg-[#1E294A]">
              {systemOverview.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#0D1326] p-4 flex flex-col justify-between gap-2 min-w-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs font-semibold text-[#F4F7FF] leading-snug">
                      {item.label}
                    </span>
                    <StatusDot status={toStatusDotState(item.state)} label={item.state} />
                  </div>
                  <div className="text-[11px] font-mono text-[#9AA8C7] space-y-1 tabular-nums">
                    <div className="truncate" title={item.evidenceSource}>
                      Source: <span className="text-[#CBD5E1]">{item.evidenceSource}</span>
                    </div>
                    <div>
                      Verified: <span className="text-[#CBD5E1]">{formatTimestamp(item.lastVerifiedAt, lang)}</span>
                    </div>
                    {item.failureReason && (
                      <div className="text-[#FF8C73] break-words">
                        Reason: {item.failureReason}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </VividCard>
      </section>

      {/* SECTION 3 — ACTIVE BLOCKERS (NEAR TOP) */}
      <section aria-label="Section 3: Active Blockers" className="space-y-3">
        <SectionHeader
          title={lang === 'th' ? '3. อุปสรรคและจุดติดขัดที่ทำงานอยู่ (Active Blockers)' : '3. Active Blockers'}
          subtitle="Direct runtime and configuration inspection — never hidden or bypassed"
        />
        <VividCard gradientAccent={blockers.length > 0 ? 'coral' : 'emerald'} className="!p-0 overflow-hidden">
          {blockers.length === 0 ? (
            <div className="px-5 py-4 flex items-center justify-between text-xs font-mono text-[#CCFF00]">
              <span>No active system blockers reported by current runtime inspection.</span>
              <StatusDot status="VERIFIED" label="VERIFIED" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0B1124] border-b border-[#1E294A] text-[11px] text-[#9AA8C7]">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Component</th>
                    <th className="py-2.5 px-4 font-semibold">Current State</th>
                    <th className="py-2.5 px-4 font-semibold">Reason</th>
                    <th className="py-2.5 px-4 font-semibold">Required Dependency</th>
                    <th className="py-2.5 px-4 font-semibold">Verification Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E294A] bg-[#0D1326]">
                  {blockers.map((b) => (
                    <tr key={b.id}>
                      <td className="py-3 px-4 font-semibold text-[#F4F7FF] whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-[#FF5E3A] shrink-0" />
                          {b.component}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusDot status={toStatusDotState(b.currentState)} label={b.currentState} />
                      </td>
                      <td className="py-3 px-4 text-[#CBD5E1] min-w-[220px]">{b.reason}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-[#00F0FF] min-w-[200px]">
                        {b.requiredDependency}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusDot
                          status={toStatusDotState(b.verificationStatus)}
                          label={b.verificationStatus}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </VividCard>
      </section>

      {/* SECTION 2 — NATIVE INTELLIGENCE GATES (7 STAGES) */}
      <section aria-label="Section 2: Native Intelligence Gates" className="space-y-3">
        <SectionHeader
          title={lang === 'th' ? '2. เกตยืนยันความพร้อม Native Intelligence (7 ขั้นตอน)' : '2. Native Intelligence Gates'}
          subtitle="Truthful 7-stage pipeline — stages never advance without verified runtime/evaluation evidence"
        />
        <VividCard gradientAccent="purple" className="!p-4">
          <div className="divide-y divide-[#1E294A]">
            {intelligenceGates.map((gate) => (
              <div
                key={gate.id}
                className="py-3 first:pt-0 last:pb-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="font-mono text-xs font-bold text-[#00F0FF] shrink-0 mt-0.5 tabular-nums">
                    0{gate.order}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-xs font-bold text-[#F4F7FF]">{gate.name}</span>
                      <StatusDot status={toStatusDotState(gate.state)} label={gate.state} />
                    </div>
                    <p className="text-[11px] text-[#9AA8C7] mt-1">{gate.reason}</p>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-[#9AA8C7] lg:text-right shrink-0 tabular-nums">
                  <div>Source: {gate.evidenceSource}</div>
                  <div>
                    {gate.lastVerifiedAt
                      ? `Verified: ${formatTimestamp(gate.lastVerifiedAt, lang)}`
                      : 'Verified: UNAVAILABLE'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </VividCard>
      </section>

      {/* SECTION 4 — REAL RUNTIME METRICS & HOST RESOURCE CHART */}
      <section aria-label="Section 4: Real Runtime Metrics" className="space-y-3">
        <SectionHeader
          title={lang === 'th' ? '4. ตัวชี้วัดจาก Runtime จริง (Real Runtime Metrics)' : '4. Real Runtime Metrics'}
          subtitle="Zero synthetic telemetry — missing probes report UNAVAILABLE or NOT_CONFIGURED"
        />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
          <VividCard gradientAccent="cyan" className="xl:col-span-2 !p-0 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[#1E294A]">
              {runtimeMetrics.map((m) => (
                <div key={m.id} className="bg-[#0D1326] p-4 flex flex-col justify-between gap-2 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA8C7] truncate">
                      {m.label}
                    </span>
                    <StatusDot status={toStatusDotState(m.status)} dotOnly label={m.status} />
                  </div>
                  <div className="text-base font-bold font-mono tabular-nums text-[#F4F7FF] truncate">
                    {formatMetricValue(m.value, m.unit, lang)}
                  </div>
                  <div className="text-[10px] font-mono text-[#9AA8C7] space-y-0.5 tabular-nums">
                    <div className="truncate" title={m.source}>{m.source}</div>
                    <div>{formatTimestamp(m.collectedAt, lang)}</div>
                  </div>
                </div>
              ))}
            </div>
          </VividCard>

          <VividCard
            title={lang === 'th' ? 'ทรัพยากร OS / Process จริง' : 'OS & Process Resources'}
            subtitle="Live sampled telemetry"
            gradientAccent="blue"
          >
            {resources ? (
              <ResourceMonitor history={resources.history} current={resources.current} />
            ) : (
              <div className="py-10 text-center text-xs font-mono text-[#9AA8C7]">
                UNAVAILABLE · Waiting for OS sample
              </div>
            )}
          </VividCard>
        </div>
      </section>

      {/* SECTION 5 (COGNITIVE) & SECTION 8 (MULTIMODAL) SIDE BY SIDE */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* SECTION 5 — COGNITIVE SYSTEMS */}
        <section aria-label="Section 5: Cognitive Systems" className="space-y-3">
          <SectionHeader
            title={lang === 'th' ? '5. ระบบพุทธิปัญญา (Cognitive Systems)' : '5. Cognitive Systems'}
            subtitle="Verified module inventory & evidence status"
          />
          <VividCard gradientAccent="blue" className="!p-4">
            <div className="divide-y divide-[#1E294A]">
              {cognitiveSystems.map((sys) => (
                <div key={sys.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#F4F7FF] flex items-center gap-2">
                      <BrainCircuit className="w-3.5 h-3.5 text-[#00F0FF] shrink-0" />
                      {sys.name}
                    </span>
                    <StatusDot status={toStatusDotState(sys.status)} label={sys.status} />
                  </div>
                  <p className="text-[11px] font-mono text-[#9AA8C7]">{sys.evidence}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-[#1E294A] flex justify-end">
              <button
                type="button"
                onClick={() => onNavigate('cognitive_operations')}
                className="text-xs font-semibold text-[#00F0FF] hover:brightness-110 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Open Cognitive Operations</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </VividCard>
        </section>

        {/* SECTION 8 — MULTIMODAL CAPABILITY STATUS */}
        <section aria-label="Section 8: Multimodal Capability Status" className="space-y-3">
          <SectionHeader
            title={lang === 'th' ? '8. สถานะความสามารถ Multimodal' : '8. Multimodal Capability Status'}
            subtitle="Strict distinction between partial document parsing and unimplemented media pipelines"
          />
          <VividCard gradientAccent="magenta" className="!p-4">
            <div className="divide-y divide-[#1E294A]">
              {multimodal.map((cap) => (
                <div key={cap.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#F4F7FF] flex items-center gap-2">
                      <Eye className="w-3.5 h-3.5 text-[#C084FC] shrink-0" />
                      {cap.label}
                    </span>
                    <StatusDot status={toStatusDotState(cap.status)} label={cap.status} />
                  </div>
                  <div className="text-[11px] text-[#9AA8C7]">
                    {cap.notes} <span className="font-mono text-[#64748B]">({cap.evidenceSource})</span>
                  </div>
                </div>
              ))}
            </div>
          </VividCard>
        </section>
      </div>

      {/* SECTION 6 — EXECUTION & AUTONOMY */}
      <section aria-label="Section 6: Execution and Autonomy" className="space-y-3">
        <SectionHeader
          title={lang === 'th' ? '6. การดำเนินการอัตโนมัติและประวัติที่มีหลักฐาน (Execution & Autonomy)' : '6. Execution & Autonomy'}
          subtitle="Verified outcomes only — reports NOT_ENOUGH_DATA when zero real executions exist"
        />
        <VividCard gradientAccent="lime" className="!p-4 space-y-4">
          {/* Current Agent Execution Session Expenditure Tracker */}
          <div
            aria-label="Current Agent Execution Session Expenditure"
            className="rounded-xl bg-[#070B19] border border-[#1E294A] p-4 space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#1E294A]">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-[#F4F7FF] inline-flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-[#CCFF00] shrink-0" />
                    <span>
                      {lang === 'th'
                        ? 'ค่าใช้จ่ายการประมวลผลเอเจนต์ในเซสชันปัจจุบัน (Session Expenditure)'
                        : 'Agent Execution Session Expenditure'}
                    </span>
                  </span>
                  <StatusDot
                    status={hasCommercialTelemetry ? 'VERIFIED' : 'UNAVAILABLE'}
                    label={hasCommercialTelemetry ? 'TELEMETRY_ACTIVE' : 'UNAVAILABLE'}
                  />
                </div>
                <div className="text-[11px] font-mono text-[#9AA8C7] tabular-nums">
                  {hasCommercialTelemetry
                    ? `Source: statusData.commercial · Tenant: ${commercial?.activeTenantId} · Plan: ${commercial?.activePlanId} · Session start: ${formatTimestamp(sessionBaseline?.startedAt, lang)}`
                    : 'UNAVAILABLE · Awaiting statusData.commercial cost telemetry from runtime'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {hasCommercialTelemetry && (
                  <button
                    type="button"
                    onClick={handleResetSessionBaseline}
                    className="px-2.5 py-1.5 rounded-lg bg-[#131B36] border border-[#1E294A] hover:border-[#00F0FF]/50 text-[#CBD5E1] text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                    title="Reset current session expenditure baseline to zero"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Session</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate('analytics_bi')}
                  className="px-2.5 py-1.5 rounded-lg bg-[#131B36] border border-[#1E294A] hover:border-[#CCFF00]/50 text-[#CCFF00] text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <span>Expense Ledger</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono tabular-nums">
              <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Session Total Spend</div>
                <div className="text-base font-bold text-[#CCFF00] mt-1">
                  {formatUsd(sessionTotalUsd, lang)}
                </div>
                <div className="text-[10px] text-[#64748B] mt-0.5">
                  Cumulative: {formatUsd(cumulativeTotalUsd, lang)}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Native Compute (Session)</div>
                <div className="text-base font-bold text-[#00F0FF] mt-1">
                  {formatUsd(sessionNativeUsd, lang)}
                </div>
                <div className="text-[10px] text-[#64748B] mt-0.5">
                  Total: {formatUsd(cumulativeNativeUsd, lang)}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Cloud API Spend (Session)</div>
                <div className="text-base font-bold text-[#F4F7FF] mt-1">
                  {formatUsd(sessionCloudUsd, lang)}
                </div>
                <div className="text-[10px] text-[#64748B] mt-0.5">
                  Total: {formatUsd(cumulativeCloudUsd, lang)}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Session Tokens</div>
                <div className="text-base font-bold text-[#F4F7FF] mt-1">
                  {sessionTokens !== null
                    ? new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-US').format(sessionTokens)
                    : 'UNAVAILABLE'}
                </div>
                <div className="text-[10px] text-[#64748B] mt-0.5">
                  Total:{' '}
                  {hasCommercialTelemetry
                    ? new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-US').format(
                        commercial?.totalTokensProcessed ?? 0
                      )
                    : 'UNAVAILABLE'}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#0B1124] border border-[#1E294A]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Session Tasks</div>
                <div className="text-base font-bold text-[#F4F7FF] mt-1">
                  {sessionTasks !== null ? sessionTasks : 'UNAVAILABLE'}
                </div>
                <div className="text-[10px] text-[#64748B] mt-0.5">
                  {hasCommercialTelemetry
                    ? `${commercial?.tasksCompleted ?? 0} ok / ${commercial?.tasksFailed ?? 0} failed`
                    : 'UNAVAILABLE'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono tabular-nums">
            <div className="p-3 rounded-xl bg-[#070B19]">
              <div className="text-[10px] uppercase text-[#9AA8C7]">Task Success Rate</div>
              <div className="text-base font-bold text-[#F4F7FF] mt-1">
                {typeof executionAndAutonomy?.taskSuccessRatePct === 'number'
                  ? `${executionAndAutonomy.taskSuccessRatePct.toFixed(1)}%`
                  : 'NOT_ENOUGH_DATA'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#070B19]">
              <div className="text-[10px] uppercase text-[#9AA8C7]">Recovery Rate</div>
              <div className="text-base font-bold text-[#F4F7FF] mt-1">
                {typeof executionAndAutonomy?.recoverySuccessRatePct === 'number'
                  ? `${executionAndAutonomy.recoverySuccessRatePct.toFixed(1)}%`
                  : 'NOT_ENOUGH_DATA'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#070B19]">
              <div className="text-[10px] uppercase text-[#9AA8C7]">Verification Rate</div>
              <div className="text-base font-bold text-[#F4F7FF] mt-1">
                {typeof executionAndAutonomy?.verificationSuccessRatePct === 'number'
                  ? `${executionAndAutonomy.verificationSuccessRatePct.toFixed(1)}%`
                  : 'NOT_ENOUGH_DATA'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#070B19]">
              <div className="text-[10px] uppercase text-[#9AA8C7]">Active Jobs</div>
              <div className="text-base font-bold text-[#00F0FF] mt-1">
                {executionAndAutonomy ? executionAndAutonomy.activeJobs.length : 0}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            {executionAndAutonomy && executionAndAutonomy.history.length > 0 ? (
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#0B1124] border-b border-[#1E294A] text-[11px] text-[#9AA8C7]">
                  <tr>
                    <th className="py-2 px-3 font-sans font-semibold">Execution ID</th>
                    <th className="py-2 px-3 font-sans font-semibold">Start</th>
                    <th className="py-2 px-3 font-sans font-semibold">Completion</th>
                    <th className="py-2 px-3 font-sans font-semibold">Duration</th>
                    <th className="py-2 px-3 font-sans font-semibold">Result</th>
                    <th className="py-2 px-3 font-sans font-semibold">Evidence Hash</th>
                    <th className="py-2 px-3 font-sans font-semibold">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E294A]">
                  {executionAndAutonomy.history.slice(0, 8).map((row) => (
                    <tr key={row.executionId}>
                      <td className="py-2 px-3 text-[#00F0FF]">{row.executionId}</td>
                      <td className="py-2 px-3 text-[#9AA8C7]">{formatTimestamp(row.startTimestamp, lang)}</td>
                      <td className="py-2 px-3 text-[#9AA8C7]">{formatTimestamp(row.completionTimestamp, lang)}</td>
                      <td className="py-2 px-3 text-[#F4F7FF]">{row.actualDurationMs} ms</td>
                      <td className="py-2 px-3 text-[#CBD5E1]">{row.executionResult}</td>
                      <td className="py-2 px-3 text-[#9AA8C7]" title={row.evidenceHash}>
                        {row.evidenceHash ? `${row.evidenceHash.slice(0, 14)}…` : 'UNAVAILABLE'}
                      </td>
                      <td className="py-2 px-3">
                        <StatusDot
                          status={toStatusDotState(row.verificationResult)}
                          label={row.verificationResult}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-4 text-center text-xs font-mono text-[#9AA8C7]">
                NOT_ENOUGH_DATA · No verified autonomous executions recorded in this ledger yet.
              </div>
            )}
          </div>
        </VividCard>
      </section>

      {/* SECTION 9 — ONLINE RUNTIME & CONNECTIVITY */}
      <section aria-label="Section 9: Online Runtime and Connectivity" className="space-y-3">
        <SectionHeader
          title={lang === 'th' ? '9. ความพร้อมออนไลน์และการเชื่อมต่อ (Online Runtime & Connectivity)' : '9. Online Runtime & Connectivity'}
          subtitle="Explicit separation between Configured, Connected, and Operational states"
        />
        <VividCard gradientAccent="cyan" className="!p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1E294A]">
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <span className="inline-flex items-center gap-1.5 text-[#CBD5E1]">
                <Wifi className="w-4 h-4 text-[#00F0FF]" />
                Configured: <strong className="text-white">{String(Boolean(connectivity?.configured))}</strong>
              </span>
              <span className="text-[#CBD5E1]">
                Connected: <strong className="text-white">{String(Boolean(connectivity?.connected))}</strong>
              </span>
              <span className="text-[#CBD5E1]">
                Operational: <strong className={cloudOperational ? 'text-[#CCFF00]' : 'text-[#FF8C73]'}>{String(cloudOperational)}</strong>
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#9AA8C7] tabular-nums">
              Last Online Verification: {formatTimestamp(connectivity?.lastSuccessfulOnlineVerification, lang)}
            </div>
          </div>

          <div className="divide-y divide-[#1E294A]">
            {(connectivity?.items ?? []).map((item) => (
              <div
                key={item.id}
                className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#F4F7FF]">{item.label}</div>
                  <div className="text-[11px] font-mono text-[#9AA8C7] break-words">{item.detail}</div>
                </div>
                <div className="flex items-center gap-4 font-mono text-[11px] shrink-0">
                  <span className="text-[#9AA8C7]">
                    cfg:{item.configured ? '1' : '0'} · conn:{item.connected ? '1' : '0'} · op:{item.operational ? '1' : '0'}
                  </span>
                  <StatusDot status={toStatusDotState(item.state)} label={item.state} />
                </div>
              </div>
            ))}
          </div>
        </VividCard>
      </section>

      {/* SECTION 10 — NATIVE APP CREATION & SOFTWARE ENGINEERING */}
      <section aria-label="Section 10: Native App Creation and Software Engineering" className="space-y-3">
        <SectionHeader
          title={lang === 'th' ? '10. การสร้างแอปพลิเคชันและวิศวกรรมซอฟต์แวร์ (Section 10)' : '10. Native App Creation & Software Engineering'}
          subtitle="Full-stack cloud sandbox lifecycle backed by Planner, Coder, Reviewer, Tester & ApprovalGate"
          action={
            <button
              type="button"
              onClick={() => onNavigate('dev_studio')}
              className="text-xs font-semibold text-[#00F0FF] hover:brightness-110 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Open Software Project Workspace</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          }
        />
        <VividCard gradientAccent="emerald" className="!p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono pb-3 border-b border-[#1E294A]">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-[#00F0FF]">
                Implemented: <strong>{swEng?.summary.implemented ?? 0}</strong>
              </span>
              <span className="text-[#FF8C73]">
                Partial: <strong>{swEng?.summary.partial ?? 0}</strong>
              </span>
              <span className="text-[#9AA8C7]">
                Not Configured: <strong>{swEng?.summary.notConfigured ?? 0}</strong>
              </span>
              <span className="text-[#FF66B2]">
                Blocked: <strong>{swEng?.summary.blocked ?? 0}</strong>
              </span>
            </div>
            <div className="text-[#CBD5E1]">
              Projects in Cloud Sandbox: <strong>{swEng?.projectsCount ?? 0}</strong>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 divide-y divide-[#1E294A] md:divide-y-0">
            {(swEng?.capabilities ?? []).map((cap) => (
              <div key={cap.id} className="py-2.5 border-b border-[#1E294A]/70 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#F4F7FF] truncate" title={cap.name}>
                    {cap.name}
                  </span>
                  <StatusDot status={toStatusDotState(cap.status)} label={cap.status} />
                </div>
                <p className="text-[11px] text-[#9AA8C7] line-clamp-2" title={cap.detail}>
                  {cap.detail}
                </p>
              </div>
            ))}
          </div>

          {swEng && swEng.recentEvidence.length > 0 && (
            <div className="pt-2 border-t border-[#1E294A]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#9AA8C7] mb-2">
                Recent Software Execution Evidence
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] font-mono tabular-nums">
                  <thead className="text-[#9AA8C7] border-b border-[#1E294A]">
                    <tr>
                      <th className="py-1.5 px-2">Project / Op</th>
                      <th className="py-1.5 px-2">Duration</th>
                      <th className="py-1.5 px-2">Result</th>
                      <th className="py-1.5 px-2">SHA-256 Digest</th>
                      <th className="py-1.5 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E294A]">
                    {swEng.recentEvidence.slice(0, 5).map((ev) => (
                      <tr key={ev.executionId}>
                        <td className="py-1.5 px-2 text-[#00F0FF]">{ev.projectId} · {ev.operationType}</td>
                        <td className="py-1.5 px-2 text-[#CBD5E1]">{ev.actualDurationMs} ms</td>
                        <td className="py-1.5 px-2 text-[#CBD5E1] truncate max-w-[260px]">{ev.buildOrTestResult}</td>
                        <td className="py-1.5 px-2 text-[#9AA8C7]">{ev.evidenceHash.slice(0, 14)}…</td>
                        <td className="py-1.5 px-2">
                          <StatusDot status={toStatusDotState(ev.verificationStatus)} label={ev.verificationStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </VividCard>
      </section>

      {/* SECTION 7 — TRUTH & AUDIT (LOWER / SECONDARY) */}
      <section aria-label="Section 7: Truth and Audit" className="space-y-3">
        <SectionHeader
          title={lang === 'th' ? '7. ระบบความจริงและห่วงโซ่การตรวจสอบ (Truth & Audit — Secondary)' : '7. Truth & Audit (Secondary Integrity Layer)'}
          subtitle="Cryptographic SHA-256 chain verification & Truth Kernel evidence counts"
          action={
            <button
              type="button"
              onClick={() => onNavigate('governance_security')}
              className="text-xs font-semibold text-[#00F0FF] hover:brightness-110 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Governance &amp; Audit</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          }
        />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <VividCard gradientAccent="purple" className="xl:col-span-2 !p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
              <div className="p-3 rounded-xl bg-[#070B19]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Audit Records</div>
                <div className="text-base font-bold text-[#F4F7FF] mt-1">
                  {truthAndAudit?.totalRecords ?? 0}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#070B19]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Hash Chain</div>
                <div className="mt-1">
                  <StatusDot
                    status={truthAndAudit?.chainValid ? 'VERIFIED' : 'BLOCKED'}
                    label={truthAndAudit?.chainValid ? 'VERIFIED' : 'BLOCKED'}
                  />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#070B19]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Evidence Ledger</div>
                <div className="text-base font-bold text-[#CCFF00] mt-1">
                  {truthAndAudit?.evidenceRecordsCount ?? 0} verified
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#070B19]">
                <div className="text-[10px] uppercase text-[#9AA8C7]">Head Digest</div>
                <div className="text-xs font-bold text-[#00F0FF] mt-1.5 truncate" title={truthAndAudit?.headHash}>
                  {truthAndAudit?.headHash ? `${truthAndAudit.headHash.slice(0, 14)}…` : 'UNAVAILABLE'}
                </div>
              </div>
            </div>

            {truthAndAudit && (
              <div className="text-[11px] font-mono text-[#9AA8C7] flex flex-wrap items-center gap-4 px-1">
                <span>Truth Claims: <strong className="text-white">{truthAndAudit.classificationSummary.totalClaims}</strong></span>
                <span>Verified Facts: <strong className="text-[#CCFF00]">{truthAndAudit.classificationSummary.verifiedFacts}</strong></span>
                <span>Inferred: <strong className="text-[#00F0FF]">{truthAndAudit.classificationSummary.inferred}</strong></span>
                <span>Unverified: <strong className="text-[#FBBF24]">{truthAndAudit.classificationSummary.unverified}</strong></span>
                <span>Blocked: <strong className="text-[#FF66B2]">{truthAndAudit.classificationSummary.blocked}</strong></span>
              </div>
            )}

            <div className="divide-y divide-[#1E294A] text-[11px] font-mono">
              {(truthAndAudit?.recentVerificationEvents ?? []).slice(0, 6).map((ev) => (
                <div key={ev.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[#F4F7FF]">
                    <span className="text-[#00F0FF]">#{ev.id}</span> · {ev.eventType} ({ev.actor})
                  </span>
                  <span className="text-[#9AA8C7] tabular-nums">
                    {formatTimestamp(ev.timestamp, lang)} · {ev.entryHash.slice(0, 12)}…
                  </span>
                </div>
              ))}
            </div>
          </VividCard>

          <div className="space-y-4">
            <ExpenseSummaryChart />
          </div>
        </div>
      </section>
    </PageContainer>
  );
};

export default CommandCenter;
