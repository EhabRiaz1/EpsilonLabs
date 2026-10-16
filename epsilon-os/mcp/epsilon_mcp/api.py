"""The PostgREST side of the Epsilon MCP: one POST /rest/v1/rpc/mcp_* per tool, with the PUBLIC anon key and the project
token as the first argument (migration 017). Never a service key: the database decides everything from the token."""
from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from typing import Any

import httpx

TOKEN_RE = re.compile(r"^eps_pt_[0-9a-f]{64}$")
DEFAULT_URL = "https://lueawvqogdodtjsfqdeh.supabase.co"  # same project as epsilon-os/core/config.py


class ConfigError(RuntimeError):
    pass


class EpsilonError(RuntimeError):
    """A refusal or failure from the database, with its message (safe to show: it never contains the token)."""


@dataclass(frozen=True)
class Config:
    url: str
    anon_key: str
    token: str


def _jwt_role(key: str) -> str | None:
    parts = key.split(".")
    if len(parts) != 3:
        return None
    try:
        pad = "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(parts[1] + pad)).get("role")
    except (ValueError, json.JSONDecodeError):
        return None


def load_config(env: dict[str, str] | None = None) -> Config:
    env = dict(os.environ if env is None else env)
    token = env.get("EPSILON_PROJECT_TOKEN", "").strip()
    if not TOKEN_RE.match(token):
        raise ConfigError("EPSILON_PROJECT_TOKEN is missing or malformed (expected eps_pt_ followed by 64 hex characters). "
                          "Create one in admin: client -> project card -> Connect Claude Code.")
    url = (env.get("EPSILON_SUPABASE_URL") or env.get("SUPABASE_URL") or DEFAULT_URL).strip().rstrip("/")
    if not re.match(r"^https://[A-Za-z0-9.-]+(:[0-9]+)?$", url) and not url.startswith("http://127.0.0.1"):
        raise ConfigError("EPSILON_SUPABASE_URL must be the https:// project URL")
    key = (env.get("EPSILON_SUPABASE_ANON_KEY") or env.get("SUPABASE_ANON_KEY") or "").strip()
    if not key:
        raise ConfigError("EPSILON_SUPABASE_ANON_KEY is missing: use the project's public anon / publishable key "
                          "(the admin 'Connect Claude Code' command includes it).")
    if key.startswith("sb_secret_") or _jwt_role(key) == "service_role":
        raise ConfigError("EPSILON_SUPABASE_ANON_KEY must be the public anon / publishable key, never a secret or service key")
    return Config(url=url, anon_key=key, token=token)


class Api:
    def __init__(self, cfg: Config, transport: httpx.BaseTransport | None = None):
        self._token = cfg.token
        self._c = httpx.Client(
            base_url=f"{cfg.url}/rest/v1",
            headers={"apikey": cfg.anon_key, "Authorization": f"Bearer {cfg.anon_key}",
                     "Content-Type": "application/json", "Accept": "application/json"},
            timeout=httpx.Timeout(20.0, connect=10.0),
            transport=transport,
        )

    def rpc(self, fn: str, **args: Any) -> Any:
        if not fn.startswith("mcp_"):
            raise ValueError("the MCP calls mcp_* functions only")
        body = {"p_token": self._token, **{f"p_{k}": v for k, v in args.items()}}
        try:
            r = self._c.post(f"/rpc/{fn}", json=body)
        except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as e:
            raise EpsilonError(f"could not reach Epsilon ({type(e).__name__}); check the network and try again") from None
        if r.status_code >= 400:
            try:
                msg = r.json().get("message") or r.text
            except (ValueError, AttributeError):
                msg = r.text
            raise EpsilonError(str(msg)[:500].replace(self._token, "eps_pt_…"))
        return r.json() if r.content else None
