import fcntl
import json
import plistlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import httpx
import pytest

from agents import backup, brief
from agents import run as runner
from core import config, watchdog
from tests.fakes import FakeDB, FakeMail

NOW = datetime(2026, 10, 12, 4, 0, tzinfo=timezone.utc)   # Monday 09:00 PKT
TUE = NOW + timedelta(days=1)


def iso(**kw):
    return (NOW - timedelta(**kw)).isoformat()


def beat(db, agent, status="ok", **kw):
    db.insert("agent_heartbeats", {"agent": agent, "status": status, "last_run": iso(**kw), "detail": {}})


def healthy(db):
    for a in ("inbox", "outbox"):
        beat(db, a, minutes=1)
    beat(db, "brief", hours=20)
    beat(db, "backup", days=2)
    beat(db, "watchdog", minutes=5)


# ------------------------------------------------------------------ brief

def test_brief_empty_data_renders_and_sends_one_mail():
    db, m = FakeDB(), FakeMail()
    res = brief.run(db, m, NOW)
    assert res["issues"] == 0 and res["subject"] == "Epsilon brief · all clear"
    assert len(m.sent) == 1
    sent = m.sent[0]
    assert sent["to"] == "er@epsilon-labs.co" and sent["message_id"].startswith("<")
    for sect in ("HEALTH", "NEEDS YOU", "FUNNEL, LAST 30 DAYS", "STALLED DEALS"):
        assert sect in sent["body"]
    assert "http://127.0.0.1:8787" in sent["body"] and "<html>" in sent["html"]
    assert [h["status"] for h in db.rows("agent_heartbeats", agent="brief")] == ["ok"]


def test_brief_section_order_and_monday_weekly_block():
    db = FakeDB()
    healthy(db)
    g = brief.gather(db, NOW)
    titles = [t for t, _ in brief.sections(g)]
    assert titles[:3] == ["Health", "Needs you", "Funnel, last 30 days"]
    assert titles[3] == "Weekly leading indicators" and titles[-1].startswith("Stalled deals")
    assert "Weekly leading indicators" not in [t for t, _ in brief.sections(brief.gather(db, TUE))]


def test_brief_needs_you_five_oldest_and_stalled():
    db = FakeDB()
    healthy(db)
    for i in range(7):
        db.insert("approval_queue", {"agent": "inbox", "kind": "reply", "draft": "x", "to_email": f"p{i}@x.com",
                                     "subject": f"s{i}", "created_at": iso(hours=10 + i)})
    db.insert("approval_queue", {"agent": "inbox", "kind": "reply", "draft": "x", "to_email": "h@x.com",
                                 "held": True, "created_at": iso(hours=1)})
    co = db.insert("companies", {"name": "Old Mill", "domain": "oldmill.com"})[0]["id"]
    db.insert("deals", {"company_id": co, "title": "t", "source_channel": "inbound", "stage": "quote_out",
                        "updated_at": iso(days=20), "created_at": iso(days=30)})
    db.insert("deals", {"company_id": co, "title": "fresh", "source_channel": "inbound", "stage": "lead",
                        "updated_at": iso(days=2), "created_at": iso(days=2)})
    g = brief.gather(db, NOW)
    assert len(g["pending"]) == 7 and g["held"] == 1
    text = brief.render_text(g)
    need = text.split("NEEDS YOU")[1].split("FUNNEL")[0]
    assert "7 waiting" in need and need.count("@x.com") + need.count(" · ") >= 5
    assert "p6@x.com" in need and "p2@x.com" in need and "p1@x.com" not in need and "p0@x.com" not in need   # oldest five
    assert "Old Mill · quote out · 20d" in text and "fresh" not in text.split("STALLED")[1]


def test_brief_red_issues_in_subject_and_health():
    db = FakeDB()
    healthy(db)
    beat(db, "inbox", "error", minutes=1)                      # red agent
    db.insert("approval_queue", {"agent": "outbox", "kind": "reply", "draft": "x", "status": "failed",
                                 "to_email": "z@x.com", "send_error": "unverified: check Sent folder"})
    db.insert("agent_heartbeats", {"agent": "inbox", "status": "warn", "last_run": iso(seconds=1),
                                   "detail": {"unprocessed": 3}})
    for _ in range(2):
        db.insert("actions", {"agent": "inbox", "action": "llm_call", "at": iso(hours=20)})
    m = FakeMail()
    res = brief.run(db, m, NOW)
    assert res["issues"] >= 3 and m.sent[0]["subject"] == f"Epsilon brief · {res['issues']} issues"
    assert "ISSUES:" in m.sent[0]["body"] and "3 inbox messages unprocessed" in m.sent[0]["body"]
    assert "LLM calls yesterday: 2 / 250" in m.sent[0]["body"]
    assert db.rows("agent_heartbeats", agent="brief")[-1]["status"] == "warn"


def test_brief_silent_agent_is_flagged():
    db = FakeDB()
    healthy(db)
    db.t["agent_heartbeats"] = [b for b in db.t["agent_heartbeats"] if b["agent"] != "outbox"]
    beat(db, "outbox", hours=5)
    assert any(i.startswith("outbox") for i in brief.gather(db, NOW)["issues"])


