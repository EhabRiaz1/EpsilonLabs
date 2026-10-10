import threading
from datetime import datetime, timedelta, timezone

import pytest

from agents import outbox
from core import config
from dashboard import actions, data
from tests.fakes import FakeDB, FakeMail

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
DRAFT = ("Hi Sana,\n\nThanks for the detail. We can start with current sensing on the generators.\n\n"
         "Could we do a call on Thursday at 3pm?\n\nI will bring a quote for 40 motors.\n\n"
         "Is the shed on Wi-Fi?\n\nEhab")


def q(db, **kw):
    row = {"agent": "inbox", "kind": "reply", "draft": DRAFT, "to_email": "sana@mm.example",
           "subject": "Re: sensors", "lint": []}
    row.update(kw)
    return db.insert("approval_queue", row)[0]["id"]


def row(db, qid):
    return db.rows("approval_queue", id=qid)[0]


def audit(db, action):
    return [a for a in db.rows("actions") if a["action"] == action]


# ---------------------------------------------------------------- approve + material_edit

def test_approve_plain():
    db = FakeDB(); i = q(db)
    r = actions.approve(db, i, now=NOW)
    assert r["ok"] and r["status"] == "approved" and not r["edited"]
    x = row(db, i)
    assert x["status"] == "approved" and x["decided_at"] == NOW.isoformat()
    assert x["final_text"] is None and x["material_edit"] is False
    assert audit(db, "approve")


def test_approve_unchanged_text_is_not_an_edit():
    db = FakeDB(); i = q(db)
    r = actions.approve(db, i, final_text=DRAFT + "\n  ", now=NOW)
    assert r["status"] == "approved" and r["diff"] is None


def test_edit_minor_not_material():
    db = FakeDB(); i = q(db)
    text = DRAFT.replace("Thanks for the detail.", "Thanks for the extra detail.")
    r = actions.approve(db, i, final_text=text, now=NOW)
    assert r["status"] == "edited_approved" and r["diff"]["changed"] == 1
    x = row(db, i)
    assert x["final_text"] == text and x["material_edit"] is False
    assert x["diff"]["material"] is False and x["diff"]["ratio"] < actions.MATERIAL_RATIO


def test_edit_over_15_percent_sentences_is_material():
    db = FakeDB(); i = q(db)
    text = DRAFT.replace("We can start with current sensing on the generators.", "Happy to help however suits you.") \
                .replace("Is the shed on Wi-Fi?", "Do you have cellular coverage?")
    r = actions.approve(db, i, final_text=text, now=NOW)
    assert r["diff"]["changed"] == 2 and r["diff"]["material"] is True
    assert row(db, i)["material_edit"] is True


@pytest.mark.parametrize("old,new,why", [
    ("Could we do a call on Thursday at 3pm?", "Could we do a call on Friday at 3pm?", "date"),
    ("Could we do a call on Thursday at 3pm?", "Could we do a call on Thursday at 4pm?", "num"),
    ("I will bring a quote for 40 motors.", "I will bring a quote for 14 motors.", "num"),
])
def test_edit_changed_fact_is_material_even_if_tiny(old, new, why):
    long = DRAFT + "\n\n" + "\n\n".join(f"Filler sentence number {n} here." for n in range(12))
    db = FakeDB(); i = q(db, draft=long)
    r = actions.approve(db, i, final_text=long.replace(old, new), now=NOW)
    assert r["diff"]["changed"] == 1 and r["diff"]["ratio"] < 0.15
    assert r["diff"]["material"] is True and why in " ".join(r["diff"]["reasons"])
    assert row(db, i)["material_edit"] is True


def test_changed_email_and_url_are_material():
    a = "Write to sana@mm.example. See https://epsilon-labs.co/a for details. " + "Ok. " * 20
    d = actions.compute_diff(a, a.replace("sana@mm", "sara@mm"))
    assert d["material"] and "email" in d["reasons"][0]
    d = actions.compute_diff(a, a.replace("/a ", "/b "))
    assert d["material"] and "url" in d["reasons"][0]


def test_compute_diff_identical_and_punctuation_only():
    assert actions.compute_diff("Hello there. Bye.", "hello there! bye")["changed"] == 0
    assert actions.compute_diff("Hello there. Bye.", "Hello there. Bye.")["material"] is False


# ---------------------------------------------------------------- lint confirm (DD3 / D11)

HITS = [{"type": "price", "text": "$4,500"}]


def test_red_lint_requires_confirm():
    db = FakeDB(); i = q(db, lint=HITS)
    r = actions.approve(db, i, now=NOW)
    assert not r["ok"] and r["error"] == "lint_confirm_required" and r["lint"] == HITS
    assert row(db, i)["status"] == "pending"
    assert actions.approve(db, i, confirm_lint=True, now=NOW)["ok"]
    assert row(db, i)["status"] == "approved"


