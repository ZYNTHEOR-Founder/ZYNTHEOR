import React from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { StatusDot } from '../ui/StatusBadge';
import { ModuleId, SystemStatusData } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Activity, ArrowRight, Database, DollarSign, Gauge, LayoutDashboard, ShieldCheck } from 'lucide-react';

interface AnalyticsBIProps {
  statusData: SystemStatusData | null;
  onNavigate?: (module: ModuleId) => void;
}

const showCount = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

export const AnalyticsBI: React.FC<AnalyticsBIProps> = ({ statusData, onNavigate }) => {
  const { lang } = useLanguage();
  const { role } = useAuth();
  const isPrivileged = role === 'Developer' || role === 'Administrator';
  const th = lang === 'th';

  const comm = statusData?.commercial;
  const audit = statusData?.audit;
  const resources = statusData?.resources?.current;
  const completed = comm?.tasksCompleted ?? 0;
  const failed = comm?.tasksFailed ?? 0;
  const measuredTotal = completed + failed;
  const tokensProcessed = comm?.totalTokensProcessed ?? 0;
  const hasMeasuredActivity = measuredTotal > 0 || tokensProcessed > 0;
  const isAnalyticsConnected = Boolean(
    hasMeasuredActivity &&
      audit?.chainValid === true &&
      typeof comm?.simulatedRevenueUsd === 'number' &&
      comm.simulatedRevenueUsd > 0
  );
  const measuredRate = measuredTotal > 0 ? `${((completed / measuredTotal) * 100).toFixed(1)}%` : '0.0%';
  const failureRate = measuredTotal > 0 ? `${((failed / measuredTotal) * 100).toFixed(1)}%` : '0.0%';

  if (!hasMeasuredActivity) {
    return (
      <div className="space-y-6">
        <VividCard
          title={th ? 'เริ่มต้นสั่งงานแรกของคุณ' : 'Start your first task'}
          subtitle={
            th
              ? 'การ์ด Revenue และตัวชี้วัดที่ยังไม่เชื่อมต่อ Analytics ถูกซ่อนไว้ สถิติจริงจะแสดงที่นี่ทันทีหลังสั่งงานแรกเสร็จสมบูรณ์'
              : 'The Revenue card stays hidden until Analytics is connected. Live telemetry appears here once your first task runs.'
          }
          gradientAccent="cyan"
        >
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-5">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] flex items-center justify-center shrink-0">
                  <LayoutDashboard className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-bold text-[var(--app-text-primary)]">
                    {th ? 'เริ่มต้นสั่งงานแรกใน Command Center' : 'Start your first task in Command Center'}
                  </div>
                  <p className="text-xs text-[var(--app-text-secondary)] max-w-xl leading-relaxed">
                    {th
                      ? 'ระบบจะบันทึกผลการทำงานจริง ระยะเวลา และลายเซ็นตรวจสอบ SHA-256 ลงในบัญชีหลักฐาน โดยไม่แสดงตัวเลขจำลองหรือการ์ดรายได้ที่ไม่เชื่อมต่อ'
                      : 'Results, latency, and SHA-256 audit proofs are recorded automatically without simulated counters or unintegrated Revenue cards.'}
                  </p>
                </div>
              </div>

              {onNavigate && (
                <button
                  type="button"
                  data-testid="analytics-empty-command-center-btn"
                  onClick={() => onNavigate('command_center')}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--app-accent)] text-slate-950 text-xs font-bold hover:opacity-95 transition-opacity cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>{th ? 'ไปที่ Command Center' : 'Go to Command Center'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--app-card-border)] bg-[var(--app-surface)] px-4 py-3 text-xs">
              <div className="flex items-center gap-2.5 text-[var(--app-text-secondary)]">
                <ShieldCheck className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
                <span>
                  {th ? 'การตรวจสอบ Audit Chain' : 'Audit chain integrity'}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <StatusDot
                  status={audit?.chainValid === true ? 'VERIFIED' : audit?.chainValid === false ? 'BLOCKED' : 'UNVERIFIED'}
                  label={audit ? `${audit.totalRecords} entries` : 'UNVERIFIED'}
                />
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('proof_of_intelligence')}
                    className="vivid-inline-link text-xs"
                  >
                    <span>{th ? 'ดูหลักฐานและผลทดสอบ' : 'View Proofs'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </VividCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Conditionally render Revenue card only when Analytics & billing telemetry are fully connected */}
      <div className={`grid grid-cols-1 gap-4 ${isAnalyticsConnected ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <MetricCard
          title={th ? 'จำนวนงานที่บันทึกผลแล้ว' : 'Recorded task executions'}
          value={showCount(comm?.tasksCompleted)}
          subtitle={th ? 'นับจากตัวนับการทำงานจริง' : 'Persisted completion counter'}
          icon={<Activity className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title={th ? 'อัตราความสำเร็จที่วัดได้' : 'Measured success rate'}
          value={measuredRate}
          subtitle={`${showCount(measuredTotal)} ${th ? 'ผลลัพธ์ทั้งหมด' : 'total outcomes'} (${failed} ${th ? 'ไม่สำเร็จ' : 'failed'})`}
          icon={<Gauge className="w-5 h-5" />}
          accentColor="purple"
        />
        <MetricCard
          title={th ? 'ปริมาณโทเค็นที่ประมวลผล' : 'Native tokens processed'}
          value={showCount(comm?.totalTokensProcessed)}
          subtitle={th ? 'บันทึกจาก Telemetry จริง' : 'Recorded runtime telemetry'}
          icon={<Database className="w-5 h-5" />}
          accentColor="lime"
        />
        {isAnalyticsConnected && (
          <MetricCard
            title={th ? 'รายได้' : 'Revenue'}
            value={`$${comm!.simulatedRevenueUsd.toFixed(2)}`}
            subtitle={th ? 'เชื่อมต่อ Analytics และระบบบัญชีแล้ว' : 'Connected Analytics & Billing'}
            icon={<DollarSign className="w-5 h-5" />}
            accentColor="cyan"
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VividCard
          title={th ? 'หลักฐานการปฏิบัติงานจริง (Execution Evidence)' : 'Execution & Failure Telemetry'}
          subtitle={th ? 'ค่าตัวเลขมาจากสถานะรันไทม์จริงและ Audit Ledger' : 'Counters sourced strictly from live runtime status and audit ledger.'}
          gradientAccent="cyan"
        >
          <div className="space-y-3 text-sm tabular-nums">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--app-surface-elevated)] p-3">
              <span className="text-[var(--app-text-secondary)]">{th ? 'งานที่สำเร็จ' : 'Completed tasks'}</span>
              <strong className="font-mono text-[var(--z-ok)]">{showCount(comm?.tasksCompleted)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--app-surface-elevated)] p-3">
              <span className="text-[var(--app-text-secondary)]">{th ? 'งานที่ไม่สำเร็จ (อัตราผิดพลาด)' : 'Failed tasks (Failure rate)'}</span>
              <strong className="font-mono text-[var(--app-text-primary)]">
                {showCount(comm?.tasksFailed)} ({failureRate})
              </strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--app-surface-elevated)] p-3">
              <span className="text-[var(--app-text-secondary)]">{th ? 'โทเค็น · ความหน่วงล่าสุด' : 'Recorded tokens · Last latency'}</span>
              <strong className="font-mono text-[var(--app-text-primary)]">
                {showCount(comm?.totalTokensProcessed)} · {resources?.lastInferenceLatencyMs ? `${resources.lastInferenceLatencyMs} ms` : '—'}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--app-surface-elevated)] p-3">
              <span className="text-[var(--app-text-secondary)]">{th ? 'สถานะห่วงโซ่หลักฐาน' : 'Audit chain verification'}</span>
              <StatusDot
                status={audit?.chainValid === true ? 'VERIFIED' : audit?.chainValid === false ? 'BLOCKED' : 'UNVERIFIED'}
                label={audit ? `${audit.totalRecords} entries` : 'UNVERIFIED'}
              />
            </div>
          </div>
        </VividCard>

        <VividCard
          title={th ? 'ขอบเขตการวัดผลและการตรวจสอบ' : 'Measurement Integrity & Proof Scope'}
          subtitle={th ? 'แสดงเฉพาะตัวชี้วัดที่มีแหล่งข้อมูลจริงรองรับ' : 'Only live runtime-backed metrics are displayed.'}
          gradientAccent="coral"
        >
          <div className="space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[var(--app-accent)] shrink-0 mt-0.5" />
              <p className="text-[var(--app-text-secondary)] leading-relaxed">
                {th
                  ? 'ระบบแสดงเฉพาะผลลัพธ์จากงานที่รันจริง และซ่อนการ์ดที่ยังไม่ได้เชื่อมต่อกับแหล่งข้อมูลภายนอก (เช่น ข้อมูลรายได้) เพื่อป้องกันการแสดงค่าประมาณการ'
                  : 'Only live-executed metrics are surfaced; unintegrated modules such as external billing ledgers remain hidden until connected.'}
              </p>
            </div>
            {onNavigate && (
              <div className="flex flex-wrap gap-4 pt-1">
                <button type="button" onClick={() => onNavigate('proof_of_intelligence')} className="vivid-inline-link">
                  <span>{th ? 'ดู Proof & Benchmarks' : 'Open Proof & Benchmarks'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                {isPrivileged && (
                  <button type="button" onClick={() => onNavigate('governance_security')} className="vivid-inline-link">
                    <span>{th ? 'ตรวจสอบ Audit Ledger' : 'Inspect Audit Ledger'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </VividCard>
      </div>
    </div>
  );
};
