"""In-memory fakes with the same interface as core.db.DB and the core.mail adapter."""
import copy
import re
import threading
import time
import uuid
from datetime import datetime, timezone

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
        if table == "actions":
            r.setdefault("at", _now())
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
        raise DBError(f"unknown rpc {fn}")

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
