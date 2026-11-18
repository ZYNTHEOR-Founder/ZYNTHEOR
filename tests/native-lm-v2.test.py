# -*- coding: utf-8 -*-
"""Regression tests for the P0 contract fixes (v1) and the learned LM v2 (P1-P4)."""
import os
import re
import sys
import struct
import hashlib
import tempfile
import unittest
import array
import subprocess
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None  # type: ignore[assignment]
    HAS_NUMPY = False

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.corpus import build_corpus
from qplus_native.trainer import NativeTrainer
from qplus_native.engine import cross_entropy_loss_and_grad
from qplus_native.checkpoint import CheckpointManager
if HAS_NUMPY:
    from qplus_native.lm_v2 import NativeLM, LMConfig, real_vocab_size, V2_CHECKPOINT_PATH
else:
    V2_CHECKPOINT_PATH = os.path.join(ROOT, "native_data", "model_checkpoint_v2.pt")


def small_model(seed=3):
    m = NativeLM(LMConfig(vocab=40, d_model=16, n_layers=2, n_heads=4, d_ffn=24, ctx=8), seed=seed)
    rng = np.random.default_rng(0)
    for k in m.p:  # make gradients non-trivial
        m.p[k] = m.p[k] * 20 if m.p[k].ndim == 2 else m.p[k] + rng.normal(0, 0.1, m.p[k].shape)
    return m


