"""In-memory fakes with the same interface as core.db.DB and the core.mail adapter."""
import copy
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from core import mail
from core.db import DB, DBError

UNIQUE = {"touches": ["message_id"], "contacts": ["email"], "companies": ["domain"],
          "suppression_list": ["email"]}
CITEXT = {"email", "domain", "to_email"}
RAW = {"select", "order", "limit", "offset"}
_OP = re.compile(r"^(eq|neq|gt|gte|lt|lte|in|is|like|ilike)\.(.*)$", re.S)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_in(v: str) -> list[str]:
    inner = v[v.index("(") + 1: v.rindex(")")]
    return [x.strip().strip('"') for x in re.findall(r'"[^"]*"|[^,]+', inner)]


def _dt(x):
    if isinstance(x, str) and re.match(r"^\d{4}-\d\d-\d\dT", x):
        return datetime.fromisoformat(x)
    return None


def _norm(x):
    return str(x).lower() if x is not None else None


def _match_one(col: str, rowval, op: str, val: str) -> bool:
    if op == "is":
        return (rowval is None) if val == "null" else _norm(rowval) == val.lower()
    if op == "in":
        return _norm(rowval) in {v.lower() for v in _parse_in(val)}
    if rowval is None:
        return False
    if op in ("gt", "gte", "lt", "lte"):
        a, b = _dt(rowval), _dt(val)
        if a is None or b is None:
            a, b = rowval, val
        return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]
    if op in ("like", "ilike"):  # PostgREST uses * as the wildcard in URLs
        pat = "^" + ".*".join(re.escape(part) for part in val.split("*")) + "$"
        return re.search(pat, str(rowval), re.S | (re.I if op == "ilike" else 0)) is not None
    eq = _norm(rowval) == val.lower()
    return eq if op == "eq" else (not eq if op == "neq" else False)


