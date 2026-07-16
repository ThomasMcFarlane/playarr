//! [`TdarrConnection`] -- Streamarr's connection to a
//! [Tdarr](https://docs.tdarr.io/) instance, the background transcode
//! pipeline `streamarr_transcode`'s `TdarrDispatcher` hands work off to
//! (see that type's doc comment).
//!
//! Deliberately **singleton**, unlike `SourceInstance` (which supports
//! multiple `*arr` apps of the same kind, e.g. two Radarr instances for a
//! 4K and a 1080p library): `TdarrDispatcher`'s worker-throttling design
//! assumes exactly one Tdarr cluster it coordinates on-demand-vs-
//! background capacity against, and nothing in this codebase has a
//! concept of routing different works to different Tdarr instances. A
//! second Tdarr connection isn't "not supported yet", it's a different
//! feature (per-library transcode routing) nobody has asked for -- see
//! `streamarr_api::tdarr`'s module doc comment for how the single-row
//! admin API this backs enforces that.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::sensitive::Sensitive;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TdarrConnection {
    pub base_url: String,
    pub api_key_encrypted: Sensitive<String>,
    /// The Tdarr library database id Streamarr's dispatched
    /// scan/search-db calls target -- Tdarr's own concept, an operator
    /// sets this up on the Tdarr side and copies the id here.
    pub tdarr_db_id: String,
    /// Which Tdarr transcode profile/flow on-demand dispatch requests.
    pub default_profile: String,
    /// One of Tdarr's worker pool identifiers (e.g. `"transcodecpu"`,
    /// `"transcodegpu"`) -- see `streamarr_tdarr_client::
    /// AlterWorkerLimitRequest::process`'s doc comment.
    pub worker_process: String,
    /// Worker limit applied to every node when no on-demand session needs
    /// headroom.
    pub default_worker_limit: i32,
    /// Worker limit applied while `active_session_threshold` or more
    /// on-demand sessions are live -- typically `0`, pausing background
    /// transcoding entirely so playback gets full node capacity.
    pub throttled_worker_limit: i32,
    /// How many concurrent on-demand sessions trigger the throttle.
    pub active_session_threshold: i32,
    pub throttle_check_interval_secs: i64,
    pub updated_at: DateTime<Utc>,
}
