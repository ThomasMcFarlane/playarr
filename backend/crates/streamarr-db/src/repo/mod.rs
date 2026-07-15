//! Repository traits: one per aggregate, each a thin async CRUD-shaped
//! boundary over [`crate::DbPool`]. Handlers and services depend on these
//! traits (often via `Arc<dyn WorkRepo>`), not on `sqlx` directly, so
//! `streamarr-catalog`/`streamarr-requests`/etc. stay testable behind
//! mocks and don't need to know which of SQLite/Postgres backs them.
//!
//! The `Sqlx*` implementations exist to show the intended wiring (which
//! pool, which query shape) but their method bodies are `unimplemented!()`
//! for now — filling them in is downstream work, not part of getting the
//! trait shapes right.

mod device;
mod rendition;
mod work;

pub use device::{DeviceRepo, SqlxDeviceRepo};
pub use rendition::{RenditionRepo, SqlxRenditionRepo};
pub use work::{SqlxWorkRepo, WorkRepo};
