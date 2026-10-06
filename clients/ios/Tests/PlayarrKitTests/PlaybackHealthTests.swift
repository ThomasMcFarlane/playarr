import Foundation
import PlayarrKit
import XCTest

final class PlaybackHealthTests: XCTestCase {
    func testReportRequestUsesSnakeCaseAndOmitsUnknowns() async throws {
        let transport = StubTransport { _ in
            Data(#"{"headline":"Direct play","severity":"ok","play_method":"direct_play","facts":[{"key":"hdr","label":"HDR","value":"not confirmed","provenance":"reported"}],"findings":[{"code":"hdr_not_confirmed","severity":"info","title":"HDR not confirmed","detail":"d","next_action":"n"}],"qualification":{"status":"not_assessed","note":""},"export":{"schema":"v1","play_method":"direct_play"}}"#.utf8)
        }
        let report = ClientPlaybackReport(
            reported: ReportedCapabilities(displayHdrFormats: ["hdr10"], audioOutput: "hdmi"),
            measured: MeasuredPlayback(width: 3840, height: 2160, droppedFrames: 2)
        )
        let session = UUID(uuidString: "00000000-0000-0000-0000-0000000000AA")!
        let result = try await PlaybackHealthClient(transport: transport).report(sessionID: session, client: report)

        XCTAssertEqual(transport.calls.first?.path, "/api/v1/playback/sessions/00000000-0000-0000-0000-0000000000aa/health")
        let body = transport.calls.first?.body ?? ""
        XCTAssertTrue(body.contains("\"display_hdr_formats\":[\"hdr10\"]"))
        XCTAssertTrue(body.contains("\"dropped_frames\":2"))
        XCTAssertFalse(body.contains("hdr_active"))
        XCTAssertFalse(body.contains("decoder_kind"))
        XCTAssertEqual(result.headline, "Direct play")
        XCTAssertEqual(result.facts.first?.provenance, .reported)
        XCTAssertEqual(result.findings.first?.nextAction, "n")
        XCTAssertTrue(result.exportText.contains("\"schema\""))
    }

    func testUnknownProvenanceAndSeverityDegradeGently() async throws {
        let transport = StubTransport { _ in
            Data(#"{"headline":"h","severity":"catastrophic","play_method":"x","facts":[{"key":"k","label":"L","provenance":"guessed"}]}"#.utf8)
        }
        let result = try await PlaybackHealthClient(transport: transport)
            .report(sessionID: UUID(), client: ClientPlaybackReport())
        XCTAssertEqual(result.severity, .info)
        XCTAssertEqual(result.facts.first?.provenance, .unknown)
        XCTAssertEqual(result.qualification.status, "not_assessed")
        XCTAssertEqual(result.exportText, "")
    }

    func testSamplerNeverClaimsHDROrPassthrough() {
        let report = PlaybackHealthSampler.report(
            totals: AccessLogTotals(droppedFrames: 5, stalls: 1, observedBitrate: 8_000_000),
            presentationSize: CGSize(width: 1920, height: 1080),
            displayHDRFormats: ["hdr10"],
            audioOutput: "hdmi",
            maxHeight: nil
        )
        XCTAssertNil(report.measured.hdrActive)
        XCTAssertNil(report.measured.audioPassthrough)
        XCTAssertNil(report.measured.decoderKind)
        XCTAssertEqual(report.measured.droppedFrames, 5)
        XCTAssertEqual(report.measured.rebufferCount, 1)
        XCTAssertEqual(report.measured.throughputBps, 8_000_000)
        XCTAssertEqual(report.measured.height, 1080)
        XCTAssertEqual(report.reported.displayHdrFormats, ["hdr10"])
    }

    func testConnectionTestTimesTheDownload() async throws {
        let transport = StubTransport { _ in Data(count: 1024) }
        let result = try await PlaybackHealthClient(transport: transport).connectionTest(bytes: 1024)
        XCTAssertEqual(result.bytes, 1024)
        XCTAssertEqual(transport.calls.first?.query, ["bytes=1024"])
    }
}