def test_edit_that_introduces_lint_requires_confirm_and_clean_edit_does_not():
    db = FakeDB(); i = q(db, lint=HITS)
    # stored lint is red, but the edited text is re-linted and is clean, so no confirm needed
    assert actions.approve(db, i, final_text=DRAFT + "\nP.S. glad to help.", now=NOW)["ok"]
    db2 = FakeDB(); j = q(db2)
    r = actions.approve(db2, j, final_text=DRAFT + "\nWire to GB82WEST12345698765432 please.", now=NOW)
    assert r["error"] == "lint_confirm_required" and any(h["type"] == "bank" for h in r["lint"])


def test_held_draft_cannot_be_approved():
    db = FakeDB(); i = q(db, held=True, held_reason="injection_suspected")
    r = actions.approve(db, i, confirm_lint=True, now=NOW)
    assert r["error"] == "held" and row(db, i)["status"] == "pending"


def test_approve_guards():
    db = FakeDB()
    assert actions.approve(db, "nope")["error"] == "not_found"
    i = q(db, draft="  ")
    assert actions.approve(db, i)["error"] == "empty"
    j = q(db, status="sent")
    assert actions.approve(db, j)["error"] == "not_pending"
    k = q(db)
    assert actions.approve(db, k, final_text="   ")["error"] == "empty"