class FakeDB:
    """Same public surface as core.db.DB: select / insert / update / rpc / claim."""

    def __init__(self):
        self.t: dict[str, list[dict]] = {}
        self.lock = threading.RLock()
        self.log: list[tuple] = []

    # -- helpers
    def rows(self, table: str, **eq) -> list[dict]:
        return [copy.deepcopy(r) for r in self.t.get(table, []) if all(r.get(k) == v for k, v in eq.items())]

    def _matches(self, row: dict, filters: dict) -> bool:
        for col, spec in DB._params(filters).items():
            if col in RAW:
                continue
            m = _OP.match(spec)
            if not m or not _match_one(col, row.get(col), m.group(1), m.group(2)):
                return False
        return True

    def _defaults(self, table: str, row: dict) -> dict:
        r = dict(row)
        r.setdefault("id", str(uuid.uuid4()))
        r.setdefault("created_at", _now())
        if table == "approval_queue":
            r.setdefault("status", "pending")
            r.setdefault("held", False)
            r.setdefault("claimed_at", None)
            r.setdefault("decided_at", None)
        if table == "agent_heartbeats":
            r.setdefault("last_run", _now())
            r.setdefault("status", "ok")
        if table == "actions":
            r.setdefault("at", _now())
        if table == "jobs":
            r.setdefault("status", "queued")
            r.setdefault("attempts", 0)
            r.setdefault("params", {})
        if table == "contacts":
            r.setdefault("opted_out", False)
        if table == "deals":
            r.setdefault("stage", "lead")
        if table == "touches":
            r.setdefault("occurred_at", _now())
        return r

    # -- DB interface
    def select(self, table: str, **filters):
        with self.lock:
            out = [copy.deepcopy(r) for r in self.t.get(table, []) if self._matches(r, filters)]
            order = filters.get("order")
            if order:
                col, _, direction = order.partition(".")
                out.sort(key=lambda r: (r.get(col) is None, r.get(col)), reverse=direction == "desc")
            if "offset" in filters:
                out = out[int(filters["offset"]):]
            if "limit" in filters:
                out = out[: int(filters["limit"])]
            return out

    def insert(self, table: str, rows, returning: bool = True):
        with self.lock:
            batch = rows if isinstance(rows, list) else [rows]
            made = []
            for raw in batch:
                r = self._defaults(table, raw)
                for col in UNIQUE.get(table, []):
                    if r.get(col) is not None and any(
                            _norm(x.get(col)) == _norm(r[col]) for x in self.t.get(table, [])):
                        raise DBError(f"POST /{table}: HTTP 409 duplicate key {col}")
                self.t.setdefault(table, []).append(r)
                made.append(copy.deepcopy(r))
            return made if returning else []

    def update(self, table: str, values: dict, **filters):
        if not filters:
            raise DBError("update without filters refused")
        with self.lock:
            hit = [r for r in self.t.get(table, []) if self._matches(r, filters)]
            for r in hit:
                r.update(copy.deepcopy(values))
            return copy.deepcopy(hit)

    def rpc(self, fn: str, args: dict | None = None):
        if fn == "is_suppressed":
            addr = _norm((args or {}).get("addr"))
            return any(_norm(r["email"]) == addr for r in self.t.get("suppression_list", []))
        impl = getattr(self, "_rpc_" + fn, None)
        if impl is None:
            raise DBError(f"unknown rpc {fn}")
        with self.lock:
            self.log.append(("rpc", fn, copy.deepcopy(args or {})))
            return copy.deepcopy(impl(**(args or {})))

    # -- migration 011 rulebook, as the worker's service role calls it (same checks and results as the SQL; the SQL
    #    itself is tested against Postgres in test_rulebook_migration.py)
    def _aq(self, qid):
        return next((r for r in self.t.get("approval_queue", []) if r["id"] == qid), None)

    def _audit(self, action, qid, detail, at, table="approval_queue"):
        self.t.setdefault("actions", []).append(self._defaults("actions", {
            "agent": "dashboard", "run_id": str(uuid.uuid4()), "action": action, "target_table": table,
            "target_id": qid, "detail": detail, "at": at}))

    @staticmethod
    def _deck_norm(s):
        return re.sub(r"\s+", " ", (s or "").lower()).strip().strip(" .!?,;:")

    @staticmethod
    def _fail(code, message, **kw):
        return {"ok": False, "error": code, "message": message, **kw}

    def _rpc_approve_draft(self, p_id, p_confirm_lint=False, p_lint=None, p_now=None):
        now = p_now or _now()
        r = self._aq(p_id)
        if not r:
            return self._fail("not_found", "Draft not found.")
        if r["status"] != "pending":
            return self._fail("not_pending", f"Already {r['status']}.")
        if r.get("held"):
            return self._fail("held", "This draft is held. Release it to the deck first.")
        edit = r.get("final_text") is not None
        if not ((r.get("final_text") if edit else r.get("draft")) or "").strip():
            return self._fail("empty", "Draft is empty. Write something before sending.")
        hits = r.get("lint") if isinstance(r.get("lint"), list) else (p_lint if isinstance(p_lint, list) else None)
        if hits is None:
            r.update(status="edited_pending_lint", decided_at=now, material_edit=None)
            self._audit("approve", p_id, {"edited": edit, "pending_lint": True, "confirmed_lint": False}, now)
            return {"ok": True, "status": "edited_pending_lint", "edited": edit, "diff": None, "decided_at": now,
                    "undo_seconds": 10}
        if hits and not p_confirm_lint:
            return self._fail("lint_confirm_required", "Draft has lint warnings. Confirm to send anyway.", lint=hits)
        status = "edited_approved" if edit else "approved"
        material = bool((r.get("diff") or {}).get("material")) if edit else False
        r.update(status=status, decided_at=now, final_text=r.get("final_text") if edit else None,
                 diff=r.get("diff") if edit else None, material_edit=material)
        self._audit("approve", p_id, {"edited": edit, "lint_hits": len(hits), "confirmed_lint": bool(hits),
                                      "material_edit": material}, now)
        return {"ok": True, "status": status, "edited": edit, "diff": r.get("diff") if edit else None,
                "decided_at": now, "undo_seconds": 10}

    def _rpc_edit_and_approve_draft(self, p_id, p_body, p_confirm_lint=False, p_lint=None, p_diff=None, p_now=None):
        now = p_now or _now()
        r = self._aq(p_id)
        if not r:
            return self._fail("not_found", "Draft not found.")
        if r["status"] != "pending":
            return self._fail("not_pending", f"Already {r['status']}.")
        if r.get("held"):
            return self._fail("held", "This draft is held. Release it to the deck first.")
        if self._deck_norm(p_body) == self._deck_norm(r.get("draft")):
            r.update(final_text=None, diff=None)
            return self._rpc_approve_draft(p_id, p_confirm_lint, p_lint, p_now)
        text = (p_body or "").strip()
        if not text:
            return self._fail("empty", "Draft is empty. Write something before sending.")
        if not isinstance(p_lint, list):
            r.update(status="edited_pending_lint", decided_at=now, final_text=text, diff=None, material_edit=None)
            self._audit("approve", p_id, {"edited": True, "pending_lint": True, "confirmed_lint": False}, now)
            return {"ok": True, "status": "edited_pending_lint", "edited": True, "diff": None, "decided_at": now,
                    "undo_seconds": 10}
        if p_lint and not p_confirm_lint:
            return self._fail("lint_confirm_required", "Draft has lint warnings. Confirm to send anyway.", lint=p_lint)
        material = bool((p_diff or {}).get("material"))
        r.update(status="edited_approved", decided_at=now, final_text=text, diff=p_diff, material_edit=material,
                 lint=p_lint)
        self._audit("approve", p_id, {"edited": True, "lint_hits": len(p_lint), "confirmed_lint": bool(p_lint),
                                      "material_edit": material}, now)
        return {"ok": True, "status": "edited_approved", "edited": True, "diff": p_diff, "decided_at": now,
                "undo_seconds": 10}

    def _rpc_undo_decision(self, p_id, p_now=None):
        now = datetime.fromisoformat(p_now) if p_now else datetime.now(timezone.utc)
        r = self._aq(p_id)
        if r and r["status"] in ("approved", "edited_approved", "edited_pending_lint") and r.get("decided_at") and \
                datetime.fromisoformat(str(r["decided_at"])) >= now - timedelta(seconds=10):
            r.update(status="pending", decided_at=None, final_text=None, diff=None, material_edit=None)
            self._audit("undo", p_id, None, now.isoformat())
            return {"ok": True}
        if not r:
            return self._fail("not_found", "Draft not found.")
        if r["status"] == "pending":
            return {"ok": True, "already": True}
        return self._fail("too_late", "Too late, already sending.")

    def _rpc_reject_draft(self, p_id, p_reason=None, p_now=None):
        now = p_now or _now()
        r = self._aq(p_id)
        if not r:
            return self._fail("not_found", "Draft not found.")
        if r["status"] != "pending":
            return self._fail("not_pending", f"Already {r['status']}.")
        r.update(status="rejected", decided_at=now)
        self._audit("reject", p_id, {"reason": (p_reason or "").strip()[:300] or None}, now)
        return {"ok": True}

    def _rpc_hold_draft(self, p_id, p_now=None):
        r = self._aq(p_id)
        if not r:
            return self._fail("not_found", "Draft not found.")
        if r["status"] != "pending":
            return self._fail("not_pending", f"Already {r['status']}.")
        self._audit("later", p_id, None, p_now or _now())
        return {"ok": True}

    def _rpc_release_held_draft(self, p_id):
        r = self._aq(p_id)
        if not r or r["status"] != "pending" or not r.get("held"):
            return self._fail("not_held", "Not a held draft.")
        r["held"] = False
        self._audit("release_held", p_id, {"was": r.get("held_reason")}, _now())
        return {"ok": True}

    def _rpc_complete_draft_lint(self, p_id, p_lint, p_diff=None):
        r = self._aq(p_id)
        if not r:
            return self._fail("not_found", "Draft not found.")
        if r["status"] != "edited_pending_lint":
            return self._fail("not_pending_lint", f"Already {r['status']}.")
        edited = r.get("final_text") is not None
        if not p_lint:
            r.update(status="edited_approved" if edited else "approved", lint=p_lint, diff=p_diff if edited else None,
                     material_edit=bool((p_diff or {}).get("material")) if edited else False)
            self._audit("lint_passed", p_id, {"edited": edited}, _now())
            return {"ok": True, "status": r["status"]}
        reason = "lint: " + ", ".join(sorted({h.get("type") or "?" for h in p_lint}))
        r.update(status="pending", held=True, held_reason=reason, lint=p_lint, diff=p_diff, decided_at=None,
                 material_edit=None)
        self._audit("lint_held", p_id, {"lint_hits": len(p_lint), "reason": reason}, _now())
        return {"ok": True, "status": "held", "held_reason": reason, "lint": p_lint}

    # jobs (claim_jobs / finish_job): queued -> claimed with a lease; lapsed lease retried once, then failed
    def _rpc_claim_jobs(self, p_types, p_lease_seconds=300, p_limit=5, p_now=None):
        now = datetime.fromisoformat(p_now) if p_now else datetime.now(timezone.utc)
        jobs = self.t.setdefault("jobs", [])
        for j in jobs:
            if j["status"] == "queued" and j.get("expires_at") and datetime.fromisoformat(j["expires_at"]) < now:
                j.update(status="expired", finished_at=now.isoformat())
            lapsed = j["status"] in ("claimed", "running") and j.get("lease_until") and \
                datetime.fromisoformat(j["lease_until"]) < now
            if lapsed and j.get("attempts", 0) >= 2:
                j.update(status="failed", finished_at=now.isoformat(), error="lease lapsed (worker stopped) and the retry also lapsed")
            elif lapsed:
                j.update(status="queued", lease_until=None)
        out = []
        for j in sorted(jobs, key=lambda x: x["created_at"]):
            if len(out) >= p_limit:
                break
            if j["status"] == "queued" and j["type"] in p_types:
                j.update(status="claimed", lease_until=(now + timedelta(seconds=p_lease_seconds)).isoformat(),
                         attempts=j.get("attempts", 0) + 1, started_at=j.get("started_at") or now.isoformat())
                out.append(dict(j))
        return out

    def _rpc_finish_job(self, p_id, p_ok, p_result=None, p_error=None):
        j = next((x for x in self.t.get("jobs", []) if x["id"] == p_id and x["status"] in ("claimed", "running")), None)
        if not j:
            return False
        j.update(status="done" if p_ok else "failed", finished_at=_now(), lease_until=None, result=p_result,
                 error=(p_error or None) and p_error[:1000])
        return True

    def claim(self, table: str, id: str, from_statuses: list[str], to_status: str, extra: dict | None = None):
        with self.lock:  # atomic: exactly one concurrent claimer sees the row in a from-status
            rows = self.update(table, {**(extra or {}), "status": to_status},
                               id=id, status=f"in.({','.join(from_statuses)})")
            return rows[0] if len(rows) == 1 else None


