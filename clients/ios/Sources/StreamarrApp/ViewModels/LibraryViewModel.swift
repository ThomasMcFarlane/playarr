import Foundation
import Observation
import StreamarrKit

/// View model for `LibraryView` — the catalog browse/search screen. Backed
/// entirely by the real `GET /api/v1/catalog` and `GET
/// /api/v1/catalog/search` endpoints (see `backend/openapi/streamarr.yaml`).
/// There is no "libraries" (source instance) listing endpoint in the real
/// spec, so — unlike the Wave-1 placeholder — this no longer offers a
/// library picker, only the `kind`/`sort` filters the real `browse_catalog`
/// query params actually support.
@MainActor
@Observable
public final class LibraryViewModel {
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
    public var selectedKind: WorkKind?
    public var searchText: String = ""

    private let apiClient: StreamarrAPIClient
    private let pageSize = 50

    public init(apiClient: StreamarrAPIClient) {
        self.apiClient = apiClient
    }

    /// Loads (or reloads) the current page: a catalog search if
    /// `searchText` is non-empty, otherwise a filtered/sorted browse.
    public func load() async {
        loadState = .loading
        let trimmedQuery = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if trimmedQuery.isEmpty {
                let page = try await apiClient.browseCatalog(
                    kind: selectedKind,
                    genre: nil,
                    tag: nil,
                    sort: "title",
                    limit: pageSize,
                    offset: 0
                )
                works = page.items
                total = page.total
            } else {
                works = try await apiClient.searchCatalog(query: trimmedQuery, limit: pageSize)
                total = nil
            }
            loadState = works.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            loadState = .failed(error.displayMessage)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }
}
