"""Strategies S2-S5 and the S6 learning loop, offline: scripted fakes, in-memory DB."""
import re
import threading
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode

import pytest

from agents import prospector as P
from core import settings
from dashboard import actions, data, server, views
from dashboard.demo import seeded_db
from prompts import loader, schemas, strategies as strat
from tests.fakes import FakeDB
from tests.test_dashboard_http import call
from tests.test_prospector import FakeLLM, NOW, RECENT, SLUGS, co, go, only

IDS = list(settings.STRATEGY_IDS)
TODAY = NOW.date()


def val(raw, sid="s2_trigger", **kw):
    return P.validate({**co(1, strategy=sid, trigger_type=strat.get(sid).trigger_types[0]), **raw}, sid, set(SLUGS), TODAY, **kw)


# ---------------------------------------------------------------- strategies as data

def test_strategy_ids_and_labels_agree_everywhere():
    assert IDS == list(strat.ORDER) == schemas.STRATEGY_IDS
    for sid, st in strat.STRATEGIES.items():
        assert st.id == sid and st.name == settings.STRATEGY_LABEL[sid]
        assert st.brief and st.queries and st.evidence_rules and st.buyer_rules and st.angle
        assert st.offers and set(st.offers) <= set(SLUGS), sid   # every default offer exists in catalogue.json
        assert st.segment in schemas.PROSPECT_SEGMENTS and st.trigger_types


@pytest.mark.parametrize("sid", IDS)
def test_each_strategy_prompt_composes_with_its_own_brief(sid):
    db, fake = FakeDB(), FakeLLM()
    settings.set(db, "strategy.quotas", {s: (3 if s == sid else 0) for s in IDS})
    go(db, fake, strategy=None)
    system = fake.research_calls[0]["system"]
    st = strat.get(sid)
    assert "{{" not in system
    assert st.brief[:80] in system and st.evidence_rules[:60] in system and st.buyer_rules[:60] in system
    assert f"Strategy for this call: {sid} ({st.name})" in system and f'strategy: exactly "{sid}"' in system
    for other in IDS:
        if other != sid:
            assert strat.get(other).brief[:80] not in system
    assert fake.research_calls[0]["schema"]["properties"]["companies"]["items"]["properties"]["strategy"]["enum"] == [sid]


def test_research_schema_requires_the_trigger_fields():
    item = schemas.research_strategy(SLUGS, "s4_partner")["properties"]["companies"]["items"]
    for f in ("strategy", "segment", "evidence_date", "trigger", "trigger_type", "headcount", "post_age_days"):
        assert f in item["required"] and f in item["properties"]
    assert item["properties"]["suggested_offer_slug"]["enum"] == SLUGS


def test_s2_s3_s4_s5_briefs_say_what_the_founder_asked_for():
    assert "Series" in strat.S2.brief and "120 days" in strat.S2.brief and "Innovation Fund" in strat.S2.brief
    assert "Cyber Resilience Act" in strat.S3.brief and "PSTI" in strat.S3.brief and "legal" in strat.S3.brief
    assert "white-label" in strat.S4.brief and "subcontractor" in strat.S4.brief
    assert "RFQ" in strat.S5.brief and "45 days" in strat.S5.brief and "under about 50" in strat.S5.brief


# ---------------------------------------------------------------- validation per strategy

def test_s5_full_time_post_rejected_unless_small_and_stale():
    job = dict(trigger_type="fulltime_post", evidence_url="https://acme1.example.com/careers/plc-engineer",
               evidence_quote="Full-time PLC engineer, apply now.", observation="Hiring a PLC engineer.")
    p, why = val({**job, "headcount": 20, "post_age_days": 60}, "s5_intent")
    assert p and p["last_resort"] and p["trigger_type"] == "fulltime_post"
    for bad in ({"headcount": 20, "post_age_days": 30},      # fresh post
                {"headcount": 20, "post_age_days": 45},      # exactly 45 is not over 45
                {"headcount": 300, "post_age_days": 90},     # not small
                {"headcount": 50, "post_age_days": 90},      # 50 is not under 50
                {"headcount": 0, "post_age_days": 90},       # size unknown
                {"headcount": 20, "post_age_days": 0}):      # age unknown
        assert val({**job, **bad}, "s5_intent")[1].startswith("full-time post"), bad


def test_s5_job_post_is_caught_even_when_mislabelled_as_rfq():
    sneaky = dict(trigger_type="rfq", evidence_url="https://boards.greenhouse.io/acme/jobs/1",
                  evidence_quote="We are hiring a full-time firmware engineer.", observation="Posted a firmware engineer job.")
    assert val({**sneaky, "headcount": 400, "post_age_days": 5}, "s5_intent")[1].startswith("full-time post")


def test_s5_explicit_outsourcing_on_a_careers_page_is_not_a_job_post():
    p, why = val({"trigger_type": "rfq", "evidence_url": "https://acme1.example.com/careers/vendors",
                  "evidence_quote": "We are looking for a firmware development partner under a statement of work.",
                  "observation": "Seeking an outside firmware partner."}, "s5_intent")
    assert p and not p["last_resort"] and p["trigger_type"] == "rfq"


