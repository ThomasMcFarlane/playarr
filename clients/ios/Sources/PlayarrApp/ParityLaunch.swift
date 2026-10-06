import Foundation

#if DEBUG
/// Launch-argument hooks used only by the pixel-parity workflow
/// (`.github/workflows/parity-apple.yml`). They sign the app in against a
/// fixture server and open one named screen, so a simulator screenshot can be
/// compared with the web mobile reference. Compiled out of Release builds.
///
///     --playarr-parity-server <url> --playarr-parity-user <name>
///     --playarr-parity-password <password> --playarr-parity-screen <id>
///     [--playarr-parity-title <catalogue title>] [--playarr-parity-query <text>]
enum ParityLaunch {
    private static func value(_ flag: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.lastIndex(of: flag), index + 1 < args.count else { return nil }
        return args[index + 1]
    }

    static var server: String? { value("--playarr-parity-server") }
    static var user: String? { value("--playarr-parity-user") }
    static var password: String? { value("--playarr-parity-password") }
    static var screen: String? { value("--playarr-parity-screen") }
    static var title: String? { value("--playarr-parity-title") }
    static var query: String? { value("--playarr-parity-query") }
    static var isActive: Bool { server != nil && user != nil }
}
#endif
