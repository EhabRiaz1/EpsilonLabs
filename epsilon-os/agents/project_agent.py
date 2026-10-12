"""Project agent (docs/designs/client-platform.md Phase 5; F10, EN2, EN3, OV2; migration 015). Runs every minute from launchd
(`python -m agents.run project_agent`), separate from the 1-minute worker so a 30-minute agent run never blocks it.

Per run: remove worktrees of merged / discarded runs, scan manual-mode commits every 10 minutes, then claim and run at
most ONE job, in this order: push_preview / scan_commits, ticket_brief, ticket_plan, ticket_execute.

    ticket_brief    TOOL-LESS `claude -p` (core.llm.ask: no tools, neutral cwd, JSON schema). The raw ticket text reaches only
                    this call, inside <untrusted>. The brief is then screened in code: any line that asks to read paths
                    outside the project, secrets, run network tools, push or deploy is removed and listed for the founder.
    ticket_plan     READ-ONLY Claude Code in the project's real folder: Read, Grep, Glob only; Edit, Write, Bash, WebFetch and
                    WebSearch denied; secrets denied. Input: the founder-APPROVED brief, never the raw ticket.
    ticket_execute  Claude Code with Read, Grep, Glob, Edit, Write and Bash(<the project's test command>) only, cwd = a git
                    worktree ~/EpsilonWork/worktrees/<project-slug>/EL-<n> on branch ticket/EL-<n> (created from the project's
                    repo_path; the founder's working copy is never touched). Bash is pinned to that one command by the
                    allow rule AND a PreToolUse hook (agents/bash_gate.py): Claude Code otherwise auto-approves read-only
                    commands such as `ls`. node_modules is symlinked from the real folder,
                    the test env file is copied only when the founder configured one. The worker (plain code) then runs the
                    test command, commits on the branch, and records `git diff --stat` + the full diff (capped at 200 KB).
    push_preview    plain code, only on the founder's click: `git push origin ticket/EL-<n>`. The ONLY git push anywhere.
    scan_commits    `git log --all` in repo_path for EL-<n> on manual-mode tickets -> internal ticket_events (kind commit).

Hard safety checks (in code, whatever the database says): repo_path must be an existing directory under the user's home and
must not be the epsilon-labs repo (or contain it, or be the worktree root); Agent mode needs `<repo_path>/.git`; the test
command comes only from the project row (set by staff) and must be a plain command (no shell operators, never run through a
shell); timeouts: plan 10 min, execute 30 min (tests 10 min); nothing merges or touches the default branch.

Usage guard: every Claude call's `usage` (from --output-format json) is written to ticket_runs.tokens / usage, the job's
result and the `actions` ledger (agent_usage). When today's tokens (PKT day) reach settings agent.daily_token_budget, or
agent.enabled is false, brief / plan / execute jobs wait (paused) until the next day.
"""
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import jsonschema

from agents import platform_jobs
from core import ledger, llm
from prompts import loader, schemas

AGENT = "project_agent"
PKT = ZoneInfo("Asia/Karachi")
EOS = Path(__file__).resolve().parents[1]          # epsilon-os
EPSILON_REPO = EOS.parent                          # the epsilon-labs repo: never an agent target
SKILLS = EOS / "skills"
BASH_GATE = Path(__file__).resolve().parent / "bash_gate.py"
HOME = Path.home()
WORK_ROOT = HOME / "EpsilonWork" / "worktrees"

PLAN_TIMEOUT = 10 * 60
EXECUTE_TIMEOUT = 30 * 60
TEST_TIMEOUT = 10 * 60
GIT_TIMEOUT = 120
PUSH_TIMEOUT = 180
DIFF_CAP = 200 * 1024
LOG_CAP = 20_000
DEFAULT_TOKEN_BUDGET = 2_000_000
MODEL = "sonnet"
SCAN_EVERY_MINUTES = 10

AGENT_TYPES = ("ticket_brief", "ticket_plan", "ticket_execute")
# (types, lease seconds): claimed in this order, one job per run
CLAIM_ORDER = ((("push_preview", "scan_commits"), 300), (("ticket_brief",), 300), (("ticket_plan",), 900),
               (("ticket_execute",), 3000))
OPEN_STATUSES = ("new", "triaged", "briefed", "planned", "approved", "in_progress", "review")
TEST_COMMAND_RE = re.compile(r"^[A-Za-z0-9 ._:/=@+-]{1,200}$")
ENV_FILE_RE = re.compile(r"^[A-Za-z0-9._-][A-Za-z0-9._/-]{0,199}$")
BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,100}$")
UUID = r"^[0-9a-f-]{36}$"

PARAMS = {
    "ticket_brief": {"type": "object", "additionalProperties": False, "required": ["ticket_id", "run_id"],
                     "properties": {"ticket_id": {"type": "string", "pattern": UUID}, "run_id": {"type": "string", "pattern": UUID}}},
    "push_preview": {"type": "object", "additionalProperties": False, "required": ["run_id"],
                     "properties": {"run_id": {"type": "string", "pattern": UUID}}},
    "scan_commits": {"type": "object", "additionalProperties": False,
                     "properties": {"project_id": {"type": "string", "pattern": UUID}}},
}
PARAMS["ticket_plan"] = PARAMS["ticket_execute"] = PARAMS["ticket_brief"]


def _skill(name: str) -> tuple[str, dict]:
    text = (SKILLS / name / "SKILL.md").read_text()
    body = text.split("---", 2)[2].strip() if text.startswith("---") else text
    schema = json.loads((SKILLS / name / "schema.json").read_text())
    schema.pop("$comment", None)
    return body, schema


PLANNER_SKILL, PLAN_SCHEMA = _skill("ticket-planner")
EXECUTOR_SKILL, EXEC_SCHEMA = _skill("ticket-executor")


class JobError(RuntimeError):
    """A job that cannot run. Fails the job (and its run) with this message."""


class SafetyError(JobError):
    """A hard safety check refused the job."""


# ===================================================================================================== paths and names

