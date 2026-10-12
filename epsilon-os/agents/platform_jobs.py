"""Client-platform drafting jobs for the Mac worker (migration 012; client-platform.md E2, Phase 4, E4).

Each handler gathers project data with the worker's service role, makes ONE tool-less `claude -p` call (core.llm.ask:
no tools, neutral cwd, JSON schema, daily budget) with everything client- or repo-written inside <untrusted>, and
writes a DRAFT. Nothing here reaches a client: the founder approves, edits or skips every draft in admin (F13).

    weekly_update   {project_id, week_of[, notes]}            -> updates row (draft, one per project and week)
    report_draft    {project_id, period_start, period_end[, notes]} -> reports row (draft; the hosted side renders the
                                                                 R2 template and the PDF on publish, F15)
    referral_draft  {org_id, trigger, ref_id}                  -> approval_queue row (kind 'referral', pending): it
                                                                 waits in Approvals and leaves from er@ via the outbox

Repositories are read with plain `git log` (read-only, no hooks, no pager, no optional locks); only commits whose
message mentions one of the project's own tickets (EL-<n>) are used, and only their subject lines.
"""
import json
import os
import re
import subprocess
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import jsonschema

from core import lint, llm
from prompts import loader, schemas

PKT = ZoneInfo("Asia/Karachi")
SKILL_DIR = Path(__file__).resolve().parents[1] / "skills" / "delivery-report"
REPORT_SCHEMA = json.loads((SKILL_DIR / "schema.json").read_text())
REPORT_SCHEMA.pop("$comment", None)
UUID = r"^[0-9a-f-]{36}$"
DAY = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
TYPES = ("weekly_update", "report_draft", "referral_draft")

# Job params, validated here as well as by the CHECK constraints in 012 (EN4).
PARAMS = {
    "weekly_update": {"type": "object", "additionalProperties": False, "required": ["project_id", "week_of"],
                      "properties": {"project_id": {"type": "string", "pattern": UUID},
                                     "week_of": {"type": "string", "pattern": DAY},
                                     "notes": {"type": "string", "maxLength": 2000}}},
    "report_draft": {"type": "object", "additionalProperties": False, "required": ["project_id", "period_start", "period_end"],
                     "properties": {"project_id": {"type": "string", "pattern": UUID},
                                    "period_start": {"type": "string", "pattern": DAY},
                                    "period_end": {"type": "string", "pattern": DAY},
                                    "notes": {"type": "string", "maxLength": 4000}}},
    "referral_draft": {"type": "object", "additionalProperties": False, "required": ["org_id", "trigger", "ref_id"],
                       "properties": {"org_id": {"type": "string", "pattern": UUID},
                                      "trigger": {"type": "string", "enum": ["project_done", "invoice_paid"]},
                                      "ref_id": {"type": "string", "pattern": UUID}}},
}
OPEN = ("new", "triaged", "briefed", "planned", "approved", "in_progress", "review")
REF_RE = re.compile(r"\bEL-(\d{1,9})\b", re.I)
REFERRAL_COOLDOWN = timedelta(days=90)


class JobError(RuntimeError):
    """A job that cannot run (bad params, missing project). Fails the job with this message."""


def _iso(d) -> str:
    return d.isoformat()


def _day(s: str) -> date:
    return date.fromisoformat(s)


def _start(d: date) -> datetime:
    return datetime.combine(d, time(0, 0), tzinfo=PKT)


def _fmt_day(d: date) -> str:
    return f"{d.day} {d.strftime('%b %Y')}"


def _clip(s, n: int) -> str:
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------------------------------------------- git (read-only)

