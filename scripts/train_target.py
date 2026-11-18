# -*- coding: utf-8 -*-
"""CLI wrapper delegating directly to `qplus_native.train_target`."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qplus_native.train_target import main


if __name__ == "__main__":
    raise SystemExit(main())
