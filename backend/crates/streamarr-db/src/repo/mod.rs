//! Repository traits: one per aggregate, each a thin async CRUD-shaped
//! boundary over [`crate::DbPool`]. Handlers and services depend on these
//! traits (often via `Arc<dyn WorkRepo>`), not on `sqlx` directly, so
//! `streamarr-catalog`/`streamarr-requests`/etc. stay testable behind
//! mocks and don't need to know which of SQLite/Postgres backs them.
//!
//! Each trait has a real `Sqlx*` implementation backed by [`crate::DbPool`]
//! (`sqlx::AnyPool`), with per-backend (SQLite/Postgres) SQL text selected
//! at construction time via `Backend::detect` — see any `Sqlx*Repo::new`.

mod device;
mod media_file;
mod rendition;
mod work;

pub use device::{DeviceRepo, SqlxDeviceRepo};
pub use media_file::{MediaFileRepo, SqlxMediaFileRepo};
pub use rendition::{RenditionRepo, SqlxRenditionRepo};
pub use work::{SqlxWorkRepo, WorkRepo};
