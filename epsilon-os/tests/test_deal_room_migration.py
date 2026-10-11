"""Migration 009 (deal room) against a local Postgres with stubs of Supabase's auth and storage schemas.

Same approach as test_platform_migration.py: switch to the anon / authenticated / service_role role and set
request.jwt.claims the way PostgREST does. Skipped when no local Postgres is running.
"""
import hashlib
import json
import re
import secrets
import shutil
import subprocess
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest

from tests.test_platform_migration import AUTH_STUB

ROOT = Path(__file__).resolve().parents[1]
DB = "eos_test_009"

pytestmark = pytest.mark.skipif(
    not shutil.which("pg_isready") or subprocess.run(["pg_isready", "-q"]).returncode != 0,
    reason="local postgres not available")

# The parts of Supabase's storage schema that 009 touches.
STORAGE_STUB = """
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
                                            name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.objects to authenticated;
"""

FILES = ["schema.sql"] + [f"migrations/00{n}_epsilon_os_v{n}.sql" for n in range(2, 8)] + \
        ["migrations/008_platform_foundation.sql", "migrations/009_deal_room.sql"]
NEW_TABLES = ["terms_versions", "proposals", "accept_codes", "acceptances", "invoice_counters", "invoices"]
LINES = [{"slug": "plant-visibility-pilot", "name": "Plant Visibility Pilot", "description": "two halls",
          "qty": 1, "unit_price": 18000, "amount": 18000}]


def sh(*a, check=True, input=None):
    return subprocess.run(a, capture_output=True, text=True, check=check, input=input)


def psql(sql: str, check=True):
    return sh("psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-At", "-q", check=check, input=sql)


def q(sql: str) -> str:
    return psql(sql).stdout.strip()


def as_user(sub, sql: str, aal="aal1", role="authenticated", check=False):
    claims = json.dumps({"sub": str(sub) if sub else None, "role": role, "aal": aal}).replace("'", "''")
    return psql(f"begin; set local role {role}; set local request.jwt.claims = '{claims}';\n{sql}\ncommit;", check=check)


def val(sub, sql, **kw) -> str:
    r = as_user(sub, sql, **kw)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def svc(sql: str) -> str:
    """As the server's service role (the deal-room server actions)."""
    return val(None, sql, role="service_role")


def svc_json(sql: str) -> dict:
    return json.loads(svc(sql))


def anon(sql: str):
    return as_user(None, sql, role="anon")


def lit(v) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


@pytest.fixture(scope="module")
def db():
    sh("dropdb", "--if-exists", DB)
    sh("createdb", DB)
    for role in ("service_role", "anon", "authenticated"):
        psql(f"do $$ begin if not exists (select from pg_roles where rolname='{role}') then create role {role}; end if; end $$;")
    psql(AUTH_STUB)
    psql(STORAGE_STUB)
    psql("grant usage on schema public to anon, authenticated, service_role;")
    for f in FILES:
        r = psql((ROOT / f).read_text(), check=False)
        assert r.returncode == 0, f"{f}: {r.stderr}"
    ids = {k: str(uuid.uuid4()) for k in ("founder", "client", "other", "orgOther")}
    i = ids
    q(f"""
      insert into auth.users (id, email) values ('{i['founder']}','f@x'),('{i['client']}','jonas@northwind.example'),
                                                ('{i['other']}','o@x');
      insert into staff (user_id, email) values ('{i['founder']}','f@x');
      insert into organizations (id, name, slug) values ('{i['orgOther']}','Other','other');
      insert into memberships (org_id, user_id, role) values ('{i['orgOther']}','{i['other']}','owner');
    """)
    yield ids
    sh("dropdb", "--if-exists", DB)


def new_deal(company="Northwind Industrial GmbH") -> str:
    cid = q(f"insert into companies (name) values ({lit(company)}) returning id")
    return q(f"insert into deals (company_id, title, source_channel) values ('{cid}', 'Pilot', 'inbound') returning id")


def staff(db, sql, aal="aal2"):
    return val(db["founder"], sql, aal=aal)


