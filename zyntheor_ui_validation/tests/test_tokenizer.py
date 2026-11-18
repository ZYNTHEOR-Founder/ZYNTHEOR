# -*- coding: utf-8 -*-
"""Tokenizer & bilingual streaming unit tests for ZYNTHEOR."""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from qplus_native.tokenizer import SovereignTokenizer


class TokenizerTests(unittest.TestCase):
    def test_thai_english_code_zero_unk_roundtrip(self):
        tok = SovereignTokenizer(vocab_size=16384, profile="v2_base")
        samples = [
            "ระบบ ZYNTHEOR ต้องทำงานได้จริงครบทุกขั้นตอน",
            "def checksum(data: bytes) -> str: return data.hex()",
            "ทดสอบ ไทย-English mixing 2026!@#",
        ]
        unk_id = tok.token_to_id.get("[UNK]", 3)
        for text in samples:
            ids = tok.encode(text)
            self.assertGreater(len(ids), 0)
            self.assertNotIn(unk_id, ids)
            self.assertEqual(tok.decode(ids).strip(), text.strip())


if __name__ == "__main__":
    unittest.main(verbosity=2)
