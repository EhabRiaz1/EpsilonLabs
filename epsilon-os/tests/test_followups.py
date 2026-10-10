"""3-touch follow-up sequence, offline: fake DB, fake mail, scripted LLM (0 real claude calls)."""
from datetime import datetime, timedelta, timezone

import pytest

from agents import followups, inbox, outreach
from agents import run as runner
from core import llm, settings
from dashboard import data, views
from prompts import loader
from tests.fakes import FakeAsk, FakeDB, FakeMail, eml

OUT = "ehab@epsilon-outreach.example"
UTC = timezone.utc
SENT = datetime(2026, 10, 12, 5, 0, tzinfo=UTC)          # Monday 10:00 PKT, the day-0 send
PKT = followups.PKT
BODY = ("Hi Sana,\n\nOne concrete thing we do for lines like yours is decode the PLC bus protocol so you can read "
        "it in your own tools.\n\nWorth 20 minutes, or say no.\n\nEhab\n\nReply 'stop' and I won't write again.")
REAL = datetime.now(UTC)


def at_pkt(day: int, hour: int, minute: int = 0) -> datetime:
    """PKT wall-clock time `day` calendar days after the day-0 send's PKT date."""
    base = SENT.astimezone(PKT).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return (base + timedelta(days=day)).astimezone(UTC)


class FakeLLM:
    def __init__(self, body=BODY, budget_after=None, error=None):
        self.calls, self.body, self.budget_after, self.error = [], body, budget_after, error

    def ask(self, db, agent, run_id, system, untrusted, schema, model="haiku", timeout=120):
        if self.budget_after is not None and len(self.calls) >= self.budget_after:
            raise llm.BudgetExceeded("budget")
        if self.error:
            raise self.error
        self.calls.append({"system": system, "untrusted": untrusted, "model": model, "schema": schema})
        return {"body": self.body, "notes": ""}, {}


@pytest.fixture
def db():
    d = FakeDB()
    settings.set(d, "outreach.address", OUT)
    return d


def send_row(db, row, mid, when):
    """Mark an approval_queue row as sent at `when`, the way the outreach sender records it."""
    db.update("approval_queue", {"status": "sent", "sent_message_id": mid, "claimed_at": when.isoformat()}, id=row["id"])
    db.insert("touches", {"type": "sent", "direction": "outbound", "message_id": mid, "occurred_at": when.isoformat(),
                          "deal_id": row.get("deal_id"), "contact_id": row.get("contact_id")}, returning=False)


def seed(db, i=1, sent=SENT, stage="lead"):
    co = db.insert("companies", {"name": f"Acme {i}", "domain": f"acme{i}.example.com", "country": "US",
                                 "notes": "Prospector (industrial): Hiring a PLC engineer."})[0]
    ct = db.insert("contacts", {"company_id": co["id"], "email": f"info@acme{i}.example.com",
                                "full_name": "Sana Qureshi", "role": "Engineering lead"})[0]
    dl = db.insert("deals", {"company_id": co["id"], "primary_contact_id": ct["id"], "title": "Outbound: x",
                             "source_channel": "outbound", "stage": stage})[0]
    row = db.insert("approval_queue", {
        "agent": "prospector", "kind": "outbound", "deal_id": dl["id"], "contact_id": ct["id"], "draft": "First email.",
        "status": "approved", "to_email": ct["email"], "subject": "Packing line data", "sequence_step": 1})[0]
    send_row(db, row, f"<s1-{i}@epsilon-outreach.example>", sent)
    db.insert("actions", {"agent": "prospector", "action": "draft_queued", "target_id": row["id"],
                          "detail": {"offer": "protocol-decode"}}, returning=False)
    return {"co": co, "ct": ct, "dl": dl, "first": db.rows("approval_queue", id=row["id"])[0], "mid": f"<s1-{i}@epsilon-outreach.example>"}


def steps(db, n=None):
    rows = [r for r in db.rows("approval_queue") if r.get("sequence_step") and r["sequence_step"] >= 2]
    return rows if n is None else [r for r in rows if r["sequence_step"] == n]


def go(db, fake=None, now=None):
    return followups.run(db, fake or FakeLLM(), now or at_pkt(4, 9))


