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
# Strategies S2-S5 (prompts/strategies.py holds the content; ids and labels live here so core never imports prompts).
STRATEGY_IDS = ("s2_trigger", "s3_regulation", "s4_partner", "s5_intent", "s7_orphaned", "s8_tradeshow",
                "s9_crowdfund", "s10_accelerator")
STRATEGY_LABEL = {"s2_trigger": "Trigger events", "s3_regulation": "Regulation", "s4_partner": "Partners",
                  "s5_intent": "Outsourcing intent", "s7_orphaned": "Orphaned devices",
                  "s8_tradeshow": "Trade-show exhibitors", "s9_crowdfund": "Crowdfunded hardware",
                  "s10_accelerator": "Accelerators and spinouts"}
DEFAULT_QUOTAS = {"s2_trigger": 6, "s3_regulation": 4, "s4_partner": 6, "s5_intent": 5, "s7_orphaned": 6,
                  "s8_tradeshow": 5, "s9_crowdfund": 4, "s10_accelerator": 4}   # total 40 = default prospector.per_day
# Markets (ISO codes) where a client can pay a Pakistan firm (Wise, Payoneer, bank transfer) and budgets reach $10k+.
# India is left out for now. ALWAYS_EXCLUDED wins over anything added in /settings: Pakistan is the founder's own
# network, the rest are sanctioned.
DEFAULT_MARKETS = tuple("""US CA MX BR CL GB IE AT BE BG HR CY CZ DK EE FI FR DE GR HU IT LV LT LU MT NL PL PT RO SK SI ES SE
    NO IS LI CH TR IL AE SA QA KW BH OM JO EG MA ZA KE NG SG MY ID TH VN PH HK TW JP KR AU NZ""".split())
ALWAYS_EXCLUDED = frozenset("PK IR KP SY CU RU BY".split())
DEFAULTS = {
    "prospector.per_day": 40,
    "prospector.markets": list(DEFAULT_MARKETS),
    "prospector.segments": list(SEGMENTS),
    "prospector.paused": False,
    "llm.daily_budget": config.DAILY_LLM_CALL_BUDGET,
    "outreach.daily_cap": 50,
    "outreach.ramp": DEFAULT_RAMP,
    "outreach.started_on": None,
    "outreach.address": "",
    "strategy.quotas": DEFAULT_QUOTAS,
    "strategy.auto_rebalance": True,
    "strategy.pinned": [],
}
BOUNDS = {"prospector.per_day": (0, 80), "llm.daily_budget": (50, 1000), "outreach.daily_cap": (0, 100)}
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


def _clean_markets(v) -> list[str]:
    """A list or comma-separated string of two-letter country codes. Pakistan and sanctioned markets are dropped."""
    items = re.split(r"[\s,;]+", v) if isinstance(v, str) else v
    if not isinstance(items, (list, tuple)):
        raise SettingsError("Markets must be a comma-separated list of two-letter country codes.")
    out = []
    for x in items:
        code = str(x).strip().upper()
        if not code:
            continue
        if not re.fullmatch(r"[A-Z]{2}", code):
            raise SettingsError(f"{str(x).strip()[:20]!r} is not a two-letter country code.")
        if code not in ALWAYS_EXCLUDED and code not in out:
            out.append(code)
    if not out:
        raise SettingsError("Keep at least one market (Pakistan and sanctioned markets are never allowed).")
    return out


def _clean_quotas(v) -> dict:
    """Whole numbers 0-50 per known strategy; a missing strategy keeps its default. The total is checked against
    prospector.per_day by check_quota_total (validate() has no view of other settings)."""
    if not isinstance(v, dict):
        raise SettingsError("Quotas must be a mapping of strategy to number.")
    unknown = [k for k in v if k not in STRATEGY_IDS]
    if unknown:
        raise SettingsError("Unknown strategy: " + ", ".join(str(k) for k in unknown))
    out = {}
    for sid in STRATEGY_IDS:
        n = _int(v[sid]) if sid in v else DEFAULT_QUOTAS[sid]
        if n is None or not 0 <= n <= 50:
            raise SettingsError(f"{STRATEGY_LABEL[sid]}: enter a whole number from 0 to 50.")
        out[sid] = n
    return out


def check_quota_total(quotas: dict, per_day: int) -> None:
    total = sum(quotas.values())
    if total > per_day:
        raise SettingsError(f"Quotas add up to {total}, more than the {per_day} prospects per day. Lower a quota or raise the daily total.")


