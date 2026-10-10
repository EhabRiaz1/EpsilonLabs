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
    cols = pg("select string_agg(column_name, ',') from information_schema.columns where table_name='approval_queue'")
    for c in ("kind", "to_email", "subject", "in_reply_to_message_id", "references_hdr", "send_error",
              "sent_message_id", "claimed_at", "run_id"):
        assert c in cols.split(","), c
    enums = pg("select string_agg(enumlabel, ',') from pg_enum e join pg_type t on t.oid=e.enumtypid where typname='approval_status'")
    assert "sending" in enums and "failed" in enums
    for t in ("actions", "dossiers"):
        assert pg(f"select relrowsecurity from pg_class where relname='{t}'") == "t"
        assert pg(f"select count(*) from pg_policies where tablename='{t}' and 'service_role'=any(roles)") == "1"
    assert pg("select count(*) from pg_indexes where indexname='actions_action_at_idx'") == "1"
