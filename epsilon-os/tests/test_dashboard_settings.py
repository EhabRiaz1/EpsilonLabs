"""Dashboard Settings page, prospector surfaces, outbound deck card."""
import re
import threading
from urllib.parse import urlencode

import pytest

from core import mail, settings
from dashboard import server
from dashboard.demo import seeded_db
from tests.test_dashboard_http import call


@pytest.fixture()
def live():
    db = seeded_db()
    srv = server.make_server(db=db, port=0, demo=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv, db
    srv.shutdown(); srv.server_close()


def form(srv, fields, token=True, **kw):
    pairs = list(fields.items()) if isinstance(fields, dict) else fields
    pairs = [(k, v) for k, v in pairs]
    if token:
        pairs.append(("csrf", srv.app.csrf))
    flat = []
    for k, v in pairs:
        for x in (v if isinstance(v, list) else [v]):
            flat.append((k, x))
    return call(srv, "POST", "/act/settings", urlencode(flat),
                {"Content-Type": "application/x-www-form-urlencoded", **kw.pop("headers", {})}, **kw)


GOOD = {"per_day": "12", "segments": ["industrial", "smb_software"], "paused": "1", "daily_budget": "300",
        "daily_cap": "25", "address": "Ehab@Outreach.example"}


def test_get_settings_renders_form_nav_and_status(live):
    s, body, h = call(live[0], "GET", "/settings")
    assert s == 200 and "Traceback" not in body
    assert 'action="/act/settings"' in body and 'name="csrf"' in body
    for name in ("per_day", "daily_budget", "daily_cap", "address", "paused"):
        assert f'name="{name}"' in body
    # all three segments on by default (counted per field: other fieldsets, e.g. Tenders, have their own checkboxes)
    assert body.count('name="segments"') == 3 and len(re.findall(r'name="segments"[^>]*checked', body)) == 3
    assert re.search(r'href="/settings" class=on aria-current=page', body)        # sidebar entry, active
    assert "Outreach status" in body and "Configured" in body and "Sent today" in body and "Today's cap" in body
    assert "script-src 'self'" in h["Content-Security-Policy"]


def test_post_without_or_with_wrong_csrf_is_403_and_saves_nothing(live):
    srv, db = live
    assert form(srv, GOOD, token=False)[0] == 403
    s, _, _ = call(srv, "POST", "/act/settings", urlencode({**GOOD, "csrf": "nope"}, doseq=True),
                   {"Content-Type": "application/x-www-form-urlencoded"})
    assert s == 403 and db.rows("settings") == []
    assert form(srv, GOOD, headers={"Origin": "http://evil.example"})[0] == 403
    assert form(srv, GOOD, host="evil.example")[0] == 403


def test_valid_post_saves_redirects_and_page_shows_values(live):
    srv, db = live
    s, _, h = form(srv, GOOD)
    assert s == 303 and h["Location"] == "/settings?saved=1"
    assert settings.per_day(db) == 12 and settings.segments(db) == ["industrial", "smb_software"]
    assert settings.paused(db) is True and settings.daily_budget(db) == 300 and settings.daily_cap(db) == 25
    assert settings.outreach_address(db) == "ehab@outreach.example"
    assert db.rows("actions", action="settings_changed")
    s, body, _ = call(srv, "GET", "/settings?saved=1")
    assert "Saved." in body and 'value="12"' in body and 'value="300"' in body
    assert re.search(r'name="address"[^>]*readonly', body) or re.search(r'readonly[^>]*name="address"', body)
    assert re.search(r'value="smb_software" checked', body) and not re.search(r'value="oem_hardware" checked', body)
    # the budget shown in the status popover now follows the setting
    assert "/300 calls" in body


def test_invalid_post_shows_inline_errors_keeps_input_and_saves_nothing(live):
    srv, db = live
    s, body, _ = form(srv, {**GOOD, "per_day": "99", "daily_cap": "abc", "segments": [], "daily_budget": "10"})
    assert s == 422 and db.rows("settings") == []
    assert "Nothing was saved" in body
    assert body.count('class="fielderr"') + body.count('role="alert"') >= 4
    assert "from 0 to 50" in body and "from 50 to 1000" in body and "from 0 to 100" in body
    assert "Pick at least one segment" in body
    assert 'value="99"' in body and 'value="abc"' in body            # what you typed is kept
    assert 'aria-invalid=true' in body


def test_address_is_read_only_once_set_and_cannot_be_changed_by_post(live):
    srv, db = live
    settings.set(db, "outreach.address", "first@outreach.example")
    form(srv, {**GOOD, "address": "other@evil.example"})
    assert settings.outreach_address(db) == "first@outreach.example"
    _, body, _ = call(srv, "GET", "/settings")
    assert "first@outreach.example" in body and "readonly" in body


def test_bad_address_is_an_inline_error(live):
    srv, db = live
    s, body, _ = form(srv, {**GOOD, "address": "not an email"})
    assert s == 422 and "Enter a full email address" in body and 'value="not an email"' in body


def test_unchecked_paused_means_not_paused(live):
    srv, db = live
    settings.set(db, "prospector.paused", True)
    form(srv, {k: v for k, v in GOOD.items() if k != "paused"})
    assert settings.paused(db) is False


def test_outreach_status_block_when_configured(live, monkeypatch):
    srv, db = live
    settings.set(db, "outreach.address", "ehab@outreach.example")
    monkeypatch.setattr(mail, "outreach_mailbox", lambda a, secret=None: object())
    _, body, _ = call(srv, "GET", "/settings")
    assert "<b>Yes</b>" in body and "sending live" in body


def test_today_rail_shows_prospector_count(live):
    _, body, _ = call(live[0], "GET", "/")
    assert "Prospector" in body and "1 found today" in body


def test_deck_outbound_card_has_tag_and_waiting_note_until_outreach_is_live(live, monkeypatch):
    srv, db = live
    _, body, _ = call(srv, "GET", "/deck")
    assert '<span class="tag out">OUTBOUND</span>' in body
    assert "Will send once the outreach domain is live" in body
    assert "Why them" in body and "jobs.example.org/northmill" in body   # the evidence, not "no inbound text"
    settings.set(db, "outreach.address", "ehab@outreach.example")
    monkeypatch.setattr(mail, "outreach_mailbox", lambda a, secret=None: object())
    _, body, _ = call(srv, "GET", "/deck")
    assert "Will send once the outreach domain is live" not in body and "OUTBOUND" in body


def test_health_shows_state_text_for_idle_agents(live):
    _, body, _ = call(live[0], "GET", "/health")
    assert "not configured" in body and "Prospector" in body and "Outreach" in body


def test_referrer_policy_lets_browsers_send_a_real_origin_on_form_posts(live):
    # With "no-referrer" Chromium sends `Origin: null` on same-origin form POSTs, which the origin check
    # rightly refuses, so every HTML-form button (Held tray, Failed/Verify, Settings) returned "Forbidden origin".
    s, body, h = call(live[0], "GET", "/settings")
    assert h["Referrer-Policy"] == "same-origin" and '<meta name="referrer" content="same-origin">' in body
    assert call(live[0], "POST", "/act/settings", "csrf=x", {"Origin": "null", "Content-Type": "application/x-www-form-urlencoded"})[0] == 403