def test_brief_idempotent_same_pkt_day_not_next():
    db, m = FakeDB(), FakeMail()
    brief.run(db, m, NOW)
    db.t["actions"][0]["at"] = NOW.isoformat()   # fake DB stamps the real clock; pin it to the test clock
    assert brief.run(db, m, NOW + timedelta(hours=3)) == {"skipped": "already sent today"}
    assert len(m.sent) == 1 and len(db.rows("actions", action="brief_sent")) == 1
    db.t["actions"][0]["at"] = (NOW - timedelta(days=1)).isoformat()
    brief.run(db, m, NOW)
    assert len(m.sent) == 2


def test_brief_send_failure_heartbeat_error_no_sent_marker():
    db, m = FakeDB(), FakeMail()
    m.fail_with = [TimeoutError("smtp secret-ish text")]
    res = brief.run(db, m, NOW)
    assert res["error"] == "TimeoutError" and not db.rows("actions", action="brief_sent")
    hb = db.rows("agent_heartbeats", agent="brief")[0]
    assert hb["status"] == "error" and "secret" not in json.dumps(hb)


def test_brief_recipient_env_override(monkeypatch):
    monkeypatch.setenv("FOUNDER_EMAIL", "me@example.com")
    m = FakeMail()
    brief.run(FakeDB(), m, NOW)
    assert m.sent[0]["to"] == "me@example.com"


def test_brief_makes_no_llm_calls():
    import subprocess
    with mock.patch.object(subprocess, "run", side_effect=AssertionError("no subprocess")):
        brief.run(FakeDB(), FakeMail(), NOW)


# ------------------------------------------------------------------ watchdog

@pytest.fixture
def url(monkeypatch):
    monkeypatch.setattr(config, "secret", lambda s, a: "https://hc-ping.com/abc-123/")
    monkeypatch.setattr(watchdog, "_warned", False)


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_ping_ok_and_fail_urls_and_heartbeat(url):
    seen, db = [], FakeDB()
    c = client(lambda r: (seen.append(str(r.url)), httpx.Response(200))[1])
    assert watchdog.ping("inbox", client=c, db=db) is True
    assert watchdog.ping("inbox", ok=False, client=c, db=db) is True
    assert seen == ["https://hc-ping.com/abc-123", "https://hc-ping.com/abc-123/fail"]
    assert len(db.rows("agent_heartbeats", agent="watchdog")) == 2


def test_ping_never_raises_and_no_heartbeat_on_failure(url):
    db = FakeDB()

    def boom(r):
        raise httpx.ConnectError("down")
    assert watchdog.ping("x", client=client(boom), db=db) is False
    assert watchdog.ping("x", client=client(lambda r: httpx.Response(500)), db=db) is False
    assert not db.rows("agent_heartbeats")


def test_ping_missing_url_noop_logs_once(monkeypatch, capsys):
    def missing(s, a):
        raise config.SecretError("missing")
    monkeypatch.setattr(config, "secret", missing)
    monkeypatch.setattr(watchdog, "_warned", False)
    assert watchdog.ping("a") is False and watchdog.ping("b") is False
    assert capsys.readouterr().err.count("pings disabled") == 1


# ------------------------------------------------------------------ backup

def seed(db):
    co = db.insert("companies", {"name": "A", "domain": "a.com"})[0]["id"]
    for i in range(5):
        db.insert("contacts", {"company_id": co, "email": f"c{i}@a.com", "full_name": f"C{i}"})
    db.insert("suppression_list", {"email": "no@a.com"})


def test_backup_exports_manifest_and_check(tmp_path):
    db = FakeDB()
    seed(db)
    res = backup.run(db, tmp_path, NOW)
    folder = tmp_path / "2026-10-12"
    assert res["rows"]["contacts"] == 5 and res["rows"]["dossiers"] == 0
    man = json.loads((folder / "manifest.json").read_text())
    assert set(man["tables"]) == set(backup.TABLES)
    assert len((folder / "contacts.jsonl").read_text().splitlines()) == 5
    assert backup.restore_check(folder)["ok"]
    assert db.rows("agent_heartbeats", agent="backup")[0]["status"] == "ok"


def test_backup_pages_past_page_size(tmp_path, monkeypatch):
    monkeypatch.setattr(backup, "PAGE", 2)
    db = FakeDB()
    seed(db)
    backup.run(db, tmp_path, NOW)
    ids = [json.loads(x)["id"] for x in (tmp_path / "2026-10-12" / "contacts.jsonl").read_text().splitlines()]
    assert len(ids) == 5 == len(set(ids))


def test_restore_check_detects_tamper_and_missing(tmp_path):
    db = FakeDB()
    seed(db)
    backup.run(db, tmp_path, NOW)
    folder = tmp_path / "2026-10-12"
    with (folder / "contacts.jsonl").open("a") as f:
        f.write('{"id": "x"}\n')
    (folder / "deals.jsonl").unlink()
    res = backup.restore_check(folder)
    assert not res["ok"]
    assert any("contacts: sha256" in p for p in res["problems"]) and any("deals: file missing" in p for p in res["problems"])
    assert backup.restore_check(tmp_path / "nope")["ok"] is False


