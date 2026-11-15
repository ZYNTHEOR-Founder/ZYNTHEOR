# -*- coding: utf-8 -*-
"""
ZYNTHEOR Sovereign Native Tensor, Autograd & AdamW Training Engine
Pure Python / C-types implementation with zero external cloud AI or external dependencies.

Implements:
1. Real Float32 Tensor arrays with autograd tracking
2. Backpropagation / Gradient computation (Chain Rule)
3. Cross-Entropy Language Modeling Loss
4. AdamW Optimizer with weight decay, beta1, beta2, and epsilon
5. Gradient Clipping and NaN / Inf Detection
6. Mathematical proof of parameter mutation: ||W_after - W_before|| > 0
"""

import math
import time
import random
import zlib
import array
import struct
from typing import List, Dict, Tuple, Optional, Any

class Tensor:
    """Float32 Tensor with autograd gradient accumulator."""
    def __init__(self, data: List[float], shape: Tuple[int, ...], requires_grad: bool = True):
        self.shape = shape
        self.size = len(data)
        # Store as fast C float array
        self.data = array.array('f', data)
        self.grad = array.array('f', [0.0] * self.size) if requires_grad else None
        self.requires_grad = requires_grad

    def zero_grad(self):
        if self.grad is not None:
            for i in range(self.size):
                self.grad[i] = 0.0

    def has_nan_or_inf(self) -> bool:
        for val in self.data:
            if math.isnan(val) or math.isinf(val):
                return True
        return False

    def norm(self) -> float:
        return math.sqrt(sum(x * x for x in self.data))

    def grad_norm(self) -> float:
        if self.grad is None:
            return 0.0
        return math.sqrt(sum(g * g for g in self.grad))

class LinearLayer:
    """Linear projection layer W x + b with autograd forward and backward."""
    def __init__(self, in_features: int, out_features: int, name: str = "linear"):
        self.in_features = in_features
        self.out_features = out_features
        self.name = name

        # He / Kaiming normal initialization
        std = math.sqrt(2.0 / in_features)
        # Reproducible across processes: Python's built-in hash() of str is salted
        # per process (PYTHONHASHSEED), so a stable CRC32 of the layer name seeds the RNG.
        rng = random.Random(zlib.crc32(name.encode("utf-8")))
        seed_data = [rng.gauss(0.0, std) for _ in range(in_features * out_features)]

        self.weight = Tensor(seed_data, (out_features, in_features), requires_grad=True)
        self.bias = Tensor([0.0] * out_features, (out_features,), requires_grad=True)
        self.last_input: Optional[List[float]] = None

    def forward(self, x: List[float]) -> List[float]:
        """Matrix multiplication W * x + b."""
        self.last_input = list(x)
        out = [0.0] * self.out_features
        w_data = self.weight.data
        b_data = self.bias.data

        for i in range(self.out_features):
            acc = b_data[i]
            offset = i * self.in_features
            for j in range(self.in_features):
                acc += w_data[offset + j] * x[j]
            out[i] = acc
        return out

    def backward(self, grad_output: List[float]) -> List[float]:
        """Backward pass: computes gradients dL/dW, dL/db and returns dL/dx."""
        if self.last_input is None:
            raise RuntimeError("Backward called before forward pass.")

        grad_input = [0.0] * self.in_features
        w_data = self.weight.data
        w_grad = self.weight.grad
        b_grad = self.bias.grad

        for i in range(self.out_features):
            g = grad_output[i]
            if b_grad is not None:
                b_grad[i] += g
            offset = i * self.in_features
            for j in range(self.in_features):
                in_val = self.last_input[j]
                if w_grad is not None:
                    w_grad[offset + j] += g * in_val
                grad_input[j] += g * w_data[offset + j]

        return grad_input