def strategy_form(p: dict, per_day: int | None) -> tuple[dict, dict]:
    """Settings-form fields -> ({setting key: clean value}, {field: message}). Fields: quota_<id>, pin_<id>, auto_rebalance.
    Returns nothing when the form carries no quota fields at all (an older client)."""
    if not any(f"quota_{s}" in p for s in STRATEGY_IDS):
        return {}, {}
    errors, quotas = {}, {}
    for sid in STRATEGY_IDS:
        n = _int(str(p.get(f"quota_{sid}", "")).strip())
        if n is None or not 0 <= n <= 50:
            errors[f"quota_{sid}"] = "Enter a whole number from 0 to 50."
        else:
            quotas[sid] = n
    if not errors and per_day is not None:
        try:
            check_quota_total(quotas, per_day)
        except SettingsError as ex:
            errors["quotas"] = str(ex)
    if errors:
        return {}, errors
    on = (True, "1", "on", "true")
    extra = {}
    if "markets" in p:
        try:
            extra["prospector.markets"] = _clean_markets(str(p["markets"]))
        except SettingsError as ex:
            return {}, {"markets": str(ex)}
    return extra | {"strategy.quotas": quotas, "strategy.auto_rebalance": p.get("auto_rebalance") in on,
            "strategy.pinned": [s for s in STRATEGY_IDS if p.get(f"pin_{s}") in on]}, {}


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
    if key in TENDER_KEYS:
        return _validate_tender(key, value)
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
    if key == "prospector.markets":
        return _clean_markets(value)
    if key == "strategy.quotas":
        return _clean_quotas(value)
    if key == "strategy.auto_rebalance":
        if not isinstance(value, bool):
            raise SettingsError("Auto-rebalance must be true or false.")
        return value
    if key == "strategy.pinned":
        if not isinstance(value, (list, tuple)):
            raise SettingsError("Pinned strategies must be a list.")
        bad = [s for s in value if s not in STRATEGY_IDS]
        if bad:
            raise SettingsError("Unknown strategy: " + ", ".join(str(b) for b in bad))
        return [s for s in STRATEGY_IDS if s in value]
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


def markets(db) -> list[str]:
    return list(get(db, "prospector.markets"))


def paused(db) -> bool:
    return get(db, "prospector.paused")


def daily_budget(db) -> int:
    return get(db, "llm.daily_budget")


def daily_cap(db) -> int:
    return get(db, "outreach.daily_cap")


def quotas(db) -> dict:
    return dict(get(db, "strategy.quotas"))


def auto_rebalance(db) -> bool:
    return get(db, "strategy.auto_rebalance")


def pinned(db) -> list[str]:
    return list(get(db, "strategy.pinned"))


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


# ---------------------------------------------------------------- tenders (S1, agents/tenders.py)
TENDER_LIVE = ("ted", "uk_fts", "uk_cf", "canadabuys", "austender", "ungm", "samgov", "worldbank", "ebrd")
TENDER_DISABLED = ("adb", "afdb", "isdb", "aiib", "etimad", "dubai", "monaqasat", "oman", "bahrain", "kuwait")
TENDER_SOURCES = TENDER_LIVE + TENDER_DISABLED
TENDER_SOURCE_LABEL = {"ted": "EU TED", "uk_fts": "UK Find a Tender", "uk_cf": "UK Contracts Finder",
                       "canadabuys": "CanadaBuys", "austender": "AusTender", "ungm": "UNGM",
                       "samgov": "SAM.gov", "worldbank": "World Bank", "ebrd": "EBRD", "adb": "ADB (disabled)",
                       "afdb": "AfDB (disabled)", "isdb": "IsDB (disabled)", "aiib": "AIIB (disabled)",
                       "etimad": "Saudi Etimad (disabled)", "dubai": "Dubai eSupply (disabled)",
                       "monaqasat": "Qatar Monaqasat (disabled)", "oman": "Oman Tender Board (disabled)",
                       "bahrain": "Bahrain Tender Board (disabled)", "kuwait": "Kuwait CTC (disabled)"}
DEFAULTS.update({
    "tenders.per_day": 15,
    "tenders.value_min": 10_000,      # USD equivalent; tenders with no stated value are always kept
    "tenders.value_max": 500_000,
    "tenders.sources": list(TENDER_LIVE),
    "tenders.paused": False,
})
BOUNDS["tenders.per_day"] = (0, 50)
TENDER_KEYS = frozenset({"tenders.per_day", "tenders.value_min", "tenders.value_max", "tenders.sources",
                         "tenders.paused"})


def _validate_tender(key: str, value):
    if key == "tenders.per_day":
        lo, hi = BOUNDS[key]
        n = _int(value)
        if n is None or not lo <= n <= hi:
            raise SettingsError(f"Enter a whole number from {lo} to {hi}.")
        return n
    if key in ("tenders.value_min", "tenders.value_max"):
        n = _int(value)
        if n is None or not 0 <= n <= 100_000_000:
            raise SettingsError("Enter a whole dollar amount from 0 to 100,000,000.")
        return n
    if key == "tenders.sources":
        if not isinstance(value, (list, tuple)):
            raise SettingsError("Sources must be a list.")
        bad = [s for s in value if s not in TENDER_SOURCES]
        if bad:
            raise SettingsError("Unknown source: " + ", ".join(str(b) for b in bad))
        out = [s for s in TENDER_SOURCES if s in value]
        if not out:
            raise SettingsError("Pick at least one source, or pause tenders.")
        return out
    if not isinstance(value, bool):
        raise SettingsError("Paused must be true or false.")
    return value


def tenders_per_day(db) -> int:
    return get(db, "tenders.per_day")


def tenders_value_band(db) -> tuple[int, int]:
    """(min, max) in USD. A swapped pair is read as (smaller, larger) rather than rejecting every tender."""
    lo, hi = get(db, "tenders.value_min"), get(db, "tenders.value_max")
    return (lo, hi) if lo <= hi else (hi, lo)


def tenders_sources(db) -> list[str]:
    return get(db, "tenders.sources")


def tenders_paused(db) -> bool:
    return get(db, "tenders.paused")
