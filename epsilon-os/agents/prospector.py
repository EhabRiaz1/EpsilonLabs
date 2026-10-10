"""Prospector (P1, P4, P5): finds companies with a visible, current, unmet need and prepares the first touch.

Research is the only web-facing call (core.llm.research: WebSearch + WebFetch, nothing else). Everything it
returns is validated here before it is trusted, dossiers and drafts are written by tool-less core.llm.ask
calls, and nothing is ever sent: the draft lands in approval_queue (kind 'outbound') for the founder.

Order of work per prospect: dedupe and suppression first (cheap), then the two LLM writes, then the DB
writes. A budget stop or a failed dossier therefore never leaves a half-made company behind.

    python -m agents.prospector --dry-run --segment industrial --n 3
"""
import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from agents.inbox import first_name
from core import config, ledger, lint, llm as llm_mod, settings as settings_mod
from core.db import DB
from prompts import loader, schemas
from prompts.segments import SEGMENT_BRIEFS

AGENT = "prospector"
BATCH = 5
CALLS_PER_SEGMENT = 3
MIN_CONFIDENCE = 0.4
MAX_WORDS = 135
KNOWN_IN_PROMPT = 300
OPT_OUT_LINE = "Reply 'stop' and I won't write again."
WEDGE = {"industrial": "industrial_monitoring", "oem_hardware": "protocol_decode", "smb_software": "other"}
EU = {"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
      "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"}
EEA = {"IS", "LI", "NO"}
FREEMAIL = {"gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com",
            "proton.me", "protonmail.com", "aol.com", "gmx.com", "yandex.com", "msn.com"}
NOT_A_COMPANY = {"linkedin.com", "indeed.com", "glassdoor.com", "reddit.com", "facebook.com", "twitter.com", "x.com",
                 "github.com", "stackoverflow.com", "stackexchange.com", "youtube.com", "medium.com", "upwork.com",
                 "fiverr.com", "freelancer.com", "wikipedia.org", "google.com", "naukri.com", "rozee.pk"}
CONTACT_BATCH = 8
HIRING_INBOXES = {"careers", "career", "jobs", "job", "hr", "recruiting", "recruitment", "recruiter", "talent", "hiring",
                  "apply", "applications", "people"}
DOMAIN_RE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$")


# ---------------------------------------------------------------- pure helpers

# High-budget markets for cold outreach (founder 2026-10-10). Pakistan is worked through the founder's own network.
TARGET_MARKETS = frozenset("""US CA GB IE DE NL BE LU FR DK SE NO FI IS CH AT IT ES PT PL CZ EE LT LV SI
    AE SA QA KW BH OM AU NZ SG JP KR IL""".split())


def region_for(country: str) -> tuple[str, str]:
    """(region, legal_basis). UK/EU/EEA get legitimate_interest_b2b, everywhere else business_contact."""
    c = (country or "").upper()
    if c == "GB":
        return "UK", "legitimate_interest_b2b"
    if c in EU:
        return "EU", "legitimate_interest_b2b"
    if c in EEA:
        return "EEA", "legitimate_interest_b2b"
    return c or "XX", "business_contact"


def clean_domain(raw: str) -> str | None:
    d = (raw or "").strip().lower()
    if "//" in d:
        d = urlparse(d).netloc or ""
    d = d.split("/")[0].split(":")[0].removeprefix("www.").strip(".")
    if not DOMAIN_RE.match(d) or d in FREEMAIL or any(d == b or d.endswith("." + b) for b in NOT_A_COMPANY):
        return None
    return d


def _one_line(s: str, limit: int) -> str:
    return re.sub(r"\s+", " ", s or "").strip()[:limit]


def valid_url(u: str) -> bool:
    p = urlparse(u or "")
    return p.scheme in ("http", "https") and bool(p.netloc) and " " not in u


def check_contact(c, domain: str) -> tuple[dict | None, str]:
    """P5 contact rules: published, on the company's own domain, not a hiring inbox, with a source page."""
    if not (isinstance(c, dict) and c.get("email")):
        return None, ""
    m = EMAIL_RE.match(str(c["email"]).strip())
    host = m.group(1).lower() if m else ""
    if not m:
        return None, "malformed contact email"
    if not (host == domain or host.endswith("." + domain)):
        return None, "contact email not on the company domain"
    if m.group(0).split("@")[0].lower() in HIRING_INBOXES:
        return None, "hiring inbox, not a buyer contact"
    if not valid_url(str(c.get("source_url") or "")):
        return None, "contact without a source url"
    return {"email": str(c["email"]).strip().lower(), "name": _one_line(c.get("name"), 120),
            "role": _one_line(c.get("role"), 120), "source_url": c["source_url"].strip()}, ""


