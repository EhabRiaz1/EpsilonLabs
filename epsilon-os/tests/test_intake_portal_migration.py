"""Migration 010 (/start intake + client portal v1) against a local Postgres with stubs of Supabase's auth and storage.

Same approach as test_platform_migration.py / test_deal_room_migration.py: switch to the anon / authenticated /
service_role role and set request.jwt.claims the way PostgREST does. Skipped when no local Postgres is running.
"""
import hashlib
import json
import secrets
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from tests.test_deal_room_migration import STORAGE_STUB
from tests.test_platform_migration import AUTH_STUB

ROOT = Path(__file__).resolve().parents[1]
DB = "eos_test_010"

pytestmark = pytest.mark.skipif(
    not shutil.which("pg_isready") or subprocess.run(["pg_isready", "-q"]).returncode != 0,
    reason="local postgres not available")

# Columns of the real Supabase tables that 010 reads and the shared stubs leave out.
EXTRA_STUB = """
alter table auth.users add column if not exists raw_user_meta_data jsonb;
alter table storage.objects add column if not exists metadata jsonb;
alter table storage.buckets add column if not exists file_size_limit bigint;
alter table storage.buckets add column if not exists allowed_mime_types text[];
grant insert on storage.objects to authenticated;
"""

FILES = ["schema.sql"] + [f"migrations/00{n}_epsilon_os_v{n}.sql" for n in range(2, 8)] + \
        ["migrations/008_platform_foundation.sql", "migrations/009_deal_room.sql", "migrations/010_intake_portal.sql"]
NEW_TABLES = ["intake", "intake_rate", "files", "notifications"]
MB = 1024 * 1024


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


def refused(sub, sql, **kw) -> bool:
    r = as_user(sub, sql, **kw)
    return r.returncode != 0 or r.stdout.strip() in ("", "0")


def lit(v) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def ip_hash() -> str:
    return sha(secrets.token_hex(8))


def payload(**kw) -> dict:
    p = {"name": "Jonas Weber", "email": f"jonas-{secrets.token_hex(3)}@northwind.example", "company": "Northwind GmbH",
         "kind": "hardware", "budget": "$10k – $50k", "message": "Twelve machines, RS485.", "source": "epsilon-labs.co/start",
         "answers": {"need": "A machine nobody can read", "offer": "/services/protocol-decode/",
                     "offer_name": "Protocol Decode Sprint", "state": "Units already in the field", "when": "This quarter"}}
    p.update(kw)
    return p


def submit(p: dict, h: str | None = None, role="anon"):
    return as_user(None, f"select submit_intake({lit(h or ip_hash())}, {lit(json.dumps(p))}::jsonb);", role=role)


def submit_ok(p: dict, h: str | None = None) -> dict:
    r = submit(p, h)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


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
    for f in FILES:
        r = psql((ROOT / f).read_text(), check=False)
        assert r.returncode == 0, f"{f}: {r.stderr}"
    ids = {k: str(uuid.uuid4()) for k in ("founder", "ci", "a", "a2", "b", "out", "orgA", "orgB", "orgReal", "pA", "pB", "pReal")}
    i = ids
    q(f"""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('{i['founder']}','er@epsilon-labs.co','{{"full_name":"Ehab Riaz"}}'),('{i['ci']}','ci@x',null),
        ('{i['a']}','ayesha@a.example','{{"full_name":"Ayesha Khan"}}'),('{i['a2']}','bilal@a.example',null),
        ('{i['b']}','bo@b.example',null),('{i['out']}','new@a.example',null);
      insert into staff (user_id, email, scope) values ('{i['founder']}','er@epsilon-labs.co','full'),('{i['ci']}','ci@x','test');
      insert into organizations (id, name, slug, is_test) values
        ('{i['orgA']}','A','org-a',true),('{i['orgB']}','B','org-b',true),('{i['orgReal']}','Real','org-real',false);
      insert into memberships (org_id, user_id, role) values
        ('{i['orgA']}','{i['a']}','owner'),('{i['orgA']}','{i['a2']}','member'),('{i['orgB']}','{i['b']}','owner');
      insert into projects (id, org_id, name, repo_path) values
        ('{i['pA']}','{i['orgA']}','PA','/Users/x/a'),('{i['pB']}','{i['orgB']}','PB',null),('{i['pReal']}','{i['orgReal']}','PR',null);
    """)
    yield ids
    sh("dropdb", "--if-exists", DB)


