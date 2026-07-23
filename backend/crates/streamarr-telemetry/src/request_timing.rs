//! In-process HTTP request-timing recorder: a bounded ring buffer of the
//! most recent request durations per (method, route template) pair, and
//! [`RequestTimingRegistry::snapshot`] to turn that into aggregated
//! p50/p95/p99/avg/max/count stats -- what backs the admin `GET
//! /api/v1/admin/metrics/http-latency` endpoint (`streamarr-api`'s
//! `admin::http_latency_handler`). Keyed on the Axum *route template*
//! (e.g. `/api/v1/catalog/{id}`), never the raw request path with real ids
//! interpolated -- that keeps the key space bounded to this process's
//! actual route table regardless of how many distinct ids get requested,
//! the same "one entry per key, low contention" `DashMap` shape
//! [`crate::metrics::MetricsRegistry`] already uses for its own
//! counters/gauges. Purely in-memory and per-process, like that registry:
//! nothing here survives a restart, and a multi-node deployment has one
//! independent set of stats per node.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

use axum::http::Method;
use dashmap::DashMap;
use serde::Serialize;
use utoipa::ToSchema;

/// Number of most-recent request durations kept per (method, route) key --
/// once a key's buffer is full, recording a new sample evicts the oldest
/// one first (`VecDeque::pop_front`), so a long-running process's memory
/// use for this registry stays bounded regardless of how many requests it
/// has served in total.
const RING_BUFFER_CAPACITY: usize = 512;

/// Aggregated latency stats for one (method, route template) pair --
/// exactly the shape `streamarr-api`'s `admin::http_latency_handler`
/// returns, one element per key [`RequestTimingRegistry`] has ever
/// recorded a sample for.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RouteLatencyStats {
    pub method: String,
    pub route: String,
    pub sample_count: u64,
    pub avg_ms: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

/// In-memory recorder of per-(method, route template) request durations.
/// See the module doc comment for why the key is the route *template*,
/// not the raw request path.
#[derive(Default)]
pub struct RequestTimingRegistry {
    samples: DashMap<(Method, String), Mutex<VecDeque<f64>>>,
}

impl RequestTimingRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records one request's duration against `(method, route)`, creating
    /// that key's ring buffer if this is its first sample. O(1): pushes
    /// onto the back, then pops the oldest sample off the front if that
    /// pushed the buffer past [`RING_BUFFER_CAPACITY`].
    pub fn record(&self, method: Method, route: String, duration: Duration) {
        let duration_ms = duration.as_secs_f64() * 1000.0;
        let entry = self
            .samples
            .entry((method, route))
            .or_insert_with(|| Mutex::new(VecDeque::with_capacity(RING_BUFFER_CAPACITY)));
        let mut buffer = entry.lock().unwrap();
        buffer.push_back(duration_ms);
        if buffer.len() > RING_BUFFER_CAPACITY {
            buffer.pop_front();
        }
    }

    /// Snapshots every (method, route) key's current ring buffer into
    /// aggregated [`RouteLatencyStats`], sorted by `p95_ms` descending --
    /// exactly the shape/order `admin::http_latency_handler` returns
    /// as-is. Cheap relative to request volume (only called on-demand by
    /// that admin endpoint, never on the request-handling hot path):
    /// clones each key's buffer out from under its lock before sorting and
    /// computing percentiles, so the lock is only ever held for the length
    /// of a `Vec` copy. Percentiles use the nearest-rank method (round
    /// `p * (len - 1)` to the nearest sample index on the sorted copy).
    pub fn snapshot(&self) -> Vec<RouteLatencyStats> {
        let mut rows: Vec<RouteLatencyStats> = self
            .samples
            .iter()
            .filter_map(|entry| {
                let (method, route) = entry.key().clone();
                let mut durations: Vec<f64> =
                    entry.value().lock().unwrap().iter().copied().collect();
                if durations.is_empty() {
                    return None;
                }
                durations.sort_by(|a, b| a.partial_cmp(b).expect("durations are never NaN"));

                let count = durations.len();
                let sum: f64 = durations.iter().sum();
                Some(RouteLatencyStats {
                    method: method.to_string(),
                    route,
                    sample_count: count as u64,
                    avg_ms: round_1dp(sum / count as f64),
                    p50_ms: round_1dp(percentile(&durations, 0.50)),
                    p95_ms: round_1dp(percentile(&durations, 0.95)),
                    p99_ms: round_1dp(percentile(&durations, 0.99)),
                    max_ms: round_1dp(durations[count - 1]),
                })
            })
            .collect();

        rows.sort_by(|a, b| {
            b.p95_ms
                .partial_cmp(&a.p95_ms)
                .expect("p95_ms is never NaN")
        });
        rows
    }
}

