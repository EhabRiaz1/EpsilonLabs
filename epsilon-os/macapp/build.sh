#!/bin/bash
# Compile EpsilonAgents.swift into EpsilonAgents.app, ad-hoc sign it, and install to ~/Applications.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# Build outside ~/Desktop: Finder/iCloud xattrs there make codesign refuse the bundle.
BUILD="${TMPDIR:-/tmp}/epsilon-agents-build"
APP="$BUILD/EpsilonAgents.app"
DEST="$HOME/Applications/EpsilonAgents.app"

command -v swiftc >/dev/null || { echo "swiftc not found. Install the Command Line Tools: xcode-select --install" >&2; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -parse-as-library -swift-version 5 -target arm64-apple-macos13.0 \
  -o "$APP/Contents/MacOS/EpsilonAgents" "$HERE/EpsilonAgents.swift"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>EpsilonAgents</string>
  <key>CFBundleDisplayName</key><string>Epsilon Agents</string>
  <key>CFBundleIdentifier</key><string>co.epsilon-labs.agents-menubar</string>
  <key>CFBundleExecutable</key><string>EpsilonAgents</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

find "$APP" -exec xattr -c {} +
codesign -s - --force --deep "$APP"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$APP" "$DEST"
echo "installed $DEST"
