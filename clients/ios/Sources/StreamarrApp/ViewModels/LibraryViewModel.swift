import Foundation
import Observation
import StreamarrKit

@MainActor
@Observable
public final class LibraryViewModel {
    public private(set) var libraries: [SourceInstance] = []
    public private(set) var works: [Work] = []
    public var selectedLibraryID: UUID?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    private let apiClient: StreamarrAPIClient

    public init(apiClient: StreamarrAPIClient) {
        self.apiClient = apiClient
    }

    public func loadLibraries() async {
        do {
            libraries = try await apiClient.fetchLibraries()
        } catch {
            errorMessage = String(describing: error)
        }
    }

    public func loadWorks(page: Int = 1, pageSize: Int = 50) async {
        isLoading = true
        defer { isLoading = false }
        do {
            works = try await apiClient.fetchWorks(libraryID: selectedLibraryID, page: page, pageSize: pageSize)
        } catch {
            errorMessage = String(describing: error)
        }
    }

    public func dismissError() {
        errorMessage = nil
    }
}