def git_log(repo_path: str | None, since: datetime, until: datetime, refs: set[str], run=subprocess.run) -> list[dict]:
    """Commits in [since, until) on any branch whose message mentions one of `refs` (e.g. {"EL-12"}). Never raises."""
    if not repo_path or not refs:
        return []
    path = Path(repo_path).expanduser()
    if not path.is_dir() or not (path / ".git").exists():
        return []
    args = ["git", "-C", str(path), "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
            "log", "--all", "--no-merges", "--no-color", "--no-ext-diff", "-n", "400",
            f"--since={since.isoformat()}", f"--until={until.isoformat()}",
            "--format=%h%x1f%ad%x1f%s%x1f%b%x1e", "--date=short"]
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", "PAGER": "cat"}
    try:
        p = run(args, capture_output=True, text=True, timeout=20, env=env)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if p.returncode != 0:
        return []
    out = []
    wanted = {r.upper() for r in refs}
    for rec in p.stdout.split("\x1e"):
        parts = rec.strip("\n").split("\x1f")
        if len(parts) < 3:
            continue
        sha, day, subject = parts[0].strip(), parts[1].strip(), parts[2]
        body = parts[3] if len(parts) > 3 else ""
        hit = sorted({f"EL-{m}" for m in REF_RE.findall(f"{subject}\n{body}")} & wanted)
        if hit:
            out.append({"sha": sha[:12], "date": day, "subject": _clip(subject, 200), "refs": hit})
    return out


# ---------------------------------------------------------------------------------------------------- data

def _one(db, table: str, **f) -> dict | None:
    rows = db.select(table, limit=1, **f)
    return rows[0] if rows else None


def _project(db, project_id: str) -> tuple[dict, dict]:
    p = _one(db, "projects", id=project_id, select="id,org_id,name,summary,repo_path,status")
    if not p:
        raise JobError("project not found")
    o = _one(db, "organizations", id=p["org_id"], select="id,name,status,is_test,is_demo") or {}
    return p, o


def _staff_ids(db) -> set[str]:
    return {s["user_id"] for s in db.select("staff", select="user_id")}


def _tickets(db, project_id: str) -> list[dict]:
    return db.select("tickets", project_id=project_id, select="id,number,ref,title,type,priority,status,created_at,updated_at",
                     order="updated_at.desc", limit=500)


def _events(db, ticket_ids: list[str], since: datetime, until: datetime) -> list[dict]:
    if not ticket_ids:
        return []
    out = []
    for i in range(0, len(ticket_ids), 80):
        chunk = ",".join(ticket_ids[i:i + 80])
        out += db.select("ticket_events", ticket_id=f"in.({chunk})", created_at=f"gte.{since.isoformat()}",
                         select="ticket_id,kind,body,data,client_visible,actor,created_at", order="created_at.asc", limit=1000)
    return out


def _in(at, since: datetime, until: datetime) -> bool:
    try:
        t = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
    except ValueError:
        return False
    return since <= t < until


def gather(db, project: dict, since: datetime, until: datetime, git=git_log) -> dict:
    """Everything a weekly update or a report is built from, for one project and window."""
    tickets = _tickets(db, project["id"])
    by_id = {t["id"]: t for t in tickets}
    staff = _staff_ids(db)
    events = [e for e in _events(db, list(by_id), since, until) if _in(e.get("created_at"), since, until)]
    done = [t for t in tickets if t["status"] == "done" and _in(t.get("updated_at"), since, until)]
    opened = [t for t in tickets if _in(t.get("created_at"), since, until)]
    open_now = [t for t in tickets if t["status"] in OPEN]
    activity, notes = [], []
    for e in events:
        ref = by_id.get(e["ticket_id"], {}).get("ref", "")
        if e.get("client_visible") and e["kind"] == "status":
            d = e.get("data") or {}
            activity.append(f"{ref} status {d.get('from', '?')} -> {d.get('to', '?')}")
        elif e.get("client_visible") and e["kind"] == "comment":
            who = "Ehab" if e.get("actor") in staff else "client"
            activity.append(f"{ref} comment by {who}: {_clip(e.get('body'), 400)}")
        elif not e.get("client_visible") and e["kind"] == "comment" and e.get("actor") in staff:
            notes.append(f"{ref} internal note: {_clip(e.get('body'), 400)}")
    refs = {t["ref"] for t in tickets if t.get("ref")}
    commits = git(project.get("repo_path"), since, until, refs)
    return {
        "tickets_done": [{"ref": t["ref"], "title": _clip(t["title"], 200), "type": t["type"]} for t in done],
        "tickets_opened": len(opened),
        "open_tickets": [{"ref": t["ref"], "title": _clip(t["title"], 200), "status": t["status"],
                          "waiting_on_client": t["status"] == "review"} for t in open_now[:40]],
        "activity": activity[:120],
        "founder_notes": notes[:40],
        "commits": commits[:150],
    }


