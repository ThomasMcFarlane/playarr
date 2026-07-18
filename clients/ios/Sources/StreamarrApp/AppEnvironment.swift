import Foundation
import Observation
import StreamarrKit

/// Composition root for the app's shared services. Constructed once in
/// `StreamarrApp` and threaded down to `RootView`, which hands each
/// screen's view model the one piece of it that screen needs (usually just
/// `apiClient`) — keeps `APIClient`/`DeviceFlowClient` construction and
/// base-URL/token wiring in one place instead of scattered through the
/// view layer.
///
/// `serverBaseURL` is the one piece of app configuration that has to be
/// user-settable: Streamarr is operator-run software, so this client can
/// never hardcode a single host. It's backed by `UserDefaults` (see
/// `serverBaseURLDefaultsKey`) so the value survives relaunch, and defaults
/// to `http://localhost:8484` for local development against a
/// same-machine/simulator-accessible backend. `SettingsView` is the one
/// place in the UI that changes it.
@MainActor
@Observable
public final class AppEnvironment {
    static let serverBaseURLDefaultsKey = "com.streamarr.ios.serverBaseURL"
    static let defaultServerBaseURL = URL(string: "http://localhost:8484")!
    static let deviceIDDefaultsKey = "com.streamarr.ios.deviceID"
    /// `LoginRequest.deviceName` — a fixed, human-readable label rather than
    /// a `UIKit`-sourced device name (`UIDevice.current.name`), since
    /// `StreamarrKit` (where `APIClientConfiguration` lives) deliberately
    /// has no UIKit dependency — see `Package.swift`'s tvOS-reuse note.
    static let deviceName = "Playarr iOS"

    public private(set) var apiClient: StreamarrAPIClient
    public private(set) var deviceFlowClient: DeviceFlowClient
    public private(set) var isSignedIn = false

    public var serverBaseURL: URL {
        didSet {
            guard serverBaseURL != oldValue else { return }
            userDefaults.set(serverBaseURL.absoluteString, forKey: Self.serverBaseURLDefaultsKey)
            rebuildClients()
        }
    }

    /// `LoginRequest.deviceID` for `DeviceFlowClient`'s sign-in flow —
    /// generated once per install and persisted in `UserDefaults`, so this
    /// app resends the same device id on every sign-in/refresh from this
    /// install rather than a fresh one each launch (the spec calls this out
    /// explicitly on `LoginRequest.device_id` as required for
    /// `Policy::device_allow`/`max_concurrent_sessions` to reason about one
    /// `Device`).
    public let deviceID: UUID

    @ObservationIgnored private let userDefaults: UserDefaults
    @ObservationIgnored private let tokenStore: InMemoryTokenStore

    public init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults

        let storedURLString = userDefaults.string(forKey: Self.serverBaseURLDefaultsKey)
        let resolvedURL = storedURLString.flatMap(URL.init(string:)) ?? Self.defaultServerBaseURL
        self.serverBaseURL = resolvedURL

        if let storedDeviceIDString = userDefaults.string(forKey: Self.deviceIDDefaultsKey),
           let parsedDeviceID = UUID(uuidString: storedDeviceIDString) {
            self.deviceID = parsedDeviceID
        } else {
            let generatedDeviceID = UUID()
            userDefaults.set(generatedDeviceID.uuidString, forKey: Self.deviceIDDefaultsKey)
            self.deviceID = generatedDeviceID
        }

        let tokenStore = InMemoryTokenStore()
        self.tokenStore = tokenStore

        self.apiClient = APIClient(
            configuration: APIClientConfiguration(
                baseURL: resolvedURL,
                clientVersion: InstalledAppVersion.current,
                deviceID: self.deviceID,
                deviceName: Self.deviceName
            )
        )
        self.deviceFlowClient = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(baseURL: resolvedURL)
        )
    }

    /// Called once `DeviceFlowClient.authorize` (or a future refresh-token
    /// exchange) succeeds. `TODO`: persist to the Keychain instead of
    /// holding it only in memory — see `InMemoryTokenStore` below.
    public func setSession(accessToken: String, refreshToken: String?) async {
        await tokenStore.update(accessToken: accessToken, refreshToken: refreshToken)
        isSignedIn = true
    }

    public func signOut() async {
        await tokenStore.clear()
        isSignedIn = false
    }

    private func rebuildClients() {
        apiClient = APIClient(
            configuration: APIClientConfiguration(
                baseURL: serverBaseURL,
                clientVersion: InstalledAppVersion.current,
                deviceID: deviceID,
                deviceName: Self.deviceName
            )
        )
        deviceFlowClient = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(baseURL: serverBaseURL)
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
            throw APIError.unauthorized(nil)
        }
        return accessToken
    }

    /// `AccessTokenProviding.storeSession` — how a conformer persists a
    /// token pair obtained outside of `AppEnvironment.setSession`'s own
    /// device-flow path (e.g. a future refresh-token exchange). Deliberately
    /// doesn't touch `AppEnvironment.isSignedIn` itself; callers that need
    /// that flag updated too go through `setSession`.
    func storeSession(accessToken: Sensitive<String>, refreshToken: Sensitive<String>?) async {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }
}
