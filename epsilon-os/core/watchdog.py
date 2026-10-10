"""External watchdog (D10): ping healthchecks.io after each agent run. Never raises."""
import sys

import httpx

from . import config, ledger

TIMEOUT = 5.0
_warned = False


def _url() -> str | None:
    global _warned
    try:
        return config.secret(config.HEALTHCHECKS_SERVICE, config.HEALTHCHECKS_ACCOUNT).rstrip("/")
    except Exception:
        if not _warned:
            _warned = True
            print("watchdog: no healthchecks ping URL in keychain; pings disabled", file=sys.stderr)
        return None


def ping(agent: str, ok: bool = True, db=None, client: httpx.Client | None = None) -> bool:
    """GET the ping URL (+ /fail when not ok). True when the ping was accepted."""
    try:
        base = _url()
        if not base:
            return False
        url = base if ok else base + "/fail"
        r = (client or httpx).get(url, timeout=TIMEOUT)
        good = r.status_code < 400
    except Exception as e:  # network, keychain, anything: the watchdog must not break a run
        print(f"watchdog: ping failed ({type(e).__name__})", file=sys.stderr)
        return False
    if good and db is not None:
        try:
            ledger.heartbeat(db, "watchdog", "ok", {"for": agent, "ok": ok})
        except Exception:
            pass
    return good
