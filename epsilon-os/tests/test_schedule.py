from datetime import datetime, timedelta, timezone

from dashboard import schedule


def test_next_calendar_daily_and_weekly():
    now = datetime(2026, 10, 11, 1, 0, tzinfo=timezone.utc)          # 06:00 PKT Sunday
    daily = schedule._next_calendar({"Hour": 7, "Minute": 0}, now)
    assert (daily.hour, daily.minute, daily.day) == (7, 0, 11)
    past = schedule._next_calendar({"Hour": 5, "Minute": 30}, now)
    assert (past.day, past.hour) == (12, 5)
    weekly = schedule._next_calendar({"Weekday": 0, "Hour": 2, "Minute": 0}, now)   # Sunday 02:00 already passed
    assert weekly.isoweekday() == 7 and (weekly - now.astimezone(schedule.PKT)).days >= 6


def test_interval_due_after_last_heartbeat(monkeypatch):
    monkeypatch.setattr(schedule, "_plist", lambda job: {"StartInterval": 300})
    now = datetime(2026, 10, 11, 1, 0, tzinfo=timezone.utc)
    when, cadence = schedule.next_run("inbox", now - timedelta(minutes=2), now)
    assert cadence == "every 5 min" and schedule.until(when, now) == "in 3m"
    when, _ = schedule.next_run("inbox", None, now)
    assert schedule.until(when, now) == "due now"


def test_only_long_jobs_can_be_started_by_hand(monkeypatch):
    calls = []
    monkeypatch.setattr(schedule.subprocess, "run", lambda *a, **k: calls.append(a) or type("R", (), {"returncode": 0})())
    assert schedule.run_now("inbox") is False and calls == []
    assert schedule.run_now("prospector") is True and "kickstart" in calls[0][0]
