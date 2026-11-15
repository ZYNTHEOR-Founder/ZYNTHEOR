#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 28 — Python Reasoning & Real PureSeqLM Continuous Training Tests
Zero Simulation Policy:
  - Tests real AST symbolic math, constraint scheduling, code AST analysis,
    objective candidate scoring, real PureSeqLM AdamW weight updates,
    held-out NLL regression gate rejection, and SHA-256 tamper detection.
"""

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
                "ZYNTHEOR Autonomous Planning Engine enforces strict resource budgets and human approval before model release."
            ]

            res_pass = run_versioned_training({
                "dataset_version": "ds_test_v1",
                "dataset_sha256": "a" * 64,
                "train_texts": corpus,
                "val_texts": val_corpus,
                "steps": 8,
                "lr": 0.03,
                "margin": -0.5,
                "seed": 42,
                "candidate_checkpoint_path": cand_pass,
            })
            self.assertEqual(res_pass["status"], "CANDIDATE_READY")
            self.assertTrue(res_pass["regression_passed"])
            self.assertGreater(res_pass["training"]["tokens_processed"], 0)
            self.assertTrue(os.path.exists(cand_pass))
            self.assertEqual(len(res_pass["candidate_checkpoint_sha256"]), 64)

            # Integrity check passes on valid file
            int_ok = verify_checkpoint_integrity_file(cand_pass)
            self.assertTrue(int_ok["valid"])
            self.assertEqual(int_ok["sha256"], res_pass["candidate_checkpoint_sha256"])

            # Tamper last byte -> integrity check fails closed
            with open(cand_pass, "r+b") as f:
                f.seek(-1, os.SEEK_END)
                b = f.read(1)
                f.seek(-1, os.SEEK_END)
                f.write(bytes([b[0] ^ 0xFF]))

            int_tampered = verify_checkpoint_integrity_file(cand_pass)
            self.assertFalse(int_tampered["valid"])

            # Impossible regression margin fails closed and does NOT write candidate file
            res_fail = run_versioned_training({
                "dataset_version": "ds_test_v2",
                "dataset_sha256": "b" * 64,
                "train_texts": corpus,
                "val_texts": val_corpus,
                "steps": 4,
                "lr": 0.01,
                "margin": 99.0,
                "seed": 42,
                "candidate_checkpoint_path": cand_fail,
            })
            self.assertEqual(res_fail["status"], "REJECTED_REGRESSION_GATE")
            self.assertFalse(res_fail["regression_passed"])
            self.assertFalse(os.path.exists(cand_fail))


if __name__ == "__main__":
    unittest.main()