def staff(db, sql, aal="aal2"):
    return val(db["founder"], sql, aal=aal)


def ticket(db, user="a", project="pA", title="Export recipes") -> dict:
    return json.loads(val(db[user], f"select create_ticket('{db[project]}',{lit(title)},'why','change',null);"))


# ---- shape and grants -------------------------------------------------------------------------------------------

def test_reapply_is_idempotent(db):
    r = psql((ROOT / "migrations/010_intake_portal.sql").read_text(), check=False)
    assert r.returncode == 0, r.stderr
    assert q("select public || '|' || file_size_limit || '|' || array_length(allowed_mime_types, 1)"
             " from storage.buckets where id='client-files'") == "false|26214400|9"
    assert q("select count(*) from pg_trigger where tgname='invoices_notify'") == "1"


def test_anon_may_only_submit_intake(db):
    for t in NEW_TABLES:
        assert q(f"select relrowsecurity from pg_class where relname='{t}'") == "t", t
        assert q(f"select has_table_privilege('anon','{t}','select')") == "f", t
        for priv in ("insert", "update", "delete"):
            assert q(f"select has_table_privilege('authenticated','{t}','{priv}')") == "f", (t, priv)
    assert q("select has_table_privilege('authenticated','intake_rate','select')") == "f"
    assert q("select has_function_privilege('anon','submit_intake(text,jsonb)','execute')") == "t"
    new_fns = q("""select string_agg(p.oid::regprocedure::text, ';') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('platform_is_operator_for','platform_is_owner','ticket_status_label',
                      'upload_mime_for','notify_org','invoices_notify','set_intake_status','create_org','save_project',
                      'create_invite','revoke_invite','remove_member','peek_invite','accept_invite','org_team','people',
                      'set_ticket_status','staff_ticket_reply','publish_ticket_event','begin_upload','finish_upload',
                      'mark_notifications_read')""").split(";")
    assert len(new_fns) == 22
    for fn in new_fns:
        assert q(f"select has_function_privilege('anon','{fn}','execute')") == "f", fn
    for fn in ("peek_invite(text)", "accept_invite(text)", "notify_org(uuid,text,text,text,boolean,uuid,text)",
               "platform_is_operator_for(uuid)", "upload_mime_for(text)"):
        assert q(f"select has_function_privilege('authenticated','{fn}','execute')") == "f", fn
    assert anon_cannot_read(db)


def anon_cannot_read(db) -> bool:
    return all(as_user(None, f"select count(*) from {t};", role="anon").returncode != 0 for t in NEW_TABLES)


def test_client_sees_new_project_columns_but_not_repo_path(db):
    a, i = db["a"], db
    staff(db, f"select save_project('{i['pA']}', null, 'PA', 'active', 'Pilot', '/Users/x/a', 58, 'Factory acceptance', '2026-11-06');")
    assert val(a, f"select progress || '|' || next_milestone || '|' || next_milestone_on from projects where id='{i['pA']}';") == \
        "58|Factory acceptance|2026-11-06"
    assert refused(a, "select repo_path from projects;")
    assert q(f"select repo_path from projects where id='{i['pA']}'") == "/Users/x/a"


# ---- intake ----------------------------------------------------------------------------------------------------

def test_intake_validation(db):
    bad = [payload(email="not-an-email"), payload(name=""), payload(name="x" * 201), payload(kind="firmware"),
           payload(message="x" * 10001), payload(company="x" * 201), payload(budget="x" * 81),
           payload(answers={"need": "x" * 501}), payload(answers={"Bad Key": "x"}), payload(answers=["x"]),
           payload(answers={f"k_{chr(97 + n)}": "x" for n in range(21)}), payload(answers={"need": 3})]
    for p in bad:
        r = submit(p)
        assert r.returncode != 0, p
    assert submit(payload(), h="not-a-hash").returncode != 0
    assert as_user(None, "select submit_intake('%s', '[1,2]'::jsonb);" % ip_hash(), role="anon").returncode != 0
    big = payload(padding="x" * 33000)
    assert len(json.dumps(big)) > 32768
    assert submit(big).returncode != 0
    assert q("select count(*) from intake") == "0"


