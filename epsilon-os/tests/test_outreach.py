"""Outreach sender, offline: fake DB, fake outreach mailbox, no keychain."""
import smtplib
from datetime import datetime, timedelta, timezone

import pytest

from agents import outbox, outreach
from core import config, settings
from tests.fakes import FakeDB, FakeMail

ADDR = "ehab@epsilon-outreach.example"
NOW = datetime.now(timezone.utc)


def box_factory(box):
    return lambda addr: box


def missing_secret(addr):
    raise config.SecretError("no keychain item")


@pytest.fixture
def db():
    d = FakeDB()
    settings.set(d, "outreach.address", ADDR)
    return d


def outbound(db, i=1, kind="outbound", status="approved", ago=60, held=False, to=None, **kw):
    co = db.insert("companies", {"name": f"Co{i}", "domain": f"co{i}.example.com"})[0]
    ct = db.insert("contacts", {"company_id": co["id"], "email": to or f"info@co{i}.example.com"})[0]
    dl = db.insert("deals", {"company_id": co["id"], "primary_contact_id": ct["id"], "title": "t", "source_channel": "outbound"})[0]
    row = db.insert("approval_queue", {
        "agent": "prospector", "kind": kind, "deal_id": dl["id"], "contact_id": ct["id"], "draft": "Hi,\n\nBody.\n\nEhab\n\nReply 'stop' and I won't write again.",
        "status": status, "to_email": ct["email"], "subject": f"Subject {i}", "held": held,
        "decided_at": (NOW - timedelta(seconds=ago)).isoformat(), **kw})[0]
    return row, co


def go(db, box, now=NOW):
    return outreach.run(db, now, box_factory(box) if box is not None else missing_secret)


def test_not_configured_without_address_sends_nothing(db):
    row, _ = outbound(db)
    db.update("settings", {"value": ""}, key="outreach.address")
    box = FakeMail()
    r = go(db, box)
    assert r["state"] == "not configured" and box.sent == []
    assert db.rows("approval_queue")[0]["status"] == "approved"
    assert db.rows("agent_heartbeats", agent="outreach")[-1]["detail"]["state"] == "not configured"


def test_not_configured_without_keychain_item(db):
    outbound(db)
    r = go(db, None)
    assert r["state"] == "not configured"
    assert db.rows("approval_queue")[0]["status"] == "approved"


def test_sends_from_outreach_domain_and_records_everything(db):
    row, co = outbound(db)
    box = FakeMail()
    r = go(db, box)
    assert r["sent"] == 1 and len(box.sent) == 1
    f = box.sent[0]
    assert f["to"] == row["to_email"] and f["subject"] == "Subject 1" and f["message_id"].endswith("@epsilon-outreach.example>")
    q = db.rows("approval_queue")[0]
    assert q["status"] == "sent" and q["sent_message_id"] == f["message_id"]
    t = db.rows("touches")[0]
    assert t["type"] == "sent" and t["direction"] == "outbound" and t["message_id"] == f["message_id"]
    assert db.rows("companies", id=co["id"])[0]["last_contacted_at"] is not None
    assert db.rows("actions", action="outreach_sent")
    assert settings.started_on(db) == NOW.astimezone(outreach.PKT).date()
    assert db.rows("agent_heartbeats", agent="outreach")[-1]["status"] == "ok"


def test_only_outbound_kind_approved_past_undo_not_held(db):
    outbound(db, 1, kind="reply")
    outbound(db, 2, ago=3)                 # inside the 10 s undo window
    outbound(db, 3, held=True)
    outbound(db, 4, status="pending")
    outbound(db, 5, status="rejected")
    ok_row, _ = outbound(db, 6, status="edited_approved", final_text="Edited body.\n\nReply 'stop' and I won't write again.")
    box = FakeMail()
    r = go(db, box)
    assert r["sent"] == 1 and [f["to"] for f in box.sent] == [ok_row["to_email"]]
    assert box.sent[0]["body"].startswith("Edited body.")
    assert db.rows("approval_queue", kind="reply")[0]["status"] == "approved"   # untouched (outbox's job)


def test_first_day_cap_is_ramp_start_and_resets_next_run(db):
    for i in range(8):
        outbound(db, i)
    box = FakeMail()
    r = go(db, box)
    assert r["sent"] == 5 and len(db.rows("approval_queue", status="approved")) == 3
    again = go(db, box)
    assert again["sent"] == 0 and again["state"] == "cap reached" and len(box.sent) == 5
    # the next PKT day starts a fresh count; the ramp is still 5 on day 1, and 3 are left
    r3 = go(db, box, NOW + timedelta(days=1))
    assert r3["sent"] == 3 and r3["cap"] == 5


def test_next_pkt_day_sends_again_with_ramp_math(db):
    start = NOW - timedelta(days=7)
    settings.set(db, "outreach.started_on", start.astimezone(outreach.PKT).date().isoformat())
    for i in range(30):
        outbound(db, i)
    box = FakeMail()
    r = go(db, box)
    # 7 days since start, every 3 days: 5 + 5*2 = 15
    assert r["sent"] == 15 and r["cap"] == 15
    assert go(db, box)["state"] == "cap reached"
    later = go(db, box, NOW + timedelta(days=2))  # day 9 since start: 5 + 5*3 = 20; 15 rows are left
    assert later["cap"] == 20 and later["sent"] == 15


