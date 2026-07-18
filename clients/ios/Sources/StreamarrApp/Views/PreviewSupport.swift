import Foundation
import StreamarrKit

/// Canned `StreamarrAPIClient` used by SwiftUI previews and the debug-only
/// `--playarr-demo` rendered-layout check. Release builds never select it.
struct PreviewAPIClient: StreamarrAPIClient {
    var baseURL: URL { URL(string: "http://localhost:8484")! }

    private static let works: [Work] = [
        sample("Voyage", kind: .movie, id: "00000000-0000-0000-0000-000000000001", genres: ["Science Fiction", "Drama"]),
        sample("Test Series Beta", kind: .series, id: "00000000-0000-0000-0000-000000000002", genres: ["Drama", "Mystery"]),
        sample("Sample Title: Part Two", kind: .movie, id: "00000000-0000-0000-0000-000000000003", genres: ["Science Fiction"]),
        sample("Test Series H", kind: .series, id: "00000000-0000-0000-0000-000000000004", genres: ["Science Fiction"]),
        sample("Massive Attack", kind: .artist, id: "00000000-0000-0000-0000-000000000005", genres: ["Trip-hop"]),
        sample("Sample Movie 2049", kind: .movie, id: "00000000-0000-0000-0000-000000000006", genres: ["Science Fiction", "Thriller"]),
    ]

    private static func sample(_ title: String, kind: WorkKind, id: String, genres: [String]) -> Work {
        Work(
            id: UUID(uuidString: id)!,
            kind: kind,
            title: title,
            sortTitle: title,
            overview: "A cinematic story selected from your Streamarr library.",
            genres: genres,
            addedAt: Date(),
            monitored: true,
            availability: .available
        )
    }

    func fetchHealth() async throws {}
    func fetchReadiness() async throws {}

    func fetchVersion() async throws -> VersionEnvelope {
        VersionEnvelope(serverVersion: "0.1.0", apiVersion: "v1")
    }

    func login(_ body: LoginRequest) async throws -> LoginResponse {
        LoginResponse(accessToken: "preview", refreshToken: "preview", tokenType: "Bearer", expiresIn: 3600, userID: UUID())
    }

    func browseCatalog(
        kind: WorkKind?,
        genre: String?,
        tag: String?,
        sort: String?,
        limit: Int?,
        offset: Int?
    ) async throws -> CatalogPage {
        let items = kind.map { selected in Self.works.filter { $0.kind == selected } } ?? Self.works
        return CatalogPage(items: items, total: Int64(items.count))
    }

    func searchCatalog(query: String, limit: Int?) async throws -> [Work] {
        Self.works.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    func fetchWork(id: UUID) async throws -> WorkDetail {
        guard let work = Self.works.first(where: { $0.id == id }) else {
            throw APIError.notFound(nil)
        }
        let children: WorkChildren = switch work.kind {
        case .movie, .site: .movie
        case .series: .series([])
        case .artist: .artist([])
        case .author: .author([])
        }
        return WorkDetail(work: work, children: children, mediaFileID: work.kind == .movie ? UUID() : nil)
    }

    func listCatalogKinds() async throws -> [WorkKind] { [.series, .movie, .artist] }

    func listWatchProgress() async throws -> [WatchProgress] {
        [
            WatchProgress(
                mediaFileID: UUID(),
                workID: Self.works[0].id,
                positionMS: 2_100_000,
                durationMS: 6_900_000,
                state: .partWatched,
                updatedAt: Date()
            ),
        ]
    }

    func listPlaylists() async throws -> [Playlist] {
        [
            Playlist(
                id: UUID(uuidString: "00000000-0000-0000-0000-000000000010")!,
                name: "Weekend films",
                isSystem: false,
                mediaType: .video,
                createdAt: Date(),
                updatedAt: Date()
            ),
        ]
    }

    func listProfiles() async throws -> [AvailableProfile] {
        [
            AvailableProfile(
                id: UUID(uuidString: "00000000-0000-0000-0000-000000000020")!,
                username: "thomas",
                displayName: "Thomas",
                pinLocked: false,
                isCurrent: true
            ),
            AvailableProfile(
                id: UUID(uuidString: "00000000-0000-0000-0000-000000000021")!,
                username: "guest",
                displayName: "Guest",
                pinLocked: true,
                isCurrent: false
            ),
        ]
    }

    func playbackInfo(
        mediaFileID: UUID,
        containers: [String],
        videoCodecs: [String],
        audioCodecs: [String],
        maxBitrateBps: Int64?,
        profile: String?
    ) async throws -> PlaybackInfoResponse {
        throw APIError.notFound(nil)
    }

    func sendWebhook(instanceID: UUID, payload: Data) async throws {}

    func resolvedURL(forPath path: String) -> URL? {
        URL(string: path, relativeTo: baseURL)?.absoluteURL
    }
}
