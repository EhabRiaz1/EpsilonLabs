"""Pakistan PPRA EPMS tender feed: parser on a recorded, sanitised sample of the real listing page
(tests/fixtures/tenders/ppra_epms_active.html), the keyword pre-filter, PEC/FBR/OEM eligibility hints, polite paging,
and the once-a-day run inside agents/tenders.py. Offline: HTTP goes through httpx.MockTransport."""
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from agents import tenders
from core import feeds, settings as cfg
from core.feeds import base, eligibility, filters, ppra_epms
from core.feeds.base import Opp
from tests.fakes import FakeDB
from tests.test_tenders_agent import FakeLLM, fit

FX = (Path(__file__).parent / "fixtures" / "tenders" / "ppra_epms_active.html").read_text()
NOW = datetime(2026, 10, 13, 3, 0, tzinfo=timezone.utc)      # 08:00 PKT
KEPT = {"TS0000015810E", "TS0000015897E", "TS0000015365E", "TS0000015253E", "TS0000015477E", "TS0000015292E",
        "TS0000015320E"}


@pytest.fixture()
def pauses(monkeypatch):
    slept = []
    monkeypatch.setattr(base, "_sleep", lambda s: slept.append(s))
    return slept


def parsed() -> dict[str, Opp]:
    rows, total = ppra_epms.parse_page(FX)
    assert total == 45
    return {o.source_id: o for o in rows}


# ---------------------------------------------------------------- parser

def test_parse_real_sample_fields():
    rows = parsed()
    assert len(rows) == 15 and all(k.startswith("TS") and k.endswith("E") for k in rows)
    o = rows["TS0000015477E"]
    assert o.source == "ppra_epms" and o.country == "PK" and o.currency == "PKR"
    assert o.title.startswith("Supply, Installation, Commissioning and Testing of IP Based CCTV System")
    assert o.url == "https://epms.ppra.gov.pk/public/tenders/tender-details/TS0000015477E"
    assert o.raw["category"] == "Services" and o.raw["city"] == "Karachi" and "SSGC" in o.buyer
    assert o.published_at.date() == date(2026, 10, 6)
    assert o.deadline_at == datetime(2026, 10, 21, 11, 30, tzinfo=timezone(timedelta(hours=5)))   # 11:30 AM PKT
    assert o.value_min is None and o.value_max is None
    assert "Value: not stated (PKR)" in o.summary and "City: Karachi" in o.summary
    army = rows["TS0000015874E"]
    assert army.buyer == "Directorate General Procurement (Army)" and army.raw["city"] == "Rawalpindi"
    assert army.deadline_at == datetime(2026, 12, 29, 4, 30, tzinfo=timezone.utc)                  # 09:30 AM PKT


def test_unrecognised_page_parses_to_nothing():
    assert ppra_epms.parse_page("<html>maintenance</html>") == ([], None)


# ---------------------------------------------------------------- pre-filter

def test_keyword_prefilter_keeps_our_work_and_drops_supply_and_works():
    rows = parsed()
    assert {k for k, o in rows.items() if ppra_epms.wanted(o)} == KEPT
    # military spares, stationery, construction, vehicles, PEC civil works, plain IT hardware supply
    for k in ("TS0000015874E", "TS0000015920E", "TS0000014567E", "TS0000015863E", "TS0000015412E", "TS0000015836E"):
        assert not ppra_epms.wanted(rows[k]), k
    # every kept notice also passes the shared relevance filter, so it reaches fit-scoring
    assert all(filters.is_relevant(rows[k]) for k in KEPT)


def test_organisation_names_never_count_as_keywords():
    o = Opp(source="ppra_epms", source_id="TS1E", title="Purchase of Photostat Papers", country="PK",
            summary="Category: Stationery. Procuring office: Pakistan Software Export Board (PSEB).",
            buyer="Pakistan Software Export Board (PSEB)", raw={"category": "Stationery"})
    assert not ppra_epms.wanted(o)
    o2 = Opp(source="ppra_epms", source_id="TS2E", title="Annual maintenance", country="PK",
             summary="Category: Services. Procuring office: Pakistan Revenue Automation (Pvt) Limited.", raw={})
    assert not ppra_epms.wanted(o2)


