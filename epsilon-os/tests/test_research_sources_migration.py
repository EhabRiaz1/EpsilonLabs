"""Migration 013 (software strategies S11-S13, prospector.mix, ppra_epms) against a local Postgres, on top of 011.

Reuses test_rulebook_migration's database fixture, which applies schema + 002-011 + 013. Skipped when no local
Postgres is running. The full save_settings() parity with dashboard/actions.save_settings_all runs there (FORMS);
this file covers what 013 itself adds.
"""
import json

import pytest

from core import settings as cfg
from dashboard import actions
from tests.fakes import FakeDB
from tests.test_rulebook_migration import ROOT, call, db, psql, q  # noqa: F401  (db is the shared fixture)
from tests import test_intake_portal_migration as base

pytestmark = base.pytestmark


def test_013_reapplies_cleanly(db):
    r = psql((ROOT / "migrations/013_research_sources.sql").read_text(), check=False)
    assert r.returncode == 0, r.stderr


def test_settings_defaults_match_python(db):
    sql = json.loads(q("select settings_defaults()"))
    for key in ("prospector.mix", "strategy.quotas", "tenders.sources", "prospector.per_day"):
        assert sql[key] == cfg.DEFAULTS[key], key
    assert sql["prospector.mix"] == 40 and "ppra_epms" in sql["tenders.sources"]
    assert sorted(sql["strategy.quotas"]) == sorted(cfg.STRATEGY_IDS)


def test_new_strategy_ids_and_source_pass_the_checks(db):
    for sid in ("s11_software", "s12_devpartner", "s13_hn"):
        cid = q(f"insert into companies (name, domain, strategy) values ('C {sid}', '{sid}.example.com', '{sid}') returning id")
        q(f"insert into deals (company_id, title, stage, source_channel, strategy) values ('{cid}', 't', 'lead', 'outbound', '{sid}')")
    r = psql("insert into companies (name, domain, strategy) values ('X', 'x.example.com', 's14_nope');", check=False)
    assert r.returncode != 0 and "companies_strategy_chk" in r.stderr
    q("insert into opportunities (source, source_id, title, country, currency, raw) values "
      "('ppra_epms', 'TS0000015412E', 'T', 'PK', 'PKR', '{\"eligibility_flags\": [\"PEC C-6\"]}')")
    r = psql("insert into opportunities (source, source_id, title) values ('nope', '1', 'T');", check=False)
    assert r.returncode != 0 and "opportunities_source_check" in r.stderr


@pytest.mark.parametrize("form", [
    {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "mix": "25"},
    {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "mix": 70},
    {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "mix": "-1"},
    {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "mix": True},
    {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"], "tenders_per_day": "15",
     "tenders_value_min": "0", "tenders_value_max": "100000", "tenders_sources": ["ppra_epms"]},
])
def test_mix_and_ppra_source_match_python(db, form):
    q("delete from settings")
    fake = FakeDB()
    py = actions.save_settings_all(fake, dict(form))
    sql = call("save_settings", {"p": form}, db["founder"])
    assert sql["ok"] == py["ok"]
    if not py["ok"]:
        assert sql["errors"] == py["errors"]
    else:
        assert sorted(sql["changed"]) == sorted(py["changed"])
        stored = json.loads(q("select coalesce(json_object_agg(key, value), '{}') from settings"))
        assert stored == {r["key"]: r["value"] for r in fake.rows("settings")}


def test_a_form_without_mix_leaves_it_alone(db):
    q("delete from settings")
    base_form = {"per_day": "40", "daily_budget": "250", "daily_cap": "50", "segments": ["industrial"]}
    assert call("save_settings", {"p": {**base_form, "mix": "30"}}, db["founder"])["ok"]
    assert call("save_settings", {"p": base_form}, db["founder"])["ok"]
    assert call("get_settings", {}, db["founder"])["prospector.mix"] == 30
