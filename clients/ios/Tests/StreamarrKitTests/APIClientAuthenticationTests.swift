import Foundation
import StreamarrKit
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

    private func makeClient(store: TestTokenStore) -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return APIClient(
            configuration: APIClientConfiguration(
                baseURL: URL(string: "https://streamarr.invalid")!,
                clientVersion: "0.1.0",
                deviceID: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                deviceName: "Playarr Tests",
                urlSessionConfiguration: configuration
            ),
            tokenProvider: store
        )
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
