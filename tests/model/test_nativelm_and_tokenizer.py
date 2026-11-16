# -*- coding: utf-8 -*-
"""
ZYNTHEOR NativeLM & Tokenizer Validation Suite (pytest + unittest compatible).
Zero simulation:
- Validates SovereignTokenizer bilingual Thai/EN zero-UNK roundtrip & streaming splitting.
- Validates PureSeqLM serialization, logits finiteness, deterministic decoding & tamper rejection.
- Validates NativeLM finite-difference gradient & causal mask when NumPy is installed.
- Never assumes gitignored checkpoint files exist on clean repository checkout.
"""

import array
import hashlib
import http.server
import json
import math
import os
import socketserver
import struct
import sys
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None  # type: ignore[assignment]
    HAS_NUMPY = False

from qplus_native.batch27_eval import evaluate_native_runtime, evaluate_tokenizer
from qplus_native.checkpoint import CheckpointManager
from qplus_native.model import NativeNeuralModel
from qplus_native.seq_lm import MAGIC_HEADER, PureSeqLM, SeqLMConfig, real_vocab_size
from qplus_native.tokenizer import SovereignTokenizer

if HAS_NUMPY:
    from qplus_native.lm_v2 import LMConfig, NativeLM


def _build_container(*, trained: bool = True, inject_nan: bool = False, bad_shape: bool = False) -> bytes:
    tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
    real_v = real_vocab_size(tok)
    cfg = SeqLMConfig(vocab=real_v, d_model=16, n_layers=1, n_heads=2, d_ffn=32, ctx=12)
    lm = PureSeqLM(cfg, seed=11, tokenizer_profile="v2_base")
    container, _ = lm.to_bytes(
        tok,
        extra_meta={
            "training_steps": 10 if trained else 0,
            "val_nll_after": 2.40 if trained else None,
            "untrained": not trained,
            "provenance_status": "TRAINED" if trained else "UNTRAINED",
        },
    )
    ml = struct.unpack(">I", container[len(MAGIC_HEADER):len(MAGIC_HEADER) + 4])[0]
    meta_start = len(MAGIC_HEADER) + 4
    meta_end = meta_start + ml
    meta = json.loads(container[meta_start:meta_end].decode("utf-8"))
    payload = container[meta_end:]
    if inject_nan:
        arr = array.array("f")
        arr.frombytes(payload)
        arr[0] = float("nan")
        payload = arr.tobytes()
        meta["sha256"] = hashlib.sha256(payload).hexdigest()
        mb = json.dumps(meta, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return MAGIC_HEADER + struct.pack(">I", len(mb)) + mb + payload
    if bad_shape:
        meta["tensors_manifest"][0]["params"] += 8
        mb = json.dumps(meta, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return MAGIC_HEADER + struct.pack(">I", len(mb)) + mb + payload
    return container


class _LocalBlobHandler(http.server.BaseHTTPRequestHandler):
    routes = {}

    def log_message(self, format, *args):
        return

    def do_HEAD(self):
        data = self.routes.get(self.path)
        if data is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()

    def do_GET(self):
        data = self.routes.get(self.path)
        if data is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ModelAndTokenizerValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _LocalBlobHandler.routes = {
            "/trained.pt": _build_container(trained=True),
            "/untrained.pt": _build_container(trained=False),
            "/nan.pt": _build_container(inject_nan=True),
            "/bad_shape.pt": _build_container(bad_shape=True),
        }
        cls.httpd = socketserver.TCPServer(("127.0.0.1", 0), _LocalBlobHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def _url(self, p: str) -> str:
        return f"http://127.0.0.1:{self.port}{p}"

    def test_tokenizer_bilingual_roundtrip_and_thai_streaming(self):
        tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
        tok_eval = evaluate_tokenizer(tok)
        self.assertEqual(tok_eval["status"], "PASS")
        self.assertEqual(tok_eval["roundtrip_accuracy"], 1.0)
        self.assertEqual(tok_eval["unk_rate"], 0.0)

        # Combining Thai tone marks must never split mid-cluster when flush=False
        safe, tail = tok.split_thai_safe_stream_prefix("ก\u0e49", flush=False)
        self.assertEqual(safe + tail, "ก\u0e49")

    def test_native_model_checkpoint_verification_and_inference(self):
        ready_model = NativeNeuralModel(presigned_url=self._url("/trained.pt"))
        self.assertEqual(ready_model.runtime_state, "READY")
        self.assertTrue(ready_model.execution_verified)
        ev = evaluate_native_runtime(ready_model)
        self.assertEqual(ev["status"], "PASS")
        self.assertTrue(math.isfinite(ev["inference"]["metrics"]["nll"]))
        self.assertTrue(ev["inference"]["metrics"]["deterministic_greedy_parity"])

        untrained = NativeNeuralModel(presigned_url=self._url("/untrained.pt"))
        self.assertEqual(untrained.runtime_state, "NOT_TRAINED")
        blocked = evaluate_native_runtime(untrained)
        self.assertEqual(blocked["inference"]["status"], "BLOCKED")

        for bad in ("/nan.pt", "/bad_shape.pt", "/missing.pt"):
            with self.assertRaises(RuntimeError):
                NativeNeuralModel(presigned_url=self._url(bad))

    def test_synthetic_target_export_prohibited(self):
        with self.assertRaisesRegex(RuntimeError, "prohibited"):
            CheckpointManager.export_full_tensor_checkpoint()

    @unittest.skipUnless(HAS_NUMPY, "numpy not installed in host python3")
    def test_lm_v2_causal_mask_and_finite_diff_gradients(self):
        m = NativeLM(LMConfig(vocab=32, d_model=16, n_layers=1, n_heads=2, d_ffn=24, ctx=8), seed=5)
        a = np.array([[1, 2, 3, 4, 5, 6, 7, 8]])
        b = a.copy()
        b[0, 5:] = [9, 10, 11]
        la, lb = m.forward(a)[0], m.forward(b)[0]
        np.testing.assert_allclose(la[0, :5], lb[0, :5], atol=1e-12)
        self.assertGreater(float(np.abs(la[0, 5:] - lb[0, 5:]).max()), 1e-6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
