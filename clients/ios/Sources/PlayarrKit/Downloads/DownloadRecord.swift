import Foundation
import SwiftData

/// One tracked download — queued, in flight, paused, completed, or failed —
/// persisted across launches via SwiftData (this app's first real
/// persistence layer beyond `UserDefaults`/Keychain; see `Package.swift`'s
/// `.iOS(.v17)` minimum, which makes SwiftData safely available).
/// `mediaFileID` is this app's stable identity for a playable leaf
/// (movie/episode/track/book), so `@Attribute(.unique)` keeps exactly one
/// record per media file no matter how many times a caller re-requests the
/// same download.
@Model
public final class DownloadRecord {
    @Attribute(.unique) public var mediaFileID: UUID
    public var workID: UUID
    public var title: String
    public var subtitle: String?
    public var posterURLString: String?
    /// The transcode profile this download was requested at, `nil` for
    /// `"original"` — mirrors `NativePlayerDefaults.profile`'s convention.
    public var profile: String?
    /// `MediaFileDownloadOption.estimatedSizeBytes` at request time — kept
    /// even after the real size is known so `DownloadsView` can show
    /// "~estimate" only until the ticket resolves a real `sizeBytes`.
    public var estimatedBytes: Int64?
    /// The authoritative byte count once known (from `DownloadTicket
    /// .sizeBytes`, or refined by `URLSessionDownloadTask
    /// .countOfBytesExpectedToReceive` as the transfer proceeds).
    public var totalBytes: Int64?
    public var bytesWritten: Int64
    public var stateRaw: String
    /// JSON-encoded `KeepUntilPolicy` — see that type's own doc comment for
    /// why this is a local encoding with no wire counterpart.
    public var keepUntilData: Data
    /// Set once the user finishes playing this download to completion
    /// (mirrors the `completed` flag `PlayerViewModel` already computes for
    /// server watch-progress) — the anchor `KeepUntilPolicy.afterWatched`
    /// counts from.
    public var watchedAt: Date?
    /// Path of the downloaded file relative to
    /// `FileManager.default.url(for: .applicationSupportDirectory, ...)` —
    /// deliberately never an absolute path, since the sandbox container
    /// path is not stable across app updates/reinstalls.
    public var localFileRelativePath: String?
    /// Persisted `URLSessionDownloadTask` resume data from the most recent
    /// pause or transient failure, so `DownloadRepository.resume(
    /// mediaFileID:)` can restart a background download without starting
    /// over from byte zero.
    public var resumeData: Data?
    /// The backend `DownloadTicket.id` this record was created from — not
    /// part of the spec's original field list, but required plumbing:
    /// without it, neither polling `GET /api/v1/downloads/{id}` while
    /// `.preparing` nor `DELETE /api/v1/downloads/{id}` on cancel/delete
    /// have anything to address.
    public var ticketID: UUID?
    /// The last server- or client-side error message for a `.failed`
    /// record, surfaced by `DownloadsView`.
    public var errorMessage: String?
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        mediaFileID: UUID,
        workID: UUID,
        title: String,
        subtitle: String? = nil,
        posterURLString: String? = nil,
        profile: String? = nil
    ) {
        self.mediaFileID = mediaFileID
        self.workID = workID
        self.title = title
        self.subtitle = subtitle
        self.posterURLString = posterURLString
        self.profile = profile
        self.estimatedBytes = nil
        self.totalBytes = nil
        self.bytesWritten = 0
        self.stateRaw = DownloadState.queued.rawValue
        self.keepUntilData = (try? JSONEncoder().encode(KeepUntilPolicy.forever)) ?? Data()
        self.watchedAt = nil
        self.localFileRelativePath = nil
        self.resumeData = nil
        self.ticketID = nil
        self.errorMessage = nil
        let now = Date()
        self.createdAt = now
        self.updatedAt = now
    }

    public var state: DownloadState {
        get { DownloadState(rawValue: stateRaw) ?? .failed }
        set { stateRaw = newValue.rawValue }
    }

    public var keepUntil: KeepUntilPolicy {
        get { (try? JSONDecoder().decode(KeepUntilPolicy.self, from: keepUntilData)) ?? .forever }
        set { keepUntilData = (try? JSONEncoder().encode(newValue)) ?? keepUntilData }
    }

    /// `0...1`, `0` while `totalBytes` isn't known yet (still `.queued`/
    /// `.preparing`).
    public var progressFraction: Double {
        guard let totalBytes, totalBytes > 0 else { return 0 }
        return min(1, Double(bytesWritten) / Double(totalBytes))
    }
}
