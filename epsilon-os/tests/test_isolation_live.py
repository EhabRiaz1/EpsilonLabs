"""Isolation suite against the LIVE Supabase project (client-platform.md "Tests", F14, OV3).

Run only on purpose:  EOS_LIVE_TESTS=1 .venv/bin/python -m pytest -q -m live tests/test_isolation_live.py
Needs migrations 008-010 applied and the service-role key in the keychain (core.config.secret).

It creates two is_test orgs, two client users, a test-scope staff user and one non-test org (so "test staff can't
see real orgs" is checked against a real row), signs everyone in with a password to get real JWTs, checks every
new table and RPC through PostgREST, and deletes everything it created in `finally`.
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
import struct
import sys
import time
import uuid
from pathlib import Path

import httpx
import pytest

from core import config

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.environ.get("EOS_LIVE_TESTS") != "1", reason="live test: set EOS_LIVE_TESTS=1"),
]

URL = config.SUPABASE_URL
TABLES = ["organizations", "staff", "memberships", "invites", "projects", "tickets", "ticket_events", "jobs"]
OLD_TABLES = ["companies", "contacts", "deals", "approval_queue", "actions", "settings"]
NEW_010 = ["intake", "intake_rate", "files", "notifications"]   # needs migration 010 applied
ENV_EXAMPLE = Path(__file__).resolve().parents[2] / "platform" / ".env.example"


def publishable_key() -> str:
    if os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"):
        return os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
    m = re.search(r"^NEXT_PUBLIC_SUPABASE_ANON_KEY=(\S+)$", ENV_EXAMPLE.read_text(), re.M)
    assert m, "publishable key not found in platform/.env.example"
    return m.group(1)


def totp(secret_b32: str, at: float | None = None) -> str:
    """RFC 6238 (SHA-1, 30 s, 6 digits), what Supabase TOTP factors use."""
    key = base64.b32decode(secret_b32.upper() + "=" * (-len(secret_b32) % 8))
    counter = int((at or time.time()) // 30)
    h = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


class Api:
    """PostgREST + Auth over httpx. `token=None` means the anon role."""

    def __init__(self, apikey: str, token: str | None):
        h = {"apikey": apikey, "Content-Type": "application/json"}
        if token:
            h["Authorization"] = f"Bearer {token}"
        self.c = httpx.Client(base_url=URL, headers=h, timeout=20)

    def select(self, table, **params):
        return self.c.get(f"/rest/v1/{table}", params={"select": "*", **params})

    def insert(self, table, row):
        return self.c.post(f"/rest/v1/{table}", json=row, headers={"Prefer": "return=representation"})

    def update(self, table, values, **params):
        return self.c.patch(f"/rest/v1/{table}", params=params, json=values, headers={"Prefer": "return=representation"})

    def rpc(self, fn, args):
        return self.c.post(f"/rest/v1/rpc/{fn}", json=args)


def ok(r: httpx.Response):
    assert r.status_code < 300, f"{r.request.method} {r.request.url.path}: {r.status_code} {r.text[:300]}"
    return r.json() if r.content else None


def denied(r: httpx.Response) -> bool:
    """Refused outright, or allowed to run but saw/changed nothing."""
    if r.status_code >= 400:
        return True
    return r.json() in ([], None)


def test_isolation_live():
    service_key = config.secret("epsilon-os-supabase-secret", config.SUPABASE_ACCOUNT)
    pub = publishable_key()
    svc = Api(service_key, service_key)
    tag = uuid.uuid4().hex[:8]
    created_users: list[str] = []
    created_orgs: list[str] = []
    uploaded: list[str] = []

    def make_user(label: str) -> tuple[str, str, str]:
        email, pw = f"isolation-{label}-{tag}@test.epsilon-labs.co", secrets.token_urlsafe(24)
        u = ok(svc.c.post("/auth/v1/admin/users", json={"email": email, "password": pw, "email_confirm": True}))
        created_users.append(u["id"])
        return u["id"], email, pw

    def sign_in(email: str, pw: str) -> str:
        r = ok(httpx.post(f"{URL}/auth/v1/token", params={"grant_type": "password"},
                          headers={"apikey": pub}, json={"email": email, "password": pw}, timeout=20))
        return r["access_token"]

    def step_up(token: str) -> str:
        """Enrol a TOTP factor and verify it: returns an aal2 access token."""
        h = {"apikey": pub, "Authorization": f"Bearer {token}"}
        f = ok(httpx.post(f"{URL}/auth/v1/factors", headers=h, json={"factor_type": "totp", "friendly_name": f"ci-{tag}"}, timeout=20))
        ch = ok(httpx.post(f"{URL}/auth/v1/factors/{f['id']}/challenge", headers=h, timeout=20))
        v = ok(httpx.post(f"{URL}/auth/v1/factors/{f['id']}/verify", headers=h,
                          json={"challenge_id": ch["id"], "code": totp(f["totp"]["secret"])}, timeout=20))
        return v["access_token"]

    try:
        # ---- seed (service role) ----
        a_id, a_email, a_pw = make_user("a")
        b_id, b_email, b_pw = make_user("b")
        s_id, s_email, s_pw = make_user("staff")
        orgs = ok(svc.insert("organizations", [
            {"name": f"Isolation A {tag}", "slug": f"iso-a-{tag}", "is_test": True},
            {"name": f"Isolation B {tag}", "slug": f"iso-b-{tag}", "is_test": True},
            {"name": f"Isolation real {tag}", "slug": f"iso-real-{tag}", "is_test": False},
        ]))
        created_orgs.extend(o["id"] for o in orgs)
        org_a, org_b, org_real = (o["id"] for o in orgs)
        ok(svc.insert("memberships", [{"org_id": org_a, "user_id": a_id, "role": "owner"},
                                      {"org_id": org_b, "user_id": b_id, "role": "owner"}]))
        ok(svc.insert("staff", {"user_id": s_id, "email": s_email, "scope": "test"}))
        projects = ok(svc.insert("projects", [{"org_id": org_a, "name": "PA", "repo_path": "/tmp/a"},
                                              {"org_id": org_b, "name": "PB", "repo_path": None},
                                              {"org_id": org_real, "name": "PR", "repo_path": None}]))
        p_a, p_b, p_real = (p["id"] for p in projects)
        ok(svc.insert("invites", {"org_id": org_b, "email": f"x-{tag}@test.epsilon-labs.co", "token_hash": f"iso-{tag}"}))

        a = Api(pub, sign_in(a_email, a_pw))
        b = Api(pub, sign_in(b_email, b_pw))
        anon = Api(pub, None)

        # ---- tickets through the RPC; B's ticket gets a visible and an internal event ----
        t_a = ok(a.rpc("create_ticket", {"p_project_id": p_a, "p_title": "A ticket", "p_body": "", "p_type": "bug", "p_priority": "low"}))
        assert t_a["ref"] == f"EL-{t_a['number']}"
        t_b = ok(b.rpc("create_ticket", {"p_project_id": p_b, "p_title": "B ticket", "p_body": "", "p_type": "change", "p_priority": None}))
        ok(b.rpc("add_ticket_comment", {"p_ticket_id": t_b["id"], "p_body": "visible"}))
        ok(svc.insert("ticket_events", {"org_id": org_b, "ticket_id": t_b["id"], "kind": "brief", "body": "internal"}))
        row = ok(svc.select("tickets", id=f"eq.{t_a['id']}"))[0]
        assert (row["org_id"], row["author_id"]) == (org_a, a_id)

        # ---- cross-org select / insert / update fail on every table ----
        for t in TABLES:
            assert denied(anon.select(t)), f"anon can read {t}"
        for t in ("memberships", "invites", "projects", "tickets", "ticket_events"):
            assert denied(a.select(t, org_id=f"eq.{org_b}")), f"client sees org B rows in {t}"
        assert denied(a.select("organizations", id=f"eq.{org_b}"))
        assert [o["id"] for o in ok(a.select("organizations"))] == [org_a]
        assert ok(a.select("staff")) == [] and ok(a.select("jobs")) == []
        assert ok(a.select("invites")) == []
        assert ok(a.c.get("/rest/v1/projects", params={"select": "id,name"})) == [{"id": p_a, "name": "PA"}]
        assert a.c.get("/rest/v1/projects", params={"select": "repo_path"}).status_code >= 400   # worker-only column
        assert denied(a.select("tickets", id=f"eq.{t_b['id']}"))
        assert denied(a.select("ticket_events", ticket_id=f"eq.{t_b['id']}"))

        writes = {
            "organizations": {"name": "x", "slug": f"x-{tag}"},
            "staff": {"user_id": a_id, "email": a_email, "scope": "full"},
            "memberships": {"org_id": org_b, "user_id": a_id},
            "invites": {"org_id": org_b, "email": "y@test.epsilon-labs.co", "token_hash": f"y-{tag}"},
            "projects": {"org_id": org_b, "name": "x"},
            "tickets": {"org_id": org_b, "project_id": p_b, "title": "x", "type": "bug"},
            "ticket_events": {"org_id": org_b, "ticket_id": t_b["id"], "kind": "comment", "body": "x", "client_visible": True},
            "jobs": {"type": "run_agent"},
        }
        for t, row in writes.items():
            assert denied(a.insert(t, row)), f"client insert into {t} was allowed"
            assert denied(anon.insert(t, row)), f"anon insert into {t} was allowed"
        for t, flt, vals in (("organizations", {"id": f"eq.{org_b}"}, {"name": "pwned"}),
                             ("projects", {"id": f"eq.{p_b}"}, {"name": "pwned"}),
                             ("tickets", {"id": f"eq.{t_b['id']}"}, {"title": "pwned"}),
                             ("projects", {"id": f"eq.{p_a}"}, {"name": "own org, still refused"}),
                             ("memberships", {"org_id": f"eq.{org_a}"}, {"role": "member"})):
            assert denied(a.update(t, vals, **flt)), f"client update on {t} was allowed"
        assert ok(svc.select("organizations", id=f"eq.{org_b}"))[0]["name"].startswith("Isolation B")
        assert ok(svc.select("projects", id=f"eq.{p_a}"))[0]["name"] == "PA"

        # ---- RPCs refuse other orgs and anon ----
        assert a.rpc("create_ticket", {"p_project_id": p_b, "p_title": "x", "p_body": "", "p_type": "bug", "p_priority": "low"}).status_code >= 400
        assert a.rpc("add_ticket_comment", {"p_ticket_id": t_b["id"], "p_body": "x"}).status_code >= 400
        assert anon.rpc("create_ticket", {"p_project_id": p_a, "p_title": "x", "p_body": "", "p_type": "bug", "p_priority": "low"}).status_code >= 400

        # ---- client_visible filtering ----
        assert [e["body"] for e in ok(b.select("ticket_events", ticket_id=f"eq.{t_b['id']}"))] == ["visible"]
        assert len(ok(svc.select("ticket_events", ticket_id=f"eq.{t_b['id']}"))) == 2

        # ---- staff without aal2 is refused; test-scope staff sees only is_test orgs ----
        s_aal1 = sign_in(s_email, s_pw)
        s1 = Api(pub, s_aal1)
        assert ok(s1.select("organizations")) == []
        assert ok(s1.select("tickets")) == []
        assert [r["user_id"] for r in ok(s1.select("staff"))] == [s_id]   # own row only, for MFA routing
        assert ok(s1.rpc("is_staff", {})) is False
        s2 = Api(pub, step_up(s_aal1))
        seen = {o["id"] for o in ok(s2.select("organizations"))}
        assert {org_a, org_b} <= seen and org_real not in seen
        assert all(o["is_test"] for o in ok(s2.select("organizations")))
        assert len(ok(s2.select("ticket_events", ticket_id=f"eq.{t_b['id']}"))) == 2
        assert denied(s2.select("projects", id=f"eq.{p_real}"))
        assert s2.rpc("create_ticket", {"p_project_id": p_real, "p_title": "x", "p_body": "", "p_type": "bug", "p_priority": "low"}).status_code >= 400
        assert ok(s2.rpc("is_staff", {})) is False                          # test scope is never full staff
        for t in OLD_TABLES + ["jobs"]:
            assert ok(s2.select(t, limit="1")) == [], f"test-scope staff can read {t}"
            assert ok(a.select(t, limit="1")) == [], f"client can read {t}"

        # ---- migration 010: intake, files, notifications, invites, ticket status ----
        for t in NEW_010:
            assert denied(anon.select(t)), f"anon can read {t}"
        for t in ("intake", "intake_rate"):
            assert denied(a.select(t)) and denied(s2.select(t)), f"client / test staff can read {t}"
        assert denied(anon.insert("intake", {"name": "x", "email": "x@test.epsilon-labs.co", "kind": "software"}))
        # anon may execute submit_intake; an invalid payload is refused before anything is written (no live rows)
        r = anon.rpc("submit_intake", {"p_ip_hash": "0" * 64, "p_payload": {"name": "x", "email": "nope", "kind": "software"}})
        assert r.status_code == 400 and "valid email" in r.text, r.text
        for fn, args in (("peek_invite", {"p_token": "x" * 43}), ("accept_invite", {"p_token": "x" * 43}),
                         ("set_intake_status", {"p_id": str(uuid.uuid4()), "p_status": "spam"})):
            assert anon.rpc(fn, args).status_code >= 400, f"anon can call {fn}"
            assert a.rpc(fn, args).status_code >= 400, f"client can call {fn}"

        # ticket status: staff only (test scope works on is_test orgs); members are notified, the other org is not
        assert a.rpc("set_ticket_status", {"p_ticket_id": t_a["id"], "p_status": "review"}).status_code >= 400
        assert s1.rpc("set_ticket_status", {"p_ticket_id": t_a["id"], "p_status": "review"}).status_code >= 400
        ok(s2.rpc("set_ticket_status", {"p_ticket_id": t_a["id"], "p_status": "review"}))
        assert [n["kind"] for n in ok(a.select("notifications", link=f"eq./tickets/{t_a['id']}"))] == ["ticket_status"]
        assert ok(b.select("notifications", link=f"eq./tickets/{t_a['id']}")) == []
        assert denied(a.update("notifications", {"read_at": None}, user_id=f"eq.{a_id}"))
        assert a.rpc("staff_ticket_reply", {"p_ticket_id": t_a["id"], "p_body": "x", "p_to_client": True}).status_code >= 400

        # uploads: registered path only, readable by the org and staff, never by the other org
        up = ok(a.rpc("begin_upload", {"p_project_id": p_a, "p_ticket_id": None, "p_name": "iso.txt",
                                       "p_mime": "text/plain", "p_size": 5}))
        assert b.rpc("begin_upload", {"p_project_id": p_a, "p_ticket_id": None, "p_name": "iso.txt",
                                      "p_mime": "text/plain", "p_size": 5}).status_code >= 400
        uploaded.append(up["path"])
        assert b.c.post(f"/storage/v1/object/client-files/{up['path']}", content=b"hello",
                        headers={"Content-Type": "text/plain"}).status_code >= 400, "other org wrote a registered path"
        assert a.c.post(f"/storage/v1/object/client-files/{org_a}/{p_a}/unregistered.txt", content=b"hello",
                        headers={"Content-Type": "text/plain"}).status_code >= 400, "unregistered path accepted"
        ok(a.c.post(f"/storage/v1/object/client-files/{up['path']}", content=b"hello", headers={"Content-Type": "text/plain"}))
        assert ok(a.rpc("finish_upload", {"p_id": up["id"]}))["status"] == "ready"
        assert [f["id"] for f in ok(a.select("files"))] == [up["id"]]
        assert ok(b.select("files")) == []
        assert b.c.get(f"/storage/v1/object/authenticated/client-files/{up['path']}").status_code >= 400
        assert a.c.get(f"/storage/v1/object/authenticated/client-files/{up['path']}").content == b"hello"
        assert ok(s2.select("files", id=f"eq.{up['id']}"))[0]["id"] == up["id"]

        # team and invites: own org only; owners invite members only
        assert b.rpc("org_team", {"p_org_id": org_a}).status_code >= 400
        assert ok(a.rpc("org_team", {"p_org_id": org_a}))["members"][0]["user_id"] == a_id
        tok_hash = "1" * 64
        assert b.rpc("create_invite", {"p_org_id": org_a, "p_email": f"z-{tag}@test.epsilon-labs.co", "p_role": "member",
                                       "p_token_hash": tok_hash}).status_code >= 400
        assert a.rpc("create_invite", {"p_org_id": org_a, "p_email": f"z-{tag}@test.epsilon-labs.co", "p_role": "owner",
                                       "p_token_hash": tok_hash}).status_code >= 400
    finally:
        if uploaded:                       # Storage objects do not cascade with the org
            svc.c.request("DELETE", "/storage/v1/object/client-files", json={"prefixes": uploaded})
        for org in created_orgs:          # cascades to memberships, invites, projects, tickets, ticket_events
            svc.c.delete("/rest/v1/organizations", params={"id": f"eq.{org}"})
        for uid in created_users:         # cascades to staff and auth factors
            svc.c.delete(f"/auth/v1/admin/users/{uid}")
        left = svc.c.get("/rest/v1/organizations", params={"select": "id", "slug": f"like.iso-*-{tag}"}).json()
        if left and sys.exc_info()[0] is None:   # never mask the original failure
            pytest.fail(f"cleanup left orgs behind: {left}")