class NativeAdamW:
    """
    Sovereign AdamW Optimizer
    Implements decoupled weight decay, momentum m, velocity v, and gradient clipping.
    """
    def __init__(self, parameters: List[Tensor], lr: float = 1e-4, betas: Tuple[float, float] = (0.9, 0.999), eps: float = 1e-8, weight_decay: float = 0.01):
        self.parameters = [p for p in parameters if p.requires_grad]
        self.lr = lr
        self.beta1 = betas[0]
        self.beta2 = betas[1]
        self.eps = eps
        self.weight_decay = weight_decay
        self.step_count = 0

        # State buffers
        self.m: List[array.array] = [array.array('f', [0.0] * p.size) for p in self.parameters]
        self.v: List[array.array] = [array.array('f', [0.0] * p.size) for p in self.parameters]

    def zero_grad(self):
        for p in self.parameters:
            p.zero_grad()

    def clip_grad_norm(self, max_norm: float = 1.0) -> float:
        total_sq_norm = 0.0
        for p in self.parameters:
            if p.grad is not None:
                for g in p.grad:
                    total_sq_norm += g * g
        total_norm = math.sqrt(total_sq_norm)

        if total_norm > max_norm and total_norm > 1e-6:
            scale = max_norm / total_norm
            for p in self.parameters:
                if p.grad is not None:
                    for i in range(p.size):
                        p.grad[i] *= scale

        return total_norm

    def step(self) -> Dict[str, float]:
        self.step_count += 1
        t = self.step_count
        lr = self.lr
        beta1 = self.beta1
        beta2 = self.beta2
        eps = self.eps
        wd = self.weight_decay

        total_param_delta_sq = 0.0
        total_param_count = 0

        for idx, p in enumerate(self.parameters):
            if p.grad is None:
                continue

            data = p.data
            grad = p.grad
            m = self.m[idx]
            v = self.v[idx]
            size = p.size
            total_param_count += size

            for i in range(size):
                g = grad[i]
                if math.isnan(g) or math.isinf(g):
                    g = 0.0

                # Decoupled weight decay
                data[i] -= lr * wd * data[i]

                # Update biased 1st and 2nd moment estimate
                m[i] = beta1 * m[i] + (1.0 - beta1) * g
                v[i] = beta2 * v[i] + (1.0 - beta2) * (g * g)

                # Bias correction
                m_hat = m[i] / (1.0 - math.pow(beta1, t))
                v_hat = v[i] / (1.0 - math.pow(beta2, t))

                # Compute parameter update delta
                delta = lr * m_hat / (math.sqrt(v_hat) + eps)
                data[i] -= delta
                total_param_delta_sq += delta * delta

        param_delta_l2 = math.sqrt(total_param_delta_sq)
        return {
            "step": t,
            "lr": lr,
            "param_delta_l2": param_delta_l2,
            "total_updated_params": total_param_count
        }

def cross_entropy_loss_and_grad(logits: List[float], target_idx: int) -> Tuple[float, List[float]]:
    """
    Computes numerically stable softmax Cross-Entropy Loss and gradient dL/dlogits.
    """
    max_logit = max(logits)
    exp_logits = [math.exp(l - max_logit) for l in logits]
    sum_exp = sum(exp_logits)
    probs = [e / sum_exp for e in exp_logits]

    # Negative log likelihood of target
    loss = -math.log(max(probs[target_idx], 1e-12))

    # Gradient: prob_i - 1(i == target)
    grad = [probs[i] - (1.0 if i == target_idx else 0.0) for i in range(len(logits))]
    return loss, grad

