# -*- coding: utf-8 -*-
"""
Gate 2: controlled execution layer for the Orchestrator.

Every file or process action goes through Sandbox. Nothing here is "intelligence"; it is a set of checks that
are covered by tests (tests/native-lm-v2.test.py::SafeExec).

  * paths      : must resolve (symlinks followed) inside the workdir; secret-like names are refused
  * files      : write/overwrite takes a snapshot first; rollback(snapshot_id) restores it
  * delete     : needs an approval callback that returns True; otherwise refused
  * processes  : argv list only (shell=False), allowlisted programs with argument validators,
                 scrubbed environment, wall-clock timeout, CPU/memory/file-size limits, capped output
  * audit      : append-only JSONL, each entry hash-chained to the previous one; verify_audit() detects edits
Not covered: this is not an OS-level sandbox (no namespaces/seccomp). Run untrusted code in a container.
"""
import errno
import os
import re
import json
import stat
import time
import shutil
import hashlib
import subprocess
from typing import Callable, Dict, List, Optional

SECRET_NAME_RE = re.compile(r"(^|/)(\.env(\..*)?|id_rsa.*|id_ed25519.*|.*\.pem|.*\.key|credentials(\.json)?|\.netrc|\.git-credentials)$", re.I)
SECRET_VALUE_RE = re.compile(r"(?i)((?:api[_-]?key|secret|passw(?:or)?d|token|bearer)\w*\s*[:=]\s*)['\"]?[A-Za-z0-9_\-+/=]{12,}")
SAFE_ENV_KEYS = ("PATH", "LANG", "LC_ALL")


class PolicyError(Exception):
    """Raised when an action is refused. The refusal is also written to the audit log."""


def _redact(text: str) -> str:
    return SECRET_VALUE_RE.sub(lambda m: m.group(1) + "[REDACTED]", text)


