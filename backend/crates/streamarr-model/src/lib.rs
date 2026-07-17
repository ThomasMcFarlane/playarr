//! `streamarr-model` — domain types shared across the Streamarr backend.
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

pub mod embedding;
pub mod library_view;
pub mod media;
pub mod media_path;
pub mod music;
pub mod person;
pub mod platform;
pub mod playback;
pub mod playlist;
pub mod policy;
pub mod publishing;
pub mod sensitive;
pub mod series;
pub mod source;
pub mod tdarr;
pub mod user;
pub mod work;

pub use embedding::WorkEmbedding;
pub use library_view::{LibraryView, ViewCriteria, ViewSort};
pub use media::{MediaFile, ProducedBy, Rendition, RenditionStatus};
pub use media_path::resolve_media_path;
pub use music::{Album, AlbumType, Artist, Track};
pub use person::{Credit, CreditRole, Person};
pub use platform::{ClientPlatform, CompatibilityEntry, VersionEnvelope};
pub use playback::{
    PlayMethod, PlaybackEvent, PlaybackEventKind, PlaybackSession, StopReason, TranscodeReason,
    WatchProgress, WatchState,
};
pub use playlist::{Playlist, PlaylistItem};
pub use policy::{AccessWindow, Policy, TimeRange, Weekday};
pub use publishing::{Author, Book};
pub use sensitive::Sensitive;
pub use series::{Episode, Season, Series};
pub use source::{SourceInstance, SourceKind};
pub use tdarr::TdarrConnection;
pub use user::{
    Device, MediaPlaybackPreferences, PushRegistration, RefreshTokenRecord, Session, User,
    UserInvite, UserInviteRequest, UserInviteRequestStatus, DEFAULT_PREFERRED_AUDIO_LANGUAGE,
};
pub use work::{
    Availability, ExternalProvider, ExternalRef, ImageAsset, ImageKind, Work, WorkKind,
};