def inbound(db, s, type_="human_reply", when=None, **kw):
    return db.insert("touches", {"type": type_, "direction": "inbound", "contact_id": s["ct"]["id"],
                                 "deal_id": s["dl"]["id"], "message_id": f"<in-{type_}-{len(db.rows('touches'))}@x>",
                                 "occurred_at": (when or at_pkt(1, 12)).isoformat(), **kw})[0]


# ---------------------------------------------------------------- timing

def test_step2_is_due_on_the_fourth_pkt_calendar_day_and_not_before(db):
    seed(db)
    fake = FakeLLM()
    r = go(db, fake, at_pkt(3, 23, 59))               # day 3, one minute before PKT midnight
    assert r["created"] == 0 and r["waiting"] == 1 and fake.calls == [] and steps(db) == []
    r = go(db, fake, at_pkt(4, 0, 0))                 # day 4, 00:00 PKT
    assert r["created"] == 1 and len(fake.calls) == 1
    row = steps(db, 2)[0]
    assert row["status"] == "pending" and row["kind"] == "outbound" and row["sequence_step"] == 2


def test_step3_is_due_five_days_after_step2_was_sent(db):
    s = seed(db)
    go(db, now=at_pkt(4, 9))
    two = steps(db, 2)[0]
    send_row(db, two, "<s2@epsilon-outreach.example>", at_pkt(4, 15))      # founder approved it, sent on day 4
    fake = FakeLLM()
    r = go(db, fake, at_pkt(8, 23, 59))
    assert r["created"] == 0 and fake.calls == []
    r = go(db, fake, at_pkt(9, 0, 0))
    assert r["created"] == 1
    three = steps(db, 3)[0]
    assert three["sequence_parent"] == s["first"]["id"] and three["status"] == "pending"
    assert go(db, fake, at_pkt(20, 9))["created"] == 0                       # nothing after step 3


def test_step3_waits_while_step2_is_unsent_or_rejected(db):
    seed(db)
    go(db, now=at_pkt(4, 9))
    fake = FakeLLM()
    assert go(db, fake, at_pkt(10, 9))["created"] == 0                        # step 2 still pending
    db.update("approval_queue", {"status": "rejected"}, id=steps(db, 2)[0]["id"])
    assert go(db, fake, at_pkt(10, 9))["created"] == 0 and steps(db, 3) == [] and fake.calls == []


def test_only_sent_prospector_first_touches_start_a_sequence(db):
    s = seed(db)
    seed(db, 2)
    db.update("approval_queue", {"status": "approved"}, id=s["first"]["id"])           # not sent yet
    inbox_reply = db.insert("approval_queue", {"agent": "inbox", "kind": "outbound", "draft": "x", "status": "sent",
                                               "to_email": "a@b.example", "sent_message_id": "<r@x>",
                                               "claimed_at": SENT.isoformat()})[0]
    r = go(db)
    assert r["firsts"] == 1 and r["created"] == 1
    assert steps(db)[0]["to_email"] == "info@acme2.example.com" and inbox_reply["status"] == "sent"


def test_a_very_overdue_step_is_dropped_not_sent_late(db):
    seed(db)
    r = go(db, now=at_pkt(4 + followups.STALE_DAYS + 1, 9))
    assert r["stale"] == 1 and r["created"] == 0


# ---------------------------------------------------------------- the draft

def test_draft_threading_subject_and_headers_chain(db):
    s = seed(db)
    go(db, now=at_pkt(4, 9))
    two = steps(db, 2)[0]
    assert two["subject"] == "Re: Packing line data"
    assert two["in_reply_to_message_id"] == s["mid"] and two["references_hdr"] == s["mid"]
    assert two["sequence_parent"] == s["first"]["id"] and two["to_email"] == s["ct"]["email"]
    assert two["contact_id"] == s["ct"]["id"] and two["deal_id"] == s["dl"]["id"] and two["agent"] == "followups"
    send_row(db, two, "<s2@epsilon-outreach.example>", at_pkt(4, 15))
    go(db, now=at_pkt(9, 9))
    three = steps(db, 3)[0]
    assert three["subject"] == "Re: Packing line data"                        # never "Re: Re:"
    assert three["in_reply_to_message_id"] == "<s2@epsilon-outreach.example>"
    assert three["references_hdr"] == f"{s['mid']} <s2@epsilon-outreach.example>"
    assert three["sequence_parent"] == s["first"]["id"]


