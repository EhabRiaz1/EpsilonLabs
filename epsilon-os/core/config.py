import os
import subprocess

SUPABASE_URL = "https://lueawvqogdodtjsfqdeh.supabase.co"
SUPABASE_ACCOUNT = "lueawvqogdodtjsfqdeh"
TZ = "Asia/Karachi"
ER = "er@epsilon-labs.co"
IMAP_HOST, IMAP_PORT = "imappro.zoho.com", 993
SMTP_HOST, SMTP_PORT = "smtppro.zoho.com", 465
DAILY_LLM_CALL_BUDGET = 250  # fallback only; the live value is settings llm.daily_budget
UNDO_SECONDS = 10
FOUNDER_EMAIL_DEFAULT = "er@epsilon-labs.co"
DASHBOARD_URL = "http://127.0.0.1:8787"
HEALTHCHECKS_SERVICE, HEALTHCHECKS_ACCOUNT = "epsilon-os-healthchecks", "ping-url"

_cache: dict[tuple[str, str], str] = {}


class SecretError(RuntimeError):
    pass


def secret(service: str, account: str) -> str:
    key = (service, account)
    if key not in _cache:
        try:
            r = subprocess.run(
                ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
                capture_output=True, text=True, timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired) as e:
            raise SecretError(f"keychain read failed for service {service!r}: {type(e).__name__}") from None
        value = r.stdout.strip()
        if r.returncode != 0 or not value:
            raise SecretError(f"keychain item missing or empty for service {service!r} account {account!r}")
        _cache[key] = value
    return _cache[key]


def founder_email() -> str:
    return os.environ.get("FOUNDER_EMAIL") or FOUNDER_EMAIL_DEFAULT
