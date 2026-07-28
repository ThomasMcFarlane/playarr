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
    /// Default Playarr Server API. The SPA host (playarr.example.com) is not
    /// the API — use the LAN/Tailscale API port operators expose for clients.
    /// Overridable via Settings → Server address or `-PlayarrServerURL`.
    static let defaultServerURL = URL(string: "http://192.0.2.83:8484")!

    private(set) var apiClient: PlayarrAPIClient
    private(set) var pairingState: TVPairingState = .signedOut
    private(set) var serverURL: URL

    var serverAddress: String

    private let defaults: UserDefaults
    private let deviceID: UUID
    private var deviceAuthorizer: any TVDeviceAuthorizing
    private var accessToken: Sensitive<String>?
    private var refreshToken: Sensitive<String>?
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

        let args = ProcessInfo.processInfo.arguments
        let launchURL: URL? = {
            guard let idx = args.firstIndex(of: "-PlayarrServerURL"),
                  args.indices.contains(idx + 1) else { return nil }
            return TVServerAddress.normalisedURL(from: args[idx + 1])
        }()
        let storedURL = defaults.string(forKey: Self.serverURLKey).flatMap(URL.init(string:))
        let resolvedURL = launchURL ?? storedURL ?? Self.defaultServerURL
        serverURL = resolvedURL
        serverAddress = resolvedURL.absoluteString

        if let storedID = defaults.string(forKey: Self.deviceIDKey).flatMap(UUID.init(uuidString:)) {
            deviceID = storedID
        } else {
            let generatedID = UUID()
            deviceID = generatedID
            defaults.set(generatedID.uuidString, forKey: Self.deviceIDKey)
        }

        let configuration = Self.apiConfiguration(serverURL: resolvedURL, deviceID: deviceID)
        // Optional parity bootstrap: `-PlayarrAccessToken <jwt>` forces signed-in
        // so visual captures hit the production shell with a real catalogue.
        let launchToken: String? = {
            guard let idx = args.firstIndex(of: "-PlayarrAccessToken"),
                  args.indices.contains(idx + 1) else { return nil }
            return args[idx + 1]
        }()
        if let launchToken {
            accessToken = Sensitive(launchToken)
            pairingState = .signedIn
            apiClient = APIClient(
                configuration: configuration,
                tokenProvider: StaticTokenProvider(accessToken: launchToken)
            )
        } else {
            apiClient = APIClient(configuration: configuration)
        }
        deviceAuthorizer = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(
                baseURL: resolvedURL,
                // The current server contract has no separate tvOS case;
                // Apple platforms share the `ios` compatibility/policy row.
                clientPlatform: .ios
            )
        )
    }

    @discardableResult
    func saveServerAddress() -> Bool {
        guard let url = TVServerAddress.normalisedURL(from: serverAddress) else { return false }
        serverURL = url
        serverAddress = url.absoluteString
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

    /// Requests a device code, retrying across every address this Apple TV
    /// has ever remembered for its current server group (`lastGoodURL`
    /// first, §7.1's fast path) before surfacing a failure -- §6.4/§8 Phase
    /// 5: "retry across the list before ever re-prompting; only ever
    /// re-prompt for credentials, never for an address, once a group is
    /// known." The address that actually answers becomes `serverURL` (and
    /// this Apple TV's new `lastGoodURL`) so the rest of pairing --
    /// `pollForToken`, and every catalog/playback call once signed in --
    /// consistently targets the address that's actually reachable, not
    /// whichever one happened to be configured before this attempt.
    func startPairing() async {
        pairingState = .requestingCode
        do {
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
            accessToken = Sensitive(token.accessToken)
            refreshToken = Sensitive(token.refreshToken)
            pairingState = .signedIn
        } catch is CancellationError {
            pairingState = .signedOut
        } catch let error as DeviceFlowError {
            pairingState = .failed(Self.message(for: error))
        } catch {
            pairingState = .failed(error.localizedDescription)
        }
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
        defaults.set(url.absoluteString, forKey: Self.serverURLKey)
        apiClient = APIClient(configuration: Self.apiConfiguration(serverURL: url, deviceID: deviceID))
    }

    func signOut() {
        accessToken = nil
        refreshToken = nil
        pairingState = .signedOut
    }

    private func rebuildClients() {
        let configuration = Self.apiConfiguration(serverURL: serverURL, deviceID: deviceID)
        apiClient = APIClient(configuration: configuration)
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