def fill_contacts(S, prospects: list[dict]) -> int:
    """One batched web call that looks for a published business address on each contact-less company's own site."""
    need = [p for p in prospects if not p["contact"] and p["domain"] not in S.known][:CONTACT_BATCH]
    if not need or S.budget_hit:
        return 0
    system = loader.compose("find_contact", {"today": S.today, "domains": "\n".join(p["domain"] for p in need)},
                            preamble="preamble_research")
    try:
        data, _ = S.llm.research(S.db, AGENT, S.run_id, system, "Find the published contact addresses.",
                                 schemas.CONTACTS, model="sonnet")
    except llm_mod.BudgetExceeded:
        S.budget_hit = True
        return 0
    except llm_mod.LLMError as e:
        _log(S, "contact_search_failed", detail={"error": str(e)[:200]})
        return 0
    by_domain = {p["domain"]: p for p in need}
    found = 0
    for c in data.get("contacts") or []:
        p = by_domain.get(clean_domain(str(c.get("domain") or "")) or "")
        if not p or p["contact"]:
            continue
        contact, note = check_contact(c, p["domain"])
        if contact:
            p["contact"], p["contact_note"] = contact, "contact found on the company site"
            found += 1
        else:
            p["contact_note"] = note
    S.c["contacts_found"] = S.c.get("contacts_found", 0) + found
    _log(S, "contact_search_done", detail={"asked": len(need), "found": found, "notes": (data.get("notes") or "")[:200]})
    return found


def validate(raw: dict, segment: str, slugs: set[str]) -> tuple[dict | None, str]:
    """Code-side check of one research result. Returns (prospect, "") or (None, reason)."""
    if not isinstance(raw, dict):
        return None, "not an object"
    if not valid_url(str(raw.get("evidence_url") or "")):
        return None, "no evidence_url"
    domain = clean_domain(str(raw.get("domain") or ""))
    if not domain:
        return None, "bad domain"
    if raw.get("segment") != segment:
        return None, "wrong segment"
    if raw.get("suggested_offer_slug") not in slugs:
        return None, "unknown offer slug"
    conf = raw.get("confidence")
    if not isinstance(conf, (int, float)) or conf < MIN_CONFIDENCE:
        return None, "low confidence"
    quote, obs = _one_line(raw.get("evidence_quote"), 240), _one_line(raw.get("observation"), 400)
    country = str(raw.get("country") or "").upper()
    name = _one_line(raw.get("name"), 160)
    if not (quote and obs and name and re.fullmatch(r"[A-Z]{2}", country)):
        return None, "missing field"
    if country not in TARGET_MARKETS:
        return None, "outside target markets"
    contact, contact_note = check_contact(raw.get("contact"), domain)
    return {"name": name, "domain": domain, "country": country, "sector": _one_line(raw.get("sector"), 80),
            "segment": segment, "evidence_url": raw["evidence_url"].strip(), "evidence_quote": quote,
            "observation": obs, "offer_slug": raw["suggested_offer_slug"], "contact": contact,
            "contact_note": contact_note, "confidence": float(conf)}, ""


def segment_order(enabled: list[str], today: date) -> list[str]:
    """Round-robin: today's lead segment advances by one each day; the rest follow to top up the quota."""
    if not enabled:
        return []
    i = today.toordinal() % len(enabled)
    return enabled[i:] + enabled[:i]


def finish_draft(body: str) -> tuple[str, list[str]]:
    """Force the exact opt-out ending (P5) and report soft problems that should hold the draft."""
    text = body.replace("’", "'").strip()
    problems = []
    if not text.endswith(OPT_OUT_LINE):
        text = text.rstrip() + "\n\n" + OPT_OUT_LINE
        problems.append("opt-out line was added by code")
    words = len(text.split())
    if words > MAX_WORDS:
        problems.append(f"{words} words (limit {MAX_WORDS})")
    return text, problems


# ---------------------------------------------------------------- run state

