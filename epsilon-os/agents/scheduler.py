"""Clock-time jobs, made reliable.

launchd's StartCalendarInterval proved unreliable on this Mac (prospector, tenders and brief never fired on
2026-10-11 although the Mac was awake). This job runs every 5 minutes on StartInterval, which does fire, and
starts any clock-time job whose latest slot has passed but that has not run since:

    slot passed? ──no──▶ skip
        │yes
    ran since slot (heartbeat ≥ slot)? ──yes──▶ skip
        │no
    slot older than grace? ──yes──▶ skip (do not replay a stale morning brief at midnight)
        │no
    running now? ──yes──▶ skip
        │no
    launchctl kickstart  (the job's own process lock still prevents any overlap)

Slots are read from the job plists (the single source of truth the dashboard also shows). Once a day (03:00 PKT) it
also prunes heartbeats older than 14 days and site analytics older than 180 days, to stay inside the free Supabase
plan (F16), and re-seeds the demo portal (reset_demo, migration 016). pg_cron is not enabled on the project, so this
is where those daily jobs run.
"""
import os
import subprocess
from datetime import datetime, timedelta, timezone

from core import ledger
from dashboard import schedule as sched

AGENT = "scheduler"
CLOCK_JOBS = ("tenders", "prospector", "brief", "backup")
GRACE = {"backup": timedelta(days=3)}
DEFAULT_GRACE = timedelta(hours=12)
HEARTBEAT_KEEP = timedelta(days=14)
DAILY_RPCS = ("prune_site_events", "reset_demo")   # migration 016; service role


def last_slot(spec: dict, now: datetime) -> datetime | None:
    """Most recent local time matching a launchd calendar dict, at or before `now`."""
    local = now.astimezone(sched.PKT)
    for back in range(0, 8):
        day = local - timedelta(days=back)
        cand = day.replace(hour=int(spec.get("Hour", 0)), minute=int(spec.get("Minute", 0)), second=0, microsecond=0)
        if "Weekday" in spec and cand.isoweekday() % 7 != int(spec["Weekday"]) % 7:
            continue
        if cand <= local:
            return cand
    return None


def due(job: str, now: datetime, last_run: datetime | None, running: bool, spec: dict | None) -> bool:
    if not spec or running:
        return False
    slot = last_slot(spec, now)
    if slot is None or now - slot > GRACE.get(job, DEFAULT_GRACE):
        return False
    return last_run is None or last_run < slot


def _kick(job: str) -> bool:
    r = subprocess.run(["launchctl", "kickstart", f"gui/{os.getuid()}/{sched.PREFIX}{job}"],
                       capture_output=True, text=True, timeout=10)
    return r.returncode == 0


def _spec(job: str) -> dict | None:
    pl = sched._plist(job) or {}
    spec = pl.get("StartCalendarInterval")
    return spec[0] if isinstance(spec, list) and spec else (spec if isinstance(spec, dict) else None)


def _last_run(db, job: str) -> datetime | None:
    rows = db.select("agent_heartbeats", agent=job, order="last_run.desc", limit=1, select="last_run")
    if not rows:
        return None
    return datetime.fromisoformat(rows[0]["last_run"].replace("Z", "+00:00"))


def run(db, now: datetime | None = None, kick=_kick, running=sched.running, spec=_spec) -> dict:
    now = now or datetime.now(timezone.utc)
    started, errors = [], []
    for job in CLOCK_JOBS:
        try:
            if due(job, now, _last_run(db, job), running(job), spec(job)):
                (started if kick(job) else errors).append(job)
        except Exception as e:  # one bad job must not stop the others
            errors.append(f"{job}:{type(e).__name__}")
    pruned = 0
    daily: list[str] = []
    local = now.astimezone(sched.PKT)
    if local.hour == 3 and local.minute < 5:  # once a day, quietly
        cutoff = (now - HEARTBEAT_KEEP).isoformat()
        try:
            pruned = len(db.delete("agent_heartbeats", last_run=f"lt.{cutoff}"))
        except Exception as e:
            errors.append(f"prune:{type(e).__name__}")
        for fn in DAILY_RPCS:  # each on its own: one failing must not skip the other
            try:
                db.rpc(fn)
                daily.append(fn)
            except Exception as e:
                errors.append(f"{fn}:{type(e).__name__}")
    status = "warn" if errors else "ok"
    detail = {"started": started, "errors": errors, "pruned": pruned}
    if daily:
        detail["daily"] = daily
    if started or errors or pruned or daily or local.minute < 5:  # heartbeat on activity, plus once an hour
        ledger.heartbeat(db, AGENT, status, detail)
    return detail
