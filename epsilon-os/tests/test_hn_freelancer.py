"""S13: the Hacker News "Freelancer? Seeking freelancer?" feed on recorded, sanitised HN Algolia responses
(tests/fixtures/hn), and the prospector flow that scores its posts with a tool-less model. No network."""
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import jsonschema
import pytest

from agents import prospector as P
from core import settings
from core.feeds import base, hn_freelancer as hn
from prompts import strategies as strat
from tests.fakes import FakeDB
from tests.test_prospector import FakeLLM, go, only

FX = Path(__file__).parent / "fixtures" / "hn"
JULY = {"objectID": "44434575", "title": "Ask HN: Freelancer? Seeking freelancer? (July 2025)"}
NOW = datetime(2025, 7, 10, 5, 0, tzinfo=timezone.utc)   # the recorded July 2025 thread is current at this date


def fx(name):
    return json.loads((FX / name).read_text())


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(base, "_sleep", lambda s: None)


def july():
    return hn.candidates(JULY, fx("comments_44434575.json")["hits"])


# ---------------------------------------------------------------- feed

def test_pick_thread_takes_the_newest_month_and_its_busiest_thread():
    hits = fx("thread_search.json")["hits"]
    assert hn.pick_thread(hits)["objectID"] == "49922572"                       # October 2026
    sept = [h for h in hits if "September 2026" in h["title"]]
    assert len(sept) == 2 and hn.pick_thread(sept)["num_comments"] == max(h["num_comments"] for h in sept)
    assert hn.pick_thread([{"objectID": "1", "title": "Ask HN: Who is hiring? (October 2026)"},
                           {"objectID": "2", "title": "Ask HN: Freelancer? Seeking freelancer? (October 2026) [fake]"}]) is None


def test_fetch_uses_the_official_algolia_api_and_a_month_without_seekers_gives_nothing():
    seen = []

    def handler(req):
        seen.append(req)
        if req.url.params.get("tags") == "story":
            return httpx.Response(200, json=fx("thread_search.json"))
        assert req.url.params["tags"] == "comment,story_49922572" and req.url.params["hitsPerPage"] == "1000"
        return httpx.Response(200, json=fx("comments_49922572.json"))
    client = httpx.Client(transport=httpx.MockTransport(handler), headers={"User-Agent": base.USER_AGENT})
    assert hn.fetch_candidates(client) == []      # October 2026: only SEEKING WORK posts and a reply
    assert [r.url.host for r in seen] == ["hn.algolia.com"] * 2
    assert all(r.url.path == "/api/v1/search_by_date" for r in seen)
    assert seen[0].url.params["query"] == '"Seeking freelancer"'


def test_fetch_fails_loudly_on_an_unexpected_response():
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"oops": 1})))
    with pytest.raises(base.FeedError):
        hn.fetch_candidates(client)


def test_candidates_are_top_level_seeking_freelancer_posts_that_match_our_work():
    got = july()
    assert [c["post_id"] for c in got] == ["44440980", "44440402", "44435625"]   # the model sorts out mislabelled freelancers
    hexa = got[2]
    assert hexa["matched"] == ["ai"] and hexa["domains"] == ["wehexa.com"] and hexa["emails"] == ["hiring@wehexa.com"]
    assert hexa["url"] == "https://news.ycombinator.com/item?id=44435625" and hexa["posted_on"] == "2025-07-01"
    assert hexa["text"].startswith("SEEKING FREELANCER | Backend Engineer | London or Remote (EU)")
    texts = " ".join(c["text"] for c in got)
    assert "SEEKING WORK" not in texts and "Ruby on Rails" not in texts       # wrong kind of post, wrong kind of work


def test_domains_skip_docs_and_freemail_hosts():
    doms, emails = hn.domains_and_emails('See <a href="https:&#x2F;&#x2F;docs.google.com&#x2F;d">doc</a> and '
                                         'https://www.acme-robotics.io/jobs, mail jo@gmail.com or ops@acme-robotics.io')
    assert doms == ["acme-robotics.io"] and emails == ["jo@gmail.com", "ops@acme-robotics.io"]
    assert hn.matches("We need STM32 firmware and a BLE companion app") == ["embedded", "firmware", "iot", "apps"]


# ---------------------------------------------------------------- S13 in the prospector

class HNLLM(FakeLLM):
    """FakeLLM plus the S13 scoring call. `posts` maps post_id -> the model's answer for it."""

    def __init__(self, posts, **kw):
        super().__init__(**kw)
        self.posts, self.hn_calls = posts, []

    def ask(self, db, agent, run_id, system, untrusted, schema, model="haiku", timeout=120):
        if "posts" not in schema["properties"]:
            return super().ask(db, agent, run_id, system, untrusted, schema, model, timeout)
        self.hn_calls.append({"system": system, "untrusted": untrusted, "model": model})
        sent = json.loads(untrusted)
        out = {"posts": [self.posts[p["post_id"]] | {"post_id": p["post_id"]} for p in sent if p["post_id"] in self.posts],
               "notes": ""}
        jsonschema.validate(out, schema)
        return out, {}


