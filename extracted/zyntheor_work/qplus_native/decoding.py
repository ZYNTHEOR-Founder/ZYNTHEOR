# -*- coding: utf-8 -*-
"""
Decoding controls for NativeLM-format models (works with any object exposing next_token_logits(ids)).

These change HOW text is chosen from the learned logits; they add no knowledge. Their purpose is to
stop degenerate loops ("and and and ...") without the blunt trick of subtracting a constant from the
logit of every token seen so far (which also punishes the prompt and any legitimately repeated word).

  * repetition_penalty : CTRL-style, multiplicative, applied only to the last `rep_window` tokens
  * no_repeat_ngram    : hard-blocks any token that would complete an n-gram already present
  * top_k / top_p      : truncation before sampling
  * temperature <= 0   : greedy
Ids below `min_id` ([PAD], [BOS], [EOS], [UNK]) are never emitted as content.
"""
from typing import List, Optional, Set

import numpy as np

NEG = -1e30


def apply_controls(logits: np.ndarray, ids: List[int], repetition_penalty: float, rep_window: int,
                   no_repeat_ngram: int, min_id: int) -> np.ndarray:
    lg = np.array(logits, dtype=np.float64, copy=True)
    lg[:min_id] = NEG
    if repetition_penalty and repetition_penalty != 1.0:
        for t in set(ids[-rep_window:]):
            if t < lg.size and lg[t] > NEG / 2:
                lg[t] = lg[t] / repetition_penalty if lg[t] > 0 else lg[t] * repetition_penalty
    n = no_repeat_ngram
    if n >= 2 and len(ids) >= n - 1:
        prefix = tuple(ids[len(ids) - (n - 1):])
        for i in range(len(ids) - n + 1):
            if tuple(ids[i:i + n - 1]) == prefix:
                lg[ids[i + n - 1]] = NEG
    return lg


def sample_from(lg: np.ndarray, temperature: float, top_k: int, top_p: float, rng) -> int:
    if temperature <= 0:
        return int(np.argmax(lg))
    lg = lg / temperature
    if top_k and top_k < lg.size:
        kth = np.partition(lg, -top_k)[-top_k]
        lg = np.where(lg < kth, NEG, lg)
    pr = np.exp(lg - lg.max())
    pr /= pr.sum()
    if top_p < 1.0:
        order = np.argsort(-pr)
        csum = np.cumsum(pr[order])
        keep = order[: int(np.searchsorted(csum, top_p) + 1)]
        mask = np.zeros_like(pr)
        mask[keep] = pr[keep]
        pr = mask / mask.sum()
    return int(rng.choice(pr.size, p=pr))


def generate(model, prompt_ids: List[int], max_new_tokens: int = 64, temperature: float = 0.8,
             top_k: int = 20, top_p: float = 1.0, repetition_penalty: float = 1.0, rep_window: int = 64,
             no_repeat_ngram: int = 0, seed: Optional[int] = None, stop_ids: Optional[Set[int]] = None,
             min_id: int = 4) -> List[int]:
    if not (0.0 < top_p <= 1.0):
        raise ValueError("top_p must be within (0, 1]")
    if not (1.0 <= repetition_penalty <= 3.0):
        raise ValueError("repetition_penalty must be within [1, 3]")
    if no_repeat_ngram not in (0,) and not (2 <= no_repeat_ngram <= 8):
        raise ValueError("no_repeat_ngram must be 0 (off) or within [2, 8]")
    rng = np.random.default_rng(seed)
    ids = list(prompt_ids) if prompt_ids else [1]
    out: List[int] = []
    for _ in range(max_new_tokens):
        lg = apply_controls(model.next_token_logits(ids), ids, repetition_penalty, rep_window,
                            no_repeat_ngram, min_id)
        nxt = sample_from(lg, temperature, top_k, top_p, rng)
        ids.append(nxt)
        out.append(nxt)
        if stop_ids and nxt in stop_ids:
            break
    return out
