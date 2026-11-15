# -*- coding: utf-8 -*-
"""
ZYNTHEOR Native LM v2  (learned embeddings + causal sequence attention + tied head)

What changed relative to the v1 active subgraph (and why):
  * v1 mapped a token id to a FIXED sinusoidal vector (nothing learned on the input side),
    attended over a single token, and predicted `next_token % 128`, a lossy hash bucket.
  * v2 learns the token embedding table, attends causally over a context window, and
    predicts over the tokenizer's REAL vocabulary (ids that map to actual strings; the
    remaining `<tok_N>` filler ids are never produced). The output head is tied to the
    embedding table, so input and output share one learned representation.

Design notes
  * Depends on numpy only (see requirements-native.txt). v1 stays pure-Python and untouched.
  * Manual forward/backward (no autograd framework); correctness is enforced by
    finite-difference tests in tests/native-lm-v2.test.py.
  * Checkpoints reuse the ZYNTHEOR_QPLUS_PT container so CheckpointManager.inspect_checkpoint()
    verifies them (SHA-256 + Float32 count + manifest). Storage mode: LEARNED_WEIGHTS_TRAINED_V2.
"""
import os
import sys
import json
import time
import math
import struct
import hashlib
import shutil
from typing import Callable, Dict, List, Optional, Tuple, Any

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.architecture import TARGET_TOTAL_PARAMS

MAGIC_HEADER = b"ZYNTHEOR_QPLUS_PT"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V2_CHECKPOINT_PATH = os.path.join(ROOT, "native_data", "model_checkpoint_v2.pt")
V4_THAI_CHECKPOINT_PATH = os.path.join(ROOT, "native_data", "model_checkpoint_v4_thai.pt")
STORAGE_MODE = "LEARNED_WEIGHTS_TRAINED_V2"


def real_vocab_size(tok: SovereignTokenizer) -> int:
    """Number of ids that carry a real string (excludes `<tok_N>` filler ids)."""
    return max(i for i, s in tok.id_to_token.items() if not (s.startswith("<tok_") and s.endswith(">"))) + 1


def tokenizer_fingerprint(tok: SovereignTokenizer, n: int) -> str:
    items = [tok.id_to_token[i] for i in range(n)]
    return hashlib.sha256(json.dumps(items, ensure_ascii=False).encode("utf-8")).hexdigest()


class LMConfig:
    def __init__(self, vocab: int, d_model: int = 128, n_layers: int = 2, n_heads: int = 4,
                 d_ffn: int = 384, ctx: int = 64):
        assert d_model % n_heads == 0
        self.vocab, self.d_model, self.n_layers = vocab, d_model, n_layers
        self.n_heads, self.d_ffn, self.ctx = n_heads, d_ffn, ctx

    def to_dict(self) -> Dict[str, int]:
        return dict(vocab=self.vocab, d_model=self.d_model, n_layers=self.n_layers,
                    n_heads=self.n_heads, d_ffn=self.d_ffn, ctx=self.ctx)


# ---------------------------------------------------------------- primitives
EPS = 1e-6


def rms_fwd(x, g):
    r = 1.0 / np.sqrt(np.mean(x * x, axis=-1, keepdims=True) + EPS)
    return x * r * g, (x, r, g)


def rms_bwd(dy, cache):
    x, r, g = cache
    d = x.shape[-1]
    dg = np.sum(dy * x * r, axis=tuple(range(dy.ndim - 1)))
    dxh = dy * g
    dx = r * dxh - x * (r ** 3) / d * np.sum(dxh * x, axis=-1, keepdims=True)
    return dx, dg


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30.0, 30.0)))


