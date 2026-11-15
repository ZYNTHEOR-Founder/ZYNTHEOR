/**
 * ZYNTHEOR Commercial & Business Manager
 * Manages the 3 Launch Phases: Private Beta, Public Beta, and Commercial Launch.
 * Enforces Tenant Quotas, Usage Metering, Zero-Cloud-Cost Economics, and Launch Readiness Checklist.
 */

import { AuditLedger } from './AuditLedger';

function configuredPrice(key: string): number | null {
  const raw = process.env[key];
  if (!raw || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export type LaunchPhase = 'PRIVATE_BETA' | 'PUBLIC_BETA' | 'COMMERCIAL_LAUNCH';

export interface CommercialPlan {
  id: string;
  name: string;
  monthlyPriceUsd: number | null;
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
  cloudApiCostUsd: number; // App-recorded external inference spend; excludes cloud infrastructure
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
  private activePlanId = 'tier_free';

  private tasksCompleted = 0;
  private tasksFailed = 0;
  private totalTokens = 0;
  private recordedRevenue = 0;

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
        'Native model capability subject to current verification status',
        'SHA-256 Audit Ledger',
        'Standard Tokenizer'
      ]
    },
    {
      id: 'tier_pro',
      name: 'Public Beta (Professional)',
      monthlyPriceUsd: configuredPrice('ZYNTHEOR_PRICE_PRO_USD'),
      dailyTaskLimit: 500,
      maxSandboxes: 5,
      maxMemorySlots: 500,
      slaTarget: '99.5% Native Uptime',
      features: [
        'Autonomous Reasoning & Tool Execution',
        'Self-Evolving Loop (Automated Evaluator)',
        'Unlimited File Inspect & Execution',
        'Persistent Cross-Session Memory',
        'Priority online execution gateway'
      ]
    },
    {
      id: 'tier_team',
      name: 'Commercial Enterprise (Sovereign Core)',
      monthlyPriceUsd: configuredPrice('ZYNTHEOR_PRICE_TEAM_USD'),
      dailyTaskLimit: 5000,
      maxSandboxes: 25,
      maxMemorySlots: 10000,
      slaTarget: '99.99% Sovereign SLA',
      features: [
        'Multi-tenant Virtual Isolation',
        'Hardware Checkpoint Encryption',
        'Custom Architecture Fine-Tuning Delta',
        'Dedicated sovereign cloud environment (when provisioned)',
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
      cloudCostUsd: 0.00
    });
  }

  public setPhase(phase: LaunchPhase): void {
    this.currentPhase = phase;
    AuditLedger.append('COMMERCIAL', 'LAUNCH_PHASE_CHANGED', { phase });
  }

  public setPlan(planId: string): void {
    if (!CommercialManager.PLANS.some((plan) => plan.id === planId)) throw new Error('Unknown commercial plan');
    this.activePlanId = planId;
    AuditLedger.append('COMMERCIAL', 'PLAN_SWITCHED', { planId });
  }

  public getMetrics(): CommercialMetrics {
    const totalTasks = this.tasksCompleted + this.tasksFailed;
    const rate = totalTasks > 0 ? (this.tasksCompleted / totalTasks) * 100 : 0;
    
    // No external inference spend is recorded by this application; infrastructure and network costs are excluded.
    const cloudApiCostUsd = 0.00;
    // Cost and revenue remain zero until cloud-cost metering and payment-ledger integrations are connected.
    const nativeComputeCostUsd = 0;
    const revenue = this.recordedRevenue;
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
          evidence: `Only ${totalTasks} application-recorded tasks; production workload validation is not yet established.`
        },
        usability: {
          passed: false,
          evidence: 'Usability testing with representative external users has not been recorded.'
        },
        nativeAi: {
          passed: false,
          evidence: 'Model quality and learned-generation benchmarks are not yet sufficient to claim launch readiness.'
        },
        security: {
          passed: false,
          evidence: 'Independent production security assessment is not attached to this build.'
        },
        reliability: {
          passed: false,
          evidence: 'Production SLO, recovery drills, and audit-ledger integrity remediation are not yet verified.'
        },
        business: {
          passed: false,
          evidence: 'No payment ledger, realized revenue, or fully allocated cloud compute cost is connected; margin is not measurable.'
        },
        support: {
          passed: false,
          evidence: 'Support operations, incident response, and customer-facing service levels are not yet operationally verified.'
        }
      }
    };
  }
}
