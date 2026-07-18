import Foundation
import Observation
import StreamarrKit

@MainActor
@Observable
public final class SettingsViewModel {
    public var serverBaseURLText: String
    public private(set) var isSignedIn: Bool
    public private(set) var isSigningIn = false
    public private(set) var deviceCode: DeviceCodeResponse?
    public private(set) var errorMessage: String?

    private let environment: AppEnvironment

    public init(environment: AppEnvironment) {
        self.environment = environment
        self.serverBaseURLText = environment.serverBaseURL.absoluteString
        self.isSignedIn = environment.isSignedIn
    }

    public func applyServerURL() {
        guard let url = URL(string: serverBaseURLText), url.scheme != nil, url.host != nil else {
            errorMessage = "That doesn't look like a valid server URL."
            return
        }
        errorMessage = nil
        environment.serverBaseURL = url
    }

    /// Drives the full RFC 8628 device-authorization flow (see
    /// `DeviceFlowClient`) against the real `/api/v1/oauth/device/code` +
    /// `/api/v1/oauth/token` endpoints.
    public func signIn() async {
        isSigningIn = true
        errorMessage = nil
        defer {
            isSigningIn = false
            deviceCode = nil
        }

        do {
            let token = try await environment.deviceFlowClient.authorize { [weak self] pending in
                Task { @MainActor in
                    self?.deviceCode = pending
                }
            }
            try await environment.setSession(
                accessToken: token.accessToken,
                refreshToken: token.refreshToken,
                tokenType: token.tokenType,
                expiresIn: token.expiresIn
            )
            isSignedIn = true
        } catch let error as DeviceFlowError {
            errorMessage = Self.describe(error)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func signOut() async {
        do {
            try await environment.signOut()
            isSignedIn = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func describe(_ error: DeviceFlowError) -> String {
        switch error {
        case .invalidBaseURL:
            return "The server URL isn't valid."
        case .invalidResponse:
            return "The server sent back a response we couldn't understand."
        case .http(let status, _):
            return "The server returned an unexpected error (\(status))."
        case .oauth(let code):
            switch code {
            case .accessDenied:
                return "Sign-in was denied."
            case .expiredToken:
                return "That sign-in code expired. Try again."
            case .unsupportedGrantType:
                return "This app's sign-in request wasn't accepted by the server."
            case .authorizationPending, .slowDown:
                return "Still waiting for sign-in to complete."
            case .other(let raw):
                return "Sign-in failed: \(raw)."
            }
        case .authorizationExpired:
            return "That sign-in code expired. Try again."
        case .accessDenied:
            return "Sign-in was denied."
        case .transport(let underlying):
            return underlying.localizedDescription
        case .decoding:
            return "The server's response didn't match what this app expected."
        }
    }
}