def validate_repo_path(raw, home: Path | None = None, forbidden: tuple[Path, ...] | None = None) -> Path:
    """The project's folder, resolved. Raises SafetyError unless it is an existing directory under the user's home that is
    not the home itself, not hidden at the top level, not the epsilon-labs repo (or a folder containing it) and not the
    worktree root."""
    home = (home or HOME).resolve()
    forbidden = forbidden if forbidden is not None else (EPSILON_REPO, WORK_ROOT.parent)
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw:
        raise SafetyError("the project has no folder set")
    p = Path(raw.strip()).expanduser()
    if not p.is_absolute():
        raise SafetyError("the project folder must be an absolute path")
    try:
        rp = p.resolve(strict=True)
    except (OSError, RuntimeError):
        raise SafetyError("the project folder does not exist on this Mac") from None
    if not rp.is_dir():
        raise SafetyError("the project folder is not a directory")
    if rp == home or home not in rp.parents:
        raise SafetyError("the project folder must be inside your home folder")
    if rp.relative_to(home).parts[0].startswith("."):
        raise SafetyError("hidden folders in your home folder are never project folders")
    for f in forbidden:
        fr = Path(f).expanduser().resolve()
        if rp == fr or fr in rp.parents or rp in fr.parents:
            raise SafetyError("that folder is (or contains) Epsilon's own repo or the agent's worktrees; refused")
    return rp


def is_git_folder(path: Path) -> bool:
    return (path / ".git").exists()


def slugify(name: str, fallback: str = "project") -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")[:40].strip("-")
    return s or fallback


def branch_name(number) -> str:
    n = int(number)
    if n <= 0:
        raise SafetyError("bad ticket number")
    return f"ticket/EL-{n}"


def worktree_path(project_name: str, number, root: Path | None = None) -> Path:
    n = int(number)
    if n <= 0:
        raise SafetyError("bad ticket number")
    return (root or WORK_ROOT) / slugify(project_name) / f"EL-{n}"


def _under(path: Path, root: Path) -> bool:
    try:
        return root.resolve() in path.resolve().parents
    except OSError:
        return False


def test_argv(command) -> list[str]:
    """The project's configured test command as argv (never run through a shell)."""
    if not isinstance(command, str) or not TEST_COMMAND_RE.match(command.strip()):
        raise SafetyError("the test command must be a plain command (letters, digits, spaces and . _ : / = @ + - only)")
    argv = shlex.split(command.strip())
    if not argv:
        raise SafetyError("empty test command")
    return argv


# ===================================================================================================== Claude Code settings

SECRET_READ_DENY = ["Read(**/.env*)", "Read(**/*secret*)", "Read(**/*cred*)", "Read(**/*.pem)", "Read(**/*.key)",
                    "Read(**/*.rtf)"]