def counts(data: dict) -> dict:
    return {"tickets_done": len(data["tickets_done"]), "tickets_opened": data["tickets_opened"],
            "open_tickets": len(data["open_tickets"]), "activity": len(data["activity"]), "commits": len(data["commits"]),
            "founder_notes": len(data["founder_notes"])}


def untrusted_block(data: dict, extra_notes: str | None) -> str:
    """The untrusted material as plain labelled text (core.llm.ask wraps and neutralises it)."""
    parts = ["TICKETS FINISHED:"] + ([f"- {t['ref']} ({t['type']}): {t['title']}" for t in data["tickets_done"]] or ["- none"])
    parts += ["", "OPEN TICKETS:"] + [f"- {t['ref']} [{t['status']}{', waiting on client' if t['waiting_on_client'] else ''}]: "
                                      f"{t['title']}" for t in data["open_tickets"]]
    parts += ["", "CLIENT-VISIBLE ACTIVITY:"] + [f"- {a}" for a in data["activity"]]
    parts += ["", "COMMITS (subject lines):"] + [f"- {c['date']} {', '.join(c['refs'])}: {c['subject']}" for c in data["commits"]]
    parts += ["", "EHAB'S NOTES:"] + [f"- {n}" for n in data["founder_notes"]]
    if extra_notes:
        parts += [f"- {_clip(extra_notes, 4000)}"]
    return "\n".join(parts)


# ---------------------------------------------------------------------------------------------------- weekly update

def render_update(d: dict) -> str:
    def block(title: str, items: list[str], empty: str) -> str:
        lines = [f"- {_clip(x, 300)}" for x in items if str(x).strip()] or [f"- {empty}"]
        return f"## {title}\n" + "\n".join(lines)
    return "\n\n".join([block("Done this week", d.get("done", []), "No client-visible changes this week."),
                        block("Next", d.get("next", []), "Planning the next steps with you."),
                        block("Needs your input", d.get("needs_input", []), "Nothing this week.")])


def weekly_update(db, job: dict, ask=llm.ask, git=git_log, run_id: str = "") -> dict:
    p = job["params"]
    project, org = _project(db, p["project_id"])
    week = _day(p["week_of"])
    since, until = _start(week), _start(week + timedelta(days=7))
    data = gather(db, project, since, until, git)
    c = counts(data)
    title = f"Week of {_fmt_day(week)}"
    if not (c["tickets_done"] or c["activity"] or c["commits"] or c["founder_notes"] or p.get("notes")):
        d, notes, model = {"done": [], "next": [], "needs_input": []}, "Quiet week: no activity found, nothing was sent to the model.", None
    else:
        ctx = (f"project \"{_clip(project['name'], 120)}\" for {_clip(org.get('name'), 120)}; week {_fmt_day(week)} to "
               f"{_fmt_day(week + timedelta(days=6))}; counts {json.dumps(c)}")
        system = loader.compose("weekly_update", {"context": ctx}, preamble="preamble_platform")
        d, _meta = ask(db, "worker", run_id, system, untrusted_block(data, p.get("notes")), schemas.WEEKLY_UPDATE,
                       model="sonnet", timeout=180)
        title = _clip(d.get("title") or title, 120)
        notes, model = d.get("notes", ""), "sonnet"
    body = render_update(d)
    hits = lint.lint(body, {"recipient": ""})
    saved = db.rpc("save_update_draft", {"p_project_id": project["id"], "p_title": title, "p_body_md": body,
                                         "p_source": "weekly", "p_week_of": week.isoformat(), "p_inputs": {**c, "model": model},
                                         "p_lint": hits, "p_job_id": job["id"]})
    return {"update_id": saved["id"], "state": saved["state"], "lint": len(hits), "notes": _clip(notes, 400), **c}


