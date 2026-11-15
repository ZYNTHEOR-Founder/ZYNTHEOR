#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 28 — Python Reasoning & Real PureSeqLM Continuous Training Tests
Zero Simulation Policy:
  - Tests real AST symbolic math, constraint scheduling, code AST analysis,
    objective candidate scoring, real PureSeqLM AdamW weight updates,
    held-out NLL regression gate rejection, and SHA-256 tamper detection.
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from qplus_native.batch28_reasoning import (
    evaluate_alternative_solutions,
    reason_over_python_code,
    solve_dependency_and_budget_constraints,
    verify_multistep_math,
)
from qplus_native.batch28_train import (
    run_versioned_training,
    verify_checkpoint_integrity_file,
)
from qplus_native.domain_benchmark import run_domain_benchmark


def dataset_hash(train_texts, val_texts, test_texts):
    payload = {
        "trainSamples": train_texts,
        "valSamples": val_texts,
        "testSamples": test_texts,
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


class Batch28ReasoningTests(unittest.TestCase):
    def test_verify_multistep_math_valid_and_invalid_claims(self):
        ok_res = verify_multistep_math(
            steps=[
                {"expr": "2 + 3", "claimed": 5},
                {"expr": "5 * 4", "claimed": 20},
            ],
            expected_final=20,
        )
        self.assertTrue(ok_res["verified"])
        self.assertEqual(ok_res["final_value"], 20.0)

        bad_claim = verify_multistep_math(
            steps=[{"expr": "2 + 2", "claimed": 5}],
            expected_final=4,
        )
        self.assertFalse(bad_claim["verified"])
        self.assertFalse(bad_claim["steps"][0]["valid"])

        unsafe = verify_multistep_math(
            steps=[{"expr": "__import__('os').system('echo pwn')", "claimed": 0}],
        )
        self.assertFalse(unsafe["verified"])

    def test_solve_constraints_dag_cycle_and_budget(self):
        valid = solve_dependency_and_budget_constraints(
            tasks=[
                {"id": "t_test", "cost": 3, "priority": 3, "depends_on": ["t_build"]},
                {"id": "t_plan", "cost": 1, "priority": 1, "depends_on": []},
                {"id": "t_build", "cost": 4, "priority": 2, "depends_on": ["t_plan"]},
            ],
            max_total_cost=10.0,
        )
        self.assertTrue(valid["satisfiable"])
        self.assertEqual(valid["schedule"], ["t_plan", "t_build", "t_test"])
        self.assertEqual(valid["total_cost"], 8.0)

        cyclic = solve_dependency_and_budget_constraints(
            tasks=[
                {"id": "a", "cost": 1, "priority": 1, "depends_on": ["b"]},
                {"id": "b", "cost": 1, "priority": 1, "depends_on": ["a"]},
            ],
            max_total_cost=10.0,
        )
        self.assertFalse(cyclic["satisfiable"])
        self.assertIn("Cyclic", cyclic["reason"])

        over_budget = solve_dependency_and_budget_constraints(
            tasks=[{"id": "heavy", "cost": 15, "priority": 1, "depends_on": []}],
            max_total_cost=5.0,
        )
        self.assertFalse(over_budget["satisfiable"])
        self.assertIn("Budget", over_budget["reason"])

    def test_reason_code_ast_repair_and_syntax(self):
        unsafe = reason_over_python_code("def run(x):\n    return eval(x)\n")
        self.assertTrue(unsafe["syntax_valid"])
        self.assertFalse(unsafe["safe"])
        self.assertIn("eval", unsafe["unsafe_calls"])
        self.assertTrue(len(unsafe["repair_hints"]) >= 1)

        bad_syntax = reason_over_python_code("def broken(:\n  pass\n")
        self.assertFalse(bad_syntax["syntax_valid"])
        self.assertFalse(bad_syntax["safe"])

        clean = reason_over_python_code("def add(a: int, b: int) -> int:\n    return a + b\n")
        self.assertTrue(clean["syntax_valid"])
        self.assertTrue(clean["safe"])
        self.assertEqual(clean["functions"], ["add"])

    def test_evaluate_alternatives_fail_closed_safety(self):
        ranked = evaluate_alternative_solutions(
            [
                {"id": "unsafe_fast", "tests_passed": 5, "tests_total": 5, "latency_ms": 10, "safety_passed": False, "constraints_satisfied": True},
                {"id": "safe_balanced", "tests_passed": 5, "tests_total": 5, "latency_ms": 50, "safety_passed": True, "constraints_satisfied": True},
                {"id": "safe_partial", "tests_passed": 3, "tests_total": 5, "latency_ms": 20, "safety_passed": True, "constraints_satisfied": True},
            ]
        )
        self.assertEqual(ranked["selected"], "safe_balanced")

        all_unsafe = evaluate_alternative_solutions(
            [{"id": "bad", "tests_passed": 5, "tests_total": 5, "safety_passed": False, "constraints_satisfied": True}]
        )
        self.assertIsNone(all_unsafe["selected"])

    def test_reasoning_cli_stdin_json(self):
        script = os.path.join(ROOT, "qplus_native", "batch28_reasoning.py")
        proc = subprocess.run(
            ["python3", "-B", script],
            input=json.dumps({
                "op": "verify_math",
                "steps": [{"expr": "(10 + 2) * 5", "claimed": 60}],
                "expected_final": 60,
            }),
            text=True,
            capture_output=True,
            check=True,
        )
        parsed = json.loads(proc.stdout)
        self.assertTrue(parsed["verified"])
        self.assertEqual(parsed["final_value"], 60.0)


class Batch28ContinuousTrainingTests(unittest.TestCase):
    def test_real_pureseq_training_regression_gate_and_tamper_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            cand_pass = os.path.join(tmp, "cand_pass.pt")
            cand_fail = os.path.join(tmp, "cand_fail.pt")
            corpus = [
                "ZYNTHEOR Autonomous Planning Engine validates DAG dependencies and enforces strict resource budgets before tool calls.",
                "ZYNTHEOR Continuous Learning runs held-out validation benchmarks and blocks model release without human approval.",
                "ZYNTHEOR Security Governance verifies SHA-256 checkpoint integrity and seals every state mutation in AuditLedger.",
            ]
            val_corpus = [
                "ZYNTHEOR Autonomous Planning Engine enforces strict resource budgets and human approval before model release.",
                "ZYNTHEOR validation data checks learned next-token behavior on an independent second sample.",
            ]
            test_corpus = [
                "ZYNTHEOR Native checkpoint test data remains disjoint and measures held-out next-token performance.",
                "ZYNTHEOR independent test samples measure generalization without entering optimizer updates.",
            ]
            data_hash = dataset_hash(corpus, val_corpus, test_corpus)

            undersized_path = os.path.join(tmp, "undersized.pt")
            undersized = run_versioned_training({
                "dataset_version": "ds_single_sample_holdout",
                "train_texts": corpus,
                "val_texts": val_corpus[:1],
                "test_texts": test_corpus,
                "steps": 2,
                "candidate_checkpoint_path": undersized_path,
            })
            self.assertEqual(undersized["status"], "FAILED")
            self.assertIn("at least 2 samples", undersized["reason"])
            self.assertFalse(os.path.exists(undersized_path))

            res_pass = run_versioned_training({
                "dataset_version": "ds_test_v1",
                "dataset_sha256": data_hash,
                "train_texts": corpus,
                "val_texts": val_corpus,
                "test_texts": test_corpus,
                "steps": 8,
                "lr": 0.03,
                "margin": -0.5,
                "test_margin": 100.0,
                "seed": 42,
                "candidate_checkpoint_path": cand_pass,
            })
            self.assertEqual(res_pass["status"], "CANDIDATE_TRAINED")
            self.assertTrue(res_pass["regression_passed"])
            self.assertTrue(res_pass["test_gate_passed"])
            self.assertTrue(res_pass["inference_verified"])
            self.assertEqual(res_pass["checkpoint_lifecycle"], "TRAINED")
            self.assertEqual(res_pass["benchmark_status"], "NOT_RUN")
            self.assertEqual(res_pass["resume_mode"], "fresh")
            self.assertGreater(res_pass["training"]["tokens_processed"], 0)
            self.assertEqual(res_pass["training"]["optimizer_steps"], 8)
            self.assertGreater(res_pass["training"]["changed_weight_count"], 0)
            self.assertNotEqual(
                res_pass["training"]["weights_before_sha256"],
                res_pass["training"]["weights_after_sha256"],
            )
            self.assertGreater(res_pass["training"]["max_abs_weight_delta"], 0.0)
            self.assertEqual(res_pass["quality_gate_status"], "PASS")
            self.assertEqual(res_pass["storage_mode"], "LOCAL_CANDIDATE_ONLY")
            self.assertEqual(len(res_pass["run_id"]), 32)
            self.assertTrue(res_pass["created_at"].endswith("Z"))
            self.assertEqual(len(res_pass["parameter_delta_sha256"]), 64)
            self.assertTrue(os.path.exists(cand_pass))
            self.assertEqual(len(res_pass["candidate_checkpoint_sha256"]), 64)
            self.assertEqual(len(res_pass["candidate_checkpoint_file_sha256"]), 64)
            self.assertTrue(os.path.isfile(cand_pass + ".manifest.json"))
            self.assertTrue(os.path.isfile(cand_pass + ".resume.json"))

            domain_report = run_domain_benchmark({
                "checkpoint_path": cand_pass,
                "dataset_version": "ds_test_v1",
                "dataset_sha256": data_hash,
                "train_texts": corpus,
                "val_texts": val_corpus,
                "test_texts": test_corpus,
            })
            self.assertEqual(domain_report["schema"], "ZYNTHEOR_NATIVE_DOMAIN_BENCHMARK_V1")
            self.assertEqual(domain_report["status"], "BLOCKED")
            self.assertEqual(domain_report["summary"]["total"], 10)
            self.assertEqual(domain_report["summary"]["not_implemented"], 4)
            self.assertEqual(domain_report["general_text_test"]["status"], "MEASURED")
            self.assertTrue(domain_report["inference"]["deterministic_parity"])
            self.assertFalse(domain_report["readiness_accepted"])

            # Integrity check passes on valid file
            int_ok = verify_checkpoint_integrity_file(cand_pass)
            self.assertTrue(int_ok["valid"])
            self.assertEqual(int_ok["sha256"], res_pass["candidate_checkpoint_sha256"])
            self.assertEqual(int_ok["checkpoint_lifecycle"], "TRAINED")
            self.assertTrue(int_ok["resume_state_valid"])
            self.assertEqual(int_ok["quality_gate_status"], "PASS")
            self.assertEqual(int_ok["training_storage_backend"], "LOCAL_CANDIDATE_ONLY")
            self.assertEqual(int_ok["parameter_delta_sha256"], res_pass["parameter_delta_sha256"])
            self.assertEqual(int_ok["run_id"], res_pass["run_id"])
            self.assertEqual(int_ok["created_at"], res_pass["created_at"])

            resumed_path = os.path.join(tmp, "resumed.pt")
            res_resume = run_versioned_training({
                "dataset_version": "ds_test_v1_resume",
                "dataset_sha256": data_hash,
                "train_texts": corpus,
                "val_texts": val_corpus,
                "test_texts": test_corpus,
                "steps": 2,
                "lr": 0.03,
                "margin": -0.5,
                "test_margin": 100.0,
                "seed": 42,
                "baseline_checkpoint_path": cand_pass,
                "resume_training": True,
                "candidate_checkpoint_path": resumed_path,
            })
            self.assertEqual(res_resume["status"], "CANDIDATE_TRAINED")
            self.assertEqual(res_resume["resume_mode"], "exact")
            self.assertEqual(res_resume["training"]["steps_completed"], 10)
            self.assertEqual(res_resume["training"]["optimizer_steps"], 10)
            self.assertGreater(res_resume["training"]["changed_weight_count"], 0)

            uninterrupted_path = os.path.join(tmp, "uninterrupted.pt")
            uninterrupted = run_versioned_training({
                "dataset_version": "ds_test_v1_uninterrupted",
                "dataset_sha256": data_hash,
                "train_texts": corpus,
                "val_texts": val_corpus,
                "test_texts": test_corpus,
                "steps": 10,
                "lr": 0.03,
                "margin": -0.5,
                "test_margin": 100.0,
                "seed": 42,
                "candidate_checkpoint_path": uninterrupted_path,
            })
            self.assertEqual(uninterrupted["status"], "CANDIDATE_TRAINED")
            self.assertEqual(
                res_resume["training"]["weights_after_sha256"],
                uninterrupted["training"]["weights_after_sha256"],
            )

            incompatible_path = os.path.join(tmp, "incompatible.pt")
            mismatched_resume = run_versioned_training({
                "dataset_version": "ds_test_mismatch",
                "train_texts": corpus,
                "val_texts": val_corpus,
                "test_texts": [
                    "Different and disjoint test text detects resume data mismatches.",
                    "A second test sample confirms that changed held-out data is incompatible.",
                ],
                "steps": 2,
                "lr": 0.03,
                "margin": -0.5,
                "test_margin": 100.0,
                "seed": 42,
                "baseline_checkpoint_path": cand_pass,
                "resume_training": True,
                "candidate_checkpoint_path": incompatible_path,
            })
            self.assertEqual(mismatched_resume["status"], "INCOMPATIBLE")
            self.assertIn("fingerprint mismatch", mismatched_resume["reason"])
            self.assertFalse(os.path.exists(incompatible_path))

            # Tamper last byte -> integrity check fails closed
            with open(cand_pass, "r+b") as f:
                f.seek(-1, os.SEEK_END)
                b = f.read(1)
                f.seek(-1, os.SEEK_END)
                f.write(bytes([b[0] ^ 0xFF]))

            int_tampered = verify_checkpoint_integrity_file(cand_pass)
            self.assertFalse(int_tampered["valid"])

            # Quality rejection preserves a structurally valid, non-promotable candidate.
            res_fail = run_versioned_training({
                "dataset_version": "ds_test_v2",
                "dataset_sha256": data_hash,
                "train_texts": corpus,
                "val_texts": val_corpus,
                "test_texts": test_corpus,
                "steps": 4,
                "lr": 0.01,
                "margin": 99.0,
                "test_margin": 100.0,
                "seed": 42,
                "candidate_checkpoint_path": cand_fail,
            })
            self.assertEqual(res_fail["status"], "REJECTED_VALIDATION_GATE")
            self.assertFalse(res_fail["regression_passed"])
            self.assertTrue(os.path.isfile(cand_fail))
            self.assertTrue(res_fail["candidate_checkpoint_id"])
            self.assertEqual(res_fail["checkpoint_lifecycle"], "TRAINED")
            self.assertEqual(res_fail["quality_gate_status"], "REJECTED_VALIDATION_GATE")
            self.assertTrue(res_fail["inference_verified"])
            fail_integrity = verify_checkpoint_integrity_file(cand_fail)
            self.assertTrue(fail_integrity["valid"])
            self.assertTrue(fail_integrity["resume_state_valid"])
            self.assertEqual(fail_integrity["quality_gate_status"], "REJECTED_VALIDATION_GATE")
            self.assertEqual(fail_integrity["checkpoint_lifecycle"], "TRAINED")
            import qplus_native.model as native_model_module
            previous_memory_path = native_model_module.MEMORY_STORE_PATH
            native_model_module.MEMORY_STORE_PATH = os.path.join(tmp, "isolated-runtime-memory.json")
            try:
                with open(cand_fail, "rb") as checkpoint_stream:
                    rejected_runtime = native_model_module.NativeNeuralModel(
                        cloud_bytes=checkpoint_stream.read()
                    )
                self.assertTrue(rejected_runtime.weights_loaded)
                self.assertTrue(rejected_runtime.execution_verified)
                self.assertTrue(rejected_runtime.trained_provenance)
                self.assertFalse(rejected_runtime.quality_gate_passed)
                self.assertEqual(rejected_runtime.runtime_state, "QUALITY_BLOCKED")
            finally:
                native_model_module.MEMORY_STORE_PATH = previous_memory_path

            fail_report = run_domain_benchmark({
                "checkpoint_path": cand_fail,
                "dataset_version": "ds_test_v2",
                "dataset_sha256": data_hash,
                "train_texts": corpus,
                "val_texts": val_corpus,
                "test_texts": test_corpus,
            })
            self.assertEqual(fail_report["status"], "BLOCKED")
            self.assertEqual(fail_report["quality_gate"]["status"], "REJECTED_VALIDATION_GATE")
            self.assertFalse(fail_report["readiness_accepted"])


if __name__ == "__main__":
    unittest.main()