# ---------------------------------------------------------------- eligibility hints

def test_pec_flags_are_read_from_the_notice_text():
    rows = parsed()
    assert rows["TS0000015412E"].raw["eligibility_flags"] == ["PEC C-6", "PEC specialisation CE-10"]
    assert rows["TS0000015803E"].raw["eligibility_flags"] == ["PEC C-5", "PEC specialisation CE-08"]
    assert rows["TS0000015477E"].raw["eligibility_flags"] == []
    assert eligibility.pk_flags("Firms registered with Pakistan Engineering Council (category C-4) and FBR active "
                                "taxpayer list; OEM authorization letter required") == \
        ["PEC C-4", "FBR active taxpayer", "OEM authorisation letter"]
    assert eligibility.pk_flags("Valid PEC registration required.") == ["PEC"]


def test_pec_notice_is_flagged_never_excluded_and_the_note_comes_first():
    text = "SCADA and telemetry upgrade (Having Valid PEC Certificate Category C-6 or above having Specialization of CE-10)"
    o = Opp(source="ppra_epms", source_id="TS9E", title=text, country="PK", summary="Category: Services.",
            raw={"eligibility_flags": eligibility.pk_flags(text)})
    a = eligibility.assess(o)
    assert a["status"] == "flag"
    assert a["notes"][0].startswith("Needs PEC C-6 (Pakistan Engineering Council")
    assert "category C-6 or above" in a["notes"][0] and "specialisation CE-10" in a["notes"][0]


def test_domestic_tender_is_not_excluded_for_residency_or_on_site():
    words = "Bidders must be registered in Pakistan. All work shall be performed on-site at the client's premises."
    pk = Opp(source="ppra_epms", source_id="TS8E", title="SCADA upgrade", summary=words, country="PK", raw={})
    assert eligibility.assess(pk)["status"] != "exclude"
    abroad = Opp(source="ted", source_id="1", title="SCADA upgrade", summary=words, country="DE", raw={})
    assert eligibility.assess(abroad)["status"] == "exclude"   # unchanged for every other source


# ---------------------------------------------------------------- fetch: polite paging

def _client(pages: dict[int, str], seen: list):
    def handler(req):
        seen.append(req)
        return httpx.Response(200, text=pages.get(int(req.url.params.get("page", "1")), ""))
    return httpx.Client(transport=httpx.MockTransport(handler), headers={"User-Agent": base.USER_AGENT})


def test_fetch_reads_every_page_once_a_second_with_our_user_agent(pauses):
    seen = []
    out = ppra_epms.fetch(date(2026, 10, 6), client=_client({n: FX for n in range(1, 46)}, seen))
    assert len(seen) == 45                                   # "Page 1 of 45"
    assert [r.url.params["page"] for r in seen] == [str(n) for n in range(1, 46)]
    assert all(r.url.host == "epms.ppra.gov.pk" and r.url.path == "/public/tenders/active-tenders" for r in seen)
    assert all("epsilon-labs.co" in r.headers["user-agent"] for r in seen)
    assert len(pauses) == 44 and min(pauses) >= 1.0           # never more than one request a second
    assert {o.source_id for o in out} == KEPT                 # the same rows on every page are deduplicated


def test_fetch_stops_at_50_pages_and_on_an_empty_page(pauses):
    seen = []
    many = FX.replace("Page 1 of 45", "Page 1 of 60")
    ppra_epms.fetch(date(2026, 10, 6), client=_client({n: many for n in range(1, 61)}, seen))
    assert len(seen) == ppra_epms.MAX_PAGES == 50
    seen.clear()
    empty = FX[:FX.find("<tbody>") + 7] + FX[FX.find("</tbody>"):]
    ppra_epms.fetch(date(2026, 10, 6), client=_client({1: FX, 2: FX, 3: empty}, seen))
    assert len(seen) == 3


