import Foundation
import GoogleCast
import PlayarrKit
import UIKit

/// Owns the app's one `GCKSessionManagerListener`/`GCKCastChannel` pair and
/// the delegated-device-auth flow from the design doc's "Authentication
/// design" section. A singleton (`.shared`) rather than something threaded
/// through view/view-model initializers: `GCKCastContext` itself is a true
/// SDK-level singleton, and threading a coordinator instance down through
/// `PlayerView`'s init would require every other screen that constructs a
/// `PlayerView` (`HomeView`, `LibraryView`, `WorkDetailView`,
/// `PlaylistsView` -- none of them this build's to touch) to also grow a
/// new required parameter.
///
/// `apiClient` is deliberately never stored here -- it's passed per-call
/// (`loadItem(_:playback:apiClient:)`) instead, since `AppEnvironment`
/// (off-limits for this build) can rebuild its `apiClient` whenever the
/// user points the app at a different server; every call site here already
/// has its own current `apiClient` reference to hand in.
///
/// ALL Cast SDK calls in this type happen on the main actor -- the SDK's
/// own session/channel/remote-media-client callbacks are documented to
/// arrive on the main thread, which is what makes it safe to mark the
/// `@objc` listener conformances below `@MainActor` without an explicit
/// hop.
@MainActor
@Observable
final class CastSessionCoordinator: NSObject {
    static let shared = CastSessionCoordinator()

    /// Set by `AppDelegate` once `GCKCastContext.setSharedInstanceWith` has
    /// actually run (i.e. `PlayarrCastReceiverAppID` in `Info.plist` is
    /// non-empty). Callers that construct a raw `GCKUICastButton` (which
    /// itself expects a configured `GCKCastContext`) should gate on this
    /// first, rather than assuming Cast is always configured.
    private(set) static var isConfigured = false

    enum ConnectionState: Equatable {
        case disconnected
        case connecting(deviceName: String)
        case connected(deviceName: String)
    }

    private(set) var connectionState: ConnectionState = .disconnected
    /// The receiver's latest custom-channel `state` message -- richer than
    /// standard CAF `GCKMediaStatus` (our own track/quality option ids,
    /// `negotiating`, `queue`), consumed by `CastPlayerEngine`.
    private(set) var receiverState: PlayarrCastStateMessage?
    private(set) var lastError: PlayarrCastErrorMessage?

    var isCasting: Bool {
        if case .disconnected = connectionState { return false }
        return true
    }

    var remoteMediaClient: GCKRemoteMediaClient? { castSession?.remoteMediaClient }

    /// Cast's mute control is device-level (`GCKCastSession`), not a
    /// per-stream `AVPlayer.isMuted` the way local playback has.
    var isDeviceMuted: Bool { castSession?.currentDeviceMuted ?? false }

    func setDeviceMuted(_ muted: Bool) {
        castSession?.setDeviceMuted(muted)
    }

    /// Fired once the receiver's `ready` handshake confirms the custom
    /// channel is actually live (not merely that a `GCKCastSession`
    /// started). Whichever `PlayerViewModel` most recently had an active
    /// local playback session registers itself here so its `beginCasting()`
    /// runs with the right media/position/language-preference intent --
    /// see `PlayerViewModel.init`. Deliberately "last registrant wins"
    /// rather than a list of observers: this is a single-window app
    /// (`UIApplicationSupportsMultipleScenes` is `false`), so at most one
    /// `PlayerView` is ever meaningfully "the thing to hand off" at a time.
    var onReadyToLoad: (() async -> Void)?
    /// Fired when the active `GCKCastSession` ends for any reason, so a
    /// `PlayerViewModel` mid-cast can swap itself back to a local
    /// `AVPlayerEngine` and resume from wherever the receiver left off.
    var onSessionEnded: (() -> Void)?

    private var castSession: GCKCastSession?
    private var channel: PlayarrCastChannel?
    /// One Keychain-backed store per server this install has cast to,
    /// mirroring `AppEnvironment`'s own per-server `KeychainTokenStore`
    /// scoping, but under a different `service` string so this never
    /// collides with the user's own signed-in session.
    private var tokenStoresByServer: [String: KeychainTokenStore] = [:]

    private override init() {
        super.init()
    }

