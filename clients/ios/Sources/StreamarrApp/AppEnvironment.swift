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
    @ObservationIgnored private var tokenStore: KeychainTokenStore

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

        let tokenStore = KeychainTokenStore(
            service: "com.streamarr.ios.session",
            account: resolvedURL.absoluteString
        )
        self.tokenStore = tokenStore

        self.apiClient = APIClient(
            configuration: APIClientConfiguration(
                baseURL: resolvedURL,
                clientVersion: InstalledAppVersion.current,
                deviceID: self.deviceID,
                deviceName: Self.deviceName
            ),
            tokenProvider: tokenStore
        )
        self.deviceFlowClient = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(baseURL: resolvedURL)
        )
    }

    public func setSession(
        accessToken: String,
        refreshToken: String,
        tokenType: String,
        expiresIn: Int64
    ) async throws {
        try await tokenStore.storeSession(
            StoredAuthSession(
                accessToken: accessToken,
                refreshToken: refreshToken,
                tokenType: tokenType,
                expiresAt: Date().addingTimeInterval(TimeInterval(expiresIn))
            )
        )
        isSignedIn = true
    }

    public func restoreSessionState() async {
        isSignedIn = await tokenStore.currentSession() != nil
    }

    public func signOut() async throws {
        try await tokenStore.clearSession()
        isSignedIn = false
    }

    private func rebuildClients() {
        let tokenStore = KeychainTokenStore(
            service: "com.streamarr.ios.session",
            account: serverBaseURL.absoluteString
        )
        self.tokenStore = tokenStore
        apiClient = APIClient(
            configuration: APIClientConfiguration(
                baseURL: serverBaseURL,
                clientVersion: InstalledAppVersion.current,
                deviceID: deviceID,
                deviceName: Self.deviceName
            ),
            tokenProvider: tokenStore
        )
        deviceFlowClient = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(baseURL: serverBaseURL)
        )
        isSignedIn = false
        Task { await restoreSessionState() }
    }
}