class Sandbox:
    def __init__(self, workdir: str, audit_path: Optional[str] = None, approve: Optional[Callable[[str, str], bool]] = None,
                 timeout_s: float = 20.0, max_output: int = 20000, mem_mb: int = 512, cpu_s: int = 20):
        self.root = os.path.realpath(workdir)
        os.makedirs(self.root, exist_ok=True)
        self.state = os.path.join(self.root, ".zyntheor")
        os.makedirs(os.path.join(self.state, "snapshots"), exist_ok=True)
        self.audit_path = audit_path or os.path.join(self.state, "audit.jsonl")
        self.approve = approve
        self.timeout_s, self.max_output, self.mem_mb, self.cpu_s = timeout_s, max_output, mem_mb, cpu_s
        self.allow = {"python3": self._check_python, "node": self._check_node}

    # ---------------------------------------------------------------- audit (hash chain)
    def _last_hash(self) -> str:
        if not os.path.exists(self.audit_path):
            return "0" * 64
        last = "0" * 64
        with open(self.audit_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    last = json.loads(line)["hash"]
        return last

    def _log(self, action: str, outcome: str, detail: Dict) -> None:
        body = {"ts": round(time.time(), 3), "action": action, "outcome": outcome, "detail": detail, "prev": self._last_hash()}
        body["hash"] = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with open(self.audit_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(body, ensure_ascii=False) + "\n")

    def verify_audit(self) -> Dict:
        prev, n = "0" * 64, 0
        if not os.path.exists(self.audit_path):
            return {"ok": True, "entries": 0}
        with open(self.audit_path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if not line.strip():
                    continue
                e = json.loads(line)
                h = e.pop("hash")
                if e["prev"] != prev or hashlib.sha256(json.dumps(e, sort_keys=True, ensure_ascii=False).encode()).hexdigest() != h:
                    return {"ok": False, "broken_at_line": i}
                prev, n = h, n + 1
        return {"ok": True, "entries": n}

    def _refuse(self, action: str, reason: str, detail: Dict) -> None:
        self._log(action, "REFUSED", {**detail, "reason": reason})
        raise PolicyError(f"{action} refused: {reason}")

    # ---------------------------------------------------------------- paths
    def resolve(self, rel: str, action: str = "path") -> str:
        if not isinstance(rel, str) or not rel or "\x00" in rel:
            self._refuse(action, "invalid path", {"path": repr(rel)[:80]})
        if os.path.isabs(rel):
            self._refuse(action, "absolute paths are not permitted", {"path": rel[:80]})

        # Check every existing segment along the normalized candidate for symlinks
        # before realpath() collapses them, blocking both internal & escaping symlinks.
        joined = os.path.normpath(os.path.join(self.root, rel))
        if joined != self.root and not joined.startswith(self.root + os.sep):
            self._refuse(action, "path escapes workdir", {"path": rel})

        probe_rel = os.path.relpath(joined, self.root)
        if probe_rel != ".":
            cur = self.root
            for part in probe_rel.split(os.sep):
                cur = os.path.join(cur, part)
                if os.path.islink(cur):
                    self._refuse(action, "symlinks are not permitted inside sandbox", {"path": rel})

        full = os.path.realpath(joined)  # canonical path check
        if full != self.root and not full.startswith(self.root + os.sep):
            self._refuse(action, "path escapes workdir", {"path": rel})
        relp = os.path.relpath(full, self.root).replace(os.sep, "/")
        if relp.split("/")[0] == ".zyntheor":
            self._refuse(action, "internal state directory is not accessible", {"path": rel})
        if SECRET_NAME_RE.search(relp):
            self._refuse(action, "secret-like file name", {"path": rel})
        return full

    def _open_no_follow(self, full: str, flags: int, action: str, rel: str, mode: int = 0o644) -> int:
        nofollow = getattr(os, "O_NOFOLLOW", 0)
        try:
            fd = os.open(full, flags | nofollow, mode)
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.EISDIR, errno.EPERM):
                self._refuse(action, f"unsafe file open refused ({exc.strerror or exc.errno})", {"path": rel})
            raise
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                os.close(fd)
                self._refuse(action, "target is not a regular file", {"path": rel})
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            raise
        return fd

    # ---------------------------------------------------------------- files
    def read_file(self, rel: str, max_bytes: int = 1_000_000) -> str:
        p = self.resolve(rel, "read_file")
        fd = self._open_no_follow(p, os.O_RDONLY, "read_file", rel)
        with os.fdopen(fd, "r", encoding="utf-8", errors="replace") as f:
            data = f.read(max_bytes)
        self._log("read_file", "OK", {"path": rel, "bytes": len(data)})
        return data

    def write_file(self, rel: str, content: str) -> Optional[str]:
        p = self.resolve(rel, "write_file")
        snap = self._snapshot(p, rel) if os.path.lexists(p) else None
        parent = os.path.dirname(p)
        os.makedirs(parent, exist_ok=True)
        # Re-verify parent chain did not become a symlink before opening target
        self.resolve(rel, "write_file")
        fd = self._open_no_follow(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, "write_file", rel, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        self._log("write_file", "OK", {"path": rel, "bytes": len(content.encode()), "snapshot": snap,
                                       "sha256": hashlib.sha256(content.encode()).hexdigest()})
        return snap

    def _snapshot(self, full: str, rel: str) -> str:
        # Read target via O_NOFOLLOW before allocating a snapshot directory so a
        # swapped symlink can never pull external host data into snapshots.
        fd = self._open_no_follow(full, os.O_RDONLY, "snapshot", rel)
        with os.fdopen(fd, "rb") as src_f:
            raw_bytes = src_f.read()
        snapshots_dir = os.path.join(self.state, "snapshots")
        os.makedirs(snapshots_dir, exist_ok=True)
        for attempt in range(8):
            stamp = time.time_ns()
            suffix = hashlib.sha256(f"{rel}:{stamp}:{attempt}".encode()).hexdigest()[:8]
            sid = f"{stamp}-{suffix}"
            d = os.path.join(snapshots_dir, sid)
            try:
                os.makedirs(d, exist_ok=False)
                break
            except FileExistsError:
                continue
        else:
            raise OSError("Unable to allocate a unique recovery snapshot identifier")
        with open(os.path.join(d, "data"), "wb") as dst_f:
            dst_f.write(raw_bytes)
        with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
            json.dump({"path": rel}, f)
        return sid

    def rollback(self, snapshot_id: str) -> str:
        if not re.fullmatch(r"[0-9]+-[0-9a-f]{8}", snapshot_id or ""):
            self._refuse("rollback", "invalid snapshot id", {"snapshot": str(snapshot_id)[:40]})
        d = os.path.join(self.state, "snapshots", snapshot_id)
        if not os.path.isdir(d):
            self._refuse("rollback", "unknown snapshot", {"snapshot": snapshot_id})
        with open(os.path.join(d, "meta.json")) as f:
            rel = json.load(f)["path"]
        p = self.resolve(rel, "rollback")
        with open(os.path.join(d, "data"), "rb") as src_f:
            raw_bytes = src_f.read()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        fd = self._open_no_follow(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, "rollback", rel, 0o644)
        with os.fdopen(fd, "wb") as dst_f:
            dst_f.write(raw_bytes)
        self._log("rollback", "OK", {"path": rel, "snapshot": snapshot_id})
        return rel

    def delete_file(self, rel: str) -> None:
        p = self.resolve(rel, "delete_file")
        if not (self.approve and self.approve("delete_file", rel) is True):
            self._refuse("delete_file", "destructive action needs explicit user approval", {"path": rel})
        snap = self._snapshot(p, rel)
        if os.path.islink(p):
            self._refuse("delete_file", "symlinks are not permitted inside sandbox", {"path": rel})
        os.remove(p)
        self._log("delete_file", "OK", {"path": rel, "snapshot": snap})

    # ---------------------------------------------------------------- processes
    def _check_python(self, args: List[str]) -> None:
        if len(args) < 2 or args[0] != "-I":
            raise PolicyError("python3 must be run isolated: python3 -I <script|-m unittest> ...")
        if args[1] == "-m":
            if args[2:3] != ["unittest"]:
                raise PolicyError("only 'python3 -I -m unittest' is allowed")
            i = 3
            path_flags = {"-s", "--start-directory", "-t", "--top-level-directory"}
            value_flags = {"-p", "--pattern", "-k"}
            bare_flags = {"discover", "-v", "--verbose", "-b", "--buffer", "-f", "--failfast", "-c", "--catch", "-q", "--quiet"}
            while i < len(args):
                tok = args[i]
                if "\x00" in tok:
                    raise PolicyError("null byte in unittest argument")
                if tok in bare_flags:
                    i += 1
                    continue
                if tok in path_flags:
                    if i + 1 >= len(args):
                        raise PolicyError(f"unittest flag {tok} requires a path inside workdir")
                    self.resolve(args[i + 1], "run")
                    i += 2
                    continue
                if tok in value_flags:
                    if i + 1 >= len(args) or "\x00" in args[i + 1]:
                        raise PolicyError(f"unittest flag {tok} requires a valid filter pattern")
                    i += 2
                    continue
                if tok.startswith("-"):
                    raise PolicyError(f"disallowed unittest flag: {tok}")
                if "/" in tok or "\\" in tok or ".." in tok or tok.endswith(".py"):
                    self.resolve(tok, "run")
                elif not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", tok):
                    raise PolicyError(f"invalid unittest target: {tok}")
                i += 1
            return
        if args[1].startswith("-"):
            raise PolicyError("inline code and extra interpreter flags are not allowed")
        self.resolve(args[1], "run")  # script must live inside the workdir

    def _check_node(self, args: List[str]) -> None:
        if not args:
            raise PolicyError("node requires a script path inside the workdir")
        if args[0] == "--check":
            if len(args) != 2 or args[1].startswith("-"):
                raise PolicyError("node --check accepts a single relative script path")
            self.resolve(args[1], "run")
            return
        if len(args) != 1 or args[0].startswith("-"):
            raise PolicyError("inline code (-e/--eval) and arbitrary node flags are not allowed")
        self.resolve(args[0], "run")

    def run(self, argv: List[str]) -> Dict:
        if not isinstance(argv, list) or not argv or not all(isinstance(a, str) for a in argv):
            self._refuse("run", "argv must be a non-empty list of strings (no shell strings)", {})
        prog = argv[0]
        if prog not in self.allow:
            self._refuse("run", "program not in allowlist", {"argv": argv[:6]})
        try:
            self.allow[prog](argv[1:])
        except PolicyError as e:
            self._refuse("run", str(e), {"argv": argv[:6]})
        import resource

        def limits():
            resource.setrlimit(resource.RLIMIT_CPU, (self.cpu_s, self.cpu_s))
            if prog != "node":
                resource.setrlimit(resource.RLIMIT_AS, (self.mem_mb << 20, self.mem_mb << 20))
            resource.setrlimit(resource.RLIMIT_FSIZE, (10 << 20, 10 << 20))
            resource.setrlimit(resource.RLIMIT_NPROC, (64, 64)) if hasattr(resource, "RLIMIT_NPROC") else None
        # "-I" also drops the script directory from sys.path, which breaks multi-file generated projects
        # (found by the Gate 3 test). Run with -B -E -s instead: ignores PYTHON* env vars, user site, and stale .pyc caches.
        if prog == "python3" and argv[1:2] == ["-I"]:
            real_argv = [prog, "-B", "-E", "-s"] + argv[2:]
        elif prog == "node":
            real_argv = [prog, "--max-old-space-size=256"] + argv[1:]
        else:
            real_argv = argv
        env = {k: os.environ[k] for k in SAFE_ENV_KEYS if k in os.environ}  # no inherited secrets
        t0 = time.time()
        try:
            r = subprocess.run(real_argv, cwd=self.root, env=env, shell=False, capture_output=True, timeout=self.timeout_s,
                               preexec_fn=limits, stdin=subprocess.DEVNULL)
            out = _redact((r.stdout + r.stderr).decode("utf-8", "replace"))
            res = {"returncode": r.returncode, "timed_out": False, "output": out[:self.max_output],
                   "truncated": len(out) > self.max_output}
        except subprocess.TimeoutExpired as e:
            res = {"returncode": None, "timed_out": True, "output": _redact(((e.stdout or b"") + (e.stderr or b"")).decode("utf-8", "replace"))[:self.max_output],
                   "truncated": False}
        res["seconds"] = round(time.time() - t0, 3)
        self._log("run", "TIMEOUT" if res["timed_out"] else ("OK" if res["returncode"] == 0 else "NONZERO"),
                  {"argv": argv[:6], "returncode": res["returncode"], "seconds": res["seconds"]})
        return res
