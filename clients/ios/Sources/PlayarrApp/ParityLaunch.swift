import Foundation
import PlayarrKit
import SwiftUI

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
/// `detail:<movie|series>:<title>`, `player:movie:<title>` (the film paused at 2.0 s with the
/// controls up) and `player-quality:movie:<title>` (the same with the quality menu open).
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
    static var isPlayerRoute: Bool { parts.first == "player" || parts.first == "player-quality" }
    static var title: String? {
        ["detail", "player", "player-quality"].contains(parts.first ?? "") && parts.count > 2 ? parts[2] : nil
    }
    static var query: String? { parts.first == "search" && parts.count > 1 ? parts[1] : nil }
    static var isActive: Bool { server != nil && user != nil }
}

/// Resolves the fixture film named in the launch route to its media file through the catalogue,
/// then shows the player on it.
struct ParityPlayerHost: View {
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @State private var target: (id: UUID, title: String)?

    var body: some View {
        NavigationStack {
            if let target {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: target.id.uuidString,
                    initialTitle: target.title
                )
            } else {
                Color.black.ignoresSafeArea()
            }
        }
        .task {
            guard target == nil, let title = ParityLaunch.title else { return }
            let page = try? await apiClient.browseCatalog(kind: .movie, genre: nil, tag: nil, sort: nil, limit: 100, offset: nil)
            guard let work = page?.items.first(where: { $0.title == title }),
                  let detail = try? await apiClient.fetchWork(id: work.id),
                  let mediaFileID = detail.mediaFileID else { return }
            target = (mediaFileID, title)
        }
    }
}
#endif