def test_s5_stale_rfq_is_rejected_and_last_resort_marks_the_dossier_and_notes():
    assert "days old" in val({"trigger_type": "rfq", "evidence_date": (TODAY - timedelta(days=200)).isoformat()}, "s5_intent")[1]
    db = FakeDB()
    settings.set(db, "strategy.quotas", only(only({"s5_intent": 3})))
    job = co(1, strategy="s5_intent", trigger_type="fulltime_post", headcount=12, post_age_days=80, evidence_date="",
             evidence_url="https://acme1.example.com/jobs/1", evidence_quote="Full-time embedded engineer.",
             observation="Hiring an embedded engineer.")
    r = go(db, FakeLLM([job]), strategy="s5_intent")
    assert r["created"] == 1
    assert "Last resort" in db.rows("dossiers")[0]["body_md"] and "Last resort" in db.rows("companies")[0]["notes"]
    assert db.rows("actions", action="prospect_created")[0]["detail"]["last_resort"] is True


def test_s2_needs_a_dated_recent_trigger():
    assert val({}, "s2_trigger")[0]
    assert val({"evidence_date": ""}, "s2_trigger")[1] == "trigger without a date"
    assert "days old" in val({"evidence_date": (TODAY - timedelta(days=121)).isoformat()}, "s2_trigger")[1]
    assert val({"evidence_date": (TODAY - timedelta(days=119)).isoformat()}, "s2_trigger")[0]
    assert val({"trigger_type": "grant", "evidence_date": (TODAY - timedelta(days=300)).isoformat()}, "s2_trigger")[0]
    assert "days old" in val({"trigger_type": "grant", "evidence_date": (TODAY - timedelta(days=400)).isoformat()}, "s2_trigger")[1]
    assert val({"trigger_type": "end_of_life", "evidence_date": ""}, "s2_trigger")[0]
    assert val({"evidence_date": (TODAY + timedelta(days=30)).isoformat()}, "s2_trigger")[1] == "evidence dated in the future"
    assert val({"evidence_date": "last spring"}, "s2_trigger")[1] == "unreadable evidence_date"
    assert "not a Trigger events trigger" in val({"trigger_type": "rfq"}, "s2_trigger")[1]


def test_s3_only_takes_security_offers_and_regulation_triggers():
    assert val({"suggested_offer_slug": "device-pentest", "evidence_date": ""}, "s3_regulation")[0]
    assert val({"suggested_offer_slug": "crm", "evidence_date": ""}, "s3_regulation")[1].startswith("offer outside")
    assert val({"trigger_type": "funding", "suggested_offer_slug": "device-pentest"}, "s3_regulation")[1].startswith("trigger type")


def test_wrong_strategy_and_disabled_segment_are_dropped_and_missing_segment_defaults():
    assert val({"strategy": "s3_regulation"}, "s2_trigger")[1] == "wrong strategy"
    assert val({"segment": "smb_software"}, "s2_trigger", segments=["industrial"])[1] == "segment disabled in settings"
    p, _ = val({"segment": "bogus"}, "s4_partner", segments=None)
    assert p["segment"] == strat.S4.segment == "oem_hardware"
    p, _ = val({"segment": "bogus"}, "s5_intent")
    assert p["segment"] == "industrial"


# ---------------------------------------------------------------- S4 partner outbound

def _one(sid):
    db = FakeDB()
    settings.set(db, "strategy.quotas", {s: (2 if s == sid else 0) for s in IDS})
    fake = FakeLLM([co(1)])
    go(db, fake, strategy=sid)
    return db, fake


def test_s4_prospect_gets_partner_outbound_without_sales_wording():
    db, fake = _one("s4_partner")
    system = next(c["system"] for c in fake.ask_calls if c["kind"] == "outbound")
    assert system.count("white-label") + system.count("under their brand") >= 1
    assert "possible delivery partner" in system and "the client relationship stays with them" in system
    body = system.split("Task: write")[1].split("Focus offer")[0].lower()   # our instructions, not the offer catalogue
    for word in ("sales", "pitch", "customer pitch", "buy ", "hire us", "our services", "solutions"):
        assert word not in body, word
    for rule in ("130 words", "https://epsilon-labs.co/work", "Reply 'stop' and I won't write again.", "Ehab Riaz"):
        assert rule in system
    assert strat.S4.angle in system and "no prices" not in system.lower()
    assert db.rows("approval_queue")[0]["held"] is False
    assert db.rows("deals")[0]["strategy"] == "s4_partner"


def test_non_partner_strategies_use_the_standard_outbound_with_their_angle():
    for sid in ("s2_trigger", "s3_regulation", "s5_intent"):
        db = FakeDB()
        settings.set(db, "strategy.quotas", {s: (2 if s == sid else 0) for s in IDS})
        fake = FakeLLM([co(1)])
        go(db, fake, strategy=sid)
        system = next(c["system"] for c in fake.ask_calls if c["kind"] == "outbound")
        assert "delivery partner" not in system and strat.get(sid).angle in system and "{{" not in system


