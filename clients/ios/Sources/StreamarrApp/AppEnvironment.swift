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
/// to `http://localhost:8080` for local development against a
/// same-machine/simulator-accessible backend. `SettingsView` is the one
/// place in the UI that changes it.
@MainActor
@Observable
public final class AppEnvironment {
    static let serverBaseURLDefaultsKey = "com.streamarr.ios.serverBaseURL"
    static let defaultServerBaseURL = URL(string: "http://localhost:8080")!
    static let localUserIDDefaultsKey = "com.streamarr.ios.localUserID"
    static let isAdminModeDefaultsKey = "com.streamarr.ios.isAdminMode"
    static let deviceIDDefaultsKey = "com.streamarr.ios.deviceID"
    /// `LoginRequest.deviceName` — a fixed, human-readable label rather than
    /// a `UIKit`-sourced device name (`UIDevice.current.name`), since
    /// `StreamarrKit` (where `APIClientConfiguration` lives) deliberately
    /// has no UIKit dependency — see `Package.swift`'s tvOS-reuse note.
    static let deviceName = "Streamarr iOS"

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

    /// Round D placeholder that Round E's real auth retired the *meaningful*
    /// use of: it used to double as `SubmitRequestBody.requestedBy`/
    /// `DecideRequestBody.decidedBy` (the real server-derived-from-token
    /// identity replaces both of those now — see `OpenAPISchemas.swift`'s
    /// Round E note) and, until the Round F follow-up fix, was also used as
    /// the `user_id` this app passes to `GET /api/v1/requests` for "My
    /// Requests" — which was wrong, since it's never guaranteed to equal
    /// the identity your own submitted requests are actually stored under
    /// (that's the access token's `sub` claim). `resolvedUserID()` is the
    /// correct source for that now; this property survives only as its
    /// before-first-login fallback and as the read-only value
    /// `SettingsView` displays. Generated once per install and persisted in
    /// `UserDefaults`.
    public let localUserID: UUID

    /// Local, device-only placeholder for "is this person an admin." Gates
    /// whether `RequestsView` shows the admin "Pending Approval" queue
    /// (with Approve/Reject) or the regular "My Requests" list, and whether
    /// `RequestsViewModel` even attempts approve/reject. Toggled from
    /// `SettingsView`; persisted in `UserDefaults`. As of Round E the server
    /// *does* independently enforce admin access on approve/reject (403 if
    /// the caller's verified token isn't an admin) — but this local toggle
    /// only decides what this device shows/attempts, it doesn't grant
    /// anything and isn't itself checked by the server. See
    /// `RequestsViewModel`'s doc comment.
    public var isAdminMode: Bool {
        didSet {
            guard isAdminMode != oldValue else { return }
            userDefaults.set(isAdminMode, forKey: Self.isAdminModeDefaultsKey)
        }
    }

    /// `LoginRequest.deviceID` for `APIClient`'s transparent
    /// `POST /api/v1/auth/login` call (see that file's header note) —
    /// generated once per install and persisted in `UserDefaults`, same
    /// pattern as `localUserID`, so this app resends the same device id on
    /// every login/refresh from this install rather than a fresh one each
    /// launch (the spec calls this out explicitly on `LoginRequest.device_id`
    /// as required for `Policy::device_allow`/`max_concurrent_sessions` to
    /// reason about one `Device`).
    public let deviceID: UUID

    @ObservationIgnored private let userDefaults: UserDefaults
    @ObservationIgnored private let tokenStore: InMemoryTokenStore

    public init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults

        let storedURLString = userDefaults.string(forKey: Self.serverBaseURLDefaultsKey)
        let resolvedURL = storedURLString.flatMap(URL.init(string:)) ?? Self.defaultServerBaseURL
        self.serverBaseURL = resolvedURL

        if let storedUserID = userDefaults.string(forKey: Self.localUserIDDefaultsKey),
           let parsedUserID = UUID(uuidString: storedUserID) {
            self.localUserID = parsedUserID
        } else {
            let generatedUserID = UUID()
            userDefaults.set(generatedUserID.uuidString, forKey: Self.localUserIDDefaultsKey)
            self.localUserID = generatedUserID
        }
        self.isAdminMode = userDefaults.bool(forKey: Self.isAdminModeDefaultsKey)

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
            ),
            tokenProvider: tokenStore
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

    /// The identity `GET /api/v1/requests?user_id=` should actually filter
    /// by for "My Requests": the current access token's own `sub` claim
    /// when one is available (this is exactly the identity the server
    /// attributes newly-submitted/decided requests to as of Round E), with
    /// `localUserID` only as a before-first-login fallback so the UI has
    /// *some* id to show immediately rather than blocking on a network
    /// round-trip. Trusted-network mode's transparent login (see
    /// `APIClient`'s `obtainSessionViaLogin`) means a token is normally
    /// available by the time this is called from `RequestsView`.
    public func resolvedUserID() async -> UUID {
        guard let token = await tokenStore.currentAccessToken() else { return localUserID }
        return JWTClaims.subject(ofAccessToken: token.exposeSecret()) ?? localUserID
    }

    private func rebuildClients() {
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

    /// `AccessTokenProviding.storeSession` — how `APIClient`'s transparent
    /// `POST /api/v1/auth/login` fallback (see that file's header note)
    /// persists a token pair it obtained without any `AppEnvironment.setSession`
    /// call from the view layer. Deliberately doesn't touch
    /// `AppEnvironment.isSignedIn`: that flag reflects a user-initiated
    /// device-flow sign-in for `SettingsView`'s "Signed In"/"Sign Out"
    /// affordance, not a background trusted-network session this store also
    /// now happens to hold.
    func storeSession(accessToken: Sensitive<String>, refreshToken: Sensitive<String>?) async {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }
}
