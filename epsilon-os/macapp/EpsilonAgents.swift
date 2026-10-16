// Epsilon Agents: a menu-bar app that shows which Epsilon OS launchd jobs are running on this Mac.
// Local sources only: `launchctl list`, `ps` (for how long a PID has been up), the job plists and log mtimes.
import AppKit
import SwiftUI

// MARK: - Model

let labelPrefix = "co.epsilon-labs.os."
let logsDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/epsilon-os")
let agentsDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents")

/// Friendly names, same wording as platform/lib/admin-agents.ts AGENT_CATALOG.
let friendlyNames: [String: String] = [
    "prospector": "Prospector", "outreach": "Outreach sends", "tenders": "Tender scan",
    "inbox": "Inbox", "outbox": "Outbox", "brief": "Morning brief", "backup": "Backup",
    "scheduler": "Scheduler", "watchdog": "Watchdog", "worker": "Worker",
    "project_agent": "Project agent", "dashboard": "Local cockpit", "keepawake": "Keep-awake",
]

enum AgentState: Int { case running = 0, failed = 1, idle = 2 }

struct Agent: Identifiable {
    let key: String            // "inbox"
    var id: String { key }
    var name: String { friendlyNames[key] ?? key }
    let pid: Int?              // set = running right now
    let lastExit: Int?         // nil when launchctl shows "-" or the job is not loaded
    let loaded: Bool
    let service: Bool          // KeepAlive job (cockpit, keep-awake): expected to be always on
    let cadence: String        // "every 5m", "daily 07:00", "always on"
    let runningFor: TimeInterval?
    let lastLog: Date?         // log mtime, roughly the last run

    var state: AgentState {
        if pid != nil { return .running }
        if !loaded { return .idle }
        if service { return .failed }                      // an always-on job with no PID is down
        if let e = lastExit, e != 0 { return .failed }
        return .idle
    }

    func detail(now: Date = Date()) -> String {
        switch state {
        case .running: return "running · " + ago(runningFor ?? 0)
        case .failed:
            if pid == nil && service { return "stopped" + (lastExit.map { " · exit \($0)" } ?? "") }
            return "failed · exit \(lastExit ?? 0)"
        case .idle:
            if !loaded { return "not loaded" }
            guard let t = lastLog else { return "idle" }
            return "idle · last " + ago(now.timeIntervalSince(t)) + " ago"
        }
    }
}

func ago(_ s: TimeInterval) -> String {
    let s = max(0, Int(s))
    if s < 60 { return "\(s)s" }
    if s < 3600 { return "\(s / 60)m" }
    if s < 86400 { return "\(s / 3600)h" }
    return "\(s / 86400)d"
}

// MARK: - Scanner

func run(_ path: String, _ args: [String]) -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: path)
    p.arguments = args
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return "" }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(decoding: data, as: UTF8.self)
}

/// `ps` etime is "[[dd-]hh:]mm:ss".
func parseEtime(_ s: String) -> TimeInterval? {
    var days = 0.0, rest = Substring(s)
    if let dash = s.firstIndex(of: "-") { days = Double(s[..<dash]) ?? 0; rest = s[s.index(after: dash)...] }
    let parts = rest.split(separator: ":").compactMap { Double($0) }
    guard !parts.isEmpty else { return nil }
    return days * 86400 + parts.reduce(0) { $0 * 60 + $1 }
}

struct PlistInfo { let cadence: String; let service: Bool; let log: URL }

func readPlist(_ key: String) -> PlistInfo {
    let url = agentsDir.appendingPathComponent(labelPrefix + key + ".plist")
    let d = (NSDictionary(contentsOf: url) as? [String: Any]) ?? [:]
    let log = (d["StandardOutPath"] as? String).map { URL(fileURLWithPath: $0) }
        ?? logsDir.appendingPathComponent(key + ".log")
    let keepAlive = (d["KeepAlive"] as? Bool) ?? (d["KeepAlive"] != nil)
    var cadence = ""
    if keepAlive { cadence = "always on" }
    else if let n = d["StartInterval"] as? Int { cadence = "every " + ago(TimeInterval(n)) }
    else if let c = d["StartCalendarInterval"] as? [String: Int] ?? (d["StartCalendarInterval"] as? [[String: Int]])?.first {
        let time = String(format: "%02d:%02d", c["Hour"] ?? 0, c["Minute"] ?? 0)
        let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        cadence = c["Weekday"].map { "weekly \(days[$0 % 8]) \(time)" } ?? "daily \(time)"
    }
    return PlistInfo(cadence: cadence, service: keepAlive, log: log)
}

