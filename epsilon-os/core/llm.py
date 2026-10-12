import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

import jsonschema

from . import config, ledger, settings
from .db import DB

FALLBACK_CLAUDE = "/Users/ehabriaz/.local/bin/claude"


class BudgetExceeded(RuntimeError):
    pass


class LLMError(RuntimeError):
    pass


def neutralise(text: str) -> str:
    out = text
    while "</untrusted" in out.lower():
        i = out.lower().index("</untrusted")
        out = out[:i] + "<\\/untrusted" + out[i + len("</untrusted"):]
    return out


def wrap(text: str) -> str:
    return f"<untrusted>\n{neutralise(text)}\n</untrusted>"


def _claude_bin() -> str:
    return shutil.which("claude") or FALLBACK_CLAUDE


def calls_today(db: DB) -> int:
    start = datetime.now(ZoneInfo(config.TZ)).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = db.select("actions", action="llm_call", at=f"gte.{start.isoformat()}", select="id")
    return len(rows)


def _run(args: list[str], stdin: str, timeout: int) -> dict:
    with tempfile.TemporaryDirectory() as cwd:
        p = subprocess.run(args, input=stdin, capture_output=True, text=True, timeout=timeout, cwd=cwd,
                           env={**os.environ, "NO_COLOR": "1"})
    if p.returncode != 0:
        raise LLMError(f"claude exited {p.returncode}")
    return json.loads(p.stdout)


def budget(db: DB) -> int:
    """Daily call budget: settings llm.daily_budget, falling back to the config constant."""
    try:
        return int(settings.daily_budget(db))
    except Exception:
        return config.DAILY_LLM_CALL_BUDGET


def _call(db: DB, agent: str, run_id: str, args: list[str], stdin: str, schema: dict, model: str,
          timeout: int) -> tuple[dict, dict]:
    limit = budget(db)
    if calls_today(db) >= limit:
        raise BudgetExceeded(f"daily LLM call budget {limit} reached")
    last: Exception | None = None
    out: dict | None = None
    for _ in range(2):
        try:
            out = _run(args, stdin, timeout)
            break
        except (LLMError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            last = e
    if out is None:
        raise LLMError(f"claude failed after retry: {type(last).__name__}")
    data = out.get("structured_output")
    if not isinstance(data, dict):
        raise LLMError("no structured_output in claude response")
    try:
        jsonschema.validate(data, schema)
    except jsonschema.ValidationError as e:
        raise LLMError(f"schema mismatch: {e.message[:200]}") from None
    meta = {"cost_usd": out.get("total_cost_usd"), "model": model, "duration": out.get("duration_ms"),
            "usage": out.get("usage") if isinstance(out.get("usage"), dict) else None}
    ledger.action(db, agent, run_id, "llm_call", model=model, cost_usd=meta["cost_usd"],
                  detail={"duration_ms": meta["duration"]})
    return data, meta


def ask(db: DB, agent: str, run_id: str, prompt_system: str, untrusted_text: str, schema: dict,
        model: str = "haiku", timeout: int = 120) -> tuple[dict, dict]:
    if model not in ("haiku", "sonnet"):
        raise ValueError("model must be haiku or sonnet")
    args = [_claude_bin(), "-p", "--model", model, "--tools", "", "--strict-mcp-config",
            "--setting-sources", "", "--no-session-persistence", "--output-format", "json",
            "--json-schema", json.dumps(schema), "--system-prompt", prompt_system]
    return _call(db, agent, run_id, args, wrap(untrusted_text), schema, model, timeout)


RESEARCH_TOOLS = "WebSearch,WebFetch"


def research(db: DB, agent: str, run_id: str, prompt_system: str, task_text: str, schema: dict,
             model: str = "sonnet", timeout: int = 300) -> tuple[dict, dict]:
    """Web research (P4): the only call that has tools, and only WebSearch + WebFetch.

    Same hardening as `ask` (neutral temp cwd, no MCP, no settings, schema re-validated, budget-counted).
    `task_text` is written by our code (a segment brief plus already-known domains) and carries no
    secrets or CRM data; the pages the model reads are untrusted, which the research prompt says.
    """
    if model not in ("haiku", "sonnet"):
        raise ValueError("model must be haiku or sonnet")
    args = [_claude_bin(), "-p", "--model", model, "--tools", RESEARCH_TOOLS, "--allowedTools", RESEARCH_TOOLS,
            "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--output-format", "json",
            "--json-schema", json.dumps(schema), "--system-prompt", prompt_system]
    return _call(db, agent, run_id, args, task_text, schema, model, timeout)
