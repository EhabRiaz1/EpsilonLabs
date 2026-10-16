#!/bin/sh
# Installs the `tickets` skill for Claude Code (~/.claude/skills/epsilon-tickets) and prints the `claude mcp add`
# command to run inside a client project folder. Creates no token and touches no database: make the token in admin
# (client -> project card -> Connect Claude Code), which also shows this command with the token filled in.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
EOS=$(cd "$HERE/.." && pwd)
PY="$EOS/.venv/bin/python"
DEST="$HOME/.claude/skills/epsilon-tickets"

if [ ! -x "$PY" ]; then
  echo "epsilon-os venv not found at $PY. Run: (cd \"$EOS\" && make setup)" >&2
  exit 1
fi
if ! "$PY" -c "import mcp.server.fastmcp" 2>/dev/null; then
  echo "The mcp package is missing from the venv. Run: $PY -m pip install -r \"$EOS/requirements.txt\"" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$HERE/skills/tickets/SKILL.md" "$DEST/SKILL.md"
echo "Installed the tickets skill to $DEST"
echo
echo "In the client's project folder (e.g. cd ~/Desktop/FP\\&LM/fabricportApp), run once:"
echo
echo "  claude mcp add epsilon \\"
echo "    --env EPSILON_PROJECT_TOKEN=<eps_pt_... from admin> \\"
echo "    --env EPSILON_SUPABASE_ANON_KEY=<public anon / publishable key> \\"
echo "    -- \"$PY\" \"$HERE/run.py\""
echo
echo "Then start \`claude\` there and say \"work the tickets\"."