/// One `launchctl list`, one `ps` for running PIDs, plus a stat per log file.
func scan() -> [Agent] {
    var listed: [String: (pid: Int?, exit: Int?)] = [:]
    for line in run("/bin/launchctl", ["list"]).split(separator: "\n") {
        let f = line.split(separator: "\t", omittingEmptySubsequences: false)
        guard f.count == 3, f[2].hasPrefix(labelPrefix) else { continue }
        listed[String(f[2].dropFirst(labelPrefix.count))] = (Int(f[0]), Int(f[1]))
    }
    // Jobs with a plist on disk but not loaded still get a row ("not loaded").
    let onDisk = ((try? FileManager.default.contentsOfDirectory(atPath: agentsDir.path)) ?? [])
        .filter { $0.hasPrefix(labelPrefix) && $0.hasSuffix(".plist") }
        .map { String($0.dropFirst(labelPrefix.count).dropLast(".plist".count)) }

    let pids = listed.values.compactMap { $0.pid }
    var uptime: [Int: TimeInterval] = [:]
    if !pids.isEmpty {
        for line in run("/bin/ps", ["-o", "pid=,etime=", "-p", pids.map(String.init).joined(separator: ",")]).split(separator: "\n") {
            let f = line.split(separator: " ")
            if f.count == 2, let p = Int(f[0]), let t = parseEtime(String(f[1])) { uptime[p] = t }
        }
    }

    return Set(listed.keys).union(onDisk).map { key in
        let l = listed[key], info = readPlist(key)
        let mtime = (try? FileManager.default.attributesOfItem(atPath: info.log.path))?[.modificationDate] as? Date
        return Agent(key: key, pid: l?.pid, lastExit: l?.exit, loaded: l != nil, service: info.service,
                     cadence: info.cadence, runningFor: l?.pid.flatMap { uptime[$0] }, lastLog: mtime)
    }.sorted { ($0.state.rawValue, $0.name) < ($1.state.rawValue, $1.name) }
}

// MARK: - App state

final class Store: ObservableObject {
    @Published var agents: [Agent] = []
    @Published var updated = Date()
    private var timer: Timer?
    var isOpen = false { didSet { if isOpen != oldValue { refresh(); schedule() } } }

    init() { refresh(); schedule() }

    func schedule() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: isOpen ? 5 : 30, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func refresh() {
        DispatchQueue.global(qos: .utility).async {
            let a = scan()
            DispatchQueue.main.async { self.agents = a; self.updated = Date() }
        }
    }

    var menuTitle: String { Main.titleFor(agents) }
    var runningCount: Int { agents.filter { $0.state == .running && !$0.service }.count }
    var anyFailed: Bool { agents.contains { $0.state == .failed } }

    // Keep-awake is the launchd job co.epsilon-labs.os.keepawake (`caffeinate -ims`). Turning it off disables the job
    // (so it stays off across logins) and stops it; turning it on re-enables and starts it. install_jobs.sh turns it on.
    var keepAwakeOn: Bool { agents.first { $0.key == "keepawake" }?.state == .running }
    func setKeepAwake(_ on: Bool) {
        let label = "co.epsilon-labs.os.keepawake"
        let uid = getuid()
        let plist = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/\(label).plist").path
        DispatchQueue.global(qos: .userInitiated).async {
            if on {
                _ = run("/bin/launchctl", ["enable", "gui/\(uid)/\(label)"])
                _ = run("/bin/launchctl", ["bootstrap", "gui/\(uid)", plist])
                _ = run("/bin/launchctl", ["kickstart", "gui/\(uid)/\(label)"])
            } else {
                _ = run("/bin/launchctl", ["disable", "gui/\(uid)/\(label)"])
                _ = run("/bin/launchctl", ["bootout", "gui/\(uid)/\(label)"])
            }
            Thread.sleep(forTimeInterval: 0.5)
            DispatchQueue.main.async { self.refresh() }
        }
    }
}

// MARK: - Views

struct StatusDot: View {
    let state: AgentState
    // A steady dot. A repeatForever animation started in onAppear leaked into the MenuBarExtra window's own frame
    // transaction, so the whole panel drifted back and forth across the screen.
    var body: some View {
        Circle()
            .fill(state == .running ? Color.green : state == .failed ? Color.red : Color.secondary.opacity(0.45))
            .frame(width: 8, height: 8)
    }
}

