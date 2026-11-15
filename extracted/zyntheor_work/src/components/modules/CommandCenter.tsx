import React from 'react';
import { SystemStatusData, ModuleId } from '../../types';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { PageContainer, SectionHeader, ResponsiveGrid, SplitPanel } from '../ui/LayoutPrimitives';
import { Eyebrow, Heading, Text } from '../ui/Typography';
import { ResourceMonitor } from '../ResourceMonitor';
import { ExpenseSummaryChart } from '../ExpenseSummaryChart';
import { useLanguage } from '../../context/LanguageContext';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Cpu,
  FolderOpen,
  Play,
  ShieldCheck,
  Workflow,
  BrainCircuit,
  Eye,
  Code2,
  FlaskConical,
  Network,
  GraduationCap,
} from 'lucide-react';

interface CommandCenterProps {
  statusData: SystemStatusData | null;
  onNavigate: (module: ModuleId) => void;
  onOpenQuickTask: () => void;
}

const formatCount = (value: number | undefined, lang: 'th' | 'en') =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-US').format(value)
    : '—';

export const CommandCenter: React.FC<CommandCenterProps> = ({
  statusData,
  onNavigate,
  onOpenQuickTask,
}) => {
  const { lang } = useLanguage();
  const model = statusData?.model;
  const commercial = statusData?.commercial;
  const audit = statusData?.audit;
  const sandbox = statusData?.sandbox;
  const resources = statusData?.resources;
  const totalTasks = (commercial?.tasksCompleted ?? 0) + (commercial?.tasksFailed ?? 0);
  const successRate = totalTasks > 0 && commercial
    ? `${commercial.taskCompletionRate.toFixed(1)}%`
    : '—';
  const runtimeState =
    model?.runtimeState ||
    statusData?.connectivity?.runtimeState ||
    (model?.weightsLoaded ? 'READY' : undefined);
  const executionVerified =
    model?.executionVerified ??
    statusData?.connectivity?.executionVerified ??
    false;
  const modelReady = Boolean(model?.weightsLoaded && executionVerified && (!runtimeState || runtimeState === 'READY'));
  const modelStatus = !model
    ? (lang === 'th' ? 'รอข้อมูลจาก Runtime' : 'Awaiting runtime data')
    : modelReady
      ? (lang === 'th' ? 'READY (ผ่านการทดสอบ Inference)' : 'READY (Execution verified)')
      : runtimeState
        ? `${runtimeState}${model.executionError ? ` · ${model.executionError}` : ''}`
        : (lang === 'th' ? 'ยังไม่ได้โหลดโมเดล' : 'Weights not loaded');
  const auditStatus = !audit
    ? (lang === 'th' ? 'ไม่มีข้อมูล' : 'No data')
    : audit.chainValid
      ? (lang === 'th' ? 'Integrity ผ่าน' : 'Integrity valid')
      : (lang === 'th' ? 'ต้องตรวจสอบ' : 'Review required');

  return (
    <PageContainer className="command-center">
      <section className="command-hero relative overflow-hidden rounded-3xl border p-6 md:p-9">
        <div className="command-hero-orb" aria-hidden="true" />
        <div className="relative z-10 max-w-3xl">
          <Eyebrow color="cyan" className="mb-3">
            ZYNTHEOR · Autonomous Intelligence Platform
          </Eyebrow>
          <Heading as="h2" scale="display" className="max-w-3xl text-white">
            {lang === 'th'
              ? 'ปัญญาประดิษฐ์อเนกประสงค์ ที่คิด เข้าใจ สร้าง และเรียนรู้'
              : 'A general-purpose intelligence that understands, reasons, creates and learns.'}
          </Heading>
          <Text size="base" className="mt-3 max-w-2xl text-[#9AA8C7]">
            {lang === 'th'
              ? 'ZYNTHEOR เชื่อมความสามารถหลายด้านไว้บน Native Intelligence Core เดียว ตั้งแต่การรับรู้และให้เหตุผล ไปจนถึงการสร้าง วิจัย ลงมือทำ และปรับปรุงจากผลการทดสอบ'
              : 'ZYNTHEOR brings multiple capabilities together around one Native Intelligence Core—from perception and reasoning to creation, research, execution and evidence-based improvement.'}
          </Text>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              onClick={() => onNavigate('autonomous_execution')}
              className="command-primary-action"
            >
              <Workflow className="h-4 w-4" />
              {lang === 'th' ? 'เริ่มทำงานจากโจทย์' : 'Start with an objective'}
              <ArrowRight className="h-4 w-4" />
            </button>
            <button onClick={onOpenQuickTask} className="command-secondary-action">
              <Play className="h-4 w-4" />
              {lang === 'th' ? 'ส่งโจทย์ด่วน' : 'Quick objective'}
            </button>
          </div>
        </div>
      </section>

      <section className="command-capabilities" aria-labelledby="command-capabilities-title">
        <div className="command-capabilities-heading">
          <div>
            <Eyebrow color="violet">{lang === 'th' ? 'ขอบเขตความสามารถ' : 'INTELLIGENCE DOMAINS'}</Eyebrow>
            <Heading as="h3" scale="h2" id="command-capabilities-title">
              {lang === 'th' ? 'โครงสร้างเป้าหมาย: หกแขนง บน Native Core' : 'Six capability domains. One native core.'}
            </Heading>
            <Text size="sm" className="mt-1" tone="secondary">
              {lang === 'th'
                ? 'เลือกพื้นที่พัฒนาแต่ละด้าน การเชื่อมต่อและความสามารถจริงต้องยืนยันจาก Runtime และผลทดสอบ'
                : 'Open a development domain. Integration and real capability must be confirmed by runtime and test evidence.'}
            </Text>
          </div>
          <div className="command-core-chip">
            <BrainCircuit className="h-4 w-4" />
            <span>TARGET ARCHITECTURE · NATIVE CORE</span>
          </div>
        </div>
        <div className="command-capability-grid">
          <button className="command-capability-card capability-cyan" onClick={() => onNavigate('intelligence_core')}>
            <span className="command-capability-icon"><BrainCircuit /></span>
            <span className="command-capability-title">{lang === 'th' ? 'สมองและปัญญาหลัก' : 'Native Intelligence Core'}</span>
            <span className="command-capability-copy">{lang === 'th' ? 'สถาปัตยกรรมโมเดล การรับรู้ ความเข้าใจ และเหตุผล' : 'Model architecture, perception, understanding and reasoning.'}</span>
            <span className="command-capability-link">{lang === 'th' ? 'เปิด Intelligence Core' : 'Open Intelligence Core'} <ArrowRight /></span>
          </button>
          <button className="command-capability-card capability-violet" onClick={() => onNavigate('research_lab')}>
            <span className="command-capability-icon"><Eye /></span>
            <span className="command-capability-title">{lang === 'th' ? 'การรับรู้หลายรูปแบบ' : 'Multimodal Intelligence'}</span>
            <span className="command-capability-copy">{lang === 'th' ? 'พื้นที่วิจัยการเข้าใจภาษา ภาพ เสียง เอกสาร และข้อมูล' : 'Workspace for language, image, audio, document and data understanding.'}</span>
            <span className="command-capability-link">{lang === 'th' ? 'เปิด Research Lab' : 'Open Research Lab'} <ArrowRight /></span>
          </button>
          <button className="command-capability-card capability-blue" onClick={() => onNavigate('cognitive_operations')}>
            <span className="command-capability-icon"><Network /></span>
            <span className="command-capability-title">{lang === 'th' ? 'การให้เหตุผลและการเรียนรู้' : 'Reasoning & Learning'}</span>
            <span className="command-capability-copy">{lang === 'th' ? 'วิเคราะห์ วางแผน จัดการความรู้ และประเมินการเรียนรู้' : 'Analysis, planning, knowledge operations and learning evaluation.'}</span>
            <span className="command-capability-link">{lang === 'th' ? 'เปิด Cognitive Operations' : 'Open Cognitive Operations'} <ArrowRight /></span>
          </button>
          <button className="command-capability-card capability-coral" onClick={() => onNavigate('dev_studio')}>
            <span className="command-capability-icon"><Code2 /></span>
            <span className="command-capability-title">{lang === 'th' ? 'การสร้างและลงมือทำ' : 'Creation & Execution'}</span>
            <span className="command-capability-copy">{lang === 'th' ? 'พัฒนาซอฟต์แวร์ สร้างผลงาน และตรวจสอบการทำงาน' : 'Build software and artifacts, execute tools and verify outcomes.'}</span>
            <span className="command-capability-link">{lang === 'th' ? 'เปิด Creation Studio' : 'Open Creation Studio'} <ArrowRight /></span>
          </button>
          <button className="command-capability-card capability-lime" onClick={() => onNavigate('research_lab')}>
            <span className="command-capability-icon"><FlaskConical /></span>
            <span className="command-capability-title">{lang === 'th' ? 'การวิจัยและแก้ปัญหา' : 'Research & Problem Solving'}</span>
            <span className="command-capability-copy">{lang === 'th' ? 'ค้นคว้า ทดลอง วิเคราะห์ และตรวจสอบข้อค้นพบ' : 'Investigate, experiment, analyze and validate findings.'}</span>
            <span className="command-capability-link">{lang === 'th' ? 'เปิด Research Lab' : 'Open Research Lab'} <ArrowRight /></span>
          </button>
          <button className="command-capability-card capability-magenta" onClick={() => onNavigate('model_laboratory')}>
            <span className="command-capability-icon"><GraduationCap /></span>
            <span className="command-capability-title">{lang === 'th' ? 'ปัญญาปรับตัวและพัฒนาตนเอง' : 'Adaptive Intelligence'}</span>
            <span className="command-capability-copy">{lang === 'th' ? 'ฝึกโมเดล ประเมินผล เปรียบเทียบ และปรับปรุงอย่างมีหลักฐาน' : 'Train, evaluate, compare and improve models with evidence.'}</span>
            <span className="command-capability-link">{lang === 'th' ? 'เปิด Model Laboratory' : 'Open Model Laboratory'} <ArrowRight /></span>
          </button>
        </div>
      </section>

      <section aria-label={lang === 'th' ? 'ภาพรวมระบบ' : 'System overview'} className="space-y-4">
        <SectionHeader
          title={lang === 'th' ? 'ภาพรวมจากระบบจริง' : 'Live system overview'}
          subtitle={lang === 'th' ? 'แสดงเฉพาะข้อมูลที่ Runtime ส่งกลับมา' : 'Only values reported by the runtime are shown.'}
          action={
            <button
              onClick={() => onNavigate('analytics_bi')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#00F0FF] hover:brightness-110 cursor-pointer"
            >
              {lang === 'th' ? 'ดูตัวชี้วัด' : 'View analytics'} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
        />
        <ResponsiveGrid cols={4}>
          <MetricCard
            title={lang === 'th' ? 'พารามิเตอร์โมเดลที่โหลด' : 'Loaded model parameters'}
            value={modelReady ? formatCount(model?.totalParams, lang) : '—'}
            subtitle={modelStatus}
            icon={<Cpu className="h-5 w-5" />}
            accentColor="cyan"
          />
          <MetricCard
            title={lang === 'th' ? 'งานที่สำเร็จ' : 'Completed tasks'}
            value={formatCount(commercial?.tasksCompleted, lang)}
            subtitle={`${formatCount(commercial?.tasksFailed, lang)} ${lang === 'th' ? 'งานที่ไม่สำเร็จ' : 'failed'}`}
            icon={<CheckCircle2 className="h-5 w-5" />}
            accentColor="lime"
          />
          <MetricCard
            title={lang === 'th' ? 'อัตราความสำเร็จ' : 'Task success rate'}
            value={successRate}
            subtitle={totalTasks > 0 ? `${formatCount(totalTasks, lang)} ${lang === 'th' ? 'งานที่บันทึก' : 'recorded tasks'}` : (lang === 'th' ? 'ยังไม่มีข้อมูลการทำงาน' : 'No task records yet')}
            icon={<Activity className="h-5 w-5" />}
            accentColor="violet"
          />
          <MetricCard
            title={lang === 'th' ? 'รายการ Audit' : 'Audit records'}
            value={formatCount(audit?.totalRecords, lang)}
            subtitle={auditStatus}
            icon={<ShieldCheck className="h-5 w-5" />}
            accentColor="blue"
          />
        </ResponsiveGrid>
      </section>

      <SplitPanel
        ratio="2:1"
        primary={
          <VividCard
            title={lang === 'th' ? 'ทรัพยากร Runtime' : 'Runtime resources'}
            subtitle={lang === 'th' ? 'ตัวอย่างข้อมูลจากระบบปฏิบัติการและโปรเซสจริง' : 'Measured operating-system and process telemetry'}
            gradientAccent="cyan"
          >
            {resources ? (
              <ResourceMonitor history={resources.history} current={resources.current} />
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm" style={{ color: 'var(--app-text-secondary)' }}>
                <Activity className="h-6 w-6 opacity-60" />
                {lang === 'th' ? 'ยังไม่มีข้อมูล Telemetry จาก Runtime' : 'Runtime telemetry is not available yet.'}
              </div>
            )}
          </VividCard>
        }
        secondary={
          <div className="space-y-5">
            <VividCard
              title={lang === 'th' ? 'สถานะบริการ' : 'Service status'}
              subtitle={lang === 'th' ? 'สรุปจากการตรวจสอบล่าสุด' : 'Latest runtime-reported state'}
              gradientAccent="violet"
            >
              <div className="divide-y" style={{ borderColor: 'var(--app-card-border)' }}>
                <div className="flex items-start gap-3 py-3 first:pt-0">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${modelReady ? 'bg-[#CCFF00]' : runtimeState === 'FAILED' || runtimeState === 'NOT_FOUND' ? 'bg-[#FF007F]' : 'bg-[#FF5E3A]'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{lang === 'th' ? 'Native Model' : 'Native model'}</div>
                    <div className="mt-1 break-words text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                      {model?.name || modelStatus}
                      {model?.weightsRole ? ` · role: ${model.weightsRole}` : ''}
                    </div>
                  </div>
                  <span className="text-xs font-mono shrink-0" style={{ color: modelReady ? '#CCFF00' : '#FF8C73' }}>
                    {runtimeState || (modelReady ? 'READY' : 'NOT_LOADED')}
                  </span>
                </div>
                <div className="flex items-start gap-3 py-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${audit?.chainValid ? 'bg-[#CCFF00]' : 'bg-[#FF007F]'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Audit integrity</div>
                    <div className="mt-1 text-xs font-mono" style={{ color: 'var(--app-text-secondary)' }}>{audit?.headHash ? `${audit.headHash.slice(0, 12)}…` : (lang === 'th' ? 'ไม่มี Hash head' : 'No hash head available')}</div>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: 'var(--app-text-secondary)' }}>{auditStatus}</span>
                </div>
                <div className="flex items-start gap-3 py-3 last:pb-0">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#00F0FF]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Workspace</div>
                    <div className="mt-1 break-all text-xs font-mono" style={{ color: 'var(--app-text-secondary)' }}>{sandbox?.path || (lang === 'th' ? 'รอข้อมูล Workspace' : 'Workspace path unavailable')}</div>
                  </div>
                  <span className="text-xs font-mono tabular-nums shrink-0" style={{ color: 'var(--app-text-secondary)' }}>{sandbox ? `${formatCount(sandbox.fileCount, lang)} files` : '—'}</span>
                </div>
              </div>
              {statusData?.serverTime && (
                <p className="mt-4 border-t pt-3 text-[11px] font-mono" style={{ borderColor: 'var(--app-card-border)', color: 'var(--app-text-secondary)' }}>
                  {lang === 'th' ? 'อัปเดตล่าสุด' : 'Last updated'}: {new Date(statusData.serverTime).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US')}
                </p>
              )}
            </VividCard>

            <VividCard title={lang === 'th' ? 'ไปยังพื้นที่ทำงาน' : 'Workspace shortcuts'}>
              <div className="space-y-1">
                <button onClick={() => onNavigate('autonomous_execution')} className="command-link-row">
                  <span className="flex items-center gap-3"><Workflow className="h-4 w-4 text-[#00F0FF]" />{lang === 'th' ? 'สั่งงานและติดตาม Execution' : 'Create and monitor execution'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button onClick={() => onNavigate('cognitive_operations')} className="command-link-row">
                  <span className="flex items-center gap-3"><Cpu className="h-4 w-4 text-[#CCFF00]" />{lang === 'th' ? 'Action Engine 8 เสาหลัก & พุทธิปัญญา' : 'Action Engine (8 Pillars) & Cognitive'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button onClick={() => onNavigate('knowledge_hub')} className="command-link-row">
                  <span className="flex items-center gap-3"><FolderOpen className="h-4 w-4 text-[#7B2CBF]" />{lang === 'th' ? 'คลังความรู้' : 'Knowledge workspace'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button onClick={() => onNavigate('governance_security')} className="command-link-row">
                  <span className="flex items-center gap-3"><CircleAlert className="h-4 w-4 text-[#FF5E3A]" />{lang === 'th' ? 'การตรวจสอบและความปลอดภัย' : 'Governance and security'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </VividCard>
          </div>
        }
      />

      <section aria-label={lang === 'th' ? 'สรุปค่าใช้จ่ายจาก SQLite Ledger' : 'Live SQLite expense ledger summary'}>
        <ExpenseSummaryChart />
      </section>
    </PageContainer>
  );
};

export default CommandCenter;