def test_llm_call_is_tool_less_sonnet_with_the_right_rules_and_offer(db):
    seed(db)
    fake = FakeLLM()
    go(db, fake)
    c = fake.calls[0]
    assert c["model"] == "sonnet" and "body" in c["schema"]["properties"]
    assert "follow-up 2" in c["system"] and "At most 70 words" in c["system"] and "close-the-loop" not in c["system"]
    assert loader.offer_detail("protocol-decode").splitlines()[0] in c["system"]
    assert "first name: Sana" in c["system"] and "First email." in c["untrusted"]
    assert "Reply 'stop'" in c["system"]


def test_step3_prompt_is_the_close_the_loop_one(db):
    seed(db)
    go(db, now=at_pkt(4, 9))
    send_row(db, steps(db, 2)[0], "<s2@epsilon-outreach.example>", at_pkt(4, 15))
    fake = FakeLLM()
    go(db, fake, at_pkt(9, 9))
    assert "follow-up 3" in fake.calls[0]["system"] and "At most 50 words" in fake.calls[0]["system"]
    assert "close-the-loop" in fake.calls[0]["system"]


def test_opt_out_line_is_forced_and_clean_draft_is_not_held(db):
    seed(db)
    go(db, FakeLLM(body="Hi Sana,\n\nOne deliverable: a protocol map.\n\nEhab"))
    row = steps(db, 2)[0]
    assert row["draft"].endswith("Reply 'stop' and I won't write again.") and row["held"] is False


def test_lint_red_and_over_length_drafts_are_held(db):
    seed(db)
    seed(db, 2)
    seed(db, 3)
    bodies = iter([BODY.replace("Worth", "It costs $4,000. Worth"),
                   "Hi Sana,\n\n" + " ".join(["word"] * 80) + "\n\nEhab",
                   BODY])

    class Seq(FakeLLM):
        def ask(self, *a, **k):
            self.body = next(bodies)
            return super().ask(*a, **k)
    r = go(db, Seq())
    assert r["created"] == 3 and r["held"] == 2
    held = {x["to_email"]: x for x in steps(db, 2)}
    assert held["info@acme1.example.com"]["held"] and "price" in held["info@acme1.example.com"]["held_reason"]
    assert held["info@acme2.example.com"]["held"] and "words (limit 80)" in held["info@acme2.example.com"]["held_reason"]
    assert held["info@acme3.example.com"]["held"] is False


def test_budget_exceeded_stops_the_run_and_warns(db):
    seed(db)
    seed(db, 2)
    fake = FakeLLM(budget_after=1)
    r = go(db, fake)
    assert r["created"] == 1 and r["budget_exceeded"] is True
    assert db.rows("agent_heartbeats", agent="followups")[-1]["status"] == "warn"
    assert go(db, FakeLLM())["created"] == 1                                   # the next run picks the rest up


def test_llm_error_is_logged_and_retried_next_run(db):
    seed(db)
    r = go(db, FakeLLM(error=llm.LLMError("boom")))
    assert r["draft_failed"] == 1 and r["created"] == 0 and db.rows("actions", action="followup_draft_failed")
    assert go(db)["created"] == 1


def test_heartbeat_and_actions_are_written(db):
    seed(db)
    go(db)
    hb = db.rows("agent_heartbeats", agent="followups")[-1]
    assert hb["status"] == "ok" and hb["detail"]["created"] == 1
    assert db.rows("actions", action="draft_queued", agent="followups") and db.rows("actions", action="followups_run")


def test_idempotent_two_runs_one_draft_even_after_reject(db):
    seed(db)
    go(db)
    assert go(db)["created"] == 0 and len(steps(db)) == 1
    db.update("approval_queue", {"status": "rejected"}, id=steps(db)[0]["id"])
    assert go(db)["created"] == 0 and len(steps(db)) == 1


# ---------------------------------------------------------------- stop rules

@pytest.mark.parametrize("type_", ["human_reply", "opt_out", "bounce"])
def test_inbound_reply_optout_or_bounce_since_the_first_send_stops_the_sequence(db, type_):
    s = seed(db)
    inbound(db, s, type_)
    fake = FakeLLM()
    r = go(db, fake)
    assert r["created"] == 0 and r["stopped"] == 1 and fake.calls == []
    assert db.rows("actions", action="followup_skipped")[0]["detail"]["reason"] == f"inbound {type_}"
    go(db, fake)
    assert len(db.rows("actions", action="followup_skipped")) == 1            # logged once, not every hour


