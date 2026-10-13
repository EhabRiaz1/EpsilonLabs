"""Migration 016 (site analytics + demo portal) against a local Postgres with the same Supabase stubs as
test_intake_portal_migration.py. Skipped when no local Postgres is running.

Every call switches to the anon / authenticated / service_role role and sets request.jwt.claims the way PostgREST does.
"""
import json
import re
import secrets
import uuid
from pathlib import Path

import jsonschema
import pytest

from tests.test_deal_room_migration import STORAGE_STUB
from tests.test_intake_portal_migration import EXTRA_STUB, FILES, ROOT, sh
from tests.test_platform_migration import AUTH_STUB
from tests import test_intake_portal_migration as base

DB = "eos_test_016"
pytestmark = base.pytestmark
MIGRATION = "migrations/016_analytics_demo.sql"
ALL = FILES + ["migrations/011_rulebook_push.sql", "migrations/012_comms_billing.sql",
               "migrations/013_research_sources.sql", MIGRATION]
DEMO_ORG = "de300000-0000-4000-8000-000000000001"
DEMO_EMAIL = "demo-portal@epsilon-labs.co"


def psql(sql: str, check=True):
    return sh("psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-At", "-q", check=check, input=sql)


def q(sql: str) -> str:
    return psql(sql).stdout.strip()


def as_user(sub, sql, aal="aal1", role="authenticated"):
    claims = json.dumps({"sub": str(sub) if sub else None, "role": role, "aal": aal}).replace("'", "''")
    return psql(f"begin; set local role {role}; set local request.jwt.claims = '{claims}';\n{sql}\ncommit;", check=False)


