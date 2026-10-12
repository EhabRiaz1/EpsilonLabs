"""Mac worker (EN4, reliability baseline F12): the hosted admin's hands on the Mac. Runs every minute (launchd).

1. Jobs: claims queued `run_agent` jobs from the `jobs` table with a 5-minute lease (claim_jobs RPC: expired jobs are
   closed, a lapsed lease is retried once, then failed) and starts the agent with `launchctl kickstart`. Only
   prospector, tenders and brief may be started; params must be exactly {"agent": <one of those>}. The admin never
   reaches the Mac: it only writes the row.
2. Snapshot: a `worker` heartbeat whose detail carries launchd state, cadence and next run per job, so admin.* can show
   the Agents page and the "Worker online · Mac" chip without talking to the laptop.
3. Push: POSTs the admin's push sender (/api/cron/push) with the shared secret. Vercel Hobby crons run once a day,
   so the Mac is the clock (E5). Push is best-effort; the sender also emails urgent items.
4. Comms (012): every 5 minutes POSTs /api/cron/digest (same secret): the hosted mailer emails urgent notifications
   at once and the daily digests at 10:00 in each person's timezone, and flags overdue invoices.
5. Weekly updates (E2): on Fridays from 15:00 PKT, queues one weekly_update job per active client project (once per
   week; the database dedupes).
6. Drafting jobs (012): claims at most ONE weekly_update / report_draft / referral_draft job per run (15-minute lease)
   and runs it with a tool-less model call (agents/platform_jobs.py). The heartbeat is written before it starts, so a
   long draft never makes admin.* show the worker offline.
"""
import sys
from datetime import datetime, timezone

import httpx

from agents import platform_jobs
from core import config, ledger, llm
from core.db import DB
from dashboard import schedule as sched

AGENT = "worker"
ALLOWED = ("prospector", "tenders", "brief")
JOB_TYPES = ["run_agent"]
LEASE_SECONDS = 300
SNAPSHOT_JOBS = ("prospector", "tenders", "brief", "outreach", "inbox", "outbox", "backup", "scheduler", "dashboard",
                 "keepawake", "worker", "project_agent")
PUSH_URL = "https://admin.epsilon-labs.co/api/cron/push"
DIGEST_URL = "https://admin.epsilon-labs.co/api/cron/digest"
DRAFT_TYPES = list(platform_jobs.TYPES)
DRAFT_LEASE_SECONDS = 900
PUSH_SECRET = ("epsilon-os-push-cron-secret", "admin")   # keychain service, account (same value as Vercel's PUSH_CRON_SECRET)


def _iso(dt):
    return dt.isoformat() if dt else None


def handle_run_agent(job: dict, kick) -> tuple[bool, dict | None, str | None]:
    """(ok, result, error) for one claimed run_agent job. The allow-list is checked here as well as in the DB."""
    params = job.get("params") or {}
    agent = params.get("agent") if isinstance(params, dict) else None
    if not isinstance(params, dict) or set(params) != {"agent"} or agent not in ALLOWED:
        return False, None, "agent not allowed"
    if not kick(agent):
        return False, None, "launchctl kickstart refused"
    return True, {"agent": agent, "started": True}, None


def _last_runs(db) -> dict:
    out: dict = {}
    for h in db.select("agent_heartbeats", select="agent,last_run", order="last_run.desc", limit=300):
        if h.get("agent") and h["agent"] not in out and h.get("last_run"):
            try:
                out[h["agent"]] = datetime.fromisoformat(str(h["last_run"]).replace("Z", "+00:00"))
            except ValueError:
                pass
    return out


def snapshot(db, now: datetime, state=sched.state, next_run=sched.next_run) -> dict:
    last = _last_runs(db)
    jobs = {}
    for job in SNAPSHOT_JOBS:
        st = state(job) or {}
        nxt, cadence = next_run(job, last.get(job), now)
        jobs[job] = {"loaded": bool(st.get("loaded")), "running": bool(st.get("running")), "exit": st.get("exit"),
                     "next": _iso(nxt), "cadence": cadence}
    return jobs


def _push_secret() -> str | None:
    try:
        return config.secret(*PUSH_SECRET)
    except Exception:
        return None


def post_push(client: httpx.Client | None = None, secret=_push_secret, url: str = PUSH_URL) -> dict:
    """Ask the hosted sender to deliver pending push_queue rows. Never raises."""
    key = secret()
    if not key:
        return {"state": "not configured"}
    try:
        r = (client or httpx).post(url, headers={"Authorization": f"Bearer {key}"}, timeout=25.0)
    except Exception as e:
        return {"state": "failed", "error": type(e).__name__}
    if r.status_code != 200:
        return {"state": "failed", "error": f"HTTP {r.status_code}"}
    try:
        body = r.json()
    except ValueError:
        body = {}
    return {"state": "ok", **{k: v for k, v in body.items() if isinstance(v, int) and not isinstance(v, bool)}}


