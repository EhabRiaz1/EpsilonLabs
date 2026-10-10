from datetime import datetime, timedelta, timezone

from dashboard import data
from tests.fakes import FakeDB

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)  # 14:00 PKT


def iso(**kw):
    return (NOW - timedelta(**kw)).isoformat()


def test_greeting_uses_pkt():
    assert data.greeting(datetime(2026, 10, 10, 2, 0, tzinfo=timezone.utc)) == "Good morning, Ehab."   # 07:00 PKT
    assert data.greeting(NOW) == "Good afternoon, Ehab."
    assert data.greeting(datetime(2026, 10, 10, 15, 0, tzinfo=timezone.utc)) == "Good evening, Ehab."  # 20:00 PKT
    assert data.greeting(datetime(2026, 10, 9, 20, 0, tzinfo=timezone.utc)) == "Good morning, Ehab."   # 01:00 PKT next day


def test_kpis_empty_and_populated():
    db = FakeDB()
    k = data.kpis(db, NOW)
    assert k["conversations"] == 0 and k["interested_pct"] is None and k["collected"] == 0
    d1 = db.insert("deals", {"company_id": "c", "title": "a", "source_channel": "inbound", "stage": "quote_out",
                             "value_usd": 1000})[0]["id"]
    db.insert("deals", {"company_id": "c", "title": "b", "source_channel": "inbound", "stage": "won",
                        "value_usd": 2400, "collected_at": iso(days=3)})
    db.insert("deals", {"company_id": "c", "title": "old", "source_channel": "inbound", "stage": "won",
                        "value_usd": 9999, "collected_at": iso(days=45)})
    for deal, label in [(d1, "inquiry"), (d1, "inquiry"), ("d2", "opt_out")]:
        db.insert("touches", {"deal_id": deal, "type": "human_reply", "direction": "inbound",
                              "occurred_at": iso(days=2), "classifier": {"label": label}})
    db.insert("touches", {"deal_id": "d3", "type": "human_reply", "direction": "inbound",
                          "occurred_at": iso(days=40), "classifier": {"label": "inquiry"}})
    for _ in range(4):
        db.insert("touches", {"type": "sent", "direction": "outbound", "occurred_at": iso(days=1)})
    k = data.kpis(db, NOW)
    assert k["conversations"] == 2          # distinct deals with a human reply in 30d
    assert k["quotes"] == 1 and k["quotes_value"] == 1000
    assert k["collected"] == 2400
    assert k["sent"] == 4 and k["interested"] == 2 and k["interested_pct"] == 50.0


def test_agent_states():
    db = FakeDB()
    db.insert("agent_heartbeats", {"agent": "inbox", "last_run": iso(minutes=2), "status": "ok"})
    db.insert("agent_heartbeats", {"agent": "outbox", "last_run": iso(minutes=5), "status": "ok"})   # > 2x 1m: amber
    db.insert("agent_heartbeats", {"agent": "brief", "last_run": iso(hours=1), "status": "error"})
    rows, wd = data.agent_rows(db, NOW)
    st = {r["name"]: r["state"] for r in rows}
    assert st["inbox"] == "ok" and st["outbox"] == "amber" and st["brief"] == "red"
    assert st["prospector"] == "idle" and wd["text"] == "not set up"
    db.insert("agent_heartbeats", {"agent": "watchdog", "last_run": iso(minutes=3), "status": "ok"})
    assert data.agent_rows(db, NOW)[1]["state"] == "ok"
    sh = data.shell(db, NOW)
    assert sh["status"][0] == "red"


def test_spend_counts_since_pkt_midnight():
    db = FakeDB()
    for h in (1, 2, 20):  # 20h ago = yesterday in PKT
        db.insert("actions", {"agent": "inbox", "action": "llm_call", "at": iso(hours=h), "cost_usd": 0.5})
    n, cost = data.calls_today(db, NOW)
    assert n == 2 and cost == 1.0


def test_pipeline_grouping_and_stall_tones():
    db = FakeDB()
    co = db.insert("companies", {"name": "Acme", "domain": "acme.example"})[0]["id"]
    for stage, days in [("lead", 3), ("lead", 8), ("conversation", 15), ("won", 1), ("dormant", 90)]:
        db.insert("deals", {"company_id": co, "title": f"{stage}{days}", "stage": stage, "source_channel": "referral",
                            "updated_at": iso(days=days)})
    p = data.pipeline(db, NOW, None)
    assert [len(p["groups"][k]) for k in ("lead", "conversation", "won_lost", "dormant")] == [2, 1, 1, 1]
    tones = {r["title"]: r["tone"] for g in p["groups"].values() for r in g}
    assert tones == {"lead3": "", "lead8": "amber", "conversation15": "red", "won1": "", "dormant90": "red"}
    assert data.pipeline(db, NOW, "inbound")["total"] == 0