def test_backup_prunes_to_newest_8_date_folders_only(tmp_path):
    for d in range(1, 11):
        (tmp_path / f"2026-09-{d:02d}").mkdir()
    (tmp_path / "notes").mkdir()
    (tmp_path / "2026-09-xx").mkdir()
    (tmp_path / "keep.txt").write_text("x")
    res = backup.run(FakeDB(), tmp_path, NOW)
    left = sorted(p.name for p in tmp_path.iterdir())
    dated = [n for n in left if n[:2] == "20" and n[-2:].isdigit()]
    assert len(dated) == 8 and "2026-10-12" in dated and "2026-09-01" not in dated
    assert {"notes", "2026-09-xx", "keep.txt"} <= set(left) and len(res["pruned"]) == 3


def test_backup_error_heartbeat_keeps_old_backups(tmp_path):
    (tmp_path / "2026-09-01").mkdir()

    class Bad(FakeDB):
        def select(self, table, **f):
            raise RuntimeError("boom")
    db = Bad()
    db.insert = lambda *a, **k: None
    res = backup.run(db, tmp_path, NOW)
    assert res == {"error": "RuntimeError"} and (tmp_path / "2026-09-01").exists()


# ------------------------------------------------------------------ run.py

def test_lock_is_exclusive_and_released(tmp_path):
    with runner.lock("inbox", tmp_path):
        with pytest.raises(runner.Busy):
            with runner.lock("inbox", tmp_path):
                pass
        with runner.lock("outbox", tmp_path):   # different job is independent
            pass
    with runner.lock("inbox", tmp_path):
        pass


def test_main_skips_when_locked_without_running(tmp_path):
    called = []
    with runner.lock("inbox", tmp_path):
        rc = runner.main(["inbox"], jobs={"inbox": lambda db: called.append(1)}, db_factory=FakeDB,
                         lock_dir=tmp_path, ping=lambda *a, **k: None)
    assert rc == 0 and not called


def test_main_error_path_heartbeat_type_only_exit_nonzero_and_fail_ping(tmp_path, capsys):
    db, pings = FakeDB(), []

    def job(db):
        raise ValueError("password=hunter2")
    rc = runner.main(["outbox"], jobs={"outbox": job}, db_factory=lambda: db, lock_dir=tmp_path,
                     ping=lambda n, ok=True, db=None: pings.append((n, ok)))
    assert rc == 1 and pings == [("outbox", False)]
    hb = db.rows("agent_heartbeats", agent="outbox")[0]
    assert hb["status"] == "error" and hb["detail"] == {"error": "ValueError"}
    cap = capsys.readouterr()
    assert "hunter2" not in cap.out + cap.err and "ValueError" in cap.err


def test_main_success_and_error_dict_result(tmp_path):
    pings = []
    ping = lambda n, ok=True, db=None: pings.append((n, ok))   # noqa: E731
    assert runner.main(["brief"], jobs={"brief": lambda db: {"ok": 1}}, db_factory=FakeDB,
                       lock_dir=tmp_path, ping=ping) == 0
    assert runner.main(["inbox"], jobs={"inbox": lambda db: {"error": "TimeoutError"}}, db_factory=FakeDB,
                       lock_dir=tmp_path, ping=ping) == 1
    assert pings == [("brief", True), ("inbox", False)]


def test_main_rejects_unknown_job(tmp_path):
    assert runner.main(["nope"], lock_dir=tmp_path) == 2


# ------------------------------------------------------------------ launchd plists

PLISTS = sorted((Path(__file__).resolve().parents[1] / "launchd").glob("co.epsilon-labs.os.*.plist"))
VENV_PY = "/Users/ehabriaz/Desktop/epsilon-labs/epsilon-os/.venv/bin/python"


def test_agent_plists_static_checks():
    jobs = {p.name.split(".")[3]: plistlib.loads(p.read_bytes()) for p in PLISTS}
    assert {"inbox", "outbox", "brief", "backup", "dashboard"} <= set(jobs)
    for name in ("inbox", "outbox", "brief", "backup"):
        d = jobs[name]
        assert d["Label"] == f"co.epsilon-labs.os.{name}"
        assert d["ProgramArguments"] == [VENV_PY, "-m", "agents.run", name]
        assert d["WorkingDirectory"].endswith("/epsilon-os") and "RunAtLoad" not in d
        assert d["StandardOutPath"] == f"/Users/ehabriaz/Library/Logs/epsilon-os/{name}.log"
        path = d["EnvironmentVariables"]["PATH"].split(":")
        assert "/Users/ehabriaz/.local/bin" in path and "/usr/bin" in path and "/bin" in path
    assert jobs["inbox"]["StartInterval"] == 300 and jobs["outbox"]["StartInterval"] == 60
    assert jobs["brief"]["StartCalendarInterval"] == {"Hour": 8, "Minute": 30}
    assert jobs["backup"]["StartCalendarInterval"] == {"Weekday": 0, "Hour": 2}
