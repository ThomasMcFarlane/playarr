//! Repository traits: one per aggregate, each a thin async CRUD-shaped
//! boundary over [`crate::DbPool`]. Handlers and services depend on these
//! traits (often via `Arc<dyn WorkRepo>`), not on `sqlx` directly, so
//! `streamarr-catalog`/`streamarr-arr-sync`/etc. stay testable behind
//! mocks and don't need to know which of SQLite/Postgres backs them.
//!
//! Each trait has a real `Sqlx*` implementation backed by [`crate::DbPool`]
//! (`sqlx::AnyPool`), with per-backend (SQLite/Postgres) SQL text selected
//! at construction time via `Backend::detect` — see any `Sqlx*Repo::new`.

mod credit;
mod device;
mod embedding;
mod library_view;
mod media_file;
mod playlist;
mod policy;
mod profile_pin;
mod refresh_token;
mod rendition;
mod source_instance;
mod tdarr_connection;
mod user;
mod user_invite;
mod watch_progress;
mod work;

pub use credit::{CreditRepo, SqlxCreditRepo};
pub use device::{DeviceRepo, SqlxDeviceRepo};
pub use embedding::{EmbeddingRepo, SqlxEmbeddingRepo};
pub use library_view::{
    seed_default_views, LibraryViewRepo, SqlxLibraryViewRepo, NEWLY_ADDED_VIEW_ID,
    NEWLY_RELEASED_VIEW_ID,
};
pub use media_file::{MediaFileRepo, SqlxMediaFileRepo};
pub use playlist::{PlaylistRepo, SqlxPlaylistRepo};
pub use policy::{PolicyRepo, SqlxPolicyRepo};
pub use profile_pin::{ProfilePinRepo, SqlxProfilePinRepo};
pub use refresh_token::{InMemoryRefreshTokenStore, RefreshTokenRepo, SqlxRefreshTokenRepo};
pub use rendition::{RenditionRepo, SqlxRenditionRepo};
pub use source_instance::{SourceInstanceRepo, SqlxSourceInstanceRepo};
pub use tdarr_connection::{SqlxTdarrConnectionRepo, TdarrConnectionRepo};
pub use user::{SqlxUserRepo, UserRepo};
pub use user_invite::{SqlxUserInviteRepo, UserInviteRepo};
pub use watch_progress::{SqlxWatchProgressRepo, WatchProgressRepo};
pub use work::{SqlxWorkRepo, WorkRepo};
