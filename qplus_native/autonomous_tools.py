# -*- coding: utf-8 -*-
"""
Phase 6 Autonomous Execution Toolbelt & JSON Schema Dispatcher for ZYNTHEOR.

Wraps Gate 2 (Sandbox / Path Jail), Gate 3 (Orchestrator), and Gate 4 (SelfRepairEngine)
into structured JSON-schema-validated tools callable by the Brain / Planner / Agent:
  - write_workspace_file : Path-jailed write with automatic recovery snapshot & audit log
  - read_workspace_file  : Path-jailed read inside workdir
  - run_terminal_command : Zero-shell allowlisted execution via Sandbox.run()
  - run_test             : Isolated Python unittest or Node test runner via Sandbox.run()
  - search_internet      : Live DuckDuckGo HTML search (no fabricated results)
  - execute_plan_with_repair : Autonomous plan execution + SelfRepairEngine loop
"""
from __future__ import annotations

import html
import json
import re
import shlex
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from qplus_native.safe_exec import PolicyError, Sandbox

AUTONOMOUS_TOOL_SCHEMAS: List[Dict[str, Any]] = [
    {
        "tool": "write_workspace_file",
        "description": "Write or update a file strictly inside the jailed workspace directory (snapshots existing files and records hash-chained audit logs).",
        "parameters": {
            "type": "object",
            "required": ["filepath", "content"],
            "additionalProperties": False,
            "properties": {
                "filepath": {"type": "string", "minLength": 1, "maxLength": 256},
                "content": {"type": "string", "minLength": 0, "maxLength": 131072},
            },
        },
    },
    {
        "tool": "read_workspace_file",
        "description": "Read a UTF-8 file strictly inside the jailed workspace directory.",
        "parameters": {
            "type": "object",
            "required": ["filepath"],
            "additionalProperties": False,
            "properties": {
                "filepath": {"type": "string", "minLength": 1, "maxLength": 256},
            },
        },
    },
    {
        "tool": "run_terminal_command",
        "description": "Execute an allowlisted command (python3 -I ... or node ...) inside the safe_exec Sandbox (shell=False, resource-limited).",
        "parameters": {
            "type": "object",
            "required": ["command"],
            "additionalProperties": False,
            "properties": {
                "command": {"type": "string", "minLength": 1, "maxLength": 512},
            },
        },
    },
    {
        "tool": "run_test",
        "description": "Run unit tests inside the Sandbox using python3 -I -m unittest or node.",
        "parameters": {
            "type": "object",
            "required": [],
            "additionalProperties": False,
            "properties": {
                "target": {"type": "string", "minLength": 0, "maxLength": 256},
                "runner": {"type": "string", "enum": ["unittest", "node"]},
            },
        },
    },
    {
        "tool": "search_internet",
        "description": "Search the public internet via DuckDuckGo HTML endpoint and return titles, URLs, and snippets.",
        "parameters": {
            "type": "object",
            "required": ["query"],
            "additionalProperties": False,
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 500},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 10},
            },
        },
    },
    {
        "tool": "execute_plan_with_repair",
        "description": "Execute a Gate 3 plan through Gate 4 SelfRepairEngine (write -> run -> diagnose -> patch -> re-verify).",
        "parameters": {
            "type": "object",
            "required": ["plan"],
            "additionalProperties": False,
            "properties": {
                "plan": {"type": "object"},
                "max_repairs": {"type": "integer", "minimum": 1, "maximum": 5},
            },
        },
    },
]


def write_workspace_file(sandbox: Sandbox, filepath: str, content: str) -> Dict[str, Any]:
    if not isinstance(filepath, str) or not filepath.strip():
        return {"ok": False, "error": "filepath must be a non-empty relative path"}
    if not isinstance(content, str):
        return {"ok": False, "error": "content must be a string"}
    try:
        snapshot_id = sandbox.write_file(filepath.strip(), content)
        return {
            "ok": True,
            "filepath": filepath.strip(),
            "bytes": len(content.encode("utf-8")),
            "snapshot_id": snapshot_id,
        }
    except (PolicyError, OSError) as exc:
        return {"ok": False, "filepath": filepath, "error": str(exc)}


def read_workspace_file(sandbox: Sandbox, filepath: str) -> Dict[str, Any]:
    if not isinstance(filepath, str) or not filepath.strip():
        return {"ok": False, "error": "filepath must be a non-empty relative path"}
    try:
        content = sandbox.read_file(filepath.strip())
        return {
            "ok": True,
            "filepath": filepath.strip(),
            "bytes": len(content.encode("utf-8")),
            "content": content,
        }
    except (PolicyError, OSError) as exc:
        return {"ok": False, "filepath": filepath, "error": str(exc)}


def run_terminal_command(sandbox: Sandbox, command: str | List[str]) -> Dict[str, Any]:
    try:
        if isinstance(command, str):
            argv = shlex.split(command)
        elif isinstance(command, list) and all(isinstance(x, str) for x in command):
            argv = list(command)
        else:
            return {"ok": False, "error": "command must be a non-empty string or list of strings"}
        if not argv:
            return {"ok": False, "error": "command is empty"}
        res = sandbox.run(argv)
        return {
            "ok": res.get("returncode") == 0 and not res.get("timed_out"),
            "argv": argv,
            **res,
        }
    except (PolicyError, ValueError, OSError) as exc:
        return {"ok": False, "error": str(exc)}


