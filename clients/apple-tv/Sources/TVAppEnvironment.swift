import Foundation
import Observation
import StreamarrKit

protocol TVDeviceAuthorizing: Sendable {
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
    static let serverURLKey = "com.streamarr.playarr.tvos.serverURL"
    static let deviceIDKey = "com.streamarr.playarr.tvos.deviceID"
    static let defaultServerURL = URL(string: "http://localhost:8484")!

    private(set) var apiClient: StreamarrAPIClient
    private(set) var pairingState: TVPairingState = .signedOut
    private(set) var serverURL: URL

    var serverAddress: String

    private let defaults: UserDefaults
    private let deviceID: UUID
    private var deviceAuthorizer: any TVDeviceAuthorizing
    private var accessToken: Sensitive<String>?
    private var refreshToken: Sensitive<String>?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults

        let storedURL = defaults.string(forKey: Self.serverURLKey).flatMap(URL.init(string:))
        let resolvedURL = storedURL ?? Self.defaultServerURL
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
        apiClient = APIClient(configuration: configuration)
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
        return true
    }

    func startPairing() async {
        pairingState = .requestingCode
        do {
            let pending = try await deviceAuthorizer.requestDeviceCode()
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
