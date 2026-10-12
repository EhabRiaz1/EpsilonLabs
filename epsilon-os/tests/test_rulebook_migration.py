"""Migration 011 (Deck rulebook, settings / tenders / run-now RPCs, push) against a local Postgres with the same stubs as
test_intake_portal_migration.py. Skipped when no local Postgres is running.

The Deck part runs dashboard/actions.py itself against the real RPCs (PgDB below speaks the core.db.DB surface the
actions use: select by id + rpc, as the worker's service role), so "8787 behaves as before" is checked on the SQL, not
only on the in-memory fake.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from core import config
from dashboard import actions
from tests.fakes import FakeDB
from tests.test_intake_portal_migration import EXTRA_STUB, FILES, ROOT, sh
from tests.test_deal_room_migration import STORAGE_STUB
from tests.test_platform_migration import AUTH_STUB
from core.settings import STRATEGY_IDS
from tests import test_intake_portal_migration as base

DB = "eos_test_011"
pytestmark = base.pytestmark
# 013 replaces settings_defaults() / save_settings() (new strategies, prospector.mix, ppra_epms): the parity tests
# below run against the rulebook as it now stands, 011 plus 013.
ALL = FILES + ["migrations/011_rulebook_push.sql", "migrations/013_research_sources.sql"]
NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
DRAFT = ("Hi Sana,\n\nThanks for the detail. We can start with current sensing on the generators.\n\n"
         "Could we do a call on Thursday at 3pm?\n\nI will bring a quote for 40 motors.\n\n"
         "Is the shed on Wi-Fi?\n\nEhab")
HITS = [{"type": "price", "text": "$4,500"}]


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


def call(fn, args: dict, sub=None, aal="aal2", role="authenticated"):
    named = ", ".join(f"{k} => {lit(v)}" for k, v in args.items())
    r = as_user(sub, f"select to_jsonb({fn}({named}));", aal=aal, role=role)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def svc(fn, **args):
    return call(fn, args, role="service_role")


class PgDB:
    """The slice of core.db.DB that dashboard/actions.py's Deck functions use, as the worker's service role."""

    def select(self, table, **filters):
        where = " and ".join(f"{k}::text = {lit(v)}" for k, v in filters.items() if k not in ("limit", "order", "select"))
        out = q(f"select coalesce(json_agg(t), '[]') from {table} t" + (f" where {where}" if where else ""))
        return json.loads(out)

    def rpc(self, fn, args=None):
        return svc(fn, **(args or {}))


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
    i = {k: str(uuid.uuid4()) for k in ("founder", "founder2", "client", "ci", "org", "testorg", "proj", "testproj")}
    q(f"""
      insert into auth.users (id, email) values ('{i['founder']}','f@x'),('{i['founder2']}','f2@x'),('{i['client']}','c@x'),('{i['ci']}','ci@x');
      insert into staff (user_id, email, scope) values ('{i['founder']}','f@x','full'),('{i['ci']}','ci@x','test');
      insert into organizations (id, name, slug) values ('{i['org']}','Org','org');
      insert into organizations (id, name, slug, is_test) values ('{i['testorg']}','Test','test-org', true);
      insert into memberships (org_id, user_id, role) values ('{i['org']}','{i['client']}','owner');
      insert into projects (id, org_id, name) values ('{i['proj']}','{i['org']}','P'), ('{i['testproj']}','{i['testorg']}','TP');
    """)
    yield i
    sh("dropdb", "--if-exists", DB)


def draft(**kw) -> str:
    row = {"agent": "inbox", "kind": "reply", "draft": DRAFT, "to_email": "sana@mm.example", "subject": "Re: sensors",
           "lint": [], **kw}
    cols = ", ".join(row)
    vals = ", ".join(lit(v) for v in row.values())
    return q(f"insert into approval_queue ({cols}) values ({vals}) returning id")


def row(qid) -> dict:
    return PgDB().select("approval_queue", id=qid)[0]


def audit(qid, action) -> list[dict]:
    return json.loads(q(f"select coalesce(json_agg(a order by at), '[]') from actions a where target_id = '{qid}' and action = '{action}'"))


# ------------------------------------------------------------------ schema

def test_reapply_is_idempotent(db):
    for f in ("migrations/011_rulebook_push.sql", "migrations/013_research_sources.sql"):
        r = psql((ROOT / f).read_text(), check=False)
        assert r.returncode == 0, r.stderr
    assert q("select count(*) from pg_enum where enumlabel = 'edited_pending_lint'") == "1"


def test_new_tables_have_rls_and_no_anon(db):
    for t in ("push_subscriptions", "push_queue"):
        assert q(f"select relrowsecurity from pg_class where relname='{t}'") == "t"
        assert q(f"select has_table_privilege('anon','{t}','select')") == "f"
        for priv in ("insert", "update", "delete"):
            assert q(f"select has_table_privilege('authenticated','{t}','{priv}')") == "f", (t, priv)
    for fn in ("approve_draft(uuid,boolean,jsonb,timestamptz)", "save_settings(jsonb)", "queue_run_agent(text)",
               "save_push_subscription(text,jsonb,text)", "claim_push_batch(integer)", "complete_draft_lint(uuid,jsonb,jsonb)"):
        assert q(f"select has_function_privilege('anon','{fn}','execute')") == "f", fn
    for fn in ("complete_draft_lint(uuid,jsonb,jsonb)", "claim_jobs(text[],integer,integer)", "claim_push_batch(integer)",
               "finish_push(uuid,boolean,text,boolean)", "finish_job(uuid,boolean,jsonb,text)"):
        assert q(f"select has_function_privilege('authenticated','{fn}','execute')") == "f", fn


# ------------------------------------------------------------------ Deck: dashboard/actions.py over the real RPCs

def test_actions_approve_plain_and_unchanged_text(db):
    i = draft()
    r = actions.approve(PgDB(), i, now=NOW)
    assert r["ok"] and r["status"] == "approved" and not r["edited"] and r["undo_seconds"] == config.UNDO_SECONDS
    x = row(i)
    assert x["status"] == "approved" and x["final_text"] is None and x["material_edit"] is False
    assert datetime.fromisoformat(x["decided_at"]) == NOW
    a = audit(i, "approve")
    assert a[0]["agent"] == "dashboard" and a[0]["detail"] == {"edited": False, "lint_hits": 0, "confirmed_lint": False,
                                                                "material_edit": False}
    j = draft()
    r = actions.approve(PgDB(), j, final_text=DRAFT + "\n  ", now=NOW)
    assert r["status"] == "approved" and r["diff"] is None


def test_actions_edit_minor_and_material(db):
    i = draft()
    text = DRAFT.replace("Thanks for the detail.", "Thanks for the extra detail.")
    r = actions.approve(PgDB(), i, final_text=text, now=NOW)
    assert r["status"] == "edited_approved" and r["diff"]["changed"] == 1
    x = row(i)
    assert x["final_text"] == text and x["material_edit"] is False and x["lint"] == []
    j = draft()
    text = DRAFT.replace("Could we do a call on Thursday at 3pm?", "Could we do a call on Friday at 3pm?")
    assert actions.approve(PgDB(), j, final_text=text, now=NOW)["diff"]["material"] is True
    assert row(j)["material_edit"] is True


def test_actions_lint_confirm_held_and_guards(db):
    i = draft(lint=HITS)
    r = actions.approve(PgDB(), i, now=NOW)
    assert r == {"ok": False, "error": "lint_confirm_required", "message": "Draft has lint warnings. Confirm to send anyway.",
                 "lint": HITS}
    assert row(i)["status"] == "pending"
    assert actions.approve(PgDB(), i, confirm_lint=True, now=NOW)["ok"]
    j = draft()
    r = actions.approve(PgDB(), j, final_text=DRAFT + "\nWire to GB82WEST12345698765432 please.", now=NOW)
    assert r["error"] == "lint_confirm_required" and any(h["type"] == "bank" for h in r["lint"])
    h = draft(held=True, held_reason="injection_suspected")
    assert actions.approve(PgDB(), h, confirm_lint=True, now=NOW)["error"] == "held"
    assert actions.approve(PgDB(), str(uuid.uuid4()))["error"] == "not_found"
    assert actions.approve(PgDB(), draft(draft="  \n "))["error"] == "empty"
    s = draft(status="sent")
    assert actions.approve(PgDB(), s) == {"ok": False, "error": "not_pending", "message": "Already sent."}
    assert actions.approve(PgDB(), draft(), final_text="   ")["error"] == "empty"


def test_actions_null_lint_is_linted_on_the_mac(db):
    i = draft(lint=None)
    assert actions.approve(PgDB(), i, now=NOW)["status"] == "approved"   # Python linted the draft, clean
    j = draft(lint=None, draft="Our price is $4,500 for this.")
    assert actions.approve(PgDB(), j, now=NOW)["error"] == "lint_confirm_required"


def test_actions_undo_window_and_too_late(db):
    i = draft()
    actions.approve(PgDB(), i, final_text=DRAFT.replace("Ehab", "Ehab R."), now=NOW)
    assert actions.undo(PgDB(), i, now=NOW + timedelta(seconds=config.UNDO_SECONDS - 1)) == {"ok": True}
    x = row(i)
    assert (x["status"], x["decided_at"], x["final_text"], x["diff"], x["material_edit"]) == ("pending", None, None, None, None)
    assert actions.undo(PgDB(), i) == {"ok": True, "already": True}
    actions.approve(PgDB(), i, now=NOW)
    r = actions.undo(PgDB(), i, now=NOW + timedelta(seconds=config.UNDO_SECONDS + 1))
    assert r == {"ok": False, "error": "too_late", "message": "Too late, already sending."}
    for status in ("sending", "sent", "failed"):
        j = draft()
        actions.approve(PgDB(), j, now=NOW)
        q(f"update approval_queue set status = '{status}' where id = '{j}'")
        assert actions.undo(PgDB(), j, now=NOW + timedelta(seconds=1))["error"] == "too_late"
    assert actions.undo(PgDB(), str(uuid.uuid4()))["error"] == "not_found"


def test_actions_reject_later_release(db):
    i = draft()
    assert actions.reject(PgDB(), i, "  wrong tone  ", now=NOW) == {"ok": True}
    assert row(i)["status"] == "rejected" and audit(i, "reject")[0]["detail"] == {"reason": "wrong tone"}
    assert actions.reject(PgDB(), i) == {"ok": False, "error": "not_pending", "message": "Already rejected."}
    assert actions.reject(PgDB(), str(uuid.uuid4()))["error"] == "not_found"
    j = draft()
    assert actions.later(PgDB(), j) == {"ok": True} and len(audit(j, "later")) == 1 and row(j)["status"] == "pending"
    assert actions.later(PgDB(), i)["error"] == "not_pending"
    h = draft(held=True, held_reason="lint: url")
    assert actions.release_held(PgDB(), h) == {"ok": True} and row(h)["held"] is False
    assert audit(h, "release_held")[0]["detail"] == {"was": "lint: url"}
    assert actions.release_held(PgDB(), h)["error"] == "not_held"


def test_fake_and_sql_agree_on_the_same_script(db):
    """The in-memory fake (used by the other 550 tests) and the SQL give the same results for one script."""
    script = [("approve", {}), ("undo", {"dt": 3}), ("approve", {"final_text": DRAFT + "\nP.S. glad to help."}),
              ("undo", {"dt": 30}), ("reject", {}), ("later", {}), ("release", {})]
    fake = FakeDB()
    fid = fake.insert("approval_queue", {"agent": "inbox", "kind": "reply", "draft": DRAFT, "to_email": "sana@mm.example",
                                         "subject": "s", "lint": []})[0]["id"]
    pid = draft()
    for name, kw in script:
        res = []
        for dbx, qid in ((fake, fid), (PgDB(), pid)):
            if name == "approve":
                r = actions.approve(dbx, qid, final_text=kw.get("final_text"), now=NOW)
            elif name == "undo":
                r = actions.undo(dbx, qid, now=NOW + timedelta(seconds=kw["dt"]))
            elif name == "reject":
                r = actions.reject(dbx, qid, now=NOW)
            elif name == "later":
                r = actions.later(dbx, qid)
            else:
                r = actions.release_held(dbx, qid)
            r.pop("decided_at", None)
            res.append(r)
        assert res[0] == res[1], name


# ------------------------------------------------------------------ Deck: admin.* (staff) path

def test_staff_needs_aal2_and_clients_are_refused(db):
    i = draft()
    for sub, aal in ((db["founder"], "aal1"), (db["client"], "aal1"), (db["client"], "aal2"), (db["ci"], "aal2")):
        r = as_user(sub, f"select approve_draft('{i}');", aal=aal)
        assert r.returncode != 0 and "staff only" in r.stderr, (sub, aal)
    assert as_user(None, f"select approve_draft('{i}');", role="anon").returncode != 0
    assert row(i)["status"] == "pending"


def test_staff_cannot_spoof_lint_or_clock(db):
    i = draft(lint=None)
    r = call("approve_draft", {"p_id": i, "p_lint": [], "p_now": "2020-01-01T00:00:00Z"}, db["founder"])
    assert r["status"] == "edited_pending_lint"          # nobody linted it: the Mac must
    x = row(i)
    assert datetime.fromisoformat(x["decided_at"]).year == datetime.now().year
    a = audit(i, "approve")[0]
    assert a["agent"] == "admin" and a["detail"]["actor"] == db["founder"]
    j = draft()
    r = call("edit_and_approve_draft", {"p_id": j, "p_body": DRAFT + "\nVisit https://evil.example", "p_lint": [],
                                        "p_diff": {"material": False}}, db["founder"])
    assert r["status"] == "edited_pending_lint" and row(j)["diff"] is None and row(j)["lint"] == []


def test_staff_plain_approve_with_stored_lint_is_immediate(db):
    i = draft()
    assert call("approve_draft", {"p_id": i}, db["founder"])["status"] == "approved"
    k = draft(lint=HITS)
    assert call("approve_draft", {"p_id": k}, db["founder"])["error"] == "lint_confirm_required"
    assert call("approve_draft", {"p_id": k, "p_confirm_lint": True}, db["founder"])["status"] == "approved"
    assert call("undo_decision", {"p_id": k}, db["founder"]) == {"ok": True}


def test_off_mac_edit_waits_for_lint_and_is_never_claimable(db):
    i = draft()
    r = call("edit_and_approve_draft", {"p_id": i, "p_body": DRAFT.replace("Thursday", "Friday")}, db["founder"])
    assert r["status"] == "edited_pending_lint"
    q(f"update approval_queue set decided_at = now() - interval '1 hour' where id = '{i}'")
    # the outbox's claim (core.db.DB.claim: PATCH ... status=in.(approved,edited_approved)) and its candidate query
    claim = q(f"update approval_queue set status = 'sending' where id = '{i}' "
              f"and status in ('approved','edited_approved') returning id;")
    assert claim == ""
    assert row(i)["status"] == "edited_pending_lint"
    # undo still works inside the window
    j = draft()
    call("edit_and_approve_draft", {"p_id": j, "p_body": DRAFT + "\nThanks!"}, db["founder"])
    assert call("undo_decision", {"p_id": j}, db["founder"]) == {"ok": True} and row(j)["final_text"] is None


def test_complete_draft_lint_clean_and_held(db):
    i = draft()
    call("edit_and_approve_draft", {"p_id": i, "p_body": DRAFT + "\nThanks!"}, db["founder"])
    before = row(i)["decided_at"]
    diff = actions.compute_diff(DRAFT, DRAFT + "\nThanks!")
    assert svc("complete_draft_lint", p_id=i, p_lint=[], p_diff=diff) == {"ok": True, "status": "edited_approved"}
    x = row(i)
    assert x["status"] == "edited_approved" and x["decided_at"] == before and x["material_edit"] == diff["material"]
    assert svc("complete_draft_lint", p_id=i, p_lint=[])["error"] == "not_pending_lint"
    j = draft()
    call("edit_and_approve_draft", {"p_id": j, "p_body": DRAFT + "\nSee https://evil.example and call +44 20 7946 0958"},
         db["founder"])
    hits = [{"type": "url", "text": "https://evil.example"}, {"type": "phone", "text": "+44 20 7946 0958"}]
    r = svc("complete_draft_lint", p_id=j, p_lint=hits, p_diff=None)
    assert r["status"] == "held" and r["held_reason"] == "lint: phone, url"
    x = row(j)
    assert (x["status"], x["held"], x["decided_at"]) == ("pending", True, None) and x["final_text"].endswith("0958")
    # staff cannot call it
    r = as_user(db["founder"], f"select complete_draft_lint('{j}', '[]'::jsonb);", aal="aal2")
    assert r.returncode != 0
    # after release, a plain approve sends the stored edit, and the stored lint needs a confirm
    assert call("release_held_draft", {"p_id": j}, db["founder"]) == {"ok": True}
    assert call("approve_draft", {"p_id": j}, db["founder"])["error"] == "lint_confirm_required"
    r = call("approve_draft", {"p_id": j, "p_confirm_lint": True}, db["founder"])
    assert r["status"] == "edited_approved" and row(j)["final_text"].endswith("0958")


def test_outbox_lint_step_end_to_end_on_postgres(db):
    """agents.outbox.lint_pending over the real RPC: clean edit promoted, dirty edit held."""
    from agents import outbox
    a, b = draft(), draft()
    call("edit_and_approve_draft", {"p_id": a, "p_body": DRAFT + "\nThanks!"}, db["founder"])
    call("edit_and_approve_draft", {"p_id": b, "p_body": DRAFT + "\nWire to GB82WEST12345698765432."}, db["founder"])

    class Lintable(PgDB):
        def select(self, table, **filters):
            if filters.get("status") == "edited_pending_lint":
                return json.loads(q("select coalesce(json_agg(t), '[]') from approval_queue t where status = 'edited_pending_lint'"))
            return super().select(table, **filters)

    c = {"linted": 0, "lint_held": 0, "errors": 0}
    outbox.lint_pending(Lintable(), "run", c)
    assert c["errors"] == 0 and c["linted"] >= 2 and c["lint_held"] >= 1
    assert row(a)["status"] == "edited_approved"
    assert row(b)["held"] is True and row(b)["held_reason"] == "lint: bank"


# ------------------------------------------------------------------ settings parity with dashboard/actions.save_settings_all

FORMS = [
    {"per_day": "30", "daily_budget": "300", "daily_cap": "40", "segments": ["industrial"], "paused": "on"},
    {"per_day": "81", "daily_budget": "49", "daily_cap": "x", "segments": ["nope", "industrial"]},
    {"per_day": " 20 ", "daily_budget": "250", "daily_cap": "50", "segments": []},
    {"per_day": "20", "daily_budget": "250", "daily_cap": "50", "segments": "smb_software", "address": "Me@Out.Example"},
    {"per_day": "20", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "address": "not-an-email"},
    {"per_day": "10", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"],
     **{f"quota_{s}": "2" for s in STRATEGY_IDS}},
    {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "auto_rebalance": "on",
     "pin_s4_partner": "on", "markets": "us, gb;de pk XX1",
     **{f"quota_{s}": "3" for s in STRATEGY_IDS}, "mix": " 55 "},
    {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "markets": "us, gb;de pk ir",
     **{f"quota_{s}": "3" for s in STRATEGY_IDS}, "quota_s2_trigger": "51", "mix": "101"},
    {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "markets": "pk ir",
     **{f"quota_{s}": "3" for s in STRATEGY_IDS}},
    {"per_day": "20", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "tenders_per_day": "51",
     "tenders_value_min": "5", "tenders_value_max": "-1", "tenders_sources": ["ted", "bogus"]},
    {"per_day": "20", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "tenders_per_day": "10",
     "tenders_value_min": "900", "tenders_value_max": "100", "tenders_sources": ["ted"]},
    {"per_day": "90", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "tenders_per_day": "10",
     "tenders_value_min": "0", "tenders_value_max": "100", "tenders_sources": ["worldbank", "ted"], "tenders_paused": "1"},
]


def _py_settings(db_):
    return {r["key"]: r["value"] for r in db_.rows("settings")}


@pytest.mark.parametrize("form", FORMS)
def test_save_settings_matches_python(db, form):
    q("delete from settings")
    fake = FakeDB()
    py = actions.save_settings_all(fake, dict(form))
    sql = call("save_settings", {"p": form}, db["founder"])
    assert sql["ok"] == py["ok"]
    if not py["ok"]:
        assert sql["errors"] == py["errors"] and sql["message"] == py["message"]
        assert q("select count(*) from settings") == "0"
    else:
        assert sorted(sql["changed"]) == sorted(py["changed"])
        stored = json.loads(q("select coalesce(json_object_agg(key, value), '{}') from settings"))
        assert stored == _py_settings(fake)


def test_settings_address_is_read_only_once_set_and_get_settings(db):
    q("delete from settings")
    base_form = {"per_day": "20", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"]}
    assert call("save_settings", {"p": {**base_form, "address": "a@b.co"}}, db["founder"])["ok"]
    call("save_settings", {"p": {**base_form, "address": "c@d.co"}}, db["founder"])
    s = call("get_settings", {}, db["founder"])
    assert s["outreach.address"] == "a@b.co" and s["prospector.per_day"] == 20 and s["tenders.per_day"] == 15
    assert as_user(db["client"], "select get_settings();", aal="aal2").returncode != 0


# ------------------------------------------------------------------ opportunities parity

def test_decide_opportunity_matches_python(db):
    q("delete from opportunities")
    oid = q("insert into opportunities (source, source_id, title) values ('ted','1','T') returning id")
    assert call("decide_opportunity", {"p_id": oid, "p_act": "nope"}, db["founder"])["error"] == "unknown_action"
    assert call("decide_opportunity", {"p_id": str(uuid.uuid4()), "p_act": "bid"}, db["founder"])["error"] == "not_found"
    r = call("decide_opportunity", {"p_id": oid, "p_act": "pass", "p_reason": "  too   far \n away "}, db["founder"])
    assert r == {"ok": True, "status": "pass", "message": "Passed"}
    assert q(f"select notes from opportunities where id = '{oid}'") == "too far away"
    r = call("decide_opportunity", {"p_id": oid, "p_act": "won"}, db["founder"])
    assert r == {"ok": False, "error": "conflict", "message": "This opportunity is now pass; reload to see it."}
    fake = FakeDB()
    fid = fake.insert("opportunities", {"source": "ted", "source_id": "1", "title": "T", "status": "pass"})[0]["id"]
    assert actions.opp_decide(fake, fid, "won")["message"] == r["message"].replace("pass", "pass")


# ------------------------------------------------------------------ jobs: run now, allow-list, lease

def test_queue_run_agent_allow_list_and_dedupe(db):
    q("delete from jobs")
    assert call("queue_run_agent", {"p_agent": "outbox"}, db["founder"])["error"] == "unknown_job"
    a = call("queue_run_agent", {"p_agent": "prospector"}, db["founder"])
    b = call("queue_run_agent", {"p_agent": "prospector"}, db["founder"])
    assert a["ok"] and not a["already"] and b["already"] and b["id"] == a["id"]
    assert as_user(db["client"], "select queue_run_agent('brief');", aal="aal2").returncode != 0
    assert as_user(db["founder"], "select queue_run_agent('brief');", aal="aal1").returncode != 0
    # nothing else can be queued as run_agent, not even by the service role
    for params in ('{"agent":"outbox"}', '{"agent":"brief","cmd":"rm -rf"}', '{}'):
        r = as_user(None, f"insert into jobs (type, params) values ('run_agent', '{params}');", role="service_role")
        assert r.returncode != 0 and "jobs_run_agent_allowlist" in r.stderr, params


def test_claim_lease_retry_once_then_failed_and_expiry(db):
    q("delete from jobs")
    jid = call("queue_run_agent", {"p_agent": "tenders"}, db["founder"])["id"]
    assert as_user(db["founder"], "select claim_jobs(array['run_agent']);", aal="aal2").returncode != 0
    r = as_user(None, "select count(*) from claim_jobs(array['run_agent'], 60, 5);", role="service_role")
    assert r.stdout.strip() == "1"
    assert q(f"select status || '|' || attempts || '|' || (lease_until > now()) from jobs where id = '{jid}'") == "claimed|1|true"
    r = as_user(None, "select count(*) from claim_jobs(array['run_agent'], 60, 5);", role="service_role")
    assert r.stdout.strip() == "0"     # a live lease is never handed out twice
    # worker died: lease lapses -> queued again (retry once)
    q(f"update jobs set lease_until = now() - interval '1 second' where id = '{jid}'")
    r = as_user(None, "select count(*) from claim_jobs(array['run_agent'], 60, 5);", role="service_role")
    assert r.stdout.strip() == "1"
    assert q(f"select status || '|' || attempts from jobs where id = '{jid}'") == "claimed|2"
    q(f"update jobs set lease_until = now() - interval '1 second' where id = '{jid}'")
    r = as_user(None, "select count(*) from claim_jobs(array['run_agent'], 60, 5);", role="service_role")
    assert r.stdout.strip() == "0"
    assert q(f"select status from jobs where id = '{jid}'") == "failed"
    # an old queued request expires instead of starting a stale run
    k = call("queue_run_agent", {"p_agent": "brief"}, db["founder"])["id"]
    q(f"update jobs set expires_at = now() - interval '1 minute' where id = '{k}'")
    as_user(None, "select count(*) from claim_jobs(array['run_agent']);", role="service_role")
    assert q(f"select status from jobs where id = '{k}'") == "expired"
    # finish
    m = call("queue_run_agent", {"p_agent": "brief"}, db["founder"])["id"]
    as_user(None, "select count(*) from claim_jobs(array['run_agent']);", role="service_role")
    assert svc("finish_job", p_id=m, p_ok=True, p_result={"agent": "brief"}) is True
    assert svc("finish_job", p_id=m, p_ok=True) is False
    assert q(f"select status from jobs where id = '{m}'") == "done"


# ------------------------------------------------------------------ push: RLS, RPCs, triggers, sender claim

def test_push_subscriptions_staff_only_and_own_rows(db):
    keys = {"p256dh": "BPk", "auth": "au"}
    sid = call("save_push_subscription", {"p_endpoint": "https://push.example/a", "p_keys": keys}, db["founder"])
    assert sid
    for sub, aal in ((db["founder"], "aal1"), (db["client"], "aal2"), (db["ci"], "aal2")):
        r = as_user(sub, "select save_push_subscription('https://push.example/b', '{\"p256dh\":\"x\",\"auth\":\"y\"}');", aal=aal)
        assert r.returncode != 0
    assert as_user(db["founder"], "select save_push_subscription('http://insecure', '{\"p256dh\":\"x\",\"auth\":\"y\"}');",
                   aal="aal2").returncode != 0
    assert as_user(db["founder"], "select save_push_subscription('https://push.example/c', '{\"p256dh\":\"x\"}');",
                   aal="aal2").returncode != 0
    assert as_user(db["founder"], "select count(*) from push_subscriptions;", aal="aal2").stdout.strip() == "1"
    assert as_user(db["founder"], "select count(*) from push_subscriptions;", aal="aal1").stdout.strip() == "0"
    assert as_user(db["client"], "select count(*) from push_subscriptions;", aal="aal2").stdout.strip() == "0"
    assert as_user(db["founder"], "select keys from push_subscriptions;", aal="aal2").returncode != 0   # keys: server only
    assert as_user(db["founder"], "delete from push_subscriptions;", aal="aal2").returncode != 0
    assert call("delete_push_subscription", {"p_endpoint": "https://push.example/a"}, db["founder"]) is True
    assert q("select count(*) from push_subscriptions") == "0"


def test_push_triggers_titles_are_fixed_and_coalesced(db):
    q("delete from push_queue")
    pq = lambda kind: q(f"select coalesce(string_agg(title || '|' || urgent || '|' || url, ';' order by created_at), '') "
                        f"from push_queue where kind = '{kind}'")
    # drafts: a prospector batch is one push
    for _ in range(3):
        draft(kind="outbound", agent="prospector", to_email="x@y.example")
    assert pq("draft") == "New drafts to approve|false|/approvals"
    # an interested reply is urgent; the title carries no client words
    tid = q("insert into touches (type, subject, body_excerpt, classifier) values ('human_reply','Secret plant','We want it',"
            "'{\"label\":\"inquiry\"}') returning id")
    draft(in_reply_to_touch_id=tid)
    assert pq("reply") == "Interested reply · draft ready|true|/approvals"
    # new ticket (ref only), test orgs are silent
    t = json.loads(as_user(db["client"], f"select create_ticket('{db['proj']}','Confidential title','body','bug','urgent');").stdout)
    as_user(db["ci"], f"select create_ticket('{db['testproj']}','ci','b','bug','low');", aal="aal2")
    assert pq("ticket") == f"New ticket {t['ref']} · urgent|true|/tickets/{t['id']}"
    # error heartbeats: once per agent per hour
    for _ in range(3):
        q("insert into agent_heartbeats (agent, status) values ('outbox', 'error')")
    q("insert into agent_heartbeats (agent, status) values ('inbox', 'ok')")
    assert pq("agent_error") == "Agent error: outbox|true|/agents"
    assert q("select count(*) from push_queue where body like '%Secret%' or title like '%Confidential%' or body like '%We want%'") == "0"
    # one row per full-scope staff user only (the CI test-scope user gets nothing)
    assert q(f"select count(*) from push_queue where user_id = '{db['ci']}'") == "0"
    # kill switch
    q("insert into settings (key, value) values ('push.enabled', 'false') on conflict (key) do update set value = 'false'")
    q("insert into agent_heartbeats (agent, status) values ('brief', 'error')")
    assert "brief" not in pq("agent_error")
    q("delete from settings where key = 'push.enabled'")


def test_push_on_intake_proposal_invoice(db):
    q("delete from push_queue")
    claims = json.dumps({"role": "anon"})
    payload = json.dumps({"name": "Jonas", "email": "jonas@nw.example", "company": "NW", "kind": "hardware",
                          "message": "Secret machines"}).replace("'", "''")
    r = psql(f"begin; set local role anon; set local request.jwt.claims = '{claims}';"
             f"select submit_intake('{base.ip_hash()}', '{payload}'::jsonb); commit;", check=False)
    assert r.returncode == 0, r.stderr
    assert q("select title || '|' || urgent from push_queue where kind = 'intake'") == "New enquiry on epsilon-labs.co|true"
    # invoice paid / proposal viewed and accepted: the 009 guards are bypassed here only to reach the states quickly
    q("alter table invoices disable trigger invoices_guard; alter table invoices disable trigger invoices_number;"
      "alter table proposals disable trigger proposals_guard;")
    try:
        inv = q(f"insert into invoices (org_id, bill_company, total, status, number, issued_at) values "
                f"('{db['org']}', 'Org', 10, 'sent', 'EL-2026-901', now()) returning id")
        q(f"update invoices set status = 'paid', paid_at = now() where id = '{inv}'")
        q(f"update invoices set total = 11 where id = '{inv}'")      # not a status change: no second push
        cid = q("insert into companies (name) values ('NW') returning id")
        deal = q(f"insert into deals (company_id, title, source_channel) values ('{cid}', 'Pilot', 'inbound') returning id")
        pid = q(f"insert into proposals (deal_id, version, title, client_company, contact_name, contact_email, valid_until, "
                f"terms_version, status, token_hash, sha256, sent_at) values ('{deal}', 1, 'Secret pilot', 'NW', 'J', 'j@nw.example', "
                f"current_date + 9, 'T-2026-1', 'sent', repeat('a', 64), repeat('b', 64), now()) returning id")
        q(f"update proposals set status = 'viewed', viewed_at = now() where id = '{pid}'")
        q(f"update proposals set status = 'accepted' where id = '{pid}'")
    finally:
        q("alter table invoices enable trigger invoices_guard; alter table invoices enable trigger invoices_number;"
          "alter table proposals enable trigger proposals_guard;")
    assert q("select string_agg(title || '|' || urgent || '|' || url, ';') from push_queue where kind = 'invoice'") == \
        f"Invoice EL-2026-901 paid|true|/invoices/{inv}"
    assert q("select string_agg(title || '|' || urgent, ';' order by created_at, title desc) from push_queue where kind = 'proposal'") == \
        "Proposal viewed|false;Proposal accepted|true"
    assert q("select count(*) from push_queue where title like '%Secret%'") == "0"


def test_claim_push_batch_and_finish(db):
    q("delete from push_queue")
    q(f"insert into push_queue (user_id, kind, title, url) values ('{db['founder']}', 'test', 'T', '/'), ('{db['founder']}', 'test', 'T2', '/')")
    q(f"insert into push_queue (user_id, kind, title, url, created_at) values ('{db['founder']}', 'test', 'old', '/', now() - interval '2 days')")
    assert as_user(db["founder"], "select count(*) from claim_push_batch(10);", aal="aal2").returncode != 0
    r = as_user(None, "select count(*) from claim_push_batch(10);", role="service_role")
    assert r.stdout.strip() == "2"
    r = as_user(None, "select count(*) from claim_push_batch(10);", role="service_role")
    assert r.stdout.strip() == "0"   # claimed rows are not handed out twice
    assert q("select error from push_queue where title = 'old'") == "expired before delivery"
    pid = q("select id from push_queue where title = 'T'")
    svc("finish_push", p_id=pid, p_sent=True, p_emailed=True)
    assert q(f"select (sent_at is not null) || '|' || (emailed_at is not null) from push_queue where id = '{pid}'") == "true|true"
    assert as_user(db["founder"], "select count(*) from push_queue;", aal="aal2").stdout.strip() == "3"
    assert as_user(db["client"], "select count(*) from push_queue;", aal="aal2").stdout.strip() == "0"
    assert call("queue_test_push", {}, db["founder"])
    assert as_user(db["client"], "select queue_test_push();", aal="aal2").returncode != 0


def test_platform_usage_staff_only(db):
    u = call("platform_usage", {}, db["founder"])
    assert u["db_bytes"] > 0 and u["db_cap"] == 500 * 1024 * 1024 and u["storage_cap"] == 1024 ** 3
    assert as_user(db["client"], "select platform_usage();", aal="aal2").returncode != 0