class State:
    def __init__(self, db, llm, run_id: str, dry: bool):
        self.db, self.llm, self.run_id, self.dry = db, llm, run_id, dry
        self.budget_hit = False
        self.known: set[str] = set()
        self.rows: list[dict] = []
        self.notes: list[str] = []
        self.today = ""
        self.c = dict.fromkeys(("research_calls", "returned", "invalid", "dup", "suppressed", "existing", "created",
                                "no_contact", "drafts", "held", "dossier_failed", "draft_failed", "research_failed",
                                "errors"), 0)


def _log(S, action: str, **kw) -> None:
    try:
        ledger.action(S.db, AGENT, S.run_id, action, **kw)
    except Exception:
        pass  # logging must never kill the run


def _facts(p: dict) -> str:
    return json.dumps({k: p[k] for k in ("name", "domain", "country", "sector", "evidence_url", "evidence_quote",
                                         "observation")} | {"contact_role": (p["contact"] or {}).get("role", "")},
                      ensure_ascii=False)


def _dossier(S, p: dict) -> str:
    system = loader.compose("dossier", {})
    data, _ = S.llm.ask(S.db, AGENT, S.run_id, system, _facts(p), schemas.DOSSIER, model="haiku")
    return data["body_md"]


def _outbound(S, p: dict) -> dict:
    first = first_name((p["contact"] or {}).get("name", ""))
    ctx = (f"first name: {first if first != 'there' else '(none, use \"Hi,\")'}; company: {p['name']}; "
           f"country: {p['country']}")
    system = loader.compose("outbound", {"context": ctx, "focus": loader.offer_line(p["offer_slug"])})
    data, _ = S.llm.ask(S.db, AGENT, S.run_id, system, _facts(p), schemas.OUTBOUND, model="sonnet")
    return data


def _write(S, p: dict, dossier: str, draft: dict | None) -> dict:
    """Company, contact, deal, dossier and (when there is an address and a draft) the queue row."""
    db = S.db
    region, basis = region_for(p["country"])
    company = db.insert("companies", {
        "name": p["name"], "domain": p["domain"], "country": p["country"], "sector": p["sector"] or None,
        "wedge": WEDGE[p["segment"]], "is_dream25": False,
        "notes": f"Prospector ({p['segment']}): {p['observation']} Evidence: {p['evidence_url']}"})[0]
    S.known.add(p["domain"])
    contact = None
    if p["contact"]:
        c = p["contact"]
        contact = db.insert("contacts", {
            "company_id": company["id"], "full_name": c["name"] or None, "email": c["email"],
            "role": c["role"] or None, "region": region, "legal_basis": basis})[0]
    deal = db.insert("deals", {
        "company_id": company["id"], "primary_contact_id": contact["id"] if contact else None,
        "title": ("Outbound: " + p["observation"])[:140], "stage": "lead", "wedge": WEDGE[p["segment"]],
        "source_channel": "outbound"})[0]
    sources = [{"url": p["evidence_url"], "kind": "evidence", "quote": p["evidence_quote"]}]
    if p["contact"]:
        sources.append({"url": p["contact"]["source_url"], "kind": "contact_address"})
    db.insert("dossiers", {"company_id": company["id"], "version": 1, "body_md": dossier, "sources": sources,
                           "created_by": AGENT}, returning=False)
    _log(S, "prospect_created", target_table="companies", target_id=company["id"],
         detail={"domain": p["domain"], "segment": p["segment"], "deal_id": deal["id"], "evidence_url": p["evidence_url"]})
    out = {"company_id": company["id"], "deal_id": deal["id"], "queued": None}
    if contact and draft:
        body, problems = finish_draft(draft["body"])
        hits = lint.lint(body, {"recipient": contact["email"]})
        reasons = [x for x in problems if "added by code" not in x]
        if hits:
            reasons.append("lint: " + ", ".join(sorted({h["type"] for h in hits})))
        held = bool(reasons)
        row = db.insert("approval_queue", {
            "agent": AGENT, "kind": "outbound", "deal_id": deal["id"], "contact_id": contact["id"],
            "draft": body, "status": "pending", "to_email": contact["email"],
            "subject": _one_line(draft["subject"], 120), "run_id": S.run_id, "held": held,
            "held_reason": "; ".join(reasons) or None, "lint": hits})[0]
        S.c["drafts"] += 1
        S.c["held"] += 1 if held else 0
        out["queued"] = row["id"]
        _log(S, "draft_queued", target_table="approval_queue", target_id=row["id"],
             detail={"kind": "outbound", "held": held, "lint": len(hits), "offer": p["offer_slug"],
                     "notes": (draft.get("notes") or "")[:200]})
    return out


