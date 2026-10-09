//! `playarr-model` — domain types shared across the Playarr Server backend.
//!
//! This crate is intentionally free of I/O: no database drivers, no HTTP
//! clients, no filesystem access. It exists so that every other backend
//! crate (db, api, workers, clients) agrees on one shape for the same
//! concept. Keep it that way — if a type here starts needing `tokio` or
//! `sqlx`, it belongs in a different crate.
//!
//! Optional `openapi` feature: derives `utoipa::ToSchema` on the handful of
//! types that are actually returned directly from HTTP handlers (currently
//! [`VersionEnvelope`] and its friends). Left off by default so downstream
//! crates that don't serve HTTP (workers, CLI) don't pull in utoipa.

pub mod availability;
pub mod calendar;
pub mod discovery;
pub mod download;
pub mod embedding;
pub mod folder;
pub mod group_library;
pub mod home_rail;
pub mod household;
pub mod language;
pub mod library_view;
pub mod media;
pub mod media_path;
pub mod music;
pub mod peer;
pub mod person;
pub mod platform;
pub mod playback;
pub mod playlist;
pub mod policy;
pub mod publishing;
pub mod requests;
pub mod resume;
pub mod routing;
pub mod seasonal;
pub mod sensitive;
pub mod series;
pub mod source;
pub mod system_settings;
pub mod tdarr;
pub mod user;
pub mod work;

pub use availability::{
    compute_lag, AvailabilityEvent, AvailabilityEventType, AvailabilityLag, AvailabilityLagSample,
    BACKFILL_THRESHOLD_DAYS,
};
pub use calendar::{
    CalendarAction, CalendarActionKind, CalendarEntry, CalendarEntrySource, CalendarGroupMember,
    CalendarMediaKind, CalendarReleaseType, CalendarResponse, CalendarSourceState,
    CalendarSourceStatus,
};
pub use download::{DownloadStatus, DownloadTicket};
pub use embedding::WorkEmbedding;
pub use folder::{
    folder_work_provider, FolderFileMetadata, FolderMediaEntry, FolderScanStatus,
    ScannedFolderFile, SourceRootFolder, FOLDER_SOURCE_FILE_PREFIX, FOLDER_WORK_PROVIDER,
    MANUAL_ROOT_PREFIX,
};
pub use group_library::{GroupLibrary, LeafSelector, PeerLeafAvailability};
pub use home_rail::{HomeRail, HomeRailConfig, HomeRailKind, UserRailPref};
pub use household::{Approval, ApprovalKind, ApprovalStatus, HouseholdControls, UnratedContent};
pub use library_view::{LibraryView, ViewCriteria, ViewSort};
pub use media::{MediaFile, ProducedBy, Rendition, RenditionStatus};
pub use media_path::resolve_media_path;
pub use music::{Album, AlbumType, Artist, Track};
pub use peer::{NodeIdentity, PeerAddress, PeerGroup, PeerNode, PeerNodeStatus};
pub use person::{Credit, CreditRole, Person};
pub use platform::{ClientPlatform, CompatibilityEntry, VersionEnvelope};
pub use playback::{
    PlayMethod, PlaybackEvent, PlaybackEventKind, PlaybackSession, StopReason, TranscodeReason,
    WatchProgress, WatchState,
};
pub use playlist::{Playlist, PlaylistItem, PlaylistMediaType};
pub use policy::{AccessWindow, Policy, TimeRange, Weekday};
pub use publishing::{Author, Book};
pub use resume::{
    compute_resume_plan, missed_run_episode_ids, ResumeAction, ResumeAskReason, ResumeDismissal,
    ResumeDismissalKind, ResumeEpisode, ResumeOption, ResumeOptionKind, ResumePlan, ResumeReason,
};
pub use routing::{DeliveryMode, RoutingRule};
pub use seasonal::{Hemisphere, SeasonalRule};
pub use sensitive::Sensitive;
pub use series::{Episode, Season, Series};
pub use source::{
    neutral_source_labels, SourceInstance, SourceInstanceIdentity, SourceInstanceSyncRow,
    SourceKind,
};
pub use system_settings::{SystemSettings, DEFAULT_INSTANCE_NAME};
pub use tdarr::TdarrConnection;
pub use user::{
    Device, MediaPlaybackPreferences, ProfileAvatarKind, ProfileAvatarPreference, PushRegistration,
    RefreshTokenRecord, Session, User, UserInvite, UserInviteRequest, UserInviteRequestStatus,
    DEFAULT_PREFERRED_AUDIO_LANGUAGE,
};
pub use work::{
    Availability, ExternalProvider, ExternalRef, ImageAsset, ImageKind, Work, WorkKind,
};
