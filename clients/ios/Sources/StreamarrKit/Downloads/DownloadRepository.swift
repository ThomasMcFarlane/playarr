import Foundation
import Observation
import SwiftData

/// Glue between the catalog/player UI, the download-tickets API
/// (`GET/POST/DELETE /api/v1/downloads*`), the on-device SwiftData store
/// (`DownloadRecord`), and the background transfer engine
/// (`URLSessionDownloadEngine`). Constructed once in `AppEnvironment` and
/// handed to every screen/view model that needs to enqueue, observe, or
/// play back a download — mirrors how `AppEnvironment` already owns
/// `apiClient`/`deviceFlowClient` as the app's single composition root.
///
/// `enqueue(candidates:profile:keepUntil:)` is a two-phase flow per media
/// file, matching the backend contract:
///   1. `GET /api/v1/media/{id}/download-options` to resolve the caller's
///      desired quality (`profile`, or `"original"`) to a concrete option
///      id and size.
///   2. `POST /api/v1/downloads` to create a `DownloadTicket`. A
///      `"original"` ticket comes back `.ready` immediately; a named
///      transcode profile starts `.queued`/`.processing` and is polled via
///      `GET /api/v1/downloads/{id}` until it resolves — only once it's
///      `.ready` does the actual file transfer (`GET
///      /api/v1/downloads/{id}/file`, range-resumable) get handed to the
///      background engine.
@MainActor
@Observable
public final class DownloadRepository {
    public private(set) var records: [DownloadRecord] = []
    public private(set) var storageUsedBytes: Int64 = 0

    /// Exposed so `StreamarrApp`'s `AppDelegate` bridge can hand this the
    /// completion handler the OS gives it for
    /// `application(_:handleEventsForBackgroundURLSession:completionHandler:)`
    /// — the one piece of this feature that needs a UIKit-owning target to
    /// reach into `StreamarrKit`, not the other way around.
    public let engine: URLSessionDownloadEngine

    @ObservationIgnored private var apiClient: StreamarrAPIClient
    @ObservationIgnored private let modelContainer: ModelContainer
    @ObservationIgnored private let modelContext: ModelContext

