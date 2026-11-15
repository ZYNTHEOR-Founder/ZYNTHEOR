# -*- coding: utf-8 -*-
"""
ZYNTHEOR Pure-Python Causal Sequence Language Model (PureSeqLM)

Closes the pure-Python intelligence gap when NumPy / external packages are unavailable:
  * Unlike legacy v1 (which used fixed sinusoidal embeddings, 1-token context, and a
    lossy `token_id % 128` bucket), PureSeqLM learns token + positional embeddings,
    runs causal multi-head self-attention across sequence context, and predicts over the
    tokenizer's real vocabulary using tied embeddings (`nf @ tok_emb.T`).
  * Implements exact analytical forward + backpropagation + AdamW + gradient clipping
    with zero external dependencies (Python stdlib `array('f')` & `math` only).
  * Enforces regression gating on held-out validation NLL / Perplexity / Bits-Per-Byte
    and saves verified `ZYNTHEOR_QPLUS_PT` checkpoints (`LEARNED_WEIGHTS_SEQ_PURE_PY`).
"""

import array
import hashlib
import json
import math
import os
import random
import struct
import sys
import tempfile
import time
import uuid
from typing import Any, Callable, Dict, Generator, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.tokenizer import SovereignTokenizer, train_bpe_merges

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PURE_SEQ_CHECKPOINT_PATH = os.path.join(ROOT, "native_data", "model_checkpoint_seq_pure.pt")
PURE_SEQ_EVIDENCE_PATH = os.path.join(ROOT, "artifacts", "seq-pure-training-evidence.json")
MAGIC_HEADER = b"ZYNTHEOR_QPLUS_PT"
STORAGE_MODE = "LEARNED_WEIGHTS_SEQ_PURE_PY"
CHECKPOINT_FORMAT_VERSION = 2
RESUME_STATE_FORMAT_VERSION = 1
EPS = 1e-6


def _checkpoint_manifest_path(path: str) -> str:
    return f"{path}.manifest.json"


def _checkpoint_resume_path(path: str) -> str:
    return f"{path}.resume.json"


def _atomic_write(path: str, data: bytes, overwrite: bool = False) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, temporary_path = tempfile.mkstemp(
        prefix=f".{os.path.basename(path)}.", suffix=".tmp", dir=directory
    )
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if overwrite:
            os.replace(temporary_path, path)
        else:
            # Linking a completed same-filesystem temporary file is atomic and refuses
            # to replace an existing checkpoint or metadata file.
            os.link(temporary_path, path)
            os.unlink(temporary_path)
        try:
            directory_fd = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
    except Exception:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)
        raise


def verify_checkpoint_bundle(path: str, require_resume_state: bool = False) -> Dict[str, Any]:
    """Validates checkpoint weights, manifest, and optional optimizer/RNG sidecar."""
    try:
        model, metadata = PureSeqLM.load(path, tok=None)
        with open(path, "rb") as stream:
            file_sha256 = hashlib.sha256(stream.read()).hexdigest()
        manifest_path = _checkpoint_manifest_path(path)
        manifest = None
        if os.path.exists(manifest_path):
            with open(manifest_path, "r", encoding="utf-8") as stream:
                manifest = json.load(stream)
            if manifest.get("manifest_version") != 1:
                raise RuntimeError("FAIL_CLOSED: unsupported checkpoint manifest version")
            if manifest.get("checkpoint_file") != os.path.basename(path):
                raise RuntimeError("FAIL_CLOSED: checkpoint manifest filename mismatch")
            if manifest.get("checkpoint_file_sha256") != file_sha256:
                raise RuntimeError("FAIL_CLOSED: checkpoint file SHA-256 mismatch")
            if manifest.get("payload_sha256") != metadata.get("sha256"):
                raise RuntimeError("FAIL_CLOSED: checkpoint payload SHA-256 mismatch")
            if manifest.get("checkpoint_id") != metadata.get("checkpoint_id"):
                raise RuntimeError("FAIL_CLOSED: checkpoint ID mismatch")
            if (
                manifest.get("config") != metadata.get("config")
                or manifest.get("tokenizer_sha256") != metadata.get("tokenizer_sha256")
            ):
                raise RuntimeError("FAIL_CLOSED: checkpoint manifest architecture/tokenizer mismatch")
            if (
                manifest.get("lifecycle_state") not in {
                    "NOT_CREATED", "CREATED", "TRAINING", "TRAINED", "VALIDATING",
                    "READY", "FAILED", "INCOMPATIBLE",
                }
                or manifest.get("checkpoint_lifecycle") != manifest.get("lifecycle_state")
            ):
                raise RuntimeError("FAIL_CLOSED: invalid checkpoint lifecycle metadata")
        elif require_resume_state:
            raise RuntimeError("FAIL_CLOSED: checkpoint manifest is missing")

        resume_state = None
        resume_name = metadata.get("resume_state_file")
        resume_sha256 = metadata.get("resume_state_sha256")
        if resume_name:
            if os.path.basename(resume_name) != resume_name:
                raise RuntimeError("FAIL_CLOSED: invalid checkpoint resume-state filename")
            resume_path = os.path.join(os.path.dirname(os.path.abspath(path)), resume_name)
            if not os.path.isfile(resume_path):
                raise RuntimeError("FAIL_CLOSED: checkpoint resume-state file is missing")
            with open(resume_path, "rb") as stream:
                resume_bytes = stream.read()
            if hashlib.sha256(resume_bytes).hexdigest() != resume_sha256:
                raise RuntimeError("FAIL_CLOSED: checkpoint resume-state SHA-256 mismatch")
            resume_state = json.loads(resume_bytes.decode("utf-8"))
            if (
                resume_state.get("format_version") != RESUME_STATE_FORMAT_VERSION
                or resume_state.get("checkpoint_id") != metadata.get("checkpoint_id")
            ):
                raise RuntimeError("FAIL_CLOSED: incompatible checkpoint resume-state metadata")
            if manifest and (
                manifest.get("resume_state_file") != resume_name
                or manifest.get("resume_state_sha256") != resume_sha256
            ):
                raise RuntimeError("FAIL_CLOSED: checkpoint manifest resume-state mismatch")
        elif require_resume_state:
            raise RuntimeError("FAIL_CLOSED: checkpoint has no resumable optimizer state")

        return {
            "valid": True,
            "sha256": metadata["sha256"],
            "file_sha256": file_sha256,
            "total_params": model.num_params(),
            "storage_mode": metadata.get("storage_mode"),
            "config": metadata.get("config"),
            "checkpoint_id": metadata.get("checkpoint_id"),
            "checkpoint_lifecycle": manifest.get("lifecycle_state") if manifest else "CREATED",
            "manifest": manifest,
            "metadata": metadata,
            "model": model,
            "resume_state": resume_state,
        }
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


