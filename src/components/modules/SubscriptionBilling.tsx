import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { ModuleId, SystemStatusData } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { CreditCard, Check, DollarSign, Zap, ArrowRight, LayoutDashboard, AlertCircle } from 'lucide-react';

interface SubscriptionBillingProps {
  statusData: SystemStatusData | null;
  onRefresh: () => void;
  onNavigate?: (module: ModuleId) => void;
}

export const SubscriptionBilling: React.FC<SubscriptionBillingProps> = ({ statusData, onRefresh, onNavigate }) => {
  const { authHeaders, isAuthenticated } = useAuth();
  const { lang } = useLanguage();
  const th = lang === 'th';
  const commercial = statusData?.commercial;
  const hasConnectedAnalytics = Boolean(
    commercial && ((commercial.tasksCompleted ?? 0) + (commercial.tasksFailed ?? 0) > 0 || (commercial.totalTokensProcessed ?? 0) > 0)
  );
  const hasVerifiedRevenue = Boolean(
    hasConnectedAnalytics && typeof commercial?.simulatedRevenueUsd === 'number' && commercial.simulatedRevenueUsd > 0
  );
  const currentPlan = commercial?.activePlanId || 'tier_free';
  const currentPhase = commercial?.currentPhase || 'PRIVATE_BETA';
  const [switching, setSwitching] = useState(false);
  const [billingNotice, setBillingNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const plans = [
    {
      id: 'tier_free',
      name: th ? 'Private Beta (นักพัฒนา)' : 'Private Beta (Developer)',
      price: '$0',
      period: th ? 'ใช้งานฟรีตลอด' : 'Forever free',
      desc: th
        ? 'สำหรับนักพัฒนาที่ประเมินแพลตฟอร์ม Native Intelligence และ Cloud Runtime ภายใต้การกำกับ (ยังไม่เชื่อมระบบชำระเงิน)'
        : 'For developers evaluating the Native Intelligence platform and governed Cloud Runtime. Checkout is not connected.',
      features: th
        ? [
            'Sandbox แยกส่วน (/workspace)',
            'Native Intelligence Runtime',
            'สมุดบัญชีตรวจสอบ SHA-256 (Audit Ledger)',
            'Tokenizer มาตรฐานสองภาษา ไทย/อังกฤษ',
          ]
        : [
            'Single-tenant Sandbox (/workspace)',
            'Native Intelligence Runtime',
            'SHA-256 Audit Ledger',
            'Standard Tokenizer',
          ]
    },
    {
      id: 'tier_pro',
      name: th ? 'Public Beta (มืออาชีพ)' : 'Public Beta (Professional)',
      price: '$79',
      period: th ? 'ต่อเดือน' : 'per month',
      desc: th
        ? 'ความสามารถระบบอัตโนมัติหลายบทบาทตามแผนพัฒนา ความพร้อมใช้งานขึ้นอยู่กับเกตการรันจริง'
        : 'Planned multi-role automation features. Availability depends on verified runtime and execution gates.',
      popular: true,
      features: th
        ? [
            'การทำงานอัตโนมัติ 4 บทบาท (Multi-Agent)',
            'วงจรปรับปรุงตนเองพร้อมตัวประเมินอัตโนมัติ',
            'ตรวจสอบไฟล์และรันคำสั่งใน Sandbox ไม่จำกัด',
            'หน่วยความจำข้ามเซสชันแบบถาวร',
            'เกตเวย์ประมวลผล Cloud ลำดับความสำคัญสูง',
          ]
        : [
            '4-Role Multi-Agent Automation',
            'Self-Evolving Loop (Automated Evaluator)',
            'Unlimited File Inspect & Execution',
            'Persistent Cross-Session Memory',
            'Priority Cloud Execution Gateway',
          ]
    },
    {
      id: 'tier_team',
      name: th ? 'องค์กรเชิงพาณิชย์ (Sovereign Core)' : 'Commercial Enterprise (Sovereign Core)',
      price: '$299',
      period: th ? 'ต่อเดือน' : 'per month',
      desc: th
        ? 'แผนบริการ Cloud Runtime แบบแยกองค์กรและการควบคุมกุญแจเข้ารหัส (ยังไม่ได้เปิดจำหน่ายจริง)'
        : 'Planned managed Cloud Runtime, key controls and multi-tenant isolation; not yet a live service offer.',
      features: th
        ? [
            'การแยกส่วนระดับหลายองค์กร (Multi-tenant)',
            'การเข้ารหัส Checkpoint ระดับฮาร์ดแวร์',
            'ปรับแต่งสถาปัตยกรรม Fine-Tuning เฉพาะทาง',
            'ติดตั้ง Cloud Runtime ภายใต้ธรรมาภิบาล',
            'ตรวจสอบหลักฐานความถูกต้องเชิงคริปโตกราฟี',
          ]
        : [
            'Multi-tenant Virtual Isolation',
            'Hardware Checkpoint Encryption',
            'Custom Architecture Fine-Tuning Delta',
            'Governed Cloud Runtime Deployment',
            'Cryptographic Proof Audit Verification',
          ]
    }
  ];

  const handleSelectPlan = async (planId: string) => {
    if (!isAuthenticated) {
      setBillingNotice({
        ok: false,
        text: th
          ? 'กรุณาเข้าสู่ระบบด้วยสิทธิ์ Administrator เพื่อเปลี่ยนแผนระดับองค์กร'
          : 'Sign in as Administrator to switch commercial plans.',
      });
      return;
    }
    setSwitching(true);
    setBillingNotice(null);
    try {
      const res = await fetch('/api/commercial/plan', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ planId })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setBillingNotice({
          ok: true,
          text: th ? `เปลี่ยนแผนเป็น ${planId} เรียบร้อยแล้ว` : `Switched active tier to ${planId}.`,
        });
        onRefresh();
      } else {
        setBillingNotice({
          ok: false,
          text:
            data?.error ||
            (res.status === 403
              ? th
                ? 'ต้องใช้สิทธิ์ Administrator เพื่อเปลี่ยนแผนการใช้งาน'
                : 'Administrator role is required to switch plans.'
              : th
              ? `เปลี่ยนแผนไม่สำเร็จ (HTTP ${res.status})`
              : `Plan change failed (HTTP ${res.status})`),
        });
      }
    } catch (err: any) {
      setBillingNotice({ ok: false, text: err?.message || (th ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ' : 'Request failed') });
    } finally {
      setSwitching(false);
    }
  };

  const handleSelectPhase = async (phase: string) => {
    if (!isAuthenticated) {
      setBillingNotice({
        ok: false,
        text: th
          ? 'กรุณาเข้าสู่ระบบด้วยสิทธิ์ Administrator เพื่อสลับระยะการเปิดตัว'
          : 'Sign in as Administrator to switch launch phases.',
      });
      return;
    }
    setBillingNotice(null);
    try {
      const res = await fetch('/api/commercial/phase', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ phase })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setBillingNotice({
          ok: true,
          text: th ? `อัปเดตระยะเป็น ${phase} แล้ว` : `Launch phase updated to ${phase}.`,
        });
        onRefresh();
      } else {
        setBillingNotice({
          ok: false,
          text:
            data?.error ||
            (res.status === 403
              ? th
                ? 'ต้องใช้สิทธิ์ Administrator เพื่อเปลี่ยนระยะเปิดตัว'
                : 'Administrator role is required to switch launch phases.'
              : th
              ? `เปลี่ยนระยะเปิดตัวไม่สำเร็จ (HTTP ${res.status})`
              : `Phase update failed (HTTP ${res.status})`),
        });
      }
    } catch (err: any) {
      setBillingNotice({ ok: false, text: err?.message || (th ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ' : 'Request failed') });
    }
  };

  return (
    <div className="space-y-8">
      {/* Launch Phase Selector Header */}
      <VividCard gradientAccent="sunset" className="!p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold text-[var(--z-warn)]">
              {th ? 'แผนงานเชิงพาณิชย์ ZYNTHEOR' : 'ZYNTHEOR Commercial Roadmap'}
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              {th ? 'กลไกธุรกิจอิสระและระยะการเปิดตัว' : 'Sovereign Business Engine & Launch Phases'}
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              {th
                ? 'สร้างเพื่อใช้งานจริง ทดสอบกับผู้ใช้ พัฒนาด้วยหลักฐาน และขยายผลสู่เชิงพาณิชย์'
                : '"Build to Use. Test with Users. Improve with Evidence. Scale for Revenue."'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] rounded-xl">
            {(['PRIVATE_BETA', 'PUBLIC_BETA', 'COMMERCIAL_LAUNCH'] as const).map((phase) => (
              <button
                key={phase}
                type="button"
                onClick={() => handleSelectPhase(phase)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  currentPhase === phase
                    ? 'bg-[var(--app-card)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] shadow-sm'
                    : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {phase === 'PRIVATE_BETA'
                  ? th
                    ? '1. Private Beta'
                    : '1. Private Beta'
                  : phase === 'PUBLIC_BETA'
                  ? th
                    ? '2. Public Beta'
                    : '2. Public Beta'
                  : th
                  ? '3. เปิดตัวเชิงพาณิชย์'
                  : '3. Commercial Launch'}
              </button>
            ))}
          </div>
        </div>

        {billingNotice && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
              billingNotice.ok
                ? 'border-[color-mix(in_srgb,var(--z-ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-ok)_12%,transparent)] text-[var(--z-ok)]'
                : 'border-[color-mix(in_srgb,var(--z-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--z-danger)_12%,transparent)] text-[var(--z-danger)]'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{billingNotice.text}</span>
          </div>
        )}
      </VividCard>

      {/* Connected Economics Breakdown (Revenue hidden when Analytics/Billing is not connected) */}
      {hasVerifiedRevenue ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <MetricCard
            title={th ? 'ค่าใช้จ่าย API ภายนอก' : 'Cloud API Dependency'}
            value="$0.00"
            subtitle={th ? 'ไม่มีค่าโทเค็นจากผู้ให้บริการภายนอก' : 'Zero External Token Cost'}
            icon={<DollarSign className="w-5 h-5" />}
            accentColor="lime"
          />
          <MetricCard
            title={th ? 'อัตรากำไรขั้นต้น' : 'Gross Margin'}
            value={typeof commercial?.grossMarginPct === 'number' ? `${commercial.grossMarginPct}%` : '—'}
            subtitle={th ? 'คำนวณจากต้นทุนประมวลผลจริง' : 'Verified compute economics'}
            icon={<Zap className="w-5 h-5" />}
            accentColor="cyan"
          />
          <MetricCard
            title={th ? 'รายได้ประจำรายเดือน (Revenue)' : 'Monthly Recurring Revenue'}
            value={`$${commercial!.simulatedRevenueUsd.toFixed(2)}`}
            subtitle={th ? 'เชื่อมต่อข้อมูลรายได้จริงแล้ว' : 'Connected Billing Cohort'}
            icon={<CreditCard className="w-5 h-5" />}
            accentColor="purple"
          />
        </div>
      ) : (
        <VividCard
          title={th ? 'เริ่มต้นสั่งงานแรกของคุณ' : 'Start your first task'}
          subtitle={
            th
              ? 'ซ่อนการ์ด Revenue และค่าประมาณการชั่วคราว จนกว่าระบบ Analytics จะเชื่อมต่อและมีข้อมูลงานจริง'
              : 'The Revenue card is hidden unless Analytics is connected — start your first task in Command Center to record real activity.'
          }
          gradientAccent="cyan"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-surface-elevated)] p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] flex items-center justify-center shrink-0">
                <LayoutDashboard className="w-4 h-4" />
              </div>
              <p className="text-xs text-[var(--app-text-secondary)] leading-relaxed">
                {th
                  ? 'ระบบจะไม่แสดงตัวเลขรายได้จำลองหรือค่าประมาณการเมื่อยังไม่มีการเชื่อมต่อระบบ Billing และ Analytics จริง'
                  : 'No simulated Revenue card is shown before live Billing and Analytics telemetry is connected.'}
              </p>
            </div>
            {onNavigate && (
              <button
                type="button"
                data-testid="billing-empty-command-center-btn"
                onClick={() => onNavigate('command_center')}
                className="min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--app-accent-deep)] text-white text-xs font-bold hover:opacity-95 transition-opacity cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>{th ? 'ไปที่ Command Center' : 'Go to Command Center'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </VividCard>
      )}

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const isActive = currentPlan === plan.id;
          return (
            <div
              key={plan.id}
              className={`rounded-2xl p-6 transition-all duration-200 flex flex-col justify-between ${
                isActive
                  ? 'bg-[var(--app-card)] border-2 border-[var(--app-accent)] shadow-sm'
                  : 'bg-[var(--app-card)] border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)] shadow-sm'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-[var(--app-text-primary)] text-base">{plan.name}</h3>
                  {plan.popular && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] whitespace-nowrap">
                      {th ? 'แนะนำ' : 'MOST POPULAR'}
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-[var(--app-text-primary)] font-mono">{plan.price}</span>
                  <span className="text-xs text-[var(--app-text-secondary)]">{plan.period}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--app-text-secondary)]">{plan.desc}</p>

                <div className="mt-6 space-y-2.5 border-t border-[var(--app-card-border)] pt-4">
                  {plan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-[var(--app-text-primary)]">
                      <Check className="w-4 h-4 text-[var(--z-ok)] shrink-0" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleSelectPlan(plan.id)}
                disabled={isActive || switching}
                className={`mt-8 w-full py-2.5 rounded-xl text-xs font-bold transition-all border ${
                  isActive
                    ? 'bg-[var(--app-surface-elevated)] text-[var(--app-accent)] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] cursor-default'
                    : 'bg-[var(--app-surface)] hover:border-[var(--app-accent)] text-[var(--app-text-primary)] border-[var(--app-card-border)] cursor-pointer'
                }`}
              >
                {isActive
                  ? th
                    ? 'แผนที่ใช้งานอยู่ปัจจุบัน'
                    : 'Current Active Tier'
                  : th
                  ? 'เปลี่ยนเป็นแผนนี้'
                  : 'Switch to Tier'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