def test_partner_draft_with_customer_sales_wording_is_held():
    body = "Hi,\n\nOur services are affordable and best-in-class.\n\nEhab\n\nReply 'stop' and I won't write again."
    db = FakeDB()
    settings.set(db, "strategy.quotas", {s: (2 if s == "s4_partner" else 0) for s in IDS})
    go(db, FakeLLM([co(1)], body=body), strategy="s4_partner")
    q = db.rows("approval_queue")[0]
    assert q["held"] is True and "sales wording" in q["held_reason"]
    db2 = FakeDB()   # the same text under another strategy is not held for that reason
    settings.set(db2, "strategy.quotas", {s: (2 if s == "s2_trigger" else 0) for s in IDS})
    go(db2, FakeLLM([co(1)], body=body), strategy="s2_trigger")
    assert "sales wording" not in (db2.rows("approval_queue")[0]["held_reason"] or "")


def test_partner_prompt_file_carries_the_same_rules_as_outbound():
    system = loader.compose("partner_outbound", {"context": "c", "focus": "f", "angle": "a"})
    assert "https://epsilon-labs.co/work" in system and "eFuelPro" in system and "Epsilon Labs · epsilon-labs.co" in system
    assert "prices, rates, margins" in system and "130 words" in system


# ---------------------------------------------------------------- strategy stored everywhere

def test_strategy_is_stored_on_company_deal_dossier_and_actions():
    db = FakeDB()
    settings.set(db, "strategy.quotas", {s: (2 if s == "s3_regulation" else 0) for s in IDS})
    r = go(db, FakeLLM([co(1)]), strategy="s3_regulation")
    assert r["created"] == 1
    c, d = db.rows("companies")[0], db.rows("deals")[0]
    assert c["strategy"] == d["strategy"] == "s3_regulation" and "s3_regulation/" in c["notes"]
    dos = db.rows("dossiers")[0]["body_md"]
    assert dos.startswith("**Strategy:** Regulation (s3_regulation)") and "**Trigger:** regulation:" in dos
    assert db.rows("actions", action="prospect_created")[0]["detail"]["strategy"] == "s3_regulation"
    assert db.rows("actions", action="draft_queued")[0]["detail"]["strategy"] == "s3_regulation"
    assert db.rows("actions", action="research_done")[0]["detail"]["strategy"] == "s3_regulation"
    # the model sees the strategy and trigger in the facts too
    _, fake = _one("s2_trigger")
    assert '"strategy": "s2_trigger"' in fake.ask_calls[0]["untrusted"] and "trigger_type" in fake.ask_calls[0]["untrusted"]


def test_segment_column_still_fills_wedge_from_the_strategys_natural_segment():
    db = FakeDB()
    settings.set(db, "strategy.quotas", {s: (2 if s == "s5_intent" else 0) for s in IDS})
    go(db, FakeLLM([co(1, segment="not-a-segment")]), strategy="s5_intent")
    assert db.rows("companies")[0]["wedge"] == "industrial_monitoring"


def test_disabled_segment_setting_still_filters():
    db = FakeDB()
    settings.set(db, "strategy.quotas", {s: (2 if s == "s2_trigger" else 0) for s in IDS})
    settings.set(db, "prospector.segments", ["smb_software"])
    r = go(db, FakeLLM([co(1, segment="industrial")]), strategy="s2_trigger", dry=False)
    assert r["created"] == 0 and r["invalid"] == 1


def test_dry_run_with_strategy_writes_nothing_and_counts_only_that_strategy():
    db = FakeDB()
    r = go(db, FakeLLM([co(1), co(2)]), strategy="s4_partner", per_day=2, dry=True)
    assert r["strategies"] == ["s4_partner"] and r["created"] == 2 and r["by_strategy"]["s4_partner"]["created"] == 2
    assert r["by_strategy"]["s2_trigger"]["research_calls"] == 0
    assert db.rows("agent_heartbeats") == []


# ---------------------------------------------------------------- S6: quotas and rebalance

DEFAULT = {"s2_trigger": 6, "s3_regulation": 4, "s4_partner": 6, "s5_intent": 5, "s7_orphaned": 6, "s8_tradeshow": 5,
           "s9_crowdfund": 4, "s10_accelerator": 4}


def st30(**sid_sent_pos):
    """{sid: {"sent": n, "positive": k}} from sid=(sent, positive)."""
    return {sid: {"sent": a, "positive": b} for sid, (a, b) in sid_sent_pos.items()}


def test_default_quotas_and_settings_validation():
    db = FakeDB()
    assert settings.quotas(db) == DEFAULT and sum(DEFAULT.values()) <= settings.per_day(db)
    assert settings.auto_rebalance(db) is True and settings.pinned(db) == []
    assert settings.set(db, "strategy.quotas", {"s2_trigger": "7", "s3_regulation": 3}) == {**DEFAULT, "s2_trigger": 7, "s3_regulation": 3}
    for bad in ({"s9": 1}, {"s2_trigger": -1}, {"s2_trigger": 51}, {"s2_trigger": "x"}, {"s2_trigger": True}, [1, 2], "6"):
        with pytest.raises(settings.SettingsError):
            settings.validate("strategy.quotas", bad)
    assert settings.set(db, "strategy.pinned", ["s5_intent", "s2_trigger"]) == ["s2_trigger", "s5_intent"]
    with pytest.raises(settings.SettingsError):
        settings.validate("strategy.pinned", ["nope"])
    with pytest.raises(settings.SettingsError):
        settings.validate("strategy.auto_rebalance", "yes")
    with pytest.raises(settings.SettingsError):
        settings.check_quota_total(DEFAULT, 39)
    settings.check_quota_total(DEFAULT, 40)
    db.insert("settings", {"key": "strategy.quotas", "value": {"s2_trigger": 999}})   # junk in the DB falls back to defaults
    assert settings.quotas(db) == DEFAULT


