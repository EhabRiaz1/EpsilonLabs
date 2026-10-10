"""Weekly export over PostgREST (no pg_dump: there is no DB password, only the API key)."""
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from core import config, ledger
from core.db import DB

AGENT = "backup"
TABLES = ["companies", "contacts", "deals", "touches", "suppression_list", "agent_heartbeats",
          "approval_queue", "actions", "dossiers"]
PAGE = 1000
KEEP = 8
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DEFAULT_ROOT = Path.home() / "EpsilonOS-backups"


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export_table(db, table: str, path: Path) -> int:
    n, offset = 0, 0
    with path.open("w", encoding="utf-8") as f:
        while True:
            rows = db.select(table, order="id.asc", limit=PAGE, offset=offset)
            for r in rows:
                f.write(json.dumps(r, sort_keys=True, default=str, ensure_ascii=False) + "\n")
            n += len(rows)
            if len(rows) < PAGE:
                return n
            offset += PAGE


def prune(root: Path, keep: int = KEEP) -> list[str]:
    folders = sorted(p for p in root.iterdir() if p.is_dir() and not p.is_symlink() and DATE_RE.match(p.name))
    gone = folders[:-keep] if keep > 0 else folders
    for p in gone:
        shutil.rmtree(p)
    return [p.name for p in gone]


def restore_check(folder: Path) -> dict:
    """Verify manifest hashes and row counts. A full restore drill stays a manual runbook."""
    folder = Path(folder)
    problems: list[str] = []
    try:
        manifest = json.loads((folder / "manifest.json").read_text())
        files = manifest["tables"]
    except (OSError, ValueError, KeyError) as e:
        return {"ok": False, "problems": [f"manifest unreadable: {type(e).__name__}"]}
    for table, info in files.items():
        p = folder / f"{table}.jsonl"
        if not p.is_file():
            problems.append(f"{table}: file missing")
            continue
        if _sha(p) != info["sha256"]:
            problems.append(f"{table}: sha256 mismatch")
        with p.open(encoding="utf-8") as f:
            lines = sum(1 for line in f if line.strip())
        if lines != info["rows"]:
            problems.append(f"{table}: {lines} rows on disk, manifest says {info['rows']}")
    missing = [t for t in TABLES if t not in files]
    problems += [f"{t}: not in manifest" for t in missing]
    return {"ok": not problems, "problems": problems, "tables": len(files)}


def run(db: DB | None = None, root: Path | None = None, now: datetime | None = None) -> dict:
    db = db or DB()
    root = Path(root) if root else DEFAULT_ROOT
    now = now or datetime.now(timezone.utc)
    day = now.astimezone(ZoneInfo(config.TZ)).date().isoformat()
    folder = root / day
    try:
        root.mkdir(parents=True, exist_ok=True)
        os.chmod(root, 0o700)
        folder.mkdir(exist_ok=True)
        os.chmod(folder, 0o700)
        tables = {}
        for t in TABLES:
            p = folder / f"{t}.jsonl"
            rows = export_table(db, t, p)
            os.chmod(p, 0o600)
            tables[t] = {"rows": rows, "sha256": _sha(p)}
        m = folder / "manifest.json"
        m.write_text(json.dumps({"created_at": now.isoformat(), "tables": tables}, indent=2, sort_keys=True))
        os.chmod(m, 0o600)
        check = restore_check(folder)
        if not check["ok"]:
            raise RuntimeError("self-check failed: " + "; ".join(check["problems"]))
        pruned = prune(root)
    except Exception as e:
        ledger.heartbeat(db, AGENT, "error", {"error": f"{type(e).__name__}: {str(e)[:200]}"})
        return {"error": type(e).__name__}
    detail = {"folder": str(folder), "rows": {t: v["rows"] for t, v in tables.items()}, "pruned": pruned}
    ledger.heartbeat(db, AGENT, "ok", detail)
    return detail


def main() -> int:
    if len(sys.argv) > 2 and sys.argv[1] == "--check":
        res = restore_check(Path(sys.argv[2]))
        print(res)
        return 0 if res["ok"] else 1
    res = run()
    print({k: v for k, v in res.items() if k != "rows"})
    return 1 if res.get("error") else 0


if __name__ == "__main__":
    sys.exit(main())
