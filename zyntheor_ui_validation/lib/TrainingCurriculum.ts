/**
 * ZYNTHEOR 7-Phase Model Training & Continuation Curriculum
 *
 * Implements the structured 7-phase progression aligned with Zero Simulation Policy:
 *   Phase 1 — Existing Model Continuation (checkpoint inspection, weight loading, optimizer state check, step continuation)
 *   Phase 2 — Language Foundation (Thai, English, bilingual code-switching, semantics, context, grammar, multi-turn)
 *   Phase 3 — Knowledge & Science (Mathematics, Science, Engineering, General Knowledge, Data Analysis)
 *   Phase 4 — Reasoning & Problem Solving (Step-by-step CoT, Planning, CSP, Answer Verification, Learning from Errors)
 *   Phase 5 — Software & Technical Intelligence (Code reading, Programming, Debugging, API & Web, Software Testing)
 *   Phase 6 — Autonomous Execution (Goal-to-Plan, Tool Use, Execution, Verification, Self-Repair & Delivery)
 *   Phase 7 — Continuous Improvement (Real evaluation, harvesting errors, curating new data, evidence-backed retraining)
 */

import { ContinuousLearningPipeline, type ContinuousLearningRunRecord } from './ContinuousLearningPipeline';
import { SelfEvaluationEngine } from './SelfEvaluationEngine';
import { ActionDrivenEngine } from './ActionDrivenEngine';
import { KnowledgeWorkspace } from './KnowledgeWorkspace';
import type { SovereignRole } from './SovereignIdentity';

export type TrainingPhaseId =
  | 'phase_1_continuation'
  | 'phase_2_language'
  | 'phase_3_knowledge_science'
  | 'phase_4_reasoning'
  | 'phase_5_software_tech'
  | 'phase_6_autonomous_execution'
  | 'phase_7_continuous_improvement';

export interface TrainingPhaseDefinition {
  id: TrainingPhaseId;
  order: number;
  titleEn: string;
  titleTh: string;
  descriptionEn: string;
  descriptionTh: string;
  focusAreas: string[];
  recommendedSteps: number;
  recommendedLr: number;
  curatedCorpus: string[];
}

