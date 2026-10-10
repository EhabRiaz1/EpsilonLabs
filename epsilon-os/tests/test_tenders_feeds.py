"""Tender feeds: every parser against a recorded real sample (tests/fixtures/tenders), the filters, the eligibility
rules and the feed plumbing. Offline: HTTP goes through httpx.MockTransport."""
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from core import feeds
from core.feeds import (austender, base, canadabuys, ebrd, eligibility, filters, samgov, ted, uk_cf, uk_fts, ungm,
                        worldbank)
from core.feeds.base import Opp

FX = Path(__file__).parent / "fixtures" / "tenders"
NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(base, "_sleep", lambda s: None)


def fx(name: str) -> str:
    return (FX / name).read_text()


def mock(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), headers={"User-Agent": base.USER_AGENT})


def opp(**kw) -> Opp:
    d = dict(source="ted", source_id="1", title="SCADA upgrade", summary="", deadline_at=NOW + timedelta(days=30))
    d.update(kw)
    return Opp(**d)


# ---------------------------------------------------------------- parsers on recorded samples

def test_ted_parse_real_sample():
    notices = json.loads(fx("ted_search.json"))["notices"]
    opps = [o for o in (ted.parse(n) for n in notices) if o]
    assert len(opps) == len(notices) >= 2
    o = opps[0]
    assert o.source == "ted" and o.source_id == notices[0]["publication-number"]
    assert o.url == f"https://ted.europa.eu/en/notice/-/detail/{o.source_id}"
    assert len(o.country) == 2 and o.title and o.deadline_at and o.deadline_at.tzinfo
    assert all(c.isdigit() for c in o.cpv_or_naics)


def test_ted_fetch_paginates_and_dedupes():
    notices = json.loads(fx("ted_search.json"))["notices"]
    calls = []

    def handler(req):
        body = json.loads(req.content)
        calls.append(body)
        page = notices if body["page"] == 1 else notices[:1]
        # a full page means "ask for more"; pad to PAGE on the first page of the first query only
        if body["page"] == 1 and len(calls) == 1:
            page = (notices * 100)[: ted.PAGE]
        return httpx.Response(200, json={"notices": page})
    out = ted.fetch(date(2026, 10, 7), client=mock(handler), today=date(2026, 10, 11))
    assert len(out) == len({n["publication-number"] for n in notices})
    assert "deadline-receipt-tender-date-lot>=20261021" in calls[0]["query"]   # >= 10 days out is asked of the API
    assert "FT~scada" in calls[0]["query"] and "classification-cpv=72*" in calls[-1]["query"]
    assert calls[1]["page"] == 2


def test_ted_prefers_english_and_flags_other_languages():
    n = {"publication-number": "9-2026", "notice-title": {"deu": "Wartung"}, "buyer-name": {"deu": ["Stadt"]},
         "buyer-country": ["DEU"], "deadline-receipt-tender-date-lot": ["2026-12-01+01:00"],
         "estimated-value-lot": ["50000", "90000"], "estimated-value-cur-lot": ["EUR"]}
    o = ted.parse(n)
    assert o.raw["non_english"] and o.country == "DE" and o.value_min == 50000 and o.value_max == 90000
    assert o.deadline_at == datetime(2026, 12, 1, 12, tzinfo=timezone.utc)
    assert eligibility.assess(o)["status"] == "flag"


def test_uk_fts_parse_and_fetch_follows_cursor():
    pkg = json.loads(fx("uk_fts_release_package.json"))
    rels = pkg["releases"]
    seen = []

    def handler(req):
        seen.append(str(req.url))
        if len(seen) == 1:
            return httpx.Response(200, json={"releases": rels[:1], "links": {"next": "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?cursor=abc"}})
        return httpx.Response(200, json={"releases": rels[1:]})
    out = uk_fts.fetch(date(2026, 10, 8), client=mock(handler))
    assert len(out) == len(rels) and "cursor=abc" in seen[1]
    o = out[0]
    assert o.source == "uk_fts" and o.source_id.startswith("ocds-") and o.country == "GB"
    assert o.url.startswith("https://www.find-tender.service.gov.uk/Notice/") and o.deadline_at


