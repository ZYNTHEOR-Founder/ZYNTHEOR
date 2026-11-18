/**
 * ZYNTHEOR Commercial & Business Manager
 * Manages the 3 Launch Phases: Private Beta, Public Beta, and Commercial Launch.
 * Enforces Tenant Quotas, Usage Metering, Zero-Cloud-Cost Economics, and Launch Readiness Checklist.
 */

import { AuditLedger } from './AuditLedger';

export type LaunchPhase = 'PRIVATE_BETA' | 'PUBLIC_BETA' | 'COMMERCIAL_LAUNCH';

export interface CommercialPlan {
  id: string;
  name: string;
  monthlyPriceUsd: number;
  dailyTaskLimit: number;
  maxSandboxes: number;
  maxMemorySlots: number;
  slaTarget: string;
  features: string[];
}

export interface CommercialMetrics {
  currentPhase: LaunchPhase;
  activeTenantId: string;
  activePlanId: string;
  tasksCompleted: number;
  tasksFailed: number;
  taskCompletionRate: number;
  totalTokensProcessed: number;
  cloudApiCostUsd: number; // Strictly $0.00 because sovereign
  nativeComputeCostUsd: number;
  simulatedRevenueUsd: number;
  grossMarginPct: number;
  readinessChecklist: {
    product: { passed: boolean; evidence: string };
    usability: { passed: boolean; evidence: string };
    nativeAi: { passed: boolean; evidence: string };
    security: { passed: boolean; evidence: string };
    reliability: { passed: boolean; evidence: string };
    business: { passed: boolean; evidence: string };
    support: { passed: boolean; evidence: string };
  };
}

export class CommercialManager {
  private static instance: CommercialManager | null = null;

  private currentPhase: LaunchPhase = 'PRIVATE_BETA';
  private activeTenantId = 'tenant_sovereign_prime';
  private activePlanId = 'tier_pro';

  private tasksCompleted = 0;
  private tasksFailed = 0;
  private totalTokens = 0;
  private simulatedRevenue = 0;

  public static readonly PLANS: CommercialPlan[] = [
    {
      id: 'tier_free',
      name: 'Private Beta (Developer)',
      monthlyPriceUsd: 0,
      dailyTaskLimit: 25,
      maxSandboxes: 1,
      maxMemorySlots: 50,
      slaTarget: 'Best Effort',
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
      monthlyPriceUsd: 79,
      dailyTaskLimit: 500,
      maxSandboxes: 5,
      maxMemorySlots: 500,
      slaTarget: '99.5% Native Uptime',
      features: [
        'Autonomous Reasoning & Tool Execution',
        'Self-Evolving Loop (Automated Evaluator)',
        'Unlimited File Inspect & Execution',
        'Persistent Cross-Session Memory',
        'Priority Local Execution Gateway'
      ]
    },
    {
      id: 'tier_team',
      name: 'Commercial Enterprise (Sovereign Core)',
      monthlyPriceUsd: 299,
      dailyTaskLimit: 5000,
      maxSandboxes: 25,
      maxMemorySlots: 10000,
      slaTarget: '99.99% Sovereign SLA',
      features: [
        'Multi-tenant Virtual Isolation',
        'Hardware Checkpoint Encryption',
        'Custom Architecture Fine-Tuning Delta',
        'Air-Gapped Sovereign Deployment Mode',
        'Cryptographic Proof Audit Verification'
      ]
    }
  ];

  public static getInstance(): CommercialManager {
    if (!CommercialManager.instance) {
      CommercialManager.instance = new CommercialManager();
    }
    return CommercialManager.instance;
  }

  public recordTask(success: boolean, tokens: number = 250): void {
    if (success) {
      this.tasksCompleted++;
    } else {
      this.tasksFailed++;
    }
    this.totalTokens += tokens;

    AuditLedger.append('COMMERCIAL', 'USAGE_METERED', {
      tenantId: this.activeTenantId,
      plan: this.activePlanId,
      success,
      tokensProcessed: tokens,
      cloudCostUsd: null
    });
  }

  public setPhase(phase: LaunchPhase): void {
    this.currentPhase = phase;
    AuditLedger.append('COMMERCIAL', 'LAUNCH_PHASE_CHANGED', { phase });
  }

  public setPlan(planId: string): void {
    this.activePlanId = planId;
    AuditLedger.append('COMMERCIAL', 'PLAN_SWITCHED', { planId });
  }

  public getMetrics(): CommercialMetrics {
    const totalTasks = this.tasksCompleted + this.tasksFailed;
    const rate = totalTasks > 0 ? (this.tasksCompleted / totalTasks) * 100 : 0;
    
    // Cloud API cost is strictly 0 because 100% sovereign
    const cloudApiCostUsd = 0.00;
    // Native compute cost: approximate $0.000002 per token equivalent
    const nativeComputeCostUsd = +(this.totalTokens * 0.000002).toFixed(4);
    const revenue = this.simulatedRevenue;
    const grossMargin = revenue > 0 ? +(((revenue - nativeComputeCostUsd) / revenue) * 100).toFixed(2) : 0;

    return {
      currentPhase: this.currentPhase,
      activeTenantId: this.activeTenantId,
      activePlanId: this.activePlanId,
      tasksCompleted: this.tasksCompleted,
      tasksFailed: this.tasksFailed,
      taskCompletionRate: +rate.toFixed(1),
      totalTokensProcessed: this.totalTokens,
      cloudApiCostUsd,
      nativeComputeCostUsd,
      simulatedRevenueUsd: revenue,
      grossMarginPct: grossMargin,
      readinessChecklist: {
        product: {
          passed: false,
          evidence: totalTasks > 0 ? `Measured ${totalTasks} recorded workloads; release threshold is not yet certified.` : 'No benchmark-backed workload records are available yet.'
        },
        usability: {
          passed: false,
          evidence: 'Creation Studio workflows require end-to-end verification before usability is certified.'
        },
        nativeAi: {
          passed: false,
          evidence: 'Native cloud checkpoint and decoder readiness have not been certified by this commercial readiness check.'
        },
        security: {
          passed: false,
          evidence: 'Security release evidence has not been attached to this readiness checklist.'
        },
        reliability: {
          passed: false,
          evidence: 'Reliability and recovery thresholds have not yet been proven by the current release test suite.'
        },
        business: {
          passed: false,
          evidence: 'Revenue, infrastructure costs, and margin have not yet been measured from live tenant billing.'
        },
        support: {
          passed: false,
          evidence: 'Support readiness has not yet been assessed against a production service workflow.'
        }
      }
    };
  }
}
