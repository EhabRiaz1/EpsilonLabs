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
}

// MARK: - Views

struct StatusDot: View {
    let state: AgentState
    @State private var pulse = false
    var body: some View {
        Circle()
            .fill(state == .running ? Color.green : state == .failed ? Color.red : Color.secondary.opacity(0.45))
            .frame(width: 8, height: 8)
            .opacity(state == .running && pulse ? 0.35 : 1)
            .onAppear {
                guard state == .running else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
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
            Text(store.menuTitle)
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
