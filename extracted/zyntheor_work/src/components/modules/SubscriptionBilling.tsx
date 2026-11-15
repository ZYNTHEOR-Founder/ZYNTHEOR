import React, { useState } from 'react';
import { VividCard } from '../ui/VividCard';
import { MetricCard } from '../ui/MetricCard';
import { SystemStatusData } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { apiUrl } from '../../lib/apiClient';
import { CreditCard, Check, ShieldCheck, DollarSign, Zap, ArrowRight } from 'lucide-react';

interface SubscriptionBillingProps {
  statusData: SystemStatusData | null;
  onRefresh: () => void;
}

export const SubscriptionBilling: React.FC<SubscriptionBillingProps> = ({ statusData, onRefresh }) => {
  const { authHeaders } = useAuth();
  const commercial = statusData?.commercial;
  const currentPlan = commercial?.activePlanId || 'tier_pro';
  const currentPhase = commercial?.currentPhase || 'COMMERCIAL_LAUNCH';
  const [switching, setSwitching] = useState(false);

  const plans = [
    {
      id: 'tier_free',
      name: 'Private Beta (Developer)',
      price: '$0',
      period: 'Forever free',
      desc: 'สำหรับทดลองใช้ในช่วง Private Beta บน Sovereign Cloud',
      features: [
        'Single-tenant Sandbox (/workspace)',
        'Native model capability (quality status disclosed)',
        'SHA-256 Audit Ledger',
        'Standard Tokenizer'
      ]
    },
    {
      id: 'tier_pro',
      name: 'Public Beta (Professional)',
      price: 'ตั้งราคาเมื่อพร้อมเปิดขาย',
      period: 'ราคายังไม่เปิดใช้งาน',
      desc: 'แพ็กเกจสำหรับผู้ใช้มืออาชีพ — รอผลทดสอบและกำหนดราคาอย่างเป็นทางการ',
      popular: true,
      features: [
        '4-Role Multi-Agent Automation',
        'Self-Evolving Loop (Automated Evaluator)',
        'Unlimited File Inspect & Execution',
        'Persistent Cross-Session Memory',
        'Priority Online Execution Gateway'
      ]
    },
    {
      id: 'tier_team',
      name: 'Commercial Enterprise (Sovereign Core)',
      price: 'ติดต่อกำหนดราคา',
      period: 'ราคายังไม่เปิดใช้งาน',
      desc: 'แพ็กเกจองค์กรบน Sovereign Cloud — กำหนดขอบเขตบริการและราคาเมื่อผ่านการประเมิน',
      features: [
        'Multi-tenant Virtual Isolation',
        'Hardware Checkpoint Encryption',
        'Custom Architecture Fine-Tuning Delta',
        'Dedicated Sovereign Cloud environment (when provisioned)',
        'Cryptographic Proof Audit Verification'
      ]
    }
  ];

  const handleSelectPlan = async (planId: string) => {
    setSwitching(true);
    try {
      await fetch(apiUrl('/api/commercial/plan'), {
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
    try {
      await fetch(apiUrl('/api/commercial/phase'), {
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
      <VividCard gradientAccent="coral" className="!p-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold text-[#FF5E3A] uppercase tracking-wider">
              ZYNTHEOR Commercial Roadmap
            </div>
            <h2 className="text-xl font-bold text-[var(--app-text-primary)] mt-1">
              Sovereign Business Engine &amp; Launch Phases
            </h2>
            <p className="text-xs text-[var(--app-text-secondary)] mt-1">
              &quot;Build to Use. Test with Users. Improve with Evidence. Scale for Revenue.&quot;
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[var(--app-input-bg)] border border-[var(--app-card-border)] rounded-xl">
            {(['PRIVATE_BETA', 'PUBLIC_BETA', 'COMMERCIAL_LAUNCH'] as const).map((phase) => (
              <button
                key={phase}
                onClick={() => handleSelectPhase(phase)}
                className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  currentPhase === phase
                    ? 'bg-[#00F0FF] text-[#070B19] shadow-sm font-bold'
                    : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                }`}
              >
                {phase === 'PRIVATE_BETA' ? '1. Private Beta' : phase === 'PUBLIC_BETA' ? '2. Public Beta' : '3. Commercial Launch'}
              </button>
            ))}
          </div>
        </div>
      </VividCard>

      {/* Economics Breakdown Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <MetricCard
          title="Cloud API Dependency"
          value="Not metered"
          subtitle="External inference spend not recorded; cloud costs excluded"
          icon={<DollarSign className="w-5 h-5" />}
          accentColor="lime"
        />
        <MetricCard
          title="Gross Margin"
          value={commercial && commercial.simulatedRevenueUsd > 0 ? `${commercial.grossMarginPct}%` : 'Not available'}
          subtitle="Revenue minus Sovereign Cloud Runtime"
          icon={<Zap className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          title="Monthly Recurring Revenue"
          value={`$${(commercial?.simulatedRevenueUsd ?? 0).toFixed(2)}`}
          subtitle="Recorded revenue only; payment integration not connected"
          icon={<CreditCard className="w-5 h-5" />}
          accentColor="violet"
        />
      </div>

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const isActive = currentPlan === plan.id;
          return (
            <div
              key={plan.id}
              className={`rounded-2xl p-6 transition-all duration-200 flex flex-col justify-between bg-[var(--app-surface)] ${
                isActive
                  ? 'border-2 border-[#00F0FF] shadow-lg shadow-[#00F0FF]/10'
                  : 'border border-[var(--app-card-border)] shadow-sm'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-[var(--app-text-primary)] text-base">{plan.name}</h3>
                  {plan.popular && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold text-[#00F0FF] shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] shadow-[0_0_6px_rgba(0,240,255,0.8)]" />
                      POPULAR
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-2xl sm:text-3xl font-extrabold text-[var(--app-text-primary)] font-mono">{plan.price}</span>
                  <span className="text-xs text-[var(--app-text-secondary)]">{plan.period}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--app-text-secondary)]">{plan.desc}</p>

                <div className="mt-6 space-y-2.5 border-t border-[var(--app-card-border)] pt-4">
                  {plan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-[var(--app-text-primary)]">
                      <Check className="w-4 h-4 text-[#CCFF00] shrink-0" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => handleSelectPlan(plan.id)}
                disabled={isActive || switching}
                className={`mt-8 w-full min-h-[44px] py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[var(--app-input-bg)] text-[var(--app-text-secondary)] border border-[var(--app-card-border)] cursor-default'
                    : 'vivid-gradient-brand text-white hover:opacity-95'
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
