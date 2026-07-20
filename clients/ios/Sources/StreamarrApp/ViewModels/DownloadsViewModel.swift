import Foundation
import Observation
import StreamarrKit

/// View model for the Downloads tab (`DownloadsView`). Thin on purpose:
/// `DownloadRepository` is itself `@MainActor @Observable` and already
/// holds the single source of truth (`records`, refreshed straight from
/// SwiftData and kept live by the background transfer engine's progress
/// callbacks) — this type just groups that flat list into the sections the
/// screen renders and forwards user actions, matching every other screen's
/// `@MainActor @Observable` view-model convention in this app.
@MainActor
@Observable
public final class DownloadsViewModel {
    private let repository: DownloadRepository

    public init(repository: DownloadRepository) {
        self.repository = repository
    }

    public var storageUsedBytes: Int64 { repository.storageUsedBytes }

    public var downloading: [DownloadRecord] {
        repository.records
            .filter { $0.state == .downloading }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    public var queued: [DownloadRecord] {
        repository.records
            .filter { $0.state == .queued || $0.state == .preparing || $0.state == .paused }
            .sorted { $0.createdAt > $1.createdAt }
    }

    public var completed: [DownloadRecord] {
        repository.records
            .filter { $0.state == .completed }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    public var failed: [DownloadRecord] {
        repository.records
            .filter { $0.state == .failed }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    public var isEmpty: Bool {
        repository.records.isEmpty
    }

    public func refresh() {
        repository.refresh()
    }

    public func pause(_ record: DownloadRecord) {
        repository.pause(mediaFileID: record.mediaFileID)
    }

    public func resume(_ record: DownloadRecord) {
        repository.resume(mediaFileID: record.mediaFileID)
    }

    public func cancel(_ record: DownloadRecord) {
        repository.cancel(mediaFileID: record.mediaFileID)
    }

    public func delete(_ record: DownloadRecord) {
        repository.delete(mediaFileID: record.mediaFileID)
    }
}