/// Nearest-rank percentile of `sorted` (already ascending, non-empty) at
/// fraction `p` (e.g. `0.95` for p95).
fn percentile(sorted: &[f64], p: f64) -> f64 {
    let index = (p * (sorted.len() - 1) as f64).round() as usize;
    sorted[index]
}

fn round_1dp(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_registry_snapshot_is_empty() {
        let registry = RequestTimingRegistry::new();
        assert!(registry.snapshot().is_empty());
    }

    #[test]
    fn single_sample_reports_that_value_for_every_stat() {
        let registry = RequestTimingRegistry::new();
        registry.record(
            Method::GET,
            "/api/v1/catalog/{id}".to_string(),
            Duration::from_millis(42),
        );

        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 1);
        let row = &snapshot[0];
        assert_eq!(row.method, "GET");
        assert_eq!(row.route, "/api/v1/catalog/{id}");
        assert_eq!(row.sample_count, 1);
        assert_eq!(row.avg_ms, 42.0);
        assert_eq!(row.p50_ms, 42.0);
        assert_eq!(row.p95_ms, 42.0);
        assert_eq!(row.p99_ms, 42.0);
        assert_eq!(row.max_ms, 42.0);
    }

    #[test]
    fn ring_buffer_evicts_oldest_sample_past_capacity() {
        let registry = RequestTimingRegistry::new();
        let route = "/api/v1/catalog".to_string();

        // The very first (and therefore oldest) sample is a huge outlier --
        // once `RING_BUFFER_CAPACITY` newer, smaller samples have pushed it
        // out the front of the ring buffer, it must no longer influence
        // `max_ms`.
        registry.record(Method::GET, route.clone(), Duration::from_millis(9_999));
        for _ in 0..RING_BUFFER_CAPACITY {
            registry.record(Method::GET, route.clone(), Duration::from_millis(10));
        }

        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 1);
        let row = &snapshot[0];
        assert_eq!(row.sample_count, RING_BUFFER_CAPACITY as u64);
        assert_eq!(row.max_ms, 10.0);
    }

    #[test]
    fn percentiles_on_uniform_distribution_all_equal_that_value() {
        let registry = RequestTimingRegistry::new();
        for _ in 0..10 {
            registry.record(
                Method::POST,
                "/api/v1/webhooks/{instance_id}".to_string(),
                Duration::from_millis(5),
            );
        }

        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 1);
        let row = &snapshot[0];
        assert_eq!(row.avg_ms, 5.0);
        assert_eq!(row.p50_ms, 5.0);
        assert_eq!(row.p95_ms, 5.0);
        assert_eq!(row.p99_ms, 5.0);
        assert_eq!(row.max_ms, 5.0);
    }

    #[test]
    fn percentile_calc_on_known_small_dataset() {
        // Sorted: [10, 20, 30, 40, 50] -- index = round(p * 4).
        let registry = RequestTimingRegistry::new();
        for ms in [30, 10, 50, 20, 40] {
            registry.record(Method::GET, "/known".to_string(), Duration::from_millis(ms));
        }

        let snapshot = registry.snapshot();
        let row = &snapshot[0];
        assert_eq!(row.sample_count, 5);
        assert_eq!(row.avg_ms, 30.0);
        // p50 -> index round(0.50 * 4) = 2 -> 30
        assert_eq!(row.p50_ms, 30.0);
        // p95 -> index round(0.95 * 4) = round(3.8) = 4 -> 50
        assert_eq!(row.p95_ms, 50.0);
        // p99 -> index round(0.99 * 4) = round(3.96) = 4 -> 50
        assert_eq!(row.p99_ms, 50.0);
        assert_eq!(row.max_ms, 50.0);
    }

    #[test]
    fn snapshot_sorts_by_p95_descending() {
        let registry = RequestTimingRegistry::new();
        registry.record(Method::GET, "/low".to_string(), Duration::from_millis(1));
        registry.record(Method::GET, "/high".to_string(), Duration::from_millis(100));

        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].route, "/high");
        assert_eq!(snapshot[1].route, "/low");
    }

    #[test]
    fn distinct_methods_on_the_same_path_are_tracked_separately() {
        let registry = RequestTimingRegistry::new();
        registry.record(
            Method::GET,
            "/api/v1/catalog".to_string(),
            Duration::from_millis(5),
        );
        registry.record(
            Method::POST,
            "/api/v1/catalog".to_string(),
            Duration::from_millis(50),
        );

        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 2);
        assert!(snapshot.iter().any(|row| row.method == "GET" && row.max_ms == 5.0));
        assert!(snapshot.iter().any(|row| row.method == "POST" && row.max_ms == 50.0));
    }
}
