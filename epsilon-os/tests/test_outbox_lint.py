"""edited_pending_lint (an edit or approve made on admin.*): never claimed by the outbox until the Mac has linted it.
Clean -> sent after the undo window; lint hits -> back on the Deck, held, with the lint reasons (as at draft time)."""
from datetime import timedelta

from agents import outbox
from core import config
from dashboard import actions
from tests.fakes import FakeDB, FakeMail
from tests.test_dashboard_actions import DRAFT, NOW, q, row


def admin_edit(db, qid, body, now=NOW):
    """What admin.* does: the RPC without p_lint (staff cannot pass it), so the draft waits for lint."""
    return db.rpc("edit_and_approve_draft", {"p_id": qid, "p_body": body, "p_now": now.isoformat()})


def test_pending_lint_is_never_claimed_before_lint():
    db = FakeDB(); m = FakeMail(); i = q(db)
    assert admin_edit(db, i, DRAFT + "\nThanks!")["status"] == "edited_pending_lint"
    # what the outbox claims: approved / edited_approved only, never edited_pending_lint
    assert db.claim("approval_queue", i, outbox.APPROVED, "sending") is None
    assert db.select("approval_queue", status="in.(approved,edited_approved)") == []
    assert row(db, i)["status"] == "edited_pending_lint" and m.sent == []


def test_clean_edit_is_linted_then_sent_after_the_undo_window():
    db = FakeDB(); m = FakeMail(); i = q(db)
    admin_edit(db, i, DRAFT + "\nThanks!")
    r = outbox.run(db, m, now=NOW + timedelta(seconds=2))
    assert r["linted"] == 1 and r["lint_held"] == 0 and r["sent"] == 0       # still inside the undo window
    x = row(db, i)
    assert x["status"] == "edited_approved" and x["lint"] == [] and x["diff"]["added"] == ["Thanks!"]
    assert actions.undo(db, i, now=NOW + timedelta(seconds=3))["ok"]          # undo still works after the lint
    admin_edit(db, i, DRAFT + "\nThanks!")
    outbox.run(db, m, now=NOW + timedelta(seconds=1))
    r = outbox.run(db, m, now=NOW + timedelta(seconds=config.UNDO_SECONDS + 5))
    assert r["sent"] == 1 and m.sent[0]["body"].endswith("Thanks!")


def test_lint_failure_holds_with_reasons_and_never_sends():
    db = FakeDB(); m = FakeMail(); i = q(db)
    admin_edit(db, i, DRAFT + "\nWire to GB82WEST12345698765432 please, see https://evil.example")
    r = outbox.run(db, m, now=NOW + timedelta(seconds=30))
    assert r["lint_held"] == 1 and r["sent"] == 0 and m.sent == []
    x = row(db, i)
    assert (x["status"], x["held"], x["held_reason"]) == ("pending", True, "lint: bank, url")
    assert x["final_text"].endswith("evil.example") and x["decided_at"] is None
    assert [a["action"] for a in db.rows("actions") if a["target_id"] == i][-1] == "lint_held"
    # the founder can still release it and send it deliberately, with a lint confirm, from 8787
    assert actions.release_held(db, i)["ok"]
    assert actions.approve(db, i, now=NOW)["error"] == "lint_confirm_required"
    assert actions.approve(db, i, confirm_lint=True, now=NOW)["status"] == "edited_approved"
    outbox.run(db, m, now=NOW + timedelta(seconds=config.UNDO_SECONDS + 5))
    assert m.sent and m.sent[0]["body"].endswith("evil.example")


def test_8787_shows_the_held_edit_on_the_card():
    from dashboard import data
    db = FakeDB(); i = q(db)
    admin_edit(db, i, DRAFT + "\nCall +44 20 7946 0958")
    outbox.run(db, FakeMail(), now=NOW + timedelta(seconds=30))
    card = data.pending_cards(db, NOW, True)[0]
    assert card["id"] == i and card["draft"].endswith("0958") and card["held_reason"] == "lint: phone"
