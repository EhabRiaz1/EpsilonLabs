"""PreToolUse hook for the execute agent (agents/project_agent.py): Bash may run EXACTLY the project's test command.

Why a hook: Claude Code auto-approves commands it considers read-only (ls, cat, ...) even under --permission-mode dontAsk
with a single Bash(<cmd>) allow rule (seen in the 2026-10-13 smoke run), so the allow list alone does not pin Bash to one
command. This hook does: it reads the tool call as JSON on stdin and exits 2 (block; stderr goes back to the model) unless
the command, whitespace-normalised, equals the allowed command passed as argv[1].

Run as `<venv python> -I bash_gate.py '<test command>'` (-I: no cwd, PYTHONPATH or user site on sys.path, so files planted
in the worktree cannot be imported). Standard library only.
"""
import json
import sys


def decide(payload: dict, allowed: str) -> tuple[bool, str]:
    if payload.get("tool_name") != "Bash":
        return True, ""
    cmd = (payload.get("tool_input") or {}).get("command")
    if not isinstance(cmd, str):
        return False, "Blocked: no command."
    if " ".join(cmd.split()) == " ".join(allowed.split()) and allowed.strip():
        return True, ""
    return False, f"Blocked: the only command you may run is `{allowed}` (exactly, nothing chained). Stop and report if you need more."


def main(argv: list[str] | None = None, stdin=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("Blocked: bash gate misconfigured.", file=sys.stderr)
        return 2
    try:
        payload = json.load(stdin or sys.stdin)
    except (ValueError, OSError):
        print("Blocked: unreadable tool call.", file=sys.stderr)
        return 2
    ok, why = decide(payload if isinstance(payload, dict) else {}, argv[0])
    if ok:
        return 0
    print(why, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