def _process(S, p: dict) -> None:
    db = S.db
    row = {"company": p["name"], "domain": p["domain"], "country": p["country"], "segment": p["segment"],
           "evidence_url": p["evidence_url"], "evidence_quote": p["evidence_quote"], "observation": p["observation"],
           "offer": p["offer_slug"], "contact": p["contact"], "confidence": p["confidence"]}
    if p["domain"] in S.known:
        S.c["dup"] += 1
        _log(S, "prospect_dropped", detail={"domain": p["domain"], "reason": "known domain"})
        return
    if p["contact"]:
        addr = p["contact"]["email"]
        if db.rpc("is_suppressed", {"addr": addr}):
            S.c["suppressed"] += 1
            _log(S, "prospect_dropped", detail={"domain": p["domain"], "reason": "suppressed address"})
            return
        if db.select("contacts", email=addr, limit=1):
            S.c["existing"] += 1
            _log(S, "prospect_dropped", detail={"domain": p["domain"], "reason": "existing contact"})
            return
    try:
        dossier = _dossier(S, p)
    except llm_mod.BudgetExceeded:
        S.budget_hit = True
        return
    except llm_mod.LLMError as e:
        S.c["dossier_failed"] += 1
        _log(S, "dossier_failed", detail={"domain": p["domain"], "error": str(e)[:200]})
        return
    draft = None
    if p["contact"]:
        try:
            draft = _outbound(S, p)
        except llm_mod.BudgetExceeded:
            S.budget_hit = True
            S.c["draft_failed"] += 1
            _log(S, "draft_failed", detail={"domain": p["domain"], "error": "budget"})
        except llm_mod.LLMError as e:
            S.c["draft_failed"] += 1
            _log(S, "draft_failed", detail={"domain": p["domain"], "error": str(e)[:200]})
    else:
        S.c["no_contact"] += 1
    out = _write(S, p, dossier, draft)
    S.c["created"] += 1
    S.rows.append({**row, **out, "dossier_chars": len(dossier), "draft": draft and draft["body"],
                   "contact_note": p["contact_note"]})


def _known_domains(db) -> set[str]:
    out: set[str] = set()
    offset = 0
    while True:  # PostgREST caps a page (1000 rows by default), so walk the whole table
        rows = db.select("companies", select="domain", order="id.asc", limit=1000, offset=offset)
        out |= {str(r["domain"]).lower() for r in rows if r.get("domain")}
        if len(rows) < 1000:
            return out
        offset += 1000


def _prompt_domains(db, S) -> str:
    rows = db.select("companies", select="domain,created_at", order="created_at.desc", limit=KNOWN_IN_PROMPT)
    seen = [str(r["domain"]).lower() for r in rows if r.get("domain")]
    seen += sorted(S.known - set(seen))
    safe = [d for d in seen if DOMAIN_RE.match(d)][:KNOWN_IN_PROMPT]
    return ", ".join(safe) or "(none yet)"


def _created_today(db, now: datetime) -> int:
    start = now.astimezone(ZoneInfo(config.TZ)).replace(hour=0, minute=0, second=0, microsecond=0)
    return len(db.select("actions", action="prospect_created", at=f"gte.{start.isoformat()}", select="id", limit=1000))