def post_digest() -> dict:
    return post_push(url=DIGEST_URL)


def queue_weekly(db, now: datetime) -> dict:
    """Friday 15:00+ PKT: queue this week's weekly_update jobs (idempotent in the database)."""
    week = platform_jobs.weekly_due(now)
    if week is None:
        return {"state": "not due"}
    try:
        n = db.rpc("queue_weekly_updates", {"p_week_of": week.isoformat()})
    except Exception as e:
        return {"state": "failed", "error": type(e).__name__}
    return {"state": "ok", "week_of": week.isoformat(), "queued": int(n or 0)}


def run_drafts(db, run_id: str, ask=llm.ask, git=platform_jobs.git_log) -> dict:
    """Claim and run at most one drafting job. Never raises."""
    c = {"claimed": 0, "done": 0, "failed": 0}
    try:
        jobs = db.rpc("claim_jobs", {"p_types": DRAFT_TYPES, "p_lease_seconds": DRAFT_LEASE_SECONDS, "p_limit": 1}) or []
    except Exception as e:
        return {**c, "error": f"claim: {type(e).__name__}"}
    for job in jobs:
        c["claimed"] += 1
        ok, result, error = platform_jobs.handle(db, job, ask=ask, git=git, run_id=run_id)
        try:
            db.rpc("finish_job", {"p_id": job["id"], "p_ok": ok, "p_result": result, "p_error": error})
        except Exception as e:
            c["error"] = f"finish: {type(e).__name__}"
        c["done" if ok else "failed"] += 1
        c["type"] = job.get("type")
        try:
            ledger.action(db, AGENT, run_id, f"{job.get('type')}_{'drafted' if ok else 'failed'}", "jobs", job["id"],
                          {"error": error, **({k: v for k, v in (result or {}).items() if k != "notes"})})
        except Exception:
            pass
    return c


def run(db: DB | None = None, now: datetime | None = None, kick=sched.run_now, state=sched.state,
        next_run=sched.next_run, push=post_push, digest=post_digest, ask=llm.ask, git=platform_jobs.git_log) -> dict:
    db = db or DB()
    now = now or datetime.now(timezone.utc)
    c = {"claimed": 0, "started": 0, "failed": 0, "errors": 0}
    try:
        claimed = db.rpc("claim_jobs", {"p_types": JOB_TYPES, "p_lease_seconds": LEASE_SECONDS, "p_limit": 5}) or []
    except Exception as e:
        claimed = []
        c["errors"] += 1
        c["error"] = f"claim: {type(e).__name__}"
    for job in claimed:
        c["claimed"] += 1
        try:
            ok, result, error = handle_run_agent(job, kick)
        except Exception as e:  # a launchctl failure must not leave the job claimed until the lease lapses
            ok, result, error = False, None, f"{type(e).__name__}"
        try:
            db.rpc("finish_job", {"p_id": job["id"], "p_ok": ok, "p_result": result, "p_error": error})
        except Exception as e:
            c["errors"] += 1
            c["error"] = f"finish: {type(e).__name__}"
        c["started" if ok else "failed"] += 1
        try:
            ledger.action(db, AGENT, ledger.new_run_id(), "run_agent_started" if ok else "run_agent_failed", "jobs",
                          job["id"], {"agent": (job.get("params") or {}).get("agent"), "error": error})
        except Exception:
            pass
    try:
        jobs = snapshot(db, now, state, next_run)
    except Exception as e:
        jobs = {}
        c["errors"] += 1
        c["error"] = f"snapshot: {type(e).__name__}"
    pushed = push()
    mailed = digest() if now.minute % 5 == 0 else {"state": "not due"}
    weekly = queue_weekly(db, now)
    status = "error" if c["errors"] else ("warn" if c["failed"] or pushed.get("state") == "failed"
                                          or mailed.get("state") == "failed" else "ok")
    ledger.heartbeat(db, AGENT, status, {**c, "jobs": jobs, "push": pushed, "digest": mailed, "weekly": weekly})
    drafts = run_drafts(db, ledger.new_run_id(), ask=ask, git=git)
    if drafts["claimed"] or drafts.get("error"):
        ledger.heartbeat(db, AGENT, "error" if drafts.get("error") else ("warn" if drafts["failed"] else "ok"),
                         {**c, "jobs": jobs, "push": pushed, "digest": mailed, "weekly": weekly, "drafts": drafts})
    return {**c, "push": pushed, "digest": mailed, "weekly": weekly, "drafts": drafts}


def main() -> int:
    print(run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