def create(db, deal, *, email="jonas@northwind.example", company="Northwind Industrial GmbH", lines=LINES,
           valid_until=None, title="Plant Visibility Pilot") -> str:
    vu = valid_until or (date.today() + timedelta(days=14))
    return staff(db, f"""select create_proposal('{deal}', {lit(title)}, {lit(company)}, 'Jonas Weber', {lit(email)},
        'Two halls, twelve machines.', 'Twelve machines.', '## Week 1 · Survey', '', {lit(json.dumps(lines))}::jsonb,
        null, '{vu}');""")


def send(db, pid) -> str:
    token = secrets.token_urlsafe(32)
    staff(db, f"select approve_proposal('{pid}');")
    staff(db, f"select mark_proposal_sent('{pid}', '{sha(token)}');")
    return token


def activate_terms(db, on=True):
    staff(db, f"select set_terms_active('T-2026-1', {'true' if on else 'false'});")


def start(token, name="Jonas Weber") -> dict:
    return svc_json(f"select start_acceptance({lit(token)}, {lit(name)});")


def confirm(token, code, name="Jonas Weber") -> dict:
    return svc_json(f"select confirm_acceptance({lit(token)}, {lit(code)}, {lit(name)}, '203.0.113.7', 'pytest');")


def test_reapply_is_idempotent(db):
    before = q("select count(*) from terms_versions")
    r = psql((ROOT / "migrations/009_deal_room.sql").read_text(), check=False)
    assert r.returncode == 0, r.stderr
    assert q("select count(*) from terms_versions") == before == "1"
    assert q("select active from terms_versions where version='T-2026-1'") == "f"   # seeded inactive
    assert q("select public from storage.buckets where id='invoices'") == "f"


def test_anon_and_clients_cannot_read_tables_or_call_server_rpcs(db):
    for t in NEW_TABLES:
        assert q(f"select relrowsecurity from pg_class where relname='{t}'") == "t", t
        assert q(f"select has_table_privilege('anon','{t}','select')") == "f", t
        assert anon(f"select count(*) from {t};").returncode != 0, t
        for priv in ("insert", "update", "delete"):
            assert q(f"select has_table_privilege('authenticated','{t}','{priv}')") == "f", (t, priv)
    assert q("select has_table_privilege('authenticated','accept_codes','select')") == "f"
    assert q("select has_function_privilege('anon','get_proposal_by_token(text)','execute')") == "t"
    for fn in ("start_acceptance(text,text)", "confirm_acceptance(text,text,text,inet,text)", "activate_invite(uuid)"):
        for role in ("anon", "authenticated"):
            assert q(f"select has_function_privilege('{role}','{fn}','execute')") == "f", (fn, role)
    for fn in ("approve_proposal(uuid)", "mark_proposal_sent(uuid,text)", "set_terms_active(text,boolean,text)",
               "next_invoice_number(timestamptz)", "proposal_by_token(text,boolean)"):
        assert q(f"select has_function_privilege('anon','{fn}','execute')") == "f", fn


def test_staff_rpcs_need_aal2_staff(db):
    deal = new_deal()
    args = f"'{deal}','T','Co','N','n@x.example','','','','','[]'::jsonb,null,null"
    for sub, aal in ((db["founder"], "aal1"), (db["other"], "aal2"), (db["client"], "aal1")):
        r = as_user(sub, f"select create_proposal({args});", aal=aal)
        assert r.returncode != 0 and "staff only" in r.stderr, (sub, aal)
    assert staff(db, f"select create_proposal({args});")
    assert svc(f"select create_proposal({args});")            # the worker's service role (OV1)
    assert val(db["founder"], "select count(*) from proposals;", aal="aal1") == "0"   # RLS: aal2 only
    assert int(staff(db, "select count(*) from proposals;")) >= 2