    public init(apiClient: StreamarrAPIClient, engine: URLSessionDownloadEngine = URLSessionDownloadEngine()) {
        self.apiClient = apiClient
        self.engine = engine

        let schema = Schema([DownloadRecord.self])
        if let onDisk = try? ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema)]) {
            self.modelContainer = onDisk
        } else {
            // Fall back to an in-memory store rather than crash the app if
            // on-disk SwiftData store creation fails (e.g. an incompatible
            // store left over from a schema change) — downloads simply
            // won't persist across relaunch in that rare case.
            self.modelContainer = (try? ModelContainer(
                for: schema,
                configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)]
            )) ?? ModelContainer.streamarrDownloadsInMemoryFallback
        }
        self.modelContext = ModelContext(modelContainer)

        wireEngine()
        refresh()
        Task { [engine] in await engine.reconnectExistingTasks() }
    }

    /// Called by `AppEnvironment.rebuildClients()` whenever the connected
    /// server (or its session) changes — keeps every in-flight/queued
    /// download's future network calls (polling, deletion, re-auth
    /// headers) pointed at the current client rather than a stale one,
    /// without disturbing already-persisted records or in-flight transfers.
    public func updateAPIClient(_ apiClient: StreamarrAPIClient) {
        self.apiClient = apiClient
    }

    public func refresh() {
        let descriptor = FetchDescriptor<DownloadRecord>(sortBy: [SortDescriptor(\.createdAt, order: .reverse)])
        records = (try? modelContext.fetch(descriptor)) ?? []
        recomputeStorageUsed()
    }

    // MARK: - Enqueue

    /// Kicks off (or, for a title already tracked, is a no-op for) a
    /// download per candidate. Each candidate's own download-options/
    /// create-ticket round trip runs independently and concurrently, so one
    /// slow/failing leaf in a season/album "download all" batch doesn't
    /// block the others.
    public func enqueue(candidates: [DownloadCandidate], profile: String?, keepUntil: KeepUntilPolicy) {
        for candidate in candidates {
            guard !hasActiveOrCompletedDownload(mediaFileID: candidate.mediaFileID) else { continue }
            let record = DownloadRecord(
                mediaFileID: candidate.mediaFileID,
                workID: candidate.workID,
                title: candidate.title,
                subtitle: candidate.subtitle,
                posterURLString: candidate.posterURLString,
                profile: profile
            )
            record.keepUntil = keepUntil
            insert(record)
            Task { await self.resolveDownload(record: record, profile: profile) }
        }
    }

    public func hasActiveOrCompletedDownload(mediaFileID: UUID) -> Bool {
        guard let record = records.first(where: { $0.mediaFileID == mediaFileID }) else { return false }
        switch record.state {
        case .queued, .preparing, .downloading, .paused, .completed: return true
        case .failed: return false
        }
    }

    public func record(forMediaFileID mediaFileID: UUID) -> DownloadRecord? {
        records.first { $0.mediaFileID == mediaFileID }
    }

    private func resolveDownload(record: DownloadRecord, profile: String?) async {
        do {
            let options = try await apiClient.mediaDownloadOptions(mediaFileID: record.mediaFileID)
            let desiredID = profile ?? "original"
            guard let chosen = options.options.first(where: { $0.id == desiredID })
                ?? options.options.first(where: { $0.profile == profile })
                ?? options.options.first
            else {
                fail(record, message: "No download quality is available for this title.")
                return
            }
            record.estimatedBytes = chosen.estimatedSizeBytes
            record.profile = chosen.profile
            record.updatedAt = Date()

            record.state = .preparing
            let ticket = try await apiClient.createDownload(
                CreateDownloadRequest(mediaFileID: record.mediaFileID, qualityID: chosen.id)
            )
            record.ticketID = ticket.id
            await resolveTicket(ticket, record: record)
        } catch let error as APIError {
            fail(record, message: error.displayMessage)
        } catch {
            fail(record, message: error.localizedDescription)
        }
    }

    private func resolveTicket(_ initialTicket: DownloadTicket, record: DownloadRecord) async {
        var ticket = initialTicket
        while ticket.status == .queued || ticket.status == .processing {
            record.state = .preparing
            try? await Task.sleep(for: .seconds(2))
            guard record.ticketID == ticket.id else { return } // cancelled/replaced meanwhile
            guard let refreshed = try? await apiClient.getDownload(id: ticket.id) else { continue }
            ticket = refreshed
        }

        switch ticket.status {
        case .ready:
            if let sizeBytes = ticket.sizeBytes { record.totalBytes = sizeBytes }
            await startFileDownload(ticket: ticket, record: record)
        case .failed:
            fail(record, message: ticket.errorMessage ?? "The download couldn't be prepared.")
        case .expired, .canceled:
            fail(record, message: "This download is no longer available.")
        case .queued, .processing:
            break // unreachable: the loop above only exits on a terminal status
        }
    }

    private func startFileDownload(ticket: DownloadTicket, record: DownloadRecord) async {
        guard let fileURL = apiClient.resolvedURL(forPath: "/api/v1/downloads/\(ticket.id.uuidString)/file") else {
            fail(record, message: "This download's file location isn't valid.")
            return
        }
        var request = URLRequest(url: fileURL)
        if let headers = try? await apiClient.playbackRequestHeaders() {
            for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        }
        record.state = .downloading
        record.updatedAt = Date()
        engine.enqueue(mediaFileID: record.mediaFileID, request: request)
    }

    // MARK: - Controls

    public func pause(mediaFileID: UUID) {
        guard let record = record(forMediaFileID: mediaFileID) else { return }
        engine.pause(mediaFileID: mediaFileID)
        record.state = .paused
        record.updatedAt = Date()
    }

    public func resume(mediaFileID: UUID) {
        guard let record = record(forMediaFileID: mediaFileID) else { return }
        if let resumeData = record.resumeData {
            record.resumeData = nil
            record.state = .downloading
            record.updatedAt = Date()
            engine.resume(mediaFileID: mediaFileID, resumeData: resumeData)
        } else if let ticketID = record.ticketID {
            record.state = .preparing
            record.updatedAt = Date()
            Task {
                guard let ticket = try? await self.apiClient.getDownload(id: ticketID) else {
                    self.fail(record, message: "Couldn't resume this download.")
                    return
                }
                await self.resolveTicket(ticket, record: record)
            }
        } else {
            Task { await self.resolveDownload(record: record, profile: record.profile) }
        }
    }

    /// Cancels an in-flight/queued download and removes its record and any
    /// partial local file. `delete(mediaFileID:)` is an alias for the same
    /// operation on a `.completed` download — there is no meaningful
    /// distinction once the transfer is finished.
    public func cancel(mediaFileID: UUID) {
        engine.cancel(mediaFileID: mediaFileID)
        guard let record = record(forMediaFileID: mediaFileID) else { return }
        remove(record)
    }

    public func delete(mediaFileID: UUID) {
        cancel(mediaFileID: mediaFileID)
    }

    public func markWatched(mediaFileID: UUID, at date: Date = Date()) {
        guard let record = record(forMediaFileID: mediaFileID), record.watchedAt == nil else { return }
        record.watchedAt = date
        record.updatedAt = date
    }

    public func localFileURL(forMediaFileID mediaFileID: UUID) -> URL? {
        guard let record = record(forMediaFileID: mediaFileID),
              record.state == .completed,
              let relativePath = record.localFileRelativePath,
              let supportDirectory = try? FileManager.default.url(
                  for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false
              )
        else { return nil }
        return supportDirectory.appendingPathComponent(relativePath)
    }

    // MARK: - Expiry sweep

    /// See `DownloadExpirySweeper`'s doc comment for why this is
    /// foreground-only. Call from `RootView`'s `scenePhase == .active` hook.
    public func sweepExpiredDownloads(now: Date = Date()) {
        DownloadExpirySweeper.sweep(modelContext: modelContext, now: now)
        refresh()
    }

    // MARK: - Engine wiring

    private func wireEngine() {
        engine.onProgress = { [weak self] mediaFileID, bytesWritten, totalBytes in
            self?.handleProgress(mediaFileID: mediaFileID, bytesWritten: bytesWritten, totalBytes: totalBytes)
        }
        engine.onFinished = { [weak self] mediaFileID, fileURL, totalBytes in
            self?.handleFinished(mediaFileID: mediaFileID, fileURL: fileURL, totalBytes: totalBytes)
        }
        engine.onFailed = { [weak self] mediaFileID, error, resumeData in
            self?.handleFailed(mediaFileID: mediaFileID, error: error, resumeData: resumeData)
        }
        engine.onPaused = { [weak self] mediaFileID, resumeData in
            self?.handlePaused(mediaFileID: mediaFileID, resumeData: resumeData)
        }
    }

    private func handleProgress(mediaFileID: UUID, bytesWritten: Int64, totalBytes: Int64) {
        guard let record = record(forMediaFileID: mediaFileID) else { return }
        record.bytesWritten = bytesWritten
        if totalBytes > 0 { record.totalBytes = totalBytes }
        recomputeStorageUsed()
    }

    private func handleFinished(mediaFileID: UUID, fileURL: URL, totalBytes: Int64) {
        guard let record = record(forMediaFileID: mediaFileID) else { return }
        record.localFileRelativePath = Self.relativePath(for: fileURL)
        if totalBytes > 0 {
            record.totalBytes = totalBytes
            record.bytesWritten = totalBytes
        }
        record.state = .completed
        record.resumeData = nil
        record.errorMessage = nil
        record.updatedAt = Date()
        try? modelContext.save()
        recomputeStorageUsed()
    }

    private func handleFailed(mediaFileID: UUID, error: Error, resumeData: Data?) {
        guard let record = record(forMediaFileID: mediaFileID) else { return }
        record.resumeData = resumeData
        fail(record, message: (error as NSError).localizedDescription)
    }

    private func handlePaused(mediaFileID: UUID, resumeData: Data?) {
        guard let record = record(forMediaFileID: mediaFileID) else { return }
        record.resumeData = resumeData
        record.state = .paused
        record.updatedAt = Date()
    }

    private func fail(_ record: DownloadRecord, message: String) {
        record.state = .failed
        record.errorMessage = message
        record.updatedAt = Date()
        try? modelContext.save()
    }

    private func insert(_ record: DownloadRecord) {
        modelContext.insert(record)
        try? modelContext.save()
        records.insert(record, at: 0)
    }

    private func remove(_ record: DownloadRecord) {
        if let ticketID = record.ticketID {
            let apiClient = apiClient
            Task { try? await apiClient.deleteDownload(id: ticketID) }
        }
        if let relativePath = record.localFileRelativePath,
           let supportDirectory = try? FileManager.default.url(
               for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false
           ) {
            try? FileManager.default.removeItem(at: supportDirectory.appendingPathComponent(relativePath))
        }
        modelContext.delete(record)
        try? modelContext.save()
        records.removeAll { $0.mediaFileID == record.mediaFileID }
        recomputeStorageUsed()
    }

    private func recomputeStorageUsed() {
        storageUsedBytes = records.reduce(0) { $0 + $1.bytesWritten }
    }

    private static func relativePath(for fileURL: URL) -> String? {
        guard let supportDirectory = try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false
        ) else { return fileURL.lastPathComponent }
        let supportPath = supportDirectory.standardizedFileURL.path
        let filePath = fileURL.standardizedFileURL.path
        guard filePath.hasPrefix(supportPath) else { return fileURL.lastPathComponent }
        return String(filePath.dropFirst(supportPath.count + 1))
    }
}

extension ModelContainer {
    /// Last-resort in-memory store used only if both the on-disk and
    /// explicit in-memory `ModelContainer` constructions above fail (would
    /// indicate a fundamentally broken `DownloadRecord` schema, not a
    /// recoverable disk-state issue) — keeps `DownloadRepository.init`
    /// non-throwing/non-crashing either way.
    fileprivate static let streamarrDownloadsInMemoryFallback: ModelContainer = {
        let schema = Schema([DownloadRecord.self])
        // swiftlint:disable:next force_try
        return try! ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)])
    }()
}