def test_reply_matched_by_deal_only_also_stops(db):
    s = seed(db)
    db.insert("touches", {"type": "human_reply", "direction": "inbound", "deal_id": s["dl"]["id"],
                          "message_id": "<d@x>", "occurred_at": at_pkt(1, 9).isoformat()})
    assert go(db)["created"] == 0


def test_out_of_office_auto_reply_does_not_stop_it(db):
    s = seed(db)
    inbound(db, s, "auto_reply")
    assert go(db)["created"] == 1


def test_inbound_before_the_first_send_does_not_count(db):
    s = seed(db)
    inbound(db, s, "human_reply", when=SENT - timedelta(days=3))
    assert go(db)["created"] == 1


def test_opted_out_contact_stops_it(db):
    s = seed(db)
    db.update("contacts", {"opted_out": True}, id=s["ct"]["id"])
    assert go(db)["created"] == 0


def test_suppressed_address_stops_it(db):
    s = seed(db)
    db.insert("suppression_list", {"email": s["ct"]["email"], "reason": "hard_bounce", "forever": True})
    r = go(db)
    assert r["created"] == 0 and r["stopped"] == 1


@pytest.mark.parametrize("stage", ["conversation", "scoping_call", "quote_out", "lost", "won", "dormant"])
def test_deal_that_left_lead_stops_it(db, stage):
    s = seed(db)
    db.update("deals", {"stage": stage}, id=s["dl"]["id"])
    assert go(db)["created"] == 0


def test_a_reply_after_step2_stops_step3(db):
    s = seed(db)
    go(db, now=at_pkt(4, 9))
    send_row(db, steps(db, 2)[0], "<s2@epsilon-outreach.example>", at_pkt(4, 15))
    inbound(db, s, "human_reply", when=at_pkt(6, 9))
    assert go(db, now=at_pkt(9, 9))["created"] == 0 and steps(db, 3) == []


# ---------------------------------------------------------------- inbox: auto-stop on reply

def two_drafts(db, s, status="pending"):
    go(db, now=at_pkt(4, 9))
    row = steps(db, 2)[0]
    db.update("approval_queue", {"status": status}, id=row["id"])
    return row


def run_inbox(db, *raw):
    box = FakeMail()
    for r in raw:
        box.add_raw(r)
    return inbox.run(db, FakeMail(), FakeAsk(), outreach_mail=box)


def reply_mail(frm, body="Yes, interested. Thursday?", mid="<r1@acme1.example.com>", s_mid="<s1-1@epsilon-outreach.example>"):
    return eml(frm, "Re: Packing line data", body, mid, **{"In-Reply-To": s_mid, "References": s_mid})


@pytest.mark.parametrize("status", ["pending", "approved", "edited_approved"])
def test_inbox_reply_expires_pending_and_approved_followups(db, status):
    s = seed(db)
    row = two_drafts(db, s, status)
    run_inbox(db, reply_mail("Sana <info@acme1.example.com>"))
    assert db.rows("approval_queue", id=row["id"])[0]["status"] == "expired"
    a = db.rows("actions", action="sequence_expired")
    assert len(a) == 1 and a[0]["target_id"] == row["id"] and a[0]["detail"]["reason"] == "human_reply"
    assert go(db, now=at_pkt(9, 9))["created"] == 0


def test_inbox_reply_from_a_colleague_on_the_thread_still_stops_via_the_deal(db):
    s = seed(db)
    row = two_drafts(db, s)
    run_inbox(db, reply_mail("Ian <ian@acme1.example.com>"))
    assert db.rows("approval_queue", id=row["id"])[0]["status"] == "expired"


def test_inbox_opt_out_expires_followups(db):
    s = seed(db)
    row = two_drafts(db, s, "approved")
    run_inbox(db, reply_mail("Sana <info@acme1.example.com>", "Please unsubscribe me."))
    assert db.rows("approval_queue", id=row["id"])[0]["status"] == "expired"
    assert db.rows("contacts", id=s["ct"]["id"])[0]["opted_out"] is True