def test_double_approve_second_loses():
    db = FakeDB(); i = q(db)
    results = []
    gate = threading.Barrier(2)

    def go():
        gate.wait()
        results.append(actions.approve(db, i, now=NOW))
    ts = [threading.Thread(target=go) for _ in range(2)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert sorted(r["ok"] for r in results) == [False, True]


# ---------------------------------------------------------------- undo (DD2)

def test_undo_within_window_restores_pending():
    db = FakeDB(); i = q(db)
    actions.approve(db, i, final_text=DRAFT.replace("Ehab", "Ehab R."), now=NOW)
    r = actions.undo(db, i, now=NOW + timedelta(seconds=config.UNDO_SECONDS - 1))
    assert r["ok"]
    x = row(db, i)
    assert x["status"] == "pending" and x["decided_at"] is None and x["final_text"] is None
    assert x["diff"] is None and x["material_edit"] is None


def test_undo_too_late_after_window():
    db = FakeDB(); i = q(db)
    actions.approve(db, i, now=NOW)
    r = actions.undo(db, i, now=NOW + timedelta(seconds=config.UNDO_SECONDS + 1))
    assert not r["ok"] and r["error"] == "too_late" and "already sending" in r["message"].lower()
    assert row(db, i)["status"] == "approved"


@pytest.mark.parametrize("status", ["sending", "sent", "failed"])
def test_undo_too_late_once_outbox_owns_it(status):
    db = FakeDB(); i = q(db)
    actions.approve(db, i, now=NOW)
    db.update("approval_queue", {"status": status}, id=i)
    assert actions.undo(db, i, now=NOW + timedelta(seconds=1))["error"] == "too_late"
    assert row(db, i)["status"] == status


def test_undo_of_unknown_and_already_pending():
    db = FakeDB(); i = q(db)
    assert actions.undo(db, "nope")["error"] == "not_found"
    assert actions.undo(db, i)["ok"]  # nothing to revert, harmless


def test_undo_vs_outbox_claim_exactly_one_wins():
    for _ in range(40):
        db = FakeDB(); i = q(db)
        actions.approve(db, i, now=datetime.now(timezone.utc))
        gate = threading.Barrier(2)
        out = {}

        def do_claim():
            gate.wait()
            out["claim"] = db.claim("approval_queue", i, ["approved", "edited_approved"], "sending")

        def do_undo():
            gate.wait()
            out["undo"] = actions.undo(db, i)
        ts = [threading.Thread(target=do_claim), threading.Thread(target=do_undo)]
        [t.start() for t in ts]; [t.join() for t in ts]
        claimed, undone = out["claim"] is not None, out["undo"]["ok"]
        assert claimed != undone, (claimed, undone)
        assert row(db, i)["status"] == ("sending" if claimed else "pending")


def test_outbox_respects_undo_window_after_dashboard_approve():
    db, m = FakeDB(), FakeMail()
    i = q(db)
    actions.approve(db, i, now=NOW)
    outbox.run(db, m, now=NOW + timedelta(seconds=3))
    assert m.sent == [] and row(db, i)["status"] == "approved"
    assert actions.undo(db, i, now=NOW + timedelta(seconds=3))["ok"]
    actions.approve(db, i, now=NOW)
    outbox.run(db, m, now=NOW + timedelta(seconds=config.UNDO_SECONDS + 5))
    assert len(m.sent) == 1 and row(db, i)["status"] == "sent"
    assert actions.undo(db, i, now=NOW + timedelta(seconds=config.UNDO_SECONDS + 5))["error"] == "too_late"


# ---------------------------------------------------------------- reject / later / held

def test_reject_with_and_without_reason():
    db = FakeDB(); i, j = q(db), q(db)
    assert actions.reject(db, i, "wrong tone", now=NOW)["ok"]
    assert row(db, i)["status"] == "rejected" and row(db, i)["decided_at"] == NOW.isoformat()
    assert audit(db, "reject")[0]["detail"]["reason"] == "wrong tone"
    assert actions.reject(db, j)["ok"]
    assert actions.reject(db, i)["error"] == "not_pending"
    assert actions.reject(db, "nope")["error"] == "not_found"


def test_later_moves_to_end_of_deck_order():
    db = FakeDB()
    a = q(db, created_at="2026-10-10T08:00:00+00:00")
    b = q(db, created_at="2026-10-10T08:10:00+00:00")
    c = q(db, created_at="2026-10-10T08:20:00+00:00")
    assert [x["id"] for x in data.pending_cards(db, NOW, False)] == [a, b, c]
    assert actions.later(db, a)["ok"]
    assert [x["id"] for x in data.pending_cards(db, NOW, False)] == [b, c, a]
    assert actions.later(db, b)["ok"]
    assert [x["id"] for x in data.pending_cards(db, NOW, False)] == [c, a, b]
    assert row(db, a)["status"] == "pending"
    assert actions.later(db, "nope")["error"] == "not_found"


def test_release_held():
    db = FakeDB(); i = q(db, held=True, held_reason="lint: bank")
    assert [c["id"] for c in data.pending_cards(db, NOW, False)] == []
    assert actions.release_held(db, i)["ok"]
    assert row(db, i)["held"] is False
    assert [c["id"] for c in data.pending_cards(db, NOW, False)] == [i]
    assert actions.release_held(db, i)["error"] == "not_held"


def test_released_draft_with_lint_still_needs_confirm():
    db = FakeDB(); i = q(db, held=True, lint=HITS)
    actions.release_held(db, i)
    assert actions.approve(db, i, now=NOW)["error"] == "lint_confirm_required"


def test_suppress_sender():
    db = FakeDB()
    cid = db.insert("contacts", {"email": "bad@x.example", "full_name": "Bad"})[0]["id"]
    i = q(db, to_email="Bad@X.example", contact_id=cid, held=True, in_reply_to_touch_id=None)
    r = actions.suppress_sender(db, i, now=NOW)
    assert r["ok"] and r["email"] == "bad@x.example"
    sup = db.rows("suppression_list")
    assert len(sup) == 1 and sup[0]["email"] == "bad@x.example" and sup[0]["reason"] == "manual"
    assert db.rpc("is_suppressed", {"addr": "bad@x.example"}) is True
    assert db.rows("contacts")[0]["opted_out"] is True
    assert row(db, i)["status"] == "rejected"


def test_suppress_sender_already_listed_and_no_address():
    db = FakeDB()
    db.insert("suppression_list", {"email": "bad@x.example", "reason": "opt_out"})
    i = q(db, to_email="bad@x.example")
    assert actions.suppress_sender(db, i)["ok"] and len(db.rows("suppression_list")) == 1
    j = q(db, to_email=None)
    assert actions.suppress_sender(db, j)["error"] == "no_address"
    assert actions.suppress_sender(db, i)["error"] == "not_pending"


# ---------------------------------------------------------------- failed / verify

def test_retry_failed_requeues_with_new_decided_at():
    db = FakeDB()
    i = q(db, status="failed", send_error="SMTPAuthenticationError", decided_at="2026-10-09T00:00:00+00:00")
    assert actions.retry_failed(db, i, now=NOW)["ok"]
    x = row(db, i)
    assert x["status"] == "approved" and x["decided_at"] == NOW.isoformat() and x["send_error"] is None
    assert actions.retry_failed(db, i)["error"] == "not_failed"


def test_retry_unverified_needs_confirm():
    db = FakeDB()
    i = q(db, status="failed", send_error="unverified: check Sent folder")
    r = actions.retry_failed(db, i, now=NOW)
    assert r["error"] == "confirm_required" and row(db, i)["status"] == "failed"
    assert actions.retry_failed(db, i, confirm_unverified=True, now=NOW)["ok"]


def test_stale_sending_is_verify_and_fresh_sending_is_not():
    db = FakeDB()
    stale = q(db, status="sending", claimed_at=(NOW - timedelta(minutes=30)).isoformat())
    fresh = q(db, status="sending", claimed_at=(NOW - timedelta(minutes=1)).isoformat())
    assert actions.is_verify(row(db, stale), NOW) and not actions.is_verify(row(db, fresh), NOW)
    assert actions.retry_failed(db, fresh, now=NOW)["error"] == "in_flight"
    assert actions.mark_sent_verified(db, fresh, now=NOW)["error"] == "in_flight"
    assert actions.retry_failed(db, stale, now=NOW)["error"] == "confirm_required"
    assert [c["id"] for c in data.trouble_cards(db, NOW)] == [stale]


def test_mark_sent_verified_records_touch_once():
    db = FakeDB()
    i = q(db, status="sending", claimed_at=(NOW - timedelta(minutes=30)).isoformat(),
          sent_message_id="<m1@epsilon-labs.co>", contact_id=None)
    assert actions.mark_sent_verified(db, i, now=NOW)["ok"]
    assert row(db, i)["status"] == "sent"
    t = db.rows("touches")
    assert len(t) == 1 and t[0]["type"] == "sent" and t[0]["message_id"] == "<m1@epsilon-labs.co>"
    assert actions.mark_sent_verified(db, i)["error"] == "not_failed"
