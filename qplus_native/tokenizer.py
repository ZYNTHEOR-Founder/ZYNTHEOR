# -*- coding: utf-8 -*-
"""
ZYNTHEOR Q+ Sovereign Tokenizer
100% First-party vocabulary and subword tokenization engine.
Zero external dependencies.
"""

import re
import unicodedata
from typing import List, Dict, Tuple, Optional

# Thai combining vowels (above/below), tone marks, and diacritics that attach to a preceding base character
THAI_COMBINING_CODEPOINTS = frozenset({
    0x0E31,                  # ั MAI HAN-AKAT
    *range(0x0E34, 0x0E3B),  # ิ ี ึ ื ุ ู ฺ
    *range(0x0E47, 0x0E4F),  # ็ ่ ้ ๊ ๋ ์ ํ ๎
})


INSTRUCTION_TOKENS = [
    "<|system|>", "<|user|>", "<|assistant|>", "<|end|>",
]

# Curated bilingual Thai-English subwords appended ONLY in `bilingual_v4` profile (IDs >= 532),
# preserving IDs 0..531 identically for v2 baseline checkpoint compatibility.
BILINGUAL_V4_SUBWORDS = [
    *INSTRUCTION_TOKENS,
    # Bilingual QA / instruction cues
    "คำถาม:", "คำตอบ:", "คำสั่ง:", "บริบท:", "สรุป:", "ขั้นตอน:", "หมายเหตุ:", "ตัวอย่าง:",
    "Question:", "Answer:", "Instruction:", "Context:", "Summary:", "Example:",
    # Core Thai interrogatives, pronouns, particles & logical connectors
    "คือ", "อะไร", "อย่างไร", "ทำไม", "เมื่อไร", "ที่ไหน", "เท่าไร", "หรือ", "แต่", "เพราะ", "ดังนั้น",
    "เช่น", "เกี่ยวกับ", "สำหรับ", "ระหว่าง", "ภายใน", "ภายนอก", "ตั้งแต่", "จนถึง", "ผ่าน", "ด้วย",
    "จาก", "ถึง", "บน", "ล่าง", "หน้า", "หลัง", "ก่อน", "แล้ว", "ยัง", "กำลัง", "อยู่", "ใช่", "ไม่ใช่",
    "ครับ", "ค่ะ", "ผม", "คุณ", "เรา", "เขา", "มัน", "นี่", "นั่น", "นั้น", "ไหน", "ใคร", "ทุก", "บาง",
    "สามารถ", "ต้อง", "ควร", "อาจ", "เคย", "มัก", "ช่วย", "กรุณา", "โปรด", "บอก", "อธิบาย", "แสดง",
    # Thai core verbs & reasoning actions
    "เขียน", "สร้าง", "แก้ไข", "ปรับปรุง", "ลบ", "เพิ่ม", "ลด", "เปลี่ยน", "แปลง", "รวม", "แยก",
    "เปรียบเทียบ", "คำนวณ", "จำแนก", "จัดเรียง", "ค้นหา", "ดึงข้อมูล", "ส่งออก", "นำเข้า", "ติดตั้ง",
    "เริ่มต้น", "สิ้นสุด", "หยุด", "ทำงาน", "ประมวล", "ตอบ", "ถาม", "อ่าน", "พิมพ์", "เข้าใจ", "เรียนรู้",
    "ฝึกฝน", "ประเมิน", "คาดการณ์", "สังเคราะห์", "ออกแบบ", "วางแผน", "จัดการ", "ควบคุม", "ป้องกัน",
    # Thai nouns & Sovereign AI / engineering terminology
    "ซินธีออร์", "ปัญญา", "ประดิษฐ์", "อธิปไตย", "อิสระ", "ท้องถิ่น", "ภายนอก", "ภายใน", "เครือข่าย",
    "ฐานข้อมูล", "ฐานความรู้", "ความถูกต้อง", "ความแม่นยำ", "ความรวดเร็ว", "ความเสถียร", "ความเสี่ยง",
    "ความแตกต่าง", "ความสัมพันธ์", "ความสำคัญ", "คุณสมบัติ", "ข้อจำกัด", "ข้อดี", "ข้อเสีย", "ข้อผิดพลาด",
    "โครงสร้าง", "กระบวนการ", "หลักการ", "เหตุผล", "ผลลัพธ์", "คำอธิบาย", "รายละเอียด", "ภาพรวม",
    "โมเดลภาษา", "โครงข่ายประสาท", "พารามิเตอร์", "น้ำหนัก", "เกรเดียนต์", "ความสูญเสีย", "ค่าความสับสน",
    "โทเค็น", "พจนานุกรม", "บริบท", "หน้าต่าง", "ความยาว", "ลำดับ", "ข้อความ", "ประโยค", "คำศัพท์",
    "ตัวอักษร", "พยัญชนะ", "สระ", "วรรณยุกต์", "ตัวเลข", "สัญลักษณ์", "รหัส", "โปรแกรม", "ซอฟต์แวร์",
    "ฟังก์ชัน", "ตัวแปร", "คลาส", "ออบเจ็กต์", "เมธอด", "อาร์กิวเมนต์", "ค่าส่งกลับ", "อัลกอริทึม",
    "หน่วยความจำ", "แคช", "ดิสก์", "ไฟล์", "โฟลเดอร์", "เส้นทาง", "พอร์ต", "โปรโตคอล", "เซสชัน",
    "ผู้ใช้", "ผู้ดูแล", "ผู้พัฒนา", "ผู้ตรวจสอบ", "นโยบาย", "กฎเกณฑ์", "มาตรฐาน", "หลักฐาน", "ลายเซ็น",
    "การเข้ารหัส", "การถอดรหัส", "การตรวจสอบ", "การยืนยัน", "การทดสอบ", "การประเมิน", "การสตรีม",
    "การสนทนา", "การค้นคืน", "การเรียนรู้", "การฝึกอบรม", "การอนุมาน", "การตัดสินใจ", "การแก้ปัญหา",
    "ภาษาไทย", "ภาษาอังกฤษ", "สองภาษา", "อัตโนมัติ", "เรียลไทม์", "ออฟไลน์", "ออนไลน์", "สมบูรณ์",
    "ชัดเจน", "กระชับ", "ถูกต้อง", "ปลอดภัย", "น่าเชื่อถือ", "ตรวจสอบได้", "โปร่งใส", "ยืดหยุ่น",
    "ปัจจุบัน", "อนาคต", "อดีต", "วันนี้", "ตอนนี้", "ต่อไป", "ทันที", "เสมอ", "บ่อย", "มาก", "น้อย",
    "สูง", "ต่ำ", "ใหญ่", "เล็ก", "ยาว", "สั้น", "ใหม่", "เก่า", "ดี", "แย่", "ง่าย", "ยาก", "เร็ว", "ช้า",
    # High-frequency Thai syllable building blocks (2-3 char common cores)
    "กร", "ปร", "ตร", "คร", "พร", "พล", "กล", "คล", "ปล", "คว", "กว", "หน", "หม", "หล", "หร", "หว",
    "ไท", "ไทย", "ใจ", "ใน", "ใต", "ให", "ใช้", "ได้", "ไป", "มา", "ดู", "ทำ", "รู้", "คิด", "พูด",
    "ทาง", "ด้าน", "ส่วน", "แบบ", "ระดับ", "ขั้น", "ชุด", "ค่า", "ตัว", "จุด", "ข้อ", "อัน", "สิ่ง",
    "เรื่อง", "งาน", "ระบบงาน", "ปัญหา", "วิธี", "แนวทาง", "เป้าหมาย", "หน้า", "ชื่อ", "เวลา", "จำนวน",
    "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า", "สิบ", "ร้อย", "พัน", "ล้าน",
    # Common English prose & instruction subwords
    "the ", "and ", "that ", "with ", "for ", "from ", "this ", "which ", "when ", "where ",
    "what ", "why ", "how ", "explain ", "describe ", "compare ", "summarize ", "verify ",
    "native ", "bilingual ", "model ", "training ", "validation ", "perplexity ", "checkpoint ",
    "architecture ", "tokenizer ", "streaming ", "inference ", "memory ", "security ", "sovereign ",
    "because ", "therefore ", "however ", "between ", "without ", "through ", "using ", "supports ",
    "provides ", "ensures ", "Thai ", "English ", "Thai", "English", "language ", "response ",
]


