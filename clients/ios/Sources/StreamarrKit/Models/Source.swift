import Foundation

// MIRROR NOTE: see the note at the top of Work.swift — `source.rs` did not
// exist on disk at scaffold time, only `pub use source::{SourceInstance,
// SourceKind}` in `lib.rs`. Fields below are inferred, not verified. The
// app-facing "Library" concept (what `LibraryView`/`LibraryViewModel` list)
// maps onto `SourceInstance` here — a configured content root the backend
// scans — pending confirmation there isn't a separate, coarser "library"
// grouping type once `source.rs`/a library-listing endpoint exist for real.

/// A configured content source the backend scans for media (a local disk
/// path, a network share, object storage, etc). What `LibraryView` lists as
/// "libraries".
public struct SourceInstance: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var name: String
    public var kind: SourceKind
    public var basePath: String
    public var isEnabled: Bool
    public var lastScannedAt: Date?
    public var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case kind
        case basePath = "base_path"
        case isEnabled = "is_enabled"
        case lastScannedAt = "last_scanned_at"
        case createdAt = "created_at"
    }

    public init(
        id: UUID,
        name: String,
        kind: SourceKind,
        basePath: String,
        isEnabled: Bool = true,
        lastScannedAt: Date? = nil,
        createdAt: Date
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.basePath = basePath
        self.isEnabled = isEnabled
        self.lastScannedAt = lastScannedAt
        self.createdAt = createdAt
    }
}

public enum SourceKind: String, Codable, Sendable, CaseIterable, Hashable {
    case localDisk = "local_disk"
    case networkShare = "network_share"
    case s3
    case webdav
}
