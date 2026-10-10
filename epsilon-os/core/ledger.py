import uuid

from .db import DB


def new_run_id() -> str:
    return str(uuid.uuid4())


def heartbeat(db: DB, agent: str, status: str, detail: dict | None = None) -> None:
    db.insert("agent_heartbeats", {"agent": agent, "status": status, "detail": detail or {}}, returning=False)


def action(db: DB, agent: str, run_id: str, action: str, target_table: str | None = None,
           target_id: str | None = None, detail: dict | None = None, model: str | None = None,
           cost_usd: float | None = None) -> None:
    db.insert("actions", {
        "agent": agent, "run_id": run_id, "action": action, "target_table": target_table,
        "target_id": target_id, "detail": detail, "model": model, "cost_usd": cost_usd,
    }, returning=False)
