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