def test_inbox_bounce_is_linked_to_the_contact_and_expires_followups(db):
    s = seed(db)
    row = two_drafts(db, s, "approved")
    bounce = eml("Mail Delivery Subsystem <MAILER-DAEMON@mail.example>", "Delivery Status Notification (Failure)",
                 f"550 5.1.1 The email account does not exist:\n{s['ct']['email']}\nsent from {OUT}", "<bn1@x>",
                 **{"Return-Path": "<>"})
    run_inbox(db, bounce)
    t = [x for x in db.rows("touches") if x["type"] == "bounce"][0]
    assert t["contact_id"] == s["ct"]["id"]
    assert db.rows("approval_queue", id=row["id"])[0]["status"] == "expired"


def test_inbox_auto_reply_leaves_followups_alone(db):
    s = seed(db)
    row = two_drafts(db, s, "approved")
    ooo = eml("Sana <info@acme1.example.com>", "Out of office", "I am away until Monday.", "<ooo@x>",
              **{"Auto-Submitted": "auto-replied", "In-Reply-To": s["mid"], "References": s["mid"]})
    run_inbox(db, ooo)
    assert db.rows("approval_queue", id=row["id"])[0]["status"] == "approved"


def test_inbox_reply_from_someone_else_leaves_other_sequences_alone(db):
    s1, s2 = seed(db), seed(db, 2)
    go(db, now=at_pkt(4, 9))
    run_inbox(db, reply_mail("Sana <info@acme1.example.com>"))
    states = {r["to_email"]: r["status"] for r in steps(db, 2)}
    assert states == {"info@acme1.example.com": "expired", "info@acme2.example.com": "pending"}


# ---------------------------------------------------------------- outreach sender

def approved_followup(db, s, step=2, ago=60, **kw):
    return db.insert("approval_queue", {
        "agent": "followups", "kind": "outbound", "deal_id": s["dl"]["id"], "contact_id": s["ct"]["id"],
        "draft": BODY, "status": "approved", "to_email": s["ct"]["email"], "subject": "Re: Packing line data",
        "in_reply_to_message_id": s["mid"], "references_hdr": s["mid"], "sequence_step": step,
        "sequence_parent": s["first"]["id"], "decided_at": (REAL - timedelta(seconds=ago)).isoformat(), **kw})[0]


def approved_first(db, i, ago=3600):
    s = seed(db, i, sent=REAL - timedelta(days=10))
    first = db.insert("approval_queue", {
        "agent": "prospector", "kind": "outbound", "draft": "Hi,\n\nBody.\n\nEhab\n\nReply 'stop' and I won't write again.",
        "status": "approved", "to_email": f"new{i}@other{i}.example.com", "subject": f"New {i}", "sequence_step": 1,
        "decided_at": (REAL - timedelta(seconds=ago)).isoformat()})[0]
    return s, first


def send_run(db, box):
    return outreach.run(db, REAL, lambda a: box)


def test_sender_sends_a_followup_with_threading_headers(db):
    s = seed(db, sent=REAL - timedelta(days=5))
    f = approved_followup(db, s)
    box = FakeMail()
    r = send_run(db, box)
    assert r["sent"] == 1 and box.sent[0]["in_reply_to"] == s["mid"] and box.sent[0]["references"] == s["mid"]
    assert box.sent[0]["subject"] == "Re: Packing line data"
    assert db.rows("approval_queue", id=f["id"])[0]["status"] == "sent"


def test_followups_go_first_and_share_the_daily_cap(db):
    settings.set(db, "outreach.daily_cap", 2)
    firsts = [approved_first(db, i, ago=7200 + i)[1] for i in (1, 2)]               # approved earlier
    fu = []
    for i in (3, 4):
        s = seed(db, i, sent=REAL - timedelta(days=5))
        fu.append(approved_followup(db, s, ago=60))                                  # approved later
    box = FakeMail()
    r = send_run(db, box)
    assert r["sent"] == 2 and sorted(f["subject"] for f in box.sent) == ["Re: Packing line data"] * 2
    assert {db.rows("approval_queue", id=f["id"])[0]["status"] for f in fu} == {"sent"}
    assert {db.rows("approval_queue", id=f["id"])[0]["status"] for f in firsts} == {"approved"}
    r = send_run(db, box)
    assert r["state"] == "cap reached" and len(box.sent) == 2                         # one shared cap


