# -*- coding: utf-8 -*-
"""Read-only inspector for ZYNTHEOR NativeLM `.pt` (`ZYNTHEOR_QPLUS_PT`) checkpoints."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.candidate_audit import inspect_checkpoint

DEFAULT_CKPT = ROOT / "native_data" / "model_checkpoint_target_41m.pt"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Inspect ZYNTHEOR_QPLUS_PT checkpoint container and SHA-256.")
    ap.add_argument("checkpoint", nargs="?", default=str(DEFAULT_CKPT))
    args = ap.parse_args(argv)

    p = Path(args.checkpoint)
    if not p.is_file():
        print(json.dumps({"status": "MISSING", "path": str(p), "exists": False}, indent=2))
        return 1

    report = inspect_checkpoint(p)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("integrity_status") == "STRUCTURAL_CHECKS_PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
