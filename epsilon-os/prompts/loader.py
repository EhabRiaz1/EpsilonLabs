"""Compose preamble + task prompt. Prompts live in .md files next to this module."""
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOGUE = HERE.parents[1] / "catalogue.json"
_PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


def _read(name: str) -> str:
    return (HERE / f"{name}.md").read_text().strip()


def offers_summary(path: Path = CATALOGUE) -> str:
    """Name, tagline and URL-free description of each offer, from the generated catalogue."""
    offers = json.loads(path.read_text()).get("offers", [])
    lines = []
    for o in offers:
        name, tag = o.get("name", "").strip(), o.get("tagline", "").strip()
        if name:
            lines.append(f"- {name}: {tag}" if tag else f"- {name}")
    return "\n".join(lines) or "- (none listed)"


def offer_slugs(path: Path = CATALOGUE) -> list[str]:
    """Slugs of every offer in the generated catalogue (tools/offers.py is the source of truth)."""
    return [o["slug"] for o in json.loads(path.read_text()).get("offers", []) if o.get("slug")]


def offer_line(slug: str, path: Path = CATALOGUE) -> str:
    for o in json.loads(path.read_text()).get("offers", []):
        if o.get("slug") == slug:
            return f"{o.get('name', '').strip()}: {o.get('tagline', '').strip()}"
    raise KeyError(slug)


def compose(task: str, context: dict[str, str] | None = None, preamble: str = "preamble") -> str:
    ctx = dict(context or {})
    if "{{offers}}" in _read(task):
        ctx.setdefault("offers", offers_summary())
    body = _read(task)

    def sub(m: re.Match) -> str:
        key = m.group(1)
        if key not in ctx:
            raise KeyError(f"prompt {task!r} needs context {key!r}")
        return str(ctx[key]).replace("{{", "(").replace("}}", ")")
    return _read(preamble) + "\n\n" + _PLACEHOLDER.sub(sub, body) + "\n"


def prompts_hash() -> str:
    h = hashlib.sha256()
    for p in sorted(HERE.glob("*.md")) + [HERE / "schemas.py"]:
        h.update(p.name.encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:12]
