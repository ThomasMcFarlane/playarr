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
    private static let relayHost = "relay.playarr.app"
    private static let legacyRelayPort = 8484

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
        guard let octets = relayOctets(components.host ?? "") else { return url }
        var relay = URLComponents()
        relay.scheme = "https"
        relay.host = "v4-\(octets.map(String.init).joined(separator: "-")).\(relayHost)"
        if components.port == legacyRelayPort { relay.port = legacyRelayPort }
        relay.percentEncodedPath = components.percentEncodedPath == "/" ? "" : components.percentEncodedPath
        relay.percentEncodedQuery = components.percentEncodedQuery
        relay.percentEncodedFragment = components.percentEncodedFragment
        return relay.url
    }

    private static func relayOctets(_ host: String) -> [Int]? {
        let pattern = #"^v4-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.relay\.playarr\.app$"#
        let values: [String]
        if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
           let match = regex.firstMatch(in: host, range: NSRange(host.startIndex..., in: host)) {
            values = (1..<5).compactMap { index in
                Range(match.range(at: index), in: host).map { String(host[$0]) }
            }
            guard values.count == 4 else { return nil }
        } else {
            values = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        }
        let octets = values.compactMap(Int.init)
        guard values.count == 4, octets.count == 4, octets.allSatisfy({ 0...255 ~= $0 }) else { return nil }
        let first = octets[0], second = octets[1], third = octets[2]
        let reserved = first == 0 || first == 10 || first == 127 ||
            (first == 100 && 64...127 ~= second) ||
            (first == 169 && second == 254) ||
            (first == 172 && 16...31 ~= second) ||
            (first == 192 && second == 0 && (third == 0 || third == 2)) ||
            (first == 192 && second == 88 && third == 99) ||
            (first == 192 && second == 168) ||
            (first == 198 && 18...19 ~= second) ||
            (first == 198 && second == 51 && third == 100) ||
            (first == 203 && second == 0 && third == 113) || first >= 224
        return reserved ? nil : octets
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
    /// Library kinds the profile can browse; `nil` until loaded. A failed read (for example a
    /// household block) leaves the set empty, which hides the Series, Movies and Music tabs as on the web.
    private(set) var catalogKinds: Set<WorkKind>?
    /// Set while the household blocks the profile (outside its schedule, or the budget is spent).
    private(set) var householdBlocked = false
    /// The signed-in user's id (access token subject); picks the profile avatar like the web does.
    private(set) var currentUserID = ""
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
            currentUserID = Self.subject(ofJWT: launchToken) ?? ""
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

    /// Reads the browsable kinds and the household state for the shell (nav tabs, blocked screen).
    static func subject(ofJWT token: String) -> String? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while payload.count % 4 != 0 { payload += "=" }
        guard let data = Data(base64Encoded: payload),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["sub"] as? String
    }

    func refreshShellState() async {
        if currentUserID.isEmpty, let session = await tokenStore.currentSession() {
            currentUserID = Self.subject(ofJWT: session.accessToken.exposeSecret()) ?? ""
        }
        let kinds = (try? await apiClient.listCatalogKinds()) ?? []
        catalogKinds = Set(kinds)
        let status = (try? await apiClient.fetchHouseholdStatus()) ?? nil
        householdBlocked = status?.isBlocked ?? false
    }

    /// If UserDefaults still holds a non-expired device session, open the
    /// signed-in shell without another QR pass.
    private func restoreSessionIfPossible() async {
        guard case .signedOut = pairingState else { return }
        guard let session = await tokenStore.currentSession() else { return }
        guard session.expiresAt > Date().addingTimeInterval(30) else { return }
        pairingState = .signedIn
    }

    /// Default QR gate uses the playarr.app hosted broker so the on-screen
    /// code / QR encode `https://playarr.app/link` (never a server/relay Host).
    /// "Sign in manually" and Settings can force direct RFC 8628.
    static func shouldUseHostedDeviceLink(hasConfiguredServer: Bool) -> Bool {
        // Remembered server alone must not take over the QR gate.
        _ = hasConfiguredServer
        return true
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

    /// Starts pairing. Default is hosted playarr.app link (QR gate). Pass
    /// `forceHosted: false` for "Sign in manually" / Settings direct device flow.
    ///
    /// Expired codes renew silently forever (web `DeviceLogin.renewCode` / catch
    /// expired → renew) — never show an error for normal code refresh.
    func startPairing(forceHosted: Bool? = nil) async {
        let useHosted = forceHosted
            ?? Self.shouldUseHostedDeviceLink(hasConfiguredServer: hasConfiguredServer)

        // Loop so expiry auto-refreshes without a failed chrome flash.
        while !Task.isCancelled {
            pairingState = .requestingCode
            do {
                if useHosted {
                    try await startHostedPairing()
                } else {
                    try await startDirectPairing()
                }
                return
            } catch is CancellationError {
                // Leave state alone — a newer renew task or dismiss owns it.
                return
            } catch let error as URLError where error.code == .cancelled {
                return
            } catch let error as HostedDeviceLinkError where error == .expired {
                // Web: isExpiredCodeError → renewCode(); no error UI.
                continue
            } catch let error as DeviceFlowError {
                if case .authorizationExpired = error {
                    continue
                }
                pairingState = .failed(Self.message(for: error))
                return
            } catch let error as HostedDeviceLinkError {
                pairingState = .failed(Self.message(for: error))
                return
            } catch {
                pairingState = .failed(error.localizedDescription)
                return
            }
        }
    }

    /// Web `HOSTED_LINK_CLAIM_REDEMPTION_GRACE_MS` — keep polling briefly after
    /// the displayed code lifetime so a phone that claims at the last second
    /// still lands, then the outer loop requests a fresh code.
    private static let hostedClaimRedemptionGrace: TimeInterval = 30

    private func startHostedPairing() async throws {
        let pending = try await hostedLinkClient.requestCode()
        pairingState = .awaitingApproval(pending)

        // Poll past the on-screen countdown (web grace) before treating as expired.
        let claim = try await hostedLinkClient.pollUntilClaim(
            pending,
            extraGrace: Self.hostedClaimRedemptionGrace
        )
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
        do {
            let token = try await deviceAuthorizer.pollForToken(
                deviceCode: pending.deviceCode,
                interval: TimeInterval(pending.interval),
                expiresIn: TimeInterval(pending.expiresIn)
            )
            try await applyPairedSession(token)
        } catch let error as DeviceFlowError {
            // Map device-flow expiry into the silent-renew path of startPairing.
            if case .authorizationExpired = error { throw error }
            throw error
        }
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

    /// Household profiles for the current session (`GET /api/v1/users/profiles`).
    /// Caches the last successful list so the profiles screen can still show
    /// faces after a brief reconnect, matching web's saved-profile fallback.
    /// Times out quickly so Who’s watching never blocks on a hung network
    /// (empty stage must still show the dashed add tile).
    func loadProfiles() async -> [AvailableProfile] {
        let cached = cachedProfiles()
        do {
            let profiles = try await withTimeout(seconds: 4) {
                try await self.apiClient.listProfiles()
            }
            cacheProfiles(profiles)
            return profiles
        } catch {
            return cached
        }
    }

    private func withTimeout<T: Sendable>(
        seconds: Double,
        operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw URLError(.timedOut)
            }
            guard let first = try await group.next() else {
                throw URLError(.timedOut)
            }
            group.cancelAll()
            return first
        }
    }

    /// Switch to another household profile (managed-profiles login).
    func switchToProfile(_ profile: AvailableProfile, pin: String? = nil) async throws {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
        let response = try await apiClient.login(
            LoginRequest(
                deviceID: deviceID,
                deviceName: "Playarr Apple TV",
                clientPlatform: .ios,
                clientVersion: version,
                pin: pin,
                profileUserID: profile.id
            )
        )
        try await applyPairedSession(
            TokenResponse(
                accessToken: response.accessToken,
                tokenType: response.tokenType,
                expiresIn: response.expiresIn,
                refreshToken: response.refreshToken
            )
        )
        defaults.set(profile.displayName, forKey: Self.lastProfileNameKey)
    }

    /// True when this install still has a non-expired access token for the
    /// configured server (profiles API can load without re-pairing).
    func hasUsableSession() async -> Bool {
        guard let session = await tokenStore.currentSession() else { return false }
        return session.expiresAt > Date().addingTimeInterval(30)
    }

    private static let lastProfilesKey = "com.playarr.playarr.tvos.lastProfiles"
    private static let lastProfileNameKey = "com.playarr.playarr.tvos.lastProfileName"

    private func cacheProfiles(_ profiles: [AvailableProfile]) {
        guard let data = try? JSONEncoder().encode(profiles) else { return }
        defaults.set(data, forKey: Self.lastProfilesKey)
    }

    private func cachedProfiles() -> [AvailableProfile] {
        guard let data = defaults.data(forKey: Self.lastProfilesKey),
              let profiles = try? JSONDecoder().decode([AvailableProfile].self, from: data) else {
            return []
        }
        return profiles
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
