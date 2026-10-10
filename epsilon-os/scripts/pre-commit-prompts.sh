#!/usr/bin/env bash
# Git pre-commit hook (install by hand): WARN, never block, when epsilon-os/prompts/ changed
# and the last full golden-set eval is older than that change. Always exits 0.
set -u
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
changed="$(git diff --cached --name-only -- epsilon-os/prompts/ | grep -E '\.(md|py)$' | grep -v __init__ || true)"
[ -z "$changed" ] && exit 0
report="$root/epsilon-os/evals/last-report.json"
newest=0
while IFS= read -r f; do
  [ -f "$root/$f" ] || continue
  m="$(stat -f %m "$root/$f" 2>/dev/null || stat -c %Y "$root/$f" 2>/dev/null || echo 0)"
  [ "$m" -gt "$newest" ] && newest="$m"
done <<< "$changed"
last=0
if [ -f "$report" ]; then
  last="$(python3 - "$report" <<'PY'
import json, sys
try:
    r = json.load(open(sys.argv[1]))
    print(int(r["finished_at"]) if r.get("full") else 0)
except Exception:
    print(0)
PY
)"
fi
if [ "$last" -lt "$newest" ]; then
  echo "WARNING: epsilon-os/prompts/ changed but no full golden-set eval has run since." >&2
  echo "         Run: make -C epsilon-os eval   (D12: re-run the golden set on every prompt change)" >&2
fi
exit 0