def test_uk_cf_parse_uses_notice_document_url_and_walks_windows():
    pkg = json.loads(fx("uk_cf_release_package.json"))
    n = []

    def handler(req):
        n.append(dict(req.url.params))
        return httpx.Response(200, json=pkg)
    out = uk_cf.fetch(date(2026, 10, 8), client=mock(handler), today=date(2026, 10, 11))
    assert [p["publishedFrom"] for p in n] == ["2026-10-08", "2026-10-10"]    # two-day windows, to is exclusive
    assert len(out) == len(pkg["releases"])                                   # overlap deduped by ocid
    assert all(o.url.startswith("https://www.contractsfinder.service.gov.uk/Notice/") for o in out)


def test_canadabuys_parse_csv_and_ignores_unscheme_codes():
    out = canadabuys.parse(fx("canadabuys_open.csv"))
    assert len(out) >= 3
    o = out[0]
    assert o.source == "canadabuys" and o.country == "CA" and o.url.startswith("http") and o.title
    assert not filters.code_match(opp(source="canadabuys", cpv_or_naics=["72000000"]))  # UNSPSC is not CPV


def test_canadabuys_fetch_filters_by_publication_date():
    def handler(req):
        assert req.headers["user-agent"] == base.USER_AGENT
        return httpx.Response(200, content=fx("canadabuys_open.csv").encode())
    all_ = canadabuys.parse(fx("canadabuys_open.csv"))
    newest = max(o.published_at for o in all_ if o.published_at)   # a row with no publication date is kept, not dropped
    got = canadabuys.fetch(newest.date(), client=mock(handler))
    assert got and all(o.published_at is None or o.published_at >= base.as_datetime(newest.date()) for o in got)
    assert len(got) < len(all_) or all(o.published_at == newest for o in all_ if o.published_at)


def test_austender_rss_then_detail_page():
    items = austender.parse_rss(fx("austender_rss.xml"))
    assert len(items) == 4 and items[0]["uuid"] and items[0]["link"].startswith("https://www.tenders.gov.au/Atm/Show/")
    detail = austender.parse_detail(fx("austender_atm.html"))
    assert detail["Agency"] and detail["CloseDate"]
    o = austender.build(items[0], detail)
    assert o.source == "austender" and o.country == "AU" and o.deadline_at and o.buyer == detail["Agency"]

    def handler(req):
        return httpx.Response(200, text=fx("austender_rss.xml") if req.url.path.endswith("rss.xml") else fx("austender_atm.html"))
    got = austender.fetch(date(2000, 1, 1), client=mock(handler))
    assert len(got) == 4 and got[0].buyer


def test_austender_close_time_is_canberra_local():
    assert austender.parse_close("12-Oct-2026 2:00 pm (ACT Local Time)") == datetime(2026, 10, 12, 3, 0, tzinfo=timezone.utc)


def test_ungm_parse_rows():
    rows = ungm.parse_rows(fx("ungm_rows.html"))
    assert len(rows) == 3
    r = rows[0]
    assert r.source == "ungm" and r.source_id.isdigit() and r.url.endswith(r.source_id)
    assert r.title and r.buyer and r.deadline_at and r.published_at and r.country


def test_ungm_fetch_uses_antiforgery_token_and_fails_loudly_on_layout_change():
    seen = {}

    def good(req):
        if req.method == "GET":
            return httpx.Response(200, text='<input name="__RequestVerificationToken" type="hidden" value="TOK123" />')
        seen["token"] = req.headers.get("requestverificationtoken")
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, text=fx("ungm_rows.html"))
    out = ungm.fetch(date(2000, 1, 1), client=mock(good), terms=["software"])
    assert seen["token"] == "TOK123" and seen["body"]["PageSize"] == 15 and len(out) == 3

    def changed(req):
        return httpx.Response(200, text="<html>new layout</html>")
    with pytest.raises(base.FeedError):
        ungm.fetch(date(2000, 1, 1), client=mock(changed))


