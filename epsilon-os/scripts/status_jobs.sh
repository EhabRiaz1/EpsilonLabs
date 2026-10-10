#!/bin/bash
# Print launchd state and the last log line for each Epsilon OS job.
DOMAIN="gui/$(id -u)"
LOG_DIR="$HOME/Library/Logs/epsilon-os"
for j in dashboard inbox outbox brief backup prospector outreach tenders keepawake; do
  l="co.epsilon-labs.os.$j"
  echo "== $j"
  if out=$(launchctl print "$DOMAIN/$l" 2>/dev/null); then
    echo "$out" | grep -E "^\s*(state|runs|last exit code|pid) =" | sed 's/^[[:space:]]*/   /'
  else
    echo "   not loaded"
  fi
  f="$LOG_DIR/$j.log"; [[ -f "$f" ]] || f="$LOG_DIR/$j.out.log"
  if [[ -s "$f" ]]; then echo "   last log: $(tail -n 1 "$f")"; else echo "   last log: (none)"; fi
done
