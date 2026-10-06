import Foundation
import Observation
import PlayarrKit

/// State for Settings, "Your data": export the signed-in account's own progress,
/// playlists and preferences, and import a package after a preview.
@MainActor
@Observable
public final class YourDataViewModel {
    public enum ExportState: Equatable {
        case idle
        case working(String)
        case ready(URL, UserDataExportCounts)
        case failed(String)
    }

    public enum ImportState: Equatable {
        case idle
        case previewing
        case preview(UserDataImportPreview)
        case applying
        case done(UserDataImportResult, unmatched: URL?)
        case failed(String)
    }

    public private(set) var exportState: ExportState = .idle
    public private(set) var importState: ImportState = .idle
    public var includePreferences = false
    public var keepExistingProgress = false

    private let client: UserDataClient
    private var package: Data?

    public init(transport: PlayarrRequestTransport) {
        self.client = UserDataClient(transport: transport)
    }

    private var options: UserDataImportOptions {
        UserDataImportOptions(
            includePreferences: includePreferences,
            progressConflicts: keepExistingProgress ? .keepExisting : .newest
        )
    }

    public func startExport() async {
        if case .working = exportState { return }
        exportState = .working("Starting")
        do {
            var job = try await client.startExport()
            var polls = 0
            while job.status == .queued || job.status == .running {
                exportState = .working(job.progress.stage.isEmpty ? "Preparing..." : "Working on: \(job.progress.stage)")
                try await Task.sleep(nanoseconds: 1_000_000_000)
                polls += 1
                if polls > 300 { throw APIError.serviceUnavailable(nil) }
                job = try await client.exportJob(id: job.id)
            }
            guard job.status == .ready else {
                exportState = .failed(job.status == .expired ? "This export expired. Prepare a new one." : "The export could not be completed. Try again.")
                return
            }
            exportState = .working("Downloading")
            let bytes = try await client.downloadExport(id: job.id)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("playarr-data-export.zip")
            try bytes.write(to: url, options: .atomic)
            exportState = .ready(url, job.counts)
        } catch is CancellationError {
            exportState = .idle
        } catch {
            exportState = .failed(Self.message(error))
        }
    }

    public func previewImport(package data: Data) async {
        package = data
        importState = .previewing
        do {
            importState = .preview(try await client.previewImport(package: data, options: options))
        } catch {
            importState = .failed(Self.message(error))
        }
    }

    public func applyImport() async {
        guard case .preview(let preview) = importState, let package else { return }
        importState = .applying
        do {
            let result = try await client.applyImport(
                package: package, packageSHA256: preview.packageSHA256, options: options
            )
            var unmatchedURL: URL?
            if result.unmatchedTotal > 0, let bytes = try? await client.unmatchedPackage(package: package, options: options) {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("playarr-unmatched-data.zip")
                try? bytes.write(to: url, options: .atomic)
                unmatchedURL = url
            }
            self.package = nil
            importState = .done(result, unmatched: unmatchedURL)
        } catch {
            importState = .failed(Self.message(error))
        }
    }

    public func reportImportFailure(_ message: String) {
        importState = .failed(message)
    }

    public func resetImport() {
        package = nil
        importState = .idle
    }

    private static func message(_ error: Error) -> String {
        (error as? APIError)?.displayMessage ?? error.localizedDescription
    }
}
