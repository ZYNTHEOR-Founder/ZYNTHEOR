# -*- coding: utf-8 -*-
"""
ZYNTHEOR — HYBRID (ก) External Brain HTTP Connector & Real Scaffold Adapter

Bridges any external or local reasoning provider (OpenAI-compatible / Anthropic / Gemini / Ollama)
into the REAL deterministic ZYNTHEOR scaffold:
  - qplus_native.planner (interpret_goal, plan_project, package_deliverable)
  - qplus_native.orchestrator (validate_plan -> List[str], Orchestrator)
  - qplus_native.repair (SelfRepairEngine)
  - qplus_native.safe_exec (Sandbox, PolicyError)

Strict Zero-Simulation & Security Rules:
  - Fails closed with BrainError if no real provider/API key is configured or endpoint fails.
  - Rejects cloud metadata / SSRF targets (loopback allowed only for local model endpoints when explicitly opted in).
  - Never imports external Python packages (uses stdlib urllib/json only).
  - Runs all generated code & hidden verification tests strictly inside Sandbox (never host eval/exec).
"""

import ipaddress
import json
import os
import socket
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from qplus_native.hybrid_brain import BrainError, Complete
from qplus_native.orchestrator import Orchestrator, validate_plan
from qplus_native.planner import interpret_goal, normalize_priority, package_deliverable
from qplus_native.repair import SelfRepairEngine
from qplus_native.safe_exec import PolicyError, Sandbox

DEFAULT_ENDPOINTS = {
    "openai": "https://api.openai.com/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "anthropic": "https://api.anthropic.com/v1/messages",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    "ollama": "http://127.0.0.1:11434/v1/chat/completions",
}

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "openai_compatible": "gpt-4o-mini",
    "openrouter": "anthropic/claude-3.5-sonnet",
    "anthropic": "claude-3-5-sonnet-latest",
    "gemini": "gemini-2.5-flash",
    "ollama": "qwen2.5-coder:7b",
}


def validate_brain_endpoint_url(url: str, *, allow_loopback: bool = False) -> str:
    """Validates external reasoning endpoint URL and blocks SSRF targets."""
    if not isinstance(url, str) or not url.strip():
        raise BrainError("FAIL_CLOSED: Brain endpoint URL is empty.")
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in ("https", "http"):
        raise BrainError(f"SSRF_BLOCKED: Unsupported scheme '{parsed.scheme}'")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise BrainError("SSRF_BLOCKED: Endpoint host missing")
    if host in ("169.254.169.254", "metadata.google.internal", "metadata.internal"):
        raise BrainError(f"SSRF_BLOCKED: Cloud metadata host '{host}' rejected")
    if parsed.username or parsed.password:
        raise BrainError("SSRF_BLOCKED: Embedded credentials in URL rejected")

    is_loopback = host in ("localhost", "127.0.0.1", "::1")
    if is_loopback and not allow_loopback:
        raise BrainError(
            "SSRF_BLOCKED: Loopback brain endpoint requires explicit local opt-in (allow_loopback=True or ZYNTHEOR_ALLOW_LOOPBACK_BRAIN=1)."
        )
    if parsed.scheme == "http" and not is_loopback:
        raise BrainError("SSRF_BLOCKED: Plaintext HTTP disallowed for non-loopback brain endpoints; use HTTPS.")

    if not is_loopback:
        try:
            infos = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
            for info in infos:
                ip_str = info[4][0].split("%")[0]
                ip_obj = ipaddress.ip_address(ip_str)
                if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_reserved or ip_obj.is_multicast:
                    raise BrainError(f"SSRF_BLOCKED: Resolved address '{ip_str}' for '{host}' is non-public.")
        except BrainError:
            raise
        except Exception:
            # DNS might be unavailable offline; actual urllib call will fail closed if unreachable
            pass
    return parsed.geturl()