def test_first_touches_use_what_the_followups_leave_of_the_cap(db):
    settings.set(db, "outreach.daily_cap", 3)
    _, f1 = approved_first(db, 1, ago=7200)
    _, f2 = approved_first(db, 2, ago=7100)
    s = seed(db, 3, sent=REAL - timedelta(days=5))
    approved_followup(db, s)
    box = FakeMail()
    r = send_run(db, box)
    assert r["sent"] == 3 and box.sent[0]["subject"] == "Re: Packing line data"
    assert [x["subject"] for x in box.sent[1:]] == ["New 1", "New 2"]


def test_approved_step2_is_not_sent_if_a_reply_arrived_after_approval(db):
    s = seed(db, sent=REAL - timedelta(days=5))
    f = approved_followup(db, s, ago=3600)
    db.insert("touches", {"type": "human_reply", "direction": "inbound", "contact_id": s["ct"]["id"],
                          "message_id": "<late@x>", "occurred_at": (REAL - timedelta(minutes=5)).isoformat()})
    box = FakeMail()
    r = send_run(db, box)
    assert r["sent"] == 0 and r["stopped"] == 1 and box.sent == []
    assert db.rows("approval_queue", id=f["id"])[0]["status"] == "expired"
    assert db.rows("approval_queue", id=f["id"])[0].get("sent_message_id") is None  # never claimed
    assert db.rows("actions", action="sequence_expired")[0]["detail"]["at"] == "send"


@pytest.mark.parametrize("what", ["opt_out_flag", "deal_moved", "bounce_touch"])
def test_sender_rechecks_every_stop_rule_right_before_the_claim(db, what):
    s = seed(db, sent=REAL - timedelta(days=5))
    f = approved_followup(db, s)
    if what == "opt_out_flag":
        db.update("contacts", {"opted_out": True}, id=s["ct"]["id"])
    elif what == "deal_moved":
        db.update("deals", {"stage": "conversation"}, id=s["dl"]["id"])
    else:
        db.insert("touches", {"type": "bounce", "direction": "inbound", "contact_id": s["ct"]["id"],
                              "message_id": "<b@x>", "occurred_at": (REAL - timedelta(minutes=1)).isoformat()})
    box = FakeMail()
    r = send_run(db, box)
    assert box.sent == [] and r["stopped"] == 1 and db.rows("approval_queue", id=f["id"])[0]["status"] == "expired"


def test_a_stopped_followup_does_not_use_up_the_cap(db):
    settings.set(db, "outreach.daily_cap", 1)
    s = seed(db, sent=REAL - timedelta(days=5))
    approved_followup(db, s)
    db.update("contacts", {"opted_out": True}, id=s["ct"]["id"])
    _, first = approved_first(db, 2)
    box = FakeMail()
    r = send_run(db, box)
    assert r["sent"] == 1 and box.sent[0]["subject"] == "New 2"


def test_held_followups_are_never_sent(db):
    s = seed(db, sent=REAL - timedelta(days=5))
    approved_followup(db, s, held=True)
    assert send_run(db, FakeMail())["sent"] == 0


def test_followup_send_records_a_touch_that_times_the_next_step(db):
    s = seed(db, sent=REAL - timedelta(days=5))
    f = approved_followup(db, s)
    box = FakeMail()
    send_run(db, box)
    mid = box.sent[0]["message_id"]
    sent = followups.sent_at(db, db.rows("approval_queue", id=f["id"])[0])
    assert db.rows("touches", message_id=mid)[0]["type"] == "sent" and abs((sent - REAL).total_seconds()) < 5


# ---------------------------------------------------------------- hourly gate + runner

def test_gated_run_runs_at_most_once_an_hour(db):
    seed(db, sent=REAL - timedelta(days=5))
    fake = FakeLLM()
    assert followups.gated_run(db, fake, REAL)["created"] == 1
    assert followups.gated_run(db, fake, REAL + timedelta(minutes=5)) == {"state": "gated"}
    assert followups.gated_run(db, fake, REAL + timedelta(minutes=55)) == {"state": "gated"}
    assert len(fake.calls) == 1 and len(db.rows("actions", action="followups_run")) == 1
    r = followups.gated_run(db, fake, REAL + timedelta(hours=2))
    assert r.get("state") != "gated" and len(db.rows("actions", action="followups_run")) == 2