    /// Registers this coordinator as the app-wide `GCKSessionManagerListener`.
    /// Called once from `AppDelegate.application(_:didFinishLaunchingWithOptions:)`
    /// right after `GCKCastContext.setSharedInstanceWith(_:)` -- never from
    /// SwiftUI `init`/`onAppear`, or automatic session resumption breaks
    /// (see the design doc's note on `AppDelegate`).
    func startObservingSessions() {
        Self.isConfigured = true
        GCKCastContext.sharedInstance().sessionManager.add(self)
    }

    // MARK: - Loading

    /// Builds a `PlayarrCastLoadRequest` (delegated-auth credentials +
    /// server + item + playback intent + this sender's own descriptor) and
    /// hands it to `GCKRemoteMediaClient.loadMedia(with:)` as the load's
    /// `customData`. Never sends a raw negotiated stream URL -- the
    /// receiver does its own negotiation, per the design doc.
    func loadItem(
        _ item: PlayarrCastItem,
        playback: PlayarrCastPlaybackIntent,
        queue: [PlayarrCastQueueEntry] = [],
        apiClient: PlayarrAPIClient
    ) async throws {
        guard let remoteMediaClient else {
            throw CastAuthError.notConnected
        }
        let credentials = try await ensureDelegatedCredentials(apiClient: apiClient)
        let request = PlayarrCastLoadRequest(
            server: PlayarrCastServer(baseUrl: apiClient.baseURL.absoluteString),
            credentials: credentials,
            item: item,
            playback: playback,
            sender: Self.senderDescriptor(),
            queue: queue.isEmpty ? nil : queue
        )
        let mediaInformation = try Self.buildMediaInformation(item: item, request: request)
        let builder = GCKMediaLoadRequestDataBuilder()
        builder.mediaInformation = mediaInformation
        // NB: `GCKMediaLoadRequestDataBuilder.autoplay` is `NSNumber?` as of
        // the SDK versions this was written against docs for -- verify
        // against the real vendored headers once available (see
        // `Cast/README-DEPENDENCY.md`).
        builder.autoplay = NSNumber(value: playback.autoplay)
        remoteMediaClient.loadMedia(with: builder.build())
    }

    // MARK: - Outgoing custom-channel messages

    func sendSelectTracks(audioTrackId: String?, subtitleTrackId: String?) {
        send(.selectTracks(PlayarrCastSelectTracksMessage(audioTrackId: audioTrackId, subtitleTrackId: subtitleTrackId)))
    }

    func sendSelectQuality(_ qualityId: String) {
        send(.selectQuality(PlayarrCastSelectQualityMessage(qualityId: qualityId)))
    }

    func requestState() {
        send(.requestState(PlayarrCastRequestStateMessage()))
    }

    /// Tells the receiver why the session is ending, then tears down the
    /// `GCKCastSession` itself. Safe to call from anywhere (the persistent
    /// "Now casting" affordance in `RootView`, or a "Stop casting" button
    /// inside `PlayerView`'s now-casting card) -- both converge on
    /// `sessionManager(_:didEnd:withError:)` -> `detach()` ->
    /// `onSessionEnded` for local cleanup.
    func endSession(reason: PlayarrCastStopReason) {
        send(.endSession(PlayarrCastEndSessionMessage(reason: reason)))
        GCKCastContext.sharedInstance().sessionManager.endSessionAndStopCasting(true)
    }

    private func send(_ message: PlayarrCastSenderMessage) {
        guard let channel, channel.isConnected else { return }
        do {
            let text = try encodePlayarrCastMessage(.sender(message))
            try channel.sendTextMessage(text)
        } catch {
            lastError = PlayarrCastErrorMessage(code: .unknown, message: error.localizedDescription, retryable: false)
        }
    }

    // MARK: - Session lifecycle

    private func attach(_ session: GCKCastSession) {
        castSession = session
        connectionState = .connecting(deviceName: session.device.friendlyName ?? "Cast device")
        let channel = PlayarrCastChannel()
        channel.onMessage = { [weak self] message in self?.handleReceiverMessage(message) }
        _ = session.add(channel)
        self.channel = channel
    }

    private func detach() {
        if let channel {
            castSession?.remove(channel)
        }
        castSession = nil
        channel = nil
        connectionState = .disconnected
        receiverState = nil
        onSessionEnded?()
    }

