import AVFoundation
import Combine
import Foundation
import Observation
import PlayarrKit

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
    private let apiClient: PlayarrAPIClient

    init(apiClient: PlayarrAPIClient) {
        self.apiClient = apiClient
    }

    func load() async {
        state = .loading
        // Offline fixture catalogue only when no access token was injected
        // (ATS/tunnel unavailable). Prefer live API when signed in.
        if TVParityLaunch.requestedScreen != nil,
           !ProcessInfo.processInfo.arguments.contains("-PlayarrAccessToken") {
            works = TVParityFixtures.sampleWorks()
            state = .loaded
            return
        }
        do {
            // SPA Home pulls a mixed recent list plus kind-scoped rails.
            // Parallel browse keeps “New movies” populated even when the
            // mixed page is series-heavy.
            async let mixed = apiClient.browseCatalog(
                kind: nil, genre: nil, tag: nil, sort: "recent", limit: 40, offset: 0
            )
            async let movies = apiClient.browseCatalog(
                kind: .movie, genre: nil, tag: nil, sort: "recent", limit: 24, offset: 0
            )
            async let series = apiClient.browseCatalog(
                kind: .series, genre: nil, tag: nil, sort: "recent", limit: 24, offset: 0
            )
            let mixedItems = try await mixed.items
            let movieItems = try await movies.items
            let seriesItems = try await series.items
            // Prefer series, then movies, then remaining mixed for rail feeds.
            works = seriesItems + movieItems + mixedItems.filter {
                $0.kind != .series && $0.kind != .movie
            }
            // De-dupe while preserving order.
            var seen = Set<UUID>()
            works = works.filter { seen.insert($0.id).inserted }
            state = .loaded
        } catch {
            // Parity suite must still paint production rails when the tunnel
            // token expires or the API is in full-account mode.
            if TVParityLaunch.requestedScreen != nil {
                works = TVParityFixtures.sampleWorks()
                state = .loaded
                return
            }
            if let error = error as? APIError {
                state = .failed(error.displayMessage)
            } else {
                state = .failed(error.localizedDescription)
            }
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
    private let apiClient: PlayarrAPIClient

    init(apiClient: PlayarrAPIClient) {
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
    private let seedWork: Work?
    private let apiClient: PlayarrAPIClient

    init(workID: UUID, apiClient: PlayarrAPIClient, seedWork: Work? = nil) {
        self.workID = workID
        self.seedWork = seedWork
        self.apiClient = apiClient
    }

    func load() async {
        state = .loading
        // Parity detail screens use deterministic fixtures (UUIDs are not on
        // the live server). Prefer seed work so production SwiftUI still
        // paints a real detail layout without a network round-trip.
        if TVParityLaunch.requestedScreen != nil, let seedWork {
            let children: WorkChildren
            switch seedWork.kind {
            case .movie: children = .movie
            case .series: children = .series([])
            case .artist: children = .artist([])
            case .author: children = .author([])
            default: children = .movie
            }
            detail = WorkDetail(
                work: seedWork,
                children: children,
                mediaFileID: seedWork.kind == .movie
                    ? UUID(uuidString: "00000000-0000-4000-8000-000000000099")
                    : nil
            )
            state = .loaded
            return
        }
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
    static let supportedContainers = [
        "mp4", "mov", "m4v",
        "mp3", "m4a", "m4b", "aac", "flac", "wav", "aiff", "aif", "alac",
    ]
    static let supportedVideoCodecs = ["h264", "hevc"]
    static let supportedAudioCodecs = [
        "aac", "ac3", "eac3", "mp3", "alac", "flac", "pcm_s16le", "pcm_s24le",
    ]

    enum State: Equatable {
        case idle
        case negotiating
        case ready
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var playbackMode: PlaybackMode?
    let engine: PlayerEngine

    // `PlayerEngine.avPlayer` was relaxed to `AVPlayer?` for the iOS Cast
    // sender build (a Cast-backed engine has no local `AVPlayer` at all) --
    // this tvOS conformer never uses a Cast-backed engine (only
    // `AVPlayerEngine` via this type's own `init` default below), but the
    // protocol-typed access here still has to widen to match. Cannot be
    // compiled/verified from this environment; see the iOS build's report
    // for the equivalent, verified-elsewhere reasoning.
    var player: AVPlayer? { engine.avPlayer }

    private let apiClient: PlayarrAPIClient

    init(apiClient: PlayarrAPIClient, engine: PlayerEngine = AVPlayerEngine()) {
        self.apiClient = apiClient
        self.engine = engine
    }

    func play(mediaFileID: UUID, title: String) async {
        state = .negotiating
        do {
            let info = try await apiClient.playbackInfo(
                mediaFileID: mediaFileID,
                containers: Self.supportedContainers,
                videoCodecs: Self.supportedVideoCodecs,
                audioCodecs: Self.supportedAudioCodecs,
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