# ---------------------------------------------------------------------------------------------------- delivery report

def period_label(start: date, end: date) -> str:
    if (start.year, start.month) == (end.year, end.month):
        return start.strftime("%B %Y")
    if start.year == end.year:
        return f"{start.strftime('%B')} – {end.strftime('%B %Y')}"
    return f"{start.strftime('%B %Y')} – {end.strftime('%B %Y')}"


def report_draft(db, job: dict, ask=llm.ask, git=git_log, run_id: str = "") -> dict:
    p = job["params"]
    project, org = _project(db, p["project_id"])
    start, end = _day(p["period_start"]), _day(p["period_end"])
    if end < start:
        raise JobError("period ends before it starts")
    since, until = _start(start), _start(end + timedelta(days=1))
    data = gather(db, project, since, until, git)
    updates = [u for u in db.select("updates", project_id=project["id"], status="published",
                                    select="title,body_md,published_at", order="published_at.asc", limit=60)
               if _in(u.get("published_at"), since, until)]
    c = {**counts(data), "updates": len(updates)}
    label = period_label(start, end)
    ctx = (f"project \"{_clip(project['name'], 120)}\" for {_clip(org.get('name'), 120)}; period {label} "
           f"({start.isoformat()} to {end.isoformat()}); counts {json.dumps(c)}")
    material = untrusted_block(data, p.get("notes"))
    material += "\n\nPUBLISHED WEEKLY UPDATES:\n" + "\n".join(f"- {u['title']}:\n{_clip(u['body_md'], 1500)}" for u in updates)
    system = loader.compose("delivery_report", {"context": ctx}, preamble="preamble_platform")
    d, _meta = ask(db, "worker", run_id, system, material, REPORT_SCHEMA, model="sonnet", timeout=300)
    notes = d.pop("notes", "")
    content = {**d, "prepared_for": f"Prepared for the {_clip(org.get('name') or 'client', 120)} team"}
    jsonschema.validate(content, REPORT_SCHEMA)
    rid = db.rpc("save_report_draft", {"p_id": None, "p_project_id": project["id"], "p_title": _clip(content["title"], 200),
                                       "p_period_label": label, "p_content": content, "p_job_id": job["id"]})
    return {"report_id": rid, "notes": _clip(notes, 600), **c}


# ---------------------------------------------------------------------------------------------------- referral ask (E4)

