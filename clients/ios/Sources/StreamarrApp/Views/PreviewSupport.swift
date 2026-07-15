import Foundation
import StreamarrKit

/// Canned `StreamarrAPIClient` conformance used only by `#Preview`s in this
/// directory, so previews render without a live server. Never referenced
/// from `App.swift`/`AppEnvironment` at runtime.
struct PreviewAPIClient: StreamarrAPIClient {
    func fetchVersionEnvelope() async throws -> VersionEnvelope {
        VersionEnvelope(serverVersion: "0.1.0", apiVersion: "v1")
    }

    func fetchLibraries() async throws -> [SourceInstance] { [] }

    func fetchWorks(libraryID: UUID?, page: Int, pageSize: Int) async throws -> [Work] { [] }

    func fetchWork(id: UUID) async throws -> Work {
        throw APIError.notImplemented("PreviewAPIClient.fetchWork")
    }

    func fetchSeries(workID: UUID) async throws -> Series {
        throw APIError.notImplemented("PreviewAPIClient.fetchSeries")
    }

    func fetchSeasons(seriesID: UUID) async throws -> [Season] { [] }

    func fetchEpisodes(seasonID: UUID) async throws -> [Episode] { [] }

    func fetchMediaFiles(workID: UUID) async throws -> [MediaFile] { [] }

    func fetchContinueWatching(limit: Int) async throws -> [PlaybackSession] { [] }

    func startPlaybackSession(workID: UUID, mediaFileID: UUID, deviceID: UUID) async throws -> PlaybackSession {
        throw APIError.notImplemented("PreviewAPIClient.startPlaybackSession")
    }

    func recordPlaybackEvent(_ event: PlaybackEvent) async throws {}

    func endPlaybackSession(id: UUID, stopReason: StopReason) async throws {}

    func fetchCurrentUser() async throws -> User {
        throw APIError.notImplemented("PreviewAPIClient.fetchCurrentUser")
    }
}