def test_sent_proposal_is_immutable(db):
    deal = new_deal()
    pid = create(db, deal)
    assert q(f"select total || '|' || version || '|' || status from proposals where id='{pid}'") == "18000.00|1|draft"
    staff(db, f"""select update_proposal_draft('{pid}', 'Plant Visibility Pilot', 'Northwind Industrial GmbH', 'Jonas Weber',
        'jonas@northwind.example', 'x', 'Twelve machines.', 'tl', '', {lit(json.dumps(LINES))}::jsonb,
        '[{{"label":"On signature","pct":40}},{{"label":"Milestone 2","pct":40}},{{"label":"On acceptance","pct":20}}]'::jsonb, null);""")
    send(db, pid)
    assert q(f"select status || '|' || length(sha256) from proposals where id='{pid}'") == "sent|64"
    r = as_user(db["founder"], f"""select update_proposal_draft('{pid}', 'Changed', 'Co', 'N', 'n@x.example', '', 's', '', '',
        '[]'::jsonb, '[{{"label":"All","pct":100}}]'::jsonb, null);""", aal="aal2")
    assert r.returncode != 0 and "immutable" in r.stderr
    # the trigger holds for every caller, including the service role and the table owner
    for sql in (f"update proposals set title='x' where id='{pid}';", f"update proposals set total=1 where id='{pid}';",
                f"update proposals set token_hash='{sha('other')}' where id='{pid}';", f"delete from proposals where id='{pid}';"):
        r = psql(sql, check=False)
        assert r.returncode != 0, sql
        r = as_user(None, sql, role="service_role")
        assert r.returncode != 0, sql
    assert q(f"select title from proposals where id='{pid}'") == "Plant Visibility Pilot"


def test_lines_and_schedule_are_validated(db):
    deal = new_deal()
    bad_amount = [dict(LINES[0], amount=1)]
    r = as_user(db["founder"], f"""select create_proposal('{deal}','T','Co','N','n@x.example','','','','',
        {lit(json.dumps(bad_amount))}::jsonb, null, null);""", aal="aal2")
    assert r.returncode != 0 and "amount" in r.stderr
    r = as_user(db["founder"], f"""select create_proposal('{deal}','T','Co','N','n@x.example','','','','',
        '[]'::jsonb, '[{{"label":"a","pct":50}},{{"label":"b","pct":40}}]'::jsonb, null);""", aal="aal2")
    assert r.returncode != 0 and "100" in r.stderr
    empty = staff(db, f"select create_proposal('{deal}','T','Co','N','n@x.example','','s','','','[]'::jsonb,null,null);")
    r = as_user(db["founder"], f"select approve_proposal('{empty}');", aal="aal2")
    assert r.returncode != 0 and "at least one price line" in r.stderr


def test_new_version_voids_old_token_when_sent(db):
    deal = new_deal()
    v1 = create(db, deal)
    t1 = send(db, v1)
    assert json.loads(anon(f"select get_proposal_by_token({lit(t1)});").stdout)["state"] == "open"
    v2 = create(db, deal)
    assert q(f"select version from proposals where id='{v2}'") == "2"
    # the old link keeps working while v2 is still a draft
    assert json.loads(anon(f"select get_proposal_by_token({lit(t1)});").stdout)["state"] == "open"
    t2 = send(db, v2)
    assert json.loads(anon(f"select get_proposal_by_token({lit(t1)});").stdout)["state"] == "void"
    assert q(f"select status from proposals where id='{v1}'") == "void"
    assert start(t1)["state"] == "void"
    assert json.loads(anon(f"select get_proposal_by_token({lit(t2)});").stdout)["state"] == "open"


def test_public_view_marks_viewed_and_hides_private_fields(db):
    deal = new_deal()
    pid = create(db, deal)
    token = send(db, pid)
    out = json.loads(anon(f"select get_proposal_by_token({lit(token)});").stdout)
    assert out["state"] == "open" and out["title"] == "Plant Visibility Pilot"
    assert out["email_masked"] == "j•••@northwind.example"
    text = json.dumps(out, ensure_ascii=False)
    assert "jonas@northwind.example" not in text and deal not in text and "token_hash" not in text
    assert q(f"select status || '|' || (viewed_at is not null) from proposals where id='{pid}'") == "viewed|true"
    first_view = q(f"select viewed_at from proposals where id='{pid}'")
    anon(f"select get_proposal_by_token({lit(token)});")
    assert q(f"select viewed_at from proposals where id='{pid}'") == first_view
    for bad in ("nope", secrets.token_urlsafe(32), "x' or 1=1 --"):
        assert json.loads(anon(f"select get_proposal_by_token({lit(bad)});").stdout)["state"] == "not_found"
    draft = create(db, new_deal())
    assert q(f"select token_hash is null from proposals where id='{draft}'") == "t"