def test_intake_creates_company_contact_and_inbound_lead(db):
    p = payload(email="jonas@northwind.example")
    out = submit_ok(p)
    assert out["state"] == "ok" and out["ack"] is True and out["notify"] is True
    row = q(f"select name || '|' || kind || '|' || status || '|' || deal_created from intake where id='{out['id']}'")
    assert row == "Jonas Weber|hardware|new|true"
    deal = q(f"""select d.stage || '|' || d.source_channel || '|' || d.wedge || '|' || c.name || '|' || c.domain || '|' ||
                        ct.legal_basis || '|' || (d.primary_contact_id = ct.id)
                   from intake i join deals d on d.id = i.deal_id join companies c on c.id = i.company_id
                   join contacts ct on ct.id = i.contact_id where i.id='{out['id']}'""")
    assert deal == "lead|inbound|protocol_decode|Northwind GmbH|northwind.example|inbound|true"
    assert q(f"select count(*) from actions where action='intake_received' and target_id='{out['id']}'") == "1"
    # same person again: linked to the same contact, company and open deal; no second acknowledgement today
    again = submit_ok(payload(email="Jonas@Northwind.example", message="One more thing."))
    assert again["ack"] is False and again["id"] != out["id"]
    assert q(f"select count(distinct deal_id) || '|' || count(distinct contact_id) from intake where id in ('{out['id']}','{again['id']}')") == "1|1"
    assert q(f"select deal_created from intake where id='{again['id']}'") == "f"
    # a colleague at the same domain joins the same company
    colleague = submit_ok(payload(email="anna@northwind.example", name="Anna"))
    assert q(f"select count(distinct company_id) from intake where id in ('{out['id']}','{colleague['id']}')") == "1"
    # a personal mailbox never claims its domain for a company
    free = submit_ok(payload(email="someone@gmail.com", company=""))
    assert q(f"select c.domain is null and c.name = 'Jonas Weber' from intake i join companies c on c.id=i.company_id where i.id='{free['id']}'") == "t"


def test_intake_double_submit_honeypot_suppression_and_kill_switch(db):
    p = payload()
    first = submit_ok(p)
    dup = submit_ok(p)
    assert dup["id"] == first["id"] and dup["duplicate"] is True and dup["notify"] is False
    before = q("select count(*) from intake")
    bot = submit_ok(payload(website="http://spam.example"))
    assert bot == {"state": "ok", "id": None, "ack": False, "notify": False}
    assert q("select count(*) from intake") == before
    q("insert into suppression_list (email, reason) values ('gone@suppressed.example', 'opt_out')")
    assert submit_ok(payload(email="gone@suppressed.example"))["ack"] is False
    q("insert into settings (key, value) values ('intake.enabled', 'false'::jsonb)")
    try:
        assert submit_ok(payload())["state"] == "disabled"
    finally:
        q("delete from settings where key='intake.enabled'")


def test_intake_rate_limit_per_client_and_global_cap(db):
    h = ip_hash()
    for _ in range(5):
        assert submit_ok(payload(), h)["state"] == "ok"
    before = q("select count(*) from intake")
    out = submit_ok(payload(), h)
    assert out["state"] == "rate_limited" and out["retry_at"]
    assert q("select count(*) from intake") == before
    assert submit_ok(payload(), ip_hash())["state"] == "ok"           # another client is unaffected
    assert q("select count(*) from intake_rate where ip_hash !~ '^[0-9a-f]{64}$'") == "0"   # hashes only
    # the global cap bounds a caller that rotates hashes with the public key
    q("""insert into intake (name, email, kind) select 'n', 'flood' || g || '@x.example', 'software' from generate_series(1, 60) g""")
    try:
        assert submit_ok(payload(), ip_hash())["state"] == "rate_limited"
    finally:
        q("delete from intake where email like 'flood%@x.example'")


def test_intake_is_staff_only(db):
    out = submit_ok(payload(email="iso@intake.example"))
    for sub, aal in ((db["a"], "aal1"), (db["b"], "aal1"), (db["founder"], "aal1"), (db["ci"], "aal2")):
        assert val(sub, "select count(*) from intake;", aal=aal) == "0", (sub, aal)
        r = as_user(sub, f"select set_intake_status('{out['id']}', 'contacted');", aal=aal)
        assert r.returncode != 0 and "staff only" in r.stderr
    assert int(staff(db, "select count(*) from intake;")) >= 1
    staff(db, f"select set_intake_status('{out['id']}', 'contacted');")
    assert q(f"select status || '|' || (contacted_at is not null) from intake where id='{out['id']}'") == "contacted|true"


