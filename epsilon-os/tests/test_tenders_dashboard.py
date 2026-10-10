"""Opportunities page, its actions (CSRF), the Today rail line and the Tenders settings fieldset."""
import http.client
import json
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

import pytest

from dashboard import actions, data, server, views
from tests.fakes import FakeDB

CSS = (Path(__file__).resolve().parents[1] / "dashboard" / "static" / "dashboard.css").read_text()


def iso(**kw):
    return (datetime.now(timezone.utc) + timedelta(**kw)).isoformat()


def opp_row(db, sid, title, score, status="new", days=20, el="ok", notes=(), **kw):
    row = {"source": "ted", "source_id": sid, "title": title, "buyer": "City Water Board", "country": "DE",
           "url": f"https://ted.europa.eu/en/notice/-/detail/{sid}", "deadline_at": iso(days=days, hours=2),
           "value_min": 120000, "value_max": 120000, "currency": "EUR", "summary": "Replace the SCADA historian.",
           "status": status, "cpv_or_naics": ["72000000"],
           "fit": {"score": score, "offer_slug": "plant-visibility-pilot", "reasons": ["asks for a monitoring dashboard"],
                   "requirements": ["web dashboard", "OPC UA connector"], "effort": "medium: about 8 weeks",
                   "what_we_need": ["register on the buyer portal"], "eligibility": {"status": el, "notes": list(notes)}}}
    row.update(kw)
    return db.insert("opportunities", row)[0]


@pytest.fixture()
def live():
    db = FakeDB()
    a = opp_row(db, "a", "SCADA historian replacement", 88, days=21)
    b = opp_row(db, "b", "Mobile app for inspections", 62, days=12, el="flag", notes=["Insurance required (professional indemnity)"])
    c = opp_row(db, "c", "Generic IT support", 20, days=30)
    d = opp_row(db, "d", "Clearance work", 0, status="pass", el="exclude", notes=["Security clearance required"])
    e = opp_row(db, "e", "Already bidding", 70, status="bid")
    srv = server.make_server(db=db, port=0)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv, db, {"a": a["id"], "b": b["id"], "c": c["id"], "d": d["id"], "e": e["id"]}
    srv.shutdown(); srv.server_close()


def call(srv, method, path, body=None, headers=None):
    port = srv.server_address[1]
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request(method, path, body=body, headers={"Host": f"127.0.0.1:{port}", **(headers or {})})
    r = c.getresponse()
    out = (r.status, r.read().decode(), dict(r.getheaders()))
    c.close()
    return out


def form(srv, name, fields, token=True):
    f = dict(fields)
    if token:
        f["csrf"] = srv.app.csrf
    return call(srv, "POST", f"/act/{name}", urlencode(f, doseq=True), {"Content-Type": "application/x-www-form-urlencoded"})


# ---------------------------------------------------------------- the page

def test_page_lists_new_by_score_with_badges_offer_value_deadline(live):
    srv, db, ids = live
    s, body, h = call(srv, "GET", "/opportunities")
    assert s == 200 and "Traceback" not in body and "script-src 'self'" in h["Content-Security-Policy"]
    assert body.index("SCADA historian replacement") < body.index("Mobile app for inspections") < body.index("Generic IT support")
    assert "Clearance work" not in body                                # passed ones are not "new"
    assert 'class="tag sig">OK<' in body and 'class="tag amber">CHECK<' in body
    assert "Insurance required" in body and "Plant Visibility Pilot" in body and "EUR 120k" in body
    assert re.search(r"\b(?:19|20|21)d left", body)                                         # countdown, not a date
    assert "ted.europa.eu" not in body                                                    # official links live in the panel only
    assert re.search(r'href="/opportunities" class=on aria-current=page', body)             # sidebar entry under Work
    assert body.index("Opportunities") < body.index("Pipeline") and "In progress" in body and "Already bidding" in body
    assert "<details class=\"opp-g\">" in body and "Low fit" in body                      # score 20 sits in the fold


