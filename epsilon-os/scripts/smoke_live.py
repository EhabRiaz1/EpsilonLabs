"""Live smoke (D8): er@ -> er@ through real Zoho, then the inbox agent against live Supabase.

NOT run by tests or CI. Needs --i-mean-it. Touches real services:
  1. sends ONE email from er@ to er@ (subject EOS-SMOKE-<id>)
  2. waits for it to land in the INBOX
  3. runs the inbox agent once, restricted to that single message (no LLM call: own address)
  4. asserts the touch exists
  5. deletes the test rows it created (touches by message_id, the contact if it created one)
The smoke message itself stays in the mailbox. `actions` is insert-only, so its log rows remain.

    make smoke ARGS=--i-mean-it
"""
import argparse
import sys
import time
import uuid

from agents import inbox
from core import config, llm, mail
from core.db import DB


class OnlySmoke:
    """Mail adapter that exposes only the smoke message, so the live inbox is otherwise untouched."""

    def __init__(self, message_id: str):
        self.mid = message_id

    def fetch_new(self, since_days: int = 1):
        return [m for m in mail.fetch_new(since_days) if m["message_id"] == self.mid]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-mean-it", action="store_true", dest="consent",
                    help="required: this sends a real email and writes to the live database")
    ap.add_argument("--wait", type=int, default=90, help="seconds to wait for delivery")
    a = ap.parse_args(argv)
    if not a.consent:
        print("refusing: pass --i-mean-it to send one er@->er@ email and write/clean test rows in live Supabase")
        return 2

    db = DB()
    mid = mail.new_message_id()
    tag = uuid.uuid4().hex[:8]
    mail.send({"to": config.ER, "subject": f"EOS-SMOKE-{tag}", "body": "Epsilon OS smoke test. Safe to delete.",
               "message_id": mid})
    print("sent smoke message")
    adapter = OnlySmoke(mid)
    deadline = time.time() + a.wait
    while time.time() < deadline and not adapter.fetch_new():
        time.sleep(5)
    if not adapter.fetch_new():
        print("FAIL: smoke message did not arrive in INBOX within the wait")
        return 1
    contacts_before = {c["id"] for c in db.select("contacts", email=config.ER, select="id")}
    try:
        result = inbox.run(db, adapter, llm.ask)
        touches = db.select("touches", message_id=mid)
        ok = len(touches) == 1 and result.get("errors") == 0
        print("PASS: touch exists" if ok else f"FAIL: touches={len(touches)} result={result}")
        return 0 if ok else 1
    finally:
        db.delete("touches", message_id=mid)
        for c in db.select("contacts", email=config.ER, select="id"):
            if c["id"] not in contacts_before:
                db.delete("contacts", id=c["id"])
        print("cleaned up test rows")


if __name__ == "__main__":
    sys.exit(main())
