import AVFoundation
import Combine
import Foundation
import Observation
import StreamarrKit

@MainActor
@Observable
final class TVHomeViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var works: [Work] = []
    private let apiClient: StreamarrAPIClient

    init(apiClient: StreamarrAPIClient) {
        self.apiClient = apiClient
    }

    func load() async {
        state = .loading
        do {
            works = try await apiClient.browseCatalog(
                kind: nil,
                genre: nil,
                tag: nil,
                sort: "recent",
                limit: 30,
                offset: 0
            ).items
            state = .loaded
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

@MainActor
@Observable
final class TVSearchViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    var query = ""
    private(set) var state: State = .idle
    private(set) var results: [Work] = []
    private let apiClient: StreamarrAPIClient

    init(apiClient: StreamarrAPIClient) {
        self.apiClient = apiClient
    }

    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            results = []
            state = .idle
            return
        }

        state = .loading
        do {
            results = try await apiClient.searchCatalog(query: trimmed, limit: 50)
            state = .loaded
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

@MainActor
@Observable
final class TVWorkDetailViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var detail: WorkDetail?
    private let workID: UUID
    private let apiClient: StreamarrAPIClient

    init(workID: UUID, apiClient: StreamarrAPIClient) {
        self.workID = workID
        self.apiClient = apiClient
    }

    func load() async {
        state = .loading
        do {
            detail = try await apiClient.fetchWork(id: workID)
            state = .loaded
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

@MainActor
@Observable
final class TVPlayerViewModel {
    enum State: Equatable {
        case idle
        case negotiating
        case ready
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var playbackMode: PlaybackMode?
    let engine: PlayerEngine

    var player: AVPlayer { engine.avPlayer }

    private let apiClient: StreamarrAPIClient

    init(apiClient: StreamarrAPIClient, engine: PlayerEngine = AVPlayerEngine()) {
        self.apiClient = apiClient
        self.engine = engine
    }

    func play(mediaFileID: UUID, title: String) async {
        state = .negotiating
        do {
            let info = try await apiClient.playbackInfo(
                mediaFileID: mediaFileID,
                containers: ["mp4", "mov", "m4v", "mkv"],
                videoCodecs: ["h264", "hevc"],
                audioCodecs: ["aac", "ac3", "eac3"],
                maxBitrateBps: 40_000_000,
                profile: "apple-tv"
            )
            guard let streamURL = apiClient.resolvedURL(forPath: info.url) else {
                throw APIError.invalidResponse
            }

            playbackMode = info.mode
            try await engine.load(PlayableItem(id: mediaFileID, streamURL: streamURL, title: title))
            engine.play()
            state = .ready
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func stop() {
        engine.stop()
        state = .idle
    }
}
