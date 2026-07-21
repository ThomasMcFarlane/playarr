//! `streamarr-db` — the sqlx-based persistence layer: connection pooling,
//! embedded migrations (`backend/migrations/{sqlite,postgres}`), and the
//! repository traits the rest of the backend codes against.
//!
//! Nothing outside this crate should import `sqlx` directly — depend on
//! [`DbPool`] and the trait exports below instead, so the SQLite/Postgres
//! split stays contained here.

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
    ProfilePinRepo, PushRegistrationRepo, RefreshTokenRepo, RenditionRepo, RoutingRuleRepo,
    SourceInstanceRepo, SqlxCreditRepo, SqlxDownloadTicketRepo, SqlxEmbeddingRepo,
    SqlxLibraryViewRepo, SqlxPlaylistRepo, SqlxProfilePinRepo, SqlxPushRegistrationRepo,
    SqlxRefreshTokenRepo, SqlxSystemSettingsRepo, SqlxTdarrConnectionRepo, SqlxUserInviteRepo,
    SqlxUserInviteRequestRepo, SqlxWatchProgressRepo, SyncConflictLog, SyncConflictLogRepo,
    SyncMetadata, SystemSettingsRepo, TdarrConnectionRepo, UserInviteRepo, UserInviteRequestRepo,
    UserRepo, WatchProgressRepo, WorkRepo,
};
