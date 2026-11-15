# -*- coding: utf-8 -*-
"""
ZYNTHEOR Sovereign Native Training Engine
Executes real gradient descent, AdamW optimizer updates, and Cross-Entropy loss reduction.
"""

import os
import sys
import json
import time
import math
import array
import struct
import hashlib
from typing import Dict, Any, List, Optional, Tuple

# Ensure project root in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qplus_native.engine import (
    Tensor, LinearLayer, RMSNormLayer, MultiHeadAttentionLayer,
    SwiGLUFeedForwardLayer, NativeAdamW, cross_entropy_loss_and_grad,
    check_numerical_gradient, analyze_gradient_coverage
)
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.checkpoint import CheckpointManager
from qplus_native.architecture import TARGET_TOTAL_PARAMS

class NativeTrainer:
    def __init__(self, d_model: int = 128, d_ffn: int = 384, vocab_size: int = 16384):
        self.d_model = d_model
        self.d_ffn = d_ffn
        self.vocab_size = vocab_size
        self.tokenizer = SovereignTokenizer(vocab_size)
        
        # Transformer forward graph layers:
        # 1. Multi-Head Attention (Q, K, V, Out)
        self.attn = MultiHeadAttentionLayer(d_model, n_heads=4, name="transformer.attn")
        # 2. Pre-FFN RMSNorm
        self.norm1 = RMSNormLayer(d_model, name="transformer.norm1")
        # 3. SwiGLU Feed-Forward (Gate, Up, Down)
        self.ffn = SwiGLUFeedForwardLayer(d_model, d_ffn, name="transformer.ffn")
        # 4. Final RMSNorm
        self.norm2 = RMSNormLayer(d_model, name="transformer.norm2")
        # 5. Language Model Head Projection (d_model -> active vocab bucket of 128 tokens)
        self.head_dim = 128
        self.lm_head = LinearLayer(d_model, self.head_dim, name="transformer.lm_head")

        self.trainable_layers = [self.attn, self.norm1, self.ffn, self.norm2, self.lm_head]
        self.parameters: List[Tensor] = []
        for l in self.trainable_layers:
            if hasattr(l, "parameters"):
                self.parameters.extend(l.parameters)
            elif hasattr(l, "weight"):
                self.parameters.append(l.weight)
                if hasattr(l, "bias") and l.bias is not None:
                    self.parameters.append(l.bias)

        # Conservative, environment-overridable training parameters. 0.005 caused
        # loss regression in the recorded continuation run; do not reuse it by default.
        learning_rate = float(os.getenv("ZYNTHEOR_TRAINING_LR", "0.0003"))
        weight_decay = float(os.getenv("ZYNTHEOR_WEIGHT_DECAY", "0.01"))
        if not (1e-6 <= learning_rate <= 1e-2):
            raise ValueError("ZYNTHEOR_TRAINING_LR must be between 1e-6 and 1e-2")
        if not (0.0 <= weight_decay <= 0.1):
            raise ValueError("ZYNTHEOR_WEIGHT_DECAY must be between 0 and 0.1")
        self.optimizer = NativeAdamW(self.parameters, lr=learning_rate, weight_decay=weight_decay)
        self.training_history: List[Dict[str, Any]] = []

    def load_from_checkpoint(self, checkpoint_path: str) -> Dict[str, Any]:
        """
        Loads previously trained weights into this trainer so training CONTINUES from the
        checkpoint instead of restarting from a fresh initialisation. Fails closed on any
        integrity or shape mismatch. Optimizer moments are not stored in the checkpoint and
        start fresh; this is reported in the return value.
        """
        info = CheckpointManager.inspect_checkpoint(checkpoint_path)
        if info.get("status") != "ACTIVE_TENSORS_VERIFIED":
            raise RuntimeError(f"FAIL_CLOSED: checkpoint not verified ({info.get('status')}).")
        expected = sum(p.size for p in self.parameters)
        if info["payload_float32_count"] != expected:
            raise RuntimeError(
                f"FAIL_CLOSED: checkpoint has {info['payload_float32_count']} floats; trainer graph needs {expected}."
            )
        with open(checkpoint_path, "rb") as f:
            f.read(len(b"ZYNTHEOR_QPLUS_PT"))
            meta_len = struct.unpack(">I", f.read(4))[0]
            f.read(meta_len)
            payload = f.read()
        flat = array.array("f")
        flat.frombytes(payload)
        offset = 0
        for p in self.parameters:
            p.data[:] = flat[offset:offset + p.size]
            offset += p.size
        if offset != len(flat):
            raise RuntimeError("FAIL_CLOSED: parameter mapping did not consume the whole payload.")
        return {
            "loaded_params": offset,
            "payload_sha256": info["payload_sha256"],
            "optimizer_state_restored": False,
        }

    def get_token_embedding(self, token_id: int) -> List[float]:
        """Maps token ID onto the embedding dimension with sinusoidal basis."""
        emb = [0.0] * self.d_model
        tok_seed = (token_id * 2654435761) & 0xFFFFFFFF
        for d in range(self.d_model):
            emb[d] = math.sin((tok_seed + d * 31) / 37.0)
        return emb

    def forward_token(self, token_id: int) -> Tuple[List[float], Dict[str, Any]]:
        """
        Executes full Transformer forward pass:
        x_emb -> Attention -> Norm1 -> SwiGLU FFN -> Norm2 -> LM Head -> Logits
        """
        x_emb = self.get_token_embedding(token_id)
        # Residual connection 1: x + Attention(x)
        attn_out = self.attn.forward(x_emb)
        h1 = [x_emb[i] + attn_out[i] for i in range(self.d_model)]
        norm1_out = self.norm1.forward(h1)

        # Residual connection 2: h1 + SwiGLU(norm1_out)
        ffn_out = self.ffn.forward(norm1_out)
        h2 = [h1[i] + ffn_out[i] for i in range(self.d_model)]
        norm2_out = self.norm2.forward(h2)

        # LM Head projection to logits
        logits = self.lm_head.forward(norm2_out)
        cache = {
            "x_emb": x_emb,
            "attn_out": attn_out,
            "h1": h1,
            "norm1_out": norm1_out,
            "ffn_out": ffn_out,
            "h2": h2,
            "norm2_out": norm2_out
        }
        return logits, cache

    def backward_token(self, d_logits: List[float], cache: Dict[str, Any]) -> None:
        """
        Executes full Transformer backpropagation (Chain Rule):
        dL/dlogits -> LM Head -> Norm2 -> SwiGLU FFN -> Norm1 -> Attention
        """
        # 1. Backprop through LM Head
        d_norm2 = self.lm_head.backward(d_logits)
        # 2. Backprop through Norm2
        d_h2 = self.norm2.backward(d_norm2)
        # 3. Residual 2 fork: d_h1 += d_h2, and through FFN
        d_ffn_out = list(d_h2)
        d_norm1 = self.ffn.backward(d_ffn_out)
        # 4. Backprop through Norm1
        d_h1_from_norm1 = self.norm1.backward(d_norm1)
        d_h1 = [d_h2[i] + d_h1_from_norm1[i] for i in range(self.d_model)]
        # 5. Residual 1 fork: through Attention
        d_attn = list(d_h1)
        self.attn.backward(d_attn)

    def train_on_text(self, text: str, epochs: int = 2) -> Dict[str, Any]:
        """
        Executes real backpropagation and AdamW optimization on input text tokens.
        Proves:
        1. Full Transformer backprop (Attention + SwiGLU + Norms + Head)
        2. Gradient coverage across all parameter groups
        3. Real loss reduction (Loss_after < Loss_before)
        4. Numerical gradient correctness
        """
        tokens = self.tokenizer.encode(text)
        if len(tokens) < 3:
            return {"error": "Text too short for sequence training"}

        # Measure baseline parameters before training
        initial_weights_norm = math.sqrt(sum(p.norm() ** 2 for p in self.parameters))

        losses_record: List[float] = []
        grad_norms_record: List[float] = []

        # Train on consecutive token pairs (next-token prediction)
        pairs_to_train = min(len(tokens) - 1, 16)
        named_sublayers: List[Tuple[str, List[Tensor]]] = [
            ("transformer.attn.q_proj", [self.attn.q_proj.weight, self.attn.q_proj.bias]),
            ("transformer.attn.k_proj", [self.attn.k_proj.weight, self.attn.k_proj.bias]),
            ("transformer.attn.v_proj", [self.attn.v_proj.weight, self.attn.v_proj.bias]),
            ("transformer.attn.out_proj", [self.attn.out_proj.weight, self.attn.out_proj.bias]),
            ("transformer.norm1", [self.norm1.weight]),
            ("transformer.ffn.w_gate", [self.ffn.w_gate.weight, self.ffn.w_gate.bias]),
            ("transformer.ffn.w_up", [self.ffn.w_up.weight, self.ffn.w_up.bias]),
            ("transformer.ffn.w_down", [self.ffn.w_down.weight, self.ffn.w_down.bias]),
            ("transformer.norm2", [self.norm2.weight]),
            ("transformer.lm_head", [self.lm_head.weight, self.lm_head.bias]),
        ]
        last_layer_norms_pre_clip: Dict[str, float] = {}
        last_layer_norms_clipped: Dict[str, float] = {}

        for epoch in range(epochs):
            epoch_loss = 0.0
            
            for i in range(pairs_to_train):
                input_tid = tokens[i]
                target_tid = tokens[i + 1] % self.head_dim

                # 1. Forward Pass
                self.optimizer.zero_grad()
                logits, cache = self.forward_token(input_tid)

                # 2. Compute Loss and Output Gradient
                loss_val, d_logits = cross_entropy_loss_and_grad(logits, target_tid)
                epoch_loss += loss_val

                # 3. Backward Pass (Chain Rule through Attention, Norms, SwiGLU)
                self.backward_token(d_logits, cache)

                # Measure real unclipped per-layer gradient L2 norms on the last micro-step
                if epoch == epochs - 1 and i == pairs_to_train - 1:
                    last_layer_norms_pre_clip = {
                        lname: round(math.sqrt(sum(t.grad_norm() ** 2 for t in ltensors)), 6)
                        for lname, ltensors in named_sublayers
                    }

                # 4. Clip Gradients
                g_norm = self.optimizer.clip_grad_norm(max_norm=1.0)
                grad_norms_record.append(g_norm)

                if epoch == epochs - 1 and i == pairs_to_train - 1:
                    last_layer_norms_clipped = {
                        lname: round(math.sqrt(sum(t.grad_norm() ** 2 for t in ltensors)), 6)
                        for lname, ltensors in named_sublayers
                    }

                # 5. Optimizer Step (AdamW Parameter Update)
                self.optimizer.step()

            avg_loss = epoch_loss / pairs_to_train
            losses_record.append(avg_loss)

        loss_before = losses_record[0]
        loss_after = losses_record[-1]
        loss_reduction_pct = round(((loss_before - loss_after) / max(loss_before, 1e-6)) * 100, 2)

        # Measure parameters after training
        final_weights_norm = math.sqrt(sum(p.norm() ** 2 for p in self.parameters))
        param_mutation_delta = abs(final_weights_norm - initial_weights_norm)

        # Analyze gradient coverage across all computational graph tensors (before check_numerical_gradient zeroes lm_head)
        cov_analysis = analyze_gradient_coverage(self.parameters)

        # Numerical gradient verification sample
        sample_x = self.get_token_embedding(tokens[0])
        num_check = check_numerical_gradient(self.lm_head, sample_x, eps=1e-4)

        record = {
            "training_step": self.optimizer.step_count,
            "tokens_processed": pairs_to_train * epochs,
            "epochs": epochs,
            "loss_before": round(loss_before, 4),
            "loss_after": round(loss_after, 4),
            "loss_reduction_pct": loss_reduction_pct,
            "initial_param_norm": round(initial_weights_norm, 4),
            "final_param_norm": round(final_weights_norm, 4),
            "param_mutation_delta": round(param_mutation_delta, 6),
            "param_changed_verified": param_mutation_delta > 1e-6 or loss_after < loss_before,
            "avg_gradient_norm": round(sum(grad_norms_record) / max(1, len(grad_norms_record)), 4),
            "layer_count": len(named_sublayers),
            "layer_gradient_norms": last_layer_norms_clipped,
            "layer_gradient_norms_pre_clip": last_layer_norms_pre_clip,
            "grad_clip_max_norm": 1.0,
            "gradient_coverage": {
                "total_tensors": cov_analysis["total_tensors"],
                "active_grad_tensors": cov_analysis["active_grad_tensors"],
                "coverage_pct": cov_analysis["gradient_coverage_pct"],
                "all_covered": cov_analysis["all_tensors_covered"]
            },
            "numerical_gradient_check": num_check,
            "forward_graph": "Embedding -> MultiHeadAttention -> RMSNorm1 -> SwiGLU -> RMSNorm2 -> LMHead",
            "timestamp": int(time.time())
        }

        self.training_history.append(record)
        return record

    def evaluate_text_nll(self, text: str) -> Dict[str, Any]:
        """Evaluates cross-entropy loss and perplexity on a held-out sequence without mutating weights."""
        tokens = self.tokenizer.encode(text)
        if len(tokens) < 2:
            raise ValueError("Evaluation text requires at least 2 tokens")
        pairs = min(len(tokens) - 1, 32)
        total_loss = 0.0
        for i in range(pairs):
            input_tid = tokens[i]
            target_tid = tokens[i + 1] % self.head_dim
            logits, _ = self.forward_token(input_tid)
            loss_val, _ = cross_entropy_loss_and_grad(logits, target_tid)
            total_loss += loss_val
        mean_nll = total_loss / pairs
        perplexity = math.exp(min(mean_nll, 20.0))
        return {
            "pairs_evaluated": pairs,
            "mean_nll": round(mean_nll, 4),
            "perplexity": round(perplexity, 4),
        }

    def get_flat_parameters(self) -> List[float]:
        flat = []
        for p in self.parameters:
            flat.extend(p.data)
        return flat

    def save_learned_checkpoint(self, checkpoint_path: str, extra_meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Saves the trained Transformer layer weights atomically to checkpoint_path.
        Zero-Fake Standard: Serializes ONLY actual trained parameters (Float32).
        Zero random padding or dummy bytes.
        """
        flat = self.get_flat_parameters()
        payload_array = array.array('f', flat)
        payload_bytes = payload_array.tobytes()
        payload_sha256 = hashlib.sha256(payload_bytes).hexdigest()

        # Build tensor manifest
        manifest = []
        offset = 0
        for l in self.trainable_layers:
            params = []
            if hasattr(l, "parameters"):
                params.extend(l.parameters)
            elif hasattr(l, "weight"):
                params.append(l.weight)
                if hasattr(l, "bias") and l.bias is not None:
                    params.append(l.bias)
            for p in params:
                sz = p.size
                p_bytes = array.array('f', p.data).tobytes()
                manifest.append({
                    "name": getattr(l, "name", "layer"),
                    "shape": list(p.shape),
                    "params": sz,
                    "dtype": "float32",
                    "sha256": hashlib.sha256(p_bytes).hexdigest()
                })
                offset += sz

        metadata = {
            "model_name": "ZYNTHEOR Q+ Sovereign",
            "architecture": "ZYNTHEOR-Native-ActiveSubgraph-v1",
            "version": "1.1.0-ACTIVE-SUBGRAPH",
            "total_params": len(flat),
            "target_total_params": TARGET_TOTAL_PARAMS,
            "vocab_size": self.vocab_size,
            "active_vocab_size": self.head_dim,
            "d_model": self.d_model,
            "n_layers": 1,
            "n_heads": 4,
            "d_ffn": self.d_ffn,
            "storage_mode": "LEARNED_WEIGHTS_TRAINED",
            "trained_subgraph_params": len(flat),
            "parameter_audit": {
                "status": "VERIFIED_ACTIVE_SUBGRAPH",
                "payload_float32_count": len(flat),
                "target_architecture_instantiated": False,
                "note": "Target architecture is a roadmap specification, not the active checkpoint."
            },
            "sha256": payload_sha256,
            "tensors_manifest": manifest,
            "timestamp": int(time.time()),
            "sovereign_invariants": {
                "zero_fake_padding": True,
                "learned_gradients_applied": True,
                "fail_closed_enforced": True,
                "target_architecture_fully_instantiated": False,
                }
        }
        if extra_meta:
            metadata.update(extra_meta)

        meta_json = json.dumps(metadata, indent=2).encode('utf-8')
        meta_len = struct.pack(">I", len(meta_json))

        tmp_path = checkpoint_path + ".tmp"
        os.makedirs(os.path.dirname(checkpoint_path), exist_ok=True)
        with open(tmp_path, "wb") as f:
            f.write(b"ZYNTHEOR_QPLUS_PT")
            f.write(meta_len)
            f.write(meta_json)
            f.write(payload_bytes)

        os.replace(tmp_path, checkpoint_path)
        return {
            "checkpoint_path": checkpoint_path,
            "file_size": os.path.getsize(checkpoint_path),
            "trained_params": len(flat),
            "payload_sha256": payload_sha256,
            "manifest_tensors": len(manifest),
            "metadata": metadata
        }

def run_sample_training() -> Dict[str, Any]:
    trainer = NativeTrainer()
    sample_text = (
        "ZYNTHEOR Native active subgraph training sample; target architecture is under development. "
        "สถาปัตยกรรม ZYNTHEOR ประมวลผลบนเครื่องแบบ Sovereign 100% "
        "const hmac = crypto.createHmac('sha256', secret);"
    )
    res = trainer.train_on_text(sample_text, epochs=2)
    return res

if __name__ == "__main__":
    out = run_sample_training()
    print("Training Verification Output:\n", json.dumps(out, indent=2))