def test_spam_closes_the_lead_it_opened(db):
    out = submit_ok(payload(email="bot@spammy.example", company="Spammy"))
    deal = q(f"select deal_id from intake where id='{out['id']}'")
    staff(db, f"select set_intake_status('{out['id']}', 'spam');")
    assert q(f"select stage || '|' || lost_reason from deals where id='{deal}'") == "lost|spam (intake)"
    assert q(f"select count(*) from actions where action='intake_spam' and target_id='{out['id']}'") == "1"


# ---- tickets ----------------------------------------------------------------------------------------------------

def test_ticket_status_rpc_is_staff_only(db):
    i = db
    t = ticket(db)
    for sub, aal in ((i["a"], "aal1"), (i["a"], "aal2"), (i["b"], "aal2"), (i["founder"], "aal1")):
        r = as_user(sub, f"select set_ticket_status('{t['id']}', 'review');", aal=aal)
        assert r.returncode != 0 and "staff only" in r.stderr, (sub, aal)
    assert as_user(None, f"select set_ticket_status('{t['id']}', 'review');", role="anon").returncode != 0
    # test-scope staff only for is_test orgs
    t_real = json.loads(staff(db, f"select create_ticket('{i['pReal']}','real','','bug',null);"))
    r = as_user(i["ci"], f"select set_ticket_status('{t_real['id']}', 'done');", aal="aal2")
    assert r.returncode != 0 and "staff only" in r.stderr
    val(i["ci"], f"select set_ticket_status('{t['id']}', 'triaged');", aal="aal2")
    staff(db, f"select set_ticket_status('{t['id']}', 'review');")
    assert q(f"select status from tickets where id='{t['id']}'") == "review"
    # the client sees the status change, the members get a notification (urgent: it needs their input)
    assert val(i["a"], f"select string_agg(data->>'to', ',' order by created_at) from ticket_events where ticket_id='{t['id']}' and kind='status';") == "triaged,review"
    assert val(i["a2"], f"select count(*) from notifications where link='/tickets/{t['id']}' and urgent;") == "1"
    assert val(i["b"], f"select count(*) from notifications where link='/tickets/{t['id']}';") == "0"
    assert q(f"select count(*) from actions where action='ticket_status' and target_id='{t['id']}'") == "2"
    assert as_user(i["founder"], f"select set_ticket_status('{t['id']}', 'bogus');", aal="aal2").returncode != 0


def test_staff_reply_internal_note_and_publish(db):
    i = db
    t = ticket(db, title="reply test")
    note = staff(db, f"select staff_ticket_reply('{t['id']}', 'internal only', false);")
    reply = staff(db, f"select staff_ticket_reply('{t['id']}', 'Reproduced, fix lands Friday.', true);")
    bodies = val(i["a"], f"select string_agg(body, '|' order by created_at) from ticket_events where ticket_id='{t['id']}' and kind='comment';")
    assert bodies == "Reproduced, fix lands Friday."
    assert val(i["a"], f"select count(*) from notifications where kind='reply' and link='/tickets/{t['id']}';") == "1"
    r = as_user(i["a"], f"select staff_ticket_reply('{t['id']}', 'x', true);")
    assert r.returncode != 0 and "staff only" in r.stderr
    # a client's own comment can't be "published" by anyone; an internal staff note can, once
    own = val(i["a"], f"select add_ticket_comment('{t['id']}', 'thanks');")
    assert as_user(i["founder"], f"select publish_ticket_event('{own}');", aal="aal2").returncode != 0
    assert as_user(i["a"], f"select publish_ticket_event('{note}');").returncode != 0
    staff(db, f"select publish_ticket_event('{note}');")
    assert val(i["a"], f"select count(*) from ticket_events where id='{note}';") == "1"
    assert q(f"select count(*) from actions where action='ticket_reply_sent' and target_id in ('{note}','{reply}')") == "2"


# ---- files and storage --------------------------------------------------------------------------------------------

def begin(db, user, project=None, ticket_id=None, name="palette-A.pdf", mime="application/pdf", size=1000, aal="aal1"):
    p = f"'{db[project]}'" if project else "null"
    t = f"'{ticket_id}'" if ticket_id else "null"
    return as_user(db[user] if user in db else user, f"select begin_upload({p}, {t}, {lit(name)}, {lit(mime)}, {size});", aal=aal)


