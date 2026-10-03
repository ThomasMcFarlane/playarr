//! `playarr-db` — the sqlx-based persistence layer: connection pooling,
//! embedded migrations (`backend/migrations/{sqlite,postgres}`), and the
//! repository traits the rest of the backend codes against.
//!
//! Nothing outside this crate should import `sqlx` directly — depend on
//! [`DbPool`] and the trait exports below instead, so the SQLite/Postgres
//! split stays contained here.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

pub mod analytics;
mod codec;
pub mod error;
pub mod pool;
pub mod repo;

pub use error::DbError;
pub use pool::{connect, run_migrations, DbPool, POSTGRES_MIGRATIONS, SQLITE_MIGRATIONS};
pub use repo::{
    CreditRepo, DeviceRepo, DownloadTicketRepo, EmbeddingRepo, GroupLibraryRepo,
    InMemoryRefreshTokenStore, LibraryViewRepo, MediaFileRepo, NodeIdentityRepo, PeerGroupRepo,
    PeerJoinToken, PeerJoinTokenRepo, PeerLeafAvailabilityRepo, PeerNodeRepo,
    PeerSourceInstanceRepo, PeerSyncState, PeerSyncStateRepo, PlaylistRepo, PolicyRepo,
    ProfilePinRepo, PushRegistrationRepo, RefreshTokenRepo, RemoteEvent, RemoteHandoff,
    RemotePairing, RemoteRepo, RemoteTarget, RenditionRepo, RoutingRuleRepo, SourceInstanceRepo,
    SqlxCreditRepo, SqlxDownloadTicketRepo, SqlxEmbeddingRepo, SqlxLibraryViewRepo,
    SqlxPlaylistRepo, SqlxProfilePinRepo, SqlxPushRegistrationRepo, SqlxRefreshTokenRepo,
    SqlxRemoteRepo, SqlxSystemSettingsRepo, SqlxTdarrConnectionRepo, SqlxUserInviteRepo,
    SqlxUserInviteRequestRepo, SqlxWatchProgressRepo, SqlxWatchlistRepo, SyncConflictLog,
    SyncConflictLogRepo, SyncMetadata, SystemSettingsRepo, TdarrConnectionRepo, UserInviteRepo,
    UserInviteRequestRepo, UserRepo, WatchProgressRepo, WatchlistRepo, WorkRepo,
};

pub use repo::{
    AvailabilityEventRepo, CalendarFeedTokenInfo, CalendarFeedTokenRepo, SqlxAvailabilityEventRepo,
    SqlxCalendarFeedTokenRepo,
};
