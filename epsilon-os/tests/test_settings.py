from datetime import date, timedelta

import pytest

from core import config, llm, settings
from tests.fakes import FakeDB


def test_defaults_when_table_empty_or_missing_key():
    db = FakeDB()
    assert settings.per_day(db) == 40
    assert settings.segments(db) == ["industrial", "oem_hardware", "smb_software"]
    assert settings.paused(db) is False
    assert settings.daily_budget(db) == 250 == config.DAILY_LLM_CALL_BUDGET
    assert settings.daily_cap(db) == 50
    assert settings.ramp(db) == {"start": 5, "step": 5, "every_days": 3}
    assert settings.started_on(db) is None and settings.outreach_address(db) == ""
    db.insert("settings", {"key": "prospector.per_day", "value": 7})
    assert settings.per_day(db) == 7 and settings.daily_cap(db) == 50  # other keys still default


def test_getters_survive_a_broken_table_and_malformed_values():
    class Broken(FakeDB):
        def select(self, table, **f):
            raise RuntimeError("no such table")
    assert settings.per_day(Broken()) == 40
    db = FakeDB()
    db.insert("settings", {"key": "prospector.per_day", "value": 9999})      # out of bounds
    db.insert("settings", {"key": "prospector.segments", "value": ["nope"]})  # not allowed
    db.insert("settings", {"key": "outreach.started_on", "value": None})      # the seeded JSON null
    assert settings.per_day(db) == 40 and settings.segments(db) == list(settings.SEGMENTS)
    assert settings.started_on(db) is None


def test_set_roundtrip_insert_then_update():
    db = FakeDB()
    assert settings.set(db, "prospector.per_day", "12") == 12
    assert settings.set(db, "prospector.per_day", 13) == 13
    assert len(db.rows("settings")) == 1 and settings.per_day(db) == 13
    settings.set(db, "prospector.segments", ["smb_software", "industrial"])
    assert settings.segments(db) == ["industrial", "smb_software"]  # canonical order
    settings.set(db, "prospector.paused", True)
    assert settings.paused(db) is True


@pytest.mark.parametrize("key,bad", [
    ("prospector.per_day", -1), ("prospector.per_day", 81), ("prospector.per_day", "x"), ("prospector.per_day", True),
    ("llm.daily_budget", 49), ("llm.daily_budget", 1001), ("outreach.daily_cap", 101), ("outreach.daily_cap", -5),
    ("prospector.segments", ["industrial", "fuel"]), ("prospector.segments", []), ("prospector.segments", "industrial"),
    ("prospector.paused", "yes"), ("outreach.address", "not-an-email"), ("outreach.started_on", None),
    ("outreach.started_on", "yesterday"), ("outreach.ramp", {"start": 5}), ("outreach.ramp", {"start": 5, "step": 5, "every_days": 0}),
    ("nope.key", 1)])
def test_set_rejects_invalid(key, bad):
    db = FakeDB()
    with pytest.raises(settings.SettingsError):
        settings.set(db, key, bad)
    assert db.rows("settings") == []


@pytest.mark.parametrize("key,ok", [("prospector.per_day", 0), ("prospector.per_day", 50), ("llm.daily_budget", 50),
                                    ("llm.daily_budget", 1000), ("outreach.daily_cap", 0), ("outreach.daily_cap", 100)])
def test_bounds_inclusive(key, ok):
    assert settings.set(FakeDB(), key, ok) == ok


def test_ramp_cap_math():
    r = {"start": 5, "step": 5, "every_days": 3}
    d0 = date(2026, 10, 12)
    assert settings.ramp_cap(r, None, d0) == 5
    assert settings.ramp_cap(r, d0, d0) == 5
    assert [settings.ramp_cap(r, d0, d0 + timedelta(days=n)) for n in (1, 2, 3, 5, 6, 9, 30)] == [5, 5, 10, 10, 15, 20, 55]


def test_effective_cap_is_min_of_setting_and_ramp():
    db = FakeDB()
    settings.set(db, "outreach.daily_cap", 8)
    settings.set(db, "outreach.started_on", "2026-10-01")
    assert settings.effective_cap(db, date(2026, 10, 20)) == 8       # ramp 35, setting 8
    settings.set(db, "outreach.daily_cap", 100)
    assert settings.effective_cap(db, date(2026, 10, 4)) == 10       # ramp 10, setting 100


def test_llm_budget_reads_settings_with_config_fallback(monkeypatch):
    db = FakeDB()
    assert llm.budget(db) == 250
    settings.set(db, "llm.daily_budget", 60)
    assert llm.budget(db) == 60

    class Broken(FakeDB):
        def select(self, table, **f):
            raise RuntimeError("down")
    monkeypatch.setattr(settings, "daily_budget", lambda db: (_ for _ in ()).throw(RuntimeError("x")))
    assert llm.budget(Broken()) == config.DAILY_LLM_CALL_BUDGET


def test_ask_stops_at_settings_budget(monkeypatch):
    import subprocess
    db = FakeDB()
    settings.set(db, "llm.daily_budget", 50)
    for _ in range(50):
        db.insert("actions", {"agent": "x", "action": "llm_call"})
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("must not call"))
    with pytest.raises(llm.BudgetExceeded):
        llm.ask(db, "t", "r", "s", "x", {"type": "object"})