class SovereignTokenizer:
    SPECIAL_TOKENS = [
        "[PAD]", "[BOS]", "[EOS]", "[UNK]",
        "[PLAN]", "[CODE]", "[REVIEW]", "[TEST]", "[EVOLVE]",
        "[INPUT]", "[OUTPUT]", "[PASS]", "[FAIL]"
    ]
    SUPPORTED_PROFILES = ("v2_base", "bilingual_v4", "bilingual_bpe")

    def __init__(self, vocab_size: int = 16384, profile: str = "v2_base", bpe_merges: Optional[List[str]] = None):
        if profile not in self.SUPPORTED_PROFILES:
            raise ValueError(f"Unsupported tokenizer profile: {profile}. Must be one of {self.SUPPORTED_PROFILES}")
        self.vocab_size = vocab_size
        self.profile = profile
        self.bpe_merges: List[str] = list(bpe_merges) if bpe_merges else []
        self.token_to_id: Dict[str, int] = {}
        self.id_to_token: Dict[int, str] = {}
        self._max_subword_len = 20
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

        # 4. High-frequency code tokens, keywords, Thai subwords, and domain vocabulary (v2 baseline IDs 0..531)
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

        # 5. Bilingual v4 expansion appended strictly after v2 baseline slots (IDs >= 532)
        if self.profile in ("bilingual_v4", "bilingual_bpe"):
            for word in BILINGUAL_V4_SUBWORDS:
                if word not in self.token_to_id and curr_id < self.vocab_size:
                    self.token_to_id[word] = curr_id
                    self.id_to_token[curr_id] = word
                    curr_id += 1

        # 6. Data-driven BPE learned subword merges (appended after v4 slots in bilingual_bpe)
        if self.profile == "bilingual_bpe" and self.bpe_merges:
            for merged_tok in self.bpe_merges:
                if merged_tok and merged_tok not in self.token_to_id and curr_id < self.vocab_size:
                    self.token_to_id[merged_tok] = curr_id
                    self.id_to_token[curr_id] = merged_tok
                    curr_id += 1

        self._real_vocab_count = curr_id
        self._max_subword_len = max((len(k) for k in self.token_to_id.keys()), default=20)

        # Fill remaining slots up to vocab_size with deterministic byte-combination tokens
        while curr_id < self.vocab_size:
            dummy_token = f"<tok_{curr_id}>"
            self.token_to_id[dummy_token] = curr_id
            self.id_to_token[curr_id] = dummy_token
            curr_id += 1

    def encode(self, text: str) -> List[int]:
        """Encodes text to a list of token IDs with NFC normalization and longest-prefix match."""
        text = unicodedata.normalize("NFC", text)
        tokens: List[int] = []
        i = 0
        n = len(text)
        max_sub = min(20, self._max_subword_len)

        while i < n:
            matched = False
            max_len = min(max_sub, n - i)
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

    def decode_token(self, token_id: int, skip_instruction_markers: bool = False) -> str:
        """Decodes a single token ID to its string representation (filtering control/filler tokens)."""
        tok = self.id_to_token.get(token_id)
        if tok is None:
            return ""
        if tok.startswith("[") and tok.endswith("]") and tok not in ["[PLAN]", "[CODE]", "[REVIEW]", "[TEST]"]:
            return ""
        if tok.startswith("<tok_") and tok.endswith(">"):
            return ""
        if tok == "<|end|>":
            return ""
        if skip_instruction_markers and tok in INSTRUCTION_TOKENS:
            return ""
        return tok

    def decode(self, token_ids: List[int], skip_instruction_markers: bool = False) -> str:
        """Decodes token IDs back to a string."""
        return "".join(self.decode_token(tid, skip_instruction_markers=skip_instruction_markers) for tid in token_ids)

    @staticmethod
    def is_thai_combining(ch: str) -> bool:
        """True for Thai combining marks (vowels above/below, tone marks, diacritics) and general combining marks."""
        if not ch:
            return False
        cp = ord(ch)
        if cp in THAI_COMBINING_CODEPOINTS:
            return True
        return unicodedata.category(ch) in ("Mn", "Mc", "Me")

    @staticmethod
    def is_thai_cluster_follower(ch: str) -> bool:
        """True for Thai characters that attach to a preceding Thai base/tone cluster (combining marks + U+0E33 SARA AM)."""
        return SovereignTokenizer.is_thai_combining(ch) or ch == "\u0e33"

    @staticmethod
    def is_thai_base_consonant(ch: str) -> bool:
        """True for Thai base consonants ก–ฮ and ฤ/ฦ that can host trailing combining vowels or tone marks."""
        if not ch:
            return False
        cp = ord(ch)
        return (0x0E01 <= cp <= 0x0E2E) or cp in (0x0E24, 0x0E26)

    @classmethod
    def split_thai_safe_stream_prefix(cls, text: str, flush: bool = False) -> Tuple[str, str]:
        """
        Splits `text` into `(safe_to_emit, pending_tail)` so no emitted chunk ever ends
        mid-Thai grapheme cluster (e.g. a base consonant separated from its combining
        vowel/tone mark, or an orphan combining mark at the start of the next chunk).
        Non-Thai/ASCII/whitespace/punctuation characters emit immediately with zero delay.
        """
        if flush or not text:
            return text, ""

        idx = len(text)
        # Walk backwards across any trailing combining marks / SARA AM
        while idx > 0 and cls.is_thai_cluster_follower(text[idx - 1]):
            idx -= 1
        # If preceded by a Thai base consonant, keep the whole base+combining cluster together
        # until the next character confirms no further tone mark/vowel will attach.
        if idx > 0 and cls.is_thai_base_consonant(text[idx - 1]):
            idx -= 1

        # Safety bound: if a degenerate model emits >8 consecutive combining marks with no base,
        # flush the prefix so the stream never stalls.
        if idx == 0 and len(text) > 8:
            return text[:-1], text[-1:]

        return text[:idx], text[idx:]

    def create_stream_decoder(self, skip_instruction_markers: bool = False) -> "ThaiSafeStreamDecoder":
        return ThaiSafeStreamDecoder(self, skip_instruction_markers=skip_instruction_markers)

    def audit(self, sample_texts: Optional[List[str]] = None) -> Dict[str, object]:
        """Measures vocabulary composition, Thai Unicode coverage, compression ratio, and UNK rate."""
        import hashlib
        import json

        real_tokens = [
            self.id_to_token[i]
            for i in range(self._real_vocab_count)
        ]
        thai_codepoints_present = sum(
            1 for cp in range(0x0E01, 0x0E5C) if chr(cp) in self.token_to_id
        )
        thai_subwords = sum(
            1 for t in real_tokens if len(t) > 1 and any(0x0E01 <= ord(c) <= 0x0E5B for c in t)
        )
        english_code_subwords = sum(
            1 for t in real_tokens
            if len(t) > 1 and not t.startswith("[") and not t.startswith("<|") and not any(0x0E01 <= ord(c) <= 0x0E5B for c in t)
        )
        instruction_tokens = sum(1 for t in real_tokens if t in INSTRUCTION_TOKENS)
        fp = hashlib.sha256(json.dumps(real_tokens, ensure_ascii=False).encode("utf-8")).hexdigest()

        probes = sample_texts or [
            "ระบบ ZYNTHEOR คือสถาปัตยกรรมปัญญาประดิษฐ์อธิปไตยที่ทำงานอย่างอิสระ",
            "คำถาม: อธิบายความแตกต่างระหว่างโมเดลภาษาท้องถิ่นและระบบภายนอก\nคำตอบ:",
            "Sovereign NativeLM verifies checkpoint SHA-256 and streams Thai tokens safely.",
            "การตรวจสอบความปลอดภัยด้วย HMAC-SHA256 และ timingSafeEqual ในระบบภาษาไทยและอังกฤษ",
        ]
        unk_id = self.token_to_id["[UNK]"]
        probe_stats = []
        total_chars = 0
        total_tokens = 0
        total_unks = 0
        for p in probes:
            ids = self.encode(p)
            decoded = self.decode(ids)
            unks = sum(1 for tid in ids if tid == unk_id)
            total_chars += len(p)
            total_tokens += len(ids)
            total_unks += unks
            probe_stats.append({
                "chars": len(p),
                "tokens": len(ids),
                "chars_per_token": round(len(p) / max(1, len(ids)), 3),
                "unk_count": unks,
                "roundtrip_exact": decoded == unicodedata.normalize("NFC", p),
            })

        return {
            "profile": self.profile,
            "vocab_size": self.vocab_size,
            "real_vocab_size": self._real_vocab_count,
            "fingerprint_sha256": fp,
            "thai_unicode_block_coverage": {"covered": thai_codepoints_present, "total": 0x0E5C - 0x0E01},
            "thai_subwords": thai_subwords,
            "english_code_subwords": english_code_subwords,
            "instruction_tokens": instruction_tokens,
            "benchmark": {
                "total_chars": total_chars,
                "total_tokens": total_tokens,
                "avg_chars_per_token": round(total_chars / max(1, total_tokens), 3),
                "total_unks": total_unks,
                "probes": probe_stats,
            },
        }


