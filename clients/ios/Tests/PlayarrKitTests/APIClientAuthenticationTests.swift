import Foundation
import PlayarrKit
import XCTest

final class APIClientAuthenticationTests: XCTestCase {
    override func tearDown() {
        URLProtocolStub.handler = nil
        super.tearDown()
    }

    func testProtectedRequestLogsInAndAttachesBearerToken() async throws {
        let store = TestTokenStore()
        var paths: [String] = []
        URLProtocolStub.handler = { request in
            paths.append(request.url!.path)
            switch request.url!.path {
            case "/api/v1/auth/login":
                return Self.response(
                    request,
                    json: #"{"access_token":"access-one","refresh_token":"refresh-one","token_type":"Bearer","expires_in":900,"user_id":"00000000-0000-0000-0000-000000000001"}"#
                )
            case "/api/v1/catalog":
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access-one")
                return Self.response(request, json: #"{"items":[],"total":0}"#)
            default:
                return Self.response(request, status: 404, json: #"{"error":"not_found","message":"unexpected path"}"#)
            }
        }

        let page = try await makeClient(store: store).browseCatalog()
        let storedSession = await store.currentSession()

        XCTAssertEqual(page.items.count, 0)
        XCTAssertEqual(paths, ["/api/v1/auth/login", "/api/v1/catalog"])
        XCTAssertEqual(storedSession?.refreshToken.exposeSecret(), "refresh-one")
    }

    func testExplicitLoginSendsUsernamePasswordAndIOSIdentity() async throws {
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/auth/login")
            let body = String(decoding: Self.bodyData(for: request), as: UTF8.self)
            XCTAssertTrue(body.contains(#""username":"thomas""#))
            XCTAssertTrue(body.contains(#""password":"correct horse battery staple""#))
            XCTAssertTrue(body.contains(#""client_platform":"ios""#))
            return Self.response(
                request,
                json: #"{"access_token":"access","refresh_token":"refresh","token_type":"Bearer","expires_in":900,"user_id":"00000000-0000-0000-0000-000000000001"}"#
            )
        }

        let response = try await makeClient(store: TestTokenStore()).login(
            LoginRequest(
                deviceID: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                deviceName: "Playarr Tests",
                clientPlatform: .ios,
                clientVersion: "0.1.0",
                password: "correct horse battery staple",
                username: "thomas"
            )
        )

        XCTAssertEqual(response.userID.uuidString.lowercased(), "00000000-0000-0000-0000-000000000001")
    }

    func testExpiredSessionRotatesRefreshTokenBeforeProtectedRequest() async throws {
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: "expired-access",
                refreshToken: "refresh-old",
                tokenType: "Bearer",
                expiresAt: .distantPast
            )
        )
        URLProtocolStub.handler = { request in
            switch request.url!.path {
            case "/api/v1/auth/refresh":
                let body = String(decoding: Self.bodyData(for: request), as: UTF8.self)
                XCTAssertTrue(body.contains("refresh-old"))
                return Self.response(
                    request,
                    json: #"{"access_token":"access-new","refresh_token":"refresh-new","token_type":"Bearer","expires_in":900,"user_id":"00000000-0000-0000-0000-000000000001"}"#
                )
            case "/api/v1/catalog":
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access-new")
                return Self.response(request, json: #"{"items":[],"total":0}"#)
            default:
                return Self.response(request, status: 404, json: #"{"error":"not_found","message":"unexpected path"}"#)
            }
        }

        _ = try await makeClient(store: store).browseCatalog()
        let storedSession = await store.currentSession()

        XCTAssertEqual(storedSession?.refreshToken.exposeSecret(), "refresh-new")
    }

    func testAuthenticatedPlaylistMutationUsesWebContract() async throws {
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: "access",
                refreshToken: "refresh",
                tokenType: "Bearer",
                expiresAt: .distantFuture
            )
        )
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/playlists")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access")
            let body = String(decoding: Self.bodyData(for: request), as: UTF8.self)
            XCTAssertTrue(body.contains(#""name":"Road trip""#))
            XCTAssertTrue(body.contains(#""media_type":"audio""#))
            return Self.response(
                request,
                json: #"{"id":"00000000-0000-0000-0000-000000000010","name":"Road trip","owner_user_id":"00000000-0000-0000-0000-000000000001","parent_playlist_id":null,"is_system":false,"media_type":"audio","created_at":"2026-07-19T00:00:00Z","updated_at":"2026-07-19T00:00:00Z"}"#
            )
        }

        let playlist = try await makeClient(store: store).createPlaylist(
            CreatePlaylistRequest(name: "Road trip", mediaType: .audio)
        )
        XCTAssertEqual(playlist.name, "Road trip")
        XCTAssertEqual(playlist.mediaType, .audio)
    }

    func testPlaybackInfoDecodesAllInteractiveOptions() async throws {
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: "access",
                refreshToken: "refresh",
                tokenType: "Bearer",
                expiresAt: .distantFuture
            )
        )
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/playback/00000000-0000-0000-0000-000000000020")
            return Self.response(
                request,
                json: #"{"mode":"hls","url":"/stream.m3u8","audio_tracks":[{"id":"audio-1","stream_index":1,"label":"English","language":"en","codec":"aac","channels":2,"is_default":true}],"duration_ms":7200000,"mime_type":"application/vnd.apple.mpegurl","quality_options":[{"id":"original","label":"Original","profile":null,"height":null,"video_bitrate_bps":null}],"selected_audio_track_id":"audio-1","selected_quality_id":"original","selected_subtitle_track_id":null,"session_id":"00000000-0000-0000-0000-000000000021","source_offset_ms":0,"subtitle_tracks":[]}"#
            )
        }

        let info = try await makeClient(store: store).playbackInfo(
            mediaFileID: UUID(uuidString: "00000000-0000-0000-0000-000000000020")!
        )
        XCTAssertEqual(info.durationMS, 7_200_000)
        XCTAssertEqual(info.sessionID, UUID(uuidString: "00000000-0000-0000-0000-000000000021"))
        XCTAssertEqual(info.audioTracks.first?.language, "en")
        XCTAssertEqual(info.selectedQualityID, "original")
    }

    func testLibraryBrowseMatchesWebAvailabilityAndOrderingQuery() async throws {
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: "access",
                refreshToken: "refresh",
                tokenType: "Bearer",
                expiresAt: .distantFuture
            )
        )
        URLProtocolStub.handler = { request in
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let query = Dictionary(uniqueKeysWithValues: (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
            XCTAssertEqual(query["kind"], "movie")
            XCTAssertEqual(query["available_only"], "true")
            XCTAssertEqual(query["sort"], "date_added")
            XCTAssertEqual(query["order"], "desc")
            XCTAssertEqual(query["limit"], "200")
            XCTAssertEqual(query["offset"], "400")
            return Self.response(request, json: #"{"items":[],"total":400}"#)
        }

        _ = try await makeClient(store: store).browseLibrary(
            kind: .movie,
            sort: "date_added",
            order: "desc",
            availableOnly: true,
            limit: 200,
            offset: 400
        )
    }

    func testFolderBrowseUsesOpaqueRootAndRelativePath() async throws {
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: "access",
                refreshToken: "refresh",
                tokenType: "Bearer",
                expiresAt: .distantFuture
            )
        )
        let rootID = UUID(uuidString: "00000000-0000-0000-0000-000000000040")!
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/folders/\(rootID.uuidString)")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access")
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let query = Dictionary(uniqueKeysWithValues: (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
            XCTAssertEqual(query["path"], "Season 1/Extras")
            XCTAssertEqual(query["limit"], "200")
            XCTAssertEqual(query["offset"], "0")
            return Self.response(
                request,
                json: """
                {
                  "root": {
                    "id": "\(rootID.uuidString)",
                    "source_instance_id": "00000000-0000-0000-0000-000000000041",
                    "source_name": "Sonarr",
                    "library_kind": "series",
                    "name": "TV",
                    "available": true,
                    "unavailable_reason": null
                  },
                  "path": "Season 1/Extras",
                  "breadcrumbs": [{"name":"TV","path":""}],
                  "entries": [],
                  "total": 0,
                  "offset": 0,
                  "limit": 200
                }
                """
            )
        }

        let response = try await makeClient(store: store).browseFolder(
            rootID: rootID,
            path: "Season 1/Extras",
            limit: 200,
            offset: 0
        )

        XCTAssertEqual(response.root.id, rootID)
        XCTAssertEqual(response.path, "Season 1/Extras")
    }

    func testFolderThumbnailUsesAuthenticatedMediaRoute() async throws {
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: "access",
                refreshToken: "refresh",
                tokenType: "Bearer",
                expiresAt: .distantFuture
            )
        )
        let mediaFileID = UUID(uuidString: "00000000-0000-0000-0000-000000000042")!
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/media/\(mediaFileID.uuidString)/thumbnail")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access")
            return Self.response(request, json: "thumbnail")
        }