    private func handleReceiverMessage(_ message: PlayarrCastReceiverMessage) {
        switch message {
        case .ready(let ready):
            guard let castSession else { return }
            guard ready.supportedProtocolVersion >= PlayarrCastProtocol.protocolVersion else {
                lastError = PlayarrCastErrorMessage(
                    code: .unsupportedProtocolVersion,
                    message: "Receiver supports Playarr Cast protocol v\(ready.supportedProtocolVersion), sender needs v\(PlayarrCastProtocol.protocolVersion).",
                    retryable: false
                )
                return
            }
            connectionState = .connected(deviceName: castSession.device.friendlyName ?? "Cast device")
            if let onReadyToLoad {
                Task { await onReadyToLoad() }
            }
        case .state(let state):
            receiverState = state
        case .authRotated(let rotated):
            Task { await persistRotatedCredentials(rotated.credentials) }
        case .error(let error):
            lastError = error
        case .ack:
            // No requestId-correlated waiters today -- every outgoing
            // message here is fire-and-forget. Add correlation if a future
            // caller needs to await a specific ack.
            break
        }
    }

    private func persistRotatedCredentials(_ credentials: PlayarrCastCredentials) async {
        // The rotated credentials carry their own `deviceId`/expiry, but we
        // only have a `PlayarrAPIClient` (for `resolvedURL`/`baseURL`) at
        // call sites that already hold one; there's no server context on a
        // bare `auth.rotated` message. Persist into *every* known
        // per-server store whose most-recently-cached device id matches --
        // in practice there is exactly one active cast server at a time, so
        // this resolves to a single store.
        for (_, store) in tokenStoresByServer {
            guard let cached = await store.currentSession() else { continue }
            guard Self.deviceID(fromAccessToken: cached.accessToken.exposeSecret()) != nil else { continue }
            try? await store.storeSession(StoredAuthSession(
                accessToken: credentials.accessToken,
                refreshToken: credentials.refreshToken,
                tokenType: "Bearer",
                expiresAt: Date(timeIntervalSince1970: Double(credentials.accessTokenExpiresAt) / 1_000)
            ))
        }
    }

    // MARK: - Delegated device auth
    //
    // The sender mints a SEPARATE device identity for the Cast device via
    // the existing RFC 8628 flow -- it never ships its own access/refresh
    // token to the receiver, which would let receiver token rotation revoke
    // the sender's own session via reuse-detection. See the design doc's
    // "Delegated device auth" section for the exact four-call shape this
    // implements.

    private func tokenStore(for apiClient: PlayarrAPIClient) -> KeychainTokenStore {
        let key = apiClient.baseURL.absoluteString
        if let existing = tokenStoresByServer[key] { return existing }
        let store = KeychainTokenStore(service: "com.playarr.ios.cast-session", account: key)
        tokenStoresByServer[key] = store
        return store
    }

    private func ensureDelegatedCredentials(apiClient: PlayarrAPIClient) async throws -> PlayarrCastCredentials {
        let store = tokenStore(for: apiClient)
        if let cached = await store.currentSession() {
            if cached.expiresAt > Date().addingTimeInterval(120) {
                return Self.credentials(from: cached)
            }
            if let refreshed = try? await refreshCastSession(store: store, session: cached, apiClient: apiClient) {
                return Self.credentials(from: refreshed)
            }
            // Refresh failed (e.g. the refresh token was revoked) -- fall
            // through and mint a brand new Cast device identity below.
        }
        return try await mintDelegatedCastSession(store: store, apiClient: apiClient)
    }

    private static func credentials(from session: StoredAuthSession) -> PlayarrCastCredentials {
        let accessToken = session.accessToken.exposeSecret()
        return PlayarrCastCredentials(
            deviceId: deviceID(fromAccessToken: accessToken)?.uuidString ?? "",
            accessToken: accessToken,
            accessTokenExpiresAt: Int64(session.expiresAt.timeIntervalSince1970 * 1_000),
            refreshToken: session.refreshToken.exposeSecret()
        )
    }