def test_worldbank_parse_skips_awards_and_drops_contacts():
    notices = json.loads(fx("worldbank_procnotices.json"))["procnotices"]
    opps = [o for o in (worldbank.parse(n) for n in notices) if o]
    assert opps and all(o.source == "worldbank" and o.url.startswith("https://projects.worldbank.org/") for o in opps)
    assert "contact" not in json.dumps([o.row() for o in opps]).lower().replace("contact_", "x")
    assert worldbank.parse({"id": "X", "notice_type": "Contract Award", "bid_description": "x"}) is None
    assert worldbank.parse({"id": "X", "notice_type": "General Procurement Notice", "bid_description": "x"}) is None
    assert worldbank.parse({"id": "X", "notice_type": "Invitation for Bids", "bid_description": "x",
                            "notice_lang_name": "French"}).raw["non_english"]


def test_worldbank_fetch_one_request_per_term():
    pkg = json.loads(fx("worldbank_procnotices.json"))
    qs = []

    def handler(req):
        qs.append(req.url.params["qterm"])
        return httpx.Response(200, json=pkg)
    out = worldbank.fetch(date(2000, 1, 1), client=mock(handler), terms=["software", "scada"])
    assert qs == ["software", "scada"] and len(out) == len({o.source_id for o in out})


def test_ebrd_parse_keeps_open_non_award_notices_only():
    out = ebrd.parse(fx("ebrd_notices.html"))
    assert out and all(o.source == "ebrd" and "displayNoticeId" in o.url for o in out)
    assert all(o.deadline_at for o in out)
    with pytest.raises(base.FeedError):
        ebrd.fetch(date(2000, 1, 1), client=mock(lambda r: httpx.Response(200, text="<html></html>")))


def test_samgov_parse_fixture():
    items = json.loads(fx("samgov_search.json"))["opportunitiesData"]
    a, b, c = (samgov.parse(i) for i in items)
    assert a.source_id == "6ba7c891fdc147868fc0fbca45bd54e7" and a.country == "US" and a.raw["set_aside"] == ""
    assert b.raw["set_aside"] == "SBA" and c.raw["set_aside"] == "" and c.deadline_at is None and c.value_max == 85000


def test_samgov_without_key_is_skipped_silently(monkeypatch, capsys):
    monkeypatch.setattr(samgov.config, "secret", lambda *a: (_ for _ in ()).throw(samgov.config.SecretError("missing")))

    def boom(req):
        raise AssertionError("must not call the API without a key")
    assert samgov.fetch(date(2026, 10, 1), client=mock(boom)) == []
    err = capsys.readouterr().err
    assert "no API key" in err and "Traceback" not in err
    opps, report = feeds.collect(["samgov"], date(2026, 10, 1))
    assert opps == [] and report["samgov"]["ok"]


def test_samgov_key_never_leaks_in_errors():
    def handler(req):
        return httpx.Response(429, text="slow down")
    with pytest.raises(base.FeedError) as ei:
        samgov.fetch(date(2026, 10, 1), client=mock(handler), key="SECRETKEY123")
    assert "SECRETKEY123" not in str(ei.value) and "api.sam.gov" in str(ei.value)


def test_samgov_fetch_sends_key_and_pages(monkeypatch):
    items = json.loads(fx("samgov_search.json"))["opportunitiesData"]
    got = []

    def handler(req):
        got.append(dict(req.url.params))
        return httpx.Response(200, json={"opportunitiesData": items})
    out = samgov.fetch(date(2026, 10, 1), client=mock(handler), today=date(2026, 10, 11), key="K")
    assert len(out) == 3 and got[0]["api_key"] == "K" and got[0]["postedFrom"] == "10/01/2026" and len(got) == 1


@pytest.mark.parametrize("src", feeds.DISABLED)
def test_disabled_feeds_report_disabled_and_make_no_requests(src, capsys):
    opps, report = feeds.collect([src], date(2026, 10, 1))
    assert opps == [] and report[src]["ok"] is False and report[src]["disabled"] is True
    assert "disabled" in report[src]["error"] and capsys.readouterr().err == ""
    assert feeds.module(src).REASON


