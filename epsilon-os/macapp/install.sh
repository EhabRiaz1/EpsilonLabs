#!/bin/bash
# Build + install EpsilonAgents.app and a login LaunchAgent, then (re)start it.
# ./install.sh --uninstall removes the LaunchAgent and the app.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="co.epsilon-labs.agents-menubar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/Applications/EpsilonAgents.app"
DOMAIN="gui/$(id -u)"

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then launchctl bootout "$DOMAIN/$LABEL" || true; fi
pkill -x EpsilonAgents || true

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$PLIST"; rm -rf "$APP"
  echo "uninstalled $LABEL and $APP"
  exit 0
fi

"$HERE/build.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$APP/Contents/MacOS/EpsilonAgents</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "loaded $LABEL (starts at login)"
