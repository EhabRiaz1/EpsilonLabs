"""Migration 012 (comms, weekly updates, reports, invoices beyond the deposit, referrals, testimonials, retainers) against a
local Postgres with the same Supabase stubs as test_intake_portal_migration.py. Skipped when no local Postgres is running.

Every call switches to the anon / authenticated / service_role role and sets request.jwt.claims the way PostgREST does.
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from tests.test_deal_room_migration import STORAGE_STUB
from tests.test_intake_portal_migration import EXTRA_STUB, FILES, ROOT, sh
from tests.test_platform_migration import AUTH_STUB
from tests import test_intake_portal_migration as base

DB = "eos_test_012"
pytestmark = base.pytestmark
ALL = FILES + ["migrations/011_rulebook_push.sql", "migrations/012_comms_billing.sql"]
NEW_TABLES = ["profiles", "email_digests", "updates", "reports", "testimonials", "retainers", "time_entries"]
PKT = timezone(timedelta(hours=5))


def psql(sql: str, check=True):
    return sh("psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-At", "-q", check=check, input=sql)


def q(sql: str) -> str:
    return psql(sql).stdout.strip()


def qj(sql: str):
    return json.loads(q(sql) or "null")


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
    """Runs fn and returns its value as JSON (null for void)."""
    r = as_user(sub, f"select to_jsonb(x) from (select {_sql(fn, args)} as x) s;", aal=aal, role=role)
    assert r.returncode == 0, r.stderr
    out = r.stdout.strip()
    return json.loads(out) if out else None


def fails(fn, args: dict, sub=None, aal="aal2", role="authenticated") -> str:
    r = as_user(sub, f"select {_sql(fn, args)};", aal=aal, role=role)
    assert r.returncode != 0, f"{fn} should have been refused"
    return r.stderr


def svc(fn, **args):
    return call(fn, args, role="service_role")


def rows_as(sub, sql, aal="aal1") -> list:
    r = as_user(sub, f"select coalesce(json_agg(t), '[]') from ({sql}) t;", aal=aal)
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
    for f in ALL:
        r = psql((ROOT / f).read_text(), check=False)
        assert r.returncode == 0, f"{f}: {r.stderr}"
    i = {k: str(uuid.uuid4()) for k in ("founder", "ci", "a", "a2", "b", "orgA", "orgB", "orgT", "pA", "pB", "pT", "co", "deal")}
    q(f"""
      insert into auth.users (id, email, raw_user_meta_data) values
        ('{i['founder']}','er@epsilon-labs.co','{{"full_name":"Ehab Riaz"}}'),('{i['ci']}','ci@x',null),
        ('{i['a']}','ayesha@a.example','{{"full_name":"Ayesha Khan"}}'),('{i['a2']}','bilal@a.example',null),
        ('{i['b']}','bo@b.example',null);
      insert into staff (user_id, email, scope) values ('{i['founder']}','er@epsilon-labs.co','full'),('{i['ci']}','ci@x','test');
      insert into organizations (id, name, slug) values ('{i['orgA']}','Alpha Mills','alpha'),('{i['orgB']}','Beta Fuels','beta');
      insert into organizations (id, name, slug, is_test) values ('{i['orgT']}','Test Org','test-org', true);
      insert into memberships (org_id, user_id, role) values
        ('{i['orgA']}','{i['a']}','owner'),('{i['orgA']}','{i['a2']}','member'),('{i['orgB']}','{i['b']}','owner');
      insert into projects (id, org_id, name) values ('{i['pA']}','{i['orgA']}','Plant dashboard'),
        ('{i['pB']}','{i['orgB']}','Forecourt'),('{i['pT']}','{i['orgT']}','Test project');
      insert into companies (id, name) values ('{i['co']}', 'Alpha Mills');
      insert into deals (id, company_id, title, source_channel) values ('{i['deal']}', '{i['co']}', 'Plant dashboard', 'inbound');
    """)
    yield i
    sh("dropdb", "--if-exists", DB)


def staff(i):
    return {"sub": i["founder"], "aal": "aal2"}


def note(user, org, title="Ticket moved", urgent=False, kind="ticket_status", created=None) -> str:
    at = f"'{created}'" if created else "now()"
    return q(f"insert into notifications (org_id, user_id, kind, title, link, urgent, created_at) values "
             f"({lit(org)}, '{user}', '{kind}', {lit(title)}, '/', {lit(urgent)}, {at}) returning id")


def reset_mail():
    q("delete from notifications; delete from email_digests; delete from profiles; delete from suppression_list;")


def tomorrow_at_pkt(hour: int, minute: int = 0) -> str:
    d = datetime.now(PKT).date() + timedelta(days=1)
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=PKT).astimezone(timezone.utc).isoformat()


# ------------------------------------------------------------------ schema

def test_reapply_is_idempotent_and_widened_checks(db):
    r = psql((ROOT / "migrations/012_comms_billing.sql").read_text(), check=False)
    assert r.returncode == 0, r.stderr
    assert q("select count(*) from pg_constraint where conname = 'notifications_kind_check'") == "1"
    assert "referral" in q("select pg_get_constraintdef(oid) from pg_constraint where conname = 'approval_queue_kind_check'")
    q("insert into approval_queue (agent, kind, draft, to_email) values ('referral', 'referral', 'Hi', 'x@y.example')")


def test_new_tables_have_rls_and_no_anon_and_no_client_writes(db):
    for t in NEW_TABLES:
        assert q(f"select relrowsecurity from pg_class where relname='{t}'") == "t", t
        assert q(f"select has_table_privilege('anon','{t}','select')") == "f", t
        for priv in ("insert", "update", "delete"):
            assert q(f"select has_table_privilege('authenticated','{t}','{priv}')") == "f", (t, priv)
    for fn in ("claim_email_batch(timestamptz,integer)", "finish_email(uuid,uuid,boolean,text)", "publish_update(uuid)",
               "save_my_prefs(text,text)", "retainer_usage(uuid,integer,date)", "submit_testimonial(uuid,uuid,text,text,text)",
               "queue_weekly_updates(date)", "mark_report_published(uuid,text)", "issue_invoice(uuid)"):
        assert q(f"select has_function_privilege('anon','{fn}','execute')") == "f", fn
    for fn in ("claim_email_batch(timestamptz,integer)", "finish_email(uuid,uuid,boolean,text)", "queue_weekly_updates(date)",
               "mark_report_published(uuid,text)"):
        assert q(f"select has_function_privilege('authenticated','{fn}','execute')") == "f", fn


# ------------------------------------------------------------------ digest

def test_urgent_is_immediate_and_rest_waits_for_the_10am_digest(db):
    i = db
    reset_mail()
    u1 = note(i["a"], i["orgA"], "Invoice EL-2026-009 issued", urgent=True, kind="invoice")
    n1 = note(i["a"], i["orgA"], "EL-4 moved to In progress")
    n2 = note(i["a"], i["orgA"], "New file: spec.pdf", kind="file")
    early = svc("claim_email_batch", p_now=tomorrow_at_pkt(9, 30))
    assert [(e["mode"], [x["id"] for x in e["items"]]) for e in early["emails"]] == [("immediate", [u1])]
    assert early["emails"][0]["to"] == "ayesha@a.example" and early["emails"][0]["name"] == "Ayesha Khan"
    assert early["emails"][0]["items"][0]["org_name"] == "Alpha Mills"
    svc("finish_email", p_claim=early["claim"], p_user_id=i["a"], p_ok=True)
    assert q(f"select email_state || '|' || (emailed_at is not null)::text from notifications where id = '{u1}'") == "sent|true"
    # nothing else before 10:00 local
    assert svc("claim_email_batch", p_now=tomorrow_at_pkt(9, 45))["emails"] == []
    at10 = svc("claim_email_batch", p_now=tomorrow_at_pkt(10, 1))
    (e,) = at10["emails"]
    assert e["mode"] == "digest" and {x["id"] for x in e["items"]} == {n1, n2}
    # a retry of the route while the first call is still sending claims nothing (idempotent)
    assert svc("claim_email_batch", p_now=tomorrow_at_pkt(10, 2))["emails"] == []
    svc("finish_email", p_claim=at10["claim"], p_user_id=i["a"], p_ok=True)
    assert q(f"select state from email_digests where user_id = '{i['a']}'") == "sent"
    # at most one digest per local day: a later non-urgent row waits until tomorrow; urgent still goes at once
    n3 = note(i["a"], i["orgA"], "Reply on EL-4", kind="reply")
    assert svc("claim_email_batch", p_now=tomorrow_at_pkt(16, 0))["emails"] == []
    u2 = note(i["a"], i["orgA"], "Report published", urgent=True, kind="report")
    later = svc("claim_email_batch", p_now=tomorrow_at_pkt(16, 5))
    assert [(x["mode"], [y["id"] for y in x["items"]]) for x in later["emails"]] == [("immediate", [u2])]
    assert q(f"select email_state is null from notifications where id = '{n3}'") == "t"


def test_preferences_timezone_off_and_immediate(db):
    i = db
    reset_mail()
    assert call("save_my_prefs", {"p_timezone": "America/New_York", "p_email_pref": "daily"}, sub=i["a"], aal="aal1") == \
        {"timezone": "America/New_York", "email_pref": "daily"}
    assert "unknown timezone" in fails("save_my_prefs", {"p_timezone": "Mars/Base", "p_email_pref": "daily"}, sub=i["a"], aal="aal1")
    assert "immediate, daily or off" in fails("save_my_prefs", {"p_timezone": "UTC", "p_email_pref": "hourly"}, sub=i["a"], aal="aal1")
    assert "permission denied" in fails("save_my_prefs", {"p_timezone": "UTC", "p_email_pref": "off"}, role="anon")
    call("save_my_prefs", {"p_timezone": "Asia/Karachi", "p_email_pref": "immediate"}, sub=i["a2"], aal="aal1")
    call("save_my_prefs", {"p_timezone": "Asia/Karachi", "p_email_pref": "off"}, sub=i["b"], aal="aal1")
    na = note(i["a"], i["orgA"])
    na2 = note(i["a2"], i["orgA"])
    nb = note(i["b"], i["orgB"], urgent=True)
    # 10:30 PKT is 01:30 in New York: Ayesha's digest is not due; Bilal (immediate) gets his at once; Bo is off
    r = svc("claim_email_batch", p_now=tomorrow_at_pkt(10, 30))
    assert [(e["to"], e["mode"]) for e in r["emails"]] == [("bilal@a.example", "immediate")]
    assert q(f"select email_state || ':' || email_error from notifications where id = '{nb}'") == "skipped:email off"
    assert q(f"select email_state is null from notifications where id = '{na}'") == "t"
    assert na2 in [x["id"] for x in r["emails"][0]["items"]]
    svc("finish_email", p_claim=r["claim"], p_user_id=i["a2"], p_ok=True)
    # 10:00 in New York is 15:00 UTC (EDT) / 20:00 PKT: due then
    ny10 = datetime.now(PKT).date() + timedelta(days=1)
    r2 = svc("claim_email_batch", p_now=f"{ny10.isoformat()}T15:05:00+00:00")
    assert [(e["to"], e["mode"], e["timezone"]) for e in r2["emails"]] == [("ayesha@a.example", "digest", "America/New_York")]
    assert [x["id"] for x in r2["emails"][0]["items"]] == [na]


def test_suppression_test_orgs_stale_and_ex_members_are_skipped(db):
    i = db
    reset_mail()
    q("insert into suppression_list (email, reason) values ('ayesha@a.example', 'hard_bounce')")
    s = note(i["a"], i["orgA"], urgent=True)
    t = note(i["a2"], i["orgT"], urgent=True)
    old = note(i["a2"], i["orgA"], urgent=True, created=(datetime.now(timezone.utc) - timedelta(days=4)).isoformat())
    x = note(i["b"], i["orgA"], urgent=True)            # Bo is not a member of Alpha
    r = svc("claim_email_batch", p_now=tomorrow_at_pkt(11))
    assert r["emails"] == []
    got = dict(tuple(l.split("|")) for l in q(f"select id || '|' || email_state || ':' || email_error from notifications").splitlines())
    assert got == {s: "suppressed:suppressed address", t: "skipped:test or demo org", old: "skipped:stale", x: "skipped:no longer a member"}


def test_failed_send_is_retried_then_failed_and_lapsed_claims_return(db):
    i = db
    reset_mail()
    n = note(i["a"], i["orgA"], urgent=True)
    for attempt in (1, 2, 3):
        r = svc("claim_email_batch", p_now=tomorrow_at_pkt(11, attempt))
        assert [x["id"] for x in r["emails"][0]["items"]] == [n]
        svc("finish_email", p_claim=r["claim"], p_user_id=i["a"], p_ok=False, p_error="SMTP 451")
    assert q(f"select email_state || '|' || email_attempts || '|' || email_error from notifications where id = '{n}'") == "failed|3|SMTP 451"
    # a sender that died: the claim lapses after 10 minutes and the row is claimed again
    m = note(i["a2"], i["orgA"], urgent=True)
    first = svc("claim_email_batch", p_now=tomorrow_at_pkt(12, 0))
    assert svc("claim_email_batch", p_now=tomorrow_at_pkt(12, 5))["emails"] == []
    again = svc("claim_email_batch", p_now=tomorrow_at_pkt(12, 11))
    assert [x["id"] for x in again["emails"][0]["items"]] == [m] and again["claim"] != first["claim"]
    # the stale claim cannot finish the row any more
    assert svc("finish_email", p_claim=first["claim"], p_user_id=i["a2"], p_ok=True) == 0
    assert svc("finish_email", p_claim=again["claim"], p_user_id=i["a2"], p_ok=True) == 1


def test_mailer_is_service_only(db):
    i = db
    assert "permission denied" in fails("claim_email_batch", {"p_now": None}, **staff(i))
    assert "permission denied" in fails("finish_email", {"p_claim": str(uuid.uuid4()), "p_user_id": i["a"], "p_ok": True}, **staff(i))


# ------------------------------------------------------------------ weekly updates (E2)

def test_weekly_update_draft_publish_rules(db):
    i = db
    week = "2026-10-12"
    r = svc("save_update_draft", p_project_id=i["pA"], p_title="Week of 12 Oct", p_body_md="## Done this week\n- x",
            p_source="weekly", p_week_of=week, p_inputs={"tickets_done": 1}, p_lint=[])
    uid = r["id"]
    assert r["state"] == "created"
    assert rows_as(i["a"], "select id from updates") == []                      # drafts are staff-only
    assert len(rows_as(i["founder"], "select id from updates", aal="aal2")) == 1
    # a re-run refreshes an untouched draft, and keeps one the founder edited
    assert svc("save_update_draft", p_project_id=i["pA"], p_title="Week of 12 Oct", p_body_md="## Done this week\n- y",
               p_source="weekly", p_week_of=week)["state"] == "refreshed"
    call("edit_update", {"p_id": uid, "p_title": "Week of 12 Oct", "p_body_md": "## Done this week\n- edited"}, **staff(i))
    assert svc("save_update_draft", p_project_id=i["pA"], p_title="t", p_body_md="z", p_source="weekly", p_week_of=week)["state"] == "kept"
    assert q(f"select body_md from updates where id = '{uid}'").endswith("edited")
    # only staff (aal2) publish; clients and aal1 are refused
    fails("publish_update", {"p_id": uid}, sub=i["a"], aal="aal1")
    fails("publish_update", {"p_id": uid}, sub=i["founder"], aal="aal1")
    assert call("publish_update", {"p_id": uid}, **staff(i)) == {"ok": True, "already": False}
    assert call("publish_update", {"p_id": uid}, **staff(i)) == {"ok": True, "already": True}
    assert [u["id"] for u in rows_as(i["a"], "select id from updates")] == [uid]
    assert rows_as(i["b"], "select id from updates") == []
    assert q(f"select count(*) from notifications where kind = 'update' and org_id = '{i['orgA']}'") == "2"
    assert q(f"select count(*) from notifications where kind = 'update' and org_id <> '{i['orgA']}'") == "0"
    assert "immutable" in psql(f"update updates set body_md = 'x' where id = '{uid}'", check=False).stderr
    assert "only a draft" in fails("edit_update", {"p_id": uid, "p_title": "t", "p_body_md": "b"}, **staff(i))
    assert "published update cannot be skipped" in fails("skip_update", {"p_id": uid}, **staff(i))


def test_skip_and_weekly_queue_once_per_week(db):
    i = db
    r = svc("save_update_draft", p_project_id=i["pB"], p_title="W", p_body_md="b", p_source="weekly", p_week_of="2026-10-05")
    call("skip_update", {"p_id": r["id"], "p_reason": "quiet week"}, **staff(i))
    assert "skipped update cannot be published" in fails("publish_update", {"p_id": r["id"]}, **staff(i))
    week = "2026-10-19"
    n = svc("queue_weekly_updates", p_week_of=week)
    jobs = qj(f"select json_agg(params ->> 'project_id') from jobs where type = 'weekly_update' and params ->> 'week_of' = '{week}'")
    assert n == 2 and set(jobs) == {i["pA"], i["pB"]}                       # never the is_test org's project
    assert svc("queue_weekly_updates", p_week_of=week) == 0
    assert "permission denied" in fails("queue_weekly_updates", {"p_week_of": week}, **staff(i))
    # bad params never queue
    bad = psql("insert into jobs (type, params) values ('weekly_update', '{\"project_id\":\"x\",\"week_of\":\"2026-10-19\"}')", check=False)
    assert bad.returncode != 0 and "jobs_weekly_update_params" in bad.stderr
    # "Draft now" from admin: one live job per project and week
    a = call("queue_weekly_update", {"p_project_id": i["pA"], "p_notes": "Mention the sensor swap"}, **staff(i))
    b = call("queue_weekly_update", {"p_project_id": i["pA"]}, **staff(i))
    assert b["already"] is True and b["id"] == a["id"]
    assert qj(f"select params from jobs where id = '{a['id']}'")["notes"] == "Mention the sensor swap"
    fails("queue_weekly_update", {"p_project_id": i["pA"]}, sub=i["a"], aal="aal1")


# ------------------------------------------------------------------ reports

def test_report_draft_approve_publish_rules(db):
    i = db
    content = {"summary": ["It works."], "sections": [{"title": "Sensing", "rows": []}], "kpis": []}
    rid = call("save_report_draft", {"p_id": None, "p_project_id": i["pA"], "p_title": "Release 1", "p_period_label": "October 2026",
                                     "p_content": content}, **staff(i))
    assert rows_as(i["a"], "select id from reports") == []
    fails("approve_report", {"p_id": rid}, sub=i["a"], aal="aal1")
    call("approve_report", {"p_id": rid}, **staff(i))
    assert "frozen" in psql(f"update reports set content = '{{}}' where id = '{rid}'", check=False).stderr
    # an edit after approval sends it back to draft
    call("save_report_draft", {"p_id": rid, "p_project_id": None, "p_title": "Release 1", "p_period_label": "Oct",
                               "p_content": content}, **staff(i))
    assert q(f"select status from reports where id = '{rid}'") == "draft"
    assert "only an approved" in fails("mark_report_published", {"p_id": rid, "p_pdf_path": f"{i['orgA']}/{rid}.pdf"},
                                       role="service_role")
    call("approve_report", {"p_id": rid}, **staff(i))
    # staff cannot mark it published (only the PDF code, as the service role, after storing the file)
    assert "permission denied" in fails("mark_report_published", {"p_id": rid, "p_pdf_path": f"{i['orgA']}/{rid}.pdf"}, **staff(i))
    assert "unexpected PDF path" in fails("mark_report_published", {"p_id": rid, "p_pdf_path": f"{i['orgB']}/{rid}.pdf"},
                                          role="service_role")
    assert svc("mark_report_published", p_id=rid, p_pdf_path=f"{i['orgA']}/{rid}.pdf") == {"ok": True, "already": False}
    assert svc("mark_report_published", p_id=rid, p_pdf_path=f"{i['orgA']}/{rid}.pdf")["already"] is True
    assert [r["id"] for r in rows_as(i["a"], "select id from reports")] == [rid]
    assert rows_as(i["b"], "select id from reports") == []
    assert q(f"select urgent from notifications where kind = 'report' and user_id = '{i['a']}'") == "t"
    assert "PDF is rendered once" in psql(f"update reports set pdf_path = '{i['orgA']}/{uuid.uuid4()}.pdf' where id = '{rid}'",
                                          check=False).stderr
    assert "needs a summary" in fails("approve_report", {"p_id": call(
        "save_report_draft", {"p_id": None, "p_project_id": i["pA"], "p_title": "Empty", "p_period_label": "", "p_content": {}},
        **staff(i))}, **staff(i))
    j = call("queue_report_draft", {"p_project_id": i["pA"], "p_period_start": "2026-09-01", "p_period_end": "2026-10-10"}, **staff(i))
    assert call("queue_report_draft", {"p_project_id": i["pA"], "p_period_start": "2026-09-01", "p_period_end": "2026-10-10"},
                **staff(i))["already"] is True
    assert qj(f"select params from jobs where id = '{j['id']}'") == {"project_id": i["pA"], "period_start": "2026-09-01",
                                                                    "period_end": "2026-10-10"}


# ------------------------------------------------------------------ invoices

@pytest.fixture(scope="module")
def proposal(db):
    i = db
    pid = q(f"""
      insert into proposals (deal_id, org_id, version, title, client_company, contact_name, contact_email, scope_md, lines,
                             schedule, total, valid_until, terms_version, status, token_hash, sha256, sent_at)
      values ('{i['deal']}', '{i['orgA']}', 1, 'Plant dashboard', 'Alpha Mills', 'Ayesha Khan', 'ayesha@a.example', 'x',
              '[]', '[{{"label":"On signature","pct":40}},{{"label":"Milestone 2","pct":40}},{{"label":"On acceptance","pct":20}}]',
              1000.01, '2026-12-31', 'T-2026-1', 'accepted', repeat('a', 64), repeat('b', 64), now())
      returning id""")
    # the deposit as confirm_acceptance (009) issues it: no schedule_stage column value
    dep = q(f"""insert into invoices (org_id, kind, proposal_id, bill_company, lines, currency, total, status, issued_at, due_date)
                values ('{i['orgA']}', 'invoice', '{pid}', 'Alpha Mills', '[{{"title":"Deposit","amount":400.00}}]', 'USD', 400.00,
                        'sent', now(), current_date + 14) returning id""")
    return {"id": pid, "deposit": dep}


def test_schedule_invoices_and_the_final_remainder(db, proposal):
    i = db
    assert "already invoiced" in fails("invoice_from_schedule", {"p_proposal_id": proposal["id"], "p_stage": 0}, **staff(i))
    m = call("invoice_from_schedule", {"p_proposal_id": proposal["id"], "p_stage": 1}, **staff(i))
    f = call("invoice_from_schedule", {"p_proposal_id": proposal["id"], "p_stage": 2}, **staff(i))
    assert q(f"select total from invoices where id = '{m}'") == "400.00"
    assert q(f"select total from invoices where id = '{f}'") == "200.01"           # 1000.01 - 400.00 - 400.00
    assert "already invoiced" in fails("invoice_from_schedule", {"p_proposal_id": proposal["id"], "p_stage": 2}, **staff(i))
    assert "no such schedule stage" in fails("invoice_from_schedule", {"p_proposal_id": proposal["id"], "p_stage": 3}, **staff(i))
    fails("invoice_from_schedule", {"p_proposal_id": proposal["id"], "p_stage": 1}, sub=i["a"], aal="aal1")
    # drafts never consume a number and are invisible to the client
    assert q(f"select number is null from invoices where id = '{m}'") == "t"
    assert {r["id"] for r in rows_as(i["a"], "select id from invoices where status in ('sent','overdue','paid')")} == {proposal["deposit"]}


def test_approve_issue_paid_and_final_paid_queues_a_referral(db, proposal):
    i = db
    fin = q(f"select id from invoices where proposal_id = '{proposal['id']}' and schedule_stage = 2")
    assert "approve the invoice first" in fails("issue_invoice", {"p_id": fin}, **staff(i))
    call("approve_invoice", {"p_id": fin}, **staff(i))
    before = int(q("select coalesce(max(last_number), 0) from invoice_counters"))
    out = call("issue_invoice", {"p_id": fin}, **staff(i))
    assert out["already"] is False and out["number"].endswith(f"-{before + 1:03d}")
    assert call("issue_invoice", {"p_id": fin}, **staff(i)) == {"number": out["number"], "already": True}
    assert q(f"select count(*) from notifications where kind = 'invoice' and link = '/invoices/{fin}'") == "2"   # both members
    assert "immutable" in psql(f"update invoices set total = 1 where id = '{fin}'", check=False).stderr
    today = datetime.now(PKT).date()
    assert "between the issue date and today" in fails("mark_invoice_paid", {"p_id": fin, "p_paid_on": (today + timedelta(days=2)).isoformat()}, **staff(i))
    call("mark_invoice_paid", {"p_id": fin, "p_paid_on": today.isoformat()}, **staff(i))
    assert q(f"select status from invoices where id = '{fin}'") == "paid"
    assert qj(f"select params from jobs where type = 'referral_draft'") == {"org_id": i["orgA"], "trigger": "invoice_paid", "ref_id": fin}
    # a paid date is set once
    assert "set once" in psql(f"update invoices set paid_at = now() - interval '3 days' where id = '{fin}'", check=False).stderr


def test_adhoc_invoice_tax_void_and_overdue(db):
    i = db
    lines = [{"title": "Retainer October", "desc": "20 h", "amount": "1000.00"}, {"title": "Hosting", "amount": "33.33"}]
    iid = call("create_invoice_draft", {"p_org_id": i["orgB"], "p_bill_company": "Beta Fuels", "p_bill_contact": "Bo",
                                        "p_project_label": "Support", "p_lines": lines, "p_tax_label": "Sales tax",
                                        "p_tax_rate": 16, "p_currency": "PKR", "p_due_date": "2026-01-01"}, **staff(i))
    assert q(f"select total from invoices where id = '{iid}'") == "1198.66"          # 1033.33 + 165.33
    assert "name the tax" in fails("create_invoice_draft", {"p_org_id": i["orgB"], "p_bill_company": "B", "p_bill_contact": "",
                                                           "p_project_label": "", "p_lines": lines, "p_tax_label": "",
                                                           "p_tax_rate": 5, "p_currency": "USD", "p_due_date": None}, **staff(i))
    assert "invalid invoice line" in fails("create_invoice_draft", {"p_org_id": i["orgB"], "p_bill_company": "B", "p_bill_contact": "",
                                                                   "p_project_label": "", "p_lines": [{"title": "x", "amount": "1.001"}],
                                                                   "p_tax_label": None, "p_tax_rate": 0, "p_currency": "USD",
                                                                   "p_due_date": None}, **staff(i))
    call("approve_invoice", {"p_id": iid}, **staff(i))
    call("issue_invoice", {"p_id": iid}, **staff(i))
    assert "credit note" in fails("void_invoice", {"p_id": iid}, **staff(i))
    # overdue: staff or the cron; idempotent
    assert call("mark_overdue_invoices", {"p_today": None}, **staff(i)) >= 1
    assert q(f"select status from invoices where id = '{iid}'") == "overdue"
    assert call("mark_overdue_invoices", {"p_today": None}, **staff(i)) == 0
    assert q("select count(*) from push_queue where title like 'Invoice % is overdue'") != "0"
    fails("mark_overdue_invoices", {"p_today": None}, sub=i["b"], aal="aal1")
    d = call("create_invoice_draft", {"p_org_id": i["orgB"], "p_bill_company": "Beta Fuels", "p_bill_contact": "",
                                      "p_project_label": "", "p_lines": [{"title": "x", "amount": "5"}], "p_tax_label": None,
                                      "p_tax_rate": 0, "p_currency": "USD", "p_due_date": None}, **staff(i))
    call("void_invoice", {"p_id": d}, **staff(i))
    assert q(f"select status || '|' || (number is null)::text from invoices where id = '{d}'") == "void|true"


def test_credit_notes_reference_an_issued_invoice_and_never_exceed_it(db):
    i = db
    iid = q(f"select id from invoices where org_id = '{i['orgB']}' and status = 'overdue' limit 1")
    assert "give the reason" in fails("create_credit_note", {"p_invoice_id": iid, "p_lines": [{"title": "x", "amount": "1"}],
                                                             "p_reason": ""}, **staff(i))
    too_much = fails("create_credit_note", {"p_invoice_id": iid, "p_lines": [{"title": "Refund", "amount": "1100"}],
                                            "p_reason": "Hosting not delivered"}, **staff(i))
    assert "cannot exceed" in too_much
    cn = call("create_credit_note", {"p_invoice_id": iid, "p_lines": [{"title": "Hosting credit", "amount": "33.33"}],
                                     "p_reason": "Hosting not delivered"}, **staff(i))
    row = qj(f"select row_to_json(x) from (select kind, ref_invoice_id, total, currency, status from invoices where id = '{cn}') x")
    assert row == {"kind": "credit_note", "ref_invoice_id": iid, "total": 38.66, "currency": "PKR", "status": "draft"}
    call("approve_invoice", {"p_id": cn}, **staff(i))
    num = call("issue_invoice", {"p_id": cn}, **staff(i))["number"]
    assert num.startswith("EL-")
    assert "not paid" in fails("mark_invoice_paid", {"p_id": cn, "p_paid_on": datetime.now(PKT).date().isoformat()}, **staff(i))
    assert "reference an issued invoice" in fails("create_credit_note", {"p_invoice_id": cn, "p_lines": [{"title": "x", "amount": "1"}],
                                                                         "p_reason": "nope"}, **staff(i))
    call("mark_invoice_paid", {"p_id": iid, "p_paid_on": datetime.now(PKT).date().isoformat()}, **staff(i))
    assert q(f"select status from invoices where id = '{iid}'") == "paid"
    # an ad-hoc invoice being paid is not a "final" payment: no referral
    assert q(f"select count(*) from jobs where type = 'referral_draft' and params ->> 'org_id' = '{i['orgB']}'") == "0"


def test_project_done_queues_one_referral_and_never_for_test_orgs(db):
    i = db
    call("save_project", {"p_id": i["pB"], "p_org_id": None, "p_name": "Forecourt", "p_status": "done", "p_summary": None,
                          "p_repo_path": None, "p_progress": 100, "p_next_milestone": None, "p_next_milestone_on": None}, **staff(i))
    q(f"update projects set status = 'active' where id = '{i['pB']}'; update projects set status = 'done' where id = '{i['pB']}'")
    assert q(f"select count(*) from jobs where type = 'referral_draft' and params ->> 'ref_id' = '{i['pB']}'") == "1"
    q(f"update projects set status = 'done' where id = '{i['pT']}'")
    assert q(f"select count(*) from jobs where type = 'referral_draft' and params ->> 'org_id' = '{i['orgT']}'") == "0"


# ------------------------------------------------------------------ testimonials (E4)

def test_testimonial_request_submit_withdraw_publish(db):
    i = db
    tid = call("request_testimonial", {"p_org_id": i["orgA"], "p_project_id": i["pA"], "p_suggested": "Epsilon fixed our plant data."},
               **staff(i))
    assert "already an open request" in fails("request_testimonial", {"p_org_id": i["orgA"], "p_project_id": None, "p_suggested": None},
                                              **staff(i))
    fails("request_testimonial", {"p_org_id": i["orgA"], "p_project_id": None, "p_suggested": None}, sub=i["a"], aal="aal1")
    assert q(f"select count(*) from notifications where kind = 'testimonial' and org_id = '{i['orgA']}'") == "2"
    assert [t["id"] for t in rows_as(i["a"], "select id from testimonials")] == [tid]
    assert rows_as(i["b"], "select id from testimonials") == []
    # the other org can neither see nor approve it; a member can, with consent fields
    fails("submit_testimonial", {"p_id": tid, "p_org_id": None, "p_quote": "Great work, truly.", "p_author_name": "Bo",
                                 "p_author_role": ""}, sub=i["b"], aal="aal1")
    assert "10-1200" in fails("submit_testimonial", {"p_id": tid, "p_org_id": None, "p_quote": "ok", "p_author_name": "Ayesha",
                                                     "p_author_role": ""}, sub=i["a"], aal="aal1")
    call("submit_testimonial", {"p_id": tid, "p_org_id": None, "p_quote": "Epsilon fixed our plant data in two weeks.",
                                "p_author_name": "Ayesha Khan", "p_author_role": "Plant manager"}, sub=i["a"], aal="aal1")
    assert q(f"select status || '|' || approved_by from testimonials where id = '{tid}'") == f"client_approved|{i['a']}"
    assert q("select count(*) from push_queue where kind = 'testimonial'") == "1"
    own = call("submit_testimonial", {"p_id": None, "p_org_id": i["orgB"], "p_quote": "Fast, careful, honest engineering.",
                                      "p_author_name": "Bo", "p_author_role": ""}, sub=i["b"], aal="aal1")
    fails("submit_testimonial", {"p_id": None, "p_org_id": i["orgA"], "p_quote": "I am not a member here.", "p_author_name": "Bo",
                                 "p_author_role": ""}, sub=i["b"], aal="aal1")
    fails("mark_testimonial_published", {"p_id": tid}, sub=i["a"], aal="aal1")
    call("mark_testimonial_published", {"p_id": tid}, **staff(i))
    assert "not edited" in psql(f"update testimonials set quote = 'changed words here' where id = '{tid}'", check=False).stderr
    call("withdraw_testimonial", {"p_id": own}, sub=i["b"], aal="aal1")
    assert "no longer be changed" in fails("submit_testimonial", {"p_id": own, "p_org_id": None, "p_quote": "Back again, please.",
                                                             "p_author_name": "Bo", "p_author_role": ""}, sub=i["b"], aal="aal1")
    fails("withdraw_testimonial", {"p_id": tid}, sub=i["b"], aal="aal1")


# ------------------------------------------------------------------ retainers (E6)

def test_retainer_usage_maths_and_upsell(db):
    i = db
    rid = call("save_retainer", {"p_id": None, "p_org_id": i["orgA"], "p_tier": "r10", "p_hours_included": 10,
                                 "p_starts_on": "2026-07-01", "p_ends_on": None, "p_status": "active"}, **staff(i))
    assert "already has an active retainer" in fails("save_retainer", {"p_id": None, "p_org_id": i["orgA"], "p_tier": "r20",
                                                                        "p_hours_included": 20, "p_starts_on": "2026-08-01",
                                                                        "p_ends_on": None, "p_status": "active"}, **staff(i))
    fails("save_retainer", {"p_id": None, "p_org_id": i["orgA"], "p_tier": "r10", "p_hours_included": 10,
                            "p_starts_on": "2026-07-01", "p_ends_on": None, "p_status": "paused"}, sub=i["a"], aal="aal1")
    t = call("create_ticket", {"p_project_id": i["pA"], "p_title": "Sensor drift", "p_body": "", "p_type": "bug",
                               "p_priority": "normal"}, sub=i["a"], aal="aal1")
    # October (current in the test's frame): 9 h of 10 = 90 %; September 8.6 h = 86 %; August 5 h = 50 %
    for minutes, day in ((300, "2026-10-02"), (240, "2026-10-09"), (516, "2026-09-15"), (300, "2026-08-10")):
        call("log_time", {"p_org_id": None, "p_ticket_id": t["id"], "p_minutes": minutes, "p_note": "work", "p_billable": True,
                          "p_worked_on": day}, **staff(i))
    call("log_time", {"p_org_id": i["orgA"], "p_ticket_id": None, "p_minutes": 600, "p_note": "internal", "p_billable": False,
                      "p_worked_on": "2026-10-03"}, **staff(i))
    u = call("retainer_usage", {"p_org_id": i["orgA"], "p_months": 6, "p_today": "2026-10-20"}, **staff(i))
    per = {p["period"]: (p["used_minutes"], p["included_minutes"], p["pct"]) for p in u["periods"]}
    assert per == {"2026-10": (540, 600, 90.0), "2026-09": (516, 600, 86.0), "2026-08": (300, 600, 50.0), "2026-07": (0, 600, 0.0)}
    assert [p["period"] for p in u["periods"]] == ["2026-10", "2026-09", "2026-08", "2026-07"]
    assert u["over_85"] == 2 and u["upsell"] is True and u["retainer"]["id"] == rid
    # clients see the same usage, never the upsell flag, and only billable entries
    mine = call("retainer_usage", {"p_org_id": i["orgA"], "p_months": 6, "p_today": "2026-10-20"}, sub=i["a"], aal="aal1")
    assert mine["upsell"] is None and mine["periods"] == u["periods"]
    assert sum(r["minutes"] for r in rows_as(i["a"], "select minutes from time_entries")) == 1356
    # one high month is not a pattern
    assert call("retainer_usage", {"p_org_id": i["orgA"], "p_months": 6, "p_today": "2026-11-05"}, **staff(i))["upsell"] is True
    assert call("retainer_usage", {"p_org_id": i["orgA"], "p_months": 6, "p_today": "2026-12-05"}, **staff(i))["upsell"] is False
    fails("retainer_usage", {"p_org_id": i["orgA"], "p_months": 6, "p_today": None}, sub=i["b"], aal="aal1")
    fails("log_time", {"p_org_id": None, "p_ticket_id": t["id"], "p_minutes": 30, "p_note": "", "p_billable": True, "p_worked_on": None},
          sub=i["a"], aal="aal1")
    assert "future" in fails("log_time", {"p_org_id": None, "p_ticket_id": t["id"], "p_minutes": 30, "p_note": "", "p_billable": True,
                                          "p_worked_on": (datetime.now(PKT).date() + timedelta(days=3)).isoformat()}, **staff(i))
    # a ticket of org A cannot be logged against org B
    fails("log_time", {"p_org_id": i["orgB"], "p_ticket_id": t["id"], "p_minutes": 30, "p_note": "", "p_billable": True,
                       "p_worked_on": None}, **staff(i))
    none = call("retainer_usage", {"p_org_id": i["orgB"], "p_months": 3, "p_today": None}, sub=i["b"], aal="aal1")
    assert none == {"retainer": None, "periods": [], "upsell": None, "over_85": 0}


# ------------------------------------------------------------------ isolation

def test_cross_org_isolation_on_every_new_table(db):
    i = db
    # rows for org B in every table
    svc("save_update_draft", p_project_id=i["pB"], p_title="B update", p_body_md="b", p_source="manual")
    q(f"update updates set status = 'published', published_at = now() where org_id = '{i['orgB']}' and status = 'draft'")
    q(f"insert into retainers (org_id, tier, hours_included, starts_on) values ('{i['orgB']}', 'r20', 20, '2026-01-01')")
    q(f"insert into time_entries (org_id, minutes) values ('{i['orgB']}', 30)")
    q(f"insert into profiles (user_id) values ('{i['b']}') on conflict do nothing")
    q(f"insert into email_digests (user_id, local_date) values ('{i['b']}', '2026-01-01') on conflict do nothing")
    for t in ("updates", "reports", "testimonials", "retainers", "time_entries"):
        assert rows_as(i["a"], f"select id from {t} where org_id = '{i['orgB']}'") == [], t
        r = as_user(None, f"select count(*) from {t};", role="anon")
        assert r.returncode != 0, f"anon can read {t}"
    assert rows_as(i["a"], f"select user_id from profiles where user_id = '{i['b']}'") == []
    assert rows_as(i["a"], "select id from email_digests") == []
    # test-scope staff (aal2) sees only is_test orgs; full staff without aal2 sees nothing
    assert rows_as(i["ci"], f"select id from updates where org_id = '{i['orgB']}'", aal="aal2") == []
    assert rows_as(i["founder"], "select id from updates", aal="aal1") == []
    for t, row in {"updates": f"(org_id, project_id, title) values ('{i['orgA']}','{i['pA']}','x')",
                   "reports": f"(org_id, project_id, title) values ('{i['orgA']}','{i['pA']}','x')",
                   "testimonials": f"(org_id) values ('{i['orgA']}')",
                   "retainers": f"(org_id, tier, hours_included, starts_on) values ('{i['orgA']}','r10',10,'2026-01-01')",
                   "time_entries": f"(org_id, minutes) values ('{i['orgA']}', 5)",
                   "profiles": f"(user_id) values ('{i['a']}')",
                   "email_digests": f"(user_id, local_date) values ('{i['a']}', '2026-02-02')"}.items():
        assert as_user(i["a"], f"insert into {t} {row};").returncode != 0, f"client insert into {t}"
    for t in ("updates", "retainers", "time_entries"):
        r = as_user(i["a"], f"update {t} set created_at = now() where org_id = '{i['orgB']}';")
        assert r.returncode != 0, f"client update on {t}"
    # RPCs refuse other orgs
    upd = q(f"select id from updates where org_id = '{i['orgB']}' limit 1")
    fails("edit_update", {"p_id": upd, "p_title": "x", "p_body_md": "x"}, sub=i["a"], aal="aal1")
    fails("queue_report_draft", {"p_project_id": i["pB"], "p_period_start": "2026-01-01", "p_period_end": "2026-01-02"},
          sub=i["a"], aal="aal1")
    fails("create_invoice_draft", {"p_org_id": i["orgB"], "p_bill_company": "x", "p_bill_contact": "", "p_project_label": "",
                                   "p_lines": [{"title": "x", "amount": "1"}], "p_tax_label": None, "p_tax_rate": 0,
                                   "p_currency": "USD", "p_due_date": None}, sub=i["a"], aal="aal1")
    fails("create_invoice_draft", {"p_org_id": i["orgB"], "p_bill_company": "x", "p_bill_contact": "", "p_project_label": "",
                                   "p_lines": [{"title": "x", "amount": "1"}], "p_tax_label": None, "p_tax_rate": 0,
                                   "p_currency": "USD", "p_due_date": None}, sub=i["ci"], aal="aal2")   # test staff, real org
    tb = q(f"select id from time_entries where org_id = '{i['orgB']}' limit 1")
    fails("delete_time_entry", {"p_id": tb}, sub=i["a"], aal="aal1")
    # the reports bucket policy admits only published reports of the member's own org
    assert q("select count(*) from pg_policies where policyname = 'reports_read'") == "1"


def test_waiting_digests_never_crowd_out_urgent_mail(db):
    i = db
    reset_mail()
    for _ in range(3):
        note(i["a"], i["orgA"])                     # Ayesha: daily, nothing due before 10:00
    u = note(i["b"], i["orgB"], urgent=True)
    r = svc("claim_email_batch", p_now=tomorrow_at_pkt(8, 0), p_limit=1)
    assert [(e["to"], [x["id"] for x in e["items"]]) for e in r["emails"]] == [("bo@b.example", [u])]
