"""agents/worker.py: run_agent jobs (allow-list, lease, finish), the launchd snapshot heartbeat, and the push poke."""
from datetime import datetime, timedelta, timezone

import httpx

from agents import run as runner, worker
from tests.fakes import FakeDB, FakePlatformAsk

NOW = datetime(2026, 10, 12, 6, 0, tzinfo=timezone.utc)


def job(db, params, **kw):
    return db.insert("jobs", {"type": "run_agent", "params": params, **kw})[0]["id"]


def fake_state(job_):
    return {"loaded": True, "running": job_ == "dashboard", "exit": "0"}


def fake_next(job_, last, now):
    return (now + timedelta(hours=1), "daily 07:00")


def go(db, kicks, push=lambda: {"state": "ok", "sent": 1}, ok=True, digest=lambda: {"state": "ok"}, now=NOW, ask=None):
    return worker.run(db, now=now, kick=lambda a: kicks.append(a) or ok, state=fake_state, next_run=fake_next, push=push,
                      digest=digest, ask=ask or FakePlatformAsk(), git=lambda *a, **k: [])


def test_allowed_agent_is_kicked_and_job_done():
    db = FakeDB(); kicks = []
    j = job(db, {"agent": "prospector"})
    r = go(db, kicks)
    assert kicks == ["prospector"] and r["claimed"] == 1 and r["started"] == 1
    row = db.rows("jobs", id=j)[0]
    assert row["status"] == "done" and row["attempts"] == 1 and row["result"] == {"agent": "prospector", "started": True}
    assert [a["action"] for a in db.rows("actions")] == ["run_agent_started"]


def test_allow_list_refuses_everything_else_without_kicking():
    db = FakeDB(); kicks = []
    bad = [job(db, {"agent": "outbox"}), job(db, {"agent": "brief", "cmd": "rm -rf ~"}), job(db, {}),
           job(db, {"agent": ["brief"]})]
    r = go(db, kicks)
    assert kicks == [] and r["failed"] == 4
    assert {db.rows("jobs", id=b)[0]["error"] for b in bad} == {"agent not allowed"}


def test_kickstart_failure_fails_the_job_and_warns():
    db = FakeDB(); kicks = []
    j = job(db, {"agent": "tenders"})
    go(db, kicks, ok=False)
    assert db.rows("jobs", id=j)[0]["error"] == "launchctl kickstart refused"
    assert db.rows("agent_heartbeats", agent="worker")[-1]["status"] == "warn"


def test_only_queued_run_agent_jobs_are_claimed_and_a_live_lease_is_not_reclaimed():
    db = FakeDB(); kicks = []
    db.insert("jobs", {"type": "ticket_brief", "params": {}})
    j = job(db, {"agent": "brief"})
    held = job(db, {"agent": "tenders"}, status="claimed", attempts=1,
               lease_until=(datetime.now(timezone.utc) + timedelta(minutes=4)).isoformat())
    go(db, kicks)
    assert kicks == ["brief"] and db.rows("jobs", id=held)[0]["status"] == "claimed"
    assert db.rows("jobs", type="ticket_brief")[0]["status"] == "queued"
    assert db.rows("jobs", id=j)[0]["status"] == "done"


def test_lapsed_lease_is_retried_once_then_failed():
    db = FakeDB()
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    a = job(db, {"agent": "brief"}, status="claimed", attempts=1, lease_until=past)
    b = job(db, {"agent": "tenders"}, status="running", attempts=2, lease_until=past)
    kicks = []
    go(db, kicks)
    assert kicks == ["brief"] and db.rows("jobs", id=a)[0]["attempts"] == 2
    assert db.rows("jobs", id=b)[0]["status"] == "failed"


def test_heartbeat_carries_the_launchd_snapshot_and_push_counts():
    db = FakeDB()
    db.insert("agent_heartbeats", {"agent": "prospector", "last_run": NOW.isoformat()})
    go(db, [])
    hb = db.rows("agent_heartbeats", agent="worker")[-1]
    assert hb["status"] == "ok" and set(hb["detail"]["jobs"]) == set(worker.SNAPSHOT_JOBS)
    assert hb["detail"]["jobs"]["dashboard"]["running"] is True
    assert hb["detail"]["jobs"]["prospector"]["cadence"] == "daily 07:00"
    assert hb["detail"]["push"] == {"state": "ok", "sent": 1}


def test_post_push_sends_the_bearer_and_never_raises():
    seen = {}

    def handler(req):
        seen["auth"] = req.headers.get("authorization")
        seen["url"] = str(req.url)
        return httpx.Response(200, json={"ok": True, "claimed": 2, "sent": 2, "emailed": 1})
    client = httpx.Client(transport=httpx.MockTransport(handler))
    r = worker.post_push(client, secret=lambda: "s" * 48)
    assert r == {"state": "ok", "claimed": 2, "sent": 2, "emailed": 1}
    assert seen == {"auth": "Bearer " + "s" * 48, "url": worker.PUSH_URL}
    assert worker.post_push(client, secret=lambda: None) == {"state": "not configured"}
    bad = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(401)))
    assert worker.post_push(bad, secret=lambda: "x") == {"state": "failed", "error": "HTTP 401"}

    def boom(req):
        raise httpx.ConnectError("down")
    down = httpx.Client(transport=httpx.MockTransport(boom))
    assert worker.post_push(down, secret=lambda: "x") == {"state": "failed", "error": "ConnectError"}


def test_push_failure_is_a_warning_not_an_error():
    db = FakeDB()
    go(db, [], push=lambda: {"state": "failed", "error": "HTTP 500"})
    assert db.rows("agent_heartbeats", agent="worker")[-1]["status"] == "warn"


def test_runner_knows_the_worker_and_does_not_ping_for_it(tmp_path):
    assert "worker" in runner.JOBS
    pings = []
    rc = runner.main(["worker"], jobs={"worker": lambda db: {"ok": True}}, db_factory=FakeDB, lock_dir=tmp_path,
                     ping=lambda *a, **k: pings.append(a))
    assert rc == 0 and pings == []
