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
    public enum SessionState: Equatable {
        case restoring
        case signedOut
        case signedIn
    }

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
    public private(set) var sessionState: SessionState = .restoring
    public private(set) var currentUserName: String?
    public private(set) var currentUserID: UUID?
    public private(set) var currentAvatar: ProfileAvatarPreference?

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
    @ObservationIgnored private let demoMode: Bool
    @ObservationIgnored private var suppressAutomaticSessionRestore = false

    public init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        #if DEBUG
        self.demoMode = ProcessInfo.processInfo.arguments.contains("--playarr-demo")
        #else
        self.demoMode = false
        #endif

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
            account: resolvedURL.absoluteString,
            simulatorDefaults: userDefaults
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
        self.currentUserName = userDefaults.string(forKey: Self.userNameDefaultsKey(for: resolvedURL))

        if demoMode {
            self.apiClient = PreviewAPIClient()
            self.currentUserName = "Thomas"
            self.isSignedIn = true
            self.sessionState = .signedIn
        }
    }

    public func signIn(serverURL: String, username: String, password: String) async throws {
        let url = try LoginServerURL.normalise(serverURL)

        if url != serverBaseURL {
            prepareServerForSignIn(url)
        }

        let response = try await apiClient.login(
            LoginRequest(
                deviceID: deviceID,
                deviceName: Self.deviceName,
                clientPlatform: .ios,
                clientVersion: InstalledAppVersion.current,
                password: password,
                username: username
            )
        )
        try await setSession(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            tokenType: response.tokenType,
            expiresIn: response.expiresIn
        )
        let resolvedName = username.trimmingCharacters(in: .whitespacesAndNewlines)
        currentUserName = resolvedName
        currentUserID = response.userID
        userDefaults.set(resolvedName, forKey: Self.userNameDefaultsKey(for: serverBaseURL))
        await refreshCurrentAvatar()
    }

    func prepareServerForSignIn(_ url: URL) {
        guard url != serverBaseURL else { return }
        suppressAutomaticSessionRestore = true
        defer { suppressAutomaticSessionRestore = false }
        serverBaseURL = url
    }

    public func switchProfile(_ profile: AvailableProfile, pin: String?) async throws {
        let response = try await apiClient.login(
            LoginRequest(
                deviceID: deviceID,
                deviceName: Self.deviceName,
                clientPlatform: .ios,
                clientVersion: InstalledAppVersion.current,
                pin: pin,
                profileUserID: profile.id
            )
        )
        try await setSession(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            tokenType: response.tokenType,
            expiresIn: response.expiresIn
        )
        currentUserName = profile.displayName
        currentUserID = response.userID
        userDefaults.set(profile.displayName, forKey: Self.userNameDefaultsKey(for: serverBaseURL))
        await refreshCurrentAvatar()
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
        sessionState = .signedIn
    }

    public func restoreSessionState() async {
        if demoMode {
            isSignedIn = true
            sessionState = .signedIn
            return
        }
        let storedSession = await tokenStore.currentSession()
        isSignedIn = storedSession != nil
        currentUserID = storedSession.flatMap {
            JWTClaims.subject(ofAccessToken: $0.accessToken.exposeSecret())
        }
        currentUserName = userDefaults.string(forKey: Self.userNameDefaultsKey(for: serverBaseURL))
        sessionState = isSignedIn ? .signedIn : .signedOut
        if isSignedIn { await refreshCurrentAvatar() }
    }

    public func signOut() async throws {
        try await tokenStore.clearSession()
        isSignedIn = false
        currentUserID = nil
        currentAvatar = nil
        sessionState = .signedOut
    }

    public func refreshCurrentAvatar() async {
        currentAvatar = (try? await apiClient.getProfileAvatar())?.preference
    }

    @discardableResult
    public func updateCurrentAvatar(_ preference: ProfileAvatarPreference) async throws -> ProfileAvatarPreference {
        let saved = try await apiClient.updateProfileAvatar(
            UpdateProfileAvatarRequest(preference: preference)
        )
        let resolved = saved.preference ?? preference
        currentAvatar = resolved
        return resolved
    }

    private func rebuildClients() {
        let tokenStore = KeychainTokenStore(
            service: "com.streamarr.ios.session",
            account: serverBaseURL.absoluteString,
            simulatorDefaults: userDefaults
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
        currentUserID = nil
        currentAvatar = nil
        currentUserName = userDefaults.string(forKey: Self.userNameDefaultsKey(for: serverBaseURL))
        if suppressAutomaticSessionRestore {
            sessionState = .signedOut
        } else {
            sessionState = .restoring
            Task { await restoreSessionState() }
        }
    }

    private static func userNameDefaultsKey(for url: URL) -> String {
        "com.streamarr.ios.currentUserName.\(url.absoluteString)"
    }
}