def lit(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _sql(fn, args: dict) -> str:
    return f"{fn}(" + ", ".join(f"{k} => {lit(v)}" for k, v in args.items()) + ")"


def call(fn, args: dict, sub=None, aal="aal2", role="authenticated"):
    r = as_user(sub, f"select to_jsonb(x) from (select {_sql(fn, args)} as x) s;", aal=aal, role=role)
    assert r.returncode == 0, r.stderr
    out = r.stdout.strip()
    return json.loads(out) if out else None


def fails(fn, args: dict, sub=None, aal="aal2", role="authenticated") -> str:
    r = as_user(sub, f"select {_sql(fn, args)};", aal=aal, role=role)
    assert r.returncode != 0, f"{fn} should have been refused"
    return r.stderr


def client() -> str:
    return secrets.token_hex(32)


def ev(**kw) -> dict:
    e = {"s": "sess" + secrets.token_hex(6), "p": "/", "k": "view"}
    e.update(kw)
    return e


def record(events, key=None, role="anon"):
    return call("record_events", {"p_batch": {"client": key or client(), "events": events}}, role=role)


def record_fails(events, key=None) -> str:
    return fails("record_events", {"p_batch": {"client": key or client(), "events": events}}, role="anon")


def count_events() -> int:
    return int(q("select count(*) from site_events"))


@pytest.fixture(scope="module")
def db():
    sh("dropdb", "--if-exists", DB)
    sh("createdb", DB)
    for role in ("service_role", "anon", "authenticated"):
        psql(f"do $$ begin if not exists (select from pg_roles where rolname='{role}') then create role {role}; end if; end $$;")
    psql(AUTH_STUB)
    psql(STORAGE_STUB)
    psql(EXTRA_STUB)
    psql("grant usage on schema public to anon, authenticated, service_role;")
    for f in ALL:
        r = psql((ROOT / f).read_text(), check=False)
        assert r.returncode == 0, f"{f}: {r.stderr}"
    i = {k: str(uuid.uuid4()) for k in ("founder", "a", "demo", "orgA", "pA")}
    q(f"""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('{i['founder']}','er@epsilon-labs.co','{{"full_name":"Ehab Riaz"}}'),('{i['a']}','ayesha@a.example',null),
        ('{i['demo']}','{DEMO_EMAIL}',null);
      insert into staff (user_id, email, scope) values ('{i['founder']}','er@epsilon-labs.co','full');
      insert into organizations (id, name, slug) values ('{i['orgA']}','Alpha Mills','alpha');
      insert into memberships (org_id, user_id, role) values ('{i['orgA']}','{i['a']}','owner');
      insert into projects (id, org_id, name) values ('{i['pA']}','{i['orgA']}','Plant dashboard');
    """)
    yield i
    sh("dropdb", "--if-exists", DB)


@pytest.fixture()
def clean(db):
    q("truncate site_events, site_events_daily, site_events_rate; delete from settings where key = 'analytics.enabled';")
    return db


def staff_call(db, fn, **args):
    return call(fn, args, sub=db["founder"], aal="aal2")


# ---- shape and grants -----------------------------------------------------------------------------------------------

def test_016_reapplies_cleanly(db):
    r = psql((ROOT / MIGRATION).read_text(), check=False)
    assert r.returncode == 0, r.stderr


def test_site_events_has_no_ip_or_user_agent_column(db):
    cols = set(q("select string_agg(column_name, ',') from information_schema.columns "
                 "where table_schema = 'public' and table_name like 'site_events%'").split(","))
    assert {"session_id", "path", "kind", "target", "referrer_host", "utm", "country", "device", "created_at"} <= cols
    for c in cols:
        assert not re.search(r"ip|agent|ua$|cookie|email|user", c), c


def test_anon_may_execute_only_record_events_from_016(db):
    names = set(re.findall(r"create or replace function (\w+)\(", (ROOT / MIGRATION).read_text()))
    assert "record_events" in names and "reset_demo" in names
    anon = set(q("select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                 "where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')").split(","))
    assert anon & names == {"record_events"}
    for t in ("site_events", "site_events_daily", "site_events_rate"):
        assert q(f"select has_table_privilege('anon', '{t}', 'select,insert,update,delete')") == "f", t
    assert q("select has_table_privilege('authenticated', 'site_events', 'insert')") == "f"


def test_aggregates_are_staff_only(clean):
    db = clean
    for fn in ("analytics_top_pages", "analytics_sources", "analytics_funnel", "analytics_daily", "analytics_breakdown",
               "analytics_live"):
        fails(fn, {}, sub=db["a"], aal="aal2")                 # a client
        fails(fn, {}, sub=db["founder"], aal="aal1")           # staff without the second factor
        fails(fn, {}, role="anon")
        assert staff_call(db, fn) is not None
    rows = as_user(db["a"], "select count(*) from site_events;", aal="aal2")
    assert rows.returncode == 0 and rows.stdout.strip() == "0"   # RLS: clients read nothing


# ---- record_events: validation, limits, caps -----------------------------------------------------------------------

def test_valid_batch_is_stored(clean):
    out = record([ev(p="/start/", r="google.com", u={"source": "linkedin", "campaign": "oct"}, c="PK", d="mobile"),
                  ev(k="click", t="/start/", r=None, u=None, c=None, d=None)])
    assert out == {"state": "ok", "stored": 2}
    row = json.loads(q("select to_jsonb(s) from site_events s where path = '/start/'"))
    assert row["utm"] == {"source": "linkedin", "campaign": "oct"} and row["country"] == "PK" and row["device"] == "mobile"


@pytest.mark.parametrize("bad", [
    {"p": "no-slash"}, {"p": "/a b"}, {"p": "/a?x=1"}, {"p": "/" + "a" * 300}, {"k": "purchase"}, {"s": "short"},
    {"s": "bad session!"}, {"t": ""}, {"t": "x\ny"}, {"t": "x" * 301}, {"r": "Example.COM"}, {"r": "a/b"},
    {"c": "pk"}, {"c": "PAK"}, {"d": "watch"}, {"u": {"source": 1}}, {"u": {"ref": "x"}}, {"u": {"source": "x" * 101}},
    {"u": "linkedin"}, {"ip": "1.2.3.4"}, {"ua": "Mozilla"},
])
def test_invalid_event_refuses_the_whole_batch(clean, bad):
    record_fails([ev(), ev(**bad)])
    assert count_events() == 0


def test_batch_shape(clean):
    record_fails([])
    record_fails([ev() for _ in range(21)])
    assert record([ev() for _ in range(20)])["stored"] == 20
    fails("record_events", {"p_batch": [ev()]}, role="anon")                                   # not the envelope
    fails("record_events", {"p_batch": {"client": "nope", "events": [ev()]}}, role="anon")
    fails("record_events", {"p_batch": {"client": client(), "events": [ev()], "extra": 1}}, role="anon")
    assert count_events() == 20


def test_per_client_hourly_limit(clean):
    key = client()
    for _ in range(15):                                              # 300 events
        assert record([ev() for _ in range(20)], key=key)["state"] == "ok"
    assert record([ev()], key=key) == {"state": "rate_limited", "stored": 0}
    assert record([ev()])["state"] == "ok"                           # another client is unaffected
    assert count_events() == 301


def test_global_daily_cap(clean):
    q("insert into site_events_daily (day, stored) values ((now() at time zone 'UTC')::date, 4990)")
    assert record([ev() for _ in range(20)]) == {"state": "capped", "stored": 10}
    assert record([ev()]) == {"state": "capped", "stored": 0}
    assert count_events() == 10


def test_kill_switch(clean):
    q("insert into settings (key, value) values ('analytics.enabled', 'false'::jsonb)")
    assert record([ev()]) == {"state": "disabled", "stored": 0}
    assert count_events() == 0


def test_retention_prune(clean):
    db = clean
    record([ev(), ev()])
    q("insert into site_events (session_id, path, kind, created_at) values ('oldsession1', '/', 'view', now() - interval '181 days')")
    q("insert into site_events_rate (client, window_start, hits) values (repeat('a', 64), now() - interval '2 days', 3)")
    fails("prune_site_events", {}, role="anon")
    fails("prune_site_events", {}, sub=db["a"], aal="aal2")
    assert call("prune_site_events", {}, role="service_role") == {"deleted": 1}
    assert count_events() == 2
    assert q("select count(*) from site_events_rate where window_start < now() - interval '1 day'") == "0"


# ---- aggregates ----------------------------------------------------------------------------------------------------

def test_funnel_pages_sources_daily_live(clean):
    db = clean
    s1, s2, s3 = "funnelsess01", "funnelsess02", "funnelsess03"
    record([ev(s=s1, p="/", r="google.com", d="mobile", c="PK"), ev(s=s1, p="/start/"),
            ev(s=s1, p="/start/", k="start_step", t="1"), ev(s=s1, p="/start/", k="start_step", t="2"),
            ev(s=s1, p="/start/", k="start_submit"),
            ev(s=s2, p="/start/", u={"source": "linkedin", "medium": "social"}, d="desktop", c="GB"),
            ev(s=s2, p="/start/", k="start_step", t="1"),
            ev(s=s3, p="/work/", d="desktop"), ev(s=s3, p="/work/", k="click", t="out:github.com")])
    f = staff_call(db, "analytics_funnel", p_days=7)
    assert f["visits"] == 3 and f["start"] == 2 and f["submit"] == 1
    assert [s["sessions"] for s in f["steps"]] == [2, 1, 0, 0, 0, 0, 0]
    pages = staff_call(db, "analytics_top_pages", p_days=7)
    assert pages[0] == {"path": "/start/", "views": 2, "sessions": 2}
    assert {p["path"] for p in pages} == {"/", "/start/", "/work/"}
    src = staff_call(db, "analytics_sources", p_days=7)
    assert src["sessions"] == 3
    assert {r["host"]: r["sessions"] for r in src["referrers"]} == {"google.com": 1, "": 2}
    assert src["utm"] == [{"source": "linkedin", "medium": "social", "campaign": "", "sessions": 1}]
    daily = staff_call(db, "analytics_daily", p_days=14)
    assert len(daily) == 14 and daily[-1]["views"] == 4 and daily[-1]["sessions"] == 3
    assert all(d["views"] == 0 for d in daily[:-1])
    live = staff_call(db, "analytics_live")
    assert live["sessions"] == 3 and sum(p["sessions"] for p in live["pages"]) == 3
    br = staff_call(db, "analytics_breakdown", p_days=7)
    assert {d["device"]: d["sessions"] for d in br["devices"]} == {"mobile": 1, "desktop": 2}
    assert {c["country"]: c["sessions"] for c in br["countries"]} == {"PK": 1, "GB": 1, "": 1}


def test_window_excludes_old_events(clean):
    db = clean
    q("insert into site_events (session_id, path, kind, created_at) values ('oldsession2', '/old/', 'view', now() - interval '40 days')")
    assert staff_call(db, "analytics_top_pages", p_days=30) == []
    assert staff_call(db, "analytics_top_pages", p_days=60)[0]["path"] == "/old/"


# ---- demo -----------------------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def demo(db):
    assert call("reset_demo", {}, role="service_role")["user_id"] == db["demo"]
    return db


def demo_ids(sql) -> list:
    return q(sql).split("\n")


def test_demo_seed(demo):
    assert q(f"select name || '|' || is_demo from organizations where id = '{DEMO_ORG}'") == "Northwind Industrial (demo)|true"
    assert q(f"select count(*) from projects where org_id = '{DEMO_ORG}'") == "2"
    assert int(q(f"select count(*) from tickets where org_id = '{DEMO_ORG}'")) >= 2
    assert q(f"select count(*) from updates where org_id = '{DEMO_ORG}' and status = 'published'") == "1"
    assert q(f"select count(*) from reports where org_id = '{DEMO_ORG}' and status = 'published'") == "1"
    assert q(f"select number || '|' || status from invoices where org_id = '{DEMO_ORG}'") == "DEMO-0001|paid"
    assert q(f"select role from memberships where org_id = '{DEMO_ORG}'") == "member"
    # replies come "from Epsilon" (the full-scope staff user), and every thread event is client-visible
    assert q(f"select string_agg(distinct actor::text, ',') from ticket_events where org_id = '{DEMO_ORG}'") == demo["founder"]
    assert q(f"select bool_and(client_visible) from ticket_events where org_id = '{DEMO_ORG}'") == "t"
    # the demo login sees it through RLS like any client
    r = as_user(demo["demo"], "select count(*) from tickets;")
    assert r.returncode == 0 and int(r.stdout.strip()) >= 2


def test_demo_content_is_fictional_and_labelled(demo):
    text = q(f"select string_agg(x, ' ') from (select summary as x from projects where org_id = '{DEMO_ORG}' "
             f"union all select body_md from updates where org_id = '{DEMO_ORG}' "
             f"union all select content::text from reports where org_id = '{DEMO_ORG}') t")
    assert "SAMPLE" in text and "demo" in text.lower()
    for real in ("Master Paints", "FabricPort", "Epsilon1", "eFuelPro"):
        assert real.lower() not in text.lower()


def test_demo_report_matches_the_delivery_report_schema(demo):
    schema = json.loads((ROOT / "skills/delivery-report/schema.json").read_text())
    content = json.loads(q(f"select content from reports where org_id = '{DEMO_ORG}'"))
    jsonschema.validate(content, schema)


def test_reset_is_idempotent_and_keeps_ticket_numbers(demo):
    before = q(f"select string_agg(id || ':' || number, ',' order by id) from tickets where org_id = '{DEMO_ORG}'")
    seq = q("select last_value from ticket_number_seq")
    q("select reset_demo()")                                    # pg_cron / psql: no JWT
    call("reset_demo", {}, role="service_role")
    assert q(f"select string_agg(id || ':' || number, ',' order by id) from tickets where org_id = '{DEMO_ORG}'") == before
    assert q("select last_value from ticket_number_seq") == seq
    assert q(f"select count(*) from invoices where org_id = '{DEMO_ORG}'") == "1"
    assert q(f"select count(*) from updates where org_id = '{DEMO_ORG}'") == "1"


def test_reset_restores_drift_and_removes_strangers(demo):
    t = q(f"select id from tickets where org_id = '{DEMO_ORG}' limit 1")
    q(f"update tickets set title = 'vandalised' where id = '{t}'")                # service-level drift (no JWT)
    q(f"insert into memberships (org_id, user_id, role) values ('{DEMO_ORG}', '{demo['a']}', 'owner')")
    call("reset_demo", {}, role="service_role")
    assert q(f"select title from tickets where id = '{t}'") != "vandalised"
    assert q(f"select string_agg(user_id::text, ',') from memberships where org_id = '{DEMO_ORG}'") == demo["demo"]


def test_reset_demo_permissions(demo):
    fails("reset_demo", {}, role="anon")
    fails("reset_demo", {}, sub=demo["a"], aal="aal2")
    fails("reset_demo", {}, sub=demo["founder"], aal="aal1")
    assert call("reset_demo", {}, sub=demo["founder"], aal="aal2")["ok"] is True
    fails("demo_prepare", {}, sub=demo["founder"], aal="aal2")
    assert call("demo_prepare", {}, role="service_role")["ok"] is True


def test_demo_login_cannot_write_anything(demo):
    d = demo["demo"]
    p = q(f"select id from projects where org_id = '{DEMO_ORG}' limit 1")
    t = q(f"select id from tickets where org_id = '{DEMO_ORG}' limit 1")
    n = q(f"select count(*) from notifications where org_id = '{DEMO_ORG}' and read_at is null")
    assert int(n) >= 1
    fails("create_ticket", {"p_project_id": p, "p_title": "x", "p_body": "y", "p_type": "bug", "p_priority": None}, sub=d, aal="aal1")
    fails("add_ticket_comment", {"p_ticket_id": t, "p_body": "hello"}, sub=d, aal="aal1")
    fails("mark_notifications_read", {"p_ids": None}, sub=d, aal="aal1")
    fails("save_my_prefs", {"p_timezone": "Europe/London", "p_email_pref": "off"}, sub=d, aal="aal1")
    fails("begin_upload", {"p_project_id": p, "p_ticket_id": None, "p_name": "a.pdf", "p_mime": "application/pdf", "p_size": 10},
          sub=d, aal="aal1")
    assert q(f"select count(*) from notifications where org_id = '{DEMO_ORG}' and read_at is null") == n
    assert q(f"select count(*) from ticket_events where ticket_id = '{t}' and body = 'hello'") == "0"


def test_staff_writes_to_the_demo_org_are_refused_too(demo):
    f = demo["founder"]
    t = q(f"select id from tickets where org_id = '{DEMO_ORG}' limit 1")
    p = q(f"select id from projects where org_id = '{DEMO_ORG}' limit 1")
    assert "read-only" in fails("set_ticket_status", {"p_ticket_id": t, "p_status": "declined"}, sub=f)
    fails("staff_ticket_reply", {"p_ticket_id": t, "p_body": "x", "p_to_client": True}, sub=f)
    fails("save_project", {"p_id": p, "p_org_id": DEMO_ORG, "p_name": "Renamed", "p_status": "active", "p_summary": None,
                           "p_repo_path": None, "p_progress": 10, "p_next_milestone": None, "p_next_milestone_on": None}, sub=f)
    # the worker's service role is not a user write (mailer skips, overdue marking) and still works
    r = as_user(None, f"update notifications set email_state = 'skipped' where org_id = '{DEMO_ORG}';", role="service_role")
    assert r.returncode == 0, r.stderr


def test_real_orgs_are_unaffected(demo):
    a = demo["a"]
    out = call("create_ticket", {"p_project_id": demo["pA"], "p_title": "Real work", "p_body": "b", "p_type": "change",
                                 "p_priority": None}, sub=a, aal="aal1")
    assert out["ref"].startswith("EL-")
    assert call("save_my_prefs", {"p_timezone": "Europe/London", "p_email_pref": "daily"}, sub=a, aal="aal1") is not None


def test_demo_invoice_numbers_stay_in_the_demo_org(demo):
    r = psql(f"insert into invoices (org_id, number, bill_company, total, status, issued_at) values "
             f"('{demo['orgA']}', 'DEMO-0002', 'Alpha', 1, 'sent', now());", check=False)
    assert r.returncode != 0 and "demo" in r.stderr.lower()
    r = psql(f"insert into invoices (org_id, number, bill_company, total, status, issued_at) values "
             f"('{demo['orgA']}', 'DEMO-X', 'Alpha', 1, 'sent', now());", check=False)
    assert r.returncode != 0