def test_expired_proposal_is_refused(db):
    deal = new_deal()
    pid = create(db, deal, valid_until=date.today() + timedelta(days=1))
    token = send(db, pid)
    q(f"alter table proposals disable trigger proposals_guard; update proposals set valid_until = current_date - 1 where id='{pid}';"
      " alter table proposals enable trigger proposals_guard;")
    assert json.loads(anon(f"select get_proposal_by_token({lit(token)});").stdout)["state"] == "expired"
    assert q(f"select status from proposals where id='{pid}'") == "expired"
    assert start(token)["state"] == "expired"
    assert confirm(token, "123456")["state"] == "expired"


def test_terms_inactive_blocks_acceptance(db):
    activate_terms(db, False)
    deal = new_deal()
    token = send(db, create(db, deal))
    out = start(token)
    assert out["state"] == "terms_inactive" and out["notify"] is True and "code" not in out
    assert start(token)["notify"] is False                       # the founder is told once an hour, not per click
    assert confirm(token, "000000")["state"] == "terms_inactive"
    assert q(f"select count(*) from accept_codes a join proposals p on p.id=a.proposal_id where p.deal_id='{deal}'") == "0"
    assert q(f"select count(*) from acceptances a join proposals p on p.id=a.proposal_id where p.deal_id='{deal}'") == "0"


def test_code_attempts_lock_and_expiry(db):
    activate_terms(db)
    deal = new_deal()
    pid = create(db, deal)
    token = send(db, pid)
    out = start(token)
    assert out["state"] == "code_sent" and len(out["code"]) == 6 and out["code"].isdigit()
    assert out["email"] == "jonas@northwind.example" and out["email_masked"].startswith("j•••@")
    code = out["code"]
    stored = q(f"select code_hash from accept_codes where proposal_id='{pid}'")
    assert stored == sha(f"{pid}:{code}") and code not in stored
    wrong = "000000" if code != "000000" else "111111"
    for left in (4, 3, 2, 1):
        assert confirm(token, wrong) == {"state": "wrong_code", "attempts_left": left}
    assert confirm(token, wrong)["state"] == "locked"
    assert confirm(token, code)["state"] == "locked"              # the right code no longer works either
    # a fresh code works; an expired one does not
    code2 = start(token)["code"]
    q(f"update accept_codes set expires_at = now() - interval '1 second' where proposal_id='{pid}' and consumed_at is null")
    assert confirm(token, code2)["state"] == "code_expired"
    code3 = start(token)["code"]
    assert q(f"select count(*) from accept_codes where proposal_id='{pid}' and expires_at > now()") == "1"   # older codes superseded
    assert confirm(token, code3)["state"] == "accepted"


def test_start_is_rate_limited_per_token(db):
    activate_terms(db)
    token = send(db, create(db, new_deal()))
    for _ in range(5):
        assert start(token)["state"] == "code_sent"
    out = start(token)
    assert out["state"] == "rate_limited" and out["retry_at"]