def test_panel_shows_the_bid_brief_and_safe_official_link(live):
    srv, db, ids = live
    s, body, _ = call(srv, "GET", f"/opportunities?id={ids['b']}")
    panel = body[body.index('id="opp-panel"'):]
    for needle in ("Why this score", "What the buyer asks for", "web dashboard", "What we would need", "register on the buyer portal",
                   "medium: about 8 weeks", "Insurance required", "Official notice"):
        assert needle in panel, needle
    assert 'target="_blank" rel="noopener noreferrer"' in panel
    assert 'action="/act/opp_bid"' in panel and 'action="/act/opp_pass"' in panel and 'name="reason"' in panel
    assert f'name="csrf" value="{srv.app.csrf}"' in panel
    s, body, _ = call(srv, "GET", "/opportunities?id=nope")
    assert s == 200 and "hidden" in body[body.index('id="opp-panel"'):][:120]


def test_panel_buttons_follow_the_status(live):
    srv, db, ids = live
    panel = call(srv, "GET", f"/opportunities?id={ids['e']}")[1]
    panel = panel[panel.index('id="opp-panel"'):]
    for act in ("opp_submitted", "opp_won", "opp_lost"):
        assert f'action="/act/{act}"' in panel
    assert 'action="/act/opp_bid"' not in panel


