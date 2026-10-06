import Foundation
import PlayarrKit
import XCTest

final class UserDataClientTests: XCTestCase {
    func testStartExportPostsToOwnRouteAndDecodesJob() async throws {
        let transport = StubTransport { _ in
            Data(#"{"id":"job-1","status":"running","created_at":"2026-10-05T10:00:00Z","progress":{"stage":"progress","done":2,"total":9},"counts":{"watch_progress":3}}"#.utf8)
        }
        let job = try await UserDataClient(transport: transport).startExport()
        XCTAssertEqual(job.id, "job-1")
        XCTAssertEqual(job.status, .running)
        XCTAssertEqual(job.progress.total, 9)
        XCTAssertEqual(job.counts.watchProgress, 3)
        XCTAssertEqual(job.counts.playlists, 0)
        XCTAssertEqual(transport.calls.first?.method, "POST")
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/users/me/data-exports")
    }

    func testUnknownStatusDoesNotBreakDecoding() async throws {
        let transport = StubTransport { _ in Data(#"{"id":"job-2","status":"paused"}"#.utf8) }
        let job = try await UserDataClient(transport: transport).exportJob(id: "job-2")
        XCTAssertEqual(job.status, .failed)
    }

    func testDownloadReturnsRawBytes() async throws {
        let transport = StubTransport { _ in Data([0x50, 0x4B, 0x03, 0x04]) }
        let bytes = try await UserDataClient(transport: transport).downloadExport(id: "job-3")
        XCTAssertEqual(bytes, Data([0x50, 0x4B, 0x03, 0x04]))
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/users/me/data-exports/job-3/download")
    }

    func testTransferLinkAndImportSession() async throws {
        let transport = StubTransport { call in
            if call.path.hasSuffix("transfer-link") {
                return Data(#"{"path":"/transfer/export/t","url":"https://example.com/transfer/export/t","expires_at":"2026-10-05T10:15:00Z"}"#.utf8)
            }
            return Data(#"{"id":"s1","status":"waiting","upload_url":"https://example.com/transfer/import/u","expires_at":"2026-10-05T10:15:00Z"}"#.utf8)
        }
        let client = UserDataClient(transport: transport)
        let link = try await client.createExportTransferLink(id: "job-4")
        XCTAssertEqual(link.url, "https://example.com/transfer/export/t")
        let session = try await client.createImportSession()
        XCTAssertEqual(session.uploadURL, "https://example.com/transfer/import/u")
        XCTAssertFalse(session.isUploaded)
    }

    func testApplySessionCarriesDigestAndOptions() async throws {
        let transport = StubTransport { _ in Data(#"{"completed":true,"progress_added":4}"#.utf8) }
        let result = try await UserDataClient(transport: transport).applySession(
            id: "s1",
            packageSHA256: "abc",
            options: UserDataImportOptions(includePreferences: false, progressConflicts: .keepExisting)
        )
        XCTAssertTrue(result.completed)
        XCTAssertEqual(result.progressAdded, 4)
        XCTAssertEqual(
            transport.calls.first?.query,
            ["package_sha256=abc", "include_preferences=false", "progress_conflicts=keep_existing"]
        )
    }

    func testPreviewDecodesSummaryWithMissingWatchlist() async throws {
        let transport = StubTransport { _ in
            Data(#"{"package_sha256":"d1","summary":{"watch_progress":{"total":5,"will_add":3,"unmatched":1},"unmatched_total":1},"warnings":["w"]}"#.utf8)
        }
        let preview = try await UserDataClient(transport: transport).previewSession(id: "s1", options: UserDataImportOptions())
        XCTAssertEqual(preview.packageSHA256, "d1")
        XCTAssertEqual(preview.summary.watchProgress.willAdd, 3)
        XCTAssertNil(preview.summary.watchlist)
        XCTAssertEqual(preview.warnings, ["w"])
    }

    func testPreviewDecodesSamplesAndDefaultsPreferencesOff() async throws {
        let transport = StubTransport { _ in
            Data(#"{"package_sha256":"d2","samples":[{"section":"progress","title":"Sample A","outcome":"unmatched","playlist":null,"candidates":["x","y"]}]}"#.utf8)
        }
        let preview = try await UserDataClient(transport: transport).previewSession(id: "s2", options: UserDataImportOptions())
        XCTAssertEqual(preview.samples.first?.candidates, ["x", "y"])
        XCTAssertNil(preview.samples.first?.playlist)
        XCTAssertEqual(transport.calls.first?.query, ["include_preferences=false", "progress_conflicts=newest"])
    }

    func testDirectImportNeedsAnUploadTransport() async {
        let transport = StubTransport()
        do {
            _ = try await UserDataClient(transport: transport).previewImport(package: Data(), options: UserDataImportOptions())
            XCTFail("expected 501")
        } catch APIError.http(let status, _, _) {
            XCTAssertEqual(status, 501)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }
}
