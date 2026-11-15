# -*- coding: utf-8 -*-
"""Evidence-gated benchmark manifest validation, scoring, and paired comparison.

No benchmark prompts/answers are bundled. This framework never executes generated code,
never trains on test tasks, and never labels model capability VERIFIED from a metric alone.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from qplus_native.dataset_governance import (SCHEMA_VERSION as PROVENANCE_SCHEMA,
    audit_splits, canonical_json, content_sha256, validate_document)

DOMAINS = ("thai_english_understanding", "mathematics", "science", "coding",
           "multi_step_reasoning", "planning", "self_correction")
SCORERS = {"exact_match", "normalized_exact_match", "contains", "human_rubric"}
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def task_document_text(task: Mapping[str, Any]) -> str:
    return json.dumps({"prompt": task.get("prompt", ""), "expected": task.get("expected", "")},
                      ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_benchmark_manifest(
    manifest: Mapping[str, Any],
    training_document_hashes: Iterable[str] = (),
    training_texts: Optional[Mapping[str, str]] = None,
    evidence_root: str = ".",
    approval_verifier=None,
) -> Dict[str, Any]:
    issues: List[str] = []
    if manifest.get("schema_version") != "zyntheor.benchmark.v1":
        issues.append("unsupported_benchmark_schema")
    if not isinstance(manifest.get("benchmark_id"), str) or not manifest.get("benchmark_id", "").strip():
        issues.append("benchmark_id_missing")
    tasks = manifest.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        issues.append("benchmark_tasks_missing")
        tasks = []
    ids, records, texts = set(), [], {}
    train_hashes = set(training_document_hashes)
    per_task = []
    for task in tasks:
        if not isinstance(task, dict):
            issues.append("task_record_not_object")
            continue
        tid = task.get("task_id")
        if not isinstance(tid, str) or not tid or tid in ids:
            issues.append("task_id_missing_or_duplicate")
        ids.add(tid)
        if task.get("domain") not in DOMAINS:
            issues.append(f"invalid_domain:{tid}")
        if task.get("split") != "test":
            issues.append(f"benchmark_task_must_be_test_only:{tid}")
        scorer = task.get("scorer")
        if scorer not in SCORERS:
            issues.append(f"unsupported_scorer:{tid}")
        if not isinstance(task.get("prompt"), str) or not task.get("prompt", "").strip():
            issues.append(f"prompt_missing:{tid}")
        if not isinstance(task.get("expected"), str):
            issues.append(f"expected_answer_missing:{tid}")
        doc_text = task_document_text(task)
        text_hash = content_sha256(doc_text)
        if text_hash in train_hashes or task.get("document_sha256") in train_hashes:
            issues.append(f"test_training_hash_overlap:{tid}")
        record = {k: task.get(k) for k in ("document_id", "document_sha256", "split", "source", "license", "rights", "approval", "evidence")}
        if not record.get("document_id"):
            record["document_id"] = tid
        if not record.get("document_sha256"):
            issues.append(f"task_document_hash_missing:{tid}")
        records.append(record)
        texts[str(record["document_id"])] = doc_text
        per_task.append(validate_document(record, doc_text, evidence_root, approval_verifier))
    present_domains = {t.get("domain") for t in tasks if isinstance(t, dict)}
    missing_domains = sorted(set(DOMAINS) - present_domains)
    if missing_domains:
        issues.append("missing_domains:" + ",".join(missing_domains))
    raw_threshold = manifest.get("near_duplicate_threshold", 0.90)
    if not isinstance(raw_threshold, (int, float)) or not 0.5 <= float(raw_threshold) <= 1.0:
        issues.append("near_duplicate_threshold_invalid")
        raw_threshold = 0.90
    threshold = float(raw_threshold)
    if training_texts is None:
        issues.append("reference_training_texts_required_for_near_duplicate_scan")
        leakage_records = records
        leakage_texts = texts
    else:
        leakage_records = [{"document_id": f"reference:{k}", "split": "train"} for k in training_texts] + records
        leakage_texts = {f"reference:{k}": v for k, v in training_texts.items()}
        leakage_texts.update(texts)
    leakage = audit_splits(leakage_records, leakage_texts, threshold) if leakage_records else {
        "status": "BLOCKED", "exact_duplicates": [], "cross_split_near_duplicates": [], "missing_splits": list(("test",)), "errors": []}
    if leakage["exact_duplicates"] or leakage["cross_split_near_duplicates"] or leakage["errors"]:
        issues.append("benchmark_duplicates_or_leakage_detected")
    if any(t.get("status") != "VERIFIED" for t in per_task):
        issues.append("benchmark_provenance_or_approval_not_verified")
    return {"status": "READY_FOR_EVALUATION" if not issues else "BLOCKED", "issues": issues,
            "task_count": len(tasks), "domains_present": sorted(present_domains), "missing_domains": missing_domains,
            "provenance": per_task, "split_audit": leakage,
            "manifest_sha256": hashlib.sha256(canonical_json(manifest)).hexdigest()}


def _normalize_answer(text: str) -> str:
    text = unicodedata.normalize("NFC", text).casefold()
    return " ".join(text.split())


def score_answer(scorer: str, expected: str, actual: str) -> Optional[bool]:
    if scorer == "exact_match":
        return actual == expected
    if scorer == "normalized_exact_match":
        return _normalize_answer(actual) == _normalize_answer(expected)
    if scorer == "contains":
        return _normalize_answer(expected) in _normalize_answer(actual)
    if scorer == "human_rubric":
        return None
    return None


def score_responses(manifest: Mapping[str, Any], responses: Mapping[str, str], manifest_validation: Mapping[str, Any],
                    *, checkpoint_sha256: Optional[str] = None,
                    runner_configuration: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Score supplied responses only after provenance gate; outputs are metrics, not capability certification."""
    if manifest_validation.get("status") != "READY_FOR_EVALUATION":
        return {"status": "BLOCKED", "reason": "benchmark manifest/provenance gate is not READY_FOR_EVALUATION",
                "metrics": {}, "manifest_sha256": manifest_validation.get("manifest_sha256")}
    if not isinstance(checkpoint_sha256, str) or not _SHA256_RE.fullmatch(checkpoint_sha256):
        return {"status": "BLOCKED", "reason": "checkpoint SHA-256 required for reproducible report", "metrics": {}}
    if not isinstance(runner_configuration, Mapping) or not runner_configuration:
        return {"status": "BLOCKED", "reason": "runner configuration required for reproducible report", "metrics": {}}
    runner_hash = hashlib.sha256(canonical_json(runner_configuration)).hexdigest()
    tasks = manifest.get("tasks", [])
    expected_ids = {t["task_id"] for t in tasks}
    if set(responses) != expected_ids or any(not isinstance(v, str) for v in responses.values()):
        return {"status": "BLOCKED", "reason": "response set must contain exactly one string per test task", "metrics": {}}
    scored = []
    for t in tasks:
        outcome = score_answer(t["scorer"], t.get("expected", ""), responses[t["task_id"]])
        scored.append({"task_id": t["task_id"], "domain": t["domain"], "score": outcome,
                       "review_required": t["scorer"] == "human_rubric"})
    metrics = {}
    for d in DOMAINS:
        vals = [x["score"] for x in scored if x["domain"] == d and x["score"] is not None]
        metrics[d] = {"n": len(vals), "accuracy": (sum(vals) / len(vals)) if vals else None}
    human_review = [x["task_id"] for x in scored if x["review_required"]]
    return {"status": "PARTIAL_HUMAN_REVIEW_REQUIRED" if human_review else "RESULTS_RECORDED_NOT_QUALITY_VERIFIED",
            "manifest_sha256": manifest_validation["manifest_sha256"], "checkpoint_sha256": checkpoint_sha256,
            "runner_configuration_sha256": runner_hash, "runner_configuration": dict(runner_configuration),
            "task_results": scored, "metrics": metrics, "test_data_used_for_training": False,
            "human_review_required": human_review,
            "note": "Metrics do not certify capability; human-rubric tasks remain unscored until a separate signed review is recorded."}


