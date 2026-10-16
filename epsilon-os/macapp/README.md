# Epsilon Agents (menu bar)

A tiny macOS menu-bar app that shows which Epsilon OS agents are running on this Mac right now.

The menu bar shows `ε`, `ε 2` while two scheduled agents are working, and `ε !` if a job failed.
(Always-on services, Local cockpit and Keep-awake, are listed but not counted.) Click it for one row per job:

- green dot, `running · 2m`: launchd has a PID for it right now (time from `ps` etime)
- grey dot, `idle · last 4m ago`: loaded, no PID, last exit 0 (time = log file mtime, about the last run)
- red dot, `failed · exit 1`: no PID and the last exit status was non-zero
- red dot, `stopped`: an always-on (KeepAlive) job with no PID
- grey, `not loaded`: plist in ~/Library/LaunchAgents but not loaded in launchd

Hover a row for its job key, schedule and PID. The footer has the last update time, Open admin
(admin.epsilon-labs.co/agents), Logs (~/Library/Logs/epsilon-os) and Quit.

Data comes only from this Mac: one `launchctl list`, one `ps` for running PIDs, the
`co.epsilon-labs.os.*` plists, and log-file mtimes. No network, no keys. It refreshes every 5 s
while the panel is open and every 30 s otherwise.

## Install / rebuild

    ./install.sh        # builds, installs ~/Applications/EpsilonAgents.app, adds a login LaunchAgent, starts it

`./build.sh` alone rebuilds and copies the app (then quit and reopen it). Needs `swiftc`
(Xcode or `xcode-select --install`).

Debug modes:

    ~/Applications/EpsilonAgents.app/Contents/MacOS/EpsilonAgents --dump               # print the list
    ~/Applications/EpsilonAgents.app/Contents/MacOS/EpsilonAgents --snapshot /tmp/a.png # render the panel (light + dark)

## Quit / uninstall

Quit from the panel (it comes back at next login), or run `open ~/Applications/EpsilonAgents.app` to start it again.

    ./install.sh --uninstall   # removes the LaunchAgent co.epsilon-labs.agents-menubar and the app
