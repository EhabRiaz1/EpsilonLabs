import html
import http.client
import json
import re
import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import pytest

from dashboard import actions, server
from dashboard.demo import seeded_db
from tests.fakes import FakeDB


@pytest.fixture()
def live():
    db = seeded_db()
    srv = server.make_server(db=db, port=0, demo=True)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv, db
    srv.shutdown(); srv.server_close()


def call(srv, method, path, body=None, headers=None, host=None):
    port = srv.server_address[1]
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    h = {"Host": host or f"127.0.0.1:{port}", **(headers or {})}
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    out = (r.status, r.read().decode(), dict(r.getheaders()))
    c.close()
    return out


def jpost(srv, name, payload, token=True, **kw):
    h = {"Content-Type": "application/json"}
    if token:
        h["X-CSRF-Token"] = srv.app.csrf
    h.update(kw.pop("headers", {}))
    s, b, _ = call(srv, "POST", f"/api/{name}", json.dumps(payload), h, **kw)
    return s, (json.loads(b) if b.startswith("{") else b)


def test_binds_loopback_only(live):
    srv, _ = live
    assert srv.server_address[0] == "127.0.0.1"


@pytest.mark.parametrize("path", ["/", "/deck", "/pipeline", "/health", "/static/dashboard.css", "/static/dashboard.js"])
def test_pages_ok(live, path):
    s, body, h = call(live[0], "GET", path)
    assert s == 200 and body
    if path in ("/", "/deck", "/pipeline", "/health"):
        assert 'name="csrf"' in body and "Traceback" not in body
        assert "script-src 'self'" in h["Content-Security-Policy"] and h["X-Frame-Options"] == "DENY"


def test_unknown_path_and_static_traversal(live):
    assert call(live[0], "GET", "/nope")[0] == 404
    assert call(live[0], "GET", "/static/../server.py")[0] == 404
    assert call(live[0], "GET", "/static/server.py")[0] == 404


def test_bad_host_rejected(live):
    srv = live[0]
    for host in ("evil.example", "127.0.0.1:1", "localhost", "attacker.example:8787"):
        assert call(srv, "GET", "/", host=host)[0] == 403
        assert call(srv, "POST", "/api/approve", "{}", {"X-CSRF-Token": srv.app.csrf}, host=host)[0] == 403
    port = srv.server_address[1]
    assert call(srv, "GET", "/", host=f"localhost:{port}")[0] == 200


def test_post_without_or_with_wrong_csrf_is_403(live):
    srv, db = live
    before = [r["status"] for r in db.rows("approval_queue")]
    assert jpost(srv, "approve", {"id": "x"}, token=False)[0] == 403
    assert jpost(srv, "approve", {"id": "x"}, headers={"X-CSRF-Token": "wrong"})[0] == 403
    s, _, _ = call(srv, "POST", "/act/reject", urlencode({"id": "x"}), {"Content-Type": "application/x-www-form-urlencoded"})
    assert s == 403
    assert [r["status"] for r in db.rows("approval_queue")] == before


def test_cross_origin_post_rejected(live):
    srv = live[0]
    assert jpost(srv, "approve", {"id": "x"}, headers={"Origin": "http://evil.example"})[0] == 403


def test_get_cannot_change_state(live):
    srv, db = live
    qid = db.rows("approval_queue")[0]["id"]
    assert call(srv, "GET", f"/api/approve?id={qid}")[0] == 404
    assert call(srv, "GET", f"/act/reject?id={qid}")[0] == 404


def test_approve_undo_round_trip(live):
    srv, db = live
    s, deck, _ = call(srv, "GET", "/deck")
    token = re.search(r'name="csrf" content="([^"]+)"', deck).group(1)
    assert token == srv.app.csrf
    sana = next(r for r in db.rows("approval_queue") if r["to_email"] == "sana.q@mehranmills.example")
    assert f'data-id="{sana["id"]}"' in deck
    s, r = jpost(srv, "approve", {"id": sana["id"]})
    assert s == 200 and r["ok"] and r["status"] == "approved" and r["undo_seconds"] == 10
    assert db.rows("approval_queue", id=sana["id"])[0]["status"] == "approved"
    assert sana["id"] not in call(srv, "GET", "/deck")[1]
    s, r = jpost(srv, "undo", {"id": sana["id"]})
    assert r["ok"] and db.rows("approval_queue", id=sana["id"])[0]["status"] == "pending"
    assert f'data-id="{sana["id"]}"' in call(srv, "GET", "/deck")[1]