class RMSNormLayer:
    """Root Mean Square Layer Normalization with learnable scale weights."""
    def __init__(self, dim: int, eps: float = 1e-6, name: str = "rmsnorm"):
        self.dim = dim
        self.eps = eps
        self.name = name
        self.weight = Tensor([1.0] * dim, (dim,), requires_grad=True)
        self.last_x: Optional[List[float]] = None
        self.last_rms: float = 1.0

    def forward(self, x: List[float]) -> List[float]:
        self.last_x = list(x)
        mean_sq = sum(v * v for v in x) / self.dim
        self.last_rms = math.sqrt(mean_sq + self.eps)
        inv_rms = 1.0 / self.last_rms
        w = self.weight.data
        return [x[i] * inv_rms * w[i] for i in range(self.dim)]

    def backward(self, grad_output: List[float]) -> List[float]:
        if self.last_x is None:
            raise RuntimeError("Backward called before forward pass.")
        x = self.last_x
        inv_rms = 1.0 / self.last_rms
        inv_rms_cubed = inv_rms * inv_rms * inv_rms
        w = self.weight.data
        w_grad = self.weight.grad

        # Gradient w.r.t weight: sum over batch/seq (here single vector)
        for i in range(self.dim):
            if w_grad is not None:
                w_grad[i] += grad_output[i] * (x[i] * inv_rms)

        # Gradient w.r.t input x
        # dL/dx_i = grad_output_i * w_i * inv_rms - (x_i * inv_rms_cubed / dim) * sum(grad_output_j * w_j * x_j)
        inner_dot = sum(grad_output[j] * w[j] * x[j] for j in range(self.dim))
        grad_input = [0.0] * self.dim
        for i in range(self.dim):
            grad_input[i] = (grad_output[i] * w[i] * inv_rms) - (x[i] * inv_rms_cubed * inner_dot / self.dim)
        return grad_input

class MultiHeadAttentionLayer:
    """
    Sovereign Self-Attention Layer with Q, K, V and Out projections.
    Supports autograd forward and backward passes across all projection matrices.
    """
    def __init__(self, d_model: int, n_heads: int = 8, name: str = "attn"):
        self.d_model = d_model
        self.n_heads = n_heads
        self.d_head = d_model // n_heads
        self.name = name

        self.q_proj = LinearLayer(d_model, d_model, name=f"{name}.q_proj")
        self.k_proj = LinearLayer(d_model, d_model, name=f"{name}.k_proj")
        self.v_proj = LinearLayer(d_model, d_model, name=f"{name}.v_proj")
        self.out_proj = LinearLayer(d_model, d_model, name=f"{name}.out_proj")

        self.parameters: List[Tensor] = [
            self.q_proj.weight, self.q_proj.bias,
            self.k_proj.weight, self.k_proj.bias,
            self.v_proj.weight, self.v_proj.bias,
            self.out_proj.weight, self.out_proj.bias
        ]
        self.last_attn_ctx: Optional[List[float]] = None
        self._q_hat: Optional[List[float]] = None
        self._k_hat: Optional[List[float]] = None
        self._rms_q: Optional[List[float]] = None
        self._rms_k: Optional[List[float]] = None
        self._v: Optional[List[float]] = None
        self._w: Optional[List[float]] = None

    def forward(self, x: List[float]) -> List[float]:
        """Single-token QK-RMSNorm self-gated attention (v1 subgraph; sequence attention lives in lm_v2)."""
        q = self.q_proj.forward(x)
        k = self.k_proj.forward(x)
        v = self.v_proj.forward(x)

        # Per-head QK-RMSNorm prevents attention logit saturation (dot stays in [-sqrt(d_head), sqrt(d_head)])
        scale = 1.0 / math.sqrt(max(1, self.d_head))
        eps = 1e-6
        attn_vec = [0.0] * self.d_model
        q_hat = [0.0] * self.d_model
        k_hat = [0.0] * self.d_model
        rms_q_list: List[float] = []
        rms_k_list: List[float] = []
        weights: List[float] = []

        for h in range(self.n_heads):
            o = h * self.d_head
            mean_q2 = sum(q[o + i] * q[o + i] for i in range(self.d_head)) / self.d_head
            mean_k2 = sum(k[o + i] * k[o + i] for i in range(self.d_head)) / self.d_head
            rq = math.sqrt(mean_q2 + eps)
            rk = math.sqrt(mean_k2 + eps)
            rms_q_list.append(rq)
            rms_k_list.append(rk)
            for i in range(self.d_head):
                q_hat[o + i] = q[o + i] / rq
                k_hat[o + i] = k[o + i] / rk

            dot = sum(q_hat[o + i] * k_hat[o + i] for i in range(self.d_head)) * scale
            weight = 1.0 / (1.0 + math.exp(-dot))
            weights.append(weight)
            for i in range(self.d_head):
                attn_vec[o + i] = v[o + i] * weight

        self._q_hat, self._k_hat = q_hat, k_hat
        self._rms_q, self._rms_k = rms_q_list, rms_k_list
        self._v, self._w = v, weights
        self.last_attn_ctx = list(attn_vec)
        return self.out_proj.forward(attn_vec)

    def backward(self, grad_output: List[float]) -> List[float]:
        """
        Exact backward pass through out_proj, per-head sigmoid gate, QK-RMSNorm, and Q/K/V projections.
        """
        if self._q_hat is None or self._k_hat is None or self._rms_q is None or self._rms_k is None or self._v is None or self._w is None:
            raise RuntimeError("Backward called before forward pass.")
        d_ctx = self.out_proj.backward(grad_output)
        scale = 1.0 / math.sqrt(max(1, self.d_head))
        d_q = [0.0] * self.d_model
        d_k = [0.0] * self.d_model
        d_v = [0.0] * self.d_model
        for h in range(self.n_heads):
            o = h * self.d_head
            w = self._w[h]
            rq = self._rms_q[h]
            rk = self._rms_k[h]
            d_w = 0.0
            for i in range(self.d_head):
                d_v[o + i] = d_ctx[o + i] * w
                d_w += d_ctx[o + i] * self._v[o + i]
            d_dot = d_w * w * (1.0 - w)

            # Backprop through QK-RMSNorm: d_x = (d_xhat - xhat * mean(d_xhat * xhat)) / rms
            dq_hat = [d_dot * scale * self._k_hat[o + i] for i in range(self.d_head)]
            dk_hat = [d_dot * scale * self._q_hat[o + i] for i in range(self.d_head)]
            mean_dq_qhat = sum(dq_hat[i] * self._q_hat[o + i] for i in range(self.d_head)) / self.d_head
            mean_dk_khat = sum(dk_hat[i] * self._k_hat[o + i] for i in range(self.d_head)) / self.d_head
            for i in range(self.d_head):
                d_q[o + i] = (dq_hat[i] - self._q_hat[o + i] * mean_dq_qhat) / rq
                d_k[o + i] = (dk_hat[i] - self._k_hat[o + i] * mean_dk_khat) / rk

        dx_q = self.q_proj.backward(d_q)
        dx_k = self.k_proj.backward(d_k)
        dx_v = self.v_proj.backward(d_v)
        return [dx_q[i] + dx_k[i] + dx_v[i] for i in range(self.d_model)]

