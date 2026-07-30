import Foundation
import Observation
import PlayarrKit

@MainActor
@Observable
final class FolderBrowserViewModel {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case empty
        case failed(String)
    }

    private(set) var roots: [FolderRoot] = []
    private(set) var rootErrors: [FolderRootError] = []
    private(set) var selectedRootID: UUID?
    private(set) var browseResponse: FolderBrowseResponse?
    private(set) var entries: [FolderEntry] = []
    private(set) var loadState: LoadState = .idle
    private(set) var isLoadingMore = false

    var selectedRoot: FolderRoot? {
        roots.first { $0.id == selectedRootID }
    }

    var canLoadMore: Bool {
        guard let browseResponse else { return false }
        return Int64(entries.count) < browseResponse.total
    }

    private let apiClient: PlayarrAPIClient
    private let pageSize = 200
    private var loadedKind: WorkKind?
    private var browseGeneration = 0
    private var requestedPath = ""

    init(apiClient: PlayarrAPIClient) {
        self.apiClient = apiClient
    }

    func loadRoots(kind: WorkKind, preferredPath: String = "") async {
        browseGeneration += 1
        let generation = browseGeneration
        isLoadingMore = false
        loadedKind = kind
        loadState = .loading
        do {
            let response = try await apiClient.listFolderRoots(kind: kind)
            guard generation == browseGeneration else { return }
            roots = response.roots
            rootErrors = response.errors

            let retainedSelection = roots.first {
                $0.id == selectedRootID && $0.available
            }
            selectedRootID = retainedSelection?.id
                ?? roots.first(where: \.available)?.id
                ?? roots.first?.id

            guard let selectedRootID, selectedRoot?.available == true else {
                browseResponse = nil
                entries = []
                loadState = .empty
                return
            }
            await browse(
                rootID: selectedRootID,
                path: retainedSelection == nil ? "" : preferredPath,
                appending: false
            )
        } catch {
            guard generation == browseGeneration else { return }
            setFailure(error)
        }
    }

    func selectRoot(_ root: FolderRoot) async {
        guard root.available else { return }
        selectedRootID = root.id
        await browse(rootID: root.id, path: "", appending: false)
    }

    func open(path: String) async {
        guard let selectedRootID else { return }
        await browse(rootID: selectedRootID, path: path, appending: false)
    }

    func refresh() async {
        guard let loadedKind else { return }
        await loadRoots(kind: loadedKind, preferredPath: requestedPath)
    }

    func loadMore() async {
        guard !isLoadingMore, canLoadMore, let selectedRootID, let browseResponse else {
            return
        }
        await browse(
            rootID: selectedRootID,
            path: browseResponse.path,
            offset: entries.count,
            appending: true
        )
    }

    private func browse(
        rootID: UUID,
        path: String,
        offset: Int = 0,
        appending: Bool
    ) async {
        browseGeneration += 1
        let generation = browseGeneration
        if appending {
            isLoadingMore = true
        } else {
            isLoadingMore = false
            requestedPath = path
            loadState = .loading
        }
        defer {
            if generation == browseGeneration, appending {
                isLoadingMore = false
            }
        }
        do {
            let response = try await apiClient.browseFolder(
                rootID: rootID,
                path: path.isEmpty ? nil : path,
                limit: pageSize,
                offset: offset
            )
            guard generation == browseGeneration, selectedRootID == rootID else {
                return
            }
            if appending {
                let existing = Set(entries.map(\.id))
                entries.append(contentsOf: response.entries.filter { !existing.contains($0.id) })
            } else {
                entries = response.entries
            }
            browseResponse = response
            loadState = entries.isEmpty ? .empty : .loaded
        } catch {
            guard generation == browseGeneration, selectedRootID == rootID else {
                return
            }
            if !appending {
                setFailure(error)
            }
        }
    }

    private func setFailure(_ error: Error) {
        if let error = error as? APIError {
            loadState = .failed(error.displayMessage)
        } else {
            loadState = .failed(error.localizedDescription)
        }
    }
}
