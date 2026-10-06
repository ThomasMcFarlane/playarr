import Foundation
import Observation
import PlayarrKit

/// View model for `LibraryView` — the catalog browse/search screen. Backed
/// entirely by the real `GET /api/v1/catalog` and `GET
/// /api/v1/catalog/search` endpoints (see `backend/openapi/playarr.yaml`).
/// There is no "libraries" (source instance) listing endpoint in the real
/// spec, so — unlike the Wave-1 placeholder — this no longer offers a
/// library picker, only the `kind`/`sort` filters the real `browse_catalog`
/// query params actually support.
@MainActor
@Observable
public final class LibraryViewModel {
    public enum ViewMode: String, CaseIterable, Sendable { case list, screen, cover, coverFlow = "cover-flow" }
    public enum SearchScope: String, CaseIterable, Sendable { case all, movie, series, site, artist, playlist }
    public enum LoadState: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case empty
        case failed(String)
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var works: [Work] = []
    public private(set) var total: Int64?
    public private(set) var playlists: [Playlist] = []
    public var selectedKind: WorkKind?
    public var searchText: String = ""
    public var viewMode: ViewMode = .screen
    public var sort = "title"
    public var order = "asc"
    public var searchScope: SearchScope = .all
    public var isSearchMode = false
    public private(set) var isLoadingMore = false

    public var canLoadMore: Bool {
        guard searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        if let total { return Int64(works.count) < total }
        return works.count == pageSize
    }

    private let apiClient: PlayarrAPIClient
    private let pageSize = 200

    public init(apiClient: PlayarrAPIClient) {
        self.apiClient = apiClient
    }

    /// Loads (or reloads) the current page: a catalog search if
    /// `searchText` is non-empty, otherwise a filtered/sorted browse.
    public func load(silent: Bool = false) async {
        if silent && loadState != .loaded && loadState != .empty { return }
        if !silent { loadState = .loading }
        let trimmedQuery = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if trimmedQuery.isEmpty && isSearchMode {
                works = []
                playlists = []
                total = nil
                loadState = .empty
                return
            }
            if trimmedQuery.isEmpty {
                playlists = []
                let page: CatalogPage
                if let selectedKind {
                    page = try await apiClient.browseLibrary(
                        kind: selectedKind,
                        sort: sort,
                        order: order,
                        availableOnly: true,
                        limit: pageSize,
                        offset: 0
                    )
                } else {
                    page = try await apiClient.browseCatalog(
                        kind: nil, genre: nil, tag: nil, sort: sort,
                        limit: pageSize, offset: 0
                    )
                }
                works = page.items
                total = page.total
            } else {
                async let foundWorks = apiClient.searchCatalog(query: trimmedQuery, limit: pageSize)
                async let foundPlaylists = apiClient.listPlaylists()
                let allWorks = try await foundWorks
                let allPlaylists = (try? await foundPlaylists) ?? []
                works = allWorks.filter { work in
                    switch searchScope {
                    case .all: true
                    case .movie: work.kind == .movie
                    case .series: work.kind == .series
                    case .site: work.kind == .site
                    case .artist: work.kind == .artist
                    case .playlist: false
                    }
                }
                playlists = (searchScope == .all || searchScope == .playlist)
                    ? allPlaylists.filter { $0.name.localizedCaseInsensitiveContains(trimmedQuery) }
                    : []
                total = nil
            }
            loadState = works.isEmpty && playlists.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            if !silent { loadState = .failed(error.displayMessage) }
        } catch {
            if !silent { loadState = .failed(error.localizedDescription) }
        }
    }

    public func loadMore() async {
        guard !isLoadingMore, canLoadMore, let selectedKind else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await apiClient.browseLibrary(
                kind: selectedKind,
                sort: sort,
                order: order,
                availableOnly: true,
                limit: pageSize,
                offset: works.count
            )
            let existing = Set(works.map(\.id))
            works.append(contentsOf: page.items.filter { !existing.contains($0.id) })
            total = page.total ?? total
        } catch {
            // Keep the loaded page visible; pull-to-refresh remains available.
        }
    }
}