class NativeLM:
    def __init__(self, cfg: LMConfig, seed: int = 1234, dtype=np.float64, tokenizer_profile: str = "v2_base"):
        self.cfg = cfg
        self.dtype = dtype
        self.tokenizer_profile = tokenizer_profile
        rng = np.random.default_rng(seed)
        d, f, L = cfg.d_model, cfg.d_ffn, cfg.n_layers
        std = 0.02
        res_std = std / math.sqrt(2 * L)
        P: Dict[str, np.ndarray] = {}
        P["tok_emb"] = rng.normal(0, std, (cfg.vocab, d))
        P["pos_emb"] = rng.normal(0, std, (cfg.ctx, d))
        for l in range(L):
            P[f"b{l}.norm1"] = np.ones(d)
            P[f"b{l}.wq"] = rng.normal(0, std, (d, d))
            P[f"b{l}.wk"] = rng.normal(0, std, (d, d))
            P[f"b{l}.wv"] = rng.normal(0, std, (d, d))
            P[f"b{l}.wo"] = rng.normal(0, res_std, (d, d))
            P[f"b{l}.norm2"] = np.ones(d)
            P[f"b{l}.w_gate"] = rng.normal(0, std, (d, f))
            P[f"b{l}.w_up"] = rng.normal(0, std, (d, f))
            P[f"b{l}.w_down"] = rng.normal(0, res_std, (f, d))
        P["norm_f"] = np.ones(d)
        self.p = {k: v.astype(dtype) for k, v in P.items()}

    # ------------------------------------------------------------ bookkeeping
    def param_names(self) -> List[str]:
        return list(self.p.keys())

    def num_params(self) -> int:
        return int(sum(v.size for v in self.p.values()))

    @staticmethod
    def _parameter_shapes(cfg: LMConfig) -> Dict[str, Tuple[int, ...]]:
        d, f = cfg.d_model, cfg.d_ffn
        shapes: Dict[str, Tuple[int, ...]] = {
            "tok_emb": (cfg.vocab, d),
            "pos_emb": (cfg.ctx, d),
        }
        for layer in range(cfg.n_layers):
            shapes.update({
                f"b{layer}.norm1": (d,),
                f"b{layer}.wq": (d, d),
                f"b{layer}.wk": (d, d),
                f"b{layer}.wv": (d, d),
                f"b{layer}.wo": (d, d),
                f"b{layer}.norm2": (d,),
                f"b{layer}.w_gate": (d, f),
                f"b{layer}.w_up": (d, f),
                f"b{layer}.w_down": (f, d),
            })
        shapes["norm_f"] = (d,)
        return shapes

    # ---------------------------------------------------------------- forward
    def forward(self, tokens: np.ndarray, keep_cache: bool = False):
        """tokens: int array [B,T] with T <= ctx. Returns logits [B,T,V] (and cache)."""
        c, p = self.cfg, self.p
        B, T = tokens.shape
        assert T <= c.ctx
        H, dh = c.n_heads, c.d_model // c.n_heads
        x = p["tok_emb"][tokens] + p["pos_emb"][:T][None]
        caches = []
        mask = np.triu(np.ones((T, T), dtype=bool), 1)
        for l in range(c.n_layers):
            n1, rc1 = rms_fwd(x, p[f"b{l}.norm1"])
            q = (n1 @ p[f"b{l}.wq"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            k = (n1 @ p[f"b{l}.wk"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            v = (n1 @ p[f"b{l}.wv"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            s = (q @ k.transpose(0, 1, 3, 2)) / math.sqrt(dh)
            s = np.where(mask, -1e30, s)
            s = s - s.max(-1, keepdims=True)
            e = np.exp(s)
            pr = e / e.sum(-1, keepdims=True)
            o = (pr @ v).transpose(0, 2, 1, 3).reshape(B, T, c.d_model)
            x1 = x + o @ p[f"b{l}.wo"]
            n2, rc2 = rms_fwd(x1, p[f"b{l}.norm2"])
            gate = n2 @ p[f"b{l}.w_gate"]
            up = n2 @ p[f"b{l}.w_up"]
            sig = _sigmoid(gate)
            hid = gate * sig * up
            x2 = x1 + hid @ p[f"b{l}.w_down"]
            if keep_cache:
                caches.append(dict(rc1=rc1, n1=n1, q=q, k=k, v=v, pr=pr, o=o, rc2=rc2, n2=n2,
                                   gate=gate, up=up, sig=sig, hid=hid))
            x = x2
        nf, rcf = rms_fwd(x, p["norm_f"])
        logits = nf @ p["tok_emb"].T
        if keep_cache:
            return logits, dict(tokens=tokens, blocks=caches, rcf=rcf, nf=nf)
        return logits, None

    # ------------------------------------------------------------------- loss
    @staticmethod
    def ce_loss(logits: np.ndarray, targets: np.ndarray) -> Tuple[float, np.ndarray]:
        B, T, V = logits.shape
        z = logits - logits.max(-1, keepdims=True)
        lse = np.log(np.exp(z).sum(-1))
        pick = np.take_along_axis(z, targets[..., None], -1)[..., 0]
        loss = float(np.mean(lse - pick))
        pr = np.exp(z - lse[..., None])
        pr[np.arange(B)[:, None], np.arange(T)[None, :], targets] -= 1.0
        return loss, pr / (B * T)

    # --------------------------------------------------------------- backward
    def backward(self, dlogits: np.ndarray, cache) -> Dict[str, np.ndarray]:
        c, p = self.cfg, self.p
        tokens = cache["tokens"]
        B, T = tokens.shape
        H, dh = c.n_heads, c.d_model // c.n_heads
        g = {k: np.zeros_like(v) for k, v in p.items()}
        nf = cache["nf"]
        g["tok_emb"] += dlogits.reshape(-1, c.vocab).T @ nf.reshape(-1, c.d_model)
        dnf = dlogits @ p["tok_emb"]
        dx, g["norm_f"] = rms_bwd(dnf, cache["rcf"])
        for l in reversed(range(c.n_layers)):
            bc = cache["blocks"][l]
            # --- FFN
            df = dx
            hid2 = bc["hid"].reshape(-1, c.d_ffn)
            g[f"b{l}.w_down"] += hid2.T @ df.reshape(-1, c.d_model)
            dhid = df @ p[f"b{l}.w_down"].T
            gate, up, sig = bc["gate"], bc["up"], bc["sig"]
            dup = dhid * gate * sig
            dgate = dhid * up * (sig * (1.0 + gate * (1.0 - sig)))
            n2f = bc["n2"].reshape(-1, c.d_model)
            g[f"b{l}.w_gate"] += n2f.T @ dgate.reshape(-1, c.d_ffn)
            g[f"b{l}.w_up"] += n2f.T @ dup.reshape(-1, c.d_ffn)
            dn2 = dgate @ p[f"b{l}.w_gate"].T + dup @ p[f"b{l}.w_up"].T
            dx1_n, g[f"b{l}.norm2"] = rms_bwd(dn2, bc["rc2"])
            dx1 = dx + dx1_n
            # --- attention
            da = dx1
            of = bc["o"].reshape(-1, c.d_model)
            g[f"b{l}.wo"] += of.T @ da.reshape(-1, c.d_model)
            do = (da @ p[f"b{l}.wo"].T).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            pr, q, k, v = bc["pr"], bc["q"], bc["k"], bc["v"]
            dpr = do @ v.transpose(0, 1, 3, 2)
            dv = pr.transpose(0, 1, 3, 2) @ do
            ds = pr * (dpr - np.sum(dpr * pr, axis=-1, keepdims=True))
            sc = 1.0 / math.sqrt(dh)
            dq = (ds @ k) * sc
            dk = (ds.transpose(0, 1, 3, 2) @ q) * sc

            def merge(t):
                return t.transpose(0, 2, 1, 3).reshape(B, T, c.d_model)
            dq, dk, dv = merge(dq), merge(dk), merge(dv)
            n1f = bc["n1"].reshape(-1, c.d_model)
            g[f"b{l}.wq"] += n1f.T @ dq.reshape(-1, c.d_model)
            g[f"b{l}.wk"] += n1f.T @ dk.reshape(-1, c.d_model)
            g[f"b{l}.wv"] += n1f.T @ dv.reshape(-1, c.d_model)
            dn1 = dq @ p[f"b{l}.wq"].T + dk @ p[f"b{l}.wk"].T + dv @ p[f"b{l}.wv"].T
            dxn, g[f"b{l}.norm1"] = rms_bwd(dn1, bc["rc1"])
            dx = dx1 + dxn
        g["pos_emb"][:T] += dx.sum(axis=0)
        np.add.at(g["tok_emb"], tokens, dx)
        return g

    # ------------------------------------------------------------- generation
    def next_token_logits(self, ids: List[int]) -> np.ndarray:
        c, p = self.cfg, self.p
        window = np.array(ids[-c.ctx:], dtype=np.int64)[None]
        B, T = window.shape
        H, dh = c.n_heads, c.d_model // c.n_heads
        x = p["tok_emb"][window] + p["pos_emb"][:T][None]
        mask = np.triu(np.ones((T, T), dtype=bool), 1)
        for l in range(c.n_layers):
            n1, _ = rms_fwd(x, p[f"b{l}.norm1"])
            q = (n1 @ p[f"b{l}.wq"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            k = (n1 @ p[f"b{l}.wk"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            v = (n1 @ p[f"b{l}.wv"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            s = (q @ k.transpose(0, 1, 3, 2)) / math.sqrt(dh)
            s = np.where(mask, -1e30, s)
            s = s - s.max(-1, keepdims=True)
            e = np.exp(s)
            pr = e / e.sum(-1, keepdims=True)
            o = (pr @ v).transpose(0, 2, 1, 3).reshape(B, T, c.d_model)
            x1 = x + o @ p[f"b{l}.wo"]
            n2, _ = rms_fwd(x1, p[f"b{l}.norm2"])
            gate = n2 @ p[f"b{l}.w_gate"]
            up = n2 @ p[f"b{l}.w_up"]
            x = x1 + (gate * _sigmoid(gate) * up) @ p[f"b{l}.w_down"]
        nf_last, _ = rms_fwd(x[:, -1:, :], p["norm_f"])
        logits_last = nf_last @ p["tok_emb"].T
        return logits_last[0, 0]

    def _prefill_kv(self, ids: List[int]) -> Tuple[np.ndarray, List[Tuple[np.ndarray, np.ndarray]]]:
        """Exact causal prefill for len(ids) <= cfg.ctx returning (last_logits, kv_cache)."""
        c, p = self.cfg, self.p
        window = np.array(ids, dtype=np.int64)[None]
        B, T = window.shape
        assert T <= c.ctx
        H, dh = c.n_heads, c.d_model // c.n_heads
        x = p["tok_emb"][window] + p["pos_emb"][:T][None]
        mask = np.triu(np.ones((T, T), dtype=bool), 1)
        kv_cache: List[Tuple[np.ndarray, np.ndarray]] = []
        for l in range(c.n_layers):
            n1, _ = rms_fwd(x, p[f"b{l}.norm1"])
            q = (n1 @ p[f"b{l}.wq"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            k = (n1 @ p[f"b{l}.wk"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            v = (n1 @ p[f"b{l}.wv"]).reshape(B, T, H, dh).transpose(0, 2, 1, 3)
            kv_cache.append((k, v))
            s = (q @ k.transpose(0, 1, 3, 2)) / math.sqrt(dh)
            s = np.where(mask, -1e30, s)
            s = s - s.max(-1, keepdims=True)
            e = np.exp(s)
            pr = e / e.sum(-1, keepdims=True)
            o = (pr @ v).transpose(0, 2, 1, 3).reshape(B, T, c.d_model)
            x1 = x + o @ p[f"b{l}.wo"]
            n2, _ = rms_fwd(x1, p[f"b{l}.norm2"])
            gate = n2 @ p[f"b{l}.w_gate"]
            up = n2 @ p[f"b{l}.w_up"]
            x = x1 + (gate * _sigmoid(gate) * up) @ p[f"b{l}.w_down"]
        nf_last, _ = rms_fwd(x[:, -1:, :], p["norm_f"])
        logits_last = nf_last @ p["tok_emb"].T
        return logits_last[0, 0], kv_cache

    def _step_kv(self, token_id: int, pos: int, kv_cache: List[Tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
        """Exact single-token causal decode step at pos < cfg.ctx updating kv_cache in place."""
        c, p = self.cfg, self.p
        H, dh = c.n_heads, c.d_model // c.n_heads
        x = p["tok_emb"][token_id][None, None, :] + p["pos_emb"][pos][None, None, :]
        for l in range(c.n_layers):
            n1, _ = rms_fwd(x, p[f"b{l}.norm1"])
            q = (n1 @ p[f"b{l}.wq"]).reshape(1, 1, H, dh).transpose(0, 2, 1, 3)
            k_new = (n1 @ p[f"b{l}.wk"]).reshape(1, 1, H, dh).transpose(0, 2, 1, 3)
            v_new = (n1 @ p[f"b{l}.wv"]).reshape(1, 1, H, dh).transpose(0, 2, 1, 3)
            k_prev, v_prev = kv_cache[l]
            k = np.concatenate([k_prev, k_new], axis=2)
            v = np.concatenate([v_prev, v_new], axis=2)
            kv_cache[l] = (k, v)
            s = (q @ k.transpose(0, 1, 3, 2)) / math.sqrt(dh)
            s = s - s.max(-1, keepdims=True)
            e = np.exp(s)
            pr = e / e.sum(-1, keepdims=True)
            o = (pr @ v).transpose(0, 2, 1, 3).reshape(1, 1, c.d_model)
            x1 = x + o @ p[f"b{l}.wo"]
            n2, _ = rms_fwd(x1, p[f"b{l}.norm2"])
            gate = n2 @ p[f"b{l}.w_gate"]
            up = n2 @ p[f"b{l}.w_up"]
            x = x1 + (gate * _sigmoid(gate) * up) @ p[f"b{l}.w_down"]
        nf_last, _ = rms_fwd(x, p["norm_f"])
        logits_last = nf_last @ p["tok_emb"].T
        return logits_last[0, 0]

    def generate_ids_stream(
        self,
        prompt_ids: List[int],
        max_new_tokens: int = 64,
        temperature: float = 0.8,
        top_k: int = 20,
        seed: Optional[int] = None,
        stop_ids: Optional[set] = None,
        repetition_penalty: float = 1.08,
        rep_window: int = 64,
        no_repeat_ngram: int = 0,
        top_p: float = 1.0,
        cancel_check: Optional[Callable[[], bool]] = None,
    ):
        """True token-by-token autoregressive generator yielding each sampled token ID immediately."""
        if not (1.0 <= repetition_penalty <= 3.0):
            raise ValueError("repetition_penalty must be within [1.0, 3.0]")
        if not (0.0 < top_p <= 1.0):
            raise ValueError("top_p must be within (0.0, 1.0]")
        if no_repeat_ngram not in (0,) and not (2 <= no_repeat_ngram <= 8):
            raise ValueError("no_repeat_ngram must be 0 or within [2, 8]")
        rng = np.random.default_rng(seed)
        ids = list(prompt_ids) if prompt_ids else [1]  # [BOS]
        if not hasattr(self, "_real_vocab_cache"):
            prof = getattr(self, "tokenizer_profile", "v2_base")
            self._real_vocab_cache = min(
                self.cfg.vocab,
                real_vocab_size(SovereignTokenizer(self.cfg.vocab, profile=prof)),
            )
        real_vocab = self._real_vocab_cache
        kv_cache: Optional[List[Tuple[np.ndarray, np.ndarray]]] = None
        for step_idx in range(max_new_tokens):
            if cancel_check is not None and cancel_check():
                break
            if step_idx == 0 and len(ids) <= self.cfg.ctx:
                raw_lg, kv_cache = self._prefill_kv(ids)
            elif kv_cache is not None and len(ids) <= self.cfg.ctx:
                raw_lg = self._step_kv(ids[-1], len(ids) - 1, kv_cache)
            else:
                kv_cache = None
                raw_lg = self.next_token_logits(ids)
            if not np.all(np.isfinite(raw_lg)):
                raise RuntimeError("FAIL_CLOSED: non-finite logits detected during NativeLM decoding")
            lg = raw_lg.astype(np.float64, copy=True)
            lg[:4] = -1e30  # never emit [PAD] [BOS] [EOS] [UNK] as content
            lg[real_vocab:] = -1e30  # never emit tokenizer filler ids
            if repetition_penalty > 1.0:
                recent = ids[-rep_window:] if rep_window > 0 else ids
                for token_id in set(recent):
                    if 4 <= token_id < real_vocab:
                        lg[token_id] = (lg[token_id] / repetition_penalty
                                        if lg[token_id] > 0 else lg[token_id] * repetition_penalty)
            if no_repeat_ngram >= 2 and len(ids) >= no_repeat_ngram - 1:
                prefix = tuple(ids[len(ids) - (no_repeat_ngram - 1):])
                for pos in range(len(ids) - no_repeat_ngram + 1):
                    if tuple(ids[pos:pos + no_repeat_ngram - 1]) == prefix:
                        banned = ids[pos + no_repeat_ngram - 1]
                        if 0 <= banned < lg.size:
                            lg[banned] = -1e30
                # Fallback if all valid tokens were blocked by n-gram constraint
                if np.all(lg[4:real_vocab] <= -1e29):
                    lg = raw_lg.astype(np.float64, copy=True)
                    lg[:4] = -1e30
                    lg[real_vocab:] = -1e30
            if temperature <= 0:
                nxt = int(np.argmax(lg))
            else:
                lg = lg / temperature
                if top_k and top_k < lg.size:
                    kth = np.partition(lg, -top_k)[-top_k]
                    lg = np.where(lg < kth, -1e30, lg)
                pr = np.exp(lg - lg.max())
                pr /= pr.sum()
                if top_p < 1.0:
                    order = np.argsort(-pr)
                    csum = np.cumsum(pr[order])
                    keep = order[: int(np.searchsorted(csum, top_p) + 1)]
                    masked = np.zeros_like(pr)
                    masked[keep] = pr[keep]
                    pr = masked / masked.sum()
                nxt = int(rng.choice(lg.size, p=pr))
            ids.append(nxt)
            yield nxt
            if stop_ids and nxt in stop_ids:
                break

    def generate_ids(self, prompt_ids: List[int], max_new_tokens: int = 64, temperature: float = 0.8,
                     top_k: int = 20, seed: Optional[int] = None, stop_ids: Optional[set] = None,
                     repetition_penalty: float = 1.08, rep_window: int = 64,
                     no_repeat_ngram: int = 0, top_p: float = 1.0) -> List[int]:
        return list(
            self.generate_ids_stream(
                prompt_ids,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                top_k=top_k,
                seed=seed,
                stop_ids=stop_ids,
                repetition_penalty=repetition_penalty,
                rep_window=rep_window,
                no_repeat_ngram=no_repeat_ngram,
                top_p=top_p,
            )
        )

    @classmethod
    def warm_start_from(
        cls,
        base_model: "NativeLM",
        base_tok: SovereignTokenizer,
        new_tok: SovereignTokenizer,
        seed: int = 7,
        dtype=np.float32,
    ) -> "NativeLM":
        """
        Creates an expanded-vocab NativeLM initialized from `base_model` weights.
        Overlapping token rows [0..base_vocab) are copied directly; newly added subwords
        are initialized from the mean of their base-tokenizer constituent embeddings.
        """
        new_vocab = real_vocab_size(new_tok)
        assert base_model.cfg.d_model == base_model.cfg.d_model
        new_cfg = LMConfig(
            vocab=new_vocab,
            d_model=base_model.cfg.d_model,
            n_layers=base_model.cfg.n_layers,
            n_heads=base_model.cfg.n_heads,
            d_ffn=base_model.cfg.d_ffn,
            ctx=base_model.cfg.ctx,
        )
        out = cls(new_cfg, seed=seed, dtype=dtype, tokenizer_profile=new_tok.profile)
        for name, arr in base_model.p.items():
            if name == "tok_emb":
                shared = min(base_model.cfg.vocab, new_vocab)
                out.p["tok_emb"][:shared] = arr[:shared].astype(dtype)
            else:
                out.p[name] = arr.astype(dtype, copy=True)

        rng = np.random.default_rng(seed)
        base_emb = base_model.p["tok_emb"].astype(np.float64)
        for tid in range(base_model.cfg.vocab, new_vocab):
            subword = new_tok.id_to_token.get(tid, "")
            parts = base_tok.encode(subword) if subword else []
            valid_parts = [p for p in parts if 0 <= p < base_emb.shape[0]]
            if valid_parts:
                vec = base_emb[valid_parts].mean(axis=0) + rng.normal(0.0, 1e-3, size=new_cfg.d_model)
                out.p["tok_emb"][tid] = vec.astype(dtype)
        return out

    # ------------------------------------------------------------ checkpoints
    def flat_float32(self) -> bytes:
        return b"".join(self.p[n].astype("<f4").tobytes() for n in self.param_names())

    def to_bytes(self, tok: SovereignTokenizer, extra_meta: Optional[Dict[str, Any]] = None) -> Tuple[bytes, Dict[str, Any]]:
        payload = self.flat_float32()
        manifest = [{"name": n, "shape": list(self.p[n].shape), "params": int(self.p[n].size), "dtype": "float32",
                     "sha256": hashlib.sha256(self.p[n].astype("<f4").tobytes()).hexdigest()} for n in self.param_names()]
        meta = {
            "model_name": "ZYNTHEOR Q+ Native LM",
            "architecture": "ZYNTHEOR-NativeLM-v2-TiedEmbedding-CausalAttention",
            "version": "2.0.0",
            "storage_mode": STORAGE_MODE,
            "config": self.cfg.to_dict(),
            "total_params": self.num_params(),
            "trained_subgraph_params": self.num_params(),
            "target_total_params": TARGET_TOTAL_PARAMS,
            "tokenizer_profile": getattr(tok, "profile", getattr(self, "tokenizer_profile", "v2_base")),
            "tokenizer_fingerprint": tokenizer_fingerprint(tok, self.cfg.vocab),
            "parameter_audit": {"status": "VERIFIED_V2_FULL_GRAPH", "payload_float32_count": self.num_params(),
                                "target_architecture_instantiated": False,
                                "note": "Measured graph. 41,527,808 target is a roadmap spec, not this checkpoint."},
            "sha256": hashlib.sha256(payload).hexdigest(),
            "tensors_manifest": manifest,
            "timestamp": int(time.time()),
        }
        if extra_meta:
            meta.update(extra_meta)
        mj = json.dumps(meta, indent=2).encode("utf-8")
        return MAGIC_HEADER + struct.pack(">I", len(mj)) + mj + payload, meta

    def save(self, path: str, tok: SovereignTokenizer, extra_meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        container, meta = self.to_bytes(tok, extra_meta=extra_meta)
        tmp = path + ".tmp"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, "wb") as f:
            f.write(container)
        os.replace(tmp, path)
        return meta

    @staticmethod
    def load_bytes(
        raw: bytes,
        tok: Optional[SovereignTokenizer] = None,
        *,
        dtype: Any = np.float64,
    ) -> Tuple["NativeLM", Dict[str, Any]]:
        """Fail-closed load with optional float32 inference to reduce memory use."""
        if len(raw) < len(MAGIC_HEADER) + 4 or raw[:len(MAGIC_HEADER)] != MAGIC_HEADER:
            raise RuntimeError("FAIL_CLOSED: bad magic in v2 checkpoint")
        dtype = np.dtype(dtype)
        if dtype not in (np.dtype(np.float32), np.dtype(np.float64)):
            raise ValueError("Checkpoint load dtype must be float32 or float64")
        ml = struct.unpack(">I", raw[len(MAGIC_HEADER):len(MAGIC_HEADER) + 4])[0]
        meta_start = len(MAGIC_HEADER) + 4
        meta_end = meta_start + ml
        if meta_end > len(raw):
            raise RuntimeError("FAIL_CLOSED: truncated v2 checkpoint metadata")
        meta = json.loads(raw[meta_start:meta_end].decode("utf-8"))
        payload = raw[meta_end:]
        if meta.get("storage_mode") != STORAGE_MODE:
            raise RuntimeError(f"FAIL_CLOSED: storage_mode {meta.get('storage_mode')} is not {STORAGE_MODE}")
        if hashlib.sha256(payload).hexdigest() != meta.get("sha256"):
            raise RuntimeError("FAIL_CLOSED: v2 checkpoint SHA-256 mismatch")
        cfg = LMConfig(**meta["config"])
        profile = meta.get("tokenizer_profile") or ("bilingual_v4" if cfg.vocab > 532 else "v2_base")
        tok = tok or SovereignTokenizer(max(16384, cfg.vocab), profile=profile)
        shapes = NativeLM._parameter_shapes(cfg)
        parameter_count = sum(int(np.prod(shape)) for shape in shapes.values())
        if len(payload) != 4 * parameter_count or meta.get("total_params") != parameter_count:
            raise RuntimeError("FAIL_CLOSED: v2 payload size does not match graph")
        if meta.get("tokenizer_fingerprint") != tokenizer_fingerprint(tok, cfg.vocab):
            raise RuntimeError("FAIL_CLOSED: tokenizer vocabulary differs from the one used in training")
        model = NativeLM.__new__(NativeLM)
        model.cfg = cfg
        model.dtype = dtype
        model.tokenizer_profile = tok.profile
        model.p = {}
        flat = np.frombuffer(payload, dtype="<f4")
        off = 0
        for n, shape in shapes.items():
            sz = int(np.prod(shape))
            model.p[n] = flat[off:off + sz].reshape(shape).astype(dtype, copy=True)
            off += sz
        assert off == flat.size
        return model, meta

    @staticmethod
    def load(
        path: str,
        tok: Optional[SovereignTokenizer] = None,
        *,
        dtype: Any = np.float64,
    ) -> Tuple["NativeLM", Dict[str, Any]]:
        """Fail-closed load from file path (used by offline training scripts only)."""
        with open(path, "rb") as f:
            raw = f.read()
        return NativeLM.load_bytes(raw, tok=tok, dtype=dtype)


# ---------------------------------------------------------------- optimizer
class AdamW:
    def __init__(self, model: NativeLM, lr: float, weight_decay: float = 0.01, betas=(0.9, 0.98), eps: float = 1e-8):
        if not (1e-6 <= lr <= 1e-2):
            raise ValueError("lr must be within [1e-6, 1e-2]")
        if not (0.0 <= weight_decay <= 0.1):
            raise ValueError("weight_decay must be within [0, 0.1]")
        self.m = {k: np.zeros_like(v) for k, v in model.p.items()}
        self.v = {k: np.zeros_like(v) for k, v in model.p.items()}
        self.lr, self.wd, self.b1, self.b2, self.eps, self.t = lr, weight_decay, betas[0], betas[1], eps, 0

    def step(self, model: NativeLM, grads: Dict[str, np.ndarray], lr: Optional[float] = None, clip: float = 1.0) -> float:
        total = math.sqrt(sum(float(np.sum(g * g)) for g in grads.values()))
        scale = clip / total if total > clip else 1.0
        self.t += 1
        lr = self.lr if lr is None else lr
        for k, w in model.p.items():
            gk = grads[k] * scale
            self.m[k] = self.b1 * self.m[k] + (1 - self.b1) * gk
            self.v[k] = self.b2 * self.v[k] + (1 - self.b2) * gk * gk
            mh = self.m[k] / (1 - self.b1 ** self.t)
            vh = self.v[k] / (1 - self.b2 ** self.t)
            if w.ndim == 2 and k not in ("tok_emb", "pos_emb"):
                w -= lr * self.wd * w  # decoupled decay on weight matrices only
            w -= lr * mh / (np.sqrt(vh) + self.eps)
        return total
