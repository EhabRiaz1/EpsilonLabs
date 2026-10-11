"""Migration 008 (client platform foundation) against a local Postgres with a stub of Supabase's auth schema.

Offline counterpart of test_isolation_live.py: same rules, checked by switching to the `authenticated` role and
setting request.jwt.claims the way PostgREST does. Skipped when no local Postgres is running.
"""
import json
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DB = "eos_test_008"

pytestmark = pytest.mark.skipif(
    not shutil.which("pg_isready") or subprocess.run(["pg_isready", "-q"]).returncode != 0,
    reason="local postgres not available")

# The parts of Supabase's auth schema that 008 touches, with the same definitions Supabase ships.
AUTH_STUB = """
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
"""

FILES = ["schema.sql"] + [f"migrations/00{n}_epsilon_os_v{n}.sql" for n in range(2, 8)] + \
        ["migrations/008_platform_foundation.sql"]
NEW_TABLES = ["organizations", "staff", "memberships", "invites", "projects", "tickets", "ticket_events", "jobs"]
OLD_TABLES = ["companies", "contacts", "deals", "touches", "suppression_list", "agent_heartbeats",
              "approval_queue", "actions", "dossiers", "settings", "opportunities"]


def sh(*a, check=True, input=None):
    return subprocess.run(a, capture_output=True, text=True, check=check, input=input)


def psql(sql: str, check=True):
    return sh("psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-At", "-q", check=check, input=sql)


def q(sql: str) -> str:
    return psql(sql).stdout.strip()


def as_user(sub, sql: str, aal="aal1", role="authenticated", check=False):
    """Run sql inside one transaction as `role` with PostgREST-style JWT claims."""
    claims = json.dumps({"sub": str(sub) if sub else None, "role": role, "aal": aal})
    claims = claims.replace("'", "''")
    return psql(f"begin; set local role {role}; set local request.jwt.claims = '{claims}';\n{sql}\ncommit;", check=check)


def val(sub, sql, **kw) -> str:
    r = as_user(sub, sql, **kw)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def refused(sub, sql, **kw) -> bool:
    r = as_user(sub, sql, **kw)
    return r.returncode != 0 or r.stdout.strip() in ("", "0")


@pytest.fixture(scope="module")
def db():
    sh("dropdb", "--if-exists", DB)
    sh("createdb", DB)
    for role in ("service_role", "anon", "authenticated"):
        psql(f"do $$ begin if not exists (select from pg_roles where rolname='{role}') then create role {role}; end if; end $$;")
    psql(AUTH_STUB)
    psql("grant usage on schema public to anon, authenticated, service_role;")
    for f in FILES:
        r = psql((ROOT / f).read_text(), check=False)
        assert r.returncode == 0, f"{f}: {r.stderr}"
    ids = {k: str(uuid.uuid4()) for k in ("a", "b", "founder", "ci", "orgA", "orgB", "orgReal", "pA", "pB", "pReal")}
    i = ids
    q(f"""
      insert into auth.users (id, email) values ('{i['a']}','a@x'),('{i['b']}','b@x'),('{i['founder']}','f@x'),('{i['ci']}','ci@x');
      insert into staff (user_id, email, scope) values ('{i['founder']}','f@x','full'),('{i['ci']}','ci@x','test');
      insert into organizations (id, name, slug, is_test) values
        ('{i['orgA']}','A','org-a',true),('{i['orgB']}','B','org-b',true),('{i['orgReal']}','Real','org-real',false);
      insert into memberships (org_id, user_id, role) values ('{i['orgA']}','{i['a']}','owner'),('{i['orgB']}','{i['b']}','owner');
      insert into projects (id, org_id, name, repo_path) values
        ('{i['pA']}','{i['orgA']}','PA','/Users/x/a'),('{i['pB']}','{i['orgB']}','PB','/Users/x/b'),('{i['pReal']}','{i['orgReal']}','PR',null);
      insert into invites (org_id, email, token_hash) values ('{i['orgA']}','c@x','h1'),('{i['orgB']}','d@x','h2');
      insert into jobs (type) values ('run_agent');
      insert into companies (name) values ('Acme');
    """)
    yield ids
    sh("dropdb", "--if-exists", DB)


def test_reapply_is_idempotent_and_keeps_rows(db):
    before = q("select count(*) from organizations")
    r = psql((ROOT / "migrations/008_platform_foundation.sql").read_text(), check=False)
    assert r.returncode == 0, r.stderr
    assert q("select count(*) from organizations") == before
    assert q("select count(*) from companies") == "1"


def test_every_new_table_has_rls_and_anon_has_nothing(db):
    for t in NEW_TABLES:
        assert q(f"select relrowsecurity from pg_class where relname='{t}'") == "t", t
        assert q(f"select has_table_privilege('anon','{t}','select')") == "f", t
        for priv in ("insert", "update", "delete"):
            assert q(f"select has_table_privilege('authenticated','{t}','{priv}')") == "f", (t, priv)
        assert refused(None, f"select count(*) from {t};", role="anon")
    for fn in ("create_ticket(uuid,text,text,text,text)", "add_ticket_comment(uuid,text)", "is_staff()"):
        assert q(f"select has_function_privilege('anon','{fn}','execute')") == "f", fn


def test_member_sees_only_own_org(db):
    a, i = db["a"], db
    assert val(a, "select string_agg(slug::text, ',') from organizations;") == "org-a"
    assert val(a, f"select count(*) from projects where org_id='{i['orgB']}';") == "0"
    assert val(a, "select count(*) from projects;") == "1"
    assert val(a, "select count(*) from memberships;") == "1"
    assert val(a, "select count(*) from invites;") == "0"          # invites are staff-only
    assert val(a, "select count(*) from jobs;") == "0"
    assert val(a, "select count(*) from staff;") == "0"
    assert refused(a, "select repo_path from projects;")             # worker-only column
    for t in OLD_TABLES:
        assert val(a, f"select count(*) from {t};") == "0", t


