//! Canonical metric names, one source of truth so instrumentation call
//! sites, dashboards, and alert rules never drift on spelling. Grouped by
//! subsystem; add new metrics here rather than inlining a string literal
//! at the call site.

// --- HTTP ---
pub const HTTP_REQUESTS_TOTAL: &str = "http_requests_total";
pub const HTTP_REQUEST_DURATION_SECONDS: &str = "http_request_duration_seconds";
pub const HTTP_REQUESTS_IN_FLIGHT: &str = "http_requests_in_flight";

// --- Playback ---
pub const PLAYBACK_SESSIONS_ACTIVE: &str = "playback_sessions_active";
pub const PLAYBACK_SESSIONS_STARTED_TOTAL: &str = "playback_sessions_started_total";
pub const PLAYBACK_BUFFERING_EVENTS_TOTAL: &str = "playback_buffering_events_total";

// --- Transcode ---
pub const TRANSCODE_QUEUE_DEPTH: &str = "transcode_queue_depth";
pub const TRANSCODE_SESSIONS_ACTIVE: &str = "transcode_sessions_active";
pub const TRANSCODE_ON_DEMAND_STARTS_TOTAL: &str = "transcode_on_demand_starts_total";
pub const TRANSCODE_FAILURES_TOTAL: &str = "transcode_failures_total";

// --- *arr sync ---
pub const ARR_SYNC_LAG_SECONDS: &str = "arr_sync_lag_seconds";
pub const ARR_SYNC_PASSES_TOTAL: &str = "arr_sync_passes_total";
pub const ARR_SYNC_ERRORS_TOTAL: &str = "arr_sync_errors_total";
pub const ARR_WEBHOOK_SIGNALS_TOTAL: &str = "arr_webhook_signals_total";

// --- Cache ---
pub const CACHE_HITS_TOTAL: &str = "cache_hits_total";
pub const CACHE_MISSES_TOTAL: &str = "cache_misses_total";

// --- Database ---
pub const DB_POOL_CONNECTIONS_IN_USE: &str = "db_pool_connections_in_use";
pub const DB_POOL_CONNECTIONS_IDLE: &str = "db_pool_connections_idle";

// --- Coordination ---
pub const CLUSTER_LEADERSHIP_HELD: &str = "cluster_leadership_held";
