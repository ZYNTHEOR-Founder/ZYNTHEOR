/**
 * useSelfEvaluation — Native Model Reasoning Chain Verification & Confidence Calibration
 *
 * Connects strictly to real ZYNTHEOR evaluation & citation verification APIs:
 *   POST /api/evaluation/self-evaluate     — grounding, citations, contradiction, uncertainty, attribution
 *   GET  /api/evaluation/history           — historical evaluation records
 *   POST /api/knowledge/verify-citations   — independent citation hash & snippet verification
 *
 * Zero Simulation Policy: never fabricates verification scores or calibration metrics.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/apiClient';

export type ErrorClassification =
  | 'NONE'
  | 'SYNTAX'
  | 'RUNTIME'
  | 'GROUNDING'
  | 'CONTRADICTION'
  | 'SECURITY'
  | 'BUDGET'
  | 'UNCERTAINTY';

export interface SelfEvaluationCitationInput {
  documentId: string;
  chunkId?: string;
  snippet?: string;
  contentHash?: string;
}

export interface SelfEvaluationReport {
  evalId: string;
  timestamp: string;
  query: string;
  errorClass: ErrorClassification;
  passed: boolean;
  checks: {
    factualGrounding: boolean;
    citationCorrectness: boolean;
    logicalConsistency: boolean;
    contradictionFree: boolean;
    uncertaintyCalibrated: boolean;
  };
  scores: {
    groundingRate: number;
    citationCorrectnessRate: number;
    claimedConfidence: number;
    empiricalAccuracy: number;
    calibrationError: number;
  };
  attribution: {
    nativeModelScore: number | null;
    orchestratorScore: number;
    knowledgeRetrievalScore: number;
  };
  contradictions: Array<{ reason: string; confidence: number }>;
  regressionDetected: boolean;
  regressionDetail?: string;
}

export interface CalibrationSummary {
  sampleCount: number;
  meanClaimedConfidence: number | null;
  meanEmpiricalAccuracy: number | null;
  expectedCalibrationError: number | null;
  overconfidentCount: number;
  abstentionTriggeredCount: number;
  regressionCount: number;
  wellCalibrated: boolean | null;
}

export interface VerifyReasoningInput {
  query: string;
  answer: string;
  thought?: string;
  citations?: SelfEvaluationCitationInput[];
  claimedConfidence?: number;
  nativeModelPerplexity?: number | null;
  orchestratorSuccess?: boolean;
}

export function computeConfidenceCalibration(records: SelfEvaluationReport[]): CalibrationSummary {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      sampleCount: 0,
      meanClaimedConfidence: null,
      meanEmpiricalAccuracy: null,
      expectedCalibrationError: null,
      overconfidentCount: 0,
      abstentionTriggeredCount: 0,
      regressionCount: 0,
      wellCalibrated: null,
    };
  }

  let sumConf = 0;
  let sumAcc = 0;
  let sumEce = 0;
  let overconfidentCount = 0;
  let abstentionTriggeredCount = 0;
  let regressionCount = 0;

  for (const r of records) {
    const conf = Number(r.scores?.claimedConfidence ?? 0);
    const acc = Number(r.scores?.empiricalAccuracy ?? 0);
    const err = Math.abs(conf - acc);
    sumConf += conf;
    sumAcc += acc;
    sumEce += err;
    if (conf - acc > 0.2) overconfidentCount += 1;
    if (r.errorClass === 'UNCERTAINTY' || !r.checks?.uncertaintyCalibrated) {
      abstentionTriggeredCount += 1;
    }
    if (r.regressionDetected) regressionCount += 1;
  }

  const n = records.length;
  const meanClaimedConfidence = Number((sumConf / n).toFixed(3));
  const meanEmpiricalAccuracy = Number((sumAcc / n).toFixed(3));
  const expectedCalibrationError = Number((sumEce / n).toFixed(3));

  return {
    sampleCount: n,
    meanClaimedConfidence,
    meanEmpiricalAccuracy,
    expectedCalibrationError,
    overconfidentCount,
    abstentionTriggeredCount,
    regressionCount,
    wellCalibrated: expectedCalibrationError <= 0.15,
  };
}

export function useSelfEvaluation(autoLoad = true) {
  const { authHeaders, authReady, isAuthenticated } = useAuth();
  const [history, setHistory] = useState<SelfEvaluationReport[]>([]);
  const [latestEvaluation, setLatestEvaluation] = useState<SelfEvaluationReport | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(
    async (limit = 30) => {
      if (!authReady || !isAuthenticated) return [];
      setIsLoadingHistory(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(`/api/evaluation/history?limit=${limit}`), {
          headers: authHeaders(),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Failed to load evaluation history (${res.status})`);
        }
        const rows = Array.isArray(data.history) ? (data.history as SelfEvaluationReport[]) : [];
        setHistory(rows);
        if (rows.length > 0 && !latestEvaluation) {
          setLatestEvaluation(rows[0]);
        }
        return rows;
      } catch (err: any) {
        setError(err?.message || 'Failed to load evaluation history');
        return [];
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [authReady, isAuthenticated, authHeaders, latestEvaluation]
  );

  useEffect(() => {
    if (autoLoad && authReady && isAuthenticated) {
      void loadHistory();
    }
  }, [autoLoad, authReady, isAuthenticated, loadHistory]);

  /**
   * Verifies a Native Model reasoning chain + output against ground truth / citations
   * and calibrates confidence via the server-side SelfEvaluationEngine.
   */
  const verifyReasoningOutput = useCallback(
    async (input: VerifyReasoningInput): Promise<SelfEvaluationReport> => {
      setIsEvaluating(true);
      setError(null);
      try {
        // Combine reasoning thought + answer if present so contradictions in reasoning chains are surfaced
        const combinedOutput = input.thought?.trim()
          ? `${input.thought.trim()}\n\n${input.answer}`
          : input.answer;

        const res = await fetch(apiUrl('/api/evaluation/self-evaluate'), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            query: input.query,
            answer: combinedOutput,
            citations: input.citations || [],
            claimedConfidence: input.claimedConfidence,
            nativeModelPerplexity: input.nativeModelPerplexity ?? null,
            orchestratorSuccess: input.orchestratorSuccess,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success || !data.evaluation) {
          throw new Error(data.error || `Self-evaluation failed (${res.status})`);
        }
        const evaluation = data.evaluation as SelfEvaluationReport;
        setLatestEvaluation(evaluation);
        setHistory((prev) => [evaluation, ...prev].slice(0, 50));
        return evaluation;
      } catch (err: any) {
        const msg = err?.message || 'Self-evaluation failed';
        setError(msg);
        throw err;
      } finally {
        setIsEvaluating(false);
      }
    },
    [authHeaders]
  );

  const verifyCitations = useCallback(
    async (answer: string, citations: SelfEvaluationCitationInput[]) => {
      const res = await fetch(apiUrl('/api/knowledge/verify-citations'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ answer, citations }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Citation verification failed (${res.status})`);
      }
      return data.verification as {
        verified: boolean;
        citationCorrectnessRate: number;
        answerGroundingRate: number;
        validCitations: number;
        invalidCitations: Array<{ documentId: string; reason: string }>;
      };
    },
    [authHeaders]
  );

  const [cognitiveEvaluation, setCognitiveEvaluation] = useState<any | null>(null);
  const [isRunningCognitiveEval, setIsRunningCognitiveEval] = useState(false);

  const loadCognitiveEvaluation = useCallback(async () => {
    if (!authReady || !isAuthenticated) return null;
    try {
      const res = await fetch(apiUrl('/api/cognitive/evaluation'), {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCognitiveEvaluation(data.report || null);
        return data.report || null;
      }
      return null;
    } catch {
      return null;
    }
  }, [authReady, isAuthenticated, authHeaders]);

  const runCognitiveEvaluation = useCallback(async () => {
    setIsRunningCognitiveEval(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/cognitive/evaluation'), {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Cognitive evaluation failed (${res.status})`);
      }
      setCognitiveEvaluation(data.report);
      return data.report;
    } catch (err: any) {
      const msg = err?.message || 'Cognitive evaluation failed';
      setError(msg);
      throw err;
    } finally {
      setIsRunningCognitiveEval(false);
    }
  }, [authHeaders]);

  const calibration = useMemo(() => computeConfidenceCalibration(history), [history]);

  return {
    history,
    latestEvaluation,
    calibration,
    cognitiveEvaluation,
    isRunningCognitiveEval,
    isEvaluating,
    isLoadingHistory,
    error,
    loadHistory,
    verifyReasoningOutput,
    verifyCitations,
    loadCognitiveEvaluation,
    runCognitiveEvaluation,
  };
}
