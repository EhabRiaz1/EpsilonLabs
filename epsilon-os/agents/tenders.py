"""Tenders (strategy S1): find public tenders Epsilon could bid on, score the fit, and queue them for the founder.

Pipeline, in order, each step deterministic until the last:
  1. fetch every enabled feed (core.feeds; one failing feed never stops the others)
  2. keyword relevance, deadline >= 10 days out, value band (unknown values are kept)
  3. drop what is already stored (source, source_id)
  4. code eligibility (set-asides, clearance, ITAR/EAR, hard residency, on-site only): excluded notices are stored
     as status `pass` with the reason so they are never re-scored, and never reach the model
  5. the top `tenders.per_day` by keyword rank go to the tool-less model (haiku) for a fit score and a bid brief
Nothing bids, applies, registers or emails. The founder decides in the dashboard (Opportunities).

    python -m agents.tenders --dry-run [--n 5]     # real feeds + real model calls, fake in-memory DB, prints rows
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from core import ledger, llm as llm_mod, settings as settings_mod
from core import feeds
from core.db import DB, DBError
from core.feeds import eligibility, filters
from core.feeds.base import Opp
from prompts import loader, schemas

AGENT = "tenders"
LOOKBACK_DAYS = 7          # a missed day or an over-quota day is picked up again; dedupe makes it free
WORTH_A_LOOK = 60          # fit score the dashboard calls "worth a look"
IN_BATCH = 40


def _log(db, run_id: str, action: str, row_id: str | None = None, **detail) -> None:
    try:
        ledger.action(db, AGENT, run_id, action, "opportunities" if row_id else None, row_id, detail or None)
    except Exception:
        pass  # logging must never kill the run


def known_ids(db, opps: list[Opp]) -> set[tuple[str, str]]:
    """(source, source_id) of every candidate that is already stored."""
    by_source: dict[str, list[str]] = {}
    for o in opps:
        if '"' not in o.source_id and "\\" not in o.source_id:
            by_source.setdefault(o.source, []).append(o.source_id)
    seen: set[tuple[str, str]] = set()
    for src, ids in by_source.items():
        for i in range(0, len(ids), IN_BATCH):
            chunk = ids[i:i + IN_BATCH]
            quoted = ",".join(f'"{x}"' for x in chunk)
            for r in db.select("opportunities", source=src, source_id=f"in.({quoted})", select="source_id",
                               limit=len(chunk) + 5):
                seen.add((src, r["source_id"]))
    return seen


def catalogue_lines() -> str:
    import json as _json
    offers = _json.loads(loader.CATALOGUE.read_text()).get("offers", [])
    return "\n".join(f"- {o['slug']}: {o.get('name', '').strip()}. {o.get('tagline', '').strip()}"
                     for o in offers if o.get("slug"))


def brief(o: Opp, elig: dict) -> str:
    """The untrusted block: everything the buyer wrote, as JSON, plus what code already decided."""
    return json.dumps({
        "source": o.source, "title": o.title, "buyer": o.buyer, "country": o.country,
        "classification_codes": o.cpv_or_naics[:12],
        "deadline": o.deadline_at.date().isoformat() if o.deadline_at else "not stated",
        "estimated_value": (f"{o.value_min or o.value_max:,.0f} {o.currency}" if (o.value_min or o.value_max) else "not stated"),
        "description": o.summary[:3500], "code_eligibility_notes": elig["notes"],
    }, ensure_ascii=False)


def merge_eligibility(code: dict, model: dict) -> dict:
    """Code decides exclusion. A model 'exclude' is shown as a flag (a wrong model call must never bury a bid)."""
    m_status = "flag" if model.get("status") in ("flag", "exclude") else "ok"
    notes = list(code["notes"]) + [f"Model: {n}" for n in model.get("notes", [])]
    return {"status": eligibility.worst(code["status"], m_status), "notes": notes[:12]}


def build_row(o: Opp, status: str, fit: dict, now: datetime, note: str | None = None) -> dict:
    row = o.row()
    row.update(status=status, fit=fit, notes=note)
    if status == "pass":
        row["decided_at"] = now.isoformat()
    return row


def excluded_row(o: Opp, elig: dict, now: datetime) -> dict:
    fit = {"score": 0, "offer_slug": None, "reasons": ["Excluded before scoring: " + elig["notes"][0]],
           "requirements": [], "eligibility": elig, "effort": "", "what_we_need": []}
    return build_row(o, "pass", fit, now, "Auto-pass: " + elig["notes"][0])


def insert(db, row: dict) -> dict | None:
    try:
        return db.insert("opportunities", row)[0]
    except DBError as e:
        if "409" in str(e) or "duplicate" in str(e).lower():
            return None  # another run stored it first
        raise


def pick(pending: list[tuple[Opp, dict]], want: int) -> list[tuple[Opp, dict]]:
    """Best `want` by rank, but no single source may take more than half of them while others have candidates,
    so a high-volume feed (TED) cannot crowd out UNGM, the development banks or SAM.gov."""
    cap = max(1, (want + 1) // 2)
    taken: list[tuple[Opp, dict]] = []
    used: dict[str, int] = {}
    for p in pending:
        if len(taken) >= want:
            break
        if used.get(p[0].source, 0) < cap:
            taken.append(p)
            used[p[0].source] = used.get(p[0].source, 0) + 1
    if len(taken) < want:   # fewer sources than the cap allows: fill from the rest in rank order
        rest = [p for p in pending if p not in taken]
        taken += rest[: want - len(taken)]
    return taken


def expire_old(db, now: datetime) -> int:
    try:
        return len(db.update("opportunities", {"status": "expired"}, status="new", deadline_at=f"lt.{now.isoformat()}"))
    except DBError:
        return 0


def run(db: DB | None = None, llm=llm_mod, now: datetime | None = None, *, fetchers: dict | None = None,
        per_day: int | None = None, sources: list[str] | None = None, dry: bool = False) -> dict:
    db = db or DB()
    now = now or datetime.now(timezone.utc)
    run_id = ledger.new_run_id()

    def beat(status: str, **detail) -> dict:
        out = {"run_id": run_id, **detail}
        if not dry:
            ledger.heartbeat(db, AGENT, status, out)
        return out

    if not dry and settings_mod.tenders_paused(db):
        return beat("ok", state="paused")
    want = per_day if per_day is not None else settings_mod.tenders_per_day(db)
    enabled = sources if sources is not None else settings_mod.tenders_sources(db)
    lo, hi = settings_mod.tenders_value_band(db)
    c = dict.fromkeys(("fetched", "relevant", "deadline_out", "value_out", "known", "excluded", "candidates", "scored",
                       "score_failed", "stored", "expired"), 0)
    if not dry:
        c["expired"] = expire_old(db, now)
    if want <= 0 or not enabled:
        return beat("ok", state="idle", **c)

    since = now.date() - timedelta(days=LOOKBACK_DAYS)
    opps, report = feeds.collect(enabled, since, fetchers)
    c["fetched"] = len(opps)
    seen_ids: set[tuple[str, str]] = set()
    keep: list[Opp] = []
    for o in opps:
        if (o.source, o.source_id) in seen_ids:
            continue
        seen_ids.add((o.source, o.source_id))
        if not filters.is_relevant(o):
            continue
        c["relevant"] += 1
        if not filters.deadline_ok(o, now):
            c["deadline_out"] += 1
        elif not filters.value_ok(o, lo, hi):
            c["value_out"] += 1
        else:
            keep.append(o)
    stored = known_ids(db, keep)
    fresh = [o for o in keep if (o.source, o.source_id) not in stored]
    c["known"] = len(keep) - len(fresh)

    rows: list[dict] = []
    pending: list[tuple[Opp, dict]] = []
    for o in fresh:
        elig = eligibility.assess(o)
        if elig["status"] == "exclude":
            c["excluded"] += 1
            rows.append(excluded_row(o, elig, now))
        else:
            pending.append((o, elig))
    pending.sort(key=lambda p: (-filters.relevance(p[0]), p[0].deadline_at or now + timedelta(days=3650)))
    c["candidates"] = len(pending)

    slugs = loader.offer_slugs()
    schema = schemas.tender_fit(slugs)
    system = loader.compose("tender_fit", {"catalogue": catalogue_lines()})
    budget_hit = False
    for o, elig in pick(pending, want):
        try:
            fit, _ = llm.ask(db, AGENT, run_id, system, brief(o, elig), schema, model="haiku")
        except llm_mod.BudgetExceeded:
            budget_hit = True
            break
        except llm_mod.LLMError as e:
            c["score_failed"] += 1  # not stored: it is retried on the next run
            _log(db, run_id, "tender_score_failed", None, source=o.source, source_id=o.source_id, error=str(e)[:200])
            continue
        if fit.get("offer_slug") not in slugs:
            c["score_failed"] += 1
            continue
        fit["eligibility"] = merge_eligibility(elig, fit.get("eligibility") or {})
        fit["score"] = max(0, min(100, int(fit["score"])))
        rows.append(build_row(o, "new", fit, now))
        c["scored"] += 1

    out_rows = []
    for row in rows:
        if dry:
            out_rows.append(row)
            continue
        made = insert(db, row)
        if made:
            c["stored"] += 1
            kind = "tender_excluded" if row["status"] == "pass" else "tender_scored"
            _log(db, run_id, kind, made["id"], source=row["source"], score=(row["fit"] or {}).get("score"),
                 eligibility=(row["fit"] or {}).get("eligibility", {}).get("status"))
    failed = [s for s, r in report.items() if not r["ok"] and not r.get("disabled")]
    status = "warn" if (budget_hit or failed or c["score_failed"]) else "ok"
    detail = {"feeds": {s: (r["n"] if r["ok"] else ("disabled" if r.get("disabled") else "failed: " + r["error"]))
                        for s, r in report.items()},
              "budget_exceeded": budget_hit, **c}
    if dry:
        detail["run_id"] = run_id
        detail["rows"] = sorted(out_rows, key=lambda r: -((r["fit"] or {}).get("score") or 0))
        return detail
    out = beat(status, **detail)
    _log(db, run_id, "tenders_run", None, **{k: v for k, v in detail.items() if k != "feeds"})
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Epsilon OS tenders (S1)")
    ap.add_argument("--dry-run", action="store_true",
                    help="real feeds and real model calls, nothing stored (in-memory fake DB), prints rows as JSON")
    ap.add_argument("--n", type=int, default=5, help="model calls in a dry run")
    ap.add_argument("--sources", help="comma list of sources for a dry run (default: all enabled by default)")
    a = ap.parse_args(argv)
    if not a.dry_run:
        print({k: v for k, v in run().items() if k != "rows"})  # same as the launchd job
        return 0
    from tests.fakes import FakeDB
    db = FakeDB()  # never the live database
    src = a.sources.split(",") if a.sources else None
    res = run(db, llm_mod, now=datetime.now(timezone.utc), per_day=a.n, sources=src, dry=True)
    print(json.dumps(res, indent=2, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