def run_test(sandbox: Sandbox, target: str = "", runner: str = "unittest") -> Dict[str, Any]:
    clean_target = (target or "").strip()
    if runner == "node":
        if not clean_target:
            return {"ok": False, "error": "target script path is required for node runner"}
        argv = ["node", clean_target]
    elif runner == "unittest":
        argv = ["python3", "-I", "-m", "unittest"]
        if clean_target:
            argv.extend([clean_target, "-v"])
        else:
            argv.extend(["discover", "-v"])
    else:
        return {"ok": False, "error": f"Unsupported test runner '{runner}' (allowed: unittest, node)"}

    try:
        res = sandbox.run(argv)
        passed = res.get("returncode") == 0 and not res.get("timed_out")
        return {
            "ok": passed,
            "passed": passed,
            "runner": runner,
            "target": clean_target or "discover",
            **res,
        }
    except (PolicyError, OSError) as exc:
        return {"ok": False, "passed": False, "runner": runner, "error": str(exc)}


def _strip_tags(raw: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw))).strip()


def _unwrap_ddg_url(raw_href: str) -> str:
    try:
        normalized = f"https:{raw_href}" if raw_href.startswith("//") else raw_href
        parsed = urllib.parse.urlparse(urllib.parse.urljoin("https://html.duckduckgo.com", normalized))
        qs = urllib.parse.parse_qs(parsed.query)
        uddg = qs.get("uddg", [None])[0]
        if uddg and uddg.startswith(("http://", "https://")):
            return uddg
        if parsed.scheme in ("http", "https"):
            return parsed.geturl()
    except Exception:
        pass
    return raw_href


def search_internet(query: str, max_results: int = 5, timeout_s: float = 8.0) -> Dict[str, Any]:
    clean_query = (query or "").strip()
    if not clean_query:
        return {"ok": False, "error": "query must be a non-empty string", "results": []}
    limit = max(1, min(10, int(max_results)))
    url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote_plus(clean_query)}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ZYNTHEOR-AutonomousAgent/1.0",
            "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"ok": False, "query": clean_query, "error": f"Network search failed: {exc}", "results": []}

    links = re.findall(r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', body, re.I)
    snippets = re.findall(r'<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)</(?:a|div)>', body, re.I)
    results: List[Dict[str, str]] = []
    for idx, (href, raw_title) in enumerate(links[:limit]):
        title = _strip_tags(raw_title)
        resolved = _unwrap_ddg_url(href)
        snippet = _strip_tags(snippets[idx]) if idx < len(snippets) else ""
        if title and resolved.startswith(("http://", "https://")):
            results.append({"title": title, "url": resolved, "snippet": snippet})

    return {
        "ok": True,
        "query": clean_query,
        "count": len(results),
        "results": results,
    }


class AutonomousToolDispatcher:
    """Validates and executes Phase 6 JSON tool calls against Sandbox + SelfRepairEngine."""

    def __init__(self, sandbox: Sandbox, max_repairs: int = 3) -> None:
        self.sb = sandbox
        self.max_repairs = max_repairs
        self._schemas = {item["tool"]: item for item in AUTONOMOUS_TOOL_SCHEMAS}

    def get_prompt_schema_instructions(self) -> str:
        return "\n".join([
            "[ZYNTHEOR_PHASE6_AUTONOMOUS_TOOLS_JSON_SCHEMA]:",
            "Emit a JSON object with keys {\"tool\": <name>, \"arguments\": {...}}:",
            json.dumps(AUTONOMOUS_TOOL_SCHEMAS, indent=2),
        ])

    def dispatch(self, call: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(call, dict):
            return {"ok": False, "error": "Tool call must be a JSON object"}
        tool_name = call.get("tool") or call.get("action")
        args = call.get("arguments")
        if args is None and isinstance(call.get("action"), str):
            args = {k: v for k, v in call.items() if k != "action"}
        if not isinstance(tool_name, str) or tool_name not in self._schemas:
            return {
                "ok": False,
                "error": f"Unknown tool {tool_name!r}. Allowed: {sorted(self._schemas)}",
            }
        if not isinstance(args, dict):
            return {"ok": False, "error": f"Tool '{tool_name}' requires an 'arguments' object"}

        schema = self._schemas[tool_name]["parameters"]
        allowed_props = set(schema["properties"].keys())
        unknown_keys = set(args.keys()) - allowed_props
        if unknown_keys:
            return {"ok": False, "error": f"Unexpected arguments for '{tool_name}': {sorted(unknown_keys)}"}
        for req_key in schema.get("required", []):
            if req_key not in args or args[req_key] is None:
                return {"ok": False, "error": f"Missing required argument '{req_key}' for '{tool_name}'"}

        if tool_name == "write_workspace_file":
            return write_workspace_file(self.sb, args["filepath"], args["content"])
        if tool_name == "read_workspace_file":
            return read_workspace_file(self.sb, args["filepath"])
        if tool_name == "run_terminal_command":
            return run_terminal_command(self.sb, args["command"])
        if tool_name == "run_test":
            return run_test(self.sb, str(args.get("target", "")), str(args.get("runner", "unittest")))
        if tool_name == "search_internet":
            return search_internet(args["query"], int(args.get("max_results", 5)))
        if tool_name == "execute_plan_with_repair":
            from qplus_native.repair import SelfRepairEngine

            repairs = int(args.get("max_repairs", self.max_repairs))
            engine = SelfRepairEngine(self.sb, max_repairs=repairs)
            res = engine.execute_with_repair(args["plan"])
            return {"ok": res.get("status") == "SUCCEEDED", **res}
        return {"ok": False, "error": f"Unhandled tool '{tool_name}'"}