def test_effective_quotas_trim_to_per_day():
    assert P.effective_quotas(DEFAULT, 40) == DEFAULT
    assert P.effective_quotas(DEFAULT, 8) == only({"s2_trigger": 6, "s3_regulation": 2})


def test_rebalance_waits_for_40_sends_in_two_strategies():
    assert P.rebalance(DEFAULT, st30(s2_trigger=(39, 9), s3_regulation=(100, 1)), []) is None   # only one has enough sends
    assert P.rebalance(DEFAULT, st30(s2_trigger=(40, 8), s3_regulation=(39, 0)), []) is None
    mv = P.rebalance(DEFAULT, st30(s2_trigger=(40, 8), s3_regulation=(40, 1)), [])
    assert mv["from"] == "s3_regulation" and mv["to"] == "s2_trigger" and mv["moved"] == 2
    assert mv["quotas"] == {**DEFAULT, "s2_trigger": 8, "s3_regulation": 2}
    assert sum(mv["quotas"].values()) == sum(DEFAULT.values())


def test_rebalance_moves_from_lowest_rate_to_highest_rate():
    s = st30(s2_trigger=(50, 5), s3_regulation=(50, 10), s4_partner=(60, 3), s5_intent=(45, 9))
    mv = P.rebalance(DEFAULT, s, [])
    assert (mv["from"], mv["to"]) == ("s4_partner", "s3_regulation")   # 5% lowest, 20% highest


def test_rebalance_cap_is_two_and_floor_is_two():
    mv = P.rebalance({**DEFAULT, "s3_regulation": 3}, st30(s2_trigger=(40, 20), s3_regulation=(40, 0)), [])
    assert mv["moved"] == 1 and mv["quotas"]["s3_regulation"] == 2          # only 1 above the floor
    assert P.rebalance({**DEFAULT, "s3_regulation": 2}, st30(s2_trigger=(40, 20), s3_regulation=(40, 0)), []) is None
    big = P.rebalance(only({"s2_trigger": 10, "s3_regulation": 10}), st30(s2_trigger=(40, 20), s3_regulation=(40, 0)), [])
    assert big["moved"] == 2


def test_rebalance_never_touches_pinned_or_switched_off_or_equal_rates():
    s = st30(s2_trigger=(40, 20), s3_regulation=(40, 0), s4_partner=(40, 8), s5_intent=(40, 4))
    mv = P.rebalance(DEFAULT, s, ["s3_regulation"])      # lowest is pinned: next lowest donates
    assert mv["from"] == "s5_intent" and mv["to"] == "s2_trigger"
    mv = P.rebalance(DEFAULT, s, ["s2_trigger"])         # highest is pinned: next highest receives
    assert (mv["from"], mv["to"]) == ("s3_regulation", "s4_partner")
    assert P.rebalance(DEFAULT, s, ["s2_trigger", "s3_regulation", "s4_partner"]) is None   # one left: nothing to compare
    assert P.rebalance({**DEFAULT, "s3_regulation": 0}, st30(s2_trigger=(40, 20), s3_regulation=(40, 0)), []) is None
    assert P.rebalance(DEFAULT, st30(s2_trigger=(40, 4), s3_regulation=(40, 4)), []) is None   # equal rates


def _seed_week(db, now, sends=None):
    """Deals with strategies, plus sent touches and positive replies in the last 30 days."""
    sends = sends or {"s2_trigger": (40, 8), "s3_regulation": (40, 1)}
    for sid, (n, pos) in sends.items():
        deal = db.insert("deals", {"company_id": "c", "title": sid, "source_channel": "outbound", "strategy": sid})[0]["id"]
        for i in range(n):
            db.insert("touches", {"deal_id": deal, "type": "sent", "direction": "outbound",
                                  "occurred_at": (now - timedelta(days=2)).isoformat()})
        for i in range(pos):
            db.insert("touches", {"deal_id": deal, "type": "human_reply", "direction": "inbound", "classifier": {"label": "inquiry"},
                                  "occurred_at": (now - timedelta(days=1)).isoformat()})


MONDAY = datetime(2026, 10, 12, 3, 0, tzinfo=timezone.utc)   # 08:00 PKT, a Monday


def test_run_rebalances_on_monday_only_once_and_logs_it():
    db = FakeDB()
    _seed_week(db, MONDAY)
    fake = FakeLLM()
    r = go(db, fake, now=MONDAY, strategy=None)
    assert settings.quotas(db) == {**DEFAULT, "s2_trigger": 8, "s3_regulation": 2}
    act = db.rows("actions", action="quota_rebalanced")
    assert len(act) == 1 and act[0]["detail"]["from"] == "s3_regulation" and act[0]["detail"]["moved"] == 2
    assert "Quota rebalanced" in r["rebalance"] and "Trigger events" in r["rebalance"]
    assert r["target"] == 40    # the run used the new quotas
    go(db, FakeLLM(), now=MONDAY + timedelta(hours=1), strategy=None)   # same Monday: no second move
    assert settings.quotas(db)["s2_trigger"] == 8 and len(db.rows("actions", action="quota_rebalanced")) == 1


