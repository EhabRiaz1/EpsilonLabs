#!/bin/bash
# Install (or --uninstall) the Epsilon OS launchd agents. Idempotent: bootout first if loaded.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/epsilon-os"
JOBS=(inbox outbox brief backup prospector outreach tenders scheduler worker project_agent)   # the dashboard plist is separate and keeps its own RunAtLoad

label() { echo "co.epsilon-labs.os.$1"; }
loaded() { launchctl print "$DOMAIN/$(label "$1")" >/dev/null 2>&1; }

if [[ "${1:-}" == "--uninstall" ]]; then
  for j in "${JOBS[@]}"; do
    if loaded "$j"; then launchctl bootout "$DOMAIN/$(label "$j")"; fi
    rm -f "$AGENTS_DIR/$(label "$j").plist"
    echo "removed $(label "$j")"
  done
  exit 0
fi

for j in "${JOBS[@]}"; do
  plutil -lint "$ROOT/launchd/$(label "$j").plist" >/dev/null || { echo "bad plist: $j" >&2; exit 1; }
done
[[ -x "$ROOT/.venv/bin/python" ]] || { echo "missing $ROOT/.venv/bin/python (run: make -C $ROOT setup)" >&2; exit 1; }
PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH" command -v claude >/dev/null \
  || { echo "claude CLI not found on PATH or in ~/.local/bin" >&2; exit 1; }

mkdir -p "$LOG_DIR" "$AGENTS_DIR" "$HOME/Library/Application Support/EpsilonOS/locks"

for j in "${JOBS[@]}"; do
  dest="$AGENTS_DIR/$(label "$j").plist"
  if loaded "$j"; then launchctl bootout "$DOMAIN/$(label "$j")"; fi
  cp "$ROOT/launchd/$(label "$j").plist" "$dest"
  launchctl bootstrap "$DOMAIN" "$dest"
  echo "installed $(label "$j")"
done
echo "done. check with: scripts/status_jobs.sh"
