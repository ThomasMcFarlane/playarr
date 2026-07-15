import Foundation
import Observation
import StreamarrKit

@MainActor
@Observable
public final class SettingsViewModel {
    public var serverBaseURLText: String
    public private(set) var currentUser: User?
    public private(set) var isSigningIn = false
    public private(set) var deviceAuthorization: DeviceAuthorizationResponse?
    public private(set) var errorMessage: String?

    private let environment: AppEnvironment

    public init(environment: AppEnvironment) {
        self.environment = environment
        self.serverBaseURLText = environment.serverBaseURL.absoluteString
        self.currentUser = environment.currentUser
    }

    public func applyServerURL() {
        guard let url = URL(string: serverBaseURLText) else {
            errorMessage = "That doesn't look like a valid server URL."
            return
        }
        environment.serverBaseURL = url
    }

    /// Drives the full RFC 8628 device-authorization flow (see
    /// `DeviceFlowClient`) and, on success, fetches the signed-in user.
    public func signIn() async {
        isSigningIn = true
        errorMessage = nil
        defer {
            isSigningIn = false
            deviceAuthorization = nil
        }

        do {
            let token = try await environment.deviceFlowClient.authorize { [weak self] pending in
                Task { @MainActor in
                    self?.deviceAuthorization = pending
                }
            }
            await environment.setSession(accessToken: token.accessToken, refreshToken: token.refreshToken)

            let user = try await environment.apiClient.fetchCurrentUser()
            environment.setCurrentUser(user)
            currentUser = user
        } catch {
            errorMessage = String(describing: error)
        }
    }

    public func signOut() async {
        await environment.signOut()
        currentUser = nil
    }
}
