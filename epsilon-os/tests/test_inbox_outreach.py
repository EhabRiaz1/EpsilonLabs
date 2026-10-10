"""Inbox agent reading the outreach mailbox in triage mode, with a fake mail adapter."""
import pytest

from agents import inbox
from core import config, settings
from tests.fakes import FakeAsk, FakeDB, FakeMail, eml

OUT = "ehab@epsilon-outreach.example"
PROSPECT = "info@northmill.example"
SENT_MID = "<sent1@epsilon-outreach.example>"


@pytest.fixture
def db():
    d = FakeDB()
    settings.set(d, "outreach.address", OUT)
    return d


def seed_outbound(db, to=PROSPECT, mid=SENT_MID):
    co = db.insert("companies", {"name": "Northmill", "domain": "northmill.example"})[0]
    ct = db.insert("contacts", {"company_id": co["id"], "email": to})[0]
    dl = db.insert("deals", {"company_id": co["id"], "primary_contact_id": ct["id"], "title": "Outbound: x",
                             "source_channel": "outbound", "stage": "lead"})[0]
    db.insert("approval_queue", {"agent": "prospector", "kind": "outbound", "deal_id": dl["id"], "contact_id": ct["id"],
                                 "draft": "d", "status": "sent", "to_email": to, "subject": "Hello",
                                 "sent_message_id": mid})
    return co, ct, dl


def outreach_box(*raw):
    box = FakeMail()
    for r in raw:
        box.add_raw(r)
    return box


def run(db, box, er=None):
    return inbox.run(db, er or FakeMail(), FakeAsk(), outreach_mail=box)


def reply(mid="<r1@northmill.example>", body="Yes, we are interested. Can we talk Thursday?", frm=f"Ian <{PROSPECT}>",
          **h):
    return eml(frm, "Re: Hello", body, mid, **{"In-Reply-To": SENT_MID, "References": SENT_MID, **h})


def test_reply_to_outreach_is_triaged_onto_the_outbound_deal_without_an_ack(db):
    co, ct, dl = seed_outbound(db)
    r = run(db, outreach_box(reply()))
    assert r["outreach_fetched"] == 1 and r["processed"] == 1 and r["errors"] == 0
    t = db.rows("touches")[0]
    assert t["type"] == "human_reply" and t["deal_id"] == dl["id"] and t["contact_id"] == ct["id"]
    assert len(db.rows("deals")) == 1                      # no new deal: it attached to the outbound one
    drafts = db.rows("approval_queue", status="pending")
    assert [d["kind"] for d in drafts] == ["outbound"]  # replies on outreach threads go out from the outreach mailbox        # no first-contact ack for a reply to our send
    assert db.rows("touches")[0]["classifier"]["triage"] is True


def test_known_contact_without_threading_headers_is_still_triaged(db):
    seed_outbound(db)
    raw = eml(f"Ian <{PROSPECT}>", "Hello again", "Following up on your note, yes please.", "<r2@northmill.example>")
    r = run(db, outreach_box(raw))
    assert r["processed"] == 1 and [d["kind"] for d in db.rows("approval_queue", status="pending")] == ["outbound"]  # replies on outreach threads go out from the outreach mailbox


def test_unknown_sender_without_thread_is_skipped_not_acked(db):
    seed_outbound(db)
    raw = eml("Rando <rando@elsewhere.example>", "Buy my SEO", "We rank sites.", "<spam@elsewhere.example>")
    r = run(db, outreach_box(raw))
    assert r["skipped_mode"] == 1 and r["processed"] == 0
    assert db.rows("touches") == [] and db.rows("approval_queue", status="pending") == []


def test_opt_out_on_outreach_mailbox_suppresses_and_confirms(db):
    co, ct, dl = seed_outbound(db)
    raw = reply("<stop1@northmill.example>", "Please unsubscribe me.")
    r = run(db, outreach_box(raw))
    assert r["opt_outs"] == 1
    assert db.rows("suppression_list")[0]["email"] == PROSPECT and db.rows("contacts")[0]["opted_out"] is True
    assert [d["kind"] for d in db.rows("approval_queue", status="pending")] == ["optout_confirm"]


def test_hard_bounce_on_outreach_mailbox_suppresses_the_prospect_not_us(db):
    seed_outbound(db)
    raw = eml("Mail Delivery Subsystem <MAILER-DAEMON@mail.example>", "Delivery Status Notification (Failure)",
              f"550 5.1.1 The email account does not exist:\n{PROSPECT}\nsent from {OUT}", "<bn1@x>",
              **{"Return-Path": "<>"})
    r = run(db, outreach_box(raw))
    assert r["bounces"] == 1
    assert [s["email"] for s in db.rows("suppression_list")] == [PROSPECT]
    assert db.rows("approval_queue", status="pending") == []


