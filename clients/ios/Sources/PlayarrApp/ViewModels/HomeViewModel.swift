import Foundation
import Observation
import PlayarrKit

/// View model for `HomeView`. Follows the app's standard pattern: a
/// `@MainActor @Observable final class` that owns its own loaded state and
/// talks to `PlayarrAPIClient` (never `APIClient` concretely, and never
/// touches `URLSession` directly) so it's trivially testable against a
/// fake conformance.
///
/// Mirrors Playarr Web's Home data model: separate recent movie, series and
/// site requests, a deduplicated on-deck rail, and additional type rails.
@MainActor
@Observable
public final class HomeViewModel {
    public struct ProgressItem: Identifiable, Sendable {
        public var work: Work
        public var progress: WatchProgress
        public var id: UUID { work.id }
    }

    public enum LoadState: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    public struct Rail: Identifiable, Equatable, Sendable {
        public let id: String
        public let title: String
        public let works: [Work]

        public init(id: String, title: String, works: [Work]) {
            self.id = id
            self.title = title
            self.works = works
        }
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var recentlyAdded: [Work] = []
    public private(set) var continueWatching: [ProgressItem] = []
    public private(set) var rails: [Rail] = []
    public private(set) var progressByWorkID: [UUID: WatchProgress] = [:]
    /// Smart Start/Resume plans keyed by series work id. A stacked plan
    /// (`needs_choice`) turns the Continue Watching card into a stack card.
    public private(set) var resumePlansByWorkID: [UUID: ResumePlan] = [:]

    public var featuredWork: Work? { rails.first?.works.first ?? recentlyAdded.first }

    private let apiClient: PlayarrAPIClient

    public init(apiClient: PlayarrAPIClient) {
        self.apiClient = apiClient
    }

    public func load() async {
        loadState = .loading
        do {
            async let moviesRequest = browse(kind: .movie)
            async let seriesRequest = browse(kind: .series)
            async let sitesRequest = browse(kind: .site)
            async let progressRequest = apiClient.listWatchProgress()
            let (movies, series, sites) = try await (
                moviesRequest,
                seriesRequest,
                sitesRequest
            )
            recentlyAdded = (movies + series + sites).sorted { $0.addedAt > $1.addedAt }
            rails = Self.makeRails(movies: movies, series: series, sites: sites, onDeck: [])
            loadState = .loaded

            let plans = (try? await ResumePlanClient(transport: apiClient).plans()) ?? []
            resumePlansByWorkID = Dictionary(plans.map { ($0.seriesWorkID, $0) }, uniquingKeysWith: { first, _ in first })
            let progress = (try? await progressRequest) ?? []
            progressByWorkID = Self.indexLatestProgress(progress)

            var workByID = Dictionary(uniqueKeysWithValues: recentlyAdded.map { ($0.id, $0) })
            var seenWorkIDs = Set<UUID>()
            let resumable = progress
                .filter { $0.state == .partWatched }
                .sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
                .filter { seenWorkIDs.insert($0.workID).inserted }
                .prefix(10)

            // Series with a resumable plan lead the on-deck rail (server order,
            // newest first), then the remaining part-watched works.
            var onDeckIDs: [UUID] = []
            var seenDeck = Set<UUID>()
            for plan in plans where plan.action == .resume || plan.isStacked {
                if seenDeck.insert(plan.seriesWorkID).inserted { onDeckIDs.append(plan.seriesWorkID) }
            }
            for item in resumable where seenDeck.insert(item.workID).inserted {
                onDeckIDs.append(item.workID)
            }
            onDeckIDs = Array(onDeckIDs.prefix(10))

            let missingIDs = onDeckIDs.filter { workByID[$0] == nil }
            let fetched = await withTaskGroup(of: (UUID, Work?).self, returning: [UUID: Work].self) { group in
                for workID in missingIDs {
                    group.addTask { (workID, try? await self.apiClient.fetchWork(id: workID).work) }
                }
                var result: [UUID: Work] = [:]
                for await (workID, work) in group {
                    if let work { result[workID] = work }
                }
                return result
            }
            workByID.merge(fetched) { current, _ in current }

            continueWatching = resumable.compactMap { progress in
                workByID[progress.workID].map { ProgressItem(work: $0, progress: progress) }
            }
            rails = Self.makeRails(
                movies: movies,
                series: series,
                sites: sites,
                onDeck: onDeckIDs.compactMap { workByID[$0] }
            )
            loadState = .loaded
        } catch let error as APIError {
            loadState = .failed(error.displayMessage)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    private func browse(kind: WorkKind) async throws -> [Work] {
        try await apiClient.browseLibrary(
            kind: kind,
            sort: "recent",
            order: "desc",
            availableOnly: true,
            limit: 36,
            offset: 0
        ).items
    }

    static func makeRails(
        movies: [Work],
        series: [Work],
        sites: [Work],
        onDeck: [Work]
    ) -> [Rail] {
        let recent = (movies + series + sites).sorted { $0.addedAt > $1.addedAt }
        var used = Set<UUID>()
        func take(_ source: [Work], count: Int) -> [Work] {
            var result: [Work] = []
            for work in source where used.insert(work.id).inserted {
                result.append(work)
                if result.count == count { break }
            }
            return result
        }

        let primary = onDeck.isEmpty ? take(recent, count: 8) : take(onDeck, count: 10)
        let candidates = [
            Rail(id: "primary", title: onDeck.isEmpty ? "Start watching" : "On deck", works: primary),
            Rail(id: "new-movies", title: "New movies", works: take(movies, count: 12)),
            Rail(id: "new-series", title: "New series", works: take(series, count: 12)),
            Rail(id: "new-sites", title: "New sites", works: take(sites, count: 12)),
            Rail(id: "more-movies", title: "More movies", works: take(movies, count: 12)),
            Rail(id: "more-series", title: "More series", works: take(series, count: 12)),
            Rail(id: "more-sites", title: "More sites", works: take(sites, count: 12)),
        ]
        return candidates.filter { !$0.works.isEmpty }
    }

    private static func indexLatestProgress(_ progress: [WatchProgress]) -> [UUID: WatchProgress] {
        progress.reduce(into: [:]) { result, item in
            let current = result[item.workID]
            if current == nil || (item.updatedAt ?? .distantPast) > (current?.updatedAt ?? .distantPast) {
                result[item.workID] = item
            }
        }
    }

    /// Reports the picked option and builds the player request, including the
    /// queue of following episodes when the series detail is reachable.
    func resumeRequest(plan: ResumePlan, option: ResumeOption, seriesTitle: String) async -> ResumePlayRequest {
        _ = try? await ResumePlanClient(transport: apiClient).recordChoice(seriesID: plan.seriesWorkID, option: option)
        let detail = try? await apiClient.fetchWork(id: plan.seriesWorkID)
        return ResumePlayRequest.make(
            option: option,
            detail: detail,
            workID: plan.seriesWorkID,
            seriesTitle: seriesTitle
        )
    }
}
