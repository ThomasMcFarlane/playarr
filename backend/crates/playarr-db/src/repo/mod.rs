//! Repository traits: one per aggregate, each a thin async CRUD-shaped
//! boundary over [`crate::DbPool`]. Handlers and services depend on these
//! traits (often via `Arc<dyn WorkRepo>`), not on `sqlx` directly, so
//! `playarr-catalog`/`playarr-arr-sync`/etc. stay testable behind
//! mocks and don't need to know which of SQLite/Postgres backs them.
//!
//! Each trait has a real `Sqlx*` implementation backed by [`crate::DbPool`]
//! (`sqlx::AnyPool`), with per-backend (SQLite/Postgres) SQL text selected
//! at construction time via `Backend::detect` — see any `Sqlx*Repo::new`.

mod credit;
mod device;
mod download_ticket;
mod embedding;
mod group_library;
mod library_view;
mod media_file;
mod node_identity;
mod peer_group;
mod peer_join_token;
mod peer_leaf_availability;
mod peer_node;
mod peer_source_instance;
mod peer_sync_state;
mod playlist;
mod policy;
mod profile_pin;
mod push_registration;
mod refresh_token;
mod rendition;
mod routing_rule;
mod source_instance;
mod sync_conflict_log;
mod system_settings;
mod tdarr_connection;
mod user;
mod user_invite;
mod user_invite_request;
mod watch_progress;
mod work;

pub use credit::{CreditRepo, SqlxCreditRepo};
pub use device::{DeviceRepo, SqlxDeviceRepo};
pub use download_ticket::{DownloadTicketRepo, SqlxDownloadTicketRepo};
pub use embedding::{EmbeddingRepo, SqlxEmbeddingRepo};
pub use group_library::{GroupLibraryRepo, SqlxGroupLibraryRepo};
pub use library_view::{
    seed_default_views, LibraryViewRepo, SqlxLibraryViewRepo, NEWLY_ADDED_VIEW_ID,
    NEWLY_RELEASED_VIEW_ID,
};
pub use media_file::{MediaFileRepo, SqlxMediaFileRepo};
pub use node_identity::{NodeIdentityRepo, SqlxNodeIdentityRepo};
pub use peer_group::{PeerGroupRepo, SqlxPeerGroupRepo};
pub use peer_join_token::{PeerJoinToken, PeerJoinTokenRepo, SqlxPeerJoinTokenRepo};
pub use peer_leaf_availability::{PeerLeafAvailabilityRepo, SqlxPeerLeafAvailabilityRepo};
pub use peer_node::{PeerNodeRepo, SqlxPeerNodeRepo};
pub use peer_source_instance::{PeerSourceInstanceRepo, SqlxPeerSourceInstanceRepo};
pub use peer_sync_state::{PeerSyncState, PeerSyncStateRepo, SqlxPeerSyncStateRepo};
pub use playlist::{PlaylistRepo, SqlxPlaylistRepo};
pub use policy::{PolicyRepo, SqlxPolicyRepo};
pub use profile_pin::{ProfilePinRepo, SqlxProfilePinRepo};
pub use push_registration::{PushRegistrationRepo, SqlxPushRegistrationRepo};
pub use refresh_token::{InMemoryRefreshTokenStore, RefreshTokenRepo, SqlxRefreshTokenRepo};
pub use rendition::{RenditionRepo, SqlxRenditionRepo};
pub use routing_rule::{RoutingRuleRepo, SqlxRoutingRuleRepo};
pub use source_instance::{SourceInstanceRepo, SqlxSourceInstanceRepo};
pub use sync_conflict_log::{SqlxSyncConflictLogRepo, SyncConflictLog, SyncConflictLogRepo};
pub use system_settings::{SqlxSystemSettingsRepo, SystemSettingsRepo};
pub use tdarr_connection::{SqlxTdarrConnectionRepo, TdarrConnectionRepo};
pub use user::{SqlxUserRepo, SyncMetadata, UserRepo};
pub use user_invite::{SqlxUserInviteRepo, UserInviteRepo};
pub use user_invite_request::{SqlxUserInviteRequestRepo, UserInviteRequestRepo};
pub use watch_progress::{SqlxWatchProgressRepo, WatchProgressRepo};
pub use work::{SqlxWorkRepo, WorkRepo};