def get_external_brain_status() -> Dict[str, Any]:
    """Reports honest configuration status of the external brain slot without secrets."""
    provider = (os.environ.get("ZYNTHEOR_BRAIN_PROVIDER") or "").strip().lower()
    model = (os.environ.get("ZYNTHEOR_BRAIN_MODEL") or "").strip()
    base_url = (os.environ.get("ZYNTHEOR_BRAIN_BASE_URL") or "").strip()
    has_key = bool((os.environ.get("ZYNTHEOR_BRAIN_API_KEY") or "").strip())
    configured = bool(provider and (has_key or provider == "ollama"))
    return {
        "configured": configured,
        "provider": provider or None,
        "model": model or (DEFAULT_MODELS.get(provider) if provider else None),
        "hasBaseUrlOverride": bool(base_url),
        "hasApiKey": has_key,
        "policy": "FAIL_CLOSED_ONLINE_EXTERNAL_BRAIN",
    }


def make_http_complete(
    *,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    timeout_s: float = 45.0,
    allow_loopback: Optional[bool] = None,
) -> Complete:
    """
    Creates a strict Complete(system_prompt, user_prompt) -> str callable for an online external model.
    Never falls back to local templates or dummy text; raises BrainError on misconfiguration or failure.
    """
    prov = (provider or os.environ.get("ZYNTHEOR_BRAIN_PROVIDER") or "").strip().lower()
    if not prov:
        raise BrainError("FAIL_CLOSED: ZYNTHEOR_BRAIN_PROVIDER not configured.")

    key = (api_key if api_key is not None else os.environ.get("ZYNTHEOR_BRAIN_API_KEY", "")).strip()
    if prov != "ollama" and not key:
        raise BrainError(f"FAIL_CLOSED: ZYNTHEOR_BRAIN_API_KEY missing for provider '{prov}'.")

    mdl = (model or os.environ.get("ZYNTHEOR_BRAIN_MODEL") or DEFAULT_MODELS.get(prov) or "").strip()
    if not mdl:
        raise BrainError(f"FAIL_CLOSED: No model configured for provider '{prov}'.")

    raw_url = (base_url or os.environ.get("ZYNTHEOR_BRAIN_BASE_URL") or DEFAULT_ENDPOINTS.get(prov, "")).strip()
    if "{model}" in raw_url:
        raw_url = raw_url.format(model=urllib.parse.quote(mdl, safe=".-_:"))

    loopback_ok = (
        bool(allow_loopback)
        if allow_loopback is not None
        else (os.environ.get("ZYNTHEOR_ALLOW_LOOPBACK_BRAIN") == "1" or prov == "ollama")
    )
    endpoint = validate_brain_endpoint_url(raw_url, allow_loopback=loopback_ok)
    clamped_timeout = max(2.0, min(float(timeout_s), 120.0))

    def _complete(system_prompt: str, user_prompt: str) -> str:
        headers: Dict[str, str] = {"Content-Type": "application/json", "Accept": "application/json"}
        if prov == "anthropic":
            headers["x-api-key"] = key
            headers["anthropic-version"] = "2023-06-01"
            body_obj = {
                "model": mdl,
                "max_tokens": 4096,
                "temperature": 0.1,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            }
        elif prov == "gemini":
            headers["x-goog-api-key"] = key
            body_obj = {
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4096},
            }
        else:
            # openai / openai_compatible / openrouter / ollama
            if key:
                headers["Authorization"] = f"Bearer {key}"
            body_obj = {
                "model": mdl,
                "temperature": 0.1,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            }

        req = urllib.request.Request(
            endpoint,
            data=json.dumps(body_obj, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=clamped_timeout) as resp:
                raw_text = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as http_err:
            err_body = ""
            try:
                err_body = http_err.read().decode("utf-8", errors="replace")[:300]
            except Exception:
                pass
            raise BrainError(f"HTTP_{http_err.code} from brain provider '{prov}': {err_body}") from http_err
        except Exception as exc:
            raise BrainError(f"Network error calling brain provider '{prov}': {exc}") from exc

        try:
            data = json.loads(raw_text)
        except Exception as exc:
            raise BrainError(f"Invalid JSON envelope from brain provider '{prov}': {exc}") from exc

        if prov == "anthropic":
            parts = data.get("content") or []
            text = "\n".join(str(p.get("text", "")) for p in parts if isinstance(p, dict) and p.get("type") == "text")
        elif prov == "gemini":
            cands = data.get("candidates") or []
            parts = ((cands[0].get("content") or {}).get("parts") or []) if cands else []
            text = "\n".join(str(p.get("text", "")) for p in parts if isinstance(p, dict))
        else:
            choices = data.get("choices") or []
            msg = choices[0].get("message") if choices and isinstance(choices[0], dict) else {}
            text = str((msg or {}).get("content", ""))

        if not text.strip():
            raise BrainError(f"Empty completion text from brain provider '{prov}'")
        return text

    return _complete


def normalize_plan_for_orchestrator(
    goal: str,
    raw_plan: Dict[str, Any],
    files: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Converts either a brain-level plan `{steps: [{file, action}], files, tests}` or an explicit
    Orchestrator plan `{goal, steps: [{id, do, ...}], acceptance}` into a validated Orchestrator plan.
    """
    steps_raw = raw_plan.get("steps")
    if isinstance(steps_raw, list) and steps_raw and all(
        isinstance(s, dict) and "id" in s and s.get("do") in ("write_file", "read_file", "run")
        for s in steps_raw
    ) and isinstance(raw_plan.get("acceptance"), list) and raw_plan["acceptance"]:
        return {
            "goal": raw_plan.get("goal") or goal,
            "steps": steps_raw,
            "acceptance": raw_plan["acceptance"],
        }

    file_map = files or {}
    orc_steps: List[Dict[str, Any]] = []
    acceptance: List[Dict[str, Any]] = []
    idx = 1
    for rel_path, content in file_map.items():
        orc_steps.append({
            "id": f"w_{idx}",
            "do": "write_file",
            "path": rel_path,
            "content": content,
        })
        acceptance.append({"check": "file_exists", "path": rel_path})
        idx += 1

    has_py_tests = any(p.startswith("tests/") and p.endswith(".py") for p in file_map)
    has_js_tests = any(p.endswith(".test.js") or p == "tests/test_app.js" for p in file_map)
    if has_py_tests:
        orc_steps.append({
            "id": "run_unit_tests",
            "do": "run",
            "argv": ["python3", "-I", "-m", "unittest", "discover", "-s", "tests", "-v"],
        })
        acceptance.append({"check": "returncode_zero", "step": "run_unit_tests"})
    elif has_js_tests:
        test_path = next(p for p in file_map if p.endswith(".test.js") or p == "tests/test_app.js")
        orc_steps.append({
            "id": "run_unit_tests",
            "do": "run",
            "argv": ["node", test_path],
        })
        acceptance.append({"check": "returncode_zero", "step": "run_unit_tests"})
    elif any(p.endswith(".py") for p in file_map):
        py_entry = next(p for p in file_map if p.endswith(".py"))
        orc_steps.append({
            "id": "run_py_check",
            "do": "run",
            "argv": ["python3", "-I", py_entry],
        })
        acceptance.append({"check": "returncode_zero", "step": "run_py_check"})
    elif any(p.endswith((".js", ".mjs")) for p in file_map):
        js_entry = next(p for p in file_map if p.endswith((".js", ".mjs")))
        orc_steps.append({
            "id": "run_js_check",
            "do": "run",
            "argv": ["node", "--check", js_entry],
        })
        acceptance.append({"check": "returncode_zero", "step": "run_js_check"})

    return {"goal": goal, "steps": orc_steps, "acceptance": acceptance}


class RealScaffoldAdapter:
    """
    Production Dependency Injection bundle wrapping the REAL ZYNTHEOR deterministic scaffold:
      planner.py + orchestrator.py + repair.py + safe_exec.py
    Every code write, unit test, hidden evaluation, and ZIP package executes strictly inside Sandbox.
    """

    def __init__(self, workdir: Optional[str] = None, max_repairs: int = 3):
        self._owned_tmpdir: Optional[str] = None
        if workdir is None:
            self._owned_tmpdir = tempfile.mkdtemp(prefix="zyntheor_hybrid_")
            workdir = self._owned_tmpdir
        self.workdir = workdir
        self.sandbox = Sandbox(workdir)
        self.orchestrator = Orchestrator(self.sandbox)
        self.repair_engine = SelfRepairEngine(self.sandbox, max_repairs=max_repairs)

    def interpret_goal(self, goal: str, priority: Optional[str] = None) -> Dict[str, Any]:
        return interpret_goal(goal, priority=normalize_priority(priority))

    def validate_plan(self, plan: Dict[str, Any]) -> bool:
        if not isinstance(plan, dict):
            return False
        # Accept either full Orchestrator plan OR normalized hybrid plan {steps, files}
        if isinstance(plan.get("acceptance"), list) and isinstance(plan.get("steps"), list) and all(
            isinstance(s, dict) and s.get("do") in ("write_file", "read_file", "run") for s in plan["steps"]
        ):
            return len(validate_plan(plan)) == 0
        steps = plan.get("steps")
        files = plan.get("files")
        return isinstance(steps, list) and 0 < len(steps) <= 40 and isinstance(files, list) and len(files) > 0

    def run_tests(self, files: Dict[str, str], hidden_test_code: Optional[str] = None, goal: str = "task") -> Dict[str, Any]:
        """Writes proposed files into Sandbox, runs internal Orchestrator acceptance + hidden verification."""
        if not isinstance(files, dict) or not files:
            return {"passed": False, "error": "No files to test"}

        for rel, content in files.items():
            try:
                self.sandbox.write_file(rel, str(content))
            except PolicyError as exc:
                return {"passed": False, "blocked": True, "error": f"POLICY_BLOCKED: {exc}"}

        orc_plan = normalize_plan_for_orchestrator(goal, {}, files)
        self_exec = self.orchestrator.execute(orc_plan)
        if self_exec.get("status") != "SUCCEEDED":
            failing = self_exec.get("failing_process_output") or {}
            return {
                "passed": False,
                "stage": "sandbox_orchestrator",
                "status": self_exec.get("status"),
                "acceptance": self_exec.get("acceptance"),
                "error": json.dumps(failing, ensure_ascii=False)[:1500] or str(self_exec.get("blocked_reason") or "Acceptance checks failed"),
            }

        hidden_passed = True
        hidden_output = ""
        if hidden_test_code is not None:
            hidden_rel = "_zyntheor_hidden_eval.py"
            try:
                self.sandbox.write_file(hidden_rel, hidden_test_code)
                h_res = self.sandbox.run(["python3", "-I", hidden_rel])
                hidden_output = h_res.get("output", "")
                hidden_passed = (
                    not h_res.get("timed_out")
                    and h_res.get("returncode") == 0
                    and ("HIDDEN_OK" in hidden_output or "HIDDEN_OK" not in hidden_test_code)
                )
            except PolicyError as exc:
                return {"passed": False, "blocked": True, "error": str(exc)}
            finally:
                try:
                    full_hidden = self.sandbox.resolve(hidden_rel, "cleanup")
                    if os.path.exists(full_hidden):
                        os.remove(full_hidden)
                except Exception:
                    pass

        return {
            "passed": bool(hidden_passed),
            "orchestrator_status": self_exec.get("status"),
            "hidden_passed": hidden_passed,
            "output": hidden_output[:1000],
            "audit": self_exec.get("audit"),
            "error": "" if hidden_passed else f"HIDDEN_TEST_FAILED: {hidden_output[:800]}",
        }

    def repair_deterministic(self, plan: Dict[str, Any], files: Dict[str, str], goal: str = "task") -> Dict[str, Any]:
        """Runs deterministic AST/syntax SelfRepairEngine over failing workspace files."""
        orc_plan = normalize_plan_for_orchestrator(goal, plan, files)
        res = self.repair_engine.execute_with_repair(orc_plan)
        updated_files = dict(files)
        for rel in list(updated_files.keys()):
            try:
                updated_files[rel] = self.sandbox.read_file(rel)
            except Exception:
                pass
        return {"files": updated_files, "repair_result": res}

    def package_deliverable(self, plan: Dict[str, Any], files: Dict[str, str]) -> Dict[str, Any]:
        """Creates integrity-verified .zip deliverable using real qplus_native.planner.package_deliverable."""
        for rel, content in files.items():
            self.sandbox.write_file(rel, str(content))
        return package_deliverable(self.sandbox, zip_rel_path="deliverable.zip")

    def cleanup(self) -> None:
        if self._owned_tmpdir and os.path.isdir(self._owned_tmpdir):
            import shutil
            shutil.rmtree(self._owned_tmpdir, ignore_errors=True)
            self._owned_tmpdir = None
