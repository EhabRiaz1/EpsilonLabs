import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DB = "eos_test"


def sh(*a, check=True):
    return subprocess.run(a, capture_output=True, text=True, check=check)


pytestmark = pytest.mark.skipif(
    not shutil.which("pg_isready") or subprocess.run(["pg_isready", "-q"]).returncode != 0,
    reason="local postgres not available")


@pytest.fixture
def pg():
    sh("dropdb", "--if-exists", DB)
    sh("createdb", DB)
    for role in ("service_role", "anon", "authenticated"):
        sh("psql", "-d", DB, "-c",
           f"do $$ begin if not exists (select from pg_roles where rolname='{role}') then create role {role}; end if; end $$;")
    yield lambda sql: sh("psql", "-d", DB, "-At", "-c", sql).stdout.strip()
    sh("dropdb", "--if-exists", DB)


def apply(f):
    sh("psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(ROOT / f))


def test_migration(pg):
    apply("schema.sql")
    apply("migrations/002_epsilon_os_v2.sql")
    apply("migrations/002_epsilon_os_v2.sql")  # idempotent
    apply("migrations/003_epsilon_os_v3.sql")
    apply("migrations/003_epsilon_os_v3.sql")  # idempotent
    apply("migrations/004_epsilon_os_v4.sql")
    pg("update settings set value='7'::jsonb where key='prospector.per_day'")
    apply("migrations/004_epsilon_os_v4.sql")  # idempotent, and never overwrites a changed setting
    # 005: rows that exist before it is applied (a prospector first touch and an inbox reply on the outreach mailbox)
    pg("insert into approval_queue (agent, kind, draft) values ('prospector','outbound','a'),('inbox','outbound','b'),('inbox','reply','c')")
    apply("migrations/005_epsilon_os_v5.sql")
    apply("migrations/005_epsilon_os_v5.sql")  # idempotent
    assert pg("select string_agg(coalesce(sequence_step::text,'null'), ',' order by agent, kind) from approval_queue") == "null,null,1"
    first = pg("select id from approval_queue where agent='prospector'")
    pg(f"insert into approval_queue (agent, kind, draft, sequence_step, sequence_parent) values ('prospector','outbound','f2',2,'{first}')")
    apply("migrations/005_epsilon_os_v5.sql")  # re-applying never rewrites a later step
    assert pg("select count(*) from approval_queue where sequence_step=2 and sequence_parent is not null") == "1"
    assert sh("psql", "-d", DB, "-c", "insert into approval_queue (agent, kind, draft, sequence_step) values ('x','outbound','y',4)",
              check=False).returncode != 0
    assert pg("select count(*) from pg_indexes where indexname in ('approval_queue_sequence_idx','approval_queue_followup_due_idx')") == "2"
    pg(f"delete from approval_queue where id='{first}'")  # parent delete never cascades into the follow-up
    assert pg("select count(*) from approval_queue where sequence_step=2 and sequence_parent is null") == "1"
    assert pg("select value from settings where key='prospector.per_day'") == "7"
    assert pg("select count(*) from settings") == "7"
    assert pg("select value::text from settings where key='outreach.started_on'") == "null"
    assert pg("select value from settings where key='prospector.segments'") == '["industrial", "oem_hardware", "smb_software"]'
    assert pg("select relrowsecurity from pg_class where relname='settings'") == "t"
    assert pg("select count(*) from pg_policies where tablename='settings' and 'service_role'=any(roles)") == "1"
    assert pg("select count(*) from pg_indexes where tablename='deals' and indexdef ilike '%(source_channel)%'") == "1"
    cols = pg("select string_agg(column_name, ',') from information_schema.columns where table_name='approval_queue'")
    for c in ("kind", "to_email", "subject", "in_reply_to_message_id", "references_hdr", "send_error",
              "sent_message_id", "claimed_at", "run_id", "held", "held_reason", "lint", "diff"):
        assert c in cols.split(","), c
    enums = pg("select string_agg(enumlabel, ',') from pg_enum e join pg_type t on t.oid=e.enumtypid where typname='approval_status'")
    assert "sending" in enums and "failed" in enums
    for t in ("actions", "dossiers"):
        assert pg(f"select relrowsecurity from pg_class where relname='{t}'") == "t"
        assert pg(f"select count(*) from pg_policies where tablename='{t}' and 'service_role'=any(roles)") == "1"
    assert pg("select count(*) from pg_indexes where indexname='actions_action_at_idx'") == "1"
    assert pg("select count(*) from pg_indexes where indexname='approval_queue_status_held_idx'") == "1"
    assert pg("select column_default from information_schema.columns where table_name='approval_queue' and column_name='held'") == "false"
    assert pg("select is_nullable from information_schema.columns where table_name='approval_queue' and column_name='held'") == "NO"


def test_migration_007_strategy_columns_and_legacy_backfill(pg):
    for f in ("schema.sql", "migrations/002_epsilon_os_v2.sql", "migrations/003_epsilon_os_v3.sql",
              "migrations/004_epsilon_os_v4.sql", "migrations/005_epsilon_os_v5.sql"):
        apply(f)
    # rows that exist before 007: a prospector company + its outbound deal, an unrelated outbound deal, a referral deal
    pg("insert into companies (name, domain, notes) values ('Old Prospect','old.example.com','Prospector (industrial): hiring PLC. Evidence: https://x.example/y'),"
       "('Referral Co','ref.example.com','from a friend')")
    pc = pg("select id from companies where domain='old.example.com'")
    rc = pg("select id from companies where domain='ref.example.com'")
    pg(f"insert into deals (company_id, title, source_channel) values ('{pc}','Outbound: x','outbound'),('{rc}','Intro','referral'),('{rc}','Cold','outbound')")
    apply("migrations/007_epsilon_os_v7.sql")
    apply("migrations/007_epsilon_os_v7.sql")  # idempotent
    assert pg("select strategy from companies where domain='old.example.com'") == "legacy"
    assert pg("select coalesce(strategy,'null') from companies where domain='ref.example.com'") == "null"
    assert pg("select string_agg(coalesce(strategy,'null'), ',' order by title) from deals") == "null,null,legacy"   # Cold, Intro, Outbound: x
    # re-applying never rewrites a strategy set after the first run
    pg("update companies set strategy='s2_trigger' where domain='old.example.com'")
    pg(f"update deals set strategy='s2_trigger' where company_id='{pc}'")
    apply("migrations/007_epsilon_os_v7.sql")
    assert pg("select strategy from companies where domain='old.example.com'") == "s2_trigger"
    assert pg(f"select strategy from deals where company_id='{pc}'") == "s2_trigger"
    for sid in ("s3_regulation", "s4_partner", "s5_intent", "legacy"):
        pg(f"update companies set strategy='{sid}' where domain='ref.example.com'")
    assert sh("psql", "-d", DB, "-c", "update companies set strategy='bogus' where domain='ref.example.com'", check=False).returncode != 0
    assert sh("psql", "-d", DB, "-c", "update deals set strategy='bogus'", check=False).returncode != 0
    assert pg("select count(*) from pg_indexes where indexname in ('companies_strategy_idx','deals_strategy_idx')") == "2"
    assert pg("select count(*) from settings") == "7"   # 007 seeds no settings