export const TRAINING_PHASES: TrainingPhaseDefinition[] = [
  {
    id: 'phase_1_continuation',
    order: 1,
    titleEn: 'Phase 1 — Existing Model Continuation',
    titleTh: 'Phase 1 — ต่อยอดจาก Checkpoint เดิม',
    descriptionEn: 'Inspect existing checkpoint, load real weights, verify PureAdamW optimizer & scheduler state, and continue training from the latest verified step.',
    descriptionTh: 'ตรวจ Checkpoint เดิม โหลด Weight จริง ตรวจ Optimizer State และฝึกต่อจาก Step ล่าสุดที่ยืนยันได้',
    focusAreas: ['Checkpoint SHA-256 Verification', 'PureAdamW Optimizer State', 'Scheduler & RNG Restoration', 'Verified Step Continuation'],
    recommendedSteps: 12,
    recommendedLr: 0.02,
    curatedCorpus: [
      'ZYNTHEOR Checkpoint Continuation reloads verified float32 parameters and checks SHA-256 integrity before optimizer updates.',
      'PureAdamW optimizer preserves first and second moment tensors along with step counter t inside the resume sidecar bundle.',
      'Exponential learning rate scheduler restores completed_steps and base_lr cleanly so continuation matches uninterrupted runs.',
      'การต่อยอดการฝึกโมเดลต้องตรวจสอบสถานะ Checkpoint เดิม ค่า Optimizer Moment และ Random Seed ก่อนคำนวณ Gradient รอบใหม่เสมอ',
      'Disjoint train, validation, and held-out test splits enforce Zero Simulation integrity across every continuation checkpoint.',
      'When switching curriculum phases, weights_only continuation retains prior_training_steps while recording cumulative_training_steps.',
      'Reloaded checkpoints undergo seeded greedy generation parity testing to confirm deterministic inference from learned weights.',
      'AuditLedger records checkpoint SHA-256, weight delta hashes, and optimizer provenance for every continuation run.',
    ],
  },
  {
    id: 'phase_2_language',
    order: 2,
    titleEn: 'Phase 2 — Language Foundation',
    titleTh: 'Phase 2 — รากฐานภาษาไทย อังกฤษ และสองภาษา',
    descriptionEn: 'Train Thai, English, and bilingual code-switching fluency, lexical semantics, context preservation, grammar, and multi-turn conversation.',
    descriptionTh: 'ฝึกภาษาไทย ภาษาอังกฤษ และการเข้าใจสองภาษาผสมกัน รวมถึงความหมาย บริบท ไวยากรณ์ และการสนทนาหลายรอบ',
    focusAreas: ['Thai Script & Grammar', 'English Precision', 'Bilingual Code-Switching', 'Multi-Turn Dialogue Context'],
    recommendedSteps: 16,
    recommendedLr: 0.025,
    curatedCorpus: [
      'ภาษาไทยที่มีโครงสร้างชัดเจนช่วยให้อ่านเข้าใจง่าย เช่น ประธาน กริยา กรรม และคำเชื่อมที่รักษาบริบทของการสนทนาได้อย่างต่อเนื่อง',
      'English technical prose requires clear subject-verb agreement, concise terminology, and coherent paragraph transitions.',
      'Bilingual Turn 1: ผู้ใช้ถามว่า How does context window attention preserve multi-turn dialogue state across turns?',
      'Bilingual Turn 2: ระบบอธิบายว่า Attention mechanism ถ่วงน้ำหนักความสัมพันธ์ของ Token ก่อนหน้ากับคำถามปัจจุบันอย่างแม่นยำ',
      'Thai Context Calibration: การตีความหมายคำพ้องรูปต้องพิจารณาประโยครอบข้างและเจตนาของผู้ถามก่อนสรุปคำตอบเสมอ',
      'Multi-turn Dialogue Rule: Maintain entity references and user constraints from earlier turns without fabricating unstated facts.',
      'ไวยากรณ์และระดับภาษาที่เหมาะสมในภาษาไทยช่วยเชื่อมโยงคำอธิบายเชิงเทคนิคเข้ากับบริบททางธุรกิจได้อย่างเป็นธรรมชาติ',
      'Cross-lingual semantic alignment maps Thai concepts such as ความปลอดภัยของข้อมูล directly to technical English terms like Data Sovereignty.',
      'Conversation Continuity: Summarize prior decisions accurately in both ภาษาไทย and English when switching languages mid-session.',
    ],
  },
  {
    id: 'phase_3_knowledge_science',
    order: 3,
    titleEn: 'Phase 3 — Knowledge & Science',
    titleTh: 'Phase 3 — ความรู้ วิทยาศาสตร์ คณิตศาสตร์ และวิศวกรรม',
    descriptionEn: 'Expand capabilities in mathematics, physics/chemistry/biology, engineering systems, general knowledge, and quantitative data analysis.',
    descriptionTh: 'เพิ่มความสามารถด้านคณิตศาสตร์ วิทยาศาสตร์ วิศวกรรม ความรู้ทั่วไป และการวิเคราะห์ข้อมูล',
    focusAreas: ['Applied Mathematics', 'Natural Sciences', 'Systems Engineering', 'Quantitative Data Analysis'],
    recommendedSteps: 16,
    recommendedLr: 0.022,
    curatedCorpus: [
      'Mathematics Derivative Rule: For f(x) = 3x^2 + 4x, the first derivative is f\'(x) = 6x + 4 and second derivative f\'\'(x) = 6.',
      'Classical Mechanics Conservation: Kinetic energy equals 0.5 * m * v^2 and mechanical energy stays conserved without friction losses.',
      'วิศวกรรมระบบและสถาปัตยกรรมซอฟต์แวร์: การคำนวณ Throughput และ Tail Latency P99 ต้องวัดจาก Request จริงภายใต้โหลดงานที่ควบคุมได้',
      'Thermodynamics & Chemistry: Entropy in an isolated system increases monotonically, and reaction equilibrium depends on Gibbs free energy.',
      'Data Analysis Principle: Compare mean versus median alongside interquartile range before concluding that a distribution improved.',
      'การวิเคราะห์ข้อมูลเชิงปริมาณ: ต้องแยกความสัมพันธ์แบบ Correlation ออกจาก Causation ด้วยการทดลองแบบควบคุมตัวแปร',
      'Engineering Tolerance: Calculate safety margin ratios explicitly using worst-case load divided by rated structural capacity.',
      'Cross-Entropy & Information Theory: Perplexity equals exp(NLL) while Bits-Per-Byte measures compression efficiency across UTF-8 bytes.',
    ],
  },
  {
    id: 'phase_4_reasoning',
    order: 4,
    titleEn: 'Phase 4 — Reasoning & Problem Solving',
    titleTh: 'Phase 4 — การคิดเป็นขั้นตอน แก้ปัญหา และตรวจคำตอบ',
    descriptionEn: 'Train step-by-step reasoning, structured planning, constraint satisfaction, answer verification, and learning from detected mistakes.',
    descriptionTh: 'ฝึกคิดเป็นขั้นตอน วางแผน แก้ปัญหา ตรวจคำตอบ และเรียนรู้จากข้อผิดพลาด',
    focusAreas: ['Step-by-Step CoT', 'DAG & Budget Constraints', 'Answer Self-Verification', 'Error Diagnosis & Revision'],
    recommendedSteps: 16,
    recommendedLr: 0.022,
    curatedCorpus: [
      'Step-by-Step Reasoning: Step 1 decompose variables, Step 2 compute intermediate values, Step 3 verify equality against expected final value.',
      'Constraint Satisfaction Problem: Topological DAG ordering schedules prerequisite tasks strictly before dependent milestones under budget limits.',
      'การแก้ปัญหาอย่างเป็นระบบ: เมื่อคำตอบไม่ตรงกับสมมติฐาน ให้ย้อนตรวจสอบทีละขั้นเพื่อระบุจุดที่คำนวณพลาดก่อนปรับแผนใหม่',
      'Answer Verification Protocol: Never emit a high-confidence answer without citing grounded evidence or passing symbolic arithmetic checks.',
      'Alternative Solution Ranking: Filter out unsafe or constraint-violating candidates first, then rank verified candidates by pass rate and latency.',
      'การเรียนรู้จากข้อผิดพลาด: บันทึกสาเหตุของข้อผิดพลาดเป็น Error Classification เช่น SYNTAX, GROUNDING หรือ UNCERTAINTY เพื่อใช้ปรับปรุงรอบถัดไป',
      'Deductive Consistency: If premise A implies B and evidence falsifies B, then premise A cannot hold under logical soundness.',
      'Cycle Detection Guard: Before executing a multi-stage plan DAG, verify in-degree zero progression eliminates circular dependencies.',
    ],
  },
  {
    id: 'phase_5_software_tech',
    order: 5,
    titleEn: 'Phase 5 — Software & Technical Intelligence',
    titleTh: 'Phase 5 — วิศวกรรมซอฟต์แวร์ โค้ด Debug และทดสอบระบบ',
    descriptionEn: 'Train code comprehension, programming, debugging, REST API & web system architecture, and automated software testing.',
    descriptionTh: 'ฝึกอ่านโค้ด เขียนโปรแกรม Debug สร้างระบบ API เว็บไซต์ และทดสอบซอฟต์แวร์',
    focusAreas: ['Code Reading & AST', 'TypeScript & Python Engineering', 'Root-Cause Debugging', 'API Design & Automated Tests'],
    recommendedSteps: 18,
    recommendedLr: 0.022,
    curatedCorpus: [
      'Code Reading & AST Safety: Reject dynamic eval or exec calls during static Python AST inspection and emit deterministic repair hints.',
      'REST API Engineering: Validate request schemas early, enforce Bearer token RBAC middleware, and return explicit HTTP 4xx/5xx error codes.',
      'การ Debug ระบบอย่างมีระบบ: อ่าน Stack Trace ระบุบรรทัดที่เกิด Exception ตรวจสอบ State ก่อนและหลัง Function แล้วเขียน Regression Test กำกับ',
      'Full-Stack React & Express: Keep secret keys on the backend server only, proxy external calls through /api routes, and sanitize user input.',
      'Automated Testing Discipline: Isolate persistent state directories in temporary folders and assert both positive behavior and fail-closed errors.',
      'การออกแบบฐานข้อมูลและ API: ใช้ Transaction หรือ Atomic rename write เพื่อป้องกันไฟล์หรือข้อมูลเสียหายเมื่อเกิด Crash ระหว่างเขียน',
      'TypeScript Strict Typing: Define explicit interfaces for pipeline payloads and verify compilation with tsc --noEmit and vite build.',
      'Web Security Hardening: Enforce tenantId isolation on every document, memory item, and training run query inside server handlers.',
    ],
  },
  {
    id: 'phase_6_autonomous_execution',
    order: 6,
    titleEn: 'Phase 6 — Autonomous Execution',
    titleTh: 'Phase 6 — การวางแผน ใช้เครื่องมือ ตรวจสอบ และส่งมอบงานอัตโนมัติ',
    descriptionEn: 'Train goal-to-plan decomposition, structured tool invocation, sandbox execution, output verification, self-repair, and delivery packaging.',
    descriptionTh: 'ฝึกแปลงเป้าหมายเป็นแผน ใช้เครื่องมือ ดำเนินงาน ตรวจสอบผล และแก้ไขจนส่งมอบงานได้',
    focusAreas: ['Goal-to-Plan DAG', 'RBAC Tool Invocation', 'Sandbox Execution Verification', 'Self-Repair & SHA-256 Delivery'],
    recommendedSteps: 18,
    recommendedLr: 0.022,
    curatedCorpus: [
      'Autonomous Execution Cycle: 01 Perception -> 02 Reasoning -> 03 DAG Plan -> 04 Tool Execution -> 05 Sandbox Verify -> 06 Self-Repair -> 08 Deliver.',
      'Goal-to-Plan Translation: Convert user goals into bounded DAG steps with explicit acceptance criteria and least-privilege tool permissions.',
      'การดำเนินงานด้วยเครื่องมืออัตโนมัติ: ทุก Tool Call ต้องผ่าน ToolRegistry RBAC และบันทึก Exit Code พร้อม Execution Evidence Hash',
      'Verification Before Delivery: Compile source files, run unit tests inside the isolated workspace sandbox, and verify exit code equals zero.',
      'Deterministic Self-Repair Loop: Capture stderr diagnostics on test failure, restore clean snapshot if needed, patch defects, and re-run suite.',
      'การส่งมอบงานที่น่าเชื่อถือ: ห้ามรายงานว่างานสำเร็จหากขั้นตอนทดสอบล้มเหลวหรือยังไม่มีหลักฐานยืนยันจาก Sandbox จริง',
      'Human Approval Boundary: High-impact operations such as production model release or deletion require ApprovalGate sign-off.',
      'Deliverable Packaging: Compute SHA-256 hashes over generated artifacts and seal completion provenance inside AuditLedger.',
    ],
  },
  {
    id: 'phase_7_continuous_improvement',
    order: 7,
    titleEn: 'Phase 7 — Continuous Improvement',
    titleTh: 'Phase 7 — ประเมินผลจริง เก็บข้อผิดพลาด คัดข้อมูลใหม่ และฝึกปรับปรุงที่มีหลักฐาน',
    descriptionEn: 'Run real evaluations, harvest genuine execution/eval errors, curate sanitized datasets, and retrain with before-vs-after evidence.',
    descriptionTh: 'ประเมินผลจริง เก็บข้อผิดพลาด คัดข้อมูลใหม่ และปรับปรุงโมเดลผ่านรอบฝึกที่มีหลักฐาน',
    focusAreas: ['Empirical Failure Harvesting', 'PII Scrubbing & Curation', 'Evidence-Backed Retraining', 'Before/After Promotion Gate'],
    recommendedSteps: 16,
    recommendedLr: 0.02,
    curatedCorpus: [
      'Continuous Improvement Cycle: Evaluate live outputs against held-out benchmarks, harvest real failure modes, and curate clean corrective pairs.',
      'Privacy & Deduplication Filter: Scrub emails, Bearer tokens, and secrets before freezing any harvested error trace into versioned datasets.',
      'การปรับปรุงโมเดลอย่างต่อเนื่อง: เก็บ Log ข้อผิดพลาดจริงจากการทำงานและการประเมินผล มาคัดกรองและฝึกซ้ำโดยวัด NLL ก่อน-หลังอย่างโปร่งใส',
      'Regression Gate Protection: Block candidate promotion automatically whenever validation NLL or held-out test NLL regresses past threshold.',
      'Human-in-the-Loop Release: Require verified domain evaluation and administrator ApprovalGate authorization prior to active checkpoint swap.',
      'Rollback Readiness: Archive the active checkpoint with verified SHA-256 backup so any post-release anomaly can roll back deterministically.',
      'Evidence Honesty Policy: Attribute improvements strictly to measured PureSeqLM weight deltas, optimizer steps, and sandbox test outcomes.',
    ],
  },
];

