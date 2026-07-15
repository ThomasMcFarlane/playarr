//! A minimal, dependency-free metrics registry: named counters and gauges,
//! rendered in Prometheus text exposition format by [`http`]. Deliberately
//! not backed by an external metrics crate (`metrics`/`prometheus`) —
//! Streamarr's metric surface is small and fixed (see [`names`]), so a
//! hand-rolled atomic registry avoids pulling in a dependency's own
//! opinions about label cardinality, global registry state, and exporter
//! format for a handful of counters and gauges.

pub mod http;
pub mod names;

use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;

use dashmap::DashMap;

#[derive(Clone, Default)]
pub struct MetricsRegistry {
    counters: Arc<DashMap<&'static str, AtomicU64>>,
    gauges: Arc<DashMap<&'static str, AtomicI64>>,
}

impl MetricsRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn incr_counter(&self, name: &'static str, delta: u64) {
        self.counters
            .entry(name)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(delta, Ordering::Relaxed);
    }

    pub fn counter_value(&self, name: &'static str) -> u64 {
        self.counters
            .get(name)
            .map(|entry| entry.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    pub fn set_gauge(&self, name: &'static str, value: i64) {
        self.gauges
            .entry(name)
            .or_insert_with(|| AtomicI64::new(0))
            .store(value, Ordering::Relaxed);
    }

    pub fn add_gauge(&self, name: &'static str, delta: i64) {
        self.gauges
            .entry(name)
            .or_insert_with(|| AtomicI64::new(0))
            .fetch_add(delta, Ordering::Relaxed);
    }

    pub fn gauge_value(&self, name: &'static str) -> i64 {
        self.gauges
            .get(name)
            .map(|entry| entry.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Renders every registered metric in Prometheus text exposition
    /// format. Omits `# TYPE`/`# HELP` lines for brevity — bare
    /// `name value` pairs are still valid exposition format, and adding
    /// per-metric help text is easy to layer on later (`names.rs` growing
    /// a matching const per metric) without changing this method's shape.
    pub fn render(&self) -> String {
        let mut out = String::new();
        for entry in self.counters.iter() {
            out.push_str(entry.key());
            out.push(' ');
            out.push_str(&entry.value().load(Ordering::Relaxed).to_string());
            out.push('\n');
        }
        for entry in self.gauges.iter() {
            out.push_str(entry.key());
            out.push(' ');
            out.push_str(&entry.value().load(Ordering::Relaxed).to_string());
            out.push('\n');
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_accumulates() {
        let registry = MetricsRegistry::new();
        registry.incr_counter(names::HTTP_REQUESTS_TOTAL, 1);
        registry.incr_counter(names::HTTP_REQUESTS_TOTAL, 2);
        assert_eq!(registry.counter_value(names::HTTP_REQUESTS_TOTAL), 3);
    }

    #[test]
    fn gauge_set_and_add() {
        let registry = MetricsRegistry::new();
        registry.set_gauge(names::PLAYBACK_SESSIONS_ACTIVE, 5);
        registry.add_gauge(names::PLAYBACK_SESSIONS_ACTIVE, -2);
        assert_eq!(registry.gauge_value(names::PLAYBACK_SESSIONS_ACTIVE), 3);
    }

    #[test]
    fn render_includes_registered_metrics() {
        let registry = MetricsRegistry::new();
        registry.incr_counter(names::HTTP_REQUESTS_TOTAL, 4);
        registry.set_gauge(names::TRANSCODE_QUEUE_DEPTH, 7);
        let rendered = registry.render();
        assert!(rendered.contains("http_requests_total 4"));
        assert!(rendered.contains("transcode_queue_depth 7"));
    }
}