def test_setting_cap_below_ramp_wins(db):
    settings.set(db, "outreach.started_on", (NOW - timedelta(days=30)).astimezone(outreach.PKT).date().isoformat())
    settings.set(db, "outreach.daily_cap", 3)
    for i in range(6):
        outbound(db, i)
    r = go(db, FakeMail())
    assert r["sent"] == 3 and r["cap"] == 3


def test_cap_zero_pauses_sending(db):
    settings.set(db, "outreach.daily_cap", 0)
    outbound(db)
    box = FakeMail()
    assert go(db, box)["state"] == "cap reached" and box.sent == []


def test_started_on_set_once_on_first_success_only(db):
    outbound(db, 1)
    go(db, FakeMail())
    first = settings.started_on(db)
    db.update("settings", {"value": "2026-01-01"}, key="outreach.started_on")
    outbound(db, 2)
    go(db, FakeMail(), NOW + timedelta(days=1))
    assert settings.started_on(db).isoformat() == "2026-01-01" and first is not None


def test_started_on_not_set_when_nothing_was_sent(db):
    outbound(db, 1, status="pending")
    go(db, FakeMail())
    assert settings.started_on(db) is None


def test_suppressed_after_approval_is_blocked(db):
    row, _ = outbound(db)
    db.insert("suppression_list", {"email": row["to_email"], "reason": "opt_out", "forever": True})
    box = FakeMail()
    r = go(db, box)
    assert r["suppressed"] == 1 and box.sent == []
    q = db.rows("approval_queue")[0]
    assert q["status"] == "failed" and "suppression" in q["send_error"]
    assert settings.started_on(db) is None


def test_definite_failure_marks_failed_ambiguous_stays_sending(db):
    outbound(db, 1)
    outbound(db, 2)
    box = FakeMail()
    box.fail_with = [smtplib.SMTPRecipientsRefused({"x": (550, b"no")}), TimeoutError("timed out")]
    r = go(db, box)
    assert r["failed"] == 1 and r["ambiguous"] == 1 and r["sent"] == 0
    statuses = sorted(q["status"] for q in db.rows("approval_queue"))
    assert statuses == ["failed", "sending"]
    assert db.rows("agent_heartbeats", agent="outreach")[-1]["status"] == "warn"
    # the ambiguous one is never blind-resent
    box2 = FakeMail()
    go(db, box2)
    assert box2.sent == []


def test_stale_sending_outbound_is_resolved_from_the_outreach_sent_folder(db):
    old = (NOW - timedelta(minutes=30)).isoformat()
    a, _ = outbound(db, 1, status="sending", claimed_at=old, sent_message_id="<a@epsilon-outreach.example>")
    b, _ = outbound(db, 2, status="sending", claimed_at=old, sent_message_id="<b@epsilon-outreach.example>")
    box = FakeMail()
    box.sent_folder.add("<a@epsilon-outreach.example>")
    r = go(db, box)
    assert r["stale_sent"] == 1 and r["stale_failed"] == 1
    assert db.rows("approval_queue", id=a["id"])[0]["status"] == "sent"
    assert db.rows("approval_queue", id=b["id"])[0]["status"] == "failed"
    assert db.rows("actions", agent="outreach", action="stale_resolved_sent")


def test_outbox_still_never_touches_outbound_rows(db):
    old = (NOW - timedelta(minutes=30)).isoformat()
    outbound(db, 1, status="sending", claimed_at=old, sent_message_id="<a@x>")
    outbound(db, 2)  # approved outbound
    m = FakeMail()
    r = outbox.run(db, m, NOW)
    assert m.sent == [] and r["stale_sent"] == r["stale_failed"] == r["stale_unchecked"] == 0
    assert {q["status"] for q in db.rows("approval_queue")} == {"sending", "approved"}


def test_status_reports_configuration_and_counts(db):
    outbound(db, 1)
    s = outreach.status(db, NOW, box_factory(FakeMail()))
    assert s["configured"] and s["cap"] == 5 and s["sent_today"] == 0 and s["address"] == ADDR
    go(db, FakeMail())
    assert outreach.status(db, NOW, box_factory(FakeMail()))["sent_today"] == 1
    s2 = outreach.status(db, NOW, missing_secret)
    assert not s2["configured"] and "keychain" in s2["reason"]
    db.update("settings", {"value": ""}, key="outreach.address")
    assert outreach.status(db, NOW, box_factory(FakeMail()))["reason"] == "no outreach address set"


def test_outreach_plist_and_install_list():
    import plistlib
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    p = plistlib.loads((root / "launchd/co.epsilon-labs.os.outreach.plist").read_bytes())
    assert p["StartInterval"] == 300 and p["ProgramArguments"][1:] == ["-m", "agents.run", "outreach"]
    q = plistlib.loads((root / "launchd/co.epsilon-labs.os.prospector.plist").read_bytes())
    assert q["StartCalendarInterval"] == {"Hour": 7, "Minute": 0} and q["ProgramArguments"][1:] == ["-m", "agents.run", "prospector"]
    assert "RunAtLoad" not in p and "RunAtLoad" not in q
    jobs = [l for l in (root / "scripts/install_jobs.sh").read_text().splitlines() if l.startswith("JOBS=")][0]
    assert "prospector" in jobs and "outreach" in jobs