def referral_draft(db, job: dict, ask=llm.ask, run_id: str = "", now: datetime | None = None) -> dict:
    p = job["params"]
    now = now or datetime.now(timezone.utc)
    org = _one(db, "organizations", id=p["org_id"], select="id,name,status,is_test,is_demo,company_id")
    if not org:
        raise JobError("organisation not found")
    if org.get("is_test") or org.get("is_demo") or org.get("status") != "active":
        return {"skipped": "test, demo or archived organisation"}
    team = db.rpc("org_team", {"p_org_id": org["id"]}) or {}
    owners = sorted((m for m in team.get("members", []) if m.get("role") == "owner"), key=lambda m: str(m.get("joined_at")))
    if not owners:
        return {"skipped": "no owner to ask"}
    owner = owners[0]
    to = str(owner["email"]).lower()
    if db.rpc("is_suppressed", {"addr": to}):
        return {"skipped": "recipient is on the suppression list"}
    since = (now - REFERRAL_COOLDOWN).isoformat()
    if db.select("approval_queue", kind="referral", to_email=to, created_at=f"gte.{since}", select="id", limit=1):
        return {"skipped": "asked within the last 90 days"}
    projects = db.select("projects", org_id=org["id"], select="id,name,summary,status", limit=20)
    if p["trigger"] == "project_done":
        projects = [x for x in projects if x["id"] == p["ref_id"]] or projects
    delivered = []
    for pr in projects[:3]:
        done = [t for t in _tickets(db, pr["id"]) if t["status"] == "done"]
        delivered.append(f"Project: {_clip(pr['name'], 120)}. {_clip(pr.get('summary'), 400)} "
                         f"Tickets finished: {len(done)}. Recent: " + "; ".join(_clip(t["title"], 100) for t in done[:5]))
    first = (owner.get("name") or "").split(" ")[0] if owner.get("name") else ""
    ctx = f"client organisation \"{_clip(org['name'], 120)}\"; recipient first name \"{_clip(first, 40)}\"; trigger {p['trigger']}"
    system = loader.compose("referral_ask", {"context": ctx}, preamble="preamble_platform")
    d, _meta = ask(db, "worker", run_id, system, "\n".join(delivered) or "(no project details)", schemas.REFERRAL_ASK,
                   model="sonnet", timeout=120)
    hits = lint.lint(d["body"], {"recipient": to})
    deal = None
    if org.get("company_id"):
        deals = db.select("deals", company_id=org["company_id"], select="id,stage", order="created_at.desc", limit=5)
        deal = next((x["id"] for x in deals if x.get("stage") == "won"), deals[0]["id"] if deals else None)
    contact = _one(db, "contacts", email=to, select="id")
    row = db.insert("approval_queue", {
        "agent": "referral", "kind": "referral", "deal_id": deal, "contact_id": (contact or {}).get("id"),
        "draft": d["body"], "status": "pending", "to_email": to, "subject": _clip(d["subject"], 120),
        "run_id": run_id or None, "held": bool(hits),
        "held_reason": ("lint: " + ", ".join(sorted({h["type"] for h in hits}))) if hits else None, "lint": hits,
    })[0]
    return {"approval_id": row["id"], "lint": len(hits), "notes": _clip(d.get("notes"), 300)}


HANDLERS = {"weekly_update": weekly_update, "report_draft": report_draft, "referral_draft": referral_draft}


def handle(db, job: dict, ask=llm.ask, git=git_log, run_id: str = "") -> tuple[bool, dict | None, str | None]:
    """(ok, result, error) for one claimed platform job. Never raises."""
    t = job.get("type")
    if t not in HANDLERS:
        return False, None, "job type not handled"
    try:
        jsonschema.validate(job.get("params"), PARAMS[t])
    except jsonschema.ValidationError:
        return False, None, "invalid params"
    try:
        if t == "referral_draft":
            return True, referral_draft(db, job, ask, run_id), None
        return True, HANDLERS[t](db, job, ask, git, run_id), None
    except JobError as e:
        return False, None, str(e)[:300]
    except llm.BudgetExceeded:
        return False, None, "daily AI budget reached; queue it again tomorrow"
    except llm.LLMError as e:
        return False, None, f"AI couldn't draft it ({str(e)[:160]}); write it yourself or retry"
    except jsonschema.ValidationError as e:
        return False, None, f"draft failed validation: {e.message[:160]}"
    except Exception as e:  # a DB or network fault: the job fails with the type only (no data in the error)
        return False, None, f"{type(e).__name__}"


# ---------------------------------------------------------------------------------------------------- clock

def weekly_due(now: datetime) -> date | None:
    """The week_of to queue when it is Friday 15:00-23:59 PKT, else None (the Mac is the clock, E2)."""
    local = now.astimezone(PKT)
    if local.isoweekday() == 5 and local.time() >= time(15, 0):
        return (local - timedelta(days=local.weekday())).date()
    return None
