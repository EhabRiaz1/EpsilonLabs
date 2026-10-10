"""Epsilon OS local dashboard (D3): stdlib HTTP server, loopback only, no login.

Defences: bind 127.0.0.1 only; Host allow-list (DNS rebinding); every state change is a POST carrying a
per-process CSRF token; Origin must match when present; strict CSP (scripts from self only).
"""
import argparse
import hmac
import json
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from agents import outreach
from dashboard import actions, data, views

HOST = "127.0.0.1"
PORT = 8787
STATIC = Path(__file__).resolve().parent / "static"
STATIC_TYPES = {"dashboard.css": "text/css; charset=utf-8", "theme.js": "text/javascript; charset=utf-8", "dashboard.js": "text/javascript; charset=utf-8"}
CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; "
       "frame-ancestors 'none'; base-uri 'none'")
MAX_BODY = 200_000


class App:
    """Holds the DB (lazily, so a missing keychain item shows an error page, not a crash) and the CSRF token."""

    def __init__(self, db=None, db_factory=None, port=PORT, demo=False):
        self._db, self._factory, self.demo = db, db_factory, demo
        self.csrf = secrets.token_urlsafe(32)
        self.port = port
        self._lock = threading.Lock()

    @property
    def allowed_hosts(self) -> set[str]:
        return {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}

    def db(self):
        with self._lock:
            if self._db is None:
                self._db = self._factory()
            return self._db


def _api(app: App, name: str, p: dict) -> dict:
    db = app.db()
    qid = str(p.get("id") or "")
    if name == "approve":
        ft = p.get("final_text")
        return actions.approve(db, qid, ft if isinstance(ft, str) else None, bool(p.get("confirm_lint")))
    if name == "undo":
        return actions.undo(db, qid)
    if name == "reject":
        return actions.reject(db, qid, str(p.get("reason") or "") or None)
    if name == "later":
        return actions.later(db, qid)
    if name == "release":
        return actions.release_held(db, qid)
    if name == "suppress":
        return actions.suppress_sender(db, qid)
    if name == "retry":
        return actions.retry_failed(db, qid, bool(p.get("confirm")))
    if name == "mark_sent":
        return actions.mark_sent_verified(db, qid)
    if name == "settings":
        return actions.save_settings_all(db, p)
    if name.startswith("opp_"):
        return actions.opp_decide(db, qid, name[4:], str(p.get("reason") or "") or None)
    return actions.fail("unknown_action", "Unknown action.")


ACTION_NAMES = {"approve", "undo", "reject", "later", "release", "suppress", "retry", "mark_sent", "settings",
                "opp_bid", "opp_pass", "opp_submitted", "opp_won", "opp_lost"}
