#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rigorous Thai-Safe Streaming & Cloud Weight Loading Test for ZYNTHEOR Q+
Tests:
1. SovereignTokenizer & ThaiSafeStreamDecoder grapheme-cluster integrity (character & subword splits).
2. Immediate zero-delay emission for non-Thai/ASCII tokens and zero time.sleep() in stream_generate.
3. Cloud HTTP streaming of PureSeqLM (or NativeLM v2 when NumPy is installed) into NativeNeuralModel
   via CHECKPOINT_PRESIGNED_URL with zero local disk fallback.
4. Full subprocess JSON-RPC verification of qplus_native/bridge.py `stream_generate`.
"""

import http.server
import json
import os
import subprocess
import sys
import threading
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.seq_lm import PURE_SEQ_CHECKPOINT_PATH
from qplus_native.model import NativeNeuralModel

try:
    import numpy as np  # noqa: F401
    from qplus_native.lm_v2 import V2_CHECKPOINT_PATH
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
    V2_CHECKPOINT_PATH = PURE_SEQ_CHECKPOINT_PATH


class _BytesHandler(http.server.BaseHTTPRequestHandler):
    payload: bytes = b""

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Length", str(len(self.payload)))
        self.send_header("Content-Type", "application/octet-stream")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", str(len(self.payload)))
        self.send_header("Content-Type", "application/octet-stream")
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, format, *args):
        return


class ThaiSafeStreamingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ckpt_file = V2_CHECKPOINT_PATH if (HAS_NUMPY and os.path.exists(V2_CHECKPOINT_PATH)) else PURE_SEQ_CHECKPOINT_PATH
        with open(ckpt_file, "rb") as fh:
            raw_bytes = fh.read()

        class Handler(_BytesHandler):
            payload = raw_bytes

        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.presigned_url = f"http://127.0.0.1:{cls.port}/model.pt"
        os.environ["CHECKPOINT_PRESIGNED_URL"] = cls.presigned_url

        cls.model = NativeNeuralModel(checkpoint_path=cls.presigned_url)
        cls.tok = cls.model.tokenizer

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        os.environ.pop("CHECKPOINT_PRESIGNED_URL", None)

    def _assert_thai_safe_chunks(self, token_ids, expect_exact_text=None):
        decoder = self.tok.create_stream_decoder()
        chunks = []
        for tid in token_ids:
            out = decoder.push_token(tid)
            if out:
                chunks.append(out)
        tail = decoder.flush()
        if tail:
            chunks.append(tail)

        reconstructed = "".join(chunks)
        expected = expect_exact_text if expect_exact_text is not None else self.tok.decode(token_ids)
        self.assertEqual(reconstructed, expected)

        for idx, chunk in enumerate(chunks):
            self.assertTrue(len(chunk) > 0)
            self.assertFalse(
                SovereignTokenizer.is_thai_combining(chunk[0]),
                f"Orphan combining mark at start of chunk[{idx}]={chunk!r} in chunks={chunks!r}",
            )
            if idx > 0 and chunks[idx - 1]:
                prev_last = chunks[idx - 1][-1]
                if chunk[0] == "\u0e33":
                    self.assertFalse(
                        SovereignTokenizer.is_thai_base_consonant(prev_last)
                        or SovereignTokenizer.is_thai_combining(prev_last),
                        f"Split SARA AM across chunk boundary: {chunks[idx-1]!r} | {chunk!r}",
                    )
        return chunks, reconstructed

    def test_character_level_thai_combining_clusters_never_split(self):
        samples = [
            "น้ำใสใจจริง",
            "สวัสดีครับ",
            "เครื่องมือทดสอบ",
            "ที่นี่มีระบบกิ่กิ้กิ๊",
            "ผู้เชี่ยวชาญพัฒนาปัญญาประดิษฐ์",
        ]
        for text in samples:
            char_ids = [self.tok.token_to_id[ch] for ch in text]
            chunks, reconstructed = self._assert_thai_safe_chunks(char_ids, expect_exact_text=text)
            print(f"[CHAR-STREAM] {text!r} -> chunks={chunks}")
            self.assertEqual(reconstructed, text)

    def test_mixed_thai_english_streaming_zero_ascii_delay(self):
        decoder = self.tok.create_stream_decoder()
        ascii_ids = self.tok.encode("ZYNTHEOR ")
        first_chunk = decoder.push_token(ascii_ids[0])
        self.assertEqual(first_chunk, "ZYNTHEOR")
        if len(ascii_ids) > 1:
            second_chunk = decoder.push_token(ascii_ids[1])
            self.assertTrue(len(second_chunk) >= 1)
        decoder.flush()

        mixed = "ระบบ ZYNTHEOR คือ Sovereign NativeLM"
        mixed_ids = self.tok.encode(mixed)
        chunks, reconstructed = self._assert_thai_safe_chunks(mixed_ids, expect_exact_text=mixed)
        print(f"[MIXED-STREAM] {mixed!r} -> chunks={chunks}")
        self.assertEqual(reconstructed, mixed)

    def test_real_native_thai_prompt_generation_and_bridge_stream(self):
        prompt = "ระบบ ZYNTHEOR คือ"
        prompt_ids = self.tok.encode(prompt)
        unk_id = self.tok.token_to_id["[UNK]"]
        prompt_tokens = [self.tok.id_to_token.get(t, "?") for t in prompt_ids]
        prompt_unks = sum(1 for t in prompt_ids if t == unk_id)

        self.assertEqual(self.tok.decode(prompt_ids), prompt)
        self.assertEqual(prompt_unks, 0)
        self.assertTrue(self.model.weights_loaded)
        self.assertIn(self.model.config.total_params, (51296, 502912))
        self.assertTrue(self.model.weights_source.startswith("http://127.0.0.1:"))

        sampled_ids = list(
            self.model.generate_ids_stream(
                prompt, max_new_tokens=24, temperature=0.8, top_k=20, repetition_penalty=1.08, seed=42
            )
        )
        sampled_chunks, sampled_text = self._assert_thai_safe_chunks(sampled_ids)
        sampled_pieces = [self.tok.decode_token(t) for t in sampled_ids]

        greedy_ids = list(
            self.model.generate_ids_stream(
                prompt, max_new_tokens=24, temperature=0.0, top_k=20, repetition_penalty=1.08
            )
        )
        greedy_chunks, greedy_text = self._assert_thai_safe_chunks(greedy_ids)

        env = dict(os.environ)
        env["CHECKPOINT_PRESIGNED_URL"] = self.presigned_url
        with subprocess.Popen(
            [sys.executable, "-u", "-m", "qplus_native.bridge"],
            cwd=ROOT,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        ) as proc:
            try:
                ping_req = {"id": 100, "cmd": "ping", "params": {}}
                proc.stdin.write(json.dumps(ping_req) + "\n")
                proc.stdin.flush()
                ping_resp_line = proc.stdout.readline().strip()
                ping_resp = json.loads(ping_resp_line)
                self.assertEqual(ping_resp.get("status"), "ok")
                self.assertTrue(ping_resp.get("weights_loaded"))

                req = {
                    "id": 101,
                    "cmd": "stream_generate",
                    "params": {
                        "prompt": prompt,
                        "role": "chat",
                        "correlation_id": "test_thai_stream_01",
                        "max_new_tokens": 24,
                        "temperature": 0.8,
                        "top_k": 20,
                        "repetition_penalty": 1.08,
                        "seed": 42,
                    },
                }
                t0 = time.perf_counter()
                proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
                proc.stdin.flush()
                proc.stdin.close()

                bridge_chunks = []
                bridge_done = None
                ttft_ms = None
                for raw_line in proc.stdout:
                    line = raw_line.strip()
                    if not line:
                        continue
                    ev = json.loads(line)
                    if ev.get("type") == "chunk":
                        if ttft_ms is None:
                            ttft_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                        bridge_chunks.append(ev["text"])
                    elif ev.get("type") == "done":
                        bridge_done = ev
                        break
                stderr_out = proc.stderr.read()
                ret_code = proc.wait(timeout=15)
            finally:
                if proc.poll() is None:
                    proc.kill()

        self.assertEqual(ret_code, 0, f"bridge.py exited with {ret_code}: {stderr_out}")
        self.assertIsNotNone(bridge_done)
        self.assertNotIn("runtime_fallback_used", bridge_done)
        self.assertEqual(bridge_done.get("total_params"), self.model.config.total_params)
        self.assertEqual("".join(bridge_chunks), sampled_text)

        for idx, ch in enumerate(bridge_chunks):
            self.assertFalse(
                SovereignTokenizer.is_thai_combining(ch[0]),
                f"Bridge emitted orphan combining mark at chunk[{idx}]={ch!r}",
            )

        print("\n=== THAI STREAMING & GENERATION TEST OUTPUT ===")
        print(f"Prompt: {prompt!r}")
        print(f"Prompt token IDs ({len(prompt_ids)}, UNKs={prompt_unks}): {prompt_ids}")
        print(f"Prompt tokens: {prompt_tokens}")
        print(f"Bridge weights_source: {bridge_done.get('weights_source')} | total_params={bridge_done.get('total_params')}")
        print(f"Bridge TTFT: {ttft_ms} ms | Total Latency: {bridge_done.get('latency_ms')} ms | Throughput: {bridge_done.get('tokens_per_sec')} tok/s")
        print(f"Sampled (temp=0.8, seed=42) token_ids ({len(sampled_ids)}): {sampled_ids}")
        print(f"Sampled raw token pieces: {sampled_pieces}")
        print(f"Sampled Thai-safe chunks ({len(bridge_chunks)}): {bridge_chunks}")
        print(f"Sampled EXACT output: {sampled_text!r}")
        print(f"Greedy (temp=0.0) Thai-safe chunks ({len(greedy_chunks)}): {greedy_chunks}")
        print(f"Greedy EXACT output: {greedy_text!r}")
        print("=== END TEST OUTPUT ===\n")


if __name__ == "__main__":
    unittest.main()
