import Foundation
import Observation
import StreamarrKit

/// Composition root for the app's shared services. Constructed once in
/// `StreamarrApp` and threaded down to `RootView`, which hands each
/// screen's view model the one piece of it that screen needs (usually just
/// `apiClient`) — keeps `APIClient`/`DeviceFlowClient` construction and
/// base-URL/token wiring in one place instead of scattered through the
/// view layer.
@MainActor
@Observable
public final class AppEnvironment {
    public private(set) var apiClient: StreamarrAPIClient
    public let deviceFlowClient: DeviceFlowClient
    public private(set) var currentUser: User?

    public var serverBaseURL: URL {
        didSet { rebuildAPIClient() }
    }

    @ObservationIgnored private let tokenStore: InMemoryTokenStore

    public init(serverBaseURL: URL = URL(string: "https://streamarr.local")!) {
        self.serverBaseURL = serverBaseURL

        let tokenStore = InMemoryTokenStore()
        self.tokenStore = tokenStore

        self.apiClient = APIClient(
            configuration: APIClientConfiguration(baseURL: serverBaseURL),
            tokenProvider: tokenStore
        )

        self.deviceFlowClient = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(
                authorizationServerURL: serverBaseURL,
                clientID: "streamarr-ios"
            )
        )
    }

    /// Called once `DeviceFlowClient.authorize` (or a future refresh-token
    /// exchange) succeeds. `TODO`: persist to the Keychain instead of
    /// holding it only in memory — see `InMemoryTokenStore` below.
    public func setSession(accessToken: String, refreshToken: String?) async {
        await tokenStore.update(accessToken: accessToken, refreshToken: refreshToken)
    }

    public func setCurrentUser(_ user: User?) {
        currentUser = user
    }

    public func signOut() async {
        await tokenStore.clear()
        currentUser = nil
    }

    private func rebuildAPIClient() {
        apiClient = APIClient(
            configuration: APIClientConfiguration(baseURL: serverBaseURL),
            tokenProvider: tokenStore
        )
    }
}

/// Placeholder `AccessTokenProviding` used until the app wires up real
/// Keychain-backed persistence (`TODO` above). An `actor` rather than a
/// `@MainActor` class specifically so it satisfies `AccessTokenProviding:
/// Sendable` without relying on global-actor-isolation-implies-Sendable
/// inference. Deliberately stores `Sensitive<String>`, not plain `String`
/// — see `StreamarrKit.Sensitive`.
actor InMemoryTokenStore: AccessTokenProviding {
    private var accessToken: Sensitive<String>?
    private var refreshToken: Sensitive<String>?

    func update(accessToken: String, refreshToken: String?) {
        self.accessToken = Sensitive(accessToken)
        self.refreshToken = refreshToken.map(Sensitive.init)
    }

    func clear() {
        accessToken = nil
        refreshToken = nil
    }

    func currentAccessToken() async -> Sensitive<String>? {
        accessToken
    }

    func refreshAccessToken() async throws -> Sensitive<String> {
        // TODO: exchange `refreshToken` via the OAuth refresh grant once
        // the token endpoint contract is finalized server-side.
        guard let accessToken else {
            throw APIError.unauthorized
        }
        return accessToken
    }
}