class SwiGLUFeedForwardLayer:
    """
    Sovereign SwiGLU Feed-Forward Network Layer
    Implements Swish(W_gate * x) * (W_up * x) -> W_down * h with full autograd.
    """
    def __init__(self, d_model: int, d_ffn: int, name: str = "swiglu"):
        self.d_model = d_model
        self.d_ffn = d_ffn
        self.name = name

        self.w_gate = LinearLayer(d_model, d_ffn, name=f"{name}.w_gate")
        self.w_up = LinearLayer(d_model, d_ffn, name=f"{name}.w_up")
        self.w_down = LinearLayer(d_ffn, d_model, name=f"{name}.w_down")

        self.parameters: List[Tensor] = [
            self.w_gate.weight, self.w_gate.bias,
            self.w_up.weight, self.w_up.bias,
            self.w_down.weight, self.w_down.bias
        ]
        self.last_gate: Optional[List[float]] = None
        self.last_up: Optional[List[float]] = None
        self.last_hidden: Optional[List[float]] = None

    def forward(self, x: List[float]) -> List[float]:
        gate = self.w_gate.forward(x)
        up = self.w_up.forward(x)

        self.last_gate = list(gate)
        self.last_up = list(up)

        # Swish(gate) = gate * sigmoid(gate)
        hidden = [0.0] * self.d_ffn
        for i in range(self.d_ffn):
            g = gate[i]
            sig = 1.0 / (1.0 + math.exp(-min(max(g, -15.0), 15.0)))
            swish = g * sig
            hidden[i] = swish * up[i]

        self.last_hidden = list(hidden)
        return self.w_down.forward(hidden)

    def backward(self, grad_output: List[float]) -> List[float]:
        if self.last_gate is None or self.last_up is None:
            raise RuntimeError("Backward called before forward pass.")

        d_hidden = self.w_down.backward(grad_output)
        d_gate = [0.0] * self.d_ffn
        d_up = [0.0] * self.d_ffn

        for i in range(self.d_ffn):
            g = self.last_gate[i]
            u = self.last_up[i]
            sig = 1.0 / (1.0 + math.exp(-min(max(g, -15.0), 15.0)))
            swish = g * sig
            d_swish_dg = sig + g * sig * (1.0 - sig)

            d_hidden_val = d_hidden[i]
            d_up[i] = d_hidden_val * swish
            d_gate[i] = d_hidden_val * u * d_swish_dg

        d_x_gate = self.w_gate.backward(d_gate)
        d_x_up = self.w_up.backward(d_up)

        return [d_x_gate[j] + d_x_up[j] for j in range(self.d_model)]