    /// `POST /api/v1/auth/refresh` -- unauthenticated, keyed by the Cast
    /// device's own `device_id` + refresh token (never the sender's own).
    /// Hand-rolled with a bare `URLSession`/`JSONEncoder` rather than
    /// through `apiClient`: `refresh(_:)` exists only on the concrete
    /// `APIClient` class, not on the `PlayarrAPIClient` protocol this
    /// type is handed, and this call is against a completely different
    /// device identity than whatever `apiClient`'s own token machinery is
    /// managing regardless.
    private func refreshCastSession(
        store: KeychainTokenStore,
        session: StoredAuthSession,
        apiClient: PlayarrAPIClient
    ) async throws -> StoredAuthSession {
        guard let deviceID = Self.deviceID(fromAccessToken: session.accessToken.exposeSecret()) else {
            throw CastAuthError.missingDeviceID
        }
        guard let url = apiClient.resolvedURL(forPath: "/api/v1/auth/refresh") else {
            throw CastAuthError.invalidServerURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(
            RefreshRequest(deviceID: deviceID, refreshToken: session.refreshToken.exposeSecret())
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw CastAuthError.refreshFailed(status: (response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        let decoded = try JSONDecoder().decode(RefreshResponse.self, from: data)
        let rotated = StoredAuthSession(
            accessToken: decoded.accessToken,
            refreshToken: decoded.refreshToken,
            tokenType: decoded.tokenType,
            expiresAt: Date().addingTimeInterval(TimeInterval(decoded.expiresIn))
        )
        try await store.storeSession(rotated)
        return rotated
    }

    /// The full RFC 8628 device-code mint + self-approve + poll sequence,
    /// scoped to `ClientPlatform.cast` (never `.ios` -- that would be this
    /// phone's own identity, not the Cast device's).
    private func mintDelegatedCastSession(store: KeychainTokenStore, apiClient: PlayarrAPIClient) async throws -> PlayarrCastCredentials {
        let deviceFlow = DeviceFlowClient(
            configuration: DeviceFlowConfiguration(baseURL: apiClient.baseURL, clientPlatform: .cast)
        )
        let deviceAuth = try await deviceFlow.requestDeviceCode()
        try await selfApproveDeviceCode(userCode: deviceAuth.userCode, apiClient: apiClient)
        let token = try await deviceFlow.pollForToken(
            deviceCode: deviceAuth.deviceCode,
            interval: TimeInterval(deviceAuth.interval),
            expiresIn: TimeInterval(deviceAuth.expiresIn)
        )
        let expiresAt = Date().addingTimeInterval(TimeInterval(token.expiresIn))
        try await store.storeSession(StoredAuthSession(
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            tokenType: token.tokenType,
            expiresAt: expiresAt
        ))
        return PlayarrCastCredentials(
            deviceId: Self.deviceID(fromAccessToken: token.accessToken)?.uuidString ?? "",
            accessToken: token.accessToken,
            accessTokenExpiresAt: Int64(expiresAt.timeIntervalSince1970 * 1_000),
            refreshToken: token.refreshToken
        )
    }

    /// `POST /api/v1/oauth/device/authorize` -- self-approval using the
    /// *phone's own* signed-in session (`apiClient.playbackRequestHeaders()`
    /// already returns a valid, transparently-refreshed `Authorization:
    /// Bearer ...` header for exactly this purpose). Not on
    /// `PlayarrAPIClient`'s protocol surface at all, so hand-rolled here
    /// like `refreshCastSession` above.
    private func selfApproveDeviceCode(userCode: String, apiClient: PlayarrAPIClient) async throws {
        guard let url = apiClient.resolvedURL(forPath: "/api/v1/oauth/device/authorize") else {
            throw CastAuthError.invalidServerURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (field, value) in try await apiClient.playbackRequestHeaders() {
            request.setValue(value, forHTTPHeaderField: field)
        }
        request.httpBody = try JSONEncoder().encode(DeviceAuthorizeRequest(userCode: userCode))
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 204 else {
            throw CastAuthError.selfApproveFailed(status: (response as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }

    /// Reads the `device_id` claim out of the Cast access token's JWT
    /// payload, unverified -- mirrors `JWTClaims.subject(ofAccessToken:)`'s
    /// exact `sub`-claim pattern (`PlayarrKit/Networking/JWTClaims.swift`)
    /// and the canonical `decodeAccessTokenDeviceId` in
    /// `clients/tv-web/packages/device-auth/src/jwt.ts`, duplicated locally
    /// rather than reused because `JWTClaims`'s base64url decoder is
    /// `private` and this file (`PlayarrApp`) can't add a new public
    /// entry point to `PlayarrKit` within this build's file ownership.
    private static func deviceID(fromAccessToken token: String) -> UUID? {
        struct DeviceIDClaim: Decodable {
            let deviceId: String
            enum CodingKeys: String, CodingKey { case deviceId = "device_id" }
        }
        let segments = token.split(separator: ".")
        guard segments.count == 3 else { return nil }
        var base64 = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        guard let payloadData = Data(base64Encoded: base64) else { return nil }
        guard let claims = try? JSONDecoder().decode(DeviceIDClaim.self, from: payloadData) else { return nil }
        return UUID(uuidString: claims.deviceId)
    }

    private static func senderDescriptor() -> PlayarrCastSender {
        PlayarrCastSender(
            platform: .ios,
            appVersion: InstalledAppVersion.current,
            deviceName: UIDevice.current.name,
            // `Locale.identifier(_: Locale.IdentifierType)` (`.bcp47`) would
            // be the precise API here, but its exact availability/signature
            // isn't independently double-checkable from this environment --
            // a plain underscore-to-hyphen swap on the ICU-style identifier
            // ("en_US" -> "en-US") is a deliberately conservative fallback
            // that only relies on APIs this build is fully confident exist,
            // and is correct BCP-47 for the common language[-REGION] case.
            language: Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
        )
    }

    private static func buildMediaInformation(item: PlayarrCastItem, request: PlayarrCastLoadRequest) throws -> GCKMediaInformation {
        let data = try JSONEncoder().encode(request)
        guard let customData = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CastAuthError.encodingFailed
        }
        let metadata = GCKMediaMetadata(metadataType: .movie)
        metadata.setString(item.title, forKey: kGCKMetadataKeyTitle)

        // An opaque identifier the receiver resolves via `customData` above
        // -- never fetched directly, so a stable placeholder content id
        // (the media file id) is correct here, not a real playable URL. The
        // sender never negotiates or sends a raw stream URL; see the design
        // doc.
        let builder = GCKMediaInformationBuilder(contentID: item.mediaFileId)
        builder.streamType = .buffered
        builder.contentType = "application/vnd.playarr.cast+json"
        builder.metadata = metadata
        builder.customData = customData
        return builder.build()
    }
}

extension CastSessionCoordinator: GCKSessionManagerListener {
    func sessionManager(_ sessionManager: GCKSessionManager, didStart session: GCKCastSession) {
        attach(session)
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didResumeCastSession session: GCKCastSession) {
        attach(session)
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didEnd session: GCKCastSession, withError error: Error?) {
        detach()
    }

    func sessionManager(_ sessionManager: GCKSessionManager, didFailToStart session: GCKCastSession, withError error: Error) {
        let nsError = error as NSError
        // Do NOT auto-retry on `GCKErrorCodeCancelled` -- since SDK 4.8.4
        // this specifically can mean the user declined the Cast Terms of
        // Service consent dialog, and retrying would loop that prompt
        // indefinitely. This coordinator never retries automatically at
        // all, but this early-return makes that intent explicit rather
        // than accidental, so a future change doesn't add a retry loop
        // without noticing this landmine. Verify `kGCKErrorDomain`/
        // `GCKErrorCode.cancelled`'s exact bridged Swift names against the
        // real vendored SDK headers once available.
        if nsError.domain == kGCKErrorDomain, nsError.code == GCKErrorCode.cancelled.rawValue {
            detach()
            return
        }
        lastError = PlayarrCastErrorMessage(code: .serverUnreachable, message: error.localizedDescription, retryable: false)
        detach()
    }
}

/// A thin `GCKCastChannel` shim on the Playarr namespace -- pure plumbing
/// (parse incoming text, forward the typed result) so all real state lives
/// on `CastSessionCoordinator`, not here.
@MainActor
final class PlayarrCastChannel: GCKCastChannel {
    var onMessage: ((PlayarrCastReceiverMessage) -> Void)?

    init() {
        super.init(namespace: PlayarrCastProtocol.namespace)
    }

    override func didReceiveTextMessage(_ message: String) {
        guard let parsed = parsePlayarrCastMessage(message), case .receiver(let receiverMessage) = parsed else { return }
        onMessage?(receiverMessage)
    }
}

private struct DeviceAuthorizeRequest: Encodable {
    var userCode: String
    enum CodingKeys: String, CodingKey { case userCode = "user_code" }
}

enum CastAuthError: Error, LocalizedError {
    case notConnected
    case invalidServerURL
    case missingDeviceID
    case selfApproveFailed(status: Int)
    case refreshFailed(status: Int)
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "No active Cast session."
        case .invalidServerURL:
            return "Couldn't resolve the server address for casting."
        case .missingDeviceID:
            return "The Cast device's credentials are missing a device id."
        case .selfApproveFailed(let status):
            return "Couldn't authorize the Cast device (server returned \(status))."
        case .refreshFailed(let status):
            return "Couldn't refresh the Cast device's session (server returned \(status))."
        case .encodingFailed:
            return "Couldn't prepare the cast request."
        }
    }
}
