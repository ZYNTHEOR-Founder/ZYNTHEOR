# -*- coding: utf-8 -*-
"""
ZYNTHEOR Q+ Sovereign Tokenizer
100% First-party vocabulary and subword tokenization engine.
Zero external dependencies.
"""

import re
from typing import List, Dict, Tuple

class SovereignTokenizer:
    SPECIAL_TOKENS = [
        "[PAD]", "[BOS]", "[EOS]", "[UNK]",
        "[PLAN]", "[CODE]", "[REVIEW]", "[TEST]", "[EVOLVE]",
        "[INPUT]", "[OUTPUT]", "[PASS]", "[FAIL]"
    ]

    def __init__(self, vocab_size: int = 16384):
        self.vocab_size = vocab_size
        self.token_to_id: Dict[str, int] = {}
        self.id_to_token: Dict[int, str] = {}
        self._build_vocab()

    def _build_vocab(self):
        # 1. Special tokens
        for idx, token in enumerate(self.SPECIAL_TOKENS):
            self.token_to_id[token] = idx
            self.id_to_token[idx] = token
        
        # 2. Single byte / ASCII characters (0-255)
        curr_id = len(self.SPECIAL_TOKENS)
        for b in range(256):
            ch = chr(b)
            if ch not in self.token_to_id:
                self.token_to_id[ch] = curr_id
                self.id_to_token[curr_id] = ch
                curr_id += 1

        # 3. Thai Unicode Block (U+0E01 to U+0E5B) - All consonants, vowels, tone marks, numerals, symbols
        for code_point in range(0x0E01, 0x0E5C):
            th_ch = chr(code_point)
            if th_ch not in self.token_to_id and curr_id < self.vocab_size:
                self.token_to_id[th_ch] = curr_id
                self.id_to_token[curr_id] = th_ch
                curr_id += 1

        # 4. High-frequency code tokens, keywords, Thai subwords, and domain vocabulary
        common_subwords = [
            # Code structure & operators
            "    ", "  ", "\n\n", "const", "let", "var", "function", "return", "import", "export",
            "class", "async", "await", "def", "self", "None", "True", "False",
            "from", "type", "interface", "extends", "implements", "public", "private",
            "if", "else", "for", "while", "switch", "case", "break", "continue", "try", "catch", "throw",
            "console.log", "process.stdout", "print(", "return ", "throw new Error",
            " === ", " !== ", " == ", " != ", " >= ", " <= ", " && ", " || ", " => ",
            "// ", "/* ", " */", "/**", " * ", '"""', "'''",
            # Common symbols & brackets
            "{}", "[]", "()", " = ", " : ", " + ", " - ", " * ", " / ", " % ",
            # Standard libraries & patterns
            "fs", "path", "sys", "os", "json", "math", "hashlib", "time", "crypto",
            "Map", "Set", "Array", "Object", "Promise", "Buffer", "Error", "Date",
            "push", "pop", "shift", "unshift", "slice", "splice", "filter", "map", "reduce",
            "get", "set", "has", "delete", "clear", "keys", "values", "entries",
            # Thai common words, prefixes, and grammatical particles
            "การ", "ความ", "ของ", "ที่", "เป็น", "ใน", "ให้", "ได้", "และ", "มี", "ไม่", "จะ", "นี้", "ว่า", "กับ", "เพื่อ", "โดย",
            "สวัสดี", "ระบบ", "ทดสอบ", "ตรวจสอบ", "ประมวลผล", "สถาปัตยกรรม", "ปัญญาประดิษฐ์",
            "ภาษา", "ข้อมูล", "ความปลอดภัย", "พัฒนา", "วิเคราะห์", "อัจฉริยะ", "ทำงาน", "ผู้ใช้",
            "ความจำ", "คำสั่ง", "สิทธิ์", "บันทึก", "เชื่อมต่อ", "เซิร์ฟเวอร์", "เซสชัน", "สมอง",
            "โมเดล", "แท้จริง", "สำเร็จ", "ภารกิจ", "สถิติ", "ประสิทธิภาพ", "ทดลอง", "ตัวชี้วัด",
            "ศูนย์บัญชาการ", "ธรรมาภิบาล", "การสนทนา", "สตูดิโอ", "เครื่องมือ", "อัตโนมัติ",
            # Architectural & sovereign tokens
            "ZYNTHEOR", "Sovereign", "Architecture", "Orchestrator", "AuditLedger", "ToolGateway",
            "NativeNeuralLM", "Verification", "Inference", "Memory", "Checkpoint", "Evolution",
            "PASS", "FAIL", "SUCCESS", "ERROR", "TIMEOUT", "RETRY"
        ]

        for word in common_subwords:
            if word not in self.token_to_id and curr_id < self.vocab_size:
                self.token_to_id[word] = curr_id
                self.id_to_token[curr_id] = word
                curr_id += 1

        # Fill remaining slots up to vocab_size with deterministic byte-combination tokens
        while curr_id < self.vocab_size:
            dummy_token = f"<tok_{curr_id}>"
            self.token_to_id[dummy_token] = curr_id
            self.id_to_token[curr_id] = dummy_token
            curr_id += 1

    def encode(self, text: str) -> List[int]:
        """Encodes text to a list of token IDs with longest-prefix match."""
        tokens: List[int] = []
        i = 0
        n = len(text)
        
        while i < n:
            matched = False
            # Try subwords up to 20 characters long
            max_len = min(20, n - i)
            for l in range(max_len, 1, -1):
                chunk = text[i:i+l]
                if chunk in self.token_to_id:
                    tokens.append(self.token_to_id[chunk])
                    i += l
                    matched = True
                    break
            if not matched:
                char = text[i]
                if char in self.token_to_id:
                    tokens.append(self.token_to_id[char])
                else:
                    tokens.append(self.token_to_id["[UNK]"])
                i += 1
                
        return tokens

    def decode(self, token_ids: List[int]) -> str:
        """Decodes token IDs back to a string."""
        parts = []
        for tid in token_ids:
            if tid in self.id_to_token:
                tok = self.id_to_token[tid]
                # Filter out pure control tokens from standard text output
                if tok.startswith("[") and tok.endswith("]") and tok not in ["[PLAN]", "[CODE]", "[REVIEW]", "[TEST]"]:
                    continue
                if tok.startswith("<tok_") and tok.endswith(">"):
                    continue
                parts.append(tok)
            else:
                parts.append("")
        return "".join(parts)