# ---------------------------------------------------------------- plumbing

def test_request_retries_5xx_then_succeeds_and_gives_up_on_4xx():
    n = {"c": 0}

    def flaky(req):
        n["c"] += 1
        return httpx.Response(503) if n["c"] < 3 else httpx.Response(200, json={"ok": 1})
    assert base.request(mock(flaky), "GET", "https://x.example/a").json() == {"ok": 1} and n["c"] == 3
    n["c"] = 0

    def gone(req):
        n["c"] += 1
        return httpx.Response(404)
    with pytest.raises(base.FeedError):
        base.request(mock(gone), "GET", "https://x.example/a")
    assert n["c"] == 1


def test_one_feed_failing_never_stops_the_others():
    def good(since):
        return [opp(source_id="a")]

    def bad(since):
        raise base.FeedError("ted: HTTP 500")

    def weird(since):
        raise ValueError("boom with details")
    opps, report = feeds.collect(["ted", "uk_fts", "ungm"], date(2026, 10, 1), {"ted": bad, "uk_fts": good, "ungm": weird})
    assert [o.source_id for o in opps] == ["a"]
    assert report["ted"] == {"ok": False, "n": 0, "error": "ted: HTTP 500", "disabled": False}
    assert report["uk_fts"]["ok"] and report["ungm"]["error"] == "ValueError"   # type only, never the message


def test_country_codes():
    assert [base.country_code(x) for x in ("GRC", "England", "USA", "pk", "Kenya", "Atlantis")] == \
        ["GR", "GB", "US", "PK", "KE", "Atlantis"]


# ---------------------------------------------------------------- filters

def test_keyword_relevance_needs_a_keyword_not_just_a_cpv():
    assert filters.is_relevant(opp(title="SCADA system replacement"))
    assert filters.is_relevant(opp(title="Supply", summary="a telemetry and IoT platform"))
    assert not filters.is_relevant(opp(title="Office chairs", cpv_or_naics=["72000000"]))
    generic = filters.keyword_score(opp(title="Monitoring and evaluation of grants"))
    assert 0 < generic < filters.keyword_score(opp(title="SCADA monitoring"))      # generic words rank far below specific ones
    assert filters.relevance(opp(title="Firmware", cpv_or_naics=["72212000"])) == filters.relevance(opp(title="Firmware")) + 1


def test_cpv_only_counts_for_cpv_feeds_and_naics_for_sam():
    assert filters.code_match(opp(source="ted", cpv_or_naics=["72212000"]))
    assert not filters.code_match(opp(source="ted", cpv_or_naics=["45000000"]))
    assert filters.code_match(opp(source="samgov", cpv_or_naics=["541511", "D302"]))
    assert not filters.code_match(opp(source="samgov", cpv_or_naics=["484110"]))   # NAICS 48 is trucking, not CPV 48
    assert not filters.code_match(opp(source="austender", cpv_or_naics=["72100000"]))


def test_keyword_word_boundaries():
    assert filters.keyword_hits("An IoT gateway") == ["iot"]
    assert filters.keyword_hits("Patriotic riot") == []
    assert "plc" in filters.keyword_hits("PLC programming")


def test_deadline_filter_needs_ten_days():
    assert filters.deadline_ok(opp(deadline_at=NOW + timedelta(days=10)), NOW)
    assert not filters.deadline_ok(opp(deadline_at=NOW + timedelta(days=9, hours=23)), NOW)
    assert not filters.deadline_ok(opp(deadline_at=NOW - timedelta(days=1)), NOW)
    assert filters.deadline_ok(opp(deadline_at=None), NOW)


def test_value_band_keeps_unknown_and_converts_currency():
    lo, hi = 10_000, 500_000
    assert filters.value_ok(opp(), lo, hi)                                                   # unknown kept
    assert filters.value_ok(opp(value_min=300_000, value_max=300_000, currency="GBP"), lo, hi)   # ~$381k
    assert not filters.value_ok(opp(value_min=400_000, value_max=400_000, currency="GBP"), lo, hi)  # ~$508k
    assert not filters.value_ok(opp(value_min=5_000, value_max=5_000, currency="USD"), lo, hi)
    assert filters.value_ok(opp(value_min=5_000, value_max=2_000_000, currency="EUR"), lo, hi)   # overlaps the band
    assert filters.value_ok(opp(value_min=1_000_000, value_max=1_000_000, currency="XYZ"), lo, hi)  # unknown currency kept


