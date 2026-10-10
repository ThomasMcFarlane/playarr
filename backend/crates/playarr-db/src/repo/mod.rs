//! Repository traits: one per aggregate, each a thin async CRUD-shaped
//! boundary over [`crate::DbPool`]. Handlers and services depend on these
//! traits (often via `Arc<dyn WorkRepo>`), not on `sqlx` directly, so
//! `playarr-catalog`/`playarr-arr-sync`/etc. stay testable behind
//! mocks and don't need to know how they are backed.
//!
//! Each trait has a real `Sqlx*` implementation backed by [`crate::DbPool`]
//! (`sqlx::AnyPool`, SQLite driver) using `?` placeholders.

mod availability_event;
mod calendar_feed_token;
mod calendar_source_cache;
mod credit;
mod device;
mod download_ticket;
mod embedding;
mod eventing;
mod folder;
mod group_library;
mod home_rail;
mod household;
mod library_view;
mod live_event;
mod media_file;
mod media_language;
mod media_request;
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
mod remote;
mod rendition;
mod resume_dismissal;
mod routing_rule;
mod source_instance;
mod sync_conflict_log;
mod system_settings;
mod tdarr_connection;
mod user;
mod user_invite;
mod user_invite_request;
mod watch_progress;
mod watchlist;
mod work;

pub use availability_event::{
    availability_event_generation, AvailabilityEventRepo, SqlxAvailabilityEventRepo,
};
pub use calendar_feed_token::{
    CalendarFeedTokenInfo, CalendarFeedTokenRepo, SqlxCalendarFeedTokenRepo,
};
pub use calendar_source_cache::{SqlxCalendarSourceCacheRepo, StoredChunk, StoredHealth};
pub use credit::{CreditRepo, SqlxCreditRepo};
pub use device::{DeviceRepo, SqlxDeviceRepo};
pub use download_ticket::{DownloadTicketRepo, SqlxDownloadTicketRepo};
pub use embedding::{EmbeddingRepo, SqlxEmbeddingRepo};
pub use eventing::{
    EventingDownloadTicketRepo, EventingMediaFileRepo, EventingMediaRequestRepo,
    EventingPlaylistRepo, EventingRequestIntegrationRepo, EventingWatchProgressRepo,
    EventingWatchlistRepo, EventingWorkRepo,
};
pub use folder::{DiscoveredRoot, FolderRepo, RootConfigUpdate, ScanIndexRow, SqlxFolderRepo};
pub use group_library::{GroupLibraryRepo, SqlxGroupLibraryRepo};
pub use home_rail::{seed_default_rails, HomeRailRepo, SqlxHomeRailRepo};
pub use household::{
    ApprovalRepo, HouseholdUsageRepo, PinAttemptRepo, PinAttemptState, SqlxHouseholdRepo,
};
pub use library_view::{
    seed_default_views, LibraryViewRepo, SqlxLibraryViewRepo, NEWLY_ADDED_VIEW_ID,
    NEWLY_RELEASED_VIEW_ID,
};
pub use live_event::{
    change_generation as live_change_generation, change_tick as live_change_tick,
    changes_since as live_changes_since, kind as live_event_kind,
    subscribe_wake as subscribe_live_events, ChangeRecord as LiveChange, LiveEvent,
    LiveEventPublisher, LiveEventRepo, NewLiveEvent, SqlxLiveEventRepo,
    MAX_ROWS as LIVE_EVENT_MAX_ROWS, RETENTION_MS as LIVE_EVENT_RETENTION_MS,
};
pub use media_file::{MediaFileRepo, SqlxMediaFileRepo};
pub use media_language::{
    language_write_tick, FileLanguages, LanguageUpdate, MediaLanguageRepo, SqlxMediaLanguageRepo,
    KIND_AUDIO, KIND_SUBTITLE, SOURCE_ARR, SOURCE_PROBE, SOURCE_SIDECAR,
};
pub use media_request::{
    match_request, MediaRequestRepo, RequestIntegrationRepo, SqlxMediaRequestRepo,
    SqlxRequestIntegrationRepo,
};
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
pub use remote::remote_wake;
pub use remote::{
    RemoteEvent, RemoteHandoff, RemotePairing, RemoteRepo, RemoteTarget, SqlxRemoteRepo,
};
pub use rendition::{RenditionRepo, SqlxRenditionRepo};
pub use resume_dismissal::{ResumeDismissalRepo, SqlxResumeDismissalRepo};
pub use routing_rule::{RoutingRuleRepo, SqlxRoutingRuleRepo};
pub use source_instance::{SourceInstanceRepo, SqlxSourceInstanceRepo};
pub use sync_conflict_log::{SqlxSyncConflictLogRepo, SyncConflictLog, SyncConflictLogRepo};
pub use system_settings::{SqlxSystemSettingsRepo, SystemSettingsRepo};
pub use tdarr_connection::{SqlxTdarrConnectionRepo, TdarrConnectionRepo};
pub use user::{SqlxUserRepo, SyncMetadata, UserRepo};
pub use user_invite::{SqlxUserInviteRepo, UserInviteRepo};
pub use user_invite_request::{SqlxUserInviteRequestRepo, UserInviteRequestRepo};
pub use watch_progress::{SqlxWatchProgressRepo, WatchProgressRepo};
pub use watchlist::{SqlxWatchlistRepo, WatchlistRepo};
pub use work::{SqlxWorkRepo, WorkIdentity, WorkRepo};