struct AgentList: View {
    @ObservedObject var store: Store
    static let clock: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; return f }()
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Epsilon OS agents").font(.headline).padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
            Divider()
            VStack(spacing: 2) {
                if store.agents.isEmpty {
                    Text("No co.epsilon-labs.os jobs found").foregroundStyle(.secondary).padding(14)
                }
                ForEach(store.agents) { a in
                    HStack(spacing: 10) {
                        StatusDot(state: a.state).id("\(a.key)-\(a.state.rawValue)")
                        Text(a.name).lineLimit(1)
                        Spacer(minLength: 12)
                        Text(a.detail())
                            .font(.system(.callout).monospacedDigit())
                            .foregroundStyle(a.state == .failed ? Color.red : a.state == .running ? Color.primary : Color.secondary)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 4)
                    .help("\(a.key) · \(a.cadence.isEmpty ? "no schedule" : a.cadence)" + (a.pid.map { " · PID \($0)" } ?? ""))
                }
            }
            .padding(.vertical, 6)
            Divider()
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Keep Mac awake")
                    Text(store.keepAwakeOn ? "Jobs run on time while you are away."
                                           : "The Mac may sleep; Mac jobs pause and catch up when it wakes.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Toggle("Keep Mac awake", isOn: Binding(get: { store.keepAwakeOn }, set: { store.setKeepAwake($0) }))
                    .labelsHidden()
                    .toggleStyle(.switch)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            Divider()
            HStack(spacing: 8) {
                Text("Updated " + Self.clock.string(from: store.updated))
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary).fixedSize()
                Spacer()
                Button("Open admin") { NSWorkspace.shared.open(URL(string: "https://admin.epsilon-labs.co/agents")!) }
                Button("Logs") { NSWorkspace.shared.open(logsDir) }.help("Open logs folder")
                Button("Quit") { NSApp.terminate(nil) }
            }
            .controlSize(.small)
            .padding(.horizontal, 14).padding(.vertical, 10)
        }
        .frame(width: 330)
        .fixedSize(horizontal: false, vertical: true)
        .transaction { $0.animation = nil } // the panel never animates its own size or position
    }
}

struct EpsilonAgentsApp: App {
    @StateObject private var store = Store()
    var body: some Scene {
        MenuBarExtra {
            AgentList(store: store)
                .onAppear { store.isOpen = true }
                .onDisappear { store.isOpen = false }
                .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in store.isOpen = true }
                .onReceive(NotificationCenter.default.publisher(for: NSWindow.didResignKeyNotification)) { _ in store.isOpen = false }
        } label: {
            // the website's ε mark as a template image (full menu-bar height, follows light/dark), plus the count
            Image(nsImage: Main.menuIcon)
            if store.runningCount > 0 || store.anyFailed {
                Text((store.runningCount > 0 ? "\(store.runningCount)" : "") + (store.anyFailed ? "!" : ""))
            }
        }
        .menuBarExtraStyle(.window)
    }
}

// MARK: - Entry point
// EpsilonAgents             menu-bar app
// EpsilonAgents --dump      print the agent list to stdout and exit
// EpsilonAgents --snapshot out.png   render the popover to a PNG and exit (for checking the layout)

@main
enum Main {
    static func main() {
        let args = CommandLine.arguments
        if args.contains("--icon") {
            let i = menuIcon
            print("icon \(i.size.width)x\(i.size.height) reps=\(i.representations.count) template=\(i.isTemplate)")
            return
        }
        if args.contains("--dump") {
            let agents = scan()
            for a in agents {
                let dot = a.state == .running ? "●" : a.state == .failed ? "✕" : "○"
                print("\(dot) \(a.name.padding(toLength: 16, withPad: " ", startingAt: 0)) \(a.detail().padding(toLength: 24, withPad: " ", startingAt: 0)) [\(a.key), \(a.cadence)\(a.pid.map { ", pid \($0)" } ?? "")]")
            }
            print("menu bar: " + titleFor(agents))
            return
        }
        if let i = args.firstIndex(of: "--snapshot"), i + 1 < args.count {
            snapshot(to: args[i + 1])
            return
        }
        EpsilonAgentsApp.main()
    }