def test_upload_rules(db):
    i = db
    ok = json.loads(begin(db, "a", project="pA").stdout)
    assert ok["path"].startswith(f"{i['orgA']}/{i['pA']}/{ok['id']}-palette-A.pdf")
    t = ticket(db, title="with attachment")
    on_ticket = json.loads(begin(db, "a2", ticket_id=t["id"], name="Panel photo (1).JPG", mime="image/jpeg").stdout)
    assert on_ticket["path"] == f"{i['orgA']}/{t['id']}/{on_ticket['id']}-Panel-photo-1.jpg"
    assert q(f"select project_id from files where id='{on_ticket['id']}'") == i["pA"]
    for kw, msg in ((dict(project="pB"), "not found"),                                  # another org's project
                    (dict(ticket_id=t["id"], user="b"), "not found"),                  # another org's ticket
                    (dict(project="pA", name="run.exe", mime="application/octet-stream"), "not allowed"),
                    (dict(project="pA", name="x.pdf", mime="text/html"), "does not match"),
                    (dict(project="pA", size=25 * MB + 1), "25 MB"),
                    (dict(project="pA", size=0), "25 MB")):
        user = kw.pop("user", "a")
        r = begin(db, user, **kw)
        assert r.returncode != 0 and msg in r.stderr, (kw, r.stderr)
    assert begin(db, "a", project="pA", name="model.STEP", mime="model/step").returncode == 0
    assert begin(db, "a", project="pA", name="board.zip", mime="application/zip", size=25 * MB).returncode == 0
    assert as_user(None, f"select begin_upload('{i['pA']}', null, 'a.pdf', 'application/pdf', 10);", role="anon").returncode != 0


def test_storage_policies_and_finish(db):
    i = db
    f = json.loads(begin(db, "a", project="pA", name="spec.pdf").stdout)
    path = f["path"]
    # the uploader may write exactly the registered path; nobody else, and no other path
    assert as_user(i["b"], f"insert into storage.objects (bucket_id, name) values ('client-files', {lit(path)});").returncode != 0
    assert as_user(i["a"], f"insert into storage.objects (bucket_id, name) values ('client-files', '{i['orgA']}/{i['pA']}/x.pdf');").returncode != 0
    assert as_user(i["a2"], f"insert into storage.objects (bucket_id, name) values ('client-files', {lit(path)});").returncode != 0
    r = as_user(i["a"], f"select finish_upload('{f['id']}');")
    assert r.returncode != 0 and "upload not found" in r.stderr
    val(i["a"], f"""insert into storage.objects (bucket_id, name, metadata) values ('client-files', {lit(path)}, '{{"size": 1000}}');""")
    # pending: only the uploader sees the row; the other member does not yet
    assert val(i["a2"], f"select count(*) from files where id='{f['id']}';") == "0"
    assert as_user(i["a2"], f"select finish_upload('{f['id']}');").returncode != 0      # only the uploader finishes
    assert json.loads(val(i["a"], f"select finish_upload('{f['id']}');"))["status"] == "ready"
    assert json.loads(val(i["a"], f"select finish_upload('{f['id']}');"))["status"] == "ready"   # idempotent
    # ready: members and staff read the row and the object; the other org reads neither
    for sub, aal, n in ((i["a2"], "aal1", "1"), (i["founder"], "aal2", "1"), (i["b"], "aal1", "0"),
                        (i["founder"], "aal1", "0"), (i["out"], "aal1", "0")):
        assert val(sub, f"select count(*) from files where id='{f['id']}';", aal=aal) == n, (sub, aal)
        assert val(sub, f"select count(*) from storage.objects where name={lit(path)};", aal=aal) == n, (sub, aal)
    # a new-file notification for the other members, not the uploader
    assert val(i["a2"], "select count(*) from notifications where kind='file' and title like '%spec.pdf%';") == "1"
    assert val(i["a"], "select count(*) from notifications where kind='file' and title like '%spec.pdf%';") == "0"
    # oversized object reported by Storage is refused
    big = json.loads(begin(db, "a", project="pA", name="big.pdf").stdout)
    val(i["a"], f"""insert into storage.objects (bucket_id, name, metadata) values ('client-files', {lit(big['path'])}, '{{"size": {26 * MB}}}');""")
    r = as_user(i["a"], f"select finish_upload('{big['id']}');")
    assert r.returncode != 0 and "25 MB" in r.stderr


# ---- notifications ------------------------------------------------------------------------------------------------