class V1AttentionAndResume(unittest.TestCase):
    def test_v1_gradients_match_finite_difference_for_every_tensor(self):
        t = NativeTrainer()
        x, tgt = 7, 5

        def loss():
            return cross_entropy_loss_and_grad(t.forward_token(x)[0], tgt)[0]
        t.optimizer.zero_grad()
        lg, c = t.forward_token(x)
        _, d = cross_entropy_loss_and_grad(lg, tgt)
        t.backward_token(d, c)
        for p in t.parameters:
            for idx in range(0, p.size, max(1, p.size // 8)):
                g, o, e = p.grad[idx], p.data[idx], 1e-2
                p.data[idx] = o + e
                a = loss()
                p.data[idx] = o - e
                b = loss()
                p.data[idx] = o
                n = (a - b) / (2 * e)
                self.assertLess(abs(g - n), 2e-3 + 2e-2 * abs(n), f"grad mismatch in tensor shape {p.shape}")

    def test_v1_init_is_reproducible_across_processes(self):
        code = ("import sys;sys.path.insert(0,%r);from qplus_native.trainer import NativeTrainer;"
                "import hashlib;t=NativeTrainer();print(hashlib.sha256(bytes(t.get_flat_parameters().__repr__(),'utf8')).hexdigest())" % ROOT)
        outs = {subprocess.check_output([sys.executable, "-I", "-c", code], env={"PYTHONHASHSEED": s}).decode() for s in ("1", "2", "3")}
        self.assertEqual(len(outs), 1, "init must not depend on PYTHONHASHSEED")

    @unittest.skipUnless(os.path.isfile(CheckpointManager.get_paths()[0]), "verified v1 checkpoint is not included in this source package")
    def test_v1_trainer_resumes_exact_checkpoint_weights(self):
        path = CheckpointManager.get_paths()[0]
        t = NativeTrainer()
        info = t.load_from_checkpoint(path)
        with open(path, "rb") as f:
            f.read(17)
            ml = struct.unpack(">I", f.read(4))[0]
            f.read(ml)
            payload = f.read()
        flat = array.array("f", t.get_flat_parameters())
        self.assertEqual(flat.tobytes(), payload)
        self.assertEqual(info["loaded_params"], 231168)

    def test_v1_load_rejects_wrong_shape_checkpoint(self):
        t = NativeTrainer(d_model=64, d_ffn=128)
        with self.assertRaisesRegex(RuntimeError, "FAIL_CLOSED"):
            t.load_from_checkpoint(CheckpointManager.get_paths()[0])


@unittest.skipUnless(HAS_NUMPY, "numpy not installed in host python3")
class LMv2Math(unittest.TestCase):
    def test_every_tensor_gradient_matches_finite_difference(self):
        m = small_model()
        rng = np.random.default_rng(1)
        tok, tgt = rng.integers(0, 40, (3, 8)), rng.integers(0, 40, (3, 8))
        lg, c = m.forward(tok, True)
        _, dl = m.ce_loss(lg, tgt)
        g = m.backward(dl, c)

        def L():
            return m.ce_loss(m.forward(tok)[0], tgt)[0]
        for k, w in m.p.items():
            flat, gf = w.reshape(-1), g[k].reshape(-1)
            for i in rng.choice(flat.size, min(8, flat.size), replace=False):
                o, e = flat[i], 1e-5
                flat[i] = o + e
                a = L()
                flat[i] = o - e
                b = L()
                flat[i] = o
                n = (a - b) / (2 * e)
                self.assertLess(abs(n - gf[i]) / max(abs(n) + abs(gf[i]), 1e-8), 1e-5, k)

    def test_causality_future_tokens_do_not_change_past_logits(self):
        m = small_model()
        a = np.array([[1, 2, 3, 4, 5, 6, 7, 8]])
        b = a.copy()
        b[0, 5:] = [9, 9, 9]
        la, lb = m.forward(a)[0], m.forward(b)[0]
        np.testing.assert_allclose(la[0, :5], lb[0, :5], atol=1e-12)
        self.assertGreater(np.abs(la[0, 5:] - lb[0, 5:]).max(), 1e-6)

    def test_training_reduces_loss_on_toy_sequence(self):
        from qplus_native.lm_v2 import AdamW
        m = NativeLM(LMConfig(vocab=20, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=8), seed=1)
        opt = AdamW(m, lr=5e-3)
        seq = np.tile(np.arange(8), 4)[None, :9]
        x, y = seq[:, :8], seq[:, 1:9]
        first = None
        for _ in range(150):
            lg, c = m.forward(x, True)
            l, dl = m.ce_loss(lg, y)
            first = first if first is not None else l
            opt.step(m, m.backward(dl, c))
        self.assertLess(l, first * 0.2)


@unittest.skipUnless(HAS_NUMPY, "numpy not installed in host python3")
class LMv2Checkpoint(unittest.TestCase):
    def setUp(self):
        self.tok = SovereignTokenizer()
        self.m = NativeLM(LMConfig(vocab=real_vocab_size(self.tok), d_model=32, n_layers=1, n_heads=2, d_ffn=64, ctx=16), seed=5)
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "m.pt")
        self.m.save(self.path, self.tok)

    def test_roundtrip_and_inspector_verify(self):
        m2, meta = NativeLM.load(self.path, self.tok)
        x = np.array([[1, 5, 9, 20, 40]])
        np.testing.assert_allclose(self.m.forward(x)[0], m2.forward(x)[0], atol=1e-4)
        info = CheckpointManager.inspect_checkpoint(self.path)
        self.assertEqual(info["status"], "ACTIVE_TENSORS_VERIFIED")
        self.assertEqual(info["payload_float32_count"], self.m.num_params())

    def test_float32_loader_preserves_checkpoint_weights_for_low_memory_inference(self):
        m2, _ = NativeLM.load(self.path, self.tok, dtype=np.float32)
        self.assertTrue(all(param.dtype == np.float32 for param in m2.p.values()))
        x = np.array([[1, 5, 9, 20, 40]])
        expected = self.m.forward(x)[0]
        actual = m2.forward(x)[0]
        self.assertTrue(np.isfinite(actual).all())
        np.testing.assert_allclose(actual, expected, rtol=2e-4, atol=2e-4)

    def test_corrupted_payload_fails_closed(self):
        with open(self.path, "rb") as fh:
            raw = bytearray(fh.read())
        raw[-10] ^= 0xFF
        with open(self.path, "wb") as fh:
            fh.write(bytes(raw))
        with self.assertRaisesRegex(RuntimeError, "FAIL_CLOSED"):
            NativeLM.load(self.path, self.tok)

    def test_tokenizer_mismatch_fails_closed(self):
        other = SovereignTokenizer()
        other.id_to_token[100] = "ALTERED"
        with self.assertRaisesRegex(RuntimeError, "tokenizer vocabulary differs"):
            NativeLM.load(self.path, other)

    def test_generation_never_emits_control_or_filler_ids(self):
        out = self.m.generate_ids([1, 20, 30], max_new_tokens=40, temperature=1.0, top_k=0, seed=1)
        self.assertTrue(all(4 <= t < self.m.cfg.vocab for t in out))


class CorpusGovernance(unittest.TestCase):
    def test_split_is_by_document_without_leakage_and_excludes_tenant_secrets(self):
        c = build_corpus()
        ids = {d["split"]: {x["id"] for x in c["docs"] if x["split"] == d["split"]} for d in c["docs"]}
        self.assertFalse(ids["train"] & ids["val"])
        hashes = [d["sha256"] for d in c["docs"]]
        self.assertEqual(len(hashes), len(set(hashes)), "duplicate documents present")
        for d in c["docs"]:
            self.assertIsNone(re.search(r"TenantA Secret \d+", d["text"]))
            self.assertFalse(d["id"].startswith("knowledge:") and "Synthetic" in d["text"][:80])
        reasons = {e["id"]: e["reason"] for e in c["excluded"]}
        self.assertEqual(reasons.get("qplus_native/model.py"), "secret_like_literal")


@unittest.skipUnless(HAS_NUMPY, "numpy not installed in host python3")
class CorpusIngest(unittest.TestCase):
    def _make(self):
        import json, random
        words = "การ ตรวจ สอบ ระบบ ข้อมูล ภาษา ไทย โมเดล ฝึก ผล ทดสอบ ความ ถูก ต้อง เอกสาร".split()

        def thai(seed, n=120):
            r = random.Random(seed)
            return "".join(r.choice(words) for _ in range(n))
        d = tempfile.mkdtemp()

        def w(rel, txt):
            p = os.path.join(d, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w", encoding="utf-8").write(txt)
        a = thai(1)
        w("wiki/a.txt", a)
        w("wiki/a_copy.txt", a[:50] + "ฮ" + a[51:] + "ท")
        for i in range(2, 40):
            w(f"wiki/d{i}.txt", thai(i))
        w("wiki/short.txt", "สั้น")
        w("wiki/sec.txt", thai(90) + ' api_key = "abcdefghijklmnop1234"')
        w("wiki/mail.txt", thai(91) + " me@example.com")
        w("free/nolic.txt", thai(92))
        w("nope/x.txt", thai(93))
        json.dump([{"glob": "wiki/*", "source": "t", "license": "CC0", "language": "th"},
                   {"glob": "free/*", "source": "t", "license": "unknown"}], open(os.path.join(d, "SOURCES.json"), "w"))
        return d

    def test_fail_closed_exclusions_and_no_cross_split_near_duplicates(self):
        from qplus_native.corpus_ingest import ingest
        d = self._make()
        m = ingest(d, 30, 30)
        why = {e["id"]: e["reason"] for e in m["excluded"]}
        self.assertEqual(why["wiki/mail.txt"], "contains_email_address")
        self.assertEqual(why["wiki/sec.txt"], "secret_like_literal")
        self.assertEqual(why["wiki/short.txt"], "too_short")
        self.assertEqual(why["nope/x.txt"], "no_provenance_rule")
        self.assertEqual(why["free/nolic.txt"], "missing_or_unknown_license")
        sp = {x["id"]: x["split"] for x in m["docs"]}
        self.assertEqual(sp["wiki/a.txt"], sp["wiki/a_copy.txt"])
        self.assertEqual({x["split"] for x in m["docs"]}, {"train", "val", "test"})
        self.assertEqual(m["corpus_sha256"], ingest(d, 30, 30)["corpus_sha256"])

    def test_load_split_skips_changed_docs_and_logs_test_access(self):
        import json
        from qplus_native import corpus_ingest as ci
        d = self._make()
        m = ci.ingest(d, 30, 30)
        mp = os.path.join(d, "m.json")
        json.dump(m, open(mp, "w"))
        r = ci.load_split_docs(mp)
        self.assertEqual(r["skipped"], 0)
        self.assertEqual(len(r["train"]) + len(r["val"]) + len(r["test"]), len(m["docs"]))
        open(os.path.join(d, "wiki/d5.txt"), "a", encoding="utf-8").write("เปลี่ยนแปลง")
        self.assertEqual(ci.load_split_docs(mp)["skipped"], 1)
        old = ci.TEST_ACCESS_LOG
        ci.TEST_ACCESS_LOG = os.path.join(d, "log.json")
        try:
            self.assertEqual(ci.log_test_access("t", "x"), 1)
            self.assertEqual(ci.log_test_access("t", "y"), 2)
        finally:
            ci.TEST_ACCESS_LOG = old

    def test_missing_sources_file_fails_closed(self):
        from qplus_native.corpus_ingest import ingest
        with self.assertRaises(SystemExit):
            ingest(tempfile.mkdtemp())


class SafeExec(unittest.TestCase):
    def setUp(self):
        from qplus_native.safe_exec import Sandbox
        self.d = tempfile.mkdtemp()
        self.sb = Sandbox(self.d, timeout_s=3, max_output=300)
        os.environ["ZYN_TEST_SECRET"] = "must-not-leak"

    def refused(self, fn, *a):
        from qplus_native.safe_exec import PolicyError
        with self.assertRaises(PolicyError):
            fn(*a)

    def test_path_escape_symlink_and_secret_names_are_refused(self):
        self.refused(self.sb.read_file, "../etc/passwd")
        self.refused(self.sb.read_file, "/etc/passwd")
        self.refused(self.sb.write_file, ".env", "X=1")
        self.refused(self.sb.read_file, ".zyntheor/audit.jsonl")
        outside = tempfile.mkdtemp()
        with open(os.path.join(outside, "x.txt"), "w") as f:
            f.write("hi")
        os.symlink(outside, os.path.join(self.d, "link"))
        self.refused(self.sb.read_file, "link/x.txt")

    def test_write_snapshots_and_rollback_restores(self):
        self.assertIsNone(self.sb.write_file("a.txt", "v1"))
        snap = self.sb.write_file("a.txt", "v2")
        self.assertEqual(self.sb.read_file("a.txt"), "v2")
        self.sb.rollback(snap)
        self.assertEqual(self.sb.read_file("a.txt"), "v1")
        self.refused(self.sb.rollback, "../../x")

    def test_delete_needs_approval_and_is_recoverable(self):
        from qplus_native.safe_exec import Sandbox
        self.sb.write_file("a.txt", "keep")
        self.refused(self.sb.delete_file, "a.txt")
        self.assertTrue(os.path.exists(os.path.join(self.d, "a.txt")))
        sb2 = Sandbox(self.d, approve=lambda action, target: True)
        sb2.delete_file("a.txt")
        self.assertFalse(os.path.exists(os.path.join(self.d, "a.txt")))

    def test_only_allowlisted_argv_no_shell(self):
        self.refused(self.sb.run, ["ls"])
        self.refused(self.sb.run, "python3 -I x.py; rm -rf /")
        self.refused(self.sb.run, ["python3", "-c", "print(1)"])
        self.refused(self.sb.run, ["python3", "-I", "-c", "print(1)"])
        self.refused(self.sb.run, ["python3", "-I", "../x.py"])

    def test_run_scrubs_env_enforces_timeout_and_caps_output(self):
        self.sb.write_file("env.py", "import os;print(os.environ.get('ZYN_TEST_SECRET'))")
        self.assertIn("None", self.sb.run(["python3", "-I", "env.py"])["output"])
        self.sb.write_file("loop.py", "while True: pass")
        r = self.sb.run(["python3", "-I", "loop.py"])
        self.assertTrue(r["timed_out"] or r["returncode"] != 0)
        self.sb.write_file("big.py", "print('x'*5000)")
        r = self.sb.run(["python3", "-I", "big.py"])
        self.assertTrue(r["truncated"])
        self.assertLessEqual(len(r["output"]), 300)
        self.sb.write_file("sec.py", "print('api_key = \"abcdefghijklmnopqrstu\"')")
        self.assertNotIn("abcdefghijklmnopqrstu", self.sb.run(["python3", "-I", "sec.py"])["output"])

    def test_audit_chain_verifies_and_detects_tampering(self):
        self.sb.write_file("a.txt", "1")
        self.refused(self.sb.read_file, "../x")
        v = self.sb.verify_audit()
        self.assertTrue(v["ok"])
        self.assertGreaterEqual(v["entries"], 2)
        with open(self.sb.audit_path) as f:
            lines = f.read().splitlines()
        lines[0] = lines[0].replace("OK", "NO")
        with open(self.sb.audit_path, "w") as f:
            f.write("\n".join(lines) + "\n")
        self.assertFalse(self.sb.verify_audit()["ok"])


class OrchestratorGate3(unittest.TestCase):
    def setUp(self):
        from qplus_native.safe_exec import Sandbox
        from qplus_native.orchestrator import Orchestrator
        self.d = tempfile.mkdtemp()
        self.orc = Orchestrator(Sandbox(self.d, timeout_s=10))

    def plan(self, impl="def add(a, b):\n    return a + b\n"):
        return {"goal": "create add() with a test and run it",
                "steps": [{"id": "s1", "do": "write_file", "path": "m.py", "content": impl},
                          {"id": "s2", "do": "write_file", "path": "t.py",
                           "content": "from m import add\nassert add(2, 3) == 5\nprint('PASS_MARK')\n"},
                          {"id": "s3", "do": "run", "argv": ["python3", "-I", "t.py"]}],
                "acceptance": [{"check": "returncode_zero", "step": "s3"},
                               {"check": "output_contains", "step": "s3", "text": "PASS_MARK"},
                               {"check": "file_contains", "path": "m.py", "text": "def add"}]}

    def test_success_delivers_only_when_all_acceptance_pass(self):
        r = self.orc.execute(self.plan())
        self.assertEqual(r["status"], "SUCCEEDED", r.get("failing_process_output"))
        self.assertTrue(r["delivered"])
        self.assertEqual({d["path"] for d in r["deliverables"]}, {"m.py", "t.py"})
        self.assertTrue(r["audit"]["ok"])
        self.assertEqual(r["layer_summary"]["B"], 0)

    def test_failing_implementation_is_reported_failed_not_delivered(self):
        r = self.orc.execute(self.plan("def add(a, b):\n    return a - b\n"))
        self.assertEqual(r["status"], "FAILED")
        self.assertFalse(r["delivered"])
        self.assertEqual(r["deliverables"], [])
        self.assertTrue(any(not c["passed"] for c in r["acceptance"]))

    def test_policy_refusal_blocks_and_later_steps_do_not_run(self):
        p = self.plan()
        p["steps"].insert(1, {"id": "bad", "do": "write_file", "path": "../escape.txt", "content": "x"})
        r = self.orc.execute(p)
        self.assertEqual(r["status"], "BLOCKED")
        self.assertFalse(r["delivered"])
        self.assertIn("s3", r["steps_not_run"])
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.d), "escape.txt")))

    def test_plan_without_acceptance_or_with_unknown_step_is_invalid(self):
        self.assertEqual(self.orc.execute({"steps": [{"id": "a", "do": "write_file", "path": "x", "content": ""}]})["status"], "INVALID_PLAN")
        self.assertEqual(self.orc.execute({"steps": [{"id": "a", "do": "shell", "cmd": "ls"}],
                                           "acceptance": [{"check": "file_exists", "path": "x"}]})["status"], "INVALID_PLAN")

    def test_timeout_is_failed_not_success(self):
        p = {"steps": [{"id": "a", "do": "write_file", "path": "l.py", "content": "while True: pass"},
                       {"id": "b", "do": "run", "argv": ["python3", "-I", "l.py"]}],
             "acceptance": [{"check": "returncode_zero", "step": "b"}]}
        from qplus_native.safe_exec import Sandbox
        from qplus_native.orchestrator import Orchestrator
        r = Orchestrator(Sandbox(self.d, timeout_s=2)).execute(p)
        self.assertEqual(r["status"], "FAILED")