def set_checkpoint_lifecycle(path: str, state: str, detail: Optional[str] = None) -> Dict[str, Any]:
    """Atomically updates lifecycle metadata without changing checkpoint weights."""
    valid_states = {
        "NOT_CREATED", "CREATED", "TRAINING", "TRAINED", "VALIDATING",
        "READY", "FAILED", "INCOMPATIBLE",
    }
    if state not in valid_states:
        raise ValueError(f"Unsupported checkpoint lifecycle state: {state}")
    manifest_path = _checkpoint_manifest_path(path)
    with open(manifest_path, "r", encoding="utf-8") as stream:
        manifest = json.load(stream)
    manifest["lifecycle_state"] = state
    manifest["checkpoint_lifecycle"] = state
    if detail:
        manifest["lifecycle_detail"] = detail
    manifest.setdefault("lifecycle_history", []).append({
        "state": state,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "detail": detail,
    })
    _atomic_write(
        manifest_path,
        json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2).encode("utf-8"),
        overwrite=True,
    )
    return manifest


def real_vocab_size(tok: SovereignTokenizer) -> int:
    return max(i for i, s in tok.id_to_token.items() if not (s.startswith("<tok_") and s.endswith(">"))) + 1


def tokenizer_fingerprint(tok: SovereignTokenizer, n: int) -> str:
    items = [tok.id_to_token[i] for i in range(n)]
    return hashlib.sha256(json.dumps(items, ensure_ascii=False).encode("utf-8")).hexdigest()


class SeqLMConfig:
    def __init__(
        self,
        vocab: int = 532,
        d_model: int = 32,
        n_layers: int = 2,
        n_heads: int = 4,
        d_ffn: int = 64,
        ctx: int = 16,
    ):
        assert d_model % n_heads == 0
        self.vocab = vocab
        self.d_model = d_model
        self.n_layers = n_layers
        self.n_heads = n_heads
        self.d_ffn = d_ffn
        self.ctx = ctx

    def to_dict(self) -> Dict[str, int]:
        return {
            "vocab": self.vocab,
            "d_model": self.d_model,
            "n_layers": self.n_layers,
            "n_heads": self.n_heads,
            "d_ffn": self.d_ffn,
            "ctx": self.ctx,
        }


def _sigmoid(z: float) -> float:
    if z >= 30.0:
        return 1.0
    if z <= -30.0:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))