def check_numerical_gradient(layer: LinearLayer, x: List[float], eps: float = 1e-4) -> Dict[str, Any]:
    """
    Verifies analytical autograd gradients against finite-difference numerical gradients:
    g_num = [f(x + eps) - f(x - eps)] / (2 * eps)
    Proves mathematical exactness of the backward implementation.
    """
    layer.weight.zero_grad()
    layer.bias.zero_grad()

    # Analytical gradient pass
    y = layer.forward(x)
    dummy_grad = [1.0] * len(y)
    layer.backward(dummy_grad)
    ana_w_grad = list(layer.weight.grad)

    # Numerical finite difference on sample weight indices
    max_rel_error = 0.0
    checked_indices = min(20, layer.weight.size)
    sample_step = max(1, layer.weight.size // checked_indices)

    for idx in range(0, layer.weight.size, sample_step):
        orig_val = layer.weight.data[idx]

        # f(w + eps)
        layer.weight.data[idx] = orig_val + eps
        y_pos = sum(layer.forward(x))

        # f(w - eps)
        layer.weight.data[idx] = orig_val - eps
        y_neg = sum(layer.forward(x))

        layer.weight.data[idx] = orig_val # Restore
        num_grad = (y_pos - y_neg) / (2.0 * eps)
        ana_grad = ana_w_grad[idx]

        denom = max(abs(ana_grad) + abs(num_grad), 1e-6)
        rel_error = abs(ana_grad - num_grad) / denom
        if rel_error > max_rel_error:
            max_rel_error = rel_error

    return {
        "layer_name": layer.name,
        "max_relative_error": round(max_rel_error, 6),
        "passed": max_rel_error < 0.05,
        "checked_samples": checked_indices
    }

def analyze_gradient_coverage(parameters: List[Tensor]) -> Dict[str, Any]:
    """
    Audits gradient coverage across all parameter tensors in the computational graph.
    Returns percentage of tensors receiving non-zero gradients.
    """
    total_tensors = len(parameters)
    active_grad_tensors = 0
    tensor_stats = []

    for idx, p in enumerate(parameters):
        norm = p.norm()
        g_norm = p.grad_norm()
        has_grad = g_norm > 1e-8
        if has_grad:
            active_grad_tensors += 1
        tensor_stats.append({
            "index": idx,
            "shape": list(p.shape),
            "size": p.size,
            "weight_norm": round(norm, 5),
            "grad_norm": round(g_norm, 6),
            "received_gradient": has_grad
        })

    coverage_pct = round((active_grad_tensors / max(1, total_tensors)) * 100, 2)
    return {
        "total_tensors": total_tensors,
        "active_grad_tensors": active_grad_tensors,
        "gradient_coverage_pct": coverage_pct,
        "all_tensors_covered": active_grad_tensors == total_tensors,
        "tensor_details": tensor_stats
    }