class ThaiSafeStreamDecoder:
    """
    Stateful token-by-token decoder for streaming inference.
    Buffers only the trailing potentially-incomplete Thai grapheme cluster (typically 1-2 tokens),
    flushing ASCII/English/complete Thai syllables immediately and guaranteeing zero split marks.
    """

    def __init__(self, tokenizer: SovereignTokenizer, skip_instruction_markers: bool = False):
        self.tokenizer = tokenizer
        self.skip_instruction_markers = skip_instruction_markers
        self.pending: str = ""
        self.emitted_chunks: List[str] = []

    def push_token(self, token_id: int) -> str:
        piece = self.tokenizer.decode_token(
            token_id, skip_instruction_markers=self.skip_instruction_markers
        )
        if not piece:
            return ""
        self.pending += piece
        safe, self.pending = self.tokenizer.split_thai_safe_stream_prefix(self.pending, flush=False)
        if safe:
            self.emitted_chunks.append(safe)
        return safe

    def flush(self) -> str:
        if not self.pending:
            return ""
        safe, self.pending = self.tokenizer.split_thai_safe_stream_prefix(self.pending, flush=True)
        if safe:
            self.emitted_chunks.append(safe)
        return safe


def train_bpe_merges(
    texts: List[str],
    num_merges: int = 192,
    min_pair_freq: int = 3,
    base_profile: str = "bilingual_v4",
    max_token_len: int = 16,
) -> Dict[str, object]:
    """
    Learns frequent Thai/English/Code subword merges directly from curated corpus text
    via iterative pair-frequency BPE (pure Python, deterministic, lossless roundtrip).
    """
    from collections import Counter

    base_tok = SovereignTokenizer(vocab_size=16384, profile=base_profile)
    # Represent each text as a sequence of current token strings
    sequences: List[List[str]] = []
    for txt in texts:
        if not txt:
            continue
        ids = base_tok.encode(txt)
        seq = [base_tok.id_to_token[i] for i in ids if not base_tok.id_to_token[i].startswith("<tok_")]
        if len(seq) >= 2:
            sequences.append(seq)

    learned_merges: List[str] = []
    seen_tokens = set(base_tok.token_to_id.keys())
    initial_tokens = sum(len(s) for s in sequences)

    for _ in range(max(0, int(num_merges))):
        pair_counts: Counter = Counter()
        for seq in sequences:
            for j in range(len(seq) - 1):
                a, b = seq[j], seq[j + 1]
                # Skip control/special tokens and overly long tokens
                if (a.startswith("[") and a.endswith("]")) or (b.startswith("[") and b.endswith("]")):
                    continue
                if a.startswith("<|") or b.startswith("<|"):
                    continue
                cand = a + b
                if len(cand) > max_token_len or "\n" in cand:
                    continue
                if cand in seen_tokens:
                    continue
                pair_counts[(a, b)] += 1

        if not pair_counts:
            break
        (best_a, best_b), best_freq = pair_counts.most_common(1)[0]
        if best_freq < min_pair_freq:
            break
        merged = best_a + best_b
        learned_merges.append(merged)
        seen_tokens.add(merged)

        # Apply merge across all sequences
        new_sequences: List[List[str]] = []
        for seq in sequences:
            out_seq: List[str] = []
            idx = 0
            n_s = len(seq)
            while idx < n_s:
                if idx + 1 < n_s and seq[idx] == best_a and seq[idx + 1] == best_b:
                    out_seq.append(merged)
                    idx += 2
                else:
                    out_seq.append(seq[idx])
                    idx += 1
            new_sequences.append(out_seq)
        sequences = new_sequences

    final_tokens = sum(len(s) for s in sequences)
    compression_gain_pct = round(((initial_tokens - final_tokens) / max(1, initial_tokens)) * 100.0, 2)
    return {
        "base_profile": base_profile,
        "merges_learned": len(learned_merges),
        "merges": learned_merges,
        "initial_token_count": initial_tokens,
        "final_token_count": final_tokens,
        "compression_gain_pct": compression_gain_pct,
    }