def test_confirm_is_idempotent_and_creates_everything_once(db):
    activate_terms(db)
    deal = new_deal("Northwind Industrial GmbH")
    pid = create(db, deal)
    token = send(db, pid)
    code = start(token)["code"]
    first = confirm(token, code, "Jonas Weber")
    assert first["state"] == "accepted" and first["replay"] is False
    again = confirm(token, code, "Jonas Weber")
    assert again["state"] == "accepted" and again["replay"] is True
    for k in ("org_id", "invoice", "acceptance", "invite_id"):
        assert again[k] == first[k], k
    assert confirm(token, "999999")["replay"] is True             # replay never re-runs side effects
    org = first["org_id"]
    assert q(f"select count(*) from organizations where id='{org}'") == "1"
    assert q(f"select slug from organizations where id='{org}'").startswith("northwind-industrial-gmbh")
    assert q(f"select company_id = (select company_id from deals where id='{deal}') from organizations where id='{org}'") == "t"
    assert q(f"select count(*) from projects where org_id='{org}'") == "1"
    assert q(f"select email || '|' || role from invites where org_id='{org}'") == "jonas@northwind.example|owner"
    assert q(f"select count(*) from acceptances where proposal_id='{pid}'") == "1"
    assert q(f"select count(*) from invoices where proposal_id='{pid}'") == "1"
    inv = q(f"select number || '|' || status || '|' || total || '|' || (due_date - (issued_at at time zone 'Asia/Karachi')::date)"
            f" from invoices where proposal_id='{pid}'")
    number, status, total, due_in = inv.split("|")
    assert number == first["invoice"]["number"] and status == "sent" and total == "7200.00" and due_in == "14"
    assert q(f"select status || '|' || (org_id = '{org}') from proposals where id='{pid}'") == "accepted|true"
    assert q(f"select stage || '|' || (closed_at is not null) from deals where id='{deal}'") == "won|true"
    psha, tsha = q(f"select sha256 from proposals where id='{pid}'"), q("select sha256 from terms_versions where version='T-2026-1'")
    assert q(f"select sha256 || '|' || host(ip) || '|' || user_agent || '|' || name from acceptances where proposal_id='{pid}'") == \
        f"{sha(psha + tsha)}|203.0.113.7|pytest|Jonas Weber"
    assert q(f"select count(*) from actions where action='proposal_accepted' and target_id='{pid}'") == "1"
    # the public page now shows the accepted state
    out = json.loads(anon(f"select get_proposal_by_token({lit(token)});").stdout)
    assert out["state"] == "accepted" and out["invoice"]["number"] == number and out["acceptance"]["name"] == "Jonas Weber"
    # a second company with the same name gets its own slug
    deal2 = new_deal("Northwind Industrial GmbH")
    t2 = send(db, create(db, deal2))
    other = confirm(t2, start(t2)["code"])
    first_slug = q(f"select slug from organizations where id='{org}'")
    other_slug = q(f"select slug from organizations where id='{other['org_id']}'")
    assert other_slug != first_slug and re.fullmatch(r"northwind-industrial-gmbh-\d+", other_slug)


def test_invite_activation_membership_and_invoice_visibility(db):
    activate_terms(db)
    pid = create(db, new_deal("Acme Pumps"), email="jonas@northwind.example")
    token = send(db, pid)
    res = confirm(token, start(token)["code"])
    assert svc_json(f"select activate_invite('{res['invite_id']}');")["linked"] is True
    assert svc_json(f"select activate_invite('{res['invite_id']}');")["linked"] is True     # idempotent
    org = res["org_id"]
    assert q(f"select role from memberships where org_id='{org}' and user_id='{db['client']}'") == "owner"
    assert q(f"select accepted_at is not null from invites where id='{res['invite_id']}'") == "t"
    client, other = db["client"], db["other"]
    assert val(client, f"select count(*) from invoices where org_id='{org}';") == "1"
    assert val(other, f"select count(*) from invoices where org_id='{org}';") == "0"
    for t in ("proposals", "acceptances", "terms_versions", "invoice_counters"):
        assert val(client, f"select count(*) from {t};") == "0", t
    assert as_user(client, "select count(*) from accept_codes;").returncode != 0
    # stored PDF: readable by members of the org and staff only
    inv = res["invoice"]
    path = f"{org}/{inv['number']}.pdf"
    q(f"update invoices set pdf_path='{path}' where id='{inv['id']}'")
    q(f"insert into storage.objects (bucket_id, name) values ('invoices', '{path}')")
    assert val(client, f"select count(*) from storage.objects where name='{path}';") == "1"
    assert val(other, f"select count(*) from storage.objects where name='{path}';") == "0"
    assert staff(db, f"select count(*) from storage.objects where name='{path}';") == "1"
    assert as_user(db["founder"], f"select count(*) from storage.objects where name='{path}';", aal="aal1").stdout.strip() == "0"
    # an unknown email links nothing
    pid2 = create(db, new_deal("Nobody Ltd"), email="nobody@nowhere.example")
    t2 = send(db, pid2)
    r2 = confirm(t2, start(t2)["code"])
    assert svc_json(f"select activate_invite('{r2['invite_id']}');")["linked"] is False