def compare_reports(before: Optional[Mapping[str, Any]], after: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Only compute paired deltas for matching manifests; never infer missing baseline values."""
    if not before or not after:
        return {"status": "BLOCKED", "reason": "before and after evaluation reports are both required", "deltas": {}}
    if before.get("manifest_sha256") != after.get("manifest_sha256"):
        return {"status": "BLOCKED", "reason": "benchmark manifest hashes differ", "deltas": {}}
    if not before.get("checkpoint_sha256") or not after.get("checkpoint_sha256"):
        return {"status": "BLOCKED", "reason": "checkpoint hashes are required", "deltas": {}}
    if not before.get("runner_configuration_sha256") or before.get("runner_configuration_sha256") != after.get("runner_configuration_sha256"):
        return {"status": "BLOCKED", "reason": "runner/configuration hashes are missing or differ", "deltas": {}}
    bmetrics, ametrics = before.get("metrics"), after.get("metrics")
    if not isinstance(bmetrics, dict) or not isinstance(ametrics, dict):
        return {"status": "BLOCKED", "reason": "metrics missing", "deltas": {}}
    deltas = {}
    for domain in DOMAINS:
        b = (bmetrics.get(domain) or {}).get("accuracy")
        a = (ametrics.get(domain) or {}).get("accuracy")
        if not isinstance(b, (float, int)) or not isinstance(a, (float, int)):
            return {"status": "BLOCKED", "reason": f"baseline or after metric missing for {domain}", "deltas": {}}
        deltas[domain] = float(a) - float(b)
    return {"status": "COMPARABLE_METRICS_NOT_QUALITY_VERIFIED", "manifest_sha256": before["manifest_sha256"],
            "deltas": deltas, "note": "Paired metric comparison only; not a VERIFIED capability claim."}


def empty_manifest_template() -> Dict[str, Any]:
    return {"schema_version": "zyntheor.benchmark.v1", "benchmark_id": "TODO-SET-BENCHMARK-ID", "near_duplicate_threshold": 0.90,
            "tasks": [], "status": "DRAFT", "required_domains": list(DOMAINS),
            "notes": "Draft only; insert externally sourced, licensed, hash-pinned and approved test tasks."}
