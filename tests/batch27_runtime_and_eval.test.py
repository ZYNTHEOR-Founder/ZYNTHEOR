#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZYNTHEOR Batch 27 — Python Runtime, Verification, Cancellation & Evaluation Test Suite
Zero Simulation Policy:
  - Uses real PureSeqLM weights and real loopback HTTP cloud servers.
  - Verifies granular 7-state runtime transitions, NaN/Inf rejection, shape mismatch rejection,
    execution-gated READY, context window bounding, mid-stream bridge cancellation,
    reasoning-vs-orchestrator provenance separation, and batch27_eval output.
"""

import hashlib
import http.server
import json
import math
import os
import socketserver
import struct
import subprocess
import sys
import threading
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from qplus_native.batch27_eval import evaluate_native_runtime, evaluate_tokenizer
from qplus_native.bridge import run_verification_suite
from qplus_native.cloud_storage import parse_checkpoint_container, validate_cloud_url
from qplus_native.model import MEMORY_STORE_PATH, NativeNeuralModel
from qplus_native.seq_lm import MAGIC_HEADER, PureSeqLM, SeqLMConfig, real_vocab_size
from qplus_native.tokenizer import SovereignTokenizer


def build_pure_seq_container(
    *,
    trained: bool = True,
    steps: int = 12,
    corrupt_magic: bool = False,
    truncate_payload: bool = False,
    inject_nan: bool = False,
    bad_shape_manifest: bool = False,
) -> bytes:
    tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
    real_v = real_vocab_size(tok)
    cfg = SeqLMConfig(vocab=real_v, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=12)
    lm = PureSeqLM(cfg, seed=7, tokenizer_profile="v2_base")

    extra_meta = {
        "training_steps": steps if trained else 0,
        "val_nll_after": 2.41 if trained else None,
        "untrained": False if trained else True,
        "provenance_status": "TRAINED" if trained else "UNTRAINED",
    }
    container, meta = lm.to_bytes(tok, extra_meta=extra_meta)
    if corrupt_magic:
        return b"BAD_MAGIC_HEADER" + container[len(MAGIC_HEADER):]

    ml = struct.unpack(">I", container[len(MAGIC_HEADER):len(MAGIC_HEADER) + 4])[0]
    meta_start = len(MAGIC_HEADER) + 4
    meta_end = meta_start + ml
    payload = container[meta_end:]

    if truncate_payload:
        return container[:meta_end] + payload[:-16]

    if inject_nan:
        import array
        arr = array.array("f")
        arr.frombytes(payload)
        arr[0] = float("nan")
        new_payload = arr.tobytes()
        meta["sha256"] = hashlib.sha256(new_payload).hexdigest()
        mb = json.dumps(meta, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return MAGIC_HEADER + struct.pack(">I", len(mb)) + mb + new_payload

    if bad_shape_manifest:
        meta["tensors_manifest"][0]["params"] = meta["tensors_manifest"][0]["params"] + 10
        mb = json.dumps(meta, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return MAGIC_HEADER + struct.pack(">I", len(mb)) + mb + payload

    return container


class _LoopbackHandler(http.server.BaseHTTPRequestHandler):
    routes = {}

    def log_message(self, format, *args):
        return

    def do_HEAD(self):
        if self.path == "/redir_imds":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()
            return
        if self.path in self.routes:
            data = self.routes[self.path]
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/redir_imds":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()
            return
        if self.path in self.routes:
            data = self.routes[self.path]
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()


class Batch27RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _LoopbackHandler.routes = {
            "/trained.pt": build_pure_seq_container(trained=True, steps=12),
            "/untrained.pt": build_pure_seq_container(trained=False, steps=0),
            "/corrupt_magic.pt": build_pure_seq_container(corrupt_magic=True),
            "/truncated.pt": build_pure_seq_container(truncate_payload=True),
            "/nan_weights.pt": build_pure_seq_container(inject_nan=True),
            "/bad_shape.pt": build_pure_seq_container(bad_shape_manifest=True),
        }
        cls.httpd = socketserver.TCPServer(("127.0.0.1", 0), _LoopbackHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def test_01_ssrf_validation_blocks_imds_and_private_ips(self):
        for bad in (
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5/ckpt.pt",
            "http://192.168.1.10/ckpt.pt",
            "file:///etc/passwd",
            "http://metadata.google.internal/computeMetadata/v1/",
        ):
            ok, err = validate_cloud_url(bad)
            self.assertFalse(ok, f"Expected SSRF block for {bad}")
            self.assertIsNotNone(err)
            self.assertIn("FAIL_CLOSED", err)
        # Loopback should pass for test harness
        ok, err = validate_cloud_url(self.url("/trained.pt"))
        self.assertTrue(ok, f"Expected loopback allowed, got {err}")
        self.assertIsNone(err)

        # HTTP 302 redirect -> IMDS must be rejected with SSRF_BLOCKED
        from qplus_native.cloud_storage import check_cloud_connectivity
        redir_probe = check_cloud_connectivity(timeout_s=2.0, presigned_url=self.url("/redir_imds"))
        self.assertFalse(redir_probe["online"])
        self.assertEqual(redir_probe["error_code"], "SSRF_BLOCKED")
        self.assertIn("SSRF_BLOCKED", redir_probe["reason"])

    def test_02_unconfigured_fails_closed(self):
        old_p = os.environ.pop("CHECKPOINT_PRESIGNED_URL", None)
        old_s3 = os.environ.pop("S3_BUCKET", None)
        try:
            with self.assertRaises(RuntimeError) as ctx:
                NativeNeuralModel()
            self.assertIn("FAIL_CLOSED", str(ctx.exception))
        finally:
            if old_p is not None:
                os.environ["CHECKPOINT_PRESIGNED_URL"] = old_p
            if old_s3 is not None:
                os.environ["S3_BUCKET"] = old_s3

    def test_03_not_found_and_corrupt_checkpoints_fail_closed(self):
        with self.assertRaises(RuntimeError):
            NativeNeuralModel(presigned_url=self.url("/does_not_exist.pt"))
        for bad_path in ("/corrupt_magic.pt", "/truncated.pt", "/nan_weights.pt", "/bad_shape.pt"):
            with self.assertRaises(RuntimeError, msg=f"Expected failure for {bad_path}"):
                NativeNeuralModel(presigned_url=self.url(bad_path))

    def test_04_untrained_checkpoint_marks_not_trained(self):
        model = NativeNeuralModel(presigned_url=self.url("/untrained.pt"))
        self.assertTrue(model.weights_loaded)
        self.assertTrue(model.execution_verified)
        self.assertFalse(model.trained_provenance)
        self.assertEqual(model.runtime_state, "NOT_TRAINED")

    def test_05_trained_checkpoint_passes_execution_verification_and_ready(self):
        model = NativeNeuralModel(presigned_url=self.url("/trained.pt"))
        self.assertTrue(model.weights_loaded)
        self.assertTrue(model.execution_verified)
        self.assertTrue(model.tensor_validation_ok)
        self.assertTrue(model.trained_provenance)
        self.assertEqual(model.runtime_state, "READY")
        self.assertEqual(model.weights_role, "learned_sequence_lm")

        # Reasoning separation: chat uses native_model_logits; planner uses orchestrator_structured
        chat_res = model.generate("อธิบายระบบ ZYNTHEOR Sovereign", role="chat", max_tokens=16)
        self.assertEqual(chat_res.get("inference_origin"), "native_model_logits")
        self.assertEqual(chat_res.get("weights_role"), "learned_sequence_lm")
        self.assertGreater(chat_res.get("output_tokens_count", 0), 0)

        plan_res = model.generate("วางแผนระบบ", role="planner", max_tokens=16)
        self.assertEqual(plan_res.get("inference_origin"), "orchestrator_structured")

    def test_06_context_window_bounding_and_truncation_telemetry(self):
        model = NativeNeuralModel(presigned_url=self.url("/trained.pt"))
        long_prompt = "sovereign " * 40
        res = model.generate(long_prompt, role="chat", max_tokens=8)
        self.assertTrue(res.get("prompt_truncated"))
        self.assertLessEqual(res.get("effective_context_len", 999), res.get("max_context_len", 12))
        self.assertGreater(res.get("input_tokens_count", 0), res.get("effective_context_len", 0))

    def test_verification_suite_attributes_and_isolates_each_probe(self):
        model = NativeNeuralModel(presigned_url=self.url("/trained.pt"))
        memory_cache = model.memory_cache
        store_before = None
        if os.path.isfile(MEMORY_STORE_PATH):
            with open(MEMORY_STORE_PATH, "rb") as memory_file:
                store_before = (hashlib.sha256(memory_file.read()).hexdigest(), os.stat(MEMORY_STORE_PATH).st_mtime_ns)

        result = run_verification_suite(model)
        probes = {probe["test_id"]: probe for probe in result["results"]}

        self.assertEqual(probes["P1_WEIGHTS_LOAD"]["status"], "PASS")
        self.assertEqual(probes["P3_INFERENCE"]["status"], "PASS")
        self.assertIn("learned-logit", probes["P3_INFERENCE"]["name"].lower())
        self.assertIn("origin=learned_logits_cloud", probes["P3_INFERENCE"]["evidence"])
        self.assertEqual(probes["P4_REASONING"]["status"], "PASS")
        self.assertIn("attribution=symbolic_verifier", probes["P4_REASONING"]["evidence"])
        self.assertEqual(probes["P5_MEMORY"]["status"], "PASS")
        self.assertIn("Temporary memory file", probes["P5_MEMORY"]["evidence"])
        self.assertEqual(probes["P7_PERSISTENCE"]["status"], "PASS")
        self.assertIn("seeded_output_match=True", probes["P7_PERSISTENCE"]["evidence"])
        self.assertEqual(probes["P8_PERFORMANCE"]["status"], "PARTIAL")
        self.assertEqual(result["status"], "PARTIAL")
        self.assertFalse(result["verified"])
        self.assertIs(model.memory_cache, memory_cache)

        if store_before is None:
            self.assertFalse(os.path.exists(MEMORY_STORE_PATH))
        else:
            with open(MEMORY_STORE_PATH, "rb") as memory_file:
                store_after = (hashlib.sha256(memory_file.read()).hexdigest(), os.stat(MEMORY_STORE_PATH).st_mtime_ns)
            self.assertEqual(store_after, store_before)

    def test_verification_suite_blocks_untrained_checkpoint_inference(self):
        model = NativeNeuralModel(presigned_url=self.url("/untrained.pt"))
        result = run_verification_suite(model)
        probes = {probe["test_id"]: probe for probe in result["results"]}

        self.assertEqual(probes["P1_WEIGHTS_LOAD"]["status"], "BLOCKED")
        self.assertEqual(probes["P3_INFERENCE"]["status"], "BLOCKED")
        self.assertEqual(probes["P7_PERSISTENCE"]["status"], "BLOCKED")
        self.assertEqual(probes["P8_PERFORMANCE"]["status"], "BLOCKED")
        self.assertEqual(result["status"], "PARTIAL_BLOCKED")
        self.assertFalse(result["verified"])

    def test_07_bridge_ping_not_configured_and_midstream_cancellation(self):
        # 1) Unconfigured bridge starts cleanly with execution_verified=False and runtime_state=NOT_CONFIGURED
        env = dict(os.environ)
        env.pop("CHECKPOINT_PRESIGNED_URL", None)
        env.pop("S3_BUCKET", None)
        proc = subprocess.Popen(
            [sys.executable, os.path.join(ROOT, "qplus_native", "bridge.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        try:
            proc.stdin.write(json.dumps({"id": "p1", "command": "ping"}) + "\n")
            proc.stdin.flush()
            ping_msg = json.loads(proc.stdout.readline())
            self.assertEqual(ping_msg["runtime_state"], "NOT_CONFIGURED")
            self.assertFalse(ping_msg["execution_verified"])
            self.assertFalse(ping_msg["weights_loaded"])

            # 2) batch27_eval while unconfigured stays BLOCKED on inference, passes tokenizer
            proc.stdin.write(json.dumps({"id": "e1", "command": "batch27_eval"}) + "\n")
            proc.stdin.flush()
            eval_msg = json.loads(proc.stdout.readline())
            self.assertEqual(eval_msg["inference"]["status"], "BLOCKED")
            self.assertEqual(eval_msg["tokenizer"]["roundtrip_accuracy"], 1.0)
        finally:
            proc.kill()
            proc.wait(timeout=5)

        # 3) Configured bridge: stream_generate + cooperative cancel_inference
        env2 = dict(os.environ)
        env2["CHECKPOINT_PRESIGNED_URL"] = self.url("/trained.pt")
        proc2 = subprocess.Popen(
            [sys.executable, os.path.join(ROOT, "qplus_native", "bridge.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env2,
        )
        try:
            proc2.stdin.write(json.dumps({"id": "p2", "command": "ping"}) + "\n")
            proc2.stdin.flush()
            p2_msg = json.loads(proc2.stdout.readline())
            self.assertEqual(p2_msg["runtime_state"], "READY")
            self.assertTrue(p2_msg["execution_verified"])

            corr_id = "cancel_test_corr"
            proc2.stdin.write(
                json.dumps({
                    "id": "s1",
                    "command": "stream_generate",
                    "params": {
                        "prompt": "ทดสอบการยกเลิก",
                        "role": "chat",
                        "correlation_id": corr_id,
                        "max_new_tokens": 120,
                    },
                }) + "\n"
            )
            proc2.stdin.flush()

            cancelled_seen = False
            chunks = 0
            done_ev = None
            while True:
                line = proc2.stdout.readline()
                if not line:
                    break
                ev = json.loads(line)
                if ev.get("id") != "s1":
                    continue
                if ev.get("type") == "chunk":
                    chunks += 1
                    if chunks == 2:
                        proc2.stdin.write(
                            json.dumps({
                                "id": "c1",
                                "command": "cancel_inference",
                                "params": {"correlation_id": corr_id},
                            }) + "\n"
                        )
                        proc2.stdin.flush()
                elif ev.get("type") == "done":
                    done_ev = ev
                    cancelled_seen = bool(ev.get("cancelled"))
                    break
            self.assertIsNotNone(done_ev)
            self.assertTrue(cancelled_seen, f"Expected mid-stream cancel_inference to set cancelled=True, got {done_ev}")
            self.assertLess(done_ev.get("output_tokens_count", 999), 120)
        finally:
            proc2.kill()
            proc2.wait(timeout=5)

    def test_08_batch27_eval_with_ready_model(self):
        model = NativeNeuralModel(presigned_url=self.url("/trained.pt"))
        tok_eval = evaluate_tokenizer(model.tokenizer)
        self.assertEqual(tok_eval["roundtrip_accuracy"], 1.0)
        self.assertEqual(tok_eval["unk_rate"], 0.0)

        rt_eval = evaluate_native_runtime(model)
        self.assertEqual(rt_eval["status"], "PASS")
        self.assertEqual(rt_eval["inference"]["status"], "PASS")
        metrics = rt_eval["inference"]["metrics"]
        self.assertTrue(metrics["deterministic_greedy_parity"])
        self.assertTrue(math.isfinite(metrics["nll"]))
        self.assertGreater(metrics["tokens_per_sec"], 0.0)
        self.assertEqual(metrics["runtime_error_rate"], 0.0)
        self.assertIsNotNone(metrics["thai_metrics"])
        self.assertIsNotNone(metrics["english_metrics"])
        self.assertTrue(rt_eval["reasoning_separation"]["orchestrator_symbolic_verifier"]["arithmetic_chain_verified"])
        self.assertTrue(rt_eval["reasoning_separation"]["orchestrator_symbolic_verifier"]["causal_dag_verified"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