def test_sent_invoice_is_immutable(db):
    org = db["orgOther"]
    iid = q(f"""insert into invoices (org_id, bill_company, lines, total, status) values
                ('{org}', 'Other', '[{{"title":"x","desc":"","amount":100}}]', 100, 'draft') returning id""")
    q(f"update invoices set total = 120 where id='{iid}'")                     # drafts are editable
    assert q(f"select number is null from invoices where id='{iid}'") == "t"     # drafts consume no number
    q(f"update invoices set status='sent' where id='{iid}'")
    assert q(f"select number is not null and issued_at is not null from invoices where id='{iid}'") == "t"
    for sql in (f"update invoices set total = 1 where id='{iid}';", f"update invoices set lines='[]' where id='{iid}';",
                f"update invoices set number='EL-2026-999' where id='{iid}';", f"delete from invoices where id='{iid}';",
                f"update invoices set status='draft' where id='{iid}';"):
        assert psql(sql, check=False).returncode != 0, sql
        assert as_user(None, sql, role="service_role").returncode != 0, sql
    path = f"{org}/{q(f'select number from invoices where id={lit(iid)}')}.pdf"
    q(f"update invoices set pdf_path='{path}' where id='{iid}'")                # the PDF is stored once
    assert psql(f"update invoices set pdf_path='{org}/EL-2026-998.pdf' where id='{iid}';", check=False).returncode != 0
    q(f"update invoices set status='paid', paid_at=now() where id='{iid}'")
    assert q(f"select status from invoices where id='{iid}'") == "paid"


def test_invoice_numbers_are_sequential_per_year_and_never_reused(db):
    org = db["orgOther"]

    def issue(at):
        return q(f"""insert into invoices (org_id, bill_company, total, status, issued_at)
                     values ('{org}', 'Other', 1, 'sent', '{at}') returning number""")

    q("delete from invoice_counters where year in (2031, 2032)")
    assert [issue("2031-03-01T10:00:00+05"), issue("2031-06-01T10:00:00+05")] == ["EL-2031-001", "EL-2031-002"]
    assert issue("2032-01-01T00:30:00+05") == "EL-2032-001"           # Pakistan time decides the year
    assert issue("2031-12-31T19:30:00+00") == "EL-2032-002"           # 00:30 PKT on 1 Jan 2032
    void = q(f"select id from invoices where number='EL-2031-002'")
    q(f"update invoices set status='void' where id='{void}'")
    assert issue("2031-07-01T10:00:00+05") == "EL-2031-003"           # a voided number is never handed out again
    q("update invoice_counters set last_number = 999 where year = 2031")
    assert issue("2031-08-01T10:00:00+05") == "EL-2031-1000"
    assert q("select count(*) from (select number from invoices group by number having count(*) > 1) d") == "0"


def test_terms_fingerprint_frozen_after_acceptance(db):
    activate_terms(db)
    new_sha = sha("terms with the registered address")
    assert q("select count(*) from acceptances where terms_version='T-2026-1'") != "0"   # earlier tests accepted
    r = as_user(db["founder"], f"select set_terms_active('T-2026-1', true, '{new_sha}');", aal="aal2")
    assert r.returncode != 0 and "new version" in r.stderr
    q("insert into terms_versions (version, title, pdf_path, sha256) values "
      f"('T-2026-2', 'Services Agreement', '/legal/T-2026-2.pdf', '{sha('draft')}')")
    staff(db, f"select set_terms_active('T-2026-2', true, '{new_sha}');")
    assert q("select sha256 || '|' || active || '|' || (activated_at is not null) from terms_versions where version='T-2026-2'") == \
        f"{new_sha}|true|true"
    assert as_user(db["client"], "select set_terms_active('T-2026-2', false);").returncode != 0