def answer(**kw):
    a = {"keep": True, "name": "Hexa", "domain": "wehexa.com", "country": "GB", "sector": "enterprise software",
         "segment": "smb_software", "trigger": "Asked on HN for a backend engineer with LLM API integration experience.",
         "observation": "Hexa posted in the HN freelancer thread for a backend engineer to integrate LLM APIs.",
         "suggested_offer_slug": "ops-analyst", "confidence": 0.8, "reason": "named company, own site, AI work"}
    a.update(kw)
    return a


def run_s13(llm, cands=None, **kw):
    db = FakeDB()
    settings.set(db, "strategy.quotas", only({"s13_hn": 5}))
    r = go(db, llm, strategy="s13_hn", now=kw.pop("now", NOW), hn_fetch=lambda: july() if cands is None else cands, **kw)
    return db, r


def test_s13_scores_posts_in_untrusted_text_and_creates_the_prospect():
    llm = HNLLM({"44435625": answer(), "44440402": answer(keep=False, name="", domain="", country="US",
                                                          reason="a freelancer offering work, not a company")})
    db, r = run_s13(llm)
    assert len(llm.hn_calls) == 1 and llm.hn_calls[0]["model"] == "haiku"
    call = llm.hn_calls[0]
    assert "<untrusted>" in call["system"] and "SEEKING FREELANCER |" not in call["system"]   # post text is data only
    assert "Hexa is building" in call["untrusted"] and llm.research_calls[0]["task"].startswith("Find the published contact")
    assert r["created"] == 1 and r["by_strategy"]["s13_hn"]["invalid"] == 1
    co = db.rows("companies")[0]
    assert co["strategy"] == "s13_hn" and co["domain"] == "wehexa.com" and co["country"] == "GB"
    deal = db.rows("deals")[0]
    assert deal["strategy"] == "s13_hn"
    src = db.rows("dossiers")[0]["sources"][0]
    assert src["url"] == "https://news.ycombinator.com/item?id=44435625" and src["quote"].startswith("SEEKING FREELANCER")
    assert "(s13_hn)" in db.rows("dossiers")[0]["body_md"]
    # hiring@ is a hiring inbox: no draft until a business address is found on the company site
    assert r["no_contact"] == 1 and r["drafts"] == 0


def test_s13_code_holds_the_model_to_the_post():
    cases = {
        "domain not among the post's own links": answer(domain="hexa-ai.com"),
        "outside target markets": answer(country="PK"),
        "missing field": answer(name=""),
    }
    for why, a in cases.items():
        db, r = run_s13(HNLLM({"44435625": a}))
        assert r["created"] == 0, why
        assert any(d["detail"]["reason"] == why for d in db.rows("actions", action="prospect_dropped")), why


def test_s13_drops_stale_posts_and_survives_a_broken_feed():
    db, r = run_s13(HNLLM({"44435625": answer()}), now=datetime(2025, 9, 20, 5, 0, tzinfo=timezone.utc))
    assert r["created"] == 0 and r["by_strategy"]["s13_hn"]["invalid"] == 1   # 81 days old, limit 45

    def broken():
        raise base.FeedError("hn: unexpected thread search response")
    db = FakeDB()
    settings.set(db, "strategy.quotas", only({"s13_hn": 5}))
    r = go(db, HNLLM({}), strategy="s13_hn", now=NOW, hn_fetch=broken)
    assert r["research_failed"] == 1 and r["created"] == 0
    assert db.rows("actions", action="research_failed")[0]["detail"]["strategy"] == "s13_hn"


def test_s13_known_domains_are_not_sent_to_the_model():
    db = FakeDB()
    db.insert("companies", {"name": "Hexa", "domain": "wehexa.com"})
    db.insert("companies", {"name": "Alonso", "domain": "alonso.network"})
    settings.set(db, "strategy.quotas", only({"s13_hn": 5}))
    llm = HNLLM({})
    go(db, llm, strategy="s13_hn", now=NOW, hn_fetch=july)
    assert llm.hn_calls == []


def test_s11_s12_s13_are_software_strategies_with_the_asked_for_rules():
    assert settings.SOFTWARE_STRATEGIES == ("s11_software", "s12_devpartner", "s13_hn")
    s11, s12, s13 = strat.get("s11_software"), strat.get("s12_devpartner"), strat.get("s13_hn")
    assert s11.max_age_days == 120 and s11.max_headcount == 300 and "ops-software-build" in s11.offers
    assert "spreadsheets" in s11.brief and "Series A" in s11.brief and "new sites" in s11.brief and "internal-tools" in s11.brief
    assert "SaaS" in s11.buyer_rules and "over 300 staff" in s11.buyer_rules and "agencies" in s11.buyer_rules
    assert s12.max_age_days == 90 and "anonymous" in s12.buyer_rules and "recruiters" in s12.buyer_rules
    assert s13.max_age_days == 45 and "SEEKING FREELANCER" in s13.brief
    big = {"headcount": 450, "trigger_type": "tooling_switch"}
    from tests.test_strategies import val
    assert val(big, "s11_software")[1] == "450 staff (limit 300)"
    assert val({"headcount": 120, "trigger_type": "tooling_switch"}, "s11_software")[0]
    assert val({"trigger_type": "rfq", "evidence_date": ""}, "s12_devpartner")[1] == "trigger without a date"
