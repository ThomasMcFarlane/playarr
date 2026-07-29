import Foundation
import Observation
import PlayarrKit

protocol TVDeviceAuthorizing: Sendable {
    /// The server this authorizer talks to — lets the retry-across-known-
    /// addresses loop in `startPairing()` (§6.4/§8 Phase 5) tell which
    /// remembered address a given authorizer actually succeeded against.
    var baseURL: URL { get }
    func requestDeviceCode() async throws -> DeviceCodeResponse
    func pollForToken(
        deviceCode: String,
        interval: TimeInterval,
        expiresIn: TimeInterval
    ) async throws -> TokenResponse
}

extension DeviceFlowClient: TVDeviceAuthorizing {}

enum TVPairingState {
    case signedOut
    case requestingCode
    case awaitingApproval(DeviceCodeResponse)
    case signedIn
    case failed(String)
}

enum TVServerAddress {
    static func normalisedURL(from input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let candidate = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard let components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host != nil,
              let url = components.url else {
            return nil
        }
        return url
    }
}

@MainActor
@Observable
final class TVAppEnvironment {
    static let serverURLKey = "com.playarr.playarr.tvos.serverURL"
    static let deviceIDKey = "com.playarr.playarr.tvos.deviceID"
    /// Placeholder base URL only until a real server arrives via hosted link
    /// claim or Settings. Never the product default for first launch — the
    /// linking device supplies the API host (QR / playarr.app claim).
    static let bootstrapPlaceholderURL = HostedDeviceLinkConfiguration.playarrAppOrigin

    private(set) var apiClient: PlayarrAPIClient
    private(set) var pairingState: TVPairingState = .signedOut
    private(set) var serverURL: URL
    /// True when the operator (or a prior successful link) configured a
    /// Playarr Server API base. False on first launch → hosted device link.
    private(set) var hasConfiguredServer: Bool

    var serverAddress: String

    private let defaults: UserDefaults
    private let deviceID: UUID
    private var deviceAuthorizer: any TVDeviceAuthorizing
    private let hostedLinkClient: HostedDeviceLinkClient
    /// Session store plugged into `APIClient` so catalog/playback calls send
    /// `Authorization: Bearer …` after pairing.
    private var tokenStore: TVUserDefaultsTokenStore
    /// The remembered *group* of server addresses for this Apple TV —
    /// `docs/architecture/peer-groups.md` §6.4/§7.1, §8 Phase 5. Mirrors
    /// `AppEnvironment.serverGroupStore` on the iOS target exactly (same
    /// `PlayarrKit` type, since `PlayarrTV.xcodeproj` links that package
    /// product directly) -- one address book for this install, independent
    /// of `serverURL` (the address currently in use).
    private let serverGroupStore: UserDefaultsKnownServerGroupStore

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.serverGroupStore = UserDefaultsKnownServerGroupStore(defaults: defaults)
        self.hostedLinkClient = HostedDeviceLinkClient(
            configuration: HostedDeviceLinkConfiguration(clientPlatform: .ios)
        )

        let args = ProcessInfo.processInfo.arguments
        let launchURL: URL? = {
            guard let idx = args.firstIndex(of: "-PlayarrServerURL"),
                  args.indices.contains(idx + 1) else { return nil }
            return TVServerAddress.normalisedURL(from: args[idx + 1])
        }()
        let storedURL = defaults.string(forKey: Self.serverURLKey).flatMap(URL.init(string:))
        let resolvedURL = launchURL ?? storedURL
        let effectiveURL = resolvedURL ?? Self.bootstrapPlaceholderURL
        hasConfiguredServer = resolvedURL != nil
        serverURL = effectiveURL
        serverAddress = resolvedURL?.absoluteString ?? ""

        let resolvedDeviceID: UUID
        if let storedID = defaults.string(forKey: Self.deviceIDKey).flatMap(UUID.init(uuidString:)) {
            resolvedDeviceID = storedID
        } else {
            let generatedID = UUID()
            resolvedDeviceID = generatedID
            defaults.set(generatedID.uuidString, forKey: Self.deviceIDKey)
        }
        deviceID = resolvedDeviceID

        let store = TVUserDefaultsTokenStore(
            defaults: defaults,
            account: effectiveURL.absoluteString
        )
        tokenStore = store