export function getPhaseDefinition(phaseId: string): TrainingPhaseDefinition | undefined {
  return TRAINING_PHASES.find((p) => p.id === phaseId);
}

export interface HarvestedErrorReport {
  tenantId: string;
  harvestedAt: string;
  sources: {
    actionFailures: number;
    actionRepairs: number;
    evaluationFailures: number;
    pipelineRejections: number;
  };
  harvestedErrorSamples: string[];
  supplementalKnowledgeSamples: string[];
  combinedSamples: string[];
  privacyRedactedCount: number;
}

export function harvestPhase7Errors(
  tenantId: string,
  scope?: { userId?: string; role?: SovereignRole }
): HarvestedErrorReport {
  const pipe = ContinuousLearningPipeline.getInstance();
  const evalEngine = SelfEvaluationEngine.getInstance();
  const actionEngine = ActionDrivenEngine.getInstance();
  const kw = KnowledgeWorkspace.getInstance();

  const rawErrorSamples: string[] = [];
  let actionFailures = 0;
  let actionRepairs = 0;
  let evaluationFailures = 0;
  let pipelineRejections = 0;

  // 1. Harvest failed or repaired ActionDrivenEngine missions for this tenant & caller scope
  try {
    const missions = actionEngine.listMissions({
      tenantId,
      userId: scope?.userId || 'system_curriculum',
      role: scope?.role || 'developer',
    });
    for (const m of missions) {
      if (m.status !== 'DELIVERED') {
        actionFailures += 1;
        rawErrorSamples.push(
          `Execution Failure Case (${m.mode}): Goal="${m.goal}" failed reason="${m.failureReason || 'verification failed'}". Fix: Validate preconditions, syntax, and sandbox tests before delivery.`
        );
      }
      if (Array.isArray(m.repairHistory) && m.repairHistory.length > 0) {
        for (const r of m.repairHistory) {
          actionRepairs += 1;
          rawErrorSamples.push(
            `Self-Repair Trace (${m.mode}): Diagnosis "${r.diagnosis}" resolved="${String(r.resolved)}" via action="${r.actionTaken || r.failureReason || 'repair'}". Always verify post-repair exit code.`
          );
        }
      }
    }
  } catch {
    // ignore if unavailable
  }

  // 2. Harvest failing SelfEvaluationEngine checks
  try {
    const history = evalEngine.getHistory(50);
    for (const ev of history) {
      if (!ev.passed) {
        evaluationFailures += 1;
        rawErrorSamples.push(
          `Evaluation Error (${ev.errorClass}): Query="${ev.query}" scored accuracy=${ev.scores.empiricalAccuracy}. Rule: Cite grounded evidence and calibrate confidence accurately.`
        );
      }
    }
  } catch {
    // ignore
  }

  // 3. Harvest rejected or failed ContinuousLearningPipeline runs
  try {
    const runs = pipe.listRuns({ tenantId });
    for (const run of runs) {
      if (run.status.startsWith('REJECTED') || run.status === 'FAILED') {
        pipelineRejections += 1;
        rawErrorSamples.push(
          `Training Gate Diagnostic (${run.status}): Baseline val NLL=${run.baselineEval?.nll ?? 'n/a'} vs candidate=${run.candidateEval?.nll ?? 'n/a'}; reason="${run.error || run.qualityGateStatus}". Tune learning rate and clean held-out balance.`
        );
      }
    }
  } catch {
    // ignore
  }

  // Scrub PII and deduplicate harvested traces
  let totalRedacted = 0;
  const seen = new Set<string>();
  const cleanHarvested: string[] = [];
  for (const s of rawErrorSamples) {
    const { sanitized, redactedCount } = pipe.scrubPrivacyPii(s.trim());
    totalRedacted += redactedCount;
    const key = sanitized.toLowerCase();
    if (sanitized.length >= 60 && !seen.has(key)) {
      seen.add(key);
      cleanHarvested.push(sanitized);
    }
  }

  // Gather Phase 7 corrective curriculum + workspace knowledge docs if harvested errors alone < 8 samples
  const supplemental: string[] = [];
  if (cleanHarvested.length < 8) {
    const p7 = getPhaseDefinition('phase_7_continuous_improvement')!;
    for (const base of p7.curatedCorpus) {
      const key = base.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        supplemental.push(base);
      }
    }
    try {
      const docs = kw.listDocuments({ tenantId });
      for (const doc of docs.slice(0, 6)) {
        const line = `${doc.title}: ${doc.content.replace(/\s+/g, ' ').trim().slice(0, 280)}`;
        const { sanitized, redactedCount } = pipe.scrubPrivacyPii(line);
        totalRedacted += redactedCount;
        if (sanitized.length >= 60 && !seen.has(sanitized.toLowerCase())) {
          seen.add(sanitized.toLowerCase());
          supplemental.push(sanitized);
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    tenantId,
    harvestedAt: new Date().toISOString(),
    sources: {
      actionFailures,
      actionRepairs,
      evaluationFailures,
      pipelineRejections,
    },
    harvestedErrorSamples: cleanHarvested,
    supplementalKnowledgeSamples: supplemental,
    combinedSamples: [...cleanHarvested, ...supplemental],
    privacyRedactedCount: totalRedacted,
  };
}

export interface PhaseLiveStatus {
  phase: TrainingPhaseDefinition;
  status: 'VERIFIED' | 'TRAINED' | 'FAILED' | 'NOT_STARTED';
  runsCount: number;
  passedRunsCount: number;
  latestRun: ContinuousLearningRunRecord | null;
  bestValNll: number | null;
  latestPhaseVerification: Record<string, any> | null;
}

export function buildSevenPhaseStatus(
  tenantId: string,
  scope?: { userId?: string; role?: SovereignRole }
): {
  phases: PhaseLiveStatus[];
  summary: {
    verifiedCount: number;
    trainedCount: number;
    totalPhases: number;
    totalPipelineRuns: number;
    latestCheckpointPath: string | null;
    latestRunId: string | null;
  };
  harvestPreview: HarvestedErrorReport;
} {
  const pipe = ContinuousLearningPipeline.getInstance();
  const runs = pipe.listRuns({ tenantId });

  const phases: PhaseLiveStatus[] = TRAINING_PHASES.map((phase) => {
    const matching = runs.filter((r) => r.phaseId === phase.id);
    const passed = matching.filter((r) => r.regressionPassed && (r.status === 'TRAINED' || r.status === 'PROMOTED'));
    const latestRun = matching[0] || null;
    const latestVerified = matching.find((r) => r.phaseEvaluation?.status === 'PASS') || null;
    const valNlls = matching
      .map((r) => r.candidateEval?.nll)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    let status: PhaseLiveStatus['status'] = 'NOT_STARTED';
    if (latestVerified) status = 'VERIFIED';
    else if (passed.length > 0) status = 'TRAINED';
    else if (matching.length > 0 && latestRun?.status === 'FAILED') status = 'FAILED';
    else if (matching.length > 0) status = 'TRAINED';

    return {
      phase,
      status,
      runsCount: matching.length,
      passedRunsCount: passed.length,
      latestRun,
      bestValNll: valNlls.length > 0 ? Math.min(...valNlls) : null,
      latestPhaseVerification: latestRun?.phaseEvaluation || null,
    };
  });

  const latestIntact = runs.find(
    (r) => r.candidateCheckpointPath && (r.status === 'TRAINED' || r.status === 'PROMOTED')
  ) || null;

  return {
    phases,
    summary: {
      verifiedCount: phases.filter((p) => p.status === 'VERIFIED').length,
      trainedCount: phases.filter((p) => p.status === 'TRAINED' || p.status === 'VERIFIED').length,
      totalPhases: TRAINING_PHASES.length,
      totalPipelineRuns: runs.length,
      latestCheckpointPath: latestIntact?.candidateCheckpointPath || null,
      latestRunId: latestIntact?.runId || null,
    },
    harvestPreview: harvestPhase7Errors(tenantId, scope),
  };
}