def test_notifications_are_private_and_invoice_issue_notifies(db):
    i = db
    iid = q(f"""insert into invoices (org_id, bill_company, total, status) values ('{i['orgA']}', 'A', 100, 'draft') returning id""")
    assert q(f"select count(*) from notifications where link='/invoices/{iid}'") == "0"      # drafts are silent
    q(f"update invoices set status='sent' where id='{iid}'")
    assert q(f"select count(*) || '|' || bool_and(urgent) from notifications where link='/invoices/{iid}'") == "2|true"   # a and a2
    assert val(i["a"], f"select count(*) from notifications where link='/invoices/{iid}';") == "1"
    assert val(i["b"], f"select count(*) from notifications where link='/invoices/{iid}';") == "0"
    assert val(i["founder"], f"select count(*) from notifications where link='/invoices/{iid}';", aal="aal2") == "0"   # personal
    q(f"update invoices set status='paid', paid_at=now() where id='{iid}'")
    assert q(f"select count(*) from notifications where link='/invoices/{iid}'") == "2"         # issued once
    # mark read touches only the caller's own rows
    other = q(f"select id from notifications where user_id='{i['a2']}' and link='/invoices/{iid}'")
    assert val(i["a"], f"select mark_notifications_read(array['{other}'::uuid]);") == "0"
    assert int(val(i["a"], "select mark_notifications_read(null);")) >= 1
    assert val(i["a"], "select count(*) from notifications where read_at is null;") == "0"
    assert q(f"select read_at is null from notifications where id='{other}'") == "t"
    assert refused(i["a"], f"update notifications set read_at=null where user_id='{i['a']}' returning 1;")
    # a member removed from the org stops seeing that org's notifications
    q(f"insert into notifications (org_id, user_id, kind, title) values ('{i['orgB']}', '{i['a']}', 'file', 'stale')")
    assert val(i["a"], "select count(*) from notifications where title='stale';") == "0"


# ---- organisations, invites, team ---------------------------------------------------------------------------------

def test_create_org_and_projects_are_staff_only(db):
    i = db
    for sub, aal in ((i["a"], "aal1"), (i["founder"], "aal1"), (i["ci"], "aal2")):
        r = as_user(sub, "select create_org('X', 'x-org', null, null);", aal=aal)
        assert r.returncode != 0 and "staff only" in r.stderr
    org = staff(db, "select create_org('Master Paints', 'master-paints', 'masterpaints.example', null);")
    assert as_user(i["founder"], "select create_org('Dup', 'master-paints', null, null);", aal="aal2").returncode != 0
    assert as_user(i["founder"], "select create_org('Bad', 'Bad Slug', null, null);", aal="aal2").returncode != 0
    pid = staff(db, f"select save_project(null, '{org}', 'Tinting HMI', 'active', 'HMI', '~/dev/mp', 10, null, null);")
    assert q(f"select org_id || '|' || repo_path from projects where id='{pid}'") == f"{org}|~/dev/mp"
    r = as_user(i["a"], f"select save_project(null, '{i['orgA']}', 'mine', 'active', '', '', null, null, null);")
    assert r.returncode != 0 and "staff only" in r.stderr
    assert as_user(i["founder"], f"select save_project('{pid}', '{i['orgA']}', 'moved', 'active', '', '', null, null, null);",
                   aal="aal2").returncode != 0
    assert q(f"select count(*) from actions where action='org_created' and target_id='{org}'") == "1"