        let configuration = Self.apiConfiguration(serverURL: effectiveURL, deviceID: resolvedDeviceID)
        // Optional parity bootstrap: `-PlayarrAccessToken <jwt>` forces signed-in
        // so visual captures hit the production shell with a real catalogue.
        let launchToken: String? = {
            guard let idx = args.firstIndex(of: "-PlayarrAccessToken"),
                  args.indices.contains(idx + 1) else { return nil }
            return args[idx + 1]
        }()
        if let launchToken {
            pairingState = .signedIn
            apiClient = APIClient(
                configuration: configuration,
                tokenProvider: StaticTokenProvider(accessToken: launchToken),
                serverGroupStore: serverGroupStore
            )
        } else {
            apiClient = APIClient(
                configuration: configuration,
                tokenProvider: store,
                serverGroupStore: serverGroupStore
            )
        }
        deviceAuthorizer = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(
                baseURL: effectiveURL,
                // The current server contract has no separate tvOS case;
                // Apple platforms share the `ios` compatibility/policy row.
                clientPlatform: .ios
            )
        )

        // Restore prior device-link session so relaunch stays signed in.
        // (After every stored property is initialised.)
        if launchToken == nil, hasConfiguredServer {
            Task { await self.restoreSessionIfPossible() }
        }
    }

    /// If UserDefaults still holds a non-expired device session, open the
    /// signed-in shell without another QR pass.
    private func restoreSessionIfPossible() async {
        guard case .signedOut = pairingState else { return }
        guard let session = await tokenStore.currentSession() else { return }
        guard session.expiresAt > Date().addingTimeInterval(30) else { return }
        pairingState = .signedIn
    }

    /// First launch (no stored/launch server URL) uses playarr.app hosted
    /// link so the phone supplies the API host. Advanced: Settings server
    /// address or `-PlayarrServerURL` uses direct RFC 8628 against that host.
    static func shouldUseHostedDeviceLink(hasConfiguredServer: Bool) -> Bool {
        !hasConfiguredServer
    }

    @discardableResult
    func saveServerAddress() -> Bool {
        guard let url = TVServerAddress.normalisedURL(from: serverAddress) else { return false }
        serverURL = url
        serverAddress = url.absoluteString
        hasConfiguredServer = true
        defaults.set(url.absoluteString, forKey: Self.serverURLKey)
        rebuildClients()
        signOut()
        // The user just pointed this Apple TV at a different server
        // outright. Whatever group was remembered belonged to the old
        // address -- carrying it forward would make `startPairing()`'s
        // retry-across-known-addresses loop silently try to reconnect to
        // it instead of the address just entered.
        Task { await self.serverGroupStore.forget() }
        return true
    }

    /// Starts pairing. When no server is configured, requests a code from
    /// playarr.app, waits for the phone claim (server URL + server device
    /// code), then polls the real server token endpoint. When a server is
    /// already configured (Settings / prior link / launch arg), uses direct
    /// RFC 8628 and retries across the known address group.
    func startPairing() async {
        pairingState = .requestingCode
        do {
            if Self.shouldUseHostedDeviceLink(hasConfiguredServer: hasConfiguredServer) {
                try await startHostedPairing()
            } else {
                try await startDirectPairing()
            }
        } catch is CancellationError {
            // Quietly reset when the pairing Task is cancelled (view refresh /
            // Try again). Do not surface URLSession's "cancelled" string.
            if case .signedIn = pairingState { return }
            pairingState = .signedOut
        } catch let error as URLError where error.code == .cancelled {
            if case .signedIn = pairingState { return }
            pairingState = .signedOut
        } catch let error as DeviceFlowError {
            pairingState = .failed(Self.message(for: error))
        } catch let error as HostedDeviceLinkError {
            pairingState = .failed(Self.message(for: error))
        } catch {
            pairingState = .failed(error.localizedDescription)
        }
    }

    private func startHostedPairing() async throws {
        let pending = try await hostedLinkClient.requestCode()
        pairingState = .awaitingApproval(pending)

        let claim = try await hostedLinkClient.pollUntilClaim(pending)
        let primaryURL = try Self.requireServerURL(claim.serverURL)
        let groupURLs = Self.distinctServerURLs(
            primary: claim.serverURL,
            others: claim.serverURLs
        )

        adoptWorkingServerURL(primaryURL)
        await serverGroupStore.remember(
            KnownServerGroup(
                servers: groupURLs.map { KnownServer(url: $0) },
                lastGoodURL: primaryURL.absoluteString
            )
        )

        let authorizer = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(baseURL: primaryURL, clientPlatform: .ios)
        )
        deviceAuthorizer = authorizer

        // Remaining TTL on the hosted session; poll interval stays short
        // like the web client after the claim arrives.
        let remaining = max(TimeInterval(pending.expiresIn) - 1, 30)
        let token = try await authorizer.pollForToken(
            deviceCode: claim.serverDeviceCode,
            interval: 1,
            expiresIn: remaining
        )
        try await applyPairedSession(token)
    }

    /// Direct device flow against a configured server, retrying across every
    /// address this Apple TV has remembered for its current server group
    /// (`lastGoodURL` first, §7.1's fast path) before surfacing a failure.
    private func startDirectPairing() async throws {
        let (pending, authorizer) = try await requestDeviceCodeAcrossKnownAddresses()
        if authorizer.baseURL != serverURL {
            adoptWorkingServerURL(authorizer.baseURL)
        }
        deviceAuthorizer = authorizer
        await serverGroupStore.recordSuccess(url: authorizer.baseURL.absoluteString)

        pairingState = .awaitingApproval(pending)
        let token = try await deviceAuthorizer.pollForToken(
            deviceCode: pending.deviceCode,
            interval: TimeInterval(pending.interval),
            expiresIn: TimeInterval(pending.expiresIn)
        )
        try await applyPairedSession(token)
    }

    /// Persists the device-flow tokens and rebuilds `apiClient` so every
    /// subsequent catalog/playback call attaches `Authorization`.
    private func applyPairedSession(_ token: TokenResponse) async throws {
        let session = StoredAuthSession(
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            tokenType: token.tokenType,
            expiresAt: Date().addingTimeInterval(TimeInterval(max(token.expiresIn, 60)))
        )
        try await tokenStore.storeSession(session)
        apiClient = APIClient(
            configuration: Self.apiConfiguration(serverURL: serverURL, deviceID: deviceID),
            tokenProvider: tokenStore,
            serverGroupStore: serverGroupStore
        )
        pairingState = .signedIn
    }

    /// Tries `requestDeviceCode()` against `serverURL` first, then every
    /// other address this install's `KnownServerGroup` remembers
    /// (`lastGoodURL` first, deduplicated) -- mirrors
    /// `AccessTokenCoordinator.candidateBaseURLs()`/its refresh-retry loop
    /// on the iOS target exactly, applied here to device-code request
    /// instead of token refresh since that's this app's actual "start of
    /// auth" call. Rethrows the last failure once every candidate (at
    /// least `serverURL` itself) has failed.
    private func requestDeviceCodeAcrossKnownAddresses() async throws -> (DeviceCodeResponse, any TVDeviceAuthorizing) {
        var lastError: Error = DeviceFlowError.invalidBaseURL
        for baseURL in await candidateServerURLs() {
            let authorizer: any TVDeviceAuthorizing = baseURL == serverURL
                ? deviceAuthorizer
                : DeviceFlowClient(configuration: DeviceFlowConfiguration(baseURL: baseURL, clientPlatform: .ios))
            do {
                let pending = try await authorizer.requestDeviceCode()
                return (pending, authorizer)
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    /// `serverURL` first (today's only candidate when no group is known --
    /// preserves this environment's original one-address behavior
    /// exactly), then every other address this install's
    /// `KnownServerGroup` remembers.
    private func candidateServerURLs() async -> [URL] {
        var urls: [URL] = [serverURL]
        guard let group = await serverGroupStore.currentGroup() else { return urls }

        var ordered: [String] = []
        if let lastGoodURL = group.lastGoodURL {
            ordered.append(lastGoodURL)
        }
        for server in group.servers where !ordered.contains(server.url) {
            ordered.append(server.url)
        }
        for candidate in ordered {
            guard let url = TVServerAddress.normalisedURL(from: candidate), !urls.contains(url) else { continue }
            urls.append(url)
        }
        return urls
    }

    /// Adopts `url` as the current `serverURL` once pairing has actually
    /// proven it reachable -- persists it the same way `saveServerAddress`
    /// does, and rebuilds `apiClient` so post-pairing catalog/playback
    /// calls target it too. Deliberately doesn't touch `deviceAuthorizer`
    /// (the caller already has the exact authorizer instance that just
    /// succeeded) or call `signOut()` (pairing is still in progress).
    private func adoptWorkingServerURL(_ url: URL) {
        serverURL = url
        serverAddress = url.absoluteString
        hasConfiguredServer = true
        defaults.set(url.absoluteString, forKey: Self.serverURLKey)
        // Re-key the token store to this server before rebuild.
        tokenStore = TVUserDefaultsTokenStore(
            defaults: defaults,
            account: url.absoluteString
        )
        apiClient = APIClient(
            configuration: Self.apiConfiguration(serverURL: url, deviceID: deviceID),
            tokenProvider: tokenStore,
            serverGroupStore: serverGroupStore
        )
    }

    func signOut() {
        Task { try? await tokenStore.clearSession() }
        pairingState = .signedOut
    }

    private func rebuildClients() {
        tokenStore = TVUserDefaultsTokenStore(
            defaults: defaults,
            account: serverURL.absoluteString
        )
        let configuration = Self.apiConfiguration(serverURL: serverURL, deviceID: deviceID)
        apiClient = APIClient(
            configuration: configuration,
            tokenProvider: tokenStore,
            serverGroupStore: serverGroupStore
        )
        deviceAuthorizer = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(baseURL: serverURL, clientPlatform: .ios)
        )
    }

    private static func apiConfiguration(serverURL: URL, deviceID: UUID) -> APIClientConfiguration {
        APIClientConfiguration(
            baseURL: serverURL,
            clientPlatform: .ios,
            clientVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0",
            deviceID: deviceID,
            deviceName: "Playarr Apple TV"
        )
    }

    private static func requireServerURL(_ raw: String) throws -> URL {
        guard let url = TVServerAddress.normalisedURL(from: raw) else {
            throw HostedDeviceLinkError.invalidClaim
        }
        return url
    }

    private static func distinctServerURLs(primary: String, others: [String]) -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for raw in [primary] + others {
            guard let url = TVServerAddress.normalisedURL(from: raw) else { continue }
            let key = url.absoluteString
            if seen.insert(key).inserted {
                ordered.append(key)
            }
        }
        return ordered
    }

    private static func message(for error: DeviceFlowError) -> String {
        switch error {
        case .authorizationExpired: return "The pairing code expired. Request a new code."
        case .accessDenied: return "The pairing request was denied."
        case .invalidBaseURL: return "The server address is invalid."
        case .invalidResponse: return "The server returned an invalid response."
        case .http(let status, _): return "The server returned an error (\(status))."
        case .oauth: return "The server could not complete device pairing."
        case .transport(let underlying), .decoding(let underlying):
            return underlying.localizedDescription
        }
    }

    private static func message(for error: HostedDeviceLinkError) -> String {
        switch error {
        case .expired:
            return "That Playarr link code expired. Try again."
        case .invalidClaim:
            return "Playarr returned an invalid TV link response."
        case .http(let status):
            return "Playarr linking is unavailable (HTTP \(status))."
        case .invalidBaseURL, .invalidResponse:
            return "Playarr linking is unavailable."
        case .transportMessage(let message):
            return message
        }
    }
}