def test_untrusted_text_is_escaped_and_javascript_urls_never_become_links():
    db = FakeDB()
    r = opp_row(db, "x", "<script>alert(1)</script> SCADA", 90, url="javascript:alert(1)", summary="<img src=x onerror=alert(1)>",
                buyer="<b>Evil</b>")
    srv = server.make_server(db=db, port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        page = call(srv, "GET", f"/opportunities?id={r['id']}")[1]
        assert "<script>alert(1)" not in page and "&lt;script&gt;alert(1)" in page
        assert "<img src=x" not in page and "<b>Evil" not in page
        panel = page[page.index('id="opp-panel"'):]
        assert "javascript:" not in panel and "No notice link was published" in panel
    finally:
        srv.shutdown(); srv.server_close()


def test_empty_state():
    srv = server.make_server(db=FakeDB(), port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        s, body, _ = call(srv, "GET", "/opportunities")
        assert s == 200 and "No opportunities yet" in body and "06:00" in body
    finally:
        srv.shutdown(); srv.server_close()


def test_both_themes_use_only_existing_tokens_and_classes(live):
    """Theme is a data-theme attribute switched by theme.js; the new CSS must not carry its own colours."""
    srv, db, ids = live
    body = call(srv, "GET", "/opportunities")[1]
    assert 'data-theme="studio"' in body and '/static/theme.js' in body
    block = CSS[CSS.index("/* opportunities */"):]
    assert not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", block), "colours must come from the theme tokens"
    assert "var(--card)" in block and "var(--clip)" in block and "var(--r-lg)" in block      # clipped corners in Studio, radius in Console
    for token in re.findall(r"var\((--[a-z0-9-]+)", block):
        assert re.search(rf"{re.escape(token)}\s*:", CSS[:CSS.index("/* opportunities */")]), token
    # `:root` matches in both themes, so a token defined there reaches Studio and Console alike;
    # the colour and geometry tokens are redefined by the Console block
    studio = CSS[CSS.index(":root,[data-theme=\"studio\"]"):CSS.index("[data-theme=\"console\"]{")]
    console = CSS[CSS.index("[data-theme=\"console\"]{"):CSS.index("*{box-sizing")]
    for token in set(re.findall(r"var\((--[a-z0-9-]+)", block)):
        assert token + ":" in studio, token
    for token in ("--card", "--edge", "--ink2", "--muted", "--green", "--amber", "--clip", "--r-lg"):
        assert token + ":" in console, token
    for cls in ("grid", "tag", "btn", "panel", "phead", "plain", "untrusted", "days", "lbl", "mono", "inl", "inp"):
        assert f".{cls}" in CSS.split("/* opportunities */")[0], cls


# ---------------------------------------------------------------- actions

def test_bid_post_needs_csrf_and_changes_status(live):
    srv, db, ids = live
    assert form(srv, "opp_bid", {"id": ids["a"]}, token=False)[0] == 403
    assert db.rows("opportunities", id=ids["a"])[0]["status"] == "new"
    s, _, h = form(srv, "opp_bid", {"id": ids["a"], "next": "/opportunities"})
    assert s == 303 and h["Location"] == "/opportunities"
    r = db.rows("opportunities", id=ids["a"])[0]
    assert r["status"] == "bid" and r["decided_at"]
    assert db.rows("actions", action="opportunity_bid", target_id=ids["a"])


def test_pass_stores_reason_and_origin_check(live):
    srv, db, ids = live
    s, _, _ = form(srv, "opp_pass", {"id": ids["c"], "reason": "  not our   thing  "})
    r = db.rows("opportunities", id=ids["c"])[0]
    assert s == 303 and r["status"] == "pass" and r["notes"] == "not our thing"
    form(srv, "opp_pass", {"id": ids["b"], "reason": ""})
    assert db.rows("opportunities", id=ids["b"])[0]["status"] == "pass" and not db.rows("opportunities", id=ids["b"])[0].get("notes")
    port = srv.server_address[1]
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("POST", "/act/opp_bid", urlencode({"id": ids["a"], "csrf": srv.app.csrf}),
              {"Host": f"127.0.0.1:{port}", "Origin": "http://evil.example", "Content-Type": "application/x-www-form-urlencoded"})
    assert c.getresponse().status == 403


def test_json_api_with_header_token(live):
    srv, db, ids = live
    s, body, _ = call(srv, "POST", "/api/opp_pass", json.dumps({"id": ids["a"], "reason": "x"}),
                      {"Content-Type": "application/json", "X-CSRF-Token": srv.app.csrf})
    assert s == 200 and json.loads(body)["ok"]
    s, _, _ = call(srv, "POST", "/api/opp_pass", json.dumps({"id": ids["b"]}), {"Content-Type": "application/json"})
    assert s == 403


def test_lifecycle_bid_submitted_won_and_lost(live):
    srv, db, ids = live
    d = db
    assert actions.opp_decide(d, ids["a"], "submitted")["error"] == "conflict"            # cannot submit what was never bid
    assert actions.opp_decide(d, ids["a"], "bid")["ok"]
    assert actions.opp_decide(d, ids["a"], "submitted")["ok"]
    assert actions.opp_decide(d, ids["a"], "won")["ok"] and d.rows("opportunities", id=ids["a"])[0]["status"] == "won"
    assert actions.opp_decide(d, ids["a"], "bid")["error"] == "conflict"                  # closed is closed
    assert actions.opp_decide(d, ids["e"], "lost")["ok"] and d.rows("opportunities", id=ids["e"])[0]["status"] == "lost"
    assert actions.opp_decide(d, ids["d"], "bid")["ok"]                                   # a passed one can be revived
    assert actions.opp_decide(d, "missing", "bid")["error"] == "not_found"
    assert actions.opp_decide(d, ids["a"], "explode")["error"] == "unknown_action"


def test_failed_transition_shows_a_message_not_a_trace(live):
    srv, db, ids = live
    s, body, _ = form(srv, "opp_won", {"id": ids["c"]})
    assert s == 409 and "Couldn" in body and "Traceback" not in body


def test_won_lost_totals_show_on_the_page(live):
    srv, db, ids = live
    actions.opp_decide(db, ids["e"], "won")
    body = call(srv, "GET", "/opportunities")[1]
    assert "1 won" in body


# ---------------------------------------------------------------- Today rail

def test_today_rail_line_counts_new_and_worth_a_look(live):
    srv, db, ids = live
    body = call(srv, "GET", "/")[1]
    assert "3 new, 2 worth a look" in body          # a, b, c are new; a (88) and b (62) are >= 60
    assert data.tenders_summary(db, data.now_utc()) == {"new": 3, "worth": 2}


def test_today_still_renders_when_the_table_is_missing(monkeypatch, live):
    srv, db, ids = live
    real = db.select

    def select(table, **kw):
        if table == "opportunities":
            raise RuntimeError("relation does not exist")
        return real(table, **kw)
    monkeypatch.setattr(db, "select", select)
    s, body, _ = call(srv, "GET", "/")
    assert s == 200 and "worth a look" not in body


# ---------------------------------------------------------------- settings fieldset

def test_settings_form_has_tenders_fieldset(live):
    srv, db, _ = live
    body = call(srv, "GET", "/settings")[1]
    assert ">Tenders<" in body
    for name in ("tenders_per_day", "tenders_value_min", "tenders_value_max", "tenders_paused"):
        assert f'name="{name}"' in body
    assert body.count('name="tenders_sources"') == 9 and "Shipped disabled" in body
    assert 'name="tenders_per_day" type="number"' in body or 'name="tenders_per_day"' in body


GOOD = {"per_day": "12", "segments": ["industrial"], "daily_budget": "300", "daily_cap": "25", "address": "",
        "tenders_per_day": "20", "tenders_value_min": "15000", "tenders_value_max": "250000",
        "tenders_sources": ["ted", "worldbank"], "tenders_paused": "1"}


def test_saving_tender_settings(live):
    srv, db, _ = live
    s, _, h = form(srv, "settings", GOOD)
    assert s == 303
    from core import settings as cfg
    assert cfg.tenders_per_day(db) == 20 and cfg.tenders_value_band(db) == (15000, 250000)
    assert cfg.tenders_sources(db) == ["ted", "worldbank"] and cfg.tenders_paused(db) is True
    assert cfg.per_day(db) == 12                                      # the rest of the form still saves


def test_invalid_tender_settings_save_nothing_and_show_inline_errors(live):
    srv, db, _ = live
    s, body, _ = form(srv, "settings", {**GOOD, "tenders_per_day": "99", "per_day": "7"})
    assert s == 422 and "Enter a whole number from 0 to 50" in body and 'value="99"' in body
    from core import settings as cfg
    assert cfg.tenders_per_day(db) == 15 and cfg.per_day(db) == 40
    s, body, _ = form(srv, "settings", {**GOOD, "tenders_value_min": "900000"})
    assert s == 422 and "minimum cannot be above" in body
    s, body, _ = form(srv, "settings", {k: v for k, v in GOOD.items() if k != "tenders_sources"})
    assert s == 422 and "Pick at least one source" in body


def test_old_style_settings_post_without_tender_fields_still_works(live):
    srv, db, _ = live
    s, _, _ = form(srv, "settings", {"per_day": "9", "segments": ["industrial"], "daily_budget": "300", "daily_cap": "25"})
    from core import settings as cfg
    assert s == 303 and cfg.per_day(db) == 9 and cfg.tenders_per_day(db) == 15


def test_tender_settings_validation_and_defaults():
    from core import settings as cfg
    db = FakeDB()
    assert cfg.tenders_per_day(db) == 15 and cfg.tenders_value_band(db) == (10000, 500000) and not cfg.tenders_paused(db)
    assert cfg.tenders_sources(db) == list(cfg.TENDER_LIVE) and "etimad" not in cfg.tenders_sources(db)
    for key, bad in (("tenders.per_day", 51), ("tenders.per_day", "x"), ("tenders.value_min", -1), ("tenders.sources", []),
                     ("tenders.sources", ["nope"]), ("tenders.paused", "yes")):
        with pytest.raises(cfg.SettingsError):
            cfg.validate(key, bad)
    cfg.set(db, "tenders.value_min", 900000)
    assert cfg.tenders_value_band(db) == (500000, 900000)              # a swapped pair is read sensibly


def test_money_and_countdown_formatting():
    now = datetime(2026, 10, 11, tzinfo=timezone.utc)
    assert data.fmt_amount(4_000_000) == "4M" and data.fmt_amount(1_250_000) == "1.2M" and data.fmt_amount(85_000) == "85k"
    assert data.opp_value({"value_min": 10000, "value_max": 20000, "currency": "GBP"}) == "GBP 10k-20k"
    assert data.opp_value({}) == "Not stated"
    assert data.countdown((now + timedelta(days=3, hours=1)).isoformat(), now) == ("3d left", "red")
    assert data.countdown((now + timedelta(days=12, hours=1)).isoformat(), now) == ("12d left", "")
    assert data.countdown(None, now)[0] == "No deadline stated" and data.countdown((now - timedelta(days=1)).isoformat(), now)[0] == "Closed"