def test_no_rebalance_other_days_when_off_when_dry_or_before_the_threshold():
    tuesday = MONDAY + timedelta(days=1)
    for now, setup in [(tuesday, None), (MONDAY, ("strategy.auto_rebalance", False))]:
        db = FakeDB()
        _seed_week(db, now)
        if setup:
            settings.set(db, *setup)
        go(db, FakeLLM(), now=now, strategy=None)
        assert settings.quotas(db) == DEFAULT and db.rows("actions", action="quota_rebalanced") == []
    db = FakeDB()
    _seed_week(db, MONDAY)
    go(db, FakeLLM(), now=MONDAY, strategy="s2_trigger", dry=True)
    assert settings.quotas(db) == DEFAULT
    db = FakeDB()
    _seed_week(db, MONDAY, {"s2_trigger": (39, 20), "s3_regulation": (200, 0)})   # one strategy short of 40 sends
    go(db, FakeLLM(), now=MONDAY, strategy=None)
    assert settings.quotas(db) == DEFAULT
    assert len(db.rows("actions", action="quota_rebalance_checked")) == 1   # checked, nothing moved


def test_pinned_strategy_keeps_its_quota_through_a_monday_run():
    db = FakeDB()
    _seed_week(db, MONDAY)
    settings.set(db, "strategy.pinned", ["s3_regulation"])
    go(db, FakeLLM(), now=MONDAY, strategy=None)
    assert settings.quotas(db) == DEFAULT


def test_rebalance_failure_never_stops_the_daily_run(monkeypatch):
    monkeypatch.setattr(P, "strategy_stats", lambda *a, **k: 1 / 0)
    db = FakeDB()
    r = go(db, FakeLLM(), now=MONDAY, strategy=None)
    assert r["research_calls"] == 8 and db.rows("actions", action="quota_rebalance_failed")


def test_next_rebalance_date():
    assert P.next_rebalance(MONDAY) == date(2026, 10, 12)                       # Monday, not yet run
    assert P.next_rebalance(MONDAY, checked_today=True) == date(2026, 10, 19)
    assert P.next_rebalance(MONDAY + timedelta(days=3)) == date(2026, 10, 19)   # Thursday


# ---------------------------------------------------------------- stats

def _stats_world(now):
    db = FakeDB()
    ago = lambda **kw: (now - timedelta(**kw)).isoformat()
    for sid, n_old, n_new in [("s2_trigger", 1, 2), ("legacy", 0, 1)]:
        for i in range(n_new):
            db.insert("companies", {"name": f"{sid}{i}", "domain": f"{sid}{i}.example.com", "strategy": sid, "created_at": ago(days=5)})
        for i in range(n_old):
            db.insert("companies", {"name": f"{sid}old{i}", "domain": f"{sid}old{i}.example.com", "strategy": sid, "created_at": ago(days=60)})
    d2 = db.insert("deals", {"company_id": "c", "title": "a", "source_channel": "outbound", "strategy": "s2_trigger", "stage": "conversation",
                             "updated_at": ago(days=3)})[0]["id"]
    won = db.insert("deals", {"company_id": "c", "title": "w", "source_channel": "outbound", "strategy": "s2_trigger", "stage": "won",
                              "value_usd": 18000, "closed_at": ago(days=10), "updated_at": ago(days=10)})[0]["id"]
    lead = db.insert("deals", {"company_id": "c", "title": "l", "source_channel": "outbound", "strategy": "s2_trigger", "stage": "lead",
                               "updated_at": ago(days=1)})[0]["id"]
    old_won = db.insert("deals", {"company_id": "c", "title": "ow", "source_channel": "outbound", "strategy": "s2_trigger", "stage": "won",
                                  "value_usd": 5000, "closed_at": ago(days=60), "updated_at": ago(days=60)})[0]["id"]
    other = db.insert("deals", {"company_id": "c", "title": "o", "source_channel": "inbound", "stage": "conversation"})[0]["id"]  # no strategy
    for deal, status, dec in [(d2, "sent", 4), (d2, "approved", 3), (lead, "rejected", 2), (d2, "sent", 50), (other, "sent", 1)]:
        db.insert("approval_queue", {"agent": "prospector", "kind": "outbound", "deal_id": deal, "status": status, "decided_at": ago(days=dec)})
    for deal, typ, when, label in [(d2, "sent", 4, None), (d2, "sent", 3, None), (d2, "sent", 45, None), (lead, "sent", 2, None),
                                   (d2, "human_reply", 2, "inquiry"), (d2, "human_reply", 2, "interested"), (d2, "human_reply", 2, "auto"),
                                   (d2, "human_reply", 40, "inquiry"), (d2, "opt_out", 1, None), (lead, "human_reply", 1, "opt_out"),
                                   (other, "sent", 1, None), (d2, "bounce", 1, None)]:
        db.insert("touches", {"deal_id": deal, "type": typ, "direction": "outbound" if typ == "sent" else "inbound",
                              "occurred_at": ago(days=when), "classifier": {"label": label} if label else None})
    return db


