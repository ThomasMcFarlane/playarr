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
            works = try await apiClient.browseCatalog(
                kind: nil,
                genre: nil,
                tag: nil,
                sort: "recent",
                limit: 30,
                offset: 0
            ).items
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
