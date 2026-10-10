"""Single launchd entrypoint: python -m agents.run <inbox|outbox|brief|backup>.

Process lock so a slow run is never overlapped by the next tick; any exception becomes a
heartbeat status=error (exception type only, never the message) and a non-zero exit.
"""
import fcntl
import importlib
import sys
from contextlib import contextmanager
from pathlib import Path

from core import ledger, watchdog
from core.db import DB

JOBS = ("inbox", "outbox", "brief", "backup", "prospector", "outreach")
LOCK_DIR = Path.home() / "Library" / "Application Support" / "EpsilonOS" / "locks"


class Busy(Exception):
    pass


@contextmanager
def lock(name: str, lock_dir: Path | None = None):
    d = Path(lock_dir) if lock_dir else LOCK_DIR
    d.mkdir(parents=True, exist_ok=True)
    f = open(d / f"{name}.lock", "w")
    try:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Busy(name) from None
        yield
    finally:
        f.close()  # closing releases the flock


def _default_job(name: str):
    return importlib.import_module(f"agents.{name}").run


def main(argv: list[str] | None = None, jobs: dict | None = None, db_factory=DB,
         lock_dir: Path | None = None, ping=watchdog.ping) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1 or argv[0] not in JOBS:
        print(f"usage: python -m agents.run <{'|'.join(JOBS)}>", file=sys.stderr)
        return 2
    name = argv[0]
    try:
        with lock(name, lock_dir):
            db = None
            try:
                db = db_factory()
                result = (jobs[name] if jobs and name in jobs else _default_job(name))(db=db)
            except Exception as e:
                print(f"{name}: failed with {type(e).__name__}", file=sys.stderr)
                try:
                    ledger.heartbeat(db or db_factory(), name, "error", {"error": type(e).__name__})
                except Exception:
                    pass
                _ping(ping, name, False, db)
                return 1
            failed = isinstance(result, dict) and bool(result.get("error"))
            print({k: v for k, v in (result or {}).items() if k != "rows"} if isinstance(result, dict) else result)
            _ping(ping, name, not failed, db)
            return 1 if failed else 0
    except Busy:
        print(f"{name}: previous run still in progress, skipping this tick")
        return 0


def _ping(ping, name, ok, db) -> None:
    try:
        ping(name, ok=ok, db=db)
    except Exception:
        pass


if __name__ == "__main__":
    sys.exit(main())