def test_strategy_stats_per_window():
    db = _stats_world(NOW)
    s = P.strategy_stats(db, NOW)
    m30, m90 = s["s2_trigger"][30], s["s2_trigger"][90]
    assert (m30["created"], m90["created"]) == (2, 3)
    assert m30["approved"] == 2 and m90["approved"] == 3          # sent(4d) + approved(3d); the 50-day-old one only in 90d
    assert (m30["sent"], m90["sent"]) == (3, 4)
    assert (m30["replies"], m90["replies"]) == (4, 5)
    assert (m30["positive"], m90["positive"]) == (2, 3)
    assert m30["optouts"] == 2                                    # an opt_out touch plus a reply labelled opt_out
    assert m30["advanced"] == 2 and m90["advanced"] == 3          # conversation + won; the lead does not count
    assert m30["won_value"] == 18000 and m90["won_value"] == 23000
    assert m30["reply_rate"] == pytest.approx(4 / 3) and m30["positive_rate"] == pytest.approx(2 / 3)
    assert s["legacy"][30]["created"] == 1 and s["legacy"][30]["sent"] == 0 and s["legacy"][30]["positive_rate"] is None
    assert s["s3_regulation"][30] == {**s["s3_regulation"][30], "created": 0, "sent": 0, "reply_rate": None}


# ---------------------------------------------------------------- settings form

def test_strategy_form_parses_and_validates_the_total():
    p = {**{f"quota_{k}": str(v) for k, v in DEFAULT.items()}, "pin_s3_regulation": "1", "auto_rebalance": "1"}
    clean, errors = settings.strategy_form(p, 40)
    assert errors == {} and clean == {"strategy.quotas": DEFAULT, "strategy.auto_rebalance": True, "strategy.pinned": ["s3_regulation"]}
    clean, errors = settings.strategy_form({k: v for k, v in p.items() if k != "auto_rebalance"}, 40)
    assert clean["strategy.auto_rebalance"] is False
    clean, errors = settings.strategy_form(p, 39)
    assert clean == {} and "add up to 40" in errors["quotas"]
    _, errors = settings.strategy_form({**p, "quota_s4_partner": "-1", "quota_s5_intent": "x"}, 40)
    assert set(errors) == {"quota_s4_partner", "quota_s5_intent"}
    assert settings.strategy_form({"per_day": "5"}, 20) == ({}, {})   # a client without the fieldset changes nothing


