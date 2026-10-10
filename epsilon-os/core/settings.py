"""Runtime settings (migration 004, table `settings`), editable from the dashboard /settings page.

Getters never fail because of a missing table, a missing key or a malformed value: they fall back to
DEFAULTS. `set` validates and raises SettingsError with a message fit to show next to the form field.
The ramp is pure math so it is testable without a database.
"""
import re
from datetime import date, datetime, timezone

from . import config

SEGMENTS = ("industrial", "oem_hardware", "smb_software")
SEGMENT_LABEL = {"industrial": "Industrial operations", "oem_hardware": "OEMs and hardware startups",
                 "smb_software": "SMBs needing software"}
DEFAULT_RAMP = {"start": 5, "step": 5, "every_days": 3}
DEFAULTS = {
    "prospector.per_day": 20,
    "prospector.segments": list(SEGMENTS),
    "prospector.paused": False,
    "llm.daily_budget": config.DAILY_LLM_CALL_BUDGET,
    "outreach.daily_cap": 50,
    "outreach.ramp": DEFAULT_RAMP,
    "outreach.started_on": None,
    "outreach.address": "",
}
BOUNDS = {"prospector.per_day": (0, 50), "llm.daily_budget": (50, 1000), "outreach.daily_cap": (0, 100)}
_ADDR = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


class SettingsError(ValueError):
    pass


def _int(v) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and re.fullmatch(r"\s*-?\d+\s*", v):
        return int(v)
    return None


def _clean_ramp(v) -> dict | None:
    if not isinstance(v, dict) or v.keys() != {"start", "step", "every_days"}:
        return None
    start, step, every = (_int(v["start"]), _int(v["step"]), _int(v["every_days"]))
    if None in (start, step, every) or not (0 <= start <= 100 and 0 <= step <= 100 and 1 <= every <= 30):
        return None
    return {"start": start, "step": step, "every_days": every}


def _clean_date(v) -> str | None:
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        return None


def _stored(db) -> dict:
    try:
        rows = db.select("settings")
    except Exception:  # table not migrated yet, or the DB is down: run on defaults
        return {}
    return {r["key"]: r["value"] for r in rows if isinstance(r, dict) and "key" in r and "value" in r}


def validate(key: str, value):
    """Return the cleaned value for `key` or raise SettingsError."""
    if key in BOUNDS:
        lo, hi = BOUNDS[key]
        n = _int(value)
        if n is None or not lo <= n <= hi:
            raise SettingsError(f"Enter a whole number from {lo} to {hi}.")
        return n
    if key == "prospector.segments":
        if not isinstance(value, (list, tuple)):
            raise SettingsError("Segments must be a list.")
        bad = [s for s in value if s not in SEGMENTS]
        if bad:
            raise SettingsError("Unknown segment: " + ", ".join(str(b) for b in bad))
        out = [s for s in SEGMENTS if s in value]
        if not out:
            raise SettingsError("Pick at least one segment, or pause the prospector.")
        return out
    if key == "prospector.paused":
        if not isinstance(value, bool):
            raise SettingsError("Paused must be true or false.")
        return value
    if key == "outreach.ramp":
        r = _clean_ramp(value)
        if r is None:
            raise SettingsError("Ramp needs start 0-100, step 0-100 and every_days 1-30.")
        return r
    if key == "outreach.started_on":
        d = _clean_date(value) if value is not None else None
        if d is None:
            raise SettingsError("Started-on must be a date (YYYY-MM-DD).")
        return d
    if key == "outreach.address":
        v = str(value or "").strip().lower()
        if v and not _ADDR.match(v):
            raise SettingsError("Enter a full email address.")
        return v
    raise SettingsError(f"Unknown setting {key!r}.")


def get(db, key: str):
    """Stored value if present and valid, else the default."""
    default = DEFAULTS[key]
    stored = _stored(db)
    if key not in stored or stored[key] is None:
        return default
    try:
        return validate(key, stored[key]) if key != "outreach.started_on" else (_clean_date(stored[key]) or default)
    except SettingsError:
        return default


def set(db, key: str, value):  # noqa: A001 - the spec names it set()
    clean = validate(key, value)
    # PostgREST turns a JSON null into SQL NULL (value is NOT NULL), so null is never written from here.
    if db.select("settings", key=key, limit=1):
        db.update("settings", {"value": clean, "updated_at": _now_iso()}, key=key)
    else:
        db.insert("settings", {"key": key, "value": clean}, returning=False)
    return clean


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# typed getters --------------------------------------------------------------
def per_day(db) -> int:
    return get(db, "prospector.per_day")


def segments(db) -> list[str]:
    return get(db, "prospector.segments")


def paused(db) -> bool:
    return get(db, "prospector.paused")


def daily_budget(db) -> int:
    return get(db, "llm.daily_budget")


def daily_cap(db) -> int:
    return get(db, "outreach.daily_cap")


def ramp(db) -> dict:
    return get(db, "outreach.ramp")


def started_on(db) -> date | None:
    v = get(db, "outreach.started_on")
    return date.fromisoformat(v) if v else None


def outreach_address(db) -> str:
    return get(db, "outreach.address")


def ramp_cap(ramp_: dict, started: date | None, today: date) -> int:
    """Warm-up ceiling for `today`: start, then +step every `every_days` days since the first send."""
    if started is None or today <= started:
        return ramp_["start"]
    return ramp_["start"] + ramp_["step"] * ((today - started).days // ramp_["every_days"])


def effective_cap(db, today: date) -> int:
    return min(daily_cap(db), ramp_cap(ramp(db), started_on(db), today))


class Settings:
    """Object wrapper so agents take `settings` as one argument (and tests can fake it)."""

    def __init__(self, db):
        self.db = db

    def get(self, key):
        return get(self.db, key)

    def set(self, key, value):
        return set(self.db, key, value)

    def per_day(self) -> int:
        return per_day(self.db)

    def segments(self) -> list[str]:
        return segments(self.db)

    def paused(self) -> bool:
        return paused(self.db)

    def daily_budget(self) -> int:
        return daily_budget(self.db)

    def daily_cap(self) -> int:
        return daily_cap(self.db)

    def outreach_address(self) -> str:
        return outreach_address(self.db)