@unittest.skipUnless(HAS_NUMPY, "numpy not installed in host python3")
class DecodingControls(unittest.TestCase):
    def test_no_repeat_ngram_blocks_repeated_trigrams_and_control_ids(self):
        from qplus_native.decoding import generate
        m = small_model()
        out = generate(m, [5, 6, 7], max_new_tokens=60, temperature=0, no_repeat_ngram=3)
        seq = [5, 6, 7] + out
        tri = [tuple(seq[i:i + 3]) for i in range(len(seq) - 2)]
        self.assertEqual(len(tri), len(set(tri)))
        self.assertTrue(all(t >= 4 for t in out))

    def test_tiny_top_p_equals_greedy_and_seed_is_reproducible(self):
        from qplus_native.decoding import generate
        m = small_model()
        g = generate(m, [9, 8], max_new_tokens=15, temperature=0)
        p = generate(m, [9, 8], max_new_tokens=15, temperature=1.0, top_k=0, top_p=1e-9, seed=1)
        self.assertEqual(g, p)
        a = generate(m, [9, 8], max_new_tokens=15, temperature=1.0, seed=42)
        b = generate(m, [9, 8], max_new_tokens=15, temperature=1.0, seed=42)
        self.assertEqual(a, b)

    def test_repetition_penalty_is_multiplicative_and_bounded(self):
        from qplus_native.decoding import apply_controls
        lg = np.array([0.0, 0.0, 0.0, 0.0, 2.0, -2.0])
        out = apply_controls(lg, [4, 5], 2.0, 8, 0, 4)
        self.assertAlmostEqual(out[4], 1.0)   # positive logit divided
        self.assertAlmostEqual(out[5], -4.0)  # negative logit multiplied
        from qplus_native.decoding import generate
        with self.assertRaises(ValueError):
            generate(small_model(), [5], repetition_penalty=9.0)