def _dot(a: List[float], b: List[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


class PureSeqLM:
    """Pure-Python Causal Sequence Transformer with tied output embeddings."""

    def __init__(
        self,
        cfg: SeqLMConfig,
        seed: int = 1234,
        tokenizer_profile: str = "v2_base",
        bpe_merges: Optional[List[str]] = None,
    ):
        self.cfg = cfg
        self.tokenizer_profile = tokenizer_profile
        self.bpe_merges = list(bpe_merges) if bpe_merges else []
        rng = random.Random(seed)
        d, f, L, V, C = cfg.d_model, cfg.d_ffn, cfg.n_layers, cfg.vocab, cfg.ctx
        std = 0.02
        res_std = std / math.sqrt(max(1, 2 * L))

        self.shapes: Dict[str, Tuple[int, ...]] = {}
        self.p: Dict[str, List[float]] = {}

        def alloc(name: str, shape: Tuple[int, ...], s: float, ones: bool = False):
            n = 1
            for dim in shape:
                n *= dim
            self.shapes[name] = shape
            if ones:
                self.p[name] = [1.0] * n
            else:
                self.p[name] = [rng.gauss(0.0, s) for _ in range(n)]

        alloc("tok_emb", (V, d), std)
        alloc("pos_emb", (C, d), std)
        for l in range(L):
            alloc(f"b{l}.norm1", (d,), 0.0, ones=True)
            alloc(f"b{l}.wq", (d, d), std)
            alloc(f"b{l}.wk", (d, d), std)
            alloc(f"b{l}.wv", (d, d), std)
            alloc(f"b{l}.wo", (d, d), res_std)
            alloc(f"b{l}.norm2", (d,), 0.0, ones=True)
            alloc(f"b{l}.w_gate", (d, f), std)
            alloc(f"b{l}.w_up", (d, f), std)
            alloc(f"b{l}.w_down", (f, d), res_std)
        alloc("norm_f", (d,), 0.0, ones=True)

    def param_names(self) -> List[str]:
        return list(self.p.keys())

    def num_params(self) -> int:
        return sum(len(v) for v in self.p.values())

    @staticmethod
    def _rms_fwd(seq: List[List[float]], g: List[float]) -> Tuple[List[List[float]], Dict[str, Any]]:
        d = len(g)
        out: List[List[float]] = []
        r_list: List[float] = []
        for vec in seq:
            msq = sum(v * v for v in vec) / d
            r = 1.0 / math.sqrt(msq + EPS)
            r_list.append(r)
            out.append([vec[j] * r * g[j] for j in range(d)])
        return out, {"x": seq, "r": r_list, "g": g}

    @staticmethod
    def _rms_bwd(dy: List[List[float]], cache: Dict[str, Any]) -> Tuple[List[List[float]], List[float]]:
        x_seq = cache["x"]
        r_list = cache["r"]
        g = cache["g"]
        d = len(g)
        dg = [0.0] * d
        dx_seq: List[List[float]] = []
        for t, vec in enumerate(x_seq):
            r = r_list[t]
            dy_t = dy[t]
            s = 0.0
            for j in range(d):
                dg[j] += dy_t[j] * vec[j] * r
                s += (dy_t[j] * g[j]) * vec[j]
            coeff = (r ** 3) / d * s
            dx_seq.append([r * (dy_t[j] * g[j]) - vec[j] * coeff for j in range(d)])
        return dx_seq, dg

    @staticmethod
    def _matmul(mat_in: List[List[float]], w_flat: List[float], in_d: int, out_d: int) -> List[List[float]]:
        out: List[List[float]] = []
        for row in mat_in:
            res = [0.0] * out_d
            for i in range(in_d):
                ri = row[i]
                if ri == 0.0:
                    continue
                off = i * out_d
                for j in range(out_d):
                    res[j] += ri * w_flat[off + j]
            out.append(res)
        return out

    @staticmethod
    def _matmul_bwd(
        x_seq: List[List[float]],
        w_flat: List[float],
        dy_seq: List[List[float]],
        gw_flat: List[float],
        in_d: int,
        out_d: int,
    ) -> List[List[float]]:
        dx_seq: List[List[float]] = []
        for t in range(len(x_seq)):
            xt = x_seq[t]
            dyt = dy_seq[t]
            dx_t = [0.0] * in_d
            for i in range(in_d):
                xi = xt[i]
                off = i * out_d
                acc = 0.0
                for j in range(out_d):
                    dyj = dyt[j]
                    gw_flat[off + j] += xi * dyj
                    acc += dyj * w_flat[off + j]
                dx_t[i] = acc
            dx_seq.append(dx_t)
        return dx_seq

    def forward_seq(self, tokens: List[int], keep_cache: bool = False) -> Tuple[List[List[float]], Optional[Dict[str, Any]]]:
        """Forward pass on a single token sequence [T] with T <= ctx. Returns logits [T, V]."""
        c, p = self.cfg, self.p
        T = len(tokens)
        assert 1 <= T <= c.ctx
        d, f, H = c.d_model, c.d_ffn, c.n_heads
        dh = d // H
        inv_sqrt_dh = 1.0 / math.sqrt(dh)

        tok_emb = p["tok_emb"]
        pos_emb = p["pos_emb"]
        x: List[List[float]] = []
        for t, tid in enumerate(tokens):
            t_off = tid * d
            p_off = t * d
            x.append([tok_emb[t_off + j] + pos_emb[p_off + j] for j in range(d)])

        block_caches = []
        for l in range(c.n_layers):
            n1, rc1 = self._rms_fwd(x, p[f"b{l}.norm1"])
            q = self._matmul(n1, p[f"b{l}.wq"], d, d)
            k = self._matmul(n1, p[f"b{l}.wk"], d, d)
            v = self._matmul(n1, p[f"b{l}.wv"], d, d)

            # Causal multi-head attention
            o = [[0.0] * d for _ in range(T)]
            probs_heads: List[List[List[float]]] = []  # [H][T][T]
            for h in range(H):
                hs = h * dh
                h_probs: List[List[float]] = []
                for t in range(T):
                    qt = q[t]
                    scores = [0.0] * (t + 1)
                    max_s = -1e30
                    for s_idx in range(t + 1):
                        ks = k[s_idx]
                        dot_val = 0.0
                        for j in range(dh):
                            dot_val += qt[hs + j] * ks[hs + j]
                        sc = dot_val * inv_sqrt_dh
                        scores[s_idx] = sc
                        if sc > max_s:
                            max_s = sc
                    exps = [math.exp(sc - max_s) for sc in scores]
                    s_exp = sum(exps)
                    pr = [e / s_exp for e in exps]
                    h_probs.append(pr)
                    ot = o[t]
                    for s_idx in range(t + 1):
                        w = pr[s_idx]
                        vs = v[s_idx]
                        for j in range(dh):
                            ot[hs + j] += w * vs[hs + j]
                if keep_cache:
                    probs_heads.append(h_probs)

            proj_o = self._matmul(o, p[f"b{l}.wo"], d, d)
            x1 = [[x[t][j] + proj_o[t][j] for j in range(d)] for t in range(T)]

            n2, rc2 = self._rms_fwd(x1, p[f"b{l}.norm2"])
            gate = self._matmul(n2, p[f"b{l}.w_gate"], d, f)
            up = self._matmul(n2, p[f"b{l}.w_up"], d, f)
            sig = [[_sigmoid(gate[t][j]) for j in range(f)] for t in range(T)]
            hid = [[gate[t][j] * sig[t][j] * up[t][j] for j in range(f)] for t in range(T)]
            ffn_out = self._matmul(hid, p[f"b{l}.w_down"], f, d)
            x2 = [[x1[t][j] + ffn_out[t][j] for j in range(d)] for t in range(T)]

            if keep_cache:
                block_caches.append({
                    "rc1": rc1, "n1": n1, "q": q, "k": k, "v": v,
                    "probs": probs_heads, "o": o,
                    "rc2": rc2, "n2": n2, "gate": gate, "up": up, "sig": sig, "hid": hid,
                })
            x = x2

        nf, rcf = self._rms_fwd(x, p["norm_f"])
        # Tied logits: nf @ tok_emb.T -> [T, V]
        V = c.vocab
        logits: List[List[float]] = []
        for t in range(T):
            nft = nf[t]
            row = [0.0] * V
            for v_idx in range(V):
                off = v_idx * d
                acc = 0.0
                for j in range(d):
                    acc += nft[j] * tok_emb[off + j]
                row[v_idx] = acc
            logits.append(row)

        if keep_cache:
            return logits, {"tokens": tokens, "blocks": block_caches, "rcf": rcf, "nf": nf}
        return logits, None

    @staticmethod
    def ce_loss_seq(logits: List[List[float]], targets: List[int]) -> Tuple[float, List[List[float]]]:
        T = len(targets)
        V = len(logits[0])
        total_loss = 0.0
        dlogits: List[List[float]] = []
        inv_T = 1.0 / T
        for t in range(T):
            row = logits[t]
            m = max(row)
            exps = [math.exp(val - m) for val in row]
            s_exp = sum(exps)
            inv_s = 1.0 / s_exp
            probs = [e * inv_s for e in exps]
            tgt = targets[t]
            total_loss += -math.log(max(probs[tgt], 1e-12))
            probs[tgt] -= 1.0
            dlogits.append([pr * inv_T for pr in probs])
        return total_loss * inv_T, dlogits

    def backward_seq(self, dlogits: List[List[float]], cache: Dict[str, Any]) -> Dict[str, List[float]]:
        c, p = self.cfg, self.p
        tokens = cache["tokens"]
        T = len(tokens)
        d, f, H, V = c.d_model, c.d_ffn, c.n_heads, c.vocab
        dh = d // H
        inv_sqrt_dh = 1.0 / math.sqrt(dh)

        g: Dict[str, List[float]] = {k: [0.0] * len(v) for k, v in p.items()}
        nf = cache["nf"]
        tok_emb = p["tok_emb"]
        gtok = g["tok_emb"]

        # Tied head backward: logits[t, v] = dot(nf[t], tok_emb[v])
        dnf = [[0.0] * d for _ in range(T)]
        for t in range(T):
            dlt = dlogits[t]
            nft = nf[t]
            dnft = dnf[t]
            for v_idx in range(V):
                dl = dlt[v_idx]
                if dl == 0.0:
                    continue
                off = v_idx * d
                for j in range(d):
                    gtok[off + j] += dl * nft[j]
                    dnft[j] += dl * tok_emb[off + j]

        dx, g["norm_f"] = self._rms_bwd(dnf, cache["rcf"])

        for l in reversed(range(c.n_layers)):
            bc = cache["blocks"][l]
            # --- FFN
            dhid = self._matmul_bwd(bc["hid"], p[f"b{l}.w_down"], dx, g[f"b{l}.w_down"], f, d)
            gate, up, sig = bc["gate"], bc["up"], bc["sig"]
            dgate = [[0.0] * f for _ in range(T)]
            dup = [[0.0] * f for _ in range(T)]
            for t in range(T):
                for j in range(f):
                    dhv = dhid[t][j]
                    gv = gate[t][j]
                    sv = sig[t][j]
                    uv = up[t][j]
                    dup[t][j] = dhv * gv * sv
                    dgate[t][j] = dhv * uv * (sv * (1.0 + gv * (1.0 - sv)))

            dn2_gate = self._matmul_bwd(bc["n2"], p[f"b{l}.w_gate"], dgate, g[f"b{l}.w_gate"], d, f)
            dn2_up = self._matmul_bwd(bc["n2"], p[f"b{l}.w_up"], dup, g[f"b{l}.w_up"], d, f)
            dn2 = [[dn2_gate[t][j] + dn2_up[t][j] for j in range(d)] for t in range(T)]
            dx1_n, g[f"b{l}.norm2"] = self._rms_bwd(dn2, bc["rc2"])
            dx1 = [[dx[t][j] + dx1_n[t][j] for j in range(d)] for t in range(T)]

            # --- Attention
            do = self._matmul_bwd(bc["o"], p[f"b{l}.wo"], dx1, g[f"b{l}.wo"], d, d)
            q, k, v, probs_heads = bc["q"], bc["k"], bc["v"], bc["probs"]
            dq = [[0.0] * d for _ in range(T)]
            dk = [[0.0] * d for _ in range(T)]
            dv = [[0.0] * d for _ in range(T)]

            for h in range(H):
                hs = h * dh
                h_probs = probs_heads[h]
                dpr = [[0.0] * (t + 1) for t in range(T)]
                for t in range(T):
                    dot_t = do[t]
                    prt = h_probs[t]
                    for s_idx in range(t + 1):
                        vs = v[s_idx]
                        pr_ts = prt[s_idx]
                        acc = 0.0
                        for j in range(dh):
                            acc += dot_t[hs + j] * vs[hs + j]
                            dv[s_idx][hs + j] += pr_ts * dot_t[hs + j]
                        dpr[t][s_idx] = acc

                for t in range(T):
                    prt = h_probs[t]
                    dprt = dpr[t]
                    mean_dpr = sum(prt[s_idx] * dprt[s_idx] for s_idx in range(t + 1))
                    qt = q[t]
                    for s_idx in range(t + 1):
                        ds_ts = prt[s_idx] * (dprt[s_idx] - mean_dpr) * inv_sqrt_dh
                        ks = k[s_idx]
                        for j in range(dh):
                            dq[t][hs + j] += ds_ts * ks[hs + j]
                            dk[s_idx][hs + j] += ds_ts * qt[hs + j]

            dn1_q = self._matmul_bwd(bc["n1"], p[f"b{l}.wq"], dq, g[f"b{l}.wq"], d, d)
            dn1_k = self._matmul_bwd(bc["n1"], p[f"b{l}.wk"], dk, g[f"b{l}.wk"], d, d)
            dn1_v = self._matmul_bwd(bc["n1"], p[f"b{l}.wv"], dv, g[f"b{l}.wv"], d, d)
            dn1 = [[dn1_q[t][j] + dn1_k[t][j] + dn1_v[t][j] for j in range(d)] for t in range(T)]
            dx_n, g[f"b{l}.norm1"] = self._rms_bwd(dn1, bc["rc1"])
            dx = [[dx1[t][j] + dx_n[t][j] for j in range(d)] for t in range(T)]

        gpos = g["pos_emb"]
        for t, tid in enumerate(tokens):
            dxt = dx[t]
            t_off = tid * d
            p_off = t * d
            for j in range(d):
                gtok[t_off + j] += dxt[j]
                gpos[p_off + j] += dxt[j]
        return g

    def next_token_logits(self, ids: List[int]) -> List[float]:
        window = ids[-self.cfg.ctx:] if ids else [1]
        logits, _ = self.forward_seq(window, keep_cache=False)
        return logits[-1]

    def generate_ids_stream(
        self,
        prompt_ids: List[int],
        max_new_tokens: int = 40,
        temperature: float = 0.7,
        top_k: int = 16,
        top_p: float = 0.92,
        repetition_penalty: float = 1.15,
        rep_window: int = 32,
        no_repeat_ngram: int = 3,
        seed: Optional[int] = None,
        stop_ids: Optional[Set[int]] = None,
        min_id: int = 4,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> Generator[int, None, None]:
        rng = random.Random(seed if seed is not None else int(time.time() * 1000))
        ids = [t if 0 <= t < self.cfg.vocab else 3 for t in (prompt_ids or [1])]
        for _ in range(max_new_tokens):
            if cancel_check is not None and cancel_check():
                break
            lg = list(self.next_token_logits(ids))
            if not lg or not all(math.isfinite(val) for val in lg):
                raise RuntimeError("FAIL_CLOSED: non-finite logits detected during PureSeqLM decoding")
            for i in range(min(min_id, len(lg))):
                lg[i] = -1e30
            if repetition_penalty and repetition_penalty != 1.0:
                for t in set(ids[-rep_window:]):
                    if t < len(lg) and lg[t] > -1e15:
                        lg[t] = lg[t] / repetition_penalty if lg[t] > 0 else lg[t] * repetition_penalty
            n = no_repeat_ngram
            if n >= 2 and len(ids) >= n - 1:
                prefix = tuple(ids[len(ids) - (n - 1):])
                for i in range(len(ids) - n + 1):
                    if tuple(ids[i:i + n - 1]) == prefix:
                        blk = ids[i + n - 1]
                        if blk < len(lg):
                            lg[blk] = -1e30

            if temperature <= 0.0:
                nxt = max(range(len(lg)), key=lambda idx: lg[idx])
            else:
                scaled = [v / temperature for v in lg]
                if top_k and top_k < len(scaled):
                    top_indices = sorted(range(len(scaled)), key=lambda idx: scaled[idx], reverse=True)[:top_k]
                else:
                    top_indices = list(range(len(scaled)))
                max_v = max(scaled[idx] for idx in top_indices)
                probs = [(idx, math.exp(scaled[idx] - max_v)) for idx in top_indices]
                total_p = sum(p for _, p in probs)
                probs = [(idx, p / max(total_p, 1e-12)) for idx, p in probs]
                if 0.0 < top_p < 1.0:
                    probs.sort(key=lambda item: item[1], reverse=True)
                    kept: List[Tuple[int, float]] = []
                    acc_p = 0.0
                    for idx, p in probs:
                        kept.append((idx, p))
                        acc_p += p
                        if acc_p >= top_p:
                            break
                    probs = kept
                    s_k = sum(p for _, p in probs)
                    probs = [(idx, p / max(s_k, 1e-12)) for idx, p in probs]
                r = rng.random()
                cum = 0.0
                nxt = probs[-1][0]
                for idx, p in probs:
                    cum += p
                    if r <= cum:
                        nxt = idx
                        break

            ids.append(nxt)
            yield nxt
            if stop_ids and nxt in stop_ids:
                break

    def to_bytes(
        self,
        tok: SovereignTokenizer,
        extra_meta: Optional[Dict[str, Any]] = None,
        *,
        checkpoint_id: Optional[str] = None,
    ) -> Tuple[bytes, Dict[str, Any]]:
        flat = array.array("f")
        manifest: List[Dict[str, Any]] = []
        for k in self.param_names():
            arr = self.p[k]
            flat.extend(arr)
            manifest.append({"name": k, "shape": list(self.shapes[k]), "params": len(arr)})
        payload = flat.tobytes()
        sha = hashlib.sha256(payload).hexdigest()
        meta: Dict[str, Any] = {
            "model_name": "ZYNTHEOR PureSeqLM (Pure-Python Causal Sequence LM)",
            "architecture": (
                f"ZYNTHEOR-PureSeqLM ({self.cfg.n_layers}L · {self.cfg.n_heads}H · "
                f"{self.cfg.d_model}D · Tied-Vocab {self.cfg.vocab} · Ctx {self.cfg.ctx})"
            ),
            "storage_mode": STORAGE_MODE,
            "checkpoint_format_version": CHECKPOINT_FORMAT_VERSION,
            "checkpoint_id": checkpoint_id or uuid.uuid4().hex,
            "total_params": self.num_params(),
            "trained_subgraph_params": self.num_params(),
            "config": self.cfg.to_dict(),
            "tokenizer_profile": tok.profile,
            "bpe_merges": self.bpe_merges,
            "tokenizer_sha256": tokenizer_fingerprint(tok, self.cfg.vocab),
            "sha256": sha,
            "tensors_manifest": manifest,
            "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if extra_meta:
            reserved = set(meta).intersection(extra_meta)
            if reserved:
                raise ValueError(f"Checkpoint metadata cannot override reserved fields: {sorted(reserved)}")
            meta.update(extra_meta)
        meta_bytes = json.dumps(meta, sort_keys=True, ensure_ascii=False).encode("utf-8")
        container = MAGIC_HEADER + struct.pack(">I", len(meta_bytes)) + meta_bytes + payload
        return container, meta

    def save(
        self,
        path: str,
        tok: SovereignTokenizer,
        extra_meta: Optional[Dict[str, Any]] = None,
        *,
        resume_state: Optional[Dict[str, Any]] = None,
        manifest_metadata: Optional[Dict[str, Any]] = None,
        overwrite: bool = False,
    ) -> Dict[str, Any]:
        """Atomically writes an immutable checkpoint bundle; overwrite is opt-in."""
        checkpoint_id = uuid.uuid4().hex
        meta_updates = dict(extra_meta or {})
        resume_path = _checkpoint_resume_path(path)
        resume_bytes = None
        if resume_state is not None:
            resume_payload = dict(resume_state)
            resume_payload.update({
                "format_version": RESUME_STATE_FORMAT_VERSION,
                "checkpoint_id": checkpoint_id,
            })
            resume_bytes = json.dumps(
                resume_payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
            meta_updates["resume_state_file"] = os.path.basename(resume_path)
            meta_updates["resume_state_sha256"] = hashlib.sha256(resume_bytes).hexdigest()

        container, meta = self.to_bytes(tok, extra_meta=meta_updates, checkpoint_id=checkpoint_id)
        manifest_path = _checkpoint_manifest_path(path)
        targets = [path, manifest_path]
        if resume_state is not None:
            targets.append(resume_path)
        if not overwrite and any(os.path.lexists(target) for target in targets):
            raise FileExistsError("FAIL_CLOSED: checkpoint bundle path already exists; refusing to overwrite artifacts")

        file_sha256 = hashlib.sha256(container).hexdigest()
        manifest = {
            "manifest_version": 1,
            "checkpoint_id": checkpoint_id,
            "checkpoint_file": os.path.basename(path),
            "checkpoint_file_sha256": file_sha256,
            "payload_sha256": meta["sha256"],
            "storage_mode": STORAGE_MODE,
            "checkpoint_lifecycle": "CREATED",
            "lifecycle_state": "CREATED",
            "created_at": meta["saved_at"],
            "config": self.cfg.to_dict(),
            "tokenizer_profile": tok.profile,
            "tokenizer_sha256": meta["tokenizer_sha256"],
            "resume_state_file": meta.get("resume_state_file"),
            "resume_state_sha256": meta.get("resume_state_sha256"),
        }
        if manifest_metadata:
            lifecycle_fields = {"lifecycle_state", "checkpoint_lifecycle"}
            reserved = set(manifest).intersection(manifest_metadata) - lifecycle_fields
            if reserved:
                raise ValueError(f"Checkpoint manifest cannot override reserved fields: {sorted(reserved)}")
            manifest.update(manifest_metadata)
        lifecycle_state = manifest.get("lifecycle_state")
        if lifecycle_state not in {
            "NOT_CREATED", "CREATED", "TRAINING", "TRAINED", "VALIDATING",
            "READY", "FAILED", "INCOMPATIBLE",
        }:
            raise ValueError(f"Unsupported checkpoint lifecycle state: {lifecycle_state}")
        manifest["checkpoint_lifecycle"] = lifecycle_state
        manifest.setdefault("lifecycle_history", []).append({
            "state": lifecycle_state,
            "at": meta["saved_at"],
            "detail": manifest.get("lifecycle_detail"),
        })
        manifest_bytes = json.dumps(
            manifest, sort_keys=True, ensure_ascii=False, indent=2
        ).encode("utf-8")
        if resume_bytes is not None:
            _atomic_write(resume_path, resume_bytes, overwrite=overwrite)
        _atomic_write(path, container, overwrite=overwrite)
        _atomic_write(manifest_path, manifest_bytes, overwrite=overwrite)
        meta["file_sha256"] = file_sha256
        meta["manifest_path"] = manifest_path
        return meta

    @classmethod
    def from_bytes(cls, raw: bytes, tok: Optional[SovereignTokenizer] = None) -> Tuple["PureSeqLM", Dict[str, Any]]:
        if len(raw) < len(MAGIC_HEADER) + 4 or raw[: len(MAGIC_HEADER)] != MAGIC_HEADER:
            raise RuntimeError("FAIL_CLOSED: invalid magic header")
        ml = struct.unpack(">I", raw[len(MAGIC_HEADER):len(MAGIC_HEADER) + 4])[0]
        meta_start = len(MAGIC_HEADER) + 4
        meta_end = meta_start + ml
        if meta_end > len(raw):
            raise RuntimeError("FAIL_CLOSED: truncated PureSeqLM metadata header")
        meta = json.loads(raw[meta_start:meta_end].decode("utf-8"))
        payload = raw[meta_end:]
        if meta.get("storage_mode") != STORAGE_MODE:
            raise RuntimeError(f"FAIL_CLOSED: unexpected storage_mode {meta.get('storage_mode')}")
        if hashlib.sha256(payload).hexdigest() != meta.get("sha256"):
            raise RuntimeError("FAIL_CLOSED: payload SHA-256 mismatch")
        if len(payload) % 4 != 0 or len(payload) // 4 != meta.get("total_params"):
            raise RuntimeError("FAIL_CLOSED: float count mismatch")
        if meta.get("checkpoint_format_version", 1) not in (1, CHECKPOINT_FORMAT_VERSION):
            raise RuntimeError("FAIL_CLOSED: unsupported PureSeqLM checkpoint format version")
        try:
            cfg = SeqLMConfig(**meta["config"])
        except (KeyError, TypeError, AssertionError) as exc:
            raise RuntimeError(f"FAIL_CLOSED: invalid PureSeqLM configuration: {exc}") from exc
        if min(cfg.vocab, cfg.d_model, cfg.n_layers, cfg.n_heads, cfg.d_ffn, cfg.ctx) < 1:
            raise RuntimeError("FAIL_CLOSED: PureSeqLM configuration dimensions must be positive")
        profile = meta.get("tokenizer_profile", "v2_base")
        merges = meta.get("bpe_merges") or []
        if not isinstance(merges, list) or not all(isinstance(item, str) for item in merges):
            raise RuntimeError("FAIL_CLOSED: invalid tokenizer merge list in checkpoint")
        if tok is None:
            tok = SovereignTokenizer(vocab_size=max(16384, cfg.vocab), profile=profile, bpe_merges=merges)
        if tok is not None:
            if tok.profile != profile:
                raise RuntimeError(f"FAIL_CLOSED: tokenizer profile mismatch ({tok.profile} != {profile})")
            if tokenizer_fingerprint(tok, cfg.vocab) != meta.get("tokenizer_sha256"):
                raise RuntimeError("FAIL_CLOSED: tokenizer vocabulary differs from checkpoint")
        m = cls(cfg, seed=0, tokenizer_profile=profile, bpe_merges=merges)
        if meta.get("total_params") != m.num_params():
            raise RuntimeError("FAIL_CLOSED: checkpoint parameter count does not match model configuration")
        flat = array.array("f")
        flat.frombytes(payload)
        for val in flat:
            if not math.isfinite(val):
                raise RuntimeError("FAIL_CLOSED: non-finite (NaN/Inf) weight detected in PureSeqLM payload")
        off = 0
        manifest = meta.get("tensors_manifest") or []
        if not manifest:
            raise RuntimeError("FAIL_CLOSED: missing tensors_manifest in PureSeqLM checkpoint")
        seen_names = set()
        for item in manifest:
            if not isinstance(item, dict):
                raise RuntimeError("FAIL_CLOSED: invalid tensor manifest entry")
            name = item.get("name")
            if not isinstance(name, str) or name in seen_names:
                raise RuntimeError("FAIL_CLOSED: missing or duplicate tensor name in manifest")
            seen_names.add(name)
            try:
                n = int(item["params"])
            except (KeyError, TypeError, ValueError) as exc:
                raise RuntimeError("FAIL_CLOSED: invalid tensor parameter count") from exc
            expected_shape = list(m.shapes.get(name, ()))
            if name not in m.p or len(m.p[name]) != n or item.get("shape") != expected_shape:
                raise RuntimeError(f"FAIL_CLOSED: tensor shape/count mismatch for '{name}' (expected {len(m.p.get(name, []))}, got {n})")
            if off + n > len(flat):
                raise RuntimeError("FAIL_CLOSED: truncated tensor payload in PureSeqLM")
            m.p[name] = list(flat[off:off + n])
            off += n
        if seen_names != set(m.p):
            raise RuntimeError("FAIL_CLOSED: tensor manifest does not describe every model parameter")
        if off != len(flat):
            raise RuntimeError(f"FAIL_CLOSED: tensor manifest consumed {off} floats, expected {len(flat)}")
        return m, meta

    @classmethod
    def load(cls, path: str, tok: Optional[SovereignTokenizer] = None) -> Tuple["PureSeqLM", Dict[str, Any]]:
        if not os.path.exists(path):
            raise RuntimeError(f"FAIL_CLOSED: PureSeqLM checkpoint missing at {path}")
        with open(path, "rb") as f:
            raw = f.read()
        return cls.from_bytes(raw, tok=tok)


class PureAdamW:
    def __init__(self, model: PureSeqLM, lr: float = 3e-3, betas: Tuple[float, float] = (0.9, 0.99), eps: float = 1e-8, weight_decay: float = 0.01):
        self.lr = lr
        self.b1, self.b2 = betas
        self.eps = eps
        self.wd = weight_decay
        self.t = 0
        self.m = {k: [0.0] * len(v) for k, v in model.p.items()}
        self.v = {k: [0.0] * len(v) for k, v in model.p.items()}

    def state_dict(self) -> Dict[str, Any]:
        return {
            "lr": self.lr,
            "betas": [self.b1, self.b2],
            "eps": self.eps,
            "weight_decay": self.wd,
            "step": self.t,
            "m": self.m,
            "v": self.v,
        }

    def load_state_dict(self, state: Dict[str, Any], model: PureSeqLM) -> None:
        if not isinstance(state, dict) or set(state.get("m", {})) != set(model.p) or set(state.get("v", {})) != set(model.p):
            raise ValueError("FAIL_CLOSED: optimizer parameter names do not match model")
        lr = state.get("lr")
        betas = state.get("betas")
        eps = state.get("eps")
        weight_decay = state.get("weight_decay")
        step = state.get("step")
        if (
            not isinstance(lr, (int, float)) or not math.isfinite(lr) or lr <= 0
            or not isinstance(betas, list) or len(betas) != 2
            or any(not isinstance(beta, (int, float)) or not math.isfinite(beta) or not 0 <= beta < 1 for beta in betas)
            or not isinstance(eps, (int, float)) or not math.isfinite(eps) or eps <= 0
            or not isinstance(weight_decay, (int, float)) or not math.isfinite(weight_decay) or weight_decay < 0
            or not isinstance(step, int) or step < 0
        ):
            raise ValueError("FAIL_CLOSED: invalid optimizer hyperparameters or step")
        loaded_m: Dict[str, List[float]] = {}
        loaded_v: Dict[str, List[float]] = {}
        for key, params in model.p.items():
            for source, target in ((state["m"], loaded_m), (state["v"], loaded_v)):
                values = source[key]
                if (
                    not isinstance(values, list)
                    or len(values) != len(params)
                    or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in values)
                ):
                    raise ValueError(f"FAIL_CLOSED: invalid optimizer tensor state for {key}")
                target[key] = [float(value) for value in values]
        self.lr = float(lr)
        self.b1, self.b2 = float(betas[0]), float(betas[1])
        self.eps = float(eps)
        self.wd = float(weight_decay)
        self.t = step
        self.m = loaded_m
        self.v = loaded_v

    def step(self, model: PureSeqLM, grads: Dict[str, List[float]], clip: float = 1.0) -> float:
        if set(grads) != set(model.p):
            raise ValueError("FAIL_CLOSED: gradient parameter names do not match model")
        for key, weights in model.p.items():
            if len(grads[key]) != len(weights) or any(not math.isfinite(value) for value in grads[key]):
                raise ValueError(f"FAIL_CLOSED: invalid or non-finite gradient tensor for {key}")
        sq = sum(val * val for g in grads.values() for val in g)
        gnorm = math.sqrt(sq)
        if not math.isfinite(gnorm):
            raise ValueError("FAIL_CLOSED: non-finite gradient norm")
        scale = clip / gnorm if (clip and gnorm > clip) else 1.0
        self.t += 1
        b1, b2, lr, wd, eps, t = self.b1, self.b2, self.lr, self.wd, self.eps, self.t
        bc1 = 1.0 - (b1 ** t)
        bc2 = 1.0 - (b2 ** t)
        for k, w in model.p.items():
            gk = grads[k]
            mk = self.m[k]
            vk = self.v[k]
            decay = 1.0 if len(model.shapes[k]) == 1 else (1.0 - lr * wd)
            for i in range(len(w)):
                gi = gk[i] * scale
                mi = b1 * mk[i] + (1.0 - b1) * gi
                vi = b2 * vk[i] + (1.0 - b2) * (gi * gi)
                mk[i] = mi
                vk[i] = vi
                m_hat = mi / bc1
                v_hat = vi / bc2
                w[i] = w[i] * decay - lr * m_hat / (math.sqrt(v_hat) + eps)
                if not math.isfinite(w[i]) or not math.isfinite(mi) or not math.isfinite(vi):
                    raise ValueError(f"FAIL_CLOSED: non-finite optimizer update for {k}")
        return gnorm


def verify_pure_seq_gradients(seed: int = 7) -> Dict[str, Any]:
    """Finite-difference verification across every parameter tensor in PureSeqLM."""
    cfg = SeqLMConfig(vocab=16, d_model=8, n_layers=2, n_heads=2, d_ffn=16, ctx=6)
    m = PureSeqLM(cfg, seed=seed)
    rng = random.Random(0)
    for k in m.p:
        scale = 8.0 if len(m.shapes[k]) == 2 else 1.0
        m.p[k] = [v * scale + (rng.gauss(0, 0.05) if scale == 1.0 else 0.0) for v in m.p[k]]
    toks = [1, 4, 7, 11, 2, 9]
    tgts = [4, 7, 11, 2, 9, 5]
    lg, cache = m.forward_seq(toks, keep_cache=True)
    _, dlogits = PureSeqLM.ce_loss_seq(lg, tgts)
    grads = m.backward_seq(dlogits, cache)

    max_rel_err = 0.0
    checked = 0
    eps = 1e-5
    for k, w in m.p.items():
        gw = grads[k]
        step = max(1, len(w) // 4)
        for idx in range(0, len(w), step):
            orig = w[idx]
            w[idx] = orig + eps
            la, _ = PureSeqLM.ce_loss_seq(m.forward_seq(toks)[0], tgts)
            w[idx] = orig - eps
            lb, _ = PureSeqLM.ce_loss_seq(m.forward_seq(toks)[0], tgts)
            w[idx] = orig
            num = (la - lb) / (2.0 * eps)
            ana = gw[idx]
            rel = abs(num - ana) / max(abs(num) + abs(ana), 1e-8)
            if rel > max_rel_err:
                max_rel_err = rel
            checked += 1
    return {"passed": max_rel_err < 1e-4, "checked_elements": checked, "max_rel_error": round(max_rel_err, 9)}


def _evaluate_split(model: PureSeqLM, tok: SovereignTokenizer, val_windows: List[Tuple[List[int], List[int]]], train_streams: List[List[int]]) -> Dict[str, Any]:
    V = model.cfg.vocab
    # Build smoothed bigram baseline from train split ONLY
    uni = [1.0] * V
    big: Dict[int, Dict[int, float]] = {}
    for s in train_streams:
        for i, tid in enumerate(s):
            if tid < V:
                uni[tid] += 1.0
                if i + 1 < len(s) and s[i + 1] < V:
                    row = big.setdefault(tid, {})
                    row[s[i + 1]] = row.get(s[i + 1], 0.0) + 1.0
    uni_sum = sum(uni)
    p_uni = [u / uni_sum for u in uni]

    nll_sum = 0.0
    bigram_nll_sum = 0.0
    total_pos = 0
    total_bytes = 0
    top1_hits = 0
    top5_hits = 0

    tok_bytes = [
        len(tok.id_to_token[i].encode("utf-8"))
        if not (tok.id_to_token[i].startswith("[") and tok.id_to_token[i].endswith("]"))
        else 0
        for i in range(V)
    ]

    for x, y in val_windows:
        logits, _ = model.forward_seq(x, keep_cache=False)
        for t in range(len(y)):
            tgt = y[t]
            row = logits[t]
            m = max(row)
            exps = [math.exp(v - m) for v in row]
            s_exp = sum(exps)
            ptgt = max(exps[tgt] / s_exp, 1e-12)
            nll_sum += -math.log(ptgt)

            prev_tok = x[t]
            brow = big.get(prev_tok)
            if brow:
                denom = sum(brow.values()) + 0.5
                p_b = (brow.get(tgt, 0.0) + 0.5 * p_uni[tgt]) / denom
            else:
                p_b = p_uni[tgt]
            bigram_nll_sum += -math.log(max(p_b, 1e-12))

            tgt_score = row[tgt]
            higher = sum(1 for val in row if val > tgt_score)
            if higher == 0:
                top1_hits += 1
            if higher < 5:
                top5_hits += 1
            total_pos += 1
            total_bytes += tok_bytes[tgt]

    mean_nll = nll_sum / max(1, total_pos)
    bigram_nll = bigram_nll_sum / max(1, total_pos)
    bpb = nll_sum / math.log(2) / max(1, total_bytes)
    bigram_bpb = bigram_nll_sum / math.log(2) / max(1, total_bytes)
    return {
        "positions": total_pos,
        "bytes": total_bytes,
        "nll": round(mean_nll, 4),
        "ppl": round(math.exp(min(mean_nll, 20.0)), 4),
        "bpb": round(bpb, 4),
        "top1_accuracy": round(top1_hits / max(1, total_pos), 4),
        "top5_accuracy": round(top5_hits / max(1, total_pos), 4),
        "bigram_nll": round(bigram_nll, 4),
        "bigram_ppl": round(math.exp(min(bigram_nll, 20.0)), 4),
        "bigram_bpb": round(bigram_bpb, 4),
        "beats_bigram": mean_nll < bigram_nll,
    }


def train_and_evaluate_pure_seq(
    steps: int = 28,
    lr: float = 0.008,
    num_merges: int = 48,
    out_path: str = PURE_SEQ_CHECKPOINT_PATH,
    evidence_path: str = PURE_SEQ_EVIDENCE_PATH,
) -> Dict[str, Any]:
    """
    Runs end-to-end pure-Python BPE training + causal sequence LM training +
    held-out validation gating + checkpoint export + evidence persistence.
    Strictly separates train and val splits by whole document.
    """
    from qplus_native.bilingual_corpus import build_bilingual_corpus

    t0 = time.perf_counter()
    corpus = build_bilingual_corpus(include_project_corpus=True, write_manifest=False)
    train_docs = [d for d in corpus["docs"] if d["split"] == "train"]
    val_docs = [d for d in corpus["docs"] if d["split"] == "val"]

    # Train BPE merges strictly on train split documents
    bpe_res = train_bpe_merges([d["text"][:1000] for d in train_docs[:20]], num_merges=num_merges, min_pair_freq=3)
    tok = SovereignTokenizer(vocab_size=16384, profile="bilingual_bpe", bpe_merges=bpe_res["merges"])
    real_v = real_vocab_size(tok)

    ctx = 16
    cfg = SeqLMConfig(vocab=real_v, d_model=32, n_layers=2, n_heads=4, d_ffn=64, ctx=ctx)

    def _encode_doc_stream(text: str, limit: int = 600) -> List[int]:
        ids = tok.encode(text[:limit])
        return [tid if 0 <= tid < real_v else 3 for tid in ids]

    train_streams = [_encode_doc_stream(d["text"], 700) for d in train_docs[:24]]
    train_streams = [s for s in train_streams if len(s) >= ctx + 2]
    val_streams = [_encode_doc_stream(d["text"], 450) for d in val_docs[:10]]
    val_streams = [s for s in val_streams if len(s) >= ctx + 2]

    val_windows: List[Tuple[List[int], List[int]]] = []
    for s in val_streams:
        for i in range(0, min(len(s) - ctx - 1, ctx * 2), ctx):
            val_windows.append((s[i:i + ctx], s[i + 1:i + ctx + 1]))
    val_windows = val_windows[:10]

    # Resume existing PureSeqLM if compatible, else initialize fresh
    resumed = False
    if os.path.exists(out_path):
        try:
            loaded_m, _ = PureSeqLM.load(out_path, tok)
            model = loaded_m
            resumed = True
        except Exception:
            model = PureSeqLM(cfg, seed=42, tokenizer_profile="bilingual_bpe", bpe_merges=bpe_res["merges"])
    else:
        model = PureSeqLM(cfg, seed=42, tokenizer_profile="bilingual_bpe", bpe_merges=bpe_res["merges"])

    eval_before = _evaluate_split(model, tok, val_windows, train_streams)
    snapshot_p = {k: list(v) for k, v in model.p.items()}
    opt = PureAdamW(model, lr=lr, weight_decay=0.01)

    rng = random.Random(101)
    train_losses: List[float] = []
    tokens_processed = 0

    for _step in range(steps):
        s = rng.choice(train_streams)
        start = rng.randint(0, len(s) - ctx - 1)
        x = s[start:start + ctx]
        y = s[start + 1:start + ctx + 1]
        logits, cache = model.forward_seq(x, keep_cache=True)
        loss, dlogits = PureSeqLM.ce_loss_seq(logits, y)
        grads = model.backward_seq(dlogits, cache)
        opt.step(model, grads, clip=1.0)
        train_losses.append(loss)
        tokens_processed += ctx

    eval_after = _evaluate_split(model, tok, val_windows, train_streams)
    accepted = eval_after["nll"] < eval_before["nll"]
    if not accepted:
        model.p = snapshot_p
        decision = "ROLLED_BACK_NO_VAL_IMPROVEMENT"
        saved_meta = None
    else:
        decision = "ACCEPTED"
        saved_meta = model.save(
            out_path,
            tok,
            extra_meta={
                "training_steps": steps,
                "tokens_processed": tokens_processed,
                "val_nll_before": eval_before["nll"],
                "val_nll_after": eval_after["nll"],
                "val_ppl_after": eval_after["ppl"],
                "resumed": resumed,
            },
        )

    evidence = {
        "model_kind": "PureSeqLM",
        "storage_mode": STORAGE_MODE,
        "checkpoint_path": os.path.relpath(out_path, ROOT),
        "checkpoint_sha256": saved_meta["sha256"] if saved_meta else None,
        "resumed_from_checkpoint": resumed,
        "total_params": model.num_params(),
        "config": model.cfg.to_dict(),
        "tokenizer": {
            "profile": tok.profile,
            "real_vocab_size": real_v,
            "bpe_merges_learned": bpe_res["merges_learned"],
            "bpe_compression_gain_pct": bpe_res["compression_gain_pct"],
        },
        "corpus": {
            "corpus_sha256": corpus["corpus_sha256"],
            "train_docs_used": len(train_streams),
            "val_docs_used": len(val_streams),
            "val_positions": eval_after["positions"],
        },
        "training": {
            "steps": steps,
            "lr": lr,
            "tokens_processed": tokens_processed,
            "train_loss_first": round(train_losses[0], 4) if train_losses else None,
            "train_loss_last": round(train_losses[-1], 4) if train_losses else None,
        },
        "eval_before": eval_before,
        "eval_after": eval_after,
        "delta": {
            "val_nll": round(eval_after["nll"] - eval_before["nll"], 4),
            "val_ppl": round(eval_after["ppl"] - eval_before["ppl"], 4),
            "top1_accuracy": round(eval_after["top1_accuracy"] - eval_before["top1_accuracy"], 4),
        },
        "gate_decision": decision,
        "duration_s": round(time.perf_counter() - t0, 2),
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    os.makedirs(os.path.dirname(evidence_path), exist_ok=True)
    with open(evidence_path, "w", encoding="utf-8") as f:
        json.dump(evidence, f, ensure_ascii=False, indent=2)
    return evidence


if __name__ == "__main__":
    print(json.dumps(train_and_evaluate_pure_seq(), ensure_ascii=False, indent=2))
