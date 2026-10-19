"""Queue a hand-researched campaign into the approval queue (Deck) for founder approval.

Input: a JSON array of prospects, each with company/domain/country/contact/email/subject/body/notes.
Every row goes in exactly like a prospector first touch (agent 'prospector', status 'pending'), so the Deck,
the outreach sender, the warm-up cap, suppression and the follow-up sequence all apply unchanged.
The same contact rules (P5) and lint run here; anything that fails is held with a reason, never dropped.

    .venv/bin/python -m scripts.queue_campaign FILE.json --strategy s3_regulation [--dry-run]
"""
import argparse
import json
import sys

from agents.prospector import (AGENT, MAX_WORDS, SALES_WORDS, check_contact, clean_domain, finish_draft,
                               region_for, _one_line)
from core import ledger, lint
from core.db import DB

STRATEGIES = {"s3_regulation", "s4_partner"}


def queue(db, run_id: str, p: dict, strategy: str, dry: bool) -> str:
    domain = clean_domain(p["domain"])
    if not domain:
        return f"SKIP {p['company']}: bad domain"
    if db.select("companies", domain=f"eq.{domain}", select="id", limit=1):
        return f"SKIP {p['company']}: already in companies"
    contact, why = check_contact({"email": p.get("email"), "name": p.get("contact_name"),
                                  "role": p.get("contact_role"), "source_url": p.get("email_source_url")}, domain)
    if not contact:
        return f"SKIP {p['company']}: {why or 'no email'}"
    if db.rpc("is_suppressed", {"addr": contact["email"]}):
        return f"SKIP {p['company']}: suppressed"
    body, problems = finish_draft(p["body"])
    hits = lint.lint(body, {"recipient": contact["email"]})
    reasons = [x for x in problems if "added by code" not in x]
    if p.get("hold"):
        reasons.append(str(p["hold"]))
    if p.get("email_basis") == "pattern":
        reasons.append("address inferred from a published pattern: check before approving")
    if strategy == "s4_partner" and SALES_WORDS.search(body):
        reasons.append("sales wording in a partner draft")
    if hits:
        reasons.append("lint: " + ", ".join(sorted({h["type"] for h in hits})))
    held = bool(reasons)
    if dry:
        return f"DRY {p['company']} -> {contact['email']} held={held} {reasons} words={len(body.split())}/{MAX_WORDS}"
    region, basis = region_for(p["country"])
    company = db.insert("companies", {
        "name": p["company"], "domain": domain, "country": p["country"].upper(), "sector": p.get("sector"),
        "wedge": "other", "is_dream25": False, "strategy": strategy, "notes": p.get("notes")})[0]
    c = db.insert("contacts", {"company_id": company["id"], "full_name": contact["name"] or None,
                               "email": contact["email"], "role": contact["role"] or None, "region": region,
                               "legal_basis": basis, "linkedin_url": p.get("linkedin") or None})[0]
    deal = db.insert("deals", {"company_id": company["id"], "primary_contact_id": c["id"],
                               "title": _one_line("CRA Fix Sprint: " + p.get("product", p["company"]), 140),
                               "stage": "lead", "wedge": "other", "source_channel": "outbound",
                               "strategy": strategy})[0]
    db.insert("dossiers", {"company_id": company["id"], "version": 1, "body_md": p.get("notes") or "",
                           "sources": [{"url": u, "kind": "evidence"} for u in p.get("sources", []) if u]
                           + [{"url": contact["source_url"], "kind": "contact_address"}],
                           "created_by": AGENT}, returning=False)
    row = db.insert("approval_queue", {
        "agent": AGENT, "kind": "outbound", "deal_id": deal["id"], "contact_id": c["id"], "draft": body,
        "status": "pending", "to_email": contact["email"], "subject": _one_line(p["subject"], 120),
        "run_id": run_id, "held": held, "held_reason": "; ".join(reasons) or None, "lint": hits})[0]
    ledger.action(db, AGENT, run_id, "draft_queued", target_table="approval_queue", target_id=row["id"],
                  detail={"kind": "outbound", "held": held, "strategy": strategy, "source": "queue_campaign"})
    return f"QUEUED {p['company']} -> {contact['email']} held={held}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--strategy", required=True, choices=sorted(STRATEGIES))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    rows = json.load(open(a.file))
    db = DB()
    run_id = ledger.new_run_id()
    for p in rows:
        try:
            print(queue(db, run_id, p, a.strategy, a.dry_run))
        except Exception as e:  # one bad row must not stop the rest; report it plainly
            print(f"ERROR {p.get('company')}: {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