MULTI_FIELDS = {"segments", "tenders_sources"}  # form fields that legitimately repeat (checkbox groups)


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "EpsilonOS"
        sys_version = ""

        def log_message(self, fmt, *args):  # request lines only; never bodies or tokens
            sys.stderr.write("%s %s\n" % (self.command, urlparse(self.path).path))

        # -- plumbing
        def _send(self, status: int, body: bytes, ctype: str = "text/html; charset=utf-8", extra: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "same-origin")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _text(self, status: int, text: str):
            self._send(status, text.encode(), "text/plain; charset=utf-8")

        def _host_ok(self) -> bool:
            return self.headers.get("Host", "") in app.allowed_hosts

        def _origin_ok(self) -> bool:
            o = self.headers.get("Origin")
            return o is None or o in {f"http://{h}" for h in app.allowed_hosts}

        # -- GET
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            if not self._host_ok():
                return self._text(403, "Forbidden host")
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path.startswith("/static/"):
                name = u.path[len("/static/"):]
                if name in STATIC_TYPES:
                    return self._send(200, (STATIC / name).read_bytes(), STATIC_TYPES[name])
                return self._text(404, "Not found")
            try:
                return self._page(u.path, q)
            except Exception as ex:  # DB/credential trouble: error state with Retry, never a trace
                sys.stderr.write(f"page error {u.path}: {type(ex).__name__}\n")
                body = views.error_state(app.csrf, demo=app.demo)
                return self._send(503, body.encode())

        def _page(self, path: str, q: dict):
            now = data.now_utc()
            db = app.db()
            csrf, demo = app.csrf, app.demo
            if path == "/":
                sh = data.shell(db, now)
                html = views.today(csrf, now, sh, data.kpis(db, now), data.pending_cards(db, now, False),
                                   data.pending_cards(db, now, True), data.trouble_cards(db, now),
                                   data.last_sent(db, now), demo)
            elif path == "/deck":
                ready = outreach.status(db, now)["configured"]
                html = views.deck(csrf, data.shell(db, now), data.pending_cards(db, now, False),
                                  data.decided_today(db, now), demo, ready)
            elif path == "/pipeline":
                ch = q.get("channel")
                pnl_data = data.deal_panel(db, q["deal"], now) if q.get("deal") else None
                panel = views.deal_panel(pnl_data) if pnl_data else ""
                if q.get("fragment"):
                    if not panel:
                        return self._text(404, "No such deal")
                    return self._send(200, panel.encode())
                html = views.pipeline(csrf, data.shell(db, now), data.pipeline(db, now, ch), ch, panel, demo)
            elif path == "/health":
                html = views.health(csrf, data.shell(db, now), data.health(db, now), demo)
            elif path == "/opportunities":
                panel = ""
                if q.get("id"):
                    opp = data.opportunity(db, q["id"], now)
                    panel = views.opportunity_panel(csrf, opp, "/opportunities?id=" + q["id"]) if opp else ""
                html = views.opportunities_page(csrf, data.shell(db, now), data.opportunities(db, now), panel, demo)
            elif path == "/settings":
                v = data.settings_view(db, now)
                v["tenders"] = data.tenders_settings(db)
                html = views.settings_page(csrf, data.shell(db, now), v, {}, q.get("saved") == "1", demo)
            else:
                return self._send(404, views.message_page(csrf, "Not found", "No such page.", demo=demo).encode())
            self._send(200, html.encode())

        # -- POST
        def do_POST(self):
            if not self._host_ok():
                return self._text(403, "Forbidden host")
            if not self._origin_ok():
                return self._text(403, "Forbidden origin")
            u = urlparse(self.path)
            is_api, is_form = u.path.startswith("/api/"), u.path.startswith("/act/")
            name = u.path.rsplit("/", 1)[-1]
            if not (is_api or is_form) or name not in ACTION_NAMES:
                return self._text(404, "Not found")
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._text(400, "Bad length")
            if n > MAX_BODY:
                return self._text(413, "Too large")
            raw = self.rfile.read(n) if n else b""
            try:
                if is_api:
                    p = json.loads(raw or b"{}")
                    if not isinstance(p, dict):
                        raise ValueError
                else:
                    p = {k: (v if k in MULTI_FIELDS else v[0])
                         for k, v in parse_qs(raw.decode("utf-8", "replace"), keep_blank_values=True).items()}
            except ValueError:
                return self._text(400, "Bad body")
            token = self.headers.get("X-CSRF-Token") or str(p.get("csrf") or "")
            if not hmac.compare_digest(token.encode(), app.csrf.encode()):
                return self._text(403, "Bad CSRF token")
            try:
                res = _api(app, name, p)
            except Exception as ex:
                sys.stderr.write(f"action error {name}: {type(ex).__name__}\n")
                res = actions.fail("db_error", "Can't reach the database. Nothing was changed.")
            if is_api:
                return self._send(200, json.dumps(res).encode(), "application/json")
            nxt = str(p.get("next") or "/")
            nxt = nxt if nxt.startswith("/") and not nxt.startswith("//") else "/"
            if name == "settings":
                nxt = "/settings?saved=1"
            if res.get("ok"):
                return self._send(303, b"", extra={"Location": nxt})
            if name == "settings" and res.get("error") == "invalid":
                return self._settings_errors(p, res["errors"])
            body = views.message_page(app.csrf, "Couldn't do that", res.get("message", "Failed."), nxt, demo=app.demo)
            return self._send(409, body.encode())

        def _settings_errors(self, p: dict, errors: dict):
            """Re-render the form with the submitted values and inline errors (422), nothing saved."""
            try:
                now = data.now_utc()
                db = app.db()
                v = data.settings_view(db, now)
                segs = p.get("segments") or []
                v.update(per_day=p.get("per_day", ""), daily_budget=p.get("daily_budget", ""),
                         daily_cap=p.get("daily_cap", ""), paused=p.get("paused") in ("1", "on", "true"),
                         segments=[segs] if isinstance(segs, str) else list(segs),
                         address_draft=str(p.get("address") or ""),
                         tenders=data.tenders_form_draft(data.tenders_settings(db), p))
                html = views.settings_page(app.csrf, data.shell(db, now), v, errors, False, app.demo)
                return self._send(422, html.encode())
            except Exception as ex:
                sys.stderr.write(f"settings error page: {type(ex).__name__}\n")
                return self._send(503, views.error_state(app.csrf, demo=app.demo).encode())

    return Handler


def make_server(db=None, db_factory=None, port: int = PORT, demo: bool = False) -> ThreadingHTTPServer:
    app = App(db=db, db_factory=db_factory, port=port, demo=demo)
    srv = ThreadingHTTPServer((HOST, port), make_handler(app))  # loopback only (D3), no --host flag on purpose
    srv.daemon_threads = True
    app.port = srv.server_address[1]
    srv.app = app
    return srv


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Epsilon OS local dashboard")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--demo", action="store_true", help="serve seeded fake data; touches no database")
    a = ap.parse_args(argv)
    if a.demo:
        from dashboard.demo import seeded_db
        srv = make_server(db=seeded_db(), port=a.port, demo=True)
    else:
        from core.db import DB
        srv = make_server(db_factory=DB, port=a.port)
    print(f"Epsilon OS dashboard on http://{HOST}:{srv.server_address[1]}" + ("  [DEMO DATA]" if a.demo else ""), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
