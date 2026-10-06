import Foundation

#if DEBUG
/// Launch-argument hooks used only by the pixel-parity workflow
/// (`.github/workflows/parity-apple.yml`). They sign the app in against a
/// fixture server and open one named screen, so a simulator screenshot can be
/// compared with the web mobile reference. Compiled out of Release builds.
///
///     --playarr-parity-server <url> --playarr-parity-user <name>
///     --playarr-parity-password <password> --playarr-parity-route <route>
///
/// Routes: `home`, `movies`, `series`, `settings`, `profiles`, `search:<text>`,
/// `detail:<movie|series>:<title>`.
enum ParityLaunch {
    private static func value(_ flag: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.lastIndex(of: flag), index + 1 < args.count else { return nil }
        return args[index + 1]
    }

    static var server: String? { value("--playarr-parity-server") }
    static var user: String? { value("--playarr-parity-user") }
    static var password: String? { value("--playarr-parity-password") }
    static var route: String? { value("--playarr-parity-route") }
    private static var parts: [String] {
        (route ?? "").split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
    }
    static var screen: String? {
        guard let head = parts.first, !head.isEmpty else { return nil }
        switch head {
        case "detail": return parts.count > 1 && parts[1] == "series" ? "detail-series" : "detail-film"
        default: return head
        }
    }
    static var title: String? { parts.first == "detail" && parts.count > 2 ? parts[2] : nil }
    static var query: String? { parts.first == "search" && parts.count > 1 ? parts[1] : nil }
    /// `--playarr-parity-now <ISO 8601>`: the instant the web reference was captured at.
    static var frozenNow: Date? {
        guard let raw = value("--playarr-parity-now") else { return nil }
        return ISO8601DateFormatter().date(from: raw)
    }
    static var isActive: Bool { server != nil && user != nil }
}
#endif
