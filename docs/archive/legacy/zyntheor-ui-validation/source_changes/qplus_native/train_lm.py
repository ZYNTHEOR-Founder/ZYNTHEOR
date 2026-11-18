# -*- coding: utf-8 -*-
"""Governance-gated NativeLM v2 trainer with explicit warm-start vs exact resume.

No training is run by importing this module. Training requires an externally signed
provenance manifest/trust key and a new output path; existing checkpoints are never overwritten.
"""
import os
import sys
import json
import time
import math
import argparse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from qplus_native.tokenizer import SovereignTokenizer
from qplus_native.corpus import build_corpus
from qplus_native.lm_v2 import NativeLM, LMConfig, AdamW, real_vocab_size, V2_CHECKPOINT_PATH, ROOT
from qplus_native.training_readiness import validate_training_readiness
from qplus_native.training_state import load_resume_bundle, save_resume_bundle, config_fingerprint

EVIDENCE_PATH = os.path.join(ROOT, "artifacts", "lm-v2-training-evidence.json")
DEFAULT_PROVENANCE = os.path.join(ROOT, "artifacts", "dataset-provenance-manifest.json")
DEFAULT_EVIDENCE_ROOT = os.path.join(ROOT, "artifacts", "dataset-provenance-evidence")


def encode_docs(tok, docs):
    return [np.array(tok.encode(d["text"]), dtype=np.int64) for d in docs]


def sample_batch(rng, streams, batch, T):
    xs, ys = [], []
    lens = np.array([max(len(s) - T - 1, 0) for s in streams], dtype=np.float64)
    prob = lens / lens.sum()
    for _ in range(batch):
        s = streams[rng.choice(len(streams), p=prob)]
        i = int(rng.integers(0, len(s) - T - 1))
        xs.append(s[i:i + T])
        ys.append(s[i + 1:i + T + 1])
    return np.stack(xs), np.stack(ys)