def test_auto_reply_and_own_address_are_handled_by_the_guard(db):
    seed_outbound(db)
    ooo = reply("<ooo@northmill.example>", "I am out of the office until Monday.")
    me = eml(f"Me <{OUT}>", "note to self", "test", "<self@epsilon-outreach.example>")
    r = run(db, outreach_box(ooo, me))
    assert r["auto_replies"] == 1 and r["processed"] == 2
    kinds = sorted((t["type"], t["direction"]) for t in db.rows("touches"))
    assert kinds == [("auto_reply", "inbound"), ("human_reply", "internal")]
    assert db.rows("approval_queue", status="pending") == []


def test_suppressed_sender_on_outreach_mailbox_gets_no_draft(db):
    seed_outbound(db)
    db.insert("suppression_list", {"email": PROSPECT, "reason": "opt_out", "forever": True})
    r = run(db, outreach_box(reply()))
    assert db.rows("approval_queue", status="pending") == [] and r["errors"] == 0


def test_same_message_in_both_passes_is_processed_once(db):
    seed_outbound(db)
    raw = reply()
    box, er = outreach_box(raw), FakeMail()
    er.add_raw(raw)
    r = run(db, box, er)
    assert len(db.rows("touches")) == 1 and r["duplicates"] == 1


def test_no_outreach_mailbox_means_no_second_fetch(db):
    r = inbox.run(db, FakeMail(), FakeAsk(), outreach_mail=None)
    assert r["outreach_fetched"] == 0 and r["outreach_fetch_failed"] == 0


def test_auto_mode_needs_both_setting_and_keychain(db, monkeypatch):
    def no_item(service, account):
        raise config.SecretError("missing")
    monkeypatch.setattr(config, "secret", no_item)
    from core import mail
    monkeypatch.setattr(mail, "outreach_mailbox", lambda a, secret=config.secret: mail.Mailbox(a, no_item("s", a)))
    r = inbox.run(db, FakeMail(), FakeAsk())          # address is set but the keychain item is missing
    assert r["outreach_fetched"] == 0 and r["errors"] == 0
    empty = FakeDB()
    assert inbox.run(empty, FakeMail(), FakeAsk())["outreach_fetched"] == 0


def test_broken_outreach_mailbox_only_warns_and_er_still_runs(db):
    class Down(FakeMail):
        def fetch_new(self, since_days=3):
            raise OSError("imap down")
    er = FakeMail()
    er.add_raw(eml("Bilal <bilal@northstarfuels.example>", "Forecourts", "We run six petrol stations.", "<m1@n.example>"))
    r = inbox.run(db, er, FakeAsk(), outreach_mail=Down())
    assert r["outreach_fetch_failed"] == 1 and r["processed"] == 1
    assert db.rows("agent_heartbeats", agent="inbox")[-1]["status"] == "warn"


def test_er_mailbox_behaviour_unchanged_when_outreach_is_set(db):
    er = FakeMail()
    er.add_raw(eml("Bilal <bilal@northstarfuels.example>", "Forecourts", "We run six petrol stations.", "<m1@n.example>"))
    r = inbox.run(db, er, FakeAsk(), outreach_mail=outreach_box())
    assert r["processed"] == 1 and sorted(d["kind"] for d in db.rows("approval_queue")) == ["ack", "reply"]


def test_not_now_reply_parks_the_deal_stops_the_sequence_and_queues_one_courteous_note(db):
    co, ct, dl = seed_outbound(db)
    ask = FakeAsk(classify={PROSPECT: {"label": "not_now", "wedge": "NA"}})
    inbox.run(db, FakeMail(), ask, outreach_mail=outreach_box(reply(body="Not right now, but we'll keep your info on file.")))
    t = db.rows("touches")[0]
    assert t["type"] == "human_reply" and t["classifier"]["label"] == "not_now" and t["deal_id"] == dl["id"]
    assert db.rows("deals")[0]["stage"] == "dormant"
    drafts = db.rows("approval_queue", status="pending")
    assert len(drafts) == 1 and "Understood, and thanks for letting me know" in drafts[0]["draft"]
    assert "call" not in drafts[0]["draft"].lower()          # no pitch in a close-the-loop note
    # a second polite reply ("thanks, will do") gets no second note
    inbox.run(db, FakeMail(), ask, outreach_mail=outreach_box(reply(mid="<r2@northmill.example>", body="Thanks, will do.")))
    assert len(db.rows("approval_queue", status="pending")) == 1


def test_not_interested_reply_marks_the_deal_lost(db):
    co, ct, dl = seed_outbound(db)
    ask = FakeAsk(classify={PROSPECT: {"label": "not_interested", "wedge": "NA"}})
    inbox.run(db, FakeMail(), ask, outreach_mail=outreach_box(reply(body="No thanks, we have this covered in-house.")))
    d = db.rows("deals")[0]
    assert d["stage"] == "lost" and d["lost_reason"] == "not interested"