@unittest.skipUnless(HAS_NUMPY, "numpy not installed in host python3")
class GatePolicy(unittest.TestCase):
    def test_gate_requires_beating_reference_and_previous(self):
        from qplus_native.train_gated import gate_decision
        self.assertTrue(gate_decision(1.50, 1.55, 0.0)["accepted"])
        self.assertFalse(gate_decision(1.55, 1.55, 0.0)["accepted"])          # equal is not an improvement
        self.assertFalse(gate_decision(1.54, 1.55, 0.02)["accepted"])         # margin not met
        self.assertFalse(gate_decision(1.50, 1.55, 0.0, prev_nll=1.40)["accepted"])  # worse than previous out
        self.assertFalse(gate_decision(float("nan"), 1.55, 0.0)["accepted"])  # NaN never accepted


@unittest.skipUnless(HAS_NUMPY and os.path.exists(V2_CHECKPOINT_PATH), "v2 checkpoint or numpy not present")
class TrainedV2(unittest.TestCase):
    def test_trained_checkpoint_verifies_and_records_validation(self):
        info = CheckpointManager.inspect_checkpoint(V2_CHECKPOINT_PATH)
        self.assertEqual(info["status"], "ACTIVE_TENSORS_VERIFIED")
        meta = info["metadata"]
        self.assertEqual(meta["storage_mode"], "LEARNED_WEIGHTS_TRAINED_V2")
        self.assertIn("validation_loss", meta)
        self.assertFalse(meta["parameter_audit"]["target_architecture_instantiated"])