def test_undo_after_window_is_too_late(live):
    srv, db = live
    sana = next(r for r in db.rows("approval_queue") if r["to_email"] == "sana.q@mehranmills.example")
    jpost(srv, "approve", {"id": sana["id"]})
    db.update("approval_queue", {"decided_at": (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()},
              id=sana["id"])
    s, r = jpost(srv, "undo", {"id": sana["id"]})
    assert s == 200 and not r["ok"] and r["error"] == "too_late"


def test_lint_confirm_over_http(live):
    srv, db = live
    nadia = next(r for r in db.rows("approval_queue") if r["to_email"] == "nadia@farooqsteel.example")
    assert jpost(srv, "approve", {"id": nadia["id"]})[1]["error"] == "lint_confirm_required"
    assert jpost(srv, "approve", {"id": nadia["id"], "confirm_lint": True})[1]["ok"]


def test_edited_approve_returns_diff(live):
    srv, db = live
    tariq = next(r for r in db.rows("approval_queue") if r["to_email"] == "tariq@masterpaints.example")
    s, r = jpost(srv, "approve", {"id": tariq["id"], "final_text": "Hi Tariq,\n\nI will reply on Friday.\n\nEhab"})
    assert r["ok"] and r["status"] == "edited_approved" and r["diff"]["changed"] >= 1
    assert db.rows("approval_queue", id=tariq["id"])[0]["material_edit"] is True


def test_form_actions_redirect_and_held_flow(live):
    srv, db = live
    held = next(r for r in db.rows("approval_queue") if r["held"])
    form = {"Content-Type": "application/x-www-form-urlencoded"}
    body = urlencode({"csrf": srv.app.csrf, "id": held["id"], "next": "/"})
    s, _, h = call(srv, "POST", "/act/release", body, form)
    assert s == 303 and h["Location"] == "/"
    assert db.rows("approval_queue", id=held["id"])[0]["held"] is False
    body = urlencode({"csrf": srv.app.csrf, "id": held["id"], "next": "//evil.example"})
    s, _, h = call(srv, "POST", "/act/suppress", body, form)
    assert s == 303 and h["Location"] == "/"
    assert db.rows("suppression_list")[0]["email"] == "accounts@pay-update.example"
    s, page, _ = call(srv, "POST", "/act/suppress", body, form)
    assert s == 409 and "Couldn" in page


def test_untrusted_text_is_escaped_everywhere(live):
    srv, db = live
    evil = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    sana = next(r for r in db.rows("approval_queue") if r["to_email"] == "sana.q@mehranmills.example")
    db.update("touches", {"body_excerpt": evil, "subject": evil}, id=sana["in_reply_to_touch_id"])
    deal = db.rows("touches", id=sana["in_reply_to_touch_id"])[0]["deal_id"]
    for path in ("/deck", "/", f"/pipeline?deal={deal}"):
        body = call(srv, "GET", path)[1]
        assert "<script>alert" not in body and "<img src=x" not in body
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in call(srv, "GET", "/deck")[1]


def test_pipeline_panel_fragment_and_filter(live):
    srv, db = live
    deal = db.rows("deals")[0]["id"]
    s, frag, _ = call(srv, "GET", f"/pipeline?fragment=1&deal={deal}")
    assert s == 200 and "Contacts" in frag and "<html" not in frag
    assert call(srv, "GET", "/pipeline?fragment=1&deal=nope")[0] == 404
    s, body, _ = call(srv, "GET", "/pipeline?channel=referral")
    assert s == 200 and "Master Paints" in body and "Lahore Textiles" not in body


def test_empty_states():
    srv = server.make_server(db=FakeDB(), port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        s, today, _ = call(srv, "GET", "/")
        assert s == 200 and "Inbox zero. Nothing needs you." in today and "not set up" in today
        assert "Held" not in today.split('class="state-line"')[1].split("</section>")[0]
        s, deck, _ = call(srv, "GET", "/deck")
        assert s == 200 and 'id="clear"' in deck and "All clear" in deck
        assert "No deals yet" in call(srv, "GET", "/pipeline")[1]
        assert "No actions yet" in call(srv, "GET", "/health")[1]
    finally:
        srv.shutdown(); srv.server_close()


def test_db_failure_renders_error_state_not_a_trace():
    def boom():
        raise RuntimeError("secret-looking detail sk-123")
    srv = server.make_server(db_factory=boom, port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        for path in ("/", "/deck", "/pipeline", "/health"):
            s, body, _ = call(srv, "GET", path)
            assert s == 503 and "Can't reach the database." in html.unescape(body) and "Retry" in body
            assert "Traceback" not in body and "sk-123" not in body
        s, r = jpost(srv, "approve", {"id": "x"})
        assert s == 200 and r["error"] == "db_error" and "sk-123" not in json.dumps(r)
    finally:
        srv.shutdown(); srv.server_close()


def test_action_unit_failure_does_not_leak(live):
    srv, _ = live
    s, r = jpost(srv, "nonsense", {})
    assert s == 404
    assert actions.fail("x", "y")["ok"] is False


def test_launchd_plist_uses_absolute_venv_python_and_keepalive():
    import plistlib
    from pathlib import Path
    p = Path(__file__).resolve().parents[1] / "launchd" / "co.epsilon-labs.os.dashboard.plist"
    d = plistlib.loads(p.read_bytes())
    assert d["ProgramArguments"][0] == "/Users/ehabriaz/dev/epsilon-labs/epsilon-os/.venv/bin/python"
    assert d["KeepAlive"] is True and d["RunAtLoad"] is True
    assert d["ProgramArguments"][1:] == ["-m", "dashboard.server"]
    assert "--demo" not in d["ProgramArguments"]