    /// "ε 2 !": count of scheduled agents doing work now (always-on services would make it noise), "!" if any failed.
    /// The traced ε from assets/brand/epsilon.svg, as a template image 15.3 pt tall.
    static let menuIcon: NSImage = {
        let svg = ##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 730 1000"><path fill="#000" fill-rule="evenodd" d="M414.13 0.03C398.75 0.70 361.75 -2.60 324.74 4.00C287.74 10.59 227.67 25.14 192.11 39.60C156.55 54.06 133.03 72.83 111.38 90.75C89.73 108.67 73.38 129.55 62.21 147.11C51.05 164.67 48.09 181.23 44.41 196.13C40.73 211.02 40.38 221.60 40.14 236.49C39.90 251.39 39.76 269.46 42.98 285.51C46.20 301.56 48.56 314.55 59.48 332.81C70.39 351.07 83.38 374.13 108.47 395.08C133.55 416.03 209.03 439.99 209.99 458.51C210.96 477.03 139.30 490.81 114.26 506.19C89.22 521.57 74.43 536.14 59.73 550.78C45.02 565.42 34.46 581.05 26.04 594.03C17.62 607.00 13.55 611.33 9.21 628.63C4.87 645.93 -0.21 669.50 0.00 697.83C0.21 726.15 3.44 771.20 10.46 798.59C17.48 825.98 29.73 843.41 42.11 862.18C54.49 880.94 68.87 896.81 84.74 911.19C100.61 925.57 114.22 936.42 137.33 948.44C160.43 960.45 195.51 975.18 223.38 983.27C251.25 991.37 279.02 994.21 304.56 997.00C330.10 999.78 340.12 1001.78 376.64 1000.00C413.17 998.22 485.73 992.05 523.69 986.35C561.66 980.64 576.07 975.31 604.43 965.78C632.78 956.25 673.91 938.74 693.81 929.17C713.71 919.59 717.80 915.63 723.83 908.31C729.86 900.99 729.24 894.18 730.00 885.24C730.76 876.31 731.56 860.78 728.41 854.70C725.26 848.62 731.29 844.97 711.11 848.78C690.93 852.58 640.47 870.34 607.31 877.55C574.15 884.75 541.47 888.95 512.16 892.01C482.85 895.08 456.41 896.23 431.43 895.92C406.44 895.61 389.14 896.01 362.23 890.18C335.32 884.35 293.99 872.84 269.96 860.93C245.93 849.02 232.75 835.80 218.06 818.71C203.37 801.62 189.06 780.93 181.79 758.38C174.52 735.83 174.49 705.03 174.42 683.41C174.35 661.78 173.90 648.81 181.38 628.63C188.86 608.44 204.85 580.09 219.28 562.31C233.72 544.53 252.34 531.60 268.00 521.94C283.65 512.29 291.74 505.79 313.21 504.39C334.68 503.00 352.62 512.30 396.83 513.57C441.04 514.83 545.53 515.40 578.48 511.99C611.42 508.58 591.81 504.91 594.50 493.11C597.19 481.31 596.30 453.61 594.59 441.21C592.88 428.81 626.81 422.25 584.24 418.72C541.67 415.20 387.19 421.11 339.16 420.05C291.13 418.99 307.94 417.02 296.04 412.38C284.13 407.73 278.64 403.73 267.72 392.19C256.79 380.66 239.66 362.40 230.47 343.18C221.28 323.95 214.81 301.37 212.60 276.86C210.39 252.35 211.01 218.97 217.20 196.13C223.40 173.28 238.10 154.43 249.78 139.78C261.45 125.13 273.32 116.76 287.26 108.21C301.20 99.67 310.33 93.48 333.39 88.52C356.46 83.56 394.90 78.40 425.66 78.45C456.41 78.49 490.53 81.60 517.93 88.78C545.32 95.96 568.69 99.78 590.01 121.51C611.33 143.25 633.78 200.03 645.86 219.19C657.95 238.36 655.47 232.93 662.50 236.49C669.53 240.05 682.25 241.51 688.04 240.55C693.83 239.59 695.05 260.24 697.25 230.73C699.44 201.22 701.56 95.69 701.21 63.49C700.86 31.30 703.09 44.39 695.13 37.54C687.17 30.69 678.17 28.06 653.44 22.39C628.71 16.73 586.16 7.29 546.76 3.56C507.35 -0.17 439.12 0.59 417.01 0.00C394.90 -0.59 429.50 -0.63 414.13 0.03Z"/></svg>"##
        let img = NSImage(data: Data(svg.utf8)) ?? NSImage(size: NSSize(width: 13, height: 18))
        img.size = NSSize(width: 11.1, height: 15.3) // 15% smaller than full height (founder)
        img.isTemplate = true
        return img
    }()

    static func titleFor(_ agents: [Agent]) -> String {
        let n = agents.filter { $0.state == .running && !$0.service }.count
        return "ε" + (n > 0 ? " \(n)" : "") + (agents.contains { $0.state == .failed } ? " !" : "")
    }

    static func snapshot(to path: String) {
        MainActor.assumeIsolated {
            let store = Store()
            store.agents = scan()
            for dark in [false, true] {
                let view = AgentList(store: store)
                    .background(Color(nsColor: .windowBackgroundColor))
                    .environment(\.colorScheme, dark ? .dark : .light)
                let r = ImageRenderer(content: view)
                r.scale = 2
                guard let img = r.nsImage, let tiff = img.tiffRepresentation,
                      let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
                    FileHandle.standardError.write("render failed\n".data(using: .utf8)!); exit(1)
                }
                let out = dark ? path.replacingOccurrences(of: ".png", with: "-dark.png") : path
                do { try png.write(to: URL(fileURLWithPath: out)); print("wrote \(out)") }
                catch { FileHandle.standardError.write("write failed: \(error)\n".data(using: .utf8)!); exit(1) }
            }
        }
    }
}