class FakeMail:
    """Fake of the core.mail module surface used by the agents: fetch_new / send / sent_has."""

    def __init__(self, messages: list[dict] | None = None):
        self.inbox: list[dict] = list(messages or [])
        self.sent: list[dict] = []          # delivered messages
        self.sent_folder: set[str] = set()  # Message-IDs visible in the Sent folder
        self.fail_with: list[Exception] = []  # scripted failures, consumed one per send
        self.deliver_then_fail = False        # message goes out, then the call raises
        self.sent_has_error: Exception | None = None
        self.send_delay = 0.0
        self._lock = threading.Lock()

    def add_raw(self, raw: bytes, uid: str | None = None) -> dict:
        m = mail.parse(raw, uid or str(len(self.inbox) + 1))
        self.inbox.append(m)
        return m

    def fetch_new(self, since_days: int = 3):
        return list(self.inbox)  # always everything: re-fetch overlap is the point

    def send(self, fields: dict) -> str:
        mail.build(fields)  # validates like the real adapter
        if self.send_delay:
            time.sleep(self.send_delay)
        with self._lock:
            if self.fail_with:
                exc = self.fail_with.pop(0)
                if self.deliver_then_fail:
                    self.sent.append(fields)
                    self.sent_folder.add(fields["message_id"])
                raise exc
            self.sent.append(fields)
            self.sent_folder.add(fields["message_id"])
        return fields["message_id"]

    def sent_has(self, message_id: str) -> bool:
        if self.sent_has_error:
            raise self.sent_has_error
        return message_id in self.sent_folder