        let data = try await makeClient(store: store).fetchMediaThumbnail(mediaFileID: mediaFileID)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "thumbnail")
    }

    func testAlbumArtworkUsesAuthenticatedWebRoute() async throws {
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: "access",
                refreshToken: "refresh",
                tokenType: "Bearer",
                expiresAt: .distantFuture
            )
        )
        URLProtocolStub.handler = { request in
            XCTAssertEqual(
                request.url?.path,
                "/api/v1/artwork/album/00000000-0000-0000-0000-000000000030/00000000-0000-0000-0000-000000000031/poster"
            )
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access")
            return Self.response(request, json: "album-art")
        }

        let data = try await makeClient(store: store).fetchAlbumArtwork(
            artistWorkID: UUID(uuidString: "00000000-0000-0000-0000-000000000030")!,
            albumID: UUID(uuidString: "00000000-0000-0000-0000-000000000031")!,
            kind: .poster
        )
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "album-art")
    }

    func testProfileAvatarUpdateUsesAuthenticatedWebContract() async throws {
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: "access",
                refreshToken: "refresh",
                tokenType: "Bearer",
                expiresAt: .distantFuture
            )
        )
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/users/me/profile-avatar")
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access")
            let body = String(decoding: Self.bodyData(for: request), as: UTF8.self)
            XCTAssertTrue(body.contains(#""kind":"preset""#))
            XCTAssertTrue(body.contains(#""value":"robot""#))
            return Self.response(
                request,
                json: #"{"preference":{"kind":"preset","value":"robot"}}"#
            )
        }

        let saved = try await makeClient(store: store).updateProfileAvatar(
            UpdateProfileAvatarRequest(
                preference: ProfileAvatarPreference(kind: .preset, value: "robot")
            )
        )

        XCTAssertEqual(saved.preference?.kind, .preset)
        XCTAssertEqual(saved.preference?.value, "robot")
    }

    // MARK: - Peer-group refresh/login scoping
    //
    // `docs/architecture/peer-groups.md` §3.7/§6.4, this bug fix: a refresh
    // token issued by one peer node is never valid on a genuinely different
    // node (refresh tokens aren't synced -- only accounts/policies are), so
    // `AccessTokenCoordinator` must only retry a refresh against addresses
    // attributed to the *same* node, while the credential-less login
    // fallback -- valid at any node -- keeps retrying across the whole
    // group.

    func testRefreshRetriesOnlySameNodeAddressesNeverAnotherPeer() async throws {
        let nodeA = UUID()
        let nodeB = UUID()
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: Self.fakeAccessToken(issuer: nodeA.uuidString),
                refreshToken: "refresh-old",
                tokenType: "Bearer",
                expiresAt: .distantPast
            )
        )
        let serverGroupStore = InMemoryKnownServerGroupStore(
            group: KnownServerGroup(servers: [
                KnownServer(url: "https://primary.invalid", peerNodeID: nodeA),
                KnownServer(url: "https://node-a-alt.invalid", peerNodeID: nodeA),
                KnownServer(url: "https://node-b.invalid", peerNodeID: nodeB),
            ])
        )

        var refreshedHosts: [String] = []
        URLProtocolStub.handler = { request in
            guard request.url!.path == "/api/v1/auth/refresh" else {
                return Self.response(request, status: 404, json: #"{"error":"not_found","message":"unexpected path"}"#)
            }
            let host = request.url!.host!
            refreshedHosts.append(host)
            guard host == "node-a-alt.invalid" else {
                return Self.response(request, status: 401, json: #"{"error":"unauthorized","message":"nope"}"#)
            }
            return Self.response(
                request,
                json: #"{"access_token":"access-new","refresh_token":"refresh-new","token_type":"Bearer","expires_in":900,"user_id":"00000000-0000-0000-0000-000000000001"}"#
            )
        }

        let client = makeClient(baseURL: "https://primary.invalid", store: store, serverGroupStore: serverGroupStore)
        let headers = try await client.playbackRequestHeaders()

        XCTAssertEqual(headers["Authorization"], "Bearer access-new")
        XCTAssertEqual(refreshedHosts, ["primary.invalid", "node-a-alt.invalid"])
        XCTAssertFalse(
            refreshedHosts.contains("node-b.invalid"),
            "refresh must never be retried against a genuinely different peer node's address"
        )
    }

    func testExhaustedSameNodeRefreshFallsThroughToAnyNodeLogin() async throws {
        let nodeA = UUID()
        let nodeB = UUID()
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: Self.fakeAccessToken(issuer: nodeA.uuidString),
                refreshToken: "refresh-old",
                tokenType: "Bearer",
                expiresAt: .distantPast
            )
        )
        let serverGroupStore = InMemoryKnownServerGroupStore(
            group: KnownServerGroup(servers: [
                KnownServer(url: "https://primary.invalid", peerNodeID: nodeA),
                KnownServer(url: "https://node-a-alt.invalid", peerNodeID: nodeA),
                KnownServer(url: "https://node-b.invalid", peerNodeID: nodeB),
            ])
        )

        var loggedInHosts: [String] = []
        URLProtocolStub.handler = { request in
            switch request.url!.path {
            case "/api/v1/auth/refresh":
                // Every same-node candidate (nodeA's two addresses) fails --
                // this token is dead everywhere it could possibly still work.
                return Self.response(request, status: 401, json: #"{"error":"unauthorized","message":"nope"}"#)
            case "/api/v1/auth/login":
                let host = request.url!.host!
                loggedInHosts.append(host)
                guard host == "node-b.invalid" else {
                    return Self.response(request, status: 401, json: #"{"error":"unauthorized","message":"nope"}"#)
                }
                return Self.response(
                    request,
                    json: #"{"access_token":"access-fresh","refresh_token":"refresh-fresh","token_type":"Bearer","expires_in":900,"user_id":"00000000-0000-0000-0000-000000000001"}"#
                )
            default:
                return Self.response(request, status: 404, json: #"{"error":"not_found","message":"unexpected path"}"#)
            }
        }

        let client = makeClient(baseURL: "https://primary.invalid", store: store, serverGroupStore: serverGroupStore)
        let headers = try await client.playbackRequestHeaders()

        XCTAssertEqual(headers["Authorization"], "Bearer access-fresh")
        // Unlike refresh, the credential-less login fallback is valid at any
        // node (accounts/policies sync) -- it must reach node-b even though
        // refresh never touched it.
        XCTAssertEqual(loggedInHosts, ["primary.invalid", "node-a-alt.invalid", "node-b.invalid"])
    }

    func testRefreshIsInertAcrossAGroupWithNoRecordedPeerAttribution() async throws {
        let nodeA = UUID()
        let store = TestTokenStore(
            session: StoredAuthSession(
                accessToken: Self.fakeAccessToken(issuer: nodeA.uuidString),
                refreshToken: "refresh-old",
                tokenType: "Bearer",
                expiresAt: .distantPast
            )
        )
        // A group remembered before the server attributed addresses to peer
        // nodes -- every `peerNodeID` is `nil`.
        let serverGroupStore = InMemoryKnownServerGroupStore(
            group: KnownServerGroup(servers: [
                KnownServer(url: "https://primary.invalid"),
                KnownServer(url: "https://unattributed-alt.invalid"),
            ])
        )

        var refreshedHosts: [String] = []
        var loggedInHosts: [String] = []
        URLProtocolStub.handler = { request in
            switch request.url!.path {
            case "/api/v1/auth/refresh":
                refreshedHosts.append(request.url!.host!)
                return Self.response(request, status: 401, json: #"{"error":"unauthorized","message":"nope"}"#)
            case "/api/v1/auth/login":
                let host = request.url!.host!
                loggedInHosts.append(host)
                guard host == "unattributed-alt.invalid" else {
                    return Self.response(request, status: 401, json: #"{"error":"unauthorized","message":"nope"}"#)
                }
                return Self.response(
                    request,
                    json: #"{"access_token":"access-fresh","refresh_token":"refresh-fresh","token_type":"Bearer","expires_in":900,"user_id":"00000000-0000-0000-0000-000000000001"}"#
                )
            default:
                return Self.response(request, status: 404, json: #"{"error":"not_found","message":"unexpected path"}"#)
            }
        }

        let client = makeClient(baseURL: "https://primary.invalid", store: store, serverGroupStore: serverGroupStore)
        let headers = try await client.playbackRequestHeaders()

        XCTAssertEqual(headers["Authorization"], "Bearer access-fresh")
        // No attribution means no confidently-same-node candidate exists --
        // refresh degrades to just the primary address, never the
        // unattributed alternate.
        XCTAssertEqual(refreshedHosts, ["primary.invalid"])
        // Login, unaffected by attribution, still retries the whole group.
        XCTAssertEqual(loggedInHosts, ["primary.invalid", "unattributed-alt.invalid"])
    }

    private func makeClient(store: TestTokenStore) -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return APIClient(
            configuration: APIClientConfiguration(
                baseURL: URL(string: "https://playarr.invalid")!,
                clientVersion: "0.1.0",
                deviceID: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                deviceName: "Playarr Tests",
                urlSessionConfiguration: configuration
            ),
            tokenProvider: store
        )
    }

    private func makeClient(
        baseURL: String,
        store: TestTokenStore,
        serverGroupStore: InMemoryKnownServerGroupStore
    ) -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return APIClient(
            configuration: APIClientConfiguration(
                baseURL: URL(string: baseURL)!,
                clientVersion: "0.1.0",
                deviceID: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                deviceName: "Playarr Tests",
                urlSessionConfiguration: configuration
            ),
            tokenProvider: store,
            serverGroupStore: serverGroupStore
        )
    }

    /// Builds an unsigned three-segment JWT string carrying `iss` (plus the
    /// other claims `JWTClaims`/`AccessTokenClaims` expect) -- enough for
    /// `JWTClaims.issuerPeerID(ofAccessToken:)` to decode, since it never
    /// verifies a signature (see that function's own doc comment). The
    /// third segment is a non-empty placeholder rather than truly empty --
    /// `String.split(separator:)` drops empty trailing subsequences by
    /// default, which would otherwise make this look like a two-segment
    /// (malformed) token to `JWTClaims`.
    private static func fakeAccessToken(issuer: String) -> String {
        let header = try! JSONSerialization.data(withJSONObject: ["alg": "none", "typ": "JWT"])
        let payload = try! JSONSerialization.data(withJSONObject: [
            "sub": UUID().uuidString,
            "device_id": UUID().uuidString,
            "session_id": UUID().uuidString,
            "iss": issuer,
            "iat": 0,
            "exp": 9_999_999_999,
        ])
        func base64URL(_ data: Data) -> String {
            data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        return "\(base64URL(header)).\(base64URL(payload)).unsigned"
    }

    private static func response(
        _ request: URLRequest,
        status: Int = 200,
        json: String
    ) -> (HTTPURLResponse, Data) {
        (
            HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!,
            Data(json.utf8)
        )
    }

    private static func bodyData(for request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }

        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private actor TestTokenStore: AccessTokenProviding {
    private var session: StoredAuthSession?

    init(session: StoredAuthSession? = nil) {
        self.session = session
    }

    func currentSession() -> StoredAuthSession? { session }
    func storeSession(_ session: StoredAuthSession) { self.session = session }
    func clearSession() { session = nil }
}

private actor InMemoryKnownServerGroupStore: KnownServerGroupStoring {
    private var group: KnownServerGroup?

    init(group: KnownServerGroup? = nil) {
        self.group = group
    }

    func currentGroup() -> KnownServerGroup? { group }
    func remember(_ group: KnownServerGroup) { self.group = group }
    func forget() { group = nil }
}

private final class URLProtocolStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
