import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { ModuleId, SystemStatusData } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { CreditCard, Check, DollarSign, Zap, ArrowRight, LayoutDashboard } from 'lucide-react';

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

  const plans = [
    {
      id: 'tier_free',
      name: 'Private Beta (Developer)',
      price: '$0',
      period: 'Forever free',
      desc: 'For developers evaluating the Native Intelligence platform and governed Cloud Runtime. Checkout is not connected.',
      features: [
        'Single-tenant Sandbox (/workspace)',
        'Native Intelligence Runtime',
        'SHA-256 Audit Ledger',
        'Standard Tokenizer'
      ]
    },
    {
      id: 'tier_pro',
      name: 'Public Beta (Professional)',
      price: '$79',
      period: 'per month',
      desc: 'Planned multi-role automation features. Availability depends on verified runtime and execution gates.',
      popular: true,
      features: [
        '4-Role Multi-Agent Automation',
        'Self-Evolving Loop (Automated Evaluator)',
        'Unlimited File Inspect & Execution',
        'Persistent Cross-Session Memory',
        'Priority Cloud Execution Gateway'
      ]
    },
    {
      id: 'tier_team',
      name: 'Commercial Enterprise (Sovereign Core)',
      price: '$299',
      period: 'per month',
      desc: 'Planned managed Cloud Runtime, key controls and multi-tenant isolation; not yet a live service offer.',
      features: [
        'Multi-tenant Virtual Isolation',
        'Hardware Checkpoint Encryption',
        'Custom Architecture Fine-Tuning Delta',
        'Governed Cloud Runtime Deployment',
        'Cryptographic Proof Audit Verification'
      ]
    }
  ];

  const handleSelectPlan = async (planId: string) => {
    if (!isAuthenticated) return;
    setSwitching(true);
    try {
      await fetch('/api/commercial/plan', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ planId })
      });
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSwitching(false);
    }
  };

  const handleSelectPhase = async (phase: string) => {
    if (!isAuthenticated) return;
    try {
      await fetch('/api/commercial/phase', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ phase })
      });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-8">
      {/* Launch Phase Selector Header */}
      <VividCard gradientAccent="sunset" className="!p-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold text-[var(--z-warn)] ">
              ZYNTHEOR Commercial Roadmap
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              Sovereign Business Engine & Launch Phases
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              "Build to Use. Test with Users. Improve with Evidence. Scale for Revenue."
            </p>
          </div>

          <div className="flex items-center gap-1.5 p-1.5 bg-[var(--app-surface-elevated)] rounded-xl">
            {(['PRIVATE_BETA', 'PUBLIC_BETA', 'COMMERCIAL_LAUNCH'] as const).map((phase) => (
              <button
                key={phase}
                onClick={() => handleSelectPhase(phase)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  currentPhase === phase
                    ? 'bg-white text-[var(--app-text-primary)] shadow-sm'
                    : 'text-[var(--app-text-primary)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {phase === 'PRIVATE_BETA' ? '1. Private Beta' : phase === 'PUBLIC_BETA' ? '2. Public Beta' : '3. Commercial Launch'}
              </button>
            ))}
          </div>
        </div>
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
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--app-accent)] text-slate-950 text-xs font-bold hover:opacity-95 transition-opacity cursor-pointer whitespace-nowrap shrink-0"
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
                  ? 'bg-white border-2 border-[var(--app-accent)] '
                  : 'bg-white border border-[color-mix(in_srgb,var(--app-card-border)_80%,transparent)] shadow-sm'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-[var(--app-text-primary)] text-base">{plan.name}</h3>
                  {plan.popular && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--app-accent)] text-[var(--app-accent)]">
                      MOST POPULAR
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
                onClick={() => handleSelectPlan(plan.id)}
                disabled={isActive || switching}
                className={`mt-8 w-full py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[var(--app-surface-elevated)] text-[var(--app-text-secondary)] cursor-default'
                    : 'bg-[var(--app-bg)] hover:bg-[var(--app-surface)] text-[var(--app-text-primary)]'
                }`}
              >
                {isActive ? 'Current Active Tier' : 'Switch to Tier'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
