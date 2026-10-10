import httpx
import pytest

from core import mail
from core.db import DB


def db_with(rows, seen=None):
    def handler(req: httpx.Request):
        if seen is not None:
            seen.append(req)
        return httpx.Response(200, json=rows)
    return DB(key="k", transport=httpx.MockTransport(handler))


def test_claim_one_row():
    seen = []
    row = db_with([{"id": "1", "status": "sending"}], seen).claim(
        "approval_queue", "1", ["approved", "edited_approved"], "sending")
    assert row["id"] == "1"
    r = seen[0]
    assert r.method == "PATCH" and r.url.params["id"] == "eq.1"
    assert r.url.params["status"] == "in.(approved,edited_approved)"
    assert r.headers["prefer"] == "return=representation"
    assert r.headers["apikey"] == "k" and r.headers["authorization"] == "Bearer k"


def test_claim_zero_rows():
    assert db_with([]).claim("approval_queue", "1", ["approved"], "sending") is None


def test_update_requires_filter():
    with pytest.raises(Exception):
        db_with([]).update("t", {"a": 1})


def test_retry_on_network_error_only():
    n = {"c": 0}

    def handler(req):
        n["c"] += 1
        if n["c"] == 1:
            raise httpx.ConnectError("x")
        return httpx.Response(200, json=[])
    assert DB(key="k", transport=httpx.MockTransport(handler)).select("t") == []
    assert n["c"] == 2
    n["c"] = 0
    with pytest.raises(Exception):
        DB(key="k", transport=httpx.MockTransport(lambda r: httpx.Response(500, text="no"))).select("t")


def test_select_filter_ops():
    seen = []
    db_with([], seen).select("actions", action="llm_call", at="gte.2026-01-01", select="id")
    p = seen[0].url.params
    assert p["action"] == "eq.llm_call" and p["at"] == "gte.2026-01-01" and p["select"] == "id"


def test_message_id_required():
    with pytest.raises(ValueError):
        mail.build({"to": "a@b.com", "subject": "s", "body": "b"})


def test_build_headers():
    m = mail.build({"to": "a@b.com", "subject": "Re: s", "body": "b", "message_id": "<x@epsilon-labs.co>",
                    "in_reply_to": "<p@b.com>", "references": "<o@b.com>"})
    assert m["Message-ID"] == "<x@epsilon-labs.co>" and m["In-Reply-To"] == "<p@b.com>"
    assert m["References"] == "<o@b.com> <p@b.com>" and m["From"] == "er@epsilon-labs.co"
