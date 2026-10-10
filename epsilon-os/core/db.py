import re
from typing import Any

import httpx

from . import config


_RAW = {"select", "order", "limit", "offset"}
_OP = re.compile(r"^(eq|neq|gt|gte|lt|lte|in|is|like|ilike)\.")


class DBError(RuntimeError):
    pass


class DB:
    def __init__(self, key: str | None = None, transport: httpx.BaseTransport | None = None):
        key = key or config.secret("epsilon-os-supabase-secret", config.SUPABASE_ACCOUNT)
        self._c = httpx.Client(
            base_url=f"{config.SUPABASE_URL}/rest/v1",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=httpx.Timeout(20.0, connect=10.0),
            transport=transport,
        )

    def _req(self, method: str, path: str, **kw: Any) -> httpx.Response:
        last: Exception | None = None
        for _ in range(2):
            try:
                r = self._c.request(method, path, **kw)
                break
            except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as e:
                last = e
        else:
            raise DBError(f"{method} {path}: network error {type(last).__name__}") from None
        if r.status_code >= 400:
            raise DBError(f"{method} {path}: HTTP {r.status_code} {r.text[:300]}")
        return r

    @staticmethod
    def _params(filters: dict[str, Any]) -> dict[str, str]:
        out = {}
        for k, v in filters.items():
            if k in _RAW:
                out[k] = str(v)
            elif isinstance(v, str) and _OP.match(v):
                out[k] = v
            else:
                out[k] = f"eq.{v}"
        return out

    def select(self, table: str, **filters: Any) -> list[dict]:
        return self._req("GET", f"/{table}", params=self._params(filters)).json()

    def insert(self, table: str, rows: dict | list[dict], returning: bool = True) -> list[dict]:
        prefer = "return=representation" if returning else "return=minimal"
        r = self._req("POST", f"/{table}", json=rows, headers={"Prefer": prefer})
        return r.json() if returning else []

    def update(self, table: str, values: dict, **filters: Any) -> list[dict]:
        if not filters:
            raise DBError("update without filters refused")
        r = self._req("PATCH", f"/{table}", params=self._params(filters), json=values,
                      headers={"Prefer": "return=representation"})
        return r.json()

    def rpc(self, fn: str, args: dict | None = None) -> Any:
        return self._req("POST", f"/rpc/{fn}", json=args or {}).json()

    def claim(self, table: str, id: str, from_statuses: list[str], to_status: str,
              extra: dict | None = None) -> dict | None:
        params = {"id": f"eq.{id}", "status": f"in.({','.join(from_statuses)})"}
        r = self._req("PATCH", f"/{table}", params=params, json={**(extra or {}), "status": to_status},
                      headers={"Prefer": "return=representation"})
        rows = r.json()
        return rows[0] if len(rows) == 1 else None
