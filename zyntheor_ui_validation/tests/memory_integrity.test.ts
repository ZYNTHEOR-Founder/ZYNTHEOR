/**
 * ZYNTHEOR Memory, Retrieval & Split Integrity Test Suite
 *
 * Zero-Simulation Enforcement:
 * 1. Verifies retrieval queries do not contain target answer values (both in KnowledgeWorkspace
 *    lexical retrieval and KnowledgeIntelligenceEngine hybrid retrieval + benchmark query flows).
 * 2. Prevents overlapping train / evaluation data samples via normalized content-hash deduplication
 *    and fail-closed split overlap enforcement in KnowledgeWorkspace.curateDataset and
 *    assertDisjointTrainEvalSamples.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RetrievalQueryLeakageError,
  TrainEvalOverlapError,
  assertDisjointTrainEvalSamples,
  assertRetrievalQueryNoTargetLeakage,
  contentHash,
  detectRetrievalQueryLeakage,
  normalizeIntegrityText,
} from '../lib/knowledgeUtils';
import { KnowledgeWorkspace, CuratedDatasetItem } from '../lib/KnowledgeWorkspace';
import { KnowledgeIntelligenceEngine } from '../lib/KnowledgeIntelligenceEngine';
import { NativeMemoryController } from '../lib/NativeMemoryController';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✔ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`✖ ${name}: ${err?.message || err}`);
    failed++;
  }
}

async function runMemoryIntegrityTests(): Promise<void> {
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyntheor-memory-integrity-'));

  try {
    // Isolate all file-backed singletons (KnowledgeWorkspace, KnowledgeIntelligenceEngine, NativeMemoryController)
    process.chdir(tmpDir);

    const kw = KnowledgeWorkspace.getInstance();
    const kie = KnowledgeIntelligenceEngine.getInstance();
    const mem = NativeMemoryController.getInstance();

    console.log('\n======================================================');
    console.log('  ZYNTHEOR MEMORY & RETRIEVAL INTEGRITY TEST SUITE    ');
    console.log('======================================================\n');

    // ------------------------------------------------------------------
    // 1. Retrieval Query Target-Answer Leakage Detection & Rejection
    // ------------------------------------------------------------------
    check('1. detectRetrievalQueryLeakage allows clean non-leaking queries', () => {
      const res = detectRetrievalQueryLeakage(
        'What Transformer attention head count and hidden dimension does ZYNTHEOR specify?',
        ['41,527,808', '51296', 'timingSafeEqual', 'พจนานุกรมขนาด 16,384 โทเค็น']
      );
      assert.equal(res.leaked, false);
      assert.deepEqual(res.matchedTargets, []);
    });

    check('2. detectRetrievalQueryLeakage avoids false-positive numeric substring collisions', () => {
      const res = detectRetrievalQueryLeakage(
        'Explain the 51296 parameter checkpoint architecture',
        ['12', '512']
      );
      assert.equal(res.leaked, false);
    });

    check('3. assertRetrievalQueryNoTargetLeakage rejects exact, case-folded, whitespace-shifted, and Thai targets', () => {
      const targetAnswers = ['41,527,808', 'timingSafeEqual', 'พจนานุกรมขนาด 16,384 โทเค็น', 51296];

      assert.throws(
        () => assertRetrievalQueryNoTargetLeakage('Verify whether param budget equals 41,527,808', targetAnswers),
        RetrievalQueryLeakageError
      );
      assert.throws(
        () => assertRetrievalQueryNoTargetLeakage('Check TIMINGSAFEEQUAL signature verification', targetAnswers),
        RetrievalQueryLeakageError
      );
      assert.throws(
        () => assertRetrievalQueryNoTargetLeakage('Query with extra   spaces   and 51296 target', targetAnswers),
        RetrievalQueryLeakageError
      );
      assert.throws(
        () => assertRetrievalQueryNoTargetLeakage('ตรวจสอบ พจนานุกรมขนาด 16,384 โทเค็น ในเอกสาร', targetAnswers),
        RetrievalQueryLeakageError
      );
    });

    // Ingest dedicated evaluation documents with known ground-truth answers
    const evalFixtures = [
      {
        title: 'Sovereign Quantum Scheduler Spec',
        collection: 'EvaluationCorpus',
        query: 'Which cryptographic hash algorithm seals ledger blocks in Sovereign Scheduler?',
        targetAnswer: 'BLAKE3-XOF-256',
        content:
          'Sovereign Quantum Scheduler Architecture.\n\n' +
          'Ledger blocks in the Sovereign Quantum Scheduler are sealed using the BLAKE3-XOF-256 hash algorithm with strict monotonic sequence counters.\n\n' +
          'Execution stages operate under fail-closed isolation inside the container boundary.',
      },
      {
        title: 'Bilingual Telemetry Calibration Protocol',
        collection: 'EvaluationCorpus',
        query: 'What validation temperature range is allowed during epistemic calibration?',
        targetAnswer: '0.20 to 4.00 Kelvin-equivalent scale',
        content:
          'Bilingual Telemetry Calibration Protocol.\n\n' +
          'Temperature scaling fits T strictly on held-out validation logits within the 0.20 to 4.00 Kelvin-equivalent scale to minimize NLL.\n\n' +
          'Test splits are never consulted during temperature fitting.',
      },
      {
        title: 'Thai Reasoning Benchmark Reference',
        collection: 'EvaluationCorpus',
        query: 'เกณฑ์ความคลาดเคลื่อนสูงสุดของ Gradient Check ในระบบคือเท่าใด?',
        targetAnswer: '1e-4 relative tolerance',
        content:
          'มาตรฐานการตรวจสอบอนุพันธ์ย้อนกลับ (Gradient Verification Standard).\n\n' +
          'การตรวจสอบอนุพันธ์เชิงตัวเลข (Finite Difference Gradient Check) ต้องมีค่าความคลาดเคลื่อนไม่เกิน 1e-4 relative tolerance ในทุกพารามิเตอร์',
      },
    ];

    for (const fx of evalFixtures) {
      kw.createDocument({
        title: fx.title,
        content: fx.content,
        collection: fx.collection,
        provenance: 'First-party evaluation fixture',
        curatedForTraining: false,
      });
    }
    const allTargetAnswers = evalFixtures.map((f) => f.targetAnswer);

    check('4. Benchmark retrieval queries contain zero target answer values and retrieve grounded evidence', () => {
      for (const fx of evalFixtures) {
        // Verify query itself never contains its own or any held-out target answer
        assertRetrievalQueryNoTargetLeakage(fx.query, allTargetAnswers);

        const lexicalHits = kw.retrieve(fx.query, {
          collection: 'EvaluationCorpus',
          forbiddenTargetValues: allTargetAnswers,
          limit: 3,
        });
        assert.ok(lexicalHits.length > 0, `Expected lexical hits for query: ${fx.query}`);

        const hybridResp = kie.hybridRetrieve(fx.query, {
          collection: 'EvaluationCorpus',
          forbiddenTargetValues: allTargetAnswers,
          limit: 3,
          minScore: 1.0,
        });
        assert.equal(hybridResp.found, true, `Expected hybrid retrieval match for: ${fx.query}`);
        assert.ok(hybridResp.results[0].citation.contentHash.length === 64);
      }
    });

    check('5. KnowledgeWorkspace.retrieve and KnowledgeIntelligenceEngine.hybridRetrieve fail closed when query leaks target answer', () => {
      assert.throws(
        () =>
          kw.retrieve('Does Sovereign Quantum Scheduler use BLAKE3-XOF-256?', {
            collection: 'EvaluationCorpus',
            forbiddenTargetValues: allTargetAnswers,
          }),
        /FAIL_CLOSED/
      );

      assert.throws(
        () =>
          kie.hybridRetrieve('Confirm validation temperature 0.20 to 4.00 Kelvin-equivalent scale', {
            collection: 'EvaluationCorpus',
            forbiddenTargetValues: allTargetAnswers,
          }),
        /FAIL_CLOSED/
      );
    });

    check('6. Episodic memory queries preserve answer isolation against held-out targets', () => {
      mem.storeMemory('session_obs_1', {
        prompt: evalFixtures[0].query,
        observedDomain: 'EvaluationCorpus',
      }, 'reasoning_trace');

      const stored = mem.retrieveMemory('session_obs_1');
      assert.ok(stored !== null);
      assertRetrievalQueryNoTargetLeakage(String(stored!.value.prompt), allTargetAnswers);

      // Simulate constructing a retrieval query from memory value
      const memHits = mem.queryMemories('Sovereign Scheduler', 'reasoning_trace');
      assert.ok(memHits.length >= 1);
      for (const item of memHits) {
        assertRetrievalQueryNoTargetLeakage(JSON.stringify(item.value), allTargetAnswers);
      }
    });

    // ------------------------------------------------------------------
    // 2. Overlapping Train / Evaluation Sample Prevention
    // ------------------------------------------------------------------
    check('7. assertDisjointTrainEvalSamples passes on genuinely disjoint train/eval sets', () => {
      const res = assertDisjointTrainEvalSamples(
        [
          { id: 'tr_1', text: 'Causal self-attention masks future tokens across time steps.' },
          { id: 'tr_2', text: 'SwiGLU gating combines SiLU activation with element-wise multiplication.' },
        ],
        [
          { id: 'ev_1', text: 'Temperature scaling calibrates validation NLL without weight updates.' },
          { id: 'ev_2', text: 'Finite differences validate analytical gradient accuracy.' },
        ]
      );
      assert.equal(res.disjoint, true);
      assert.equal(res.trainCount, 2);
      assert.equal(res.evalCount, 2);
    });

    check('8. assertDisjointTrainEvalSamples rejects exact, whitespace/case-normalized, and ID overlaps', () => {
      assert.throws(
        () =>
          assertDisjointTrainEvalSamples(
            [{ id: 'tr_1', text: 'Shared training sample text' }],
            [{ id: 'ev_1', text: 'Shared training sample text' }]
          ),
        TrainEvalOverlapError
      );

      assert.throws(
        () =>
          assertDisjointTrainEvalSamples(
            [{ id: 'tr_1', text: 'RoPE rotary embeddings encode relative position.' }],
            [{ id: 'ev_1', text: '  rope   ROTARY embeddings encode relative position.  ' }]
          ),
        TrainEvalOverlapError
      );

      assert.throws(
        () =>
          assertDisjointTrainEvalSamples(
            [{ id: 'dup_id_99', text: 'Distinct train text A' }],
            [{ id: 'dup_id_99', text: 'Distinct eval text B' }]
          ),
        TrainEvalOverlapError
      );
    });

    check('9. KnowledgeWorkspace.curateDataset deduplicates exact & near-duplicate chunks and enforces zero train/val/eval overlap', () => {
      // Create multi-paragraph distinct documents plus exact and case/whitespace-variant duplicates
      const splitDocs: string[] = [];
      for (let i = 0; i < 6; i++) {
        const doc = kw.createDocument({
          title: `Disjoint Corpus Document ${i}`,
          collection: 'SplitCurationTest',
          provenance: 'First-party unit test corpus',
          content:
            `Section ${i}.1: Independent architectural invariant specification for module alpha-${i} with unique seed token ZYN_${i}_A.\n\n` +
            `Section ${i}.2: Detailed verification criterion beta-${i} asserting zero cross-split duplication token ZYN_${i}_B.`,
        });
        splitDocs.push(doc.id);
      }

      // Inject an exact duplicate AND a whitespace/casing-normalized duplicate of Document 0
      const exactDupDoc = kw.createDocument({
        title: 'Exact Duplicate Corpus Document',
        collection: 'SplitCurationTest',
        provenance: 'First-party unit test corpus',
        content:
          'Section 0.1: Independent architectural invariant specification for module alpha-0 with unique seed token ZYN_0_A.\n\n' +
          'Section 0.2: Detailed verification criterion beta-0 asserting zero cross-split duplication token ZYN_0_B.',
      });
      const nearDupDoc = kw.createDocument({
        title: 'Whitespace/Case Variant Duplicate Document',
        collection: 'SplitCurationTest',
        provenance: 'First-party unit test corpus',
        content:
          '  SECTION 0.1:   Independent architectural invariant specification for module alpha-0 with unique seed token ZYN_0_A.  \n\n' +
          '  section 0.2:   Detailed verification criterion beta-0 asserting zero cross-split duplication token ZYN_0_B.  ',
      });

      const manifest = kw.curateDataset(
        'Leakage-Free Split Test Corpus',
        [...splitDocs, exactDupDoc.id, nearDupDoc.id],
        { train: 0.5, val: 0.25, eval: 0.25 }
      );

      // Should have only 6 unique chunks (6 docs * 1 merged chunk each) — duplicates excluded
      assert.equal(manifest.totalSamples, 6, `Expected 6 deduplicated chunks, got ${manifest.totalSamples}`);

      const detail = kw.getDatasetDetail(manifest.datasetId);
      assert.ok(detail && Array.isArray(detail.items), 'Expected persisted dataset detail JSON');

      const items: CuratedDatasetItem[] = detail.items;
      const trainItems = items.filter((i) => i.split === 'train');
      const valItems = items.filter((i) => i.split === 'val');
      const evalItems = items.filter((i) => i.split === 'eval');

      assert.ok(trainItems.length > 0 && evalItems.length > 0, 'Expected non-empty train and eval splits');

      // Assert zero overlap across all split pairs by content hash & ID
      assertDisjointTrainEvalSamples(trainItems, evalItems);
      assertDisjointTrainEvalSamples(trainItems, valItems);
      assertDisjointTrainEvalSamples(valItems, evalItems);

      // Independently verify normalized SHA-256 sets are strictly disjoint
      const trainHashSet = new Set(trainItems.map((i) => contentHash(normalizeIntegrityText(i.text))));
      const evalHashSet = new Set(evalItems.map((i) => contentHash(normalizeIntegrityText(i.text))));
      for (const h of evalHashSet) {
        assert.equal(trainHashSet.has(h), false, 'Found overlapping sample hash between train and eval splits');
      }
    });

    console.log('\n======================================================');
    console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runMemoryIntegrityTests().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
