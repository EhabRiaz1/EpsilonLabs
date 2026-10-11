from datetime import datetime, timezone

from agents import scheduler
from tests.fakes import FakeDB

BRIEF = {"Hour": 8, "Minute": 30}
BACKUP = {"Weekday": 0, "Hour": 2, "Minute": 0}


def utc(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def test_missed_brief_is_due_after_its_slot_but_not_before():
    # 03:40Z = 08:40 PKT, brief slot 08:30 PKT
    assert scheduler.due("brief", utc("2026-10-11T03:40:00"), utc("2026-10-10T07:30:00"), False, BRIEF)
    assert not scheduler.due("brief", utc("2026-10-11T03:20:00"), utc("2026-10-10T03:35:00"), False, BRIEF)


def test_already_ran_since_slot_or_running_is_not_due():
    assert not scheduler.due("brief", utc("2026-10-11T03:40:00"), utc("2026-10-11T03:31:00"), False, BRIEF)
    assert not scheduler.due("brief", utc("2026-10-11T03:40:00"), None, True, BRIEF)
    assert not scheduler.due("brief", utc("2026-10-11T03:40:00"), None, False, None)


def test_stale_slot_is_not_replayed_but_weekly_backup_gets_three_days():
    # brief slot 08:30 PKT, now 23:00 PKT same day (14.5h later) > 12h grace
    assert not scheduler.due("brief", utc("2026-10-11T18:00:00"), utc("2026-10-10T03:31:00"), False, BRIEF)
    # backup slot Sun 02:00 PKT (Sat 21:00Z); Mac off until Tue: still due
    assert scheduler.due("backup", utc("2026-10-13T06:00:00"), utc("2026-10-04T00:00:00"), False, BACKUP)


def test_run_kicks_only_due_jobs_and_records_a_heartbeat():
    db = FakeDB()
    db.insert("agent_heartbeats", {"agent": "prospector", "status": "ok", "last_run": "2026-10-11T03:25:00+00:00"})
    db.insert("agent_heartbeats", {"agent": "backup", "status": "ok", "last_run": "2026-10-11T01:00:00+00:00"})
    kicked = []
    specs = {"tenders": {"Hour": 6, "Minute": 0}, "prospector": {"Hour": 7, "Minute": 0}, "brief": BRIEF, "backup": BACKUP}
    out = scheduler.run(db, now=utc("2026-10-11T03:40:00"), kick=lambda j: kicked.append(j) or True,
                        running=lambda j: False, spec=specs.get)
    assert kicked == ["tenders", "brief"]          # prospector ran at 08:25 PKT and backup at 06:00 PKT, both after their slots
    assert out["started"] == ["tenders", "brief"]
    assert db.rows("agent_heartbeats", agent="scheduler")[0]["detail"]["started"] == ["tenders", "brief"]