# ---------------------------------------------------------------- eligibility: every exclude and flag

@pytest.mark.parametrize("text,needle", [
    ("This requirement is a total small business set-aside.", "Set-aside"),
    ("Open only to 8(a) firms", "Set-aside"),
    ("SDVOSB set aside, service-disabled veteran owned", "Set-aside"),
    ("Women-owned small business program", "Set-aside"),
    ("HUBZone certified firms only", "Set-aside"),
    ("Contractor personnel must hold a security clearance (SC cleared).", "clearance"),
    ("A Top Secret facility clearance is required", "clearance"),
    ("Work involves ITAR controlled technical data", "ITAR"),
    ("Items are export controlled under the EAR-controlled regime", "Export"),
    ("Bidders must be registered in Germany at the time of submission.", "registered or established"),
    ("Only locally registered companies may apply", "registered or established"),
    ("Restricted to local firms only", "registered or established"),
    ("All work must be performed on-site at the client's premises, no remote work.", "On-site only"),
    ("Remote work is not permitted for this assignment.", "On-site only"),
])
def test_exclude_rules(text, needle):
    r = eligibility.assess(opp(title="Software service", summary=text))
    assert r["status"] == "exclude" and any(needle.lower() in n.lower() for n in r["notes"]), r


def test_sam_set_aside_code_excludes():
    r = eligibility.assess(opp(source="samgov", raw={"set_aside": "8A"}))
    assert r["status"] == "exclude" and "8A" in r["notes"][0]
    assert eligibility.assess(opp(source="samgov", raw={"set_aside": ""}))["status"] == "flag"   # only the SAM registration flag


@pytest.mark.parametrize("text,needle", [
    ("A local entity or local presence is required", "Local entity"),
    ("Bidders must hold professional indemnity insurance of 1M", "Insurance"),
    ("This procurement is covered by the WTO Government Procurement Agreement", "GPA"),
    ("Tenders must be submitted in French.", "Language"),
])
def test_flag_rules_do_not_exclude(text, needle):
    r = eligibility.assess(opp(summary=text))
    assert r["status"] == "flag" and any(needle in n for n in r["notes"]), r


def test_clean_notice_is_ok_and_portal_registration_is_not_residency():
    assert eligibility.assess(opp(summary="Develop a dashboard. Delivery can be remote."))["status"] == "ok"
    for t in ("Bidders must be registered in SAM.gov before award.", "Suppliers must be registered in the e-Tendering portal"):
        assert eligibility.assess(opp(summary=t))["status"] == "ok", t


def test_onsite_with_remote_component_is_a_flag_not_exclude():
    r = eligibility.assess(opp(summary="On-site presence required for acceptance testing; development is remote."))
    assert r["status"] == "flag"


def test_development_banks_get_member_hint_unless_nationality_restricted():
    r = eligibility.assess(opp(source="worldbank", summary="Supply of a management information system"))
    assert r["status"] == "ok" and "member" in r["notes"][0]
    r = eligibility.assess(opp(source="worldbank", summary="Procurement under National Competitive Bidding (NCB)"))
    assert r["status"] == "flag" and not any("Open to member" in n for n in r["notes"])
    assert eligibility.assess(opp(source="ungm", summary="Software"))["notes"] == [eligibility.MEMBER_HINT]


def test_non_member_banks_are_flagged():
    for src in ("ebrd", "afdb"):
        r = eligibility.assess(opp(source=src, summary="Consultancy"))
        assert r["status"] == "flag" and "not" in r["notes"][0]


def test_worst_status():
    assert eligibility.worst("ok", "flag") == "flag" and eligibility.worst("flag", "exclude", "ok") == "exclude"