def eml(frm: str, subject: str, body: str, mid: str, **headers) -> bytes:
    h = {"From": frm, "To": "er@epsilon-labs.co", "Subject": subject, "Message-ID": mid, **headers}
    head = "".join(f"{k}: {v}\n" for k, v in h.items())
    return f"{head}\n{body}\n".encode()


class FakeAsk:
    """Stands in for core.llm.ask. Scripted by sender or by call kind; records every call."""

    def __init__(self, classify=None, draft=None):
        self.calls: list[dict] = []
        self._classify = classify or {}
        self._draft = draft or "Hi,\n\nThanks for the detail. Could we do a short call this week?\n\nEhab"

    def __call__(self, db, agent, run_id, system, untrusted, schema, model="haiku", timeout=120):
        kind = "classify" if "label" in schema["properties"] else "draft"
        self.calls.append({"kind": kind, "model": model, "system": system, "untrusted": untrusted})
        if kind == "classify":
            sender = re.search(r"<([^>]+)>", untrusted).group(1)
            base = {"label": "inquiry", "wedge": "W1", "flags": [], "stage_proposal": "none",
                    "confidence": 0.9, "reason": "test"}
            spec = self._classify.get(sender, {})
            if isinstance(spec, Exception):
                raise spec
            return {**base, **spec}, {}
        body = self._draft(untrusted) if callable(self._draft) else self._draft
        return {"body": body, "notes": ""}, {}