def test_gated_run_never_raises_and_reports_error(db):
    class Boom(FakeDB):
        def select(self, table, **f):
            if table == "approval_queue":
                raise RuntimeError("column sequence_step does not exist")
            return super().select(table, **f)
    b = Boom()
    r = followups.gated_run(b, FakeLLM(), REAL)
    assert r["error"] == "RuntimeError" and b.rows("agent_heartbeats", agent="followups")[-1]["status"] == "error"


def test_outreach_job_drafts_followups_before_it_sends(monkeypatch):
    order = []
    monkeypatch.setattr(followups, "gated_run", lambda db: order.append("followups"))
    monkeypatch.setattr(outreach, "run", lambda db=None, **k: order.append("outreach") or {"sent": 0})
    assert runner._default_job("outreach")(object()) == {"sent": 0} and order == ["followups", "outreach"]


def test_outreach_job_still_sends_when_followups_blows_up(db, monkeypatch):
    s = seed(db, sent=REAL - timedelta(days=5))
    approved_followup(db, s)
    monkeypatch.setattr(followups, "run", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    box = FakeMail()
    monkeypatch.setattr(outreach.mail, "outreach_mailbox", lambda a: box)
    r = runner._default_job("outreach")(db)
    assert r["sent"] == 1


def test_runner_registers_followups_and_shares_the_outreach_lock():
    assert "followups" in runner.JOBS and runner.LOCK_NAME["followups"] == "outreach"
    assert runner._default_job("followups") is followups.run


# ---------------------------------------------------------------- dashboard

def queue_followup(db, s, step=2, **kw):
    return db.insert("approval_queue", {
        "agent": "followups", "kind": "outbound", "deal_id": s["dl"]["id"], "contact_id": s["ct"]["id"],
        "draft": BODY, "status": "pending", "to_email": s["ct"]["email"], "subject": "Re: Packing line data",
        "sequence_step": step, "sequence_parent": s["first"]["id"], **kw})[0]


def test_dashboard_card_shows_the_step_tag_and_our_previous_email(db):
    s = seed(db)
    db.update("approval_queue", {"final_text": "Edited first email <b>x</b>."}, id=s["first"]["id"])
    queue_followup(db, s, 2)
    queue_followup(db, seed(db, 2), 3)
    cards = data.pending_cards(db, REAL, held=False)
    assert sorted(c["step"] for c in cards) == [2, 3]
    c2 = next(c for c in cards if c["step"] == 2)
    assert c2["they_wrote"] == "" and c2["ours"] == "Edited first email <b>x</b>."      # final_text wins over draft
    html = views.deck_card(c2)
    assert "Follow-up 2 of 3" in html and "Our previous email" in html
    assert 'class="ours">Edited first email &lt;b&gt;x&lt;/b&gt;.' in html and "They wrote" not in html
    assert "untrusted" not in html.split("Our previous email")[1].split("You&#x27;ll send")[0]
    assert "Follow-up 3 of 3" in views.card_tags(next(c for c in cards if c["step"] == 3))


def test_dashboard_card_falls_back_to_the_draft_and_first_touches_are_unchanged(db):
    s = seed(db)
    queue_followup(db, s, 2)
    first_card = data.enrich(db, [db.insert("approval_queue", {
        "agent": "prospector", "kind": "outbound", "deal_id": s["dl"]["id"], "contact_id": s["ct"]["id"], "draft": "d",
        "status": "pending", "to_email": "x@y.example", "subject": "S", "sequence_step": 1})[0]], REAL)[0]
    assert first_card["step"] is None and "Follow-up" not in views.card_tags(first_card)
    assert "Why them" in views.deck_card(first_card) and 'class="untrusted"' in views.deck_card(first_card)
    c = next(c for c in data.pending_cards(db, REAL, held=False) if c["step"] == 2)
    assert c["ours"] == "First email."


def test_dashboard_studio_and_console_styles_exist_for_ours():
    css = (views.__file__.rsplit("/", 1)[0] + "/static/dashboard.css")
    text = open(css).read()
    assert ".ours{" in text and "var(--well)" in text.split(".ours{")[1].split("}")[0]
    assert "#" not in text.split(".ours{")[1].split("}")[0]      # tokens only, so both themes follow


def test_followups_is_a_known_agent_on_the_rail(db):
    assert "followups" in [a for a, _ in data.AGENTS]
