//! Playback analytics collection: live in-process session tracking
//! ([`registry`]), fan-out into durable storage ([`collector`]), and the
//! two periodic background jobs that keep that storage useful long-term
//! ([`rollup`], [`retention`]).
//!
//! Distinct from `streamarr_db::analytics` — that module is the storage
//! trait/schema (`AnalyticsStore`, the `playback_sessions`/`playback_events`/
//! `stats_daily` tables); this module is the collection *pipeline* sitting
//! in front of it.

pub mod collector;
pub mod registry;
pub mod retention;
pub mod rollup;

pub use collector::AnalyticsCollector;
pub use registry::{InMemorySessionRegistry, SessionRegistry};
pub use retention::{RetentionPolicy, RetentionSweeper};
pub use rollup::RollupScheduler;
