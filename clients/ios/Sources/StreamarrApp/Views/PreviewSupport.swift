import Foundation
import StreamarrKit

/// Canned `StreamarrAPIClient` conformance used only by `#Preview`s in this
/// directory, so previews render without a live server. Never referenced
/// from `App.swift`/`AppEnvironment` at runtime.
struct PreviewAPIClient: StreamarrAPIClient {
    var baseURL: URL { URL(string: "http://localhost:8080")! }

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
        CatalogPage(items: [], total: 0)
    }

    func searchCatalog(query: String, limit: Int?) async throws -> [Work] { [] }

    func fetchWork(id: UUID) async throws -> WorkDetail {
        throw APIError.notFound(nil)
    }

    func listRequests(userID: UUID?) async throws -> [MediaRequest] { [] }

    func submitRequest(_ body: SubmitRequestBody) async throws -> MediaRequest {
        throw APIError.unprocessableEntity(nil)
    }

    func approveRequest(id: UUID, body: DecideRequestBody) async throws -> MediaRequest {
        throw APIError.notFound(nil)
    }

    func rejectRequest(id: UUID, body: DecideRequestBody) async throws -> MediaRequest {
        throw APIError.notFound(nil)
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