SECRET_EDIT_DENY = ["Edit(**/.env*)", "Edit(**/*secret*)", "Edit(**/*cred*)", "Edit(**/*.pem)", "Edit(**/*.key)"]
HOME_READ_DENY = ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.gnupg/**)", "Read(~/.config/**)", "Read(~/.netrc)",
                  "Read(~/.docker/**)", "Read(~/.kube/**)", "Read(~/.claude/**)", "Read(~/Library/**)"]


def _abs(path: Path) -> str:
    """Claude Code permission syntax for an absolute path: //Users/x/... (a single / is relative to the settings file)."""
    return "/" + str(path)


def plan_settings(repo: Path, epsilon: Path = EPSILON_REPO) -> dict:
    """--settings for the read-only plan agent (cwd = repo)."""
    return {
        "permissions": {
            "defaultMode": "dontAsk",
            "allow": ["Read", "Grep", "Glob"],
            "deny": ["Edit", "Write", "NotebookEdit", "Bash", "WebFetch", "WebSearch"] + SECRET_READ_DENY + HOME_READ_DENY
                    + [f"Read({_abs(epsilon)}/**)"],
            "additionalDirectories": [],
        },
        "disableAllHooks": True,
        "enableAllProjectMcpServers": False,
    }


def bash_gate_command(test_command: str, python: str | None = None, gate: Path | None = None) -> str:
    """The PreToolUse hook command that pins Bash to exactly the test command (agents/bash_gate.py)."""
    return " ".join(shlex.quote(x) for x in (python or sys.executable, "-I", str(gate or BASH_GATE), test_command))


def execute_settings(worktree: Path, repo: Path, test_command: str | None, epsilon: Path = EPSILON_REPO,
                     gate: str | None = None) -> dict:
    """--settings for the execute agent (cwd = worktree). Edits only inside the worktree; Bash only the test command, enforced
    by the allow rule AND a PreToolUse hook (Claude Code auto-approves read-only commands such as `ls` otherwise)."""
    allow = ["Read", "Grep", "Glob", f"Edit({_abs(worktree)}/**)"] + ([f"Bash({test_command})"] if test_command else [])
    deny = ["NotebookEdit", "WebFetch", "WebSearch"] + ([] if test_command else ["Bash"]) + SECRET_READ_DENY + SECRET_EDIT_DENY \
        + HOME_READ_DENY + [f"Read({_abs(repo)}/**)", f"Edit({_abs(repo)}/**)", f"Read({_abs(epsilon)}/**)",
                            f"Edit({_abs(epsilon)}/**)", f"Edit({_abs(worktree)}/.git)", f"Edit({_abs(worktree)}/node_modules/**)"]
    s: dict = {
        "permissions": {"defaultMode": "dontAsk", "allow": allow, "deny": deny, "additionalDirectories": []},
        "disableAllHooks": not test_command,
        "enableAllProjectMcpServers": False,
    }
    if test_command:
        s["hooks"] = {"PreToolUse": [{"matcher": "Bash", "hooks": [
            {"type": "command", "command": gate or bash_gate_command(test_command), "timeout": 10}]}]}
    return s


def claude_args(kind: str, settings: dict, schema: dict, skill: str, test_command: str | None = None,
                model: str = MODEL, binary: str | None = None) -> list[str]:
    """The exact `claude` command line for the plan ("plan") or execute ("execute") agent."""
    if kind == "plan":
        tools = allowed = "Read,Grep,Glob"
        disallowed = "Edit,Write,NotebookEdit,Bash,WebFetch,WebSearch"
    elif kind == "execute":
        tools = "Read,Grep,Glob,Edit,Write" + (",Bash" if test_command else "")
        allowed = "Read,Grep,Glob,Edit,Write" + (f",Bash({test_command})" if test_command else "")
        disallowed = "NotebookEdit,WebFetch,WebSearch" + ("" if test_command else ",Bash")
    else:
        raise ValueError(kind)
    return [binary or llm._claude_bin(), "-p", "--model", model, "--restricted",
            "--tools", tools, "--allowedTools", allowed, "--disallowedTools", disallowed,
            "--permission-mode", "dontAsk", "--permission-prompts", "none",
            "--settings", json.dumps(settings, separators=(",", ":")), "--setting-sources", "",
            "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
            "--output-format", "json", "--json-schema", json.dumps(schema, separators=(",", ":")),
            "--append-system-prompt", skill]


def agent_env(base: dict | None = None) -> dict:
    """A minimal environment for Claude Code and the test command: no tokens, no SSH agent, no worker secrets."""
    src = base if base is not None else os.environ
    keep = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "SHELL", "TERM")
    env = {k: src[k] for k in keep if src.get(k)}
    env.update({"NO_COLOR": "1", "CI": "1", "GIT_TERMINAL_PROMPT": "0"})
    return env


def _spawn(args: list[str], cwd: Path, stdin: str | None, timeout: int, env: dict) -> tuple[int | None, str, str, bool]:
    """Run in its own process group; on timeout the whole group (including test runners it started) is killed."""
    p = subprocess.Popen(args, cwd=str(cwd), env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, start_new_session=True)
    try:
        out, err = p.communicate(stdin, timeout=timeout)
        return p.returncode, out, err, False
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        out, err = p.communicate()
        return None, out or "", err or "", True


def run_claude(args: list[str], cwd: Path, stdin: str, timeout: int) -> dict:
    """One Claude Code call. Returns its --output-format json object. Raises JobError (never the raw output)."""
    rc, out, _err, timed_out = _spawn(args, cwd, stdin, timeout, agent_env())
    if timed_out:
        raise JobError(f"Claude Code timed out after {timeout // 60} min")
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        raise JobError(f"Claude Code returned no JSON (exit {rc})") from None
    if not isinstance(data, dict):
        raise JobError("Claude Code returned an unexpected result")
    return data


def run_tests(argv: list[str], cwd: Path, timeout: int) -> dict:
    t0 = time.monotonic()
    try:
        rc, out, err, timed_out = _spawn(argv, cwd, None, timeout, agent_env())
    except OSError as e:
        return {"ok": False, "exit_code": None, "timed_out": False, "duration_ms": 0, "log_tail": f"could not start: {type(e).__name__}"}
    log = (out or "") + (("\n" + err) if err else "")
    return {"ok": (rc == 0 and not timed_out), "exit_code": rc, "timed_out": timed_out,
            "duration_ms": int((time.monotonic() - t0) * 1000), "log_tail": log[-LOG_CAP:]}


def structured(out: dict, schema: dict) -> dict:
    if out.get("is_error") or out.get("subtype") not in (None, "success"):
        raise JobError(f"Claude Code stopped: {str(out.get('subtype') or 'error')[:80]}")
    data = out.get("structured_output")
    if not isinstance(data, dict):
        raise JobError("Claude Code returned no structured output")
    try:
        jsonschema.validate(data, schema)
    except jsonschema.ValidationError as e:
        raise JobError(f"output failed validation: {e.message[:160]}") from None
    return data


def usage_of(out: dict | None, model: str | None = MODEL) -> tuple[dict, int]:
    """(usage record, tokens counted against the budget). Tokens = input + output + cache creation (cache reads are cheap
    re-reads of the same context and are recorded but not counted)."""
    u = (out or {}).get("usage") if isinstance((out or {}).get("usage"), dict) else {}
    keys = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    rec = {k: int(u.get(k) or 0) for k in keys}
    tokens = rec["input_tokens"] + rec["output_tokens"] + rec["cache_creation_input_tokens"]
    rec.update({"cost_usd": (out or {}).get("total_cost_usd") if out else None, "duration_ms": (out or {}).get("duration_ms"),
                "num_turns": (out or {}).get("num_turns"), "model": model, "tokens": tokens})
    return rec, tokens


# ===================================================================================================== git (plain code)

GIT_BASE = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false"]
AGENT_IDENT = ["-c", "user.name=Epsilon project agent", "-c", "user.email=agent@epsilon-labs.co"]


def _git_env() -> dict:
    return {**agent_env(), "GIT_OPTIONAL_LOCKS": "0", "GIT_PAGER": "cat", "PAGER": "cat"}


def git(cwd: Path, *args: str, check: bool = True, timeout: int = GIT_TIMEOUT) -> subprocess.CompletedProcess:
    """Every git command of this module except the preview push. `git push` is refused here."""
    if args and args[0] == "push":
        raise SafetyError("git push is only allowed in the push_preview job")
    p = subprocess.run([*GIT_BASE, "-C", str(cwd), *args], capture_output=True, text=True, timeout=timeout, env=_git_env())
    if check and p.returncode != 0:
        raise JobError(f"git {args[0] if args else ''} failed: {p.stderr.strip()[:200]}")
    return p


def git_push(repo: Path, branch: str) -> subprocess.CompletedProcess:
    """The ONLY push: `git push origin ticket/EL-<n>`, from the push_preview handler, on the founder's click."""
    if not re.fullmatch(r"ticket/EL-[0-9]{1,12}", branch):
        raise SafetyError("only a ticket/EL-<n> branch can be pushed")
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}   # plain code: the founder's own SSH agent / credential helper
    return subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-C", str(repo), "push", "origin", branch],
                          capture_output=True, text=True, timeout=PUSH_TIMEOUT, env=env)


def detect_default_branch(repo: Path) -> str:
    for cand in ("main", "master"):
        if git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{cand}", check=False).returncode == 0:
            return cand
    head = git(repo, "symbolic-ref", "--short", "HEAD", check=False).stdout.strip()
    if head and BRANCH_RE.match(head):
        return head
    raise JobError("could not find the default branch; set it in the project settings")


def _branch_exists(repo: Path, branch: str) -> bool:
    return git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False).returncode == 0


def ensure_worktree(repo: Path, wt: Path, branch: str, base_branch: str, fresh: bool = False, root: Path | None = None) -> str:
    """Create (or reuse) the ticket's worktree on its branch. Returns the base commit (merge-base with base_branch)."""
    root = root or WORK_ROOT
    if not _under(wt, root):
        raise SafetyError("the worktree must live under ~/EpsilonWork/worktrees")
    if not BRANCH_RE.match(base_branch) or base_branch.startswith("-"):
        raise SafetyError("invalid default branch")
    if fresh:
        if wt.exists():
            git(repo, "worktree", "remove", "--force", str(wt))
        git(repo, "worktree", "prune", check=False)
        if _branch_exists(repo, branch):
            git(repo, "branch", "-D", branch)
    if wt.exists():
        head = git(wt, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        common = Path(git(wt, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip()).resolve()
        if head != branch or common != (repo / ".git").resolve():
            raise SafetyError("the worktree folder exists but is not this ticket's worktree; left alone")
    else:
        wt.parent.mkdir(parents=True, exist_ok=True)
        if _branch_exists(repo, branch):
            git(repo, "worktree", "add", str(wt), branch)
        else:
            if git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{base_branch}", check=False).returncode != 0:
                raise JobError(f"the default branch {base_branch!r} does not exist in the project folder")
            git(repo, "worktree", "add", "-b", branch, str(wt), base_branch)
    return git(wt, "merge-base", base_branch, "HEAD").stdout.strip()


def link_node_modules(repo: Path, wt: Path) -> Path | None:
    src, dst = repo / "node_modules", wt / "node_modules"
    if src.is_dir() and not dst.exists() and not dst.is_symlink():
        os.symlink(src, dst, target_is_directory=True)
        return dst
    return None


def copy_test_env(repo: Path, wt: Path, rel: str | None) -> Path | None:
    """Copy the founder-configured test env file (a path inside the project folder) into the worktree. Never .env by default."""
    if not rel:
        return None
    if not ENV_FILE_RE.match(rel) or ".." in Path(rel).parts:
        raise SafetyError("the test env file must be a path inside the project folder")
    src = (repo / rel).resolve()
    if repo not in src.parents or not src.is_file():
        raise JobError("the configured test env file was not found in the project folder")
    dst = wt / rel
    if _tracked(wt, rel):
        return None                      # committed in the repo: already there, never removed
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)            # (over a leftover copy from a crashed run, too)
    return dst


def _tracked(wt: Path, rel: str) -> bool:
    return git(wt, "ls-files", "--error-unmatch", "--", rel, check=False).returncode == 0


def scrub_worktree(repo: Path, wt: Path, env_rel: str | None) -> None:
    """Before the worker commits: never the node_modules link or an untracked copy of the test env file (also leftovers)."""
    nm = wt / "node_modules"
    if nm.is_symlink():
        nm.unlink()
    if env_rel and ENV_FILE_RE.match(env_rel) and ".." not in Path(env_rel).parts and not _tracked(wt, env_rel):
        f = wt / env_rel
        if f.is_file() or f.is_symlink():
            f.unlink()


def commit_all(wt: Path, message: str) -> bool:
    git(wt, "add", "-A")
    if git(wt, "diff", "--cached", "--quiet", check=False).returncode == 0:
        return False
    git(wt, *AGENT_IDENT, "commit", "--no-verify", "-q", "-m", message)
    return True


def parse_numstat(text: str) -> dict:
    files, added, removed = [], 0, 0
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        a, r, path = parts[0], parts[1], "\t".join(parts[2:])
        binary = a == "-" or r == "-"
        ai, ri = (0, 0) if binary else (int(a), int(r))
        files.append({"path": path, "added": ai, "removed": ri, "binary": binary})
        added += ai
        removed += ri
    return {"files": files, "files_changed": len(files), "added": added, "removed": removed}


def cap_diff(text: str, cap: int = DIFF_CAP) -> tuple[str, bool]:
    raw = text.encode("utf-8")
    if len(raw) <= cap:
        return text, False
    return raw[:cap].decode("utf-8", errors="ignore") + "\n… diff truncated at 200 KB\n", True


def capture_diff(wt: Path, base: str) -> tuple[dict, str]:
    stat = parse_numstat(git(wt, "diff", "--no-color", "--no-ext-diff", "--numstat", base, "HEAD").stdout)
    stat["text"] = git(wt, "diff", "--no-color", "--no-ext-diff", "--stat", base, "HEAD").stdout[-4000:]
    full, truncated = cap_diff(git(wt, "diff", "--no-color", "--no-ext-diff", base, "HEAD").stdout)
    stat["truncated"] = truncated
    return stat, full


# ===================================================================================================== brief screening

SUSPICIOUS = re.compile(
    r"(~/|\$HOME\b|/etc/|/Users/|\.ssh\b|\bid_(rsa|ed25519|ecdsa|dsa)\b|(^|[\s/'\"`])\.env\b|\.pem\b|\bkeychain|\bcredentials?\b"
    r"|\bsecrets?\b|api[ _-]?keys?\b|private key|\bcurl\b|\bwget\b|\bscp\b|\bnetcat\b|\bexfiltrat|\bgit push\b|\brm -rf\b"
    r"|ignore (all |any |your |previous |prior |the |these )*(instructions|rules)|system prompt)", re.I)
BRIEF_LISTS = ("change", "not_in_scope", "acceptance", "questions_for_client")


def _screen_text(s: str) -> tuple[str, list[str]]:
    keep, cut = [], []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", s or ""):
        (cut if SUSPICIOUS.search(sentence) else keep).append(sentence)
    return " ".join(x for x in keep if x.strip()).strip(), [x for x in cut if x.strip()]


def screen_brief(brief: dict) -> tuple[dict, list[str]]:
    """Remove every line or sentence of the brief (except the founder-only notes) that asks for something outside the
    project: secrets, home paths, network tools, pushes, or text aimed at an assistant. Returns (clean brief, removed)."""
    out, removed = dict(brief), []
    for k in BRIEF_LISTS:
        items = [str(x) for x in brief.get(k) or []]
        out[k] = [x for x in items if not SUSPICIOUS.search(x)]
        removed += [x for x in items if SUSPICIOUS.search(x)]
    for k in ("title", "problem"):
        text, cut = _screen_text(str(brief.get(k) or ""))
        out[k] = text or ("Ticket" if k == "title" else "(removed: the description only contained requests outside the project)")
        removed += cut
    if not out.get("change"):
        out["change"] = ["(nothing left after screening: write the change yourself)"]
    return out, [r[:300] for r in removed]


# ===================================================================================================== data

def _one(db, table: str, **f) -> dict | None:
    rows = db.select(table, limit=1, **f)
    return rows[0] if rows else None


def _ticket(db, ticket_id: str) -> dict:
    t = _one(db, "tickets", id=ticket_id, select="id,org_id,project_id,number,ref,title,body,type,priority,status,mode")
    if not t:
        raise JobError("ticket not found")
    return t


def _project(db, project_id: str) -> dict:
    p = _one(db, "projects", id=project_id,
             select="id,org_id,name,repo_path,test_command,test_env_file,default_branch,is_git,agent_enabled")
    if not p:
        raise JobError("project not found")
    return p


def _run(db, run_id: str, ticket_id: str | None = None, stage: str | None = None) -> dict:
    r = _one(db, "ticket_runs", id=run_id)
    if not r or (ticket_id and r["ticket_id"] != ticket_id) or (stage and r["stage"] != stage):
        raise JobError("run not found")
    return r


def _approved(db, ticket_id: str, stage: str) -> dict:
    r = db.select("ticket_runs", ticket_id=ticket_id, stage=stage, status="approved", order="approved_at.desc", limit=1)
    if not r:
        raise JobError(f"no approved {stage} for this ticket")
    return r[0]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def finish_run(db, run_id: str, values: dict) -> bool:
    """Write a run's result if it is still open (queued). False when the founder discarded or superseded it meanwhile."""
    rows = db.update("ticket_runs", {**values, "finished_at": _now_iso()}, id=run_id, status="eq.queued")
    return bool(rows)


def event(db, t: dict, kind: str, body: str, data: dict) -> None:
    db.insert("ticket_events", {"org_id": t["org_id"], "ticket_id": t["id"], "kind": kind, "body": body[:2000], "data": data,
                                "client_visible": False}, returning=False)


def record_usage(db, run_id: str, run_row: str, stage: str, usage: dict, tokens: int) -> None:
    ledger.action(db, AGENT, run_id, "agent_usage", "ticket_runs", run_row, {"stage": stage, "tokens": tokens, **usage},
                  model=usage.get("model"), cost_usd=usage.get("cost_usd"))


def budget_state(db, now: datetime) -> dict:
    vals = {r["key"]: r.get("value") for r in db.select("settings", key='in.("agent.daily_token_budget","agent.enabled")',
                                                        select="key,value")}
    b = vals.get("agent.daily_token_budget")
    budget = int(b) if isinstance(b, (int, float)) and not isinstance(b, bool) and b > 0 else DEFAULT_TOKEN_BUDGET
    enabled = vals.get("agent.enabled") is not False
    start = now.astimezone(PKT).replace(hour=0, minute=0, second=0, microsecond=0)
    used = sum(int(r.get("tokens") or 0) for r in db.select("ticket_runs", finished_at=f"gte.{start.isoformat()}",
                                                            select="tokens", limit=10000))
    return {"budget": budget, "used_today": used, "enabled": enabled, "paused": (not enabled) or used >= budget}


# ===================================================================================================== handlers

def handle_brief(db, job: dict, ask=llm.ask, run_id: str = "") -> dict:
    p = job["params"]
    t = _ticket(db, p["ticket_id"])
    run = _run(db, p["run_id"], t["id"], "brief")
    project = _project(db, t["project_id"])
    ctx = (f'ticket {t["ref"]} for project "{platform_jobs._clip(project["name"], 120)}"; type {t["type"]}; '
           f'priority {t["priority"]}')
    system = loader.compose("ticket_brief", {"context": ctx}, preamble="preamble_platform")
    untrusted = f"TITLE: {t['title']}\n\nDESCRIPTION:\n{t.get('body') or '(none)'}"
    d, meta = ask(db, AGENT, run_id, system, untrusted, schemas.TICKET_BRIEF, model="sonnet", timeout=120)
    brief, removed = screen_brief(d)
    usage, tokens = usage_of({"usage": (meta or {}).get("usage"), "total_cost_usd": (meta or {}).get("cost_usd"),
                              "duration_ms": (meta or {}).get("duration")}, "sonnet")
    if not finish_run(db, run["id"], {"status": "ready", "output": {**brief, "screened": removed}, "usage": usage,
                                      "tokens": tokens, "error": None}):
        return {"run_id": run["id"], "dropped": "run is no longer open", "tokens": tokens}
    record_usage(db, run_id, run["id"], "brief", usage, tokens)
    event(db, t, "brief", "Brief drafted (tool-less)" + (f" · {len(removed)} line(s) removed by the screen" if removed else ""),
          {"run_id": run["id"], "screened": len(removed)})
    return {"run_id": run["id"], "screened": len(removed), "tokens": tokens, "usage": usage}


def brief_text(brief: dict) -> str:
    def lst(title, items):
        items = [str(x) for x in items or []]
        return f"{title}:\n" + ("\n".join(f"- {x}" for x in items) if items else "- (none)")
    return "\n".join([f"Title: {brief.get('title', '')}", f"Problem: {brief.get('problem', '')}",
                      lst("Change", brief.get("change")), lst("Not in scope", brief.get("not_in_scope")),
                      lst("Acceptance", brief.get("acceptance"))])


def plan_task(t: dict, project: dict, brief: dict) -> str:
    return (f"Ticket {t['ref']} for the project \"{project['name']}\". You are in the project's folder.\n\n"
            f"APPROVED BRIEF (Ehab approved this; it is your whole task):\n{brief_text(brief)}\n\n"
            "Plan the change as the ticket-planner instructions say and return the JSON plan.")


def handle_plan(db, job: dict, claude=run_claude, run_id: str = "") -> dict:
    p = job["params"]
    t = _ticket(db, p["ticket_id"])
    run = _run(db, p["run_id"], t["id"], "plan")
    project = _project(db, t["project_id"])
    if not project.get("agent_enabled"):
        raise JobError("the agent is off for this project")
    repo = validate_repo_path(project.get("repo_path"))
    brief = _approved(db, t["id"], "brief")["output"] or {}
    args = claude_args("plan", plan_settings(repo), PLAN_SCHEMA, PLANNER_SKILL)
    out = claude(args, repo, plan_task(t, project, brief), PLAN_TIMEOUT)
    usage, tokens = usage_of(out)
    record_usage(db, run_id, run["id"], "plan", usage, tokens)
    try:
        plan = structured(out, PLAN_SCHEMA)
    except JobError as e:
        finish_run(db, run["id"], {"status": "failed", "error": str(e)[:1000], "usage": usage, "tokens": tokens})
        raise
    if not finish_run(db, run["id"], {"status": "ready", "output": plan, "usage": usage, "tokens": tokens, "error": None}):
        return {"run_id": run["id"], "dropped": "run is no longer open", "tokens": tokens}
    event(db, t, "plan", f"Plan drafted (read-only) · {len(plan['files'])} file(s)", {"run_id": run["id"]})
    return {"run_id": run["id"], "files": len(plan["files"]), "tokens": tokens, "usage": usage}


def execute_task(t: dict, project: dict, brief: dict, plan: dict, notes: str | None, test_command: str | None) -> str:
    files = "\n".join(f"- {f.get('path')}: {f.get('change')}" for f in plan.get("files") or []) or "- (none named)"
    steps = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(plan.get("steps") or []))
    tests = "\n".join(f"- {s}" for s in plan.get("tests_to_add") or []) or "- (none named)"
    parts = [f"Ticket {t['ref']} for the project \"{project['name']}\". You are in this ticket's git worktree.",
             f"APPROVED BRIEF:\n{brief_text(brief)}",
             f"APPROVED PLAN:\nSummary: {plan.get('summary', '')}\nFiles:\n{files}\nSteps:\n{steps}\nTests to add:\n{tests}"]
    if notes:
        parts.append(f"EHAB'S NOTES FOR THIS RUN (the earlier attempt is already committed on this branch):\n{notes}")
    parts.append(f"The ONLY command you may run is: {test_command}" if test_command
                 else "No test command is configured: you cannot run any command. Write the tests anyway.")
    return "\n\n".join(parts)


def handle_execute(db, job: dict, claude=run_claude, tester=run_tests, run_id: str = "", root: Path | None = None) -> dict:
    p = job["params"]
    t = _ticket(db, p["ticket_id"])
    run = _run(db, p["run_id"], t["id"], "execute")
    if t.get("mode") != "agent":
        raise JobError("the ticket is not in agent mode")
    project = _project(db, t["project_id"])
    if not project.get("agent_enabled"):
        raise JobError("the agent is off for this project")
    repo = validate_repo_path(project.get("repo_path"))
    if not is_git_folder(repo):
        raise SafetyError("the project folder is not a git repo: Agent mode is refused (use Manual)")
    brief = _approved(db, t["id"], "brief")["output"] or {}
    plan = _approved(db, t["id"], "plan")["output"] or {}
    cmd = project.get("test_command") or None            # only ever from the project row, set by staff
    argv = test_argv(cmd) if cmd else None
    env_rel = project.get("test_env_file") or None
    base_branch = project.get("default_branch") or detect_default_branch(repo)
    if not BRANCH_RE.match(base_branch):
        raise SafetyError("invalid default branch")
    wt, branch = worktree_path(project["name"], t["number"], root), branch_name(t["number"])
    prior = [r for r in db.select("ticket_runs", ticket_id=t["id"], stage="execute", order="created_at.desc", limit=20)
             if r["id"] != run["id"]]
    fresh = bool(prior) and prior[0]["status"] == "discarded"
    base = ensure_worktree(repo, wt, branch, base_branch, fresh=fresh, root=root)
    event(db, t, "diff", f"Worktree ready · {branch}", {"run_id": run["id"], "branch": branch})
    linked = copied = None
    report, out, error = None, None, None
    try:
        linked = link_node_modules(repo, wt)
        copied = copy_test_env(repo, wt, env_rel)
        args = claude_args("execute", execute_settings(wt, repo, cmd), EXEC_SCHEMA, EXECUTOR_SKILL, test_command=cmd)
        try:
            out = claude(args, wt, execute_task(t, project, brief, plan, run.get("notes"), cmd), EXECUTE_TIMEOUT)
            report = structured(out, EXEC_SCHEMA)
        except JobError as e:                      # agent stopped early: still record the diff and the tests (failure modes)
            error = str(e)[:300]
        tests = tester(argv, wt, TEST_TIMEOUT) if argv else {"ok": None, "skipped": "no test command configured"}
        tests["command"] = cmd
    finally:
        for f in (linked, copied):
            if f is not None and (f.is_symlink() or f.exists()):
                f.unlink()
        scrub_worktree(repo, wt, env_rel)
    committed = commit_all(wt, f"{t['ref']}: {platform_jobs._clip(t['title'], 60)} (agent run, for review)")
    head = git(wt, "rev-parse", "HEAD").stdout.strip()
    stat, diff = capture_diff(wt, base)
    usage, tokens = usage_of(out)
    if out is not None:
        record_usage(db, run_id, run["id"], "execute", usage, tokens)
    report = report or {"summary": "The agent did not finish its report.", "files_changed": [], "tests_added": [],
                        "tests_run": False, "stopped_early": True, "stop_reason": error or "unknown",
                        "questions_for_client": [], "notes": ""}
    values = {"status": "ready", "output": {**report, "committed": committed, "agent_error": error}, "diff_stat": stat,
              "diff": diff, "test_result": tests, "usage": usage, "tokens": tokens, "worktree": str(wt), "branch": branch,
              "base_sha": base, "head_sha": head, "error": error}
    if not finish_run(db, run["id"], values):
        return {"run_id": run["id"], "dropped": "run is no longer open", "tokens": tokens}
    state = "no tests" if tests.get("ok") is None else ("tests passing" if tests["ok"] else "tests failing")
    event(db, t, "diff", f"Diff ready · {stat['files_changed']} file(s) +{stat['added']} −{stat['removed']} · {state}",
          {"run_id": run["id"], "head": head})
    return {"run_id": run["id"], "files": stat["files_changed"], "tests_ok": tests.get("ok"), "tokens": tokens, "usage": usage,
            "agent_error": error}


def handle_push_preview(db, job: dict, push=git_push) -> dict:
    run = _run(db, job["params"]["run_id"], stage="execute")
    if run["status"] != "ready":
        raise JobError("only a run in review can be pushed")
    t = _ticket(db, run["ticket_id"])
    branch = branch_name(t["number"])                     # derived, never taken from the row
    if run.get("branch") != branch:
        raise SafetyError("branch mismatch; nothing pushed")
    repo = validate_repo_path(_project(db, t["project_id"]).get("repo_path"))
    if not is_git_folder(repo) or not _branch_exists(repo, branch):
        raise JobError(f"{branch} does not exist in the project folder")
    p = push(repo, branch)
    if p.returncode != 0:
        msg = (p.stderr or "").strip().splitlines()[-1:] or ["push failed"]
        db.update("ticket_runs", {"push_error": msg[0][:300]}, id=run["id"])
        raise JobError(f"git push failed: {msg[0][:200]}")
    db.update("ticket_runs", {"pushed_at": _now_iso(), "push_error": None}, id=run["id"])
    event(db, t, "preview", f"Branch pushed for preview: {branch}", {"run_id": run["id"], "branch": branch})
    return {"run_id": run["id"], "branch": branch, "pushed": True}


def detect_projects(db, now: datetime) -> dict:
    """is_git (and the default branch when unset) for every project with a folder. Never raises."""
    c = {"checked": 0, "invalid": 0}
    projects = [x for x in db.select("projects", select="id,repo_path,is_git,default_branch", limit=500) if x.get("repo_path")]
    for pr in projects:
        try:
            repo = validate_repo_path(pr["repo_path"])
        except SafetyError:
            c["invalid"] += 1
            continue
        vals = {"is_git": is_git_folder(repo), "git_checked_at": now.isoformat()}
        if vals["is_git"] and not pr.get("default_branch"):
            try:
                vals["default_branch"] = detect_default_branch(repo)
            except (JobError, subprocess.TimeoutExpired, OSError):
                pass
        try:
            db.update("projects", vals, id=pr["id"])
            c["checked"] += 1
        except Exception:
            c["invalid"] += 1
    return c


def scan_commits(db, now: datetime, project_id: str | None = None, git_log=platform_jobs.git_log) -> dict:
    """Manual-mode tickets: commits mentioning EL-<n> become internal ticket_events (kind commit), once per sha."""
    c = {"projects": 0, "commits": 0, "skipped": 0}
    tickets = db.select("tickets", mode="manual", status=f"in.({','.join(OPEN_STATUSES)})",
                        select="id,org_id,project_id,ref,created_at", limit=1000)
    by_project: dict[str, list[dict]] = {}
    for t in tickets:
        if project_id and t["project_id"] != project_id:
            continue
        by_project.setdefault(t["project_id"], []).append(t)
    for pid, ts in by_project.items():
        try:
            repo = validate_repo_path(_project(db, pid).get("repo_path"))
        except JobError:
            c["skipped"] += 1
            continue
        c["projects"] += 1
        by_ref = {t["ref"].upper(): t for t in ts}
        since = min(datetime.fromisoformat(str(t["created_at"]).replace("Z", "+00:00")) for t in ts) - timedelta(days=1)
        commits = git_log(str(repo), since, now + timedelta(minutes=1), set(by_ref))
        ids = ",".join(t["id"] for t in ts)
        seen = {(e["ticket_id"], (e.get("data") or {}).get("sha")) for e in
                db.select("ticket_events", ticket_id=f"in.({ids})", kind="commit", select="ticket_id,data", limit=5000)}
        for cm in commits:
            for ref in cm["refs"]:
                t = by_ref.get(ref.upper())
                if not t or (t["id"], cm["sha"]) in seen:
                    continue
                try:
                    event(db, t, "commit", cm["subject"], {"sha": cm["sha"], "date": cm["date"], "subject": cm["subject"]})
                except Exception:                 # the unique index already has it
                    continue
                seen.add((t["id"], cm["sha"]))
                c["commits"] += 1
    return c


def cleanup(db, root: Path | None = None) -> dict:
    """Remove the worktree of merged and discarded runs (and the branch of discarded ones). Never raises."""
    root = root or WORK_ROOT
    c = {"cleaned": 0, "errors": 0}
    for r in db.select("ticket_runs", stage="execute", status="in.(merged,discarded)", cleaned_at="is.null", limit=20):
        detail: dict = {}
        try:
            live = [x for x in db.select("ticket_runs", ticket_id=r["ticket_id"], stage="execute", limit=50)
                    if x["id"] != r["id"] and x["status"] in ("queued", "ready")]
            t = _ticket(db, r["ticket_id"])
            project = _project(db, t["project_id"])
            wt = worktree_path(project["name"], t["number"], root)
            if live:
                detail = {"kept": "a newer run uses the worktree"}
            elif r.get("worktree") and Path(r["worktree"]) != wt:
                detail = {"kept": "worktree path mismatch; left alone"}
            else:
                repo = validate_repo_path(project.get("repo_path"))
                branch = branch_name(t["number"])
                if wt.exists():
                    if not _under(wt, root):
                        raise SafetyError("worktree outside the root")
                    git(repo, "worktree", "remove", "--force", str(wt))
                git(repo, "worktree", "prune", check=False)
                if r["status"] == "discarded" and _branch_exists(repo, branch):
                    git(repo, "branch", "-D", branch)
                    detail["branch_deleted"] = True
                if r["status"] == "merged":
                    base = project.get("default_branch") or detect_default_branch(repo)
                    merged = git(repo, "branch", "--merged", base, "--list", branch, check=False).stdout.strip()
                    detail["merge_verified"] = bool(merged)
                detail["removed"] = str(wt)
            db.update("ticket_runs", {"cleaned_at": _now_iso(), "output": {**(r.get("output") or {}), "cleanup": detail}},
                      id=r["id"])
            c["cleaned"] += 1
        except Exception as e:
            c["errors"] += 1
            c["error"] = type(e).__name__
    return c


# ===================================================================================================== dispatch

def fail_run(db, job: dict, error: str) -> None:
    rid = (job.get("params") or {}).get("run_id") if isinstance(job.get("params"), dict) else None
    if job.get("type") in AGENT_TYPES and isinstance(rid, str) and re.match(UUID, rid):
        try:
            db.update("ticket_runs", {"status": "failed", "error": error[:1000], "finished_at": _now_iso()}, id=rid,
                      status="eq.queued")
        except Exception:
            pass


def handle(db, job: dict, now: datetime, ask=llm.ask, claude=run_claude, tester=run_tests, push=git_push,
           git_log=platform_jobs.git_log, run_id: str = "", root: Path | None = None) -> tuple[bool, dict | None, str | None]:
    """(ok, result, error) for one claimed job. Never raises."""
    t = job.get("type")
    if t not in PARAMS:
        return False, None, "job type not handled"
    try:
        jsonschema.validate(job.get("params"), PARAMS[t])
    except jsonschema.ValidationError:
        return False, None, "invalid params"
    try:
        if t == "ticket_brief":
            res = handle_brief(db, job, ask, run_id)
        elif t == "ticket_plan":
            res = handle_plan(db, job, claude, run_id)
        elif t == "ticket_execute":
            res = handle_execute(db, job, claude, tester, run_id, root)
        elif t == "push_preview":
            res = handle_push_preview(db, job, push)
        else:
            res = scan_commits(db, now, job["params"].get("project_id"), git_log)
        return True, res, None
    except SafetyError as e:
        err = f"refused: {str(e)[:250]}"
    except JobError as e:
        err = str(e)[:300]
    except llm.BudgetExceeded:
        err = "daily AI call budget reached; it runs again tomorrow"
    except llm.LLMError as e:
        err = f"AI couldn't draft it ({str(e)[:160]}); write it yourself or retry"
    except subprocess.TimeoutExpired:
        err = "a git command timed out"
    except Exception as e:  # a DB or OS fault: the type only (no data in the error)
        err = type(e).__name__
    fail_run(db, job, err)
    return False, None, err


def run(db=None, now: datetime | None = None, ask=llm.ask, claude=run_claude, tester=run_tests, push=git_push,
        git_log=platform_jobs.git_log, root: Path | None = None) -> dict:
    if db is None:
        from core.db import DB
        db = DB()
    now = now or datetime.now(timezone.utc)
    c: dict = {"claimed": 0, "done": 0, "failed": 0}
    c["cleanup"] = cleanup(db, root)
    try:
        state = budget_state(db, now)
    except Exception as e:
        state = {"paused": True, "error": type(e).__name__}
    c["budget"] = state
    if now.minute % SCAN_EVERY_MINUTES == 0:
        c["detect"] = detect_projects(db, now)
        try:
            c["scan"] = scan_commits(db, now, git_log=git_log)
        except Exception as e:
            c["scan"] = {"error": type(e).__name__}
    for types, lease in CLAIM_ORDER:
        if state.get("paused") and set(types) <= set(AGENT_TYPES):
            c["paused"] = "daily token budget reached" if state.get("enabled", True) else "agent.enabled is off"
            continue
        try:
            jobs = db.rpc("claim_jobs", {"p_types": list(types), "p_lease_seconds": lease, "p_limit": 1}) or []
        except Exception as e:
            c["error"] = f"claim: {type(e).__name__}"
            break
        if not jobs:
            continue
        job = jobs[0]
        c["claimed"] += 1
        c["type"] = job.get("type")
        ledger.heartbeat(db, AGENT, "ok", {**c, "running": job.get("type")})
        rid = ledger.new_run_id()
        ok, result, error = handle(db, job, now, ask, claude, tester, push, git_log, rid, root)
        try:
            db.rpc("finish_job", {"p_id": job["id"], "p_ok": ok, "p_result": result, "p_error": error})
        except Exception as e:
            c["error"] = f"finish: {type(e).__name__}"
        c["done" if ok else "failed"] += 1
        if error:
            c["job_error"] = error
        try:
            ledger.action(db, AGENT, rid, f"{job.get('type')}_{'done' if ok else 'failed'}", "jobs", job["id"],
                          {"error": error, "tokens": (result or {}).get("tokens")})
        except Exception:
            pass
        break
    status = "error" if c.get("error") else ("warn" if c["failed"] or c["cleanup"].get("errors") or c.get("paused") else "ok")
    ledger.heartbeat(db, AGENT, status, c)
    return c


def main() -> int:
    print(run())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
