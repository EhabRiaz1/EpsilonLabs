"""When each Epsilon OS job runs next, read from the installed launchd plists, plus a "run now" trigger.

Interval jobs (StartInterval) are due one interval after their last heartbeat; calendar jobs
(StartCalendarInterval) at the next matching local time. Times are shown in Asia/Karachi.
"""
import os
import plistlib
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from core import config

PKT = ZoneInfo(config.TZ)
AGENTS_DIR = Path.home() / "Library" / "LaunchAgents"
REPO_DIR = Path(__file__).resolve().parent.parent / "launchd"
PREFIX = "co.epsilon-labs.os."
# (job, label shown, heartbeat agent name)
JOBS = [("prospector", "Prospector", "prospector"), ("tenders", "Tender scan", "tenders"),
        ("brief", "Morning brief", "brief"), ("outreach", "Outreach sends", "outreach"),
        ("inbox", "Inbox", "inbox"), ("outbox", "Outbox", "outbox"), ("backup", "Backup", "backup")]
RUNNABLE = {"prospector", "tenders", "brief"}  # long jobs the founder may start by hand


def _plist(job: str) -> dict | None:
    for d in (AGENTS_DIR, REPO_DIR):
        p = d / f"{PREFIX}{job}.plist"
        if p.exists():
            try:
                return plistlib.loads(p.read_bytes())
            except Exception:
                return None
    return None


def _next_calendar(spec: dict, now: datetime) -> datetime:
    """Next local time matching a launchd StartCalendarInterval dict (Hour, Minute, optional Weekday 0=Sun)."""
    local = now.astimezone(PKT)
    hour, minute = int(spec.get("Hour", 0)), int(spec.get("Minute", 0))
    for add in range(0, 8):
        day = local + timedelta(days=add)
        cand = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if "Weekday" in spec and (cand.isoweekday() % 7) != int(spec["Weekday"]) % 7:
            continue
        if cand > local:
            return cand
    return local + timedelta(days=7)


def next_run(job: str, last_run: datetime | None, now: datetime) -> tuple[datetime | None, str]:
    """(next local run time, cadence text)."""
    pl = _plist(job)
    if not pl:
        return None, "not installed"
    if "StartInterval" in pl:
        secs = int(pl["StartInterval"])
        cadence = f"every {secs // 60} min" if secs >= 60 else f"every {secs}s"
        due = (last_run + timedelta(seconds=secs)) if last_run else now
        return max(due, now).astimezone(PKT), cadence
    spec = pl.get("StartCalendarInterval")
    if isinstance(spec, list):
        spec = spec[0] if spec else None
    if isinstance(spec, dict):
        when = _next_calendar(spec, now)
        days = "Sun " if "Weekday" in spec else "daily "
        return when, f"{days}{int(spec.get('Hour', 0)):02d}:{int(spec.get('Minute', 0)):02d}"
    return None, "on demand"


def running(job: str) -> bool:
    try:
        out = subprocess.run(["launchctl", "print", f"gui/{os.getuid()}/{PREFIX}{job}"],
                             capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return False
    return "state = running" in out


def run_now(job: str) -> bool:
    if job not in RUNNABLE:
        return False
    r = subprocess.run(["launchctl", "kickstart", f"gui/{os.getuid()}/{PREFIX}{job}"],
                       capture_output=True, text=True, timeout=5)
    return r.returncode == 0


def until(when: datetime | None, now: datetime) -> str:
    if when is None:
        return ""
    s = int((when - now).total_seconds())
    if s <= 60:
        return "due now"
    h, m = divmod(s // 60, 60)
    return f"in {h}h {m}m" if h else f"in {m}m"


def view(last_runs: dict, now: datetime) -> list[dict]:
    """Rows for the dashboard: label, cadence, next local time, countdown, running flag, runnable flag."""
    rows = []
    for job, label, agent in JOBS:
        last = last_runs.get(agent)
        when, cadence = next_run(job, last, now)
        is_running = running(job)
        rows.append({"job": job, "label": label, "cadence": cadence, "running": is_running,
                     "next": when.strftime("%a %H:%M") if when else "—",
                     "until": "running now" if is_running else until(when, now),
                     "runnable": job in RUNNABLE})
    return rows
