//! `playarr-db` — the sqlx-based persistence layer: connection pooling,
//! embedded migrations (`backend/migrations/sqlite`), and the
//! repository traits the rest of the backend codes against.
//!
//! Nothing outside this crate should import `sqlx` directly — depend on
//! [`DbPool`] and the trait exports below instead, so the storage engine
//! stays contained here.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

pub mod analytics;
mod codec;
pub mod error;
pub mod pool;
pub mod repo;
pub use repo::remote_wake;
pub use repo::seed_default_rails;

pub use error::DbError;
pub use pool::{connect, run_migrations, DbPool, SQLITE_MIGRATIONS};
pub use repo::{
    ApprovalRepo, CreditRepo, DeviceRepo, DiscoveredRoot, DownloadTicketRepo, EmbeddingRepo,
    FolderRepo, GroupLibraryRepo, HomeRailRepo, HouseholdUsageRepo, InMemoryRefreshTokenStore,
    LibraryViewRepo, MediaFileRepo, MediaLanguageRepo, NodeIdentityRepo, PeerGroupRepo,
    PeerJoinToken, PeerJoinTokenRepo, PeerLeafAvailabilityRepo, PeerNodeRepo,
    PeerSourceInstanceRepo, PeerSyncState, PeerSyncStateRepo, PinAttemptRepo, PinAttemptState,
    PlaylistRepo, PolicyRepo, ProfilePinRepo, PushRegistrationRepo, RefreshTokenRepo, RemoteEvent,
    RemoteHandoff, RemotePairing, RemoteRepo, RemoteTarget, RenditionRepo, RootConfigUpdate,
    RoutingRuleRepo, ScanIndexRow, SourceInstanceRepo, SqlxCreditRepo, SqlxDownloadTicketRepo,
    SqlxEmbeddingRepo, SqlxFolderRepo, SqlxHomeRailRepo, SqlxHouseholdRepo, SqlxLibraryViewRepo,
    SqlxMediaLanguageRepo, SqlxPlaylistRepo, SqlxProfilePinRepo, SqlxPushRegistrationRepo,
    SqlxRefreshTokenRepo, SqlxRemoteRepo, SqlxSystemSettingsRepo, SqlxTdarrConnectionRepo,
    SqlxUserInviteRepo, SqlxUserInviteRequestRepo, SqlxWatchProgressRepo, SqlxWatchlistRepo,
    SyncConflictLog, SyncConflictLogRepo, SyncMetadata, SystemSettingsRepo, TdarrConnectionRepo,
    UserInviteRepo, UserInviteRequestRepo, UserRepo, WatchProgressRepo, WatchlistRepo, WorkRepo,
};

pub use repo::{
    MediaRequestRepo, RequestIntegrationRepo, SqlxMediaRequestRepo, SqlxRequestIntegrationRepo,
};

pub use repo::{
    AvailabilityEventRepo, CalendarFeedTokenInfo, CalendarFeedTokenRepo, SqlxAvailabilityEventRepo,
    SqlxCalendarFeedTokenRepo, SqlxCalendarSourceCacheRepo, StoredChunk, StoredHealth,
};

pub use repo::{
    live_change_generation, live_event_kind, subscribe_live_events, EventingDownloadTicketRepo,
    EventingMediaFileRepo, EventingPlaylistRepo, EventingWatchProgressRepo, EventingWatchlistRepo,
    EventingWorkRepo, LiveEvent, LiveEventPublisher, LiveEventRepo, NewLiveEvent,
    SqlxLiveEventRepo, LIVE_EVENT_MAX_ROWS, LIVE_EVENT_RETENTION_MS,
};