def test_fetch_fails_loudly_on_a_changed_layout(pauses):
    with pytest.raises(base.FeedError):
        ppra_epms.fetch(date(2026, 10, 6), client=_client({1: "<html>new layout</html>"}, []))


# ---------------------------------------------------------------- settings and the tenders agent

def test_source_is_live_and_enabled_by_default():
    assert "ppra_epms" in feeds.LIVE and "ppra_epms" in cfg.TENDER_LIVE
    assert "ppra_epms" in cfg.tenders_sources(FakeDB()) and cfg.TENDER_SOURCE_LABEL["ppra_epms"].startswith("Pakistan PPRA")
    assert cfg.validate("tenders.sources", ["ppra_epms"]) == ["ppra_epms"]
    assert "PK" in cfg.ALWAYS_EXCLUDED                        # cold prospecting still never targets Pakistan


def _pk(sid: str, title: str, **kw) -> Opp:
    return Opp(source="ppra_epms", source_id=sid, title=title, country="PK", currency="PKR", buyer="SSGC",
               summary="Category: Services.", deadline_at=NOW + timedelta(days=20), url=f"https://epms.ppra.gov.pk/x/{sid}",
               raw={"eligibility_flags": eligibility.pk_flags(title)}, **kw)


def test_tenders_run_scores_ppra_with_the_pec_note_and_reads_the_site_once_a_day():
    db, calls = FakeDB(), []
    pec = _pk("TS1E", "SCADA telemetry upgrade (Having Valid PEC Certificate Category C-6 or above)")

    def fetcher(since):
        calls.append(since)
        return [pec, _pk("TS2E", "IP based CCTV system with remote monitoring software")]
    llm = FakeLLM(lambda untrusted: fit(notes=["Bid security required"]))
    r = tenders.run(db, llm, NOW, fetchers={"ppra_epms": fetcher}, sources=["ppra_epms"])
    assert r["stored"] == 2 and len(calls) == 1
    assert '"country": "PK"' in llm.calls[0]["untrusted"] and "domestic bidder" in llm.calls[0]["system"]
    row = next(x for x in db.rows("opportunities") if x["source_id"] == "TS1E")
    assert row["raw"]["eligibility_flags"] == ["PEC C-6"] and row["currency"] == "PKR"
    el = row["fit"]["eligibility"]
    assert el["status"] == "flag" and el["notes"][0].startswith("Needs PEC C-6")
    # a second run the same day (a "Run now") does not crawl the site again
    r2 = tenders.run(db, llm, NOW + timedelta(hours=3), fetchers={"ppra_epms": fetcher}, sources=["ppra_epms"])
    assert len(calls) == 1 and r2["feeds"]["ppra_epms"] == "already read today"
    # the next day it does
    tenders.run(db, llm, NOW + timedelta(days=1), fetchers={"ppra_epms": fetcher}, sources=["ppra_epms"])
    assert len(calls) == 2


def test_a_failed_crawl_is_retried_the_same_day_and_dry_runs_never_skip():
    db, n = FakeDB(), {"c": 0}

    def broken(since):
        n["c"] += 1
        raise base.FeedError("ppra_epms: listing page not recognised (layout changed?)")
    tenders.run(db, FakeLLM(), NOW, fetchers={"ppra_epms": broken}, sources=["ppra_epms"])
    tenders.run(db, FakeLLM(), NOW, fetchers={"ppra_epms": broken}, sources=["ppra_epms"])
    assert n["c"] == 2 and not db.rows("actions", action=tenders.DAILY_ACTION)
    ok = lambda since: []
    tenders.run(db, FakeLLM(), NOW, fetchers={"ppra_epms": ok}, sources=["ppra_epms"])
    assert len(db.rows("actions", action=tenders.DAILY_ACTION)) == 1
    hits = []
    tenders.run(db, FakeLLM(), NOW, fetchers={"ppra_epms": lambda s: hits.append(s) or []}, sources=["ppra_epms"], dry=True)
    assert len(hits) == 1