/// Minimal token provider for parity-suite bootstrap (static access token).
private struct StaticTokenProvider: AccessTokenProviding {
    let accessToken: String

    func currentSession() async -> StoredAuthSession? {
        StoredAuthSession(
            accessToken: accessToken,
            refreshToken: accessToken,
            tokenType: "Bearer",
            expiresAt: Date().addingTimeInterval(86_400)
        )
    }

    func storeSession(_ session: StoredAuthSession) async throws {}
    func clearSession() async throws {}
}

/// UserDefaults-backed session store for Apple TV (simulator-safe; no
/// Keychain entitlement required for unsigned local builds).
actor TVUserDefaultsTokenStore: AccessTokenProviding {
    private let defaults: UserDefaults
    private let key: String
    private var cached: StoredAuthSession?

    init(defaults: UserDefaults, account: String) {
        self.defaults = defaults
        self.key = "com.playarr.playarr.tvos.session.\(account)"
        if let data = defaults.data(forKey: key) {
            cached = try? JSONDecoder().decode(StoredAuthSession.self, from: data)
        }
    }

    func currentSession() -> StoredAuthSession? { cached }

    func storeSession(_ session: StoredAuthSession) throws {
        let data = try JSONEncoder().encode(session)
        defaults.set(data, forKey: key)
        cached = session
    }

    func clearSession() {
        defaults.removeObject(forKey: key)
        cached = nil
    }
}