class SelfRepairGate4(unittest.TestCase):
    def setUp(self):
        from qplus_native.safe_exec import Sandbox
        from qplus_native.repair import SelfRepairEngine
        self.d = tempfile.mkdtemp()
        self.sb = Sandbox(self.d, timeout_s=10)
        self.engine = SelfRepairEngine(self.sb, max_repairs=3)

    def test_repairs_syntax_error_and_re_verifies(self):
        plan = {
            "goal": "fix missing colon syntax defect",
            "steps": [
                {"id": "s1", "do": "write_file", "path": "calc.py", "content": "def double(x)\n    return x * 2\n"},
                {"id": "s2", "do": "write_file", "path": "test_calc.py",
                 "content": "from calc import double\nassert double(6) == 12\nprint('SYNTAX_REPAIRED_OK')\n"},
                {"id": "s3", "do": "run", "argv": ["python3", "-I", "test_calc.py"]},
            ],
            "acceptance": [
                {"check": "returncode_zero", "step": "s3"},
                {"check": "output_contains", "step": "s3", "text": "SYNTAX_REPAIRED_OK"},
            ],
        }
        res = self.engine.execute_with_repair(plan)
        self.assertEqual(res["status"], "SUCCEEDED")
        self.assertTrue(res["repaired"])
        self.assertTrue(res["regression_passed"])
        self.assertGreaterEqual(len(res["repair_attempts"]), 1)
        self.assertIn("def double(x):", self.sb.read_file("calc.py"))

    def test_repairs_assertion_defect_and_preserves_audit_chain(self):
        plan = {
            "goal": "fix broken arithmetic implementation",
            "steps": [
                {"id": "s1", "do": "write_file", "path": "m.py", "content": "def add(a, b):\n    return a - b\n"},
                {"id": "s2", "do": "write_file", "path": "t.py",
                 "content": "from m import add\nassert add(3, 4) == 7\nprint('ASSERT_REPAIRED_OK')\n"},
                {"id": "s3", "do": "run", "argv": ["python3", "-I", "t.py"]},
            ],
            "acceptance": [
                {"check": "returncode_zero", "step": "s3"},
                {"check": "output_contains", "step": "s3", "text": "ASSERT_REPAIRED_OK"},
            ],
        }
        res = self.engine.execute_with_repair(plan)
        self.assertEqual(res["status"], "SUCCEEDED")
        self.assertTrue(res["repaired"])
        self.assertTrue(res["audit"]["ok"])
        self.assertIn("return a + b", self.sb.read_file("m.py"))