def test_direct_writes_are_refused_for_clients(db):
    a, i = db["a"], db
    assert refused(a, f"insert into tickets (org_id, project_id, title, type) values ('{i['orgA']}','{i['pA']}','x','bug') returning 1;")
    assert refused(a, f"update projects set name='hacked' where org_id='{i['orgA']}' returning 1;")
    assert refused(a, f"insert into memberships (org_id, user_id) values ('{i['orgB']}','{a}') returning 1;")
    assert refused(a, f"insert into organizations (name, slug) values ('n','n') returning 1;")
    assert refused(a, f"delete from projects where org_id='{i['orgA']}' returning 1;")
    assert q("select name from projects where id='%s'" % i["pA"]) == "PA"


def test_create_ticket_stamps_author_and_org_and_refuses_cross_org(db):
    a, b, i = db["a"], db["b"], db
    out = json.loads(val(a, f"select create_ticket('{i['pA']}','Export recipes','why','change',null);"))
    assert out["ref"] == f"EL-{out['number']}"
    assert q(f"select org_id || '|' || author_id || '|' || priority from tickets where id='{out['id']}'") == \
        f"{i['orgA']}|{a}|normal"
    for bad in (f"select create_ticket('{i['pA']}','t','b','bug','low');",       # b is not in org A
                f"select create_ticket('{uuid.uuid4()}','t','b','bug','low');"):  # unknown project, same refusal
        r = as_user(b, bad)
        assert r.returncode != 0 and "project not found" in r.stderr
    for bad in (f"select create_ticket('{i['pA']}','','b','bug','low');",
                f"select create_ticket('{i['pA']}','t','b','nope','low');",
                f"select create_ticket('{i['pA']}','t','b','bug','asap');"):
        assert as_user(a, bad).returncode != 0
    assert as_user(None, f"select create_ticket('{i['pA']}','t','b','bug','low');", role="anon").returncode != 0
    n1 = json.loads(val(a, f"select create_ticket('{i['pA']}','second','','bug','urgent');"))["number"]
    assert n1 > out["number"]


def test_comments_and_client_visible_filter(db):
    a, b, i = db["a"], db["b"], db
    t = json.loads(val(a, f"select create_ticket('{i['pA']}','for comments','','question','low');"))["id"]
    cid = val(a, f"select add_ticket_comment('{t}','hello');")
    assert q(f"select client_visible || '|' || actor from ticket_events where id='{cid}'") == f"true|{a}"
    q(f"insert into ticket_events (org_id, ticket_id, kind, body) values ('{i['orgA']}','{t}','brief','internal')")
    assert val(a, f"select string_agg(kind, ',') from ticket_events where ticket_id='{t}';") == "comment"
    assert val(b, f"select count(*) from ticket_events where ticket_id='{t}';") == "0"
    r = as_user(b, f"select add_ticket_comment('{t}','sneaky');")
    assert r.returncode != 0 and "ticket not found" in r.stderr
    assert val(b, f"select count(*) from tickets where id='{t}';") == "0"
    # founder with aal2 sees the internal event too; their comment starts hidden from the client
    f = db["founder"]
    assert val(f, f"select count(*) from ticket_events where ticket_id='{t}';", aal="aal2") == "2"
    fid = val(f, f"select add_ticket_comment('{t}','note');", aal="aal2")
    assert q(f"select client_visible from ticket_events where id='{fid}'") == "f"


def test_staff_needs_aal2(db):
    f = db["founder"]
    assert val(f, "select count(*) from organizations;", aal="aal1") == "0"
    assert val(f, "select count(*) from companies;", aal="aal1") == "0"
    assert val(f, "select count(*) from staff;", aal="aal1") == "1"        # own row only, to route to MFA
    assert val(f, "select is_staff();", aal="aal1") == "f"
    assert val(f, "select count(*) from organizations;", aal="aal2") == "3"
    assert val(f, "select count(*) from companies;", aal="aal2") == "1"
    assert val(f, "select count(*) from jobs;", aal="aal2") == "1"
    assert val(f, "select count(*) from invites;", aal="aal2") == "2"
    assert refused(f, "update companies set name='x' returning 1;", aal="aal2")   # existing tables: read only


def test_test_scope_staff_sees_only_test_orgs(db):
    ci, i = db["ci"], db
    assert val(ci, "select count(*) from organizations;", aal="aal1") == "0"
    assert val(ci, "select string_agg(slug::text, ',' order by slug) from organizations;", aal="aal2") == "org-a,org-b"
    assert val(ci, f"select count(*) from projects where org_id='{i['orgReal']}';", aal="aal2") == "0"
    assert val(ci, "select is_staff();", aal="aal2") == "f"
    assert val(ci, "select count(*) from companies;", aal="aal2") == "0"
    assert val(ci, "select count(*) from jobs;", aal="aal2") == "0"
    r = as_user(ci, f"select create_ticket('{i['pReal']}','t','b','bug','low');", aal="aal2")
    assert r.returncode != 0 and "project not found" in r.stderr


def test_ticket_cannot_point_at_another_orgs_project(db):
    i = db
    r = psql(f"insert into tickets (org_id, project_id, title, type) values ('{i['orgA']}','{i['pB']}','x','bug');", check=False)
    assert r.returncode != 0 and "foreign key" in r.stderr