def eval_stream_loss(model: NativeLM, streams, T: int, max_windows=None) -> float:
    """Mean next-token cross-entropy over validation documents only."""
    X, Y = [], []
    for s in streams:
        for i in range(0, len(s) - T - 1, T):
            X.append(s[i:i + T]); Y.append(s[i + 1:i + T + 1])
            if max_windows and len(X) >= max_windows:
                break
        if max_windows and len(X) >= max_windows:
            break
    if not X:
        return float("nan")
    X, Y = np.stack(X), np.stack(Y)
    tot = 0.0
    for i in range(0, len(X), 64):
        lg, _ = model.forward(X[i:i + 64])
        tot += NativeLM.ce_loss(lg, Y[i:i + 64])[0] * len(X[i:i + 64])
    return float(tot / len(X))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=1500, help="updates in this invocation")
    ap.add_argument("--schedule-total-steps", type=int, default=None,
                    help="fixed full schedule horizon; set before chunked exact resume")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=float(os.getenv("ZYNTHEOR_LM_LR", "2e-3")))
    ap.add_argument("--weight-decay", type=float, default=float(os.getenv("ZYNTHEOR_LM_WEIGHT_DECAY", "0.01")))
    ap.add_argument("--eval-every", type=int, default=100)
    ap.add_argument("--max-eval-windows", type=int, default=128)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--init", default=None, help="weights-only warm start; optimizer/RNG are reset")
    ap.add_argument("--resume-state", default=None, help="strict exact-resume bundle; mutually exclusive with --init")
    ap.add_argument("--save-resume-state", default=None, help="write immutable optimizer/RNG/scheduler sidecar at end")
    ap.add_argument("--dataset-provenance", default=DEFAULT_PROVENANCE)
    ap.add_argument("--evidence-root", default=DEFAULT_EVIDENCE_ROOT)
    ap.add_argument("--approval-key-file", default=None, help="external 0600 trusted approval key; never stored in source")
    ap.add_argument("--out", default=V2_CHECKPOINT_PATH, help="new checkpoint path; must not already exist")
    ap.add_argument("--no-save", action="store_true")
    a = ap.parse_args(argv)
    if not (1 <= a.steps <= 20000):
        raise SystemExit("--steps must be within [1, 20000]")
    if a.init and a.resume_state:
        raise SystemExit("--init and --resume-state are mutually exclusive")
    if a.resume_state and a.schedule_total_steps is None:
        raise SystemExit("FAIL_CLOSED: exact resume requires the original --schedule-total-steps")
    schedule_total = a.schedule_total_steps or a.steps
    if schedule_total < a.steps or schedule_total < 1:
        raise SystemExit("--schedule-total-steps must be >= --steps")
    if not a.no_save and os.path.exists(a.out):
        raise SystemExit(f"FAIL_CLOSED: output checkpoint already exists; choose a new --out: {a.out}")
    if a.save_resume_state and os.path.exists(a.save_resume_state):
        raise SystemExit(f"FAIL_CLOSED: refusing to overwrite resume bundle: {a.save_resume_state}")

    tok = SovereignTokenizer()
    corpus = build_corpus()
    docs_by_id = {d["id"]: d for d in corpus["docs"]}
    try:
        with open(a.dataset_provenance, "r", encoding="utf-8") as fh:
            pmanifest = json.load(fh)
    except (OSError, ValueError):
        raise SystemExit("FAIL_CLOSED: dataset provenance manifest missing/invalid; training not started")
    split_by_id = {d.get("document_id"): d.get("split") for d in pmanifest.get("documents", []) if isinstance(d, dict)}
    frozen = {doc_id: {"text": d["text"], "split": split_by_id.get(doc_id, "unassigned")}
              for doc_id, d in docs_by_id.items()}
    readiness = validate_training_readiness(a.dataset_provenance, a.evidence_root, a.approval_key_file, frozen)
    if readiness.get("status") != "VERIFIED":
        raise SystemExit("FAIL_CLOSED: dataset governance blocked training: " + json.dumps(readiness.get("issues", []), ensure_ascii=False))
    split_by_id = {d["document_id"]: d["split"] for d in pmanifest["documents"]}
    train_docs = [d for doc_id, d in docs_by_id.items() if split_by_id.get(doc_id) == "train"]
    val_docs = [d for doc_id, d in docs_by_id.items() if split_by_id.get(doc_id) == "validation"]
    test_docs = [d for doc_id, d in docs_by_id.items() if split_by_id.get(doc_id) == "test"]
    if not train_docs or not val_docs or not test_docs:
        raise SystemExit("FAIL_CLOSED: train/validation/test must all be non-empty")
    # Test documents are verified for leakage/provenance, but never tokenized or scored here.
    tr, va = encode_docs(tok, train_docs), encode_docs(tok, val_docs)
    cfg = LMConfig(vocab=real_vocab_size(tok))
    T = cfg.ctx
    max_eval_win = a.max_eval_windows if a.max_eval_windows > 0 else None
    corpus_hash = readiness["corpus_sha256"]
    warm = max(1, min(100, schedule_total // 10))
    training_config = {"model": cfg.to_dict(), "batch": a.batch, "lr": a.lr,
                       "weight_decay": a.weight_decay, "seed": a.seed, "ctx": T,
                       "schedule_total_steps": schedule_total, "eval_every": a.eval_every,
                       "max_eval_windows": max_eval_win, "optimizer": "AdamW-v1"}
    config_hash = config_fingerprint(training_config)

    resumed, prev_meta, global_step_start = False, None, 0
    if a.resume_state:
        restored = load_resume_bundle(a.resume_state, tok, expected_corpus_sha256=corpus_hash,
                                      expected_configuration=training_config)
        model, opt, rng = restored["model"], restored["optimizer"], restored["rng"]
        global_step_start = restored["global_step"]
        if global_step_start + a.steps > schedule_total:
            raise SystemExit("FAIL_CLOSED: exact resume exceeds the saved schedule horizon")
        expected_scheduler = {"kind": "cosine_with_warmup", "base_lr": a.lr,
                              "warmup_steps": warm, "total_steps": schedule_total,
                              "global_step": global_step_start}
        if restored["scheduler_state"] != expected_scheduler:
            raise SystemExit("FAIL_CLOSED: saved scheduler state differs from requested schedule")
        prev_meta, resumed = restored["model_metadata"], True
        resume_mode = "EXACT_STATE_RESTORED"
    else:
        if a.init:
            model, prev_meta = NativeLM.load(a.init, tok)
            resumed = True
            resume_mode = "WARM_START_WEIGHTS_ONLY"
        else:
            model = NativeLM(cfg, seed=a.seed)
            resume_mode = "FRESH_INITIALIZATION"
        opt = AdamW(model, lr=a.lr, weight_decay=a.weight_decay)
        rng = np.random.default_rng(a.seed)
    if model.cfg.to_dict() != cfg.to_dict():
        raise SystemExit("FAIL_CLOSED: loaded checkpoint model config differs from current runtime config")

    base_val = eval_stream_loss(model, va, T, max_windows=max_eval_win)
    print(f"params={model.num_params():,} vocab={cfg.vocab} resumed={resumed} mode={resume_mode} "
          f"train_docs={len(train_docs)} val_docs={len(val_docs)} test_docs={len(test_docs)} val_loss_start={base_val:.4f}")
    history, t0 = [], time.time()
    best_val, best_state = base_val, {k: v.copy() for k, v in model.p.items()}
    for local_step in range(1, a.steps + 1):
        global_step = global_step_start + local_step
        lr = a.lr * min(1.0, global_step / warm) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * global_step / schedule_total)))
        x, y = sample_batch(rng, tr, a.batch, T)
        lg, cache = model.forward(x, keep_cache=True)
        loss, dl = NativeLM.ce_loss(lg, y)
        if not math.isfinite(loss):
            raise SystemExit(f"FAIL_CLOSED: non-finite loss at global step {global_step}")
        gnorm = opt.step(model, model.backward(dl, cache), lr=lr)
        if local_step % a.eval_every == 0 or local_step == a.steps:
            vl = eval_stream_loss(model, va, T, max_windows=max_eval_win)
            history.append({"step": global_step, "train_loss": round(loss, 4), "val_loss": round(vl, 4),
                            "grad_norm": round(gnorm, 3), "lr": round(lr, 8)})
            print(f"step {global_step:5d}  train {loss:.4f}  val {vl:.4f}  gnorm {gnorm:.2f}  {time.time()-t0:.0f}s", flush=True)
            if vl < best_val:
                best_val, best_state = vl, {k: v.copy() for k, v in model.p.items()}

    final_global_step = global_step_start + a.steps
    scheduler_state = {"kind": "cosine_with_warmup", "base_lr": a.lr, "warmup_steps": warm,
                       "total_steps": schedule_total, "global_step": final_global_step}
    resume_bundle_info = None
    if a.save_resume_state:
        # Persist last-step weights together with matching optimizer/RNG before restoring best-val weights.
        resume_bundle_info = save_resume_bundle(a.save_resume_state, model, tok, opt,
            global_step=final_global_step, scheduler_state=scheduler_state, rng=rng,
            corpus_sha256=corpus_hash, configuration=training_config)
    model.p = best_state

    accepted = (not resumed) or (best_val < base_val)
    decision = "ACCEPTED" if accepted else "REJECTED_REGRESSION"
    saved = None
    if accepted and not a.no_save:
        total_steps = final_global_step if resume_mode == "EXACT_STATE_RESTORED" else int((prev_meta or {}).get("training_steps_total", 0)) + a.steps
        meta = model.save(a.out, tok, extra_meta={
            "validation_loss": best_val, "validation_perplexity": math.exp(best_val),
            "training_steps_total": total_steps, "corpus_sha256": corpus_hash,
            "corpus_summary": {"train_docs": len(train_docs), "validation_docs": len(val_docs), "test_docs_excluded": len(test_docs)},
            "training_config_sha256": config_hash, "training_resume_mode": resume_mode,
            "hyperparameters": {"lr": a.lr, "weight_decay": a.weight_decay, "batch": a.batch,
                                "steps_this_run": a.steps, "schedule_total_steps": schedule_total, "ctx": T},
        })
        saved = {"path": a.out, "payload_sha256": meta["sha256"], "total_params": meta["total_params"]}
    run = {"timestamp": int(time.time()), "resumed": resumed, "resume_mode": resume_mode,
           "global_step_start": global_step_start, "global_step_end": final_global_step,
           "decision": decision, "val_loss_start": base_val, "val_loss_best": best_val,
           "corpus_sha256": corpus_hash, "training_config_sha256": config_hash,
           "governance_status": readiness["status"], "history": history, "saved": saved,
           "resume_bundle": resume_bundle_info}
    ev = json.load(open(EVIDENCE_PATH)) if os.path.exists(EVIDENCE_PATH) else {"runs": []}
    ev["runs"].append(run)
    os.makedirs(os.path.dirname(EVIDENCE_PATH), exist_ok=True)
    with open(EVIDENCE_PATH, "w", encoding="utf-8") as fh:
        json.dump(ev, fh, indent=2, ensure_ascii=False)
    print(f"{decision}: val_loss {base_val:.4f} -> {best_val:.4f} (ppl {math.exp(best_val):.2f}) saved={bool(saved)}")


if __name__ == "__main__":
    main()