def test_invites_owner_rules_peek_accept_revoke(db):
    i = db
    tok = secrets.token_urlsafe(32)
    # a member who is not an owner cannot invite; an owner can invite members only; another org cannot
    r = as_user(i["a2"], f"select create_invite('{i['orgA']}', 'x@a.example', 'member', '{sha(tok)}');")
    assert r.returncode != 0 and "not allowed" in r.stderr
    r = as_user(i["a"], f"select create_invite('{i['orgA']}', 'x@a.example', 'owner', '{sha(tok)}');")
    assert r.returncode != 0 and "members only" in r.stderr
    assert as_user(i["b"], f"select create_invite('{i['orgA']}', 'x@a.example', 'member', '{sha(tok)}');").returncode != 0
    r = as_user(i["a"], f"select create_invite('{i['orgA']}', 'bilal@a.example', 'member', '{sha(tok)}');")
    assert r.returncode != 0 and "already a member" in r.stderr
    inv = json.loads(val(i["a"], f"select create_invite('{i['orgA']}', 'New@A.example', 'member', '{sha(tok)}');"))
    assert inv["org_name"] == "A" and inv["role"] == "member"
    assert q(f"select email || '|' || (expires_at - created_at = interval '7 days') from invites where id='{inv['id']}'") == "new@a.example|true"
    # peek and accept are server-only
    for fn in (f"peek_invite({lit(tok)})", f"accept_invite({lit(tok)})"):
        assert as_user(None, f"select {fn};", role="anon").returncode != 0
        assert as_user(i["a"], f"select {fn};").returncode != 0
    peek = json.loads(val(None, f"select peek_invite({lit(tok)});", role="service_role"))
    assert peek["state"] == "open" and peek["email"] == "new@a.example" and peek["email_masked"] == "n•••@a.example"
    assert json.loads(val(None, f"select peek_invite('{secrets.token_urlsafe(32)}');", role="service_role"))["state"] == "not_found"
    acc = json.loads(val(None, f"select accept_invite({lit(tok)});", role="service_role"))
    assert acc["state"] == "accepted" and acc["org_id"] == i["orgA"]
    assert q(f"select role from memberships where org_id='{i['orgA']}' and user_id='{i['out']}'") == "member"
    assert json.loads(val(None, f"select accept_invite({lit(tok)});", role="service_role"))["state"] == "used"
    # a re-invite replaces the pending one; revoked and expired links are refused
    t2, t3 = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    first = json.loads(staff(db, f"select create_invite('{i['orgB']}', 'later@b.example', 'owner', '{sha(t2)}');"))
    second = json.loads(staff(db, f"select create_invite('{i['orgB']}', 'later@b.example', 'member', '{sha(t3)}');"))
    assert json.loads(val(None, f"select peek_invite({lit(t2)});", role="service_role"))["state"] == "revoked"
    assert as_user(i["a"], f"select revoke_invite('{second['id']}');").returncode != 0         # not A's invite
    val(i["b"], f"select revoke_invite('{second['id']}');")                                     # B's owner may
    assert json.loads(val(None, f"select accept_invite({lit(t3)});", role="service_role"))["state"] == "revoked"
    t4 = secrets.token_urlsafe(32)
    staff(db, f"select create_invite('{i['orgB']}', 'late@b.example', 'member', '{sha(t4)}');")
    q(f"update invites set expires_at = now() - interval '1 second' where token_hash='{sha(t4)}'")
    assert json.loads(val(None, f"select accept_invite({lit(t4)});", role="service_role"))["state"] == "expired"
    assert first["id"] != second["id"]
    assert q("select count(*) from actions where action in ('invite_created','invite_revoked','invite_accepted')") != "0"


def test_team_list_people_and_remove_member(db):
    i = db
    team = json.loads(val(i["a2"], f"select org_team('{i['orgA']}');"))
    assert team["can_manage"] is False and team["invites"] == []
    names = {m["email"]: m for m in team["members"]}
    assert names["ayesha@a.example"]["name"] == "Ayesha Khan" and names["bilal@a.example"]["is_me"] is True
    assert json.loads(val(i["a"], f"select org_team('{i['orgA']}');"))["can_manage"] is True
    assert as_user(i["b"], f"select org_team('{i['orgA']}');").returncode != 0
    assert json.loads(staff(db, f"select org_team('{i['orgA']}');"))["can_manage"] is True
    # people(): names for co-members and staff only
    seen = {p["id"]: p for p in json.loads(val(i["a"], f"select people(array['{i['a2']}','{i['b']}','{i['founder']}']::uuid[]);"))}
    assert set(seen) == {i["a2"], i["founder"]} and seen[i["founder"]]["staff"] is True and seen[i["founder"]]["name"] == "Ehab Riaz"
    assert as_user(None, f"select people(array['{i['a']}']::uuid[]);", role="anon").returncode != 0
    # owners and staff remove members; the last owner stays
    r = as_user(i["a2"], f"select remove_member('{i['orgA']}', '{i['out']}');")
    assert r.returncode != 0 and "not allowed" in r.stderr
    val(i["a"], f"select remove_member('{i['orgA']}', '{i['out']}');")
    assert q(f"select count(*) from memberships where org_id='{i['orgA']}' and user_id='{i['out']}'") == "0"
    r = as_user(i["a"], f"select remove_member('{i['orgA']}', '{i['a']}');")
    assert r.returncode != 0 and "at least one owner" in r.stderr