@pytest.fixture()
def live():
    db = seeded_db()
    srv = server.make_server(db=db, port=0, demo=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv, db
    srv.shutdown(); srv.server_close()


GOOD = {"per_day": "40", "segments": ["industrial", "smb_software"], "daily_budget": "300", "daily_cap": "25",
        "quota_s2_trigger": "7", "quota_s3_regulation": "3", "quota_s4_partner": "6", "quota_s5_intent": "5", "quota_s7_orphaned": "6",
        "quota_s8_tradeshow": "5", "quota_s9_crowdfund": "4", "quota_s10_accelerator": "4",
        "pin_s4_partner": "1", "markets": "us, gb, de", "auto_rebalance": "1"}


def post(srv, fields):
    flat = []
    for k, v in {**fields, "csrf": srv.app.csrf}.items():
        flat += [(k, x) for x in (v if isinstance(v, list) else [v])]
    return call(srv, "POST", "/act/settings", urlencode(flat), {"Content-Type": "application/x-www-form-urlencoded"})


def test_settings_page_has_the_strategies_fieldset(live):
    s, body, _ = call(live[0], "GET", "/settings")
    assert s == 200 and '<fieldset class="setcard wide strat-set"' in body and "<legend" in body
    for sid in IDS:
        assert f'name="quota_{sid}"' in body and f'name="pin_{sid}"' in body
    assert 'name="auto_rebalance"' in body and re.search(r'name="auto_rebalance" value="1" checked', body)
    assert 'name="quota_s2_trigger" type="number" inputmode="numeric" min="0" max="50" step="1" value="6"' in body


def test_saving_strategy_settings_and_total_over_per_day_is_refused(live):
    srv, db = live
    assert post(srv, GOOD)[0] == 303
    assert settings.quotas(db)["s2_trigger"] == 7 and settings.pinned(db) == ["s4_partner"]
    s, body, _ = post(srv, {**GOOD, "per_day": "10"})                     # quotas add up to 40 > 10
    assert s == 422 and "Quotas add up to 40" in body and "Nothing was saved" in body
    assert 'name="quota_s2_trigger"' in body and 'value="7"' in body       # the submitted values come back
    assert settings.per_day(db) == 40                                       # nothing saved
    s, body, _ = post(srv, {**GOOD, "quota_s3_regulation": "abc", "auto_rebalance": []})
    assert s == 422 and "Enter a whole number from 0 to 50" in body and 'value="abc"' in body
    assert post(srv, {k: v for k, v in GOOD.items() if k != "auto_rebalance"})[0] == 303
    assert settings.auto_rebalance(db) is False


def test_save_settings_without_the_fieldset_leaves_strategy_settings_alone():
    db = FakeDB()
    settings.set(db, "strategy.quotas", {**DEFAULT, "s2_trigger": 9})
    res = actions.save_settings(db, {"per_day": "40", "segments": ["industrial"], "daily_budget": "300", "daily_cap": "25"})
    assert res["ok"] and settings.quotas(db)["s2_trigger"] == 9


# ---------------------------------------------------------------- dashboard

def test_health_page_shows_the_strategies_block(live):
    srv, db = live
    now = datetime.now(timezone.utc)
    _seed_week(db, now, {"s2_trigger": (10, 2), "legacy": (5, 1)})
    db.insert("actions", {"agent": "prospector", "action": "quota_rebalanced", "at": now.isoformat(),
                          "detail": {"from": "s3_regulation", "to": "s2_trigger", "moved": 2}})
    s, body, _ = call(srv, "GET", "/health")
    assert s == 200 and "Strategies · last 30 days" in body
    sect = body.split('aria-labelledby="strat"')[1].split("</section>")[0]
    for name in ("Trigger events", "Regulation", "Partners", "Outsourcing intent", "Legacy (segment search)"):
        assert name in sect
    for col in ("Quota / day", "Created", "Sent", "Replies", "Positive", "Reply %", "Positive %", "Won"):
        assert col in sect
    assert "20%" in sect and "Next rebalance:" in sect and "2 from Regulation to Trigger events" in sect
    data_off = data.strategies_block(db, now)
    assert [r["id"] for r in data_off["rows"]][:8] == IDS


def test_health_block_auto_rebalance_off_and_pinned_tag():
    db = FakeDB()
    settings.set(db, "strategy.auto_rebalance", False)
    settings.set(db, "strategy.pinned", ["s5_intent"])
    b = data.strategies_block(db, NOW)
    assert "Auto-rebalance is off" in b["note"] and [r["pinned"] for r in b["rows"]] == [False, False, False, True, False, False, False, False]
    html = views.strategies_section(b)
    assert "PINNED" in html and html.count("<tr>") == 9 and "legacy" not in html.lower()


def test_pipeline_rows_carry_a_strategy_tag(live):
    srv, db = live
    co_id = db.insert("companies", {"name": "TagCo", "domain": "tagco.example.com", "strategy": "s4_partner"})[0]["id"]
    db.insert("deals", {"company_id": co_id, "title": "Partner deal", "source_channel": "outbound", "strategy": "s4_partner"})
    db.insert("deals", {"company_id": co_id, "title": "Older deal", "source_channel": "outbound", "strategy": "legacy"})
    s, body, _ = call(srv, "GET", "/pipeline")
    assert s == 200 and 'class="tag out st" title="S4 strategy: s4_partner">S4<' in body and ">LEGACY<" in body
    row = next(r for r in data.pipeline(db, NOW, None)["groups"]["lead"] if r["title"] == "Partner deal")
    assert row["strategy"] == "s4_partner"
    assert views.strategy_tag("") == ""


def test_css_block_uses_tokens_only():
    css = (server.Path(server.__file__).parent / "static" / "dashboard.css").read_text()
    block = css.split("/* strategies */")[1].split("/* opportunities */")[0]
    assert "#" not in block and "rgb" not in block   # no hard-coded colours: both themes come from the tokens


# ---------------------------------------------------------------- markets (anywhere we can get paid)

def test_default_markets_and_always_excluded():
    d = set(settings.DEFAULT_MARKETS)
    assert {"US", "CA", "MX", "BR", "CL", "GB", "IE", "DE", "NO", "IS", "CH", "TR", "IL", "AE", "SA", "QA", "KW", "BH", "OM", "JO",
            "EG", "MA", "ZA", "KE", "NG", "SG", "MY", "ID", "TH", "VN", "PH", "HK", "TW", "JP", "KR", "AU", "NZ"} <= d
    assert not d & settings.ALWAYS_EXCLUDED and "IN" not in d and settings.ALWAYS_EXCLUDED == {"PK", "IR", "KP", "SY", "CU", "RU", "BY"}
    assert len([c for c in d if c in P.EU]) == 27   # every EU member state
    assert settings.markets(FakeDB()) == list(settings.DEFAULT_MARKETS)


def test_markets_setting_validation_drops_excluded_codes():
    assert settings.validate("prospector.markets", "us, gb;de pk RU") == ["US", "GB", "DE"]
    assert settings.validate("prospector.markets", ["fr", "FR", " it "]) == ["FR", "IT"]
    for bad in ("", "pk, ru", "usa", "us, 12", 5):
        with pytest.raises(settings.SettingsError):
            settings.validate("prospector.markets", bad)
    clean, errors = settings.strategy_form({**{f"quota_{k}": str(v) for k, v in DEFAULT.items()}, "markets": "us, gb, pk"}, 40)
    assert errors == {} and clean["prospector.markets"] == ["US", "GB"]
    assert settings.strategy_form({**{f"quota_{k}": "1" for k in IDS}, "markets": "zzz"}, 40)[1] == {
        "markets": "'zzz' is not a two-letter country code."}


def test_prospect_market_check_follows_the_setting_and_never_allows_pakistan():
    assert val({"country": "BR"})[0] and val({"country": "KE"})[0] and val({"country": "IN"})[1] == "outside target markets"
    assert val({"country": "PK"})[1] == "outside target markets"
    assert val({"country": "PK"}, markets=["PK", "US"])[1] == "outside target markets"   # even if somebody lists it
    assert val({"country": "RU"}, markets=["RU"])[1] == "outside target markets"
    assert val({"country": "FR"}, markets=["US"])[1] == "outside target markets"
    assert val({"country": "FR"}, markets=["FR"])[0]


def test_run_uses_the_markets_setting_and_tells_the_model():
    db = FakeDB()
    settings.set(db, "strategy.quotas", only({"s2_trigger": 3}))
    settings.set(db, "prospector.markets", ["DE", "NL"])
    fake = FakeLLM([co(1, country="DE"), co(2, country="US")])
    r = go(db, fake, strategy="s2_trigger")
    assert r["created"] == 1 and r["invalid"] == 1
    assert "(ISO codes) , where" not in fake.research_calls[0]["system"] and ": DE, NL." in fake.research_calls[0]["system"]


def test_settings_form_carries_markets(live):
    srv, db = live
    _, body, _ = call(srv, "GET", "/settings")
    assert 'name="markets"' in body and "US, CA, MX, BR" in body and "never allowed" not in body
    assert post(srv, {**GOOD, "markets": "au, nz, pk"})[0] == 303 and settings.markets(db) == ["AU", "NZ"]
    s, body, _ = post(srv, {**GOOD, "markets": "xx1"})
    assert s == 422 and "not a two-letter country code" in body and 'value="xx1"' in body


def test_niche_strategies_s7_to_s10():
    assert IDS[4:] == ["s7_orphaned", "s8_tradeshow", "s9_crowdfund", "s10_accelerator"]
    assert settings.DEFAULT_QUOTAS == DEFAULT and sum(DEFAULT.values()) == settings.DEFAULTS["prospector.per_day"] == 40
    assert "shut" in strat.get("s7_orphaned").brief and "decode" in strat.get("s7_orphaned").angle
    assert "Embedded World" in strat.get("s8_tradeshow").brief and "GITEX" in strat.get("s8_tradeshow").brief and "show" in strat.get("s8_tradeshow").angle
    assert "Kickstarter" in strat.get("s9_crowdfund").brief and "Crowd Supply" in strat.get("s9_crowdfund").brief
    assert "HAX" in strat.get("s10_accelerator").brief and "Greentown" in strat.get("s10_accelerator").brief
    assert settings.validate("prospector.per_day", 80) == 80


def test_s8_allows_future_show_dates_but_others_do_not():
    soon = (TODAY + timedelta(days=90)).isoformat()
    assert val({"evidence_date": soon, "trigger_type": "tradeshow"}, "s8_tradeshow")[0]
    assert val({"evidence_date": (TODAY + timedelta(days=300)).isoformat(), "trigger_type": "tradeshow"}, "s8_tradeshow")[1] == "evidence dated in the future"
    assert val({"evidence_date": (TODAY - timedelta(days=60)).isoformat(), "trigger_type": "tradeshow"}, "s8_tradeshow")[1].startswith("evidence is 60 days old")
    assert val({"evidence_date": "", "trigger_type": "tradeshow"}, "s8_tradeshow")[1] == "trigger without a date"
    assert val({"evidence_date": soon}, "s2_trigger")[1] == "evidence dated in the future"


def test_s9_needs_a_recent_update_and_not_the_platform_domain():
    ok = {"trigger_type": "crowdfunding", "evidence_date": RECENT, "evidence_url": "https://www.kickstarter.com/projects/x/y/posts/1"}
    assert val(ok, "s9_crowdfund")[0]
    assert val({**ok, "domain": "kickstarter.com"}, "s9_crowdfund")[1] == "bad domain"
    assert val({**ok, "evidence_date": (TODAY - timedelta(days=200)).isoformat()}, "s9_crowdfund")[1].startswith("evidence is 200 days old")


def test_s7_and_s10_validate_and_store_their_strategy():
    for sid, tt in (("s7_orphaned", "orphaned"), ("s10_accelerator", "cohort")):
        db = FakeDB()
        settings.set(db, "strategy.quotas", only({sid: 2}))
        r = go(db, FakeLLM([co(1, strategy=sid, trigger_type="funding")]), strategy=sid)
        assert r["created"] == 0   # a trigger type the strategy does not accept is rejected
        raw = co(1, strategy=sid, trigger_type=tt, evidence_date=RECENT)
        r = go(db, FakeLLM([raw]), strategy=sid)
        assert r["created"] == 1 and db.rows("companies")[0]["strategy"] == sid and db.rows("deals")[0]["strategy"] == sid
        assert dossier_has(db, sid)


def dossier_has(db, sid):
    return f"({sid})" in db.rows("dossiers")[0]["body_md"]


def test_every_new_strategy_prompt_composes():
    for sid in IDS[4:]:
        db, fake = FakeDB(), FakeLLM()
        settings.set(db, "strategy.quotas", only({sid: 3}))
        go(db, fake, strategy=None)
        sys_ = fake.research_calls[0]["system"]
        assert "{{" not in sys_ and strat.get(sid).brief[:60] in sys_ and f"strategy: exactly \"{sid}\"" in sys_