class AutonomousPlannerGate5(unittest.TestCase):
    def test_end_to_end_multi_file_build_defect_repair_and_zip_package(self):
        import zipfile
        from qplus_native.planner import run_acceptance_scenario, execute_goal_end_to_end
        d1 = tempfile.mkdtemp()
        res = execute_goal_end_to_end(d1, "Build an In-Memory LRU cache utility with tests", priority="Low")
        self.assertEqual(res["status"], "SUCCEEDED")
        self.assertEqual(res["priority"], "Low")
        self.assertTrue(res["delivered"])
        self.assertIsNotNone(res["package"])
        self.assertTrue(res["package"]["integrity_ok"])

        d2 = tempfile.mkdtemp()
        acc = run_acceptance_scenario(d2, priority="High")
        self.assertTrue(acc["scenario_passed"], acc)
        self.assertEqual(acc["baseline_status"], "SUCCEEDED")
        self.assertTrue(acc["defect_detected"])
        self.assertEqual(acc["defect_detection_status"], "FAILED")
        self.assertEqual(acc["repair_status"], "SUCCEEDED")
        self.assertTrue(acc["regression_passed"])
        self.assertTrue(acc["package"]["integrity_ok"])
        zip_full = os.path.join(d2, acc["package"]["zip_path"])
        with zipfile.ZipFile(zip_full, "r") as zf:
            self.assertIsNone(zf.testzip())
            self.assertIn("app/core.py", zf.namelist())
            self.assertIn("tests/test_app.py", zf.namelist())


if __name__ == "__main__":
    unittest.main(verbosity=2)