def _research_segment(S, seg: str, target: int, slugs: list[str], schema: dict) -> None:
    for _ in range(CALLS_PER_SEGMENT):
        if S.c["created"] >= target or S.budget_hit:
            return
        n = min(BATCH, target - S.c["created"] + 2)
        system = loader.compose("prospect_research", {
            "n": n, "today": S.today, "segment": seg, "segment_brief": SEGMENT_BRIEFS[seg], "slugs": ", ".join(slugs),
            "offers": loader.offers_summary(), "known_domains": _prompt_domains(S.db, S)},
            preamble="preamble_research")
        S.c["research_calls"] += 1
        try:
            data, _ = S.llm.research(S.db, AGENT, S.run_id, system,
                                     f"Run the research task for segment {seg}. Return up to {n} companies.",
                                     schema, model="sonnet")
        except llm_mod.BudgetExceeded:
            S.budget_hit = True
            return
        except llm_mod.LLMError as e:
            S.c["research_failed"] += 1
            _log(S, "research_failed", detail={"segment": seg, "error": str(e)[:200]})
            return
        found = data.get("companies") or []
        if data.get("notes"):
            S.notes.append(f"{seg}: {data['notes'][:300]}")
        S.c["returned"] += len(found)
        _log(S, "research_done", detail={"segment": seg, "returned": len(found), "notes": (data.get("notes") or "")[:200]})
        if not found:
            return
        valid = []
        for raw in found:
            p, why = validate(raw, seg, set(slugs))
            if p is None:
                S.c["invalid"] += 1
                _log(S, "prospect_dropped", detail={"reason": why, "domain": str((raw or {}).get("domain"))[:80]})
                continue
            valid.append(p)
        fill_contacts(S, valid)
        for p in valid:
            if S.c["created"] >= target or S.budget_hit:
                break
            try:
                _process(S, p)
            except Exception as e:  # one bad prospect never kills the run
                S.c["errors"] += 1
                _log(S, "prospect_error", detail={"domain": p["domain"], "error": f"{type(e).__name__}: {str(e)[:200]}"})


def run(db: DB | None = None, llm=llm_mod, settings=None, now: datetime | None = None, *,
        segment: str | None = None, per_day: int | None = None, dry: bool = False) -> dict:
    db = db or DB()
    settings = settings or settings_mod.Settings(db)
    now = now or datetime.now(timezone.utc)
    run_id = ledger.new_run_id()
    S = State(db, llm, run_id, dry)

    def beat(status: str, **detail) -> dict:
        out = {"run_id": run_id, **detail}
        ledger.heartbeat(db, AGENT, status, out)
        return out

    if not dry and settings.paused():
        return beat("ok", state="paused")
    enabled = [segment] if segment else settings.segments()
    want = per_day if per_day is not None else settings.per_day()
    target = want if dry else want - _created_today(db, now)
    if not enabled or target <= 0:
        return beat("ok", state="idle" if enabled else "no segments", target=max(target, 0))
    slugs = loader.offer_slugs()
    schema = schemas.research(slugs)
    S.known = _known_domains(db)
    S.today = now.astimezone(ZoneInfo(config.TZ)).strftime("%A %d %B %Y")
    order = segment_order(enabled, now.astimezone(ZoneInfo(config.TZ)).date())
    for seg in order:
        if S.c["created"] >= target or S.budget_hit:
            break
        _research_segment(S, seg, target, slugs, schema)
    status = "warn" if (S.budget_hit or S.c["errors"] or S.c["research_failed"] or S.c["dossier_failed"]
                        or S.c["draft_failed"]) else "ok"
    out = {"segments": order, "target": target, "budget_exceeded": S.budget_hit, **S.c}
    if not dry:
        out = beat(status, **out)
    else:
        out["run_id"] = run_id
    out["rows"] = S.rows
    out["research_notes"] = S.notes
    return out


# ---------------------------------------------------------------- dry run

class _DryAsk:
    """Stands in for core.llm.ask in --dry-run so only the research calls cost real model time."""

    def __init__(self, real):
        self.real = real

    def ask(self, db, agent, run_id, system, untrusted, schema, model="haiku", timeout=120):
        if "body_md" in schema["properties"]:
            return {"body_md": "(dry run: dossier not generated)"}, {}
        return {"subject": "(dry run)", "body": "(dry run: draft not generated)", "notes": ""}, {}

    def research(self, *a, **k):
        return self.real.research(*a, **k)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Epsilon OS prospector")
    ap.add_argument("--dry-run", action="store_true",
                    help="research for real, write nothing, print prospects as JSON; uses an in-memory fake DB")
    ap.add_argument("--segment", choices=schemas.PROSPECT_SEGMENTS, help="required with --dry-run")
    ap.add_argument("--n", type=int, default=3, help="prospects wanted in a dry run")
    a = ap.parse_args(argv)
    if not a.dry_run:
        print({k: v for k, v in run().items() if k != "rows"})  # same as the launchd job
        return 0
    if not a.segment:
        ap.error("--dry-run needs --segment (each segment is one real research call)")
    from tests.fakes import FakeDB
    db = FakeDB()  # never the live database
    res = run(db, _DryAsk(llm_mod), now=datetime.now(timezone.utc), segment=a.segment, per_day=a.n, dry=True)
    print(json.dumps(res, indent=2, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
