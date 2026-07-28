//! [`ChannelRegistry`] — the local `tokio::sync::broadcast` bookkeeping
//! shared by the [`crate::Redis`] and [`crate::PostgresListenNotify`]
//! backends.
//!
//! Both of those backends work the same way: `publish` talks straight to
//! the external system (Redis `PUBLISH`, `pg_notify`), while `subscribe`
//! bridges that external system's notifications onto a local
//! `tokio::sync::broadcast` channel via a backend-specific background task
//! (a Redis `PubSub` connection, a Postgres `LISTEN` connection). This
//! module is the shared "one broadcast channel and one background task per
//! distinct channel name, no matter how many local callers subscribe to
//! it" bookkeeping, so neither backend has to reimplement it.
//!
//! [`crate::InMemory`] does *not* use this — it has no external system to
//! bridge from, so its channels are the source of truth rather than a
//! relay, and it manages its own (simpler) registry in-line.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::broadcast;

use crate::Subscription;

/// Per-channel broadcast buffer size: how many not-yet-received messages a
/// slow subscriber can lag behind by before it starts missing them (lagged
/// receivers get a `RecvError::Lagged` rather than blocking the publisher).
/// Matches [`crate::in_memory`]'s constant of the same name/value.
const CHANNEL_CAPACITY: usize = 256;

struct Entry {
    sender: broadcast::Sender<Vec<u8>>,
    /// Whether some caller has already been handed responsibility for
    /// spawning the backend-specific background listener task for this
    /// channel. Set at most once per channel name, ever — the background
    /// task, once running, serves every subsequent local subscriber, so it
    /// must never be spawned twice for the same name.
    listener_spawned: bool,
}

pub(crate) struct ChannelRegistry {
    channels: Mutex<HashMap<String, Entry>>,
}

impl ChannelRegistry {
    pub(crate) fn new() -> Self {
        Self {
            channels: Mutex::new(HashMap::new()),
        }
    }

    /// Subscribes to `name`, creating its broadcast channel if this is the
    /// first reference to it. Returns:
    /// - the [`Subscription`] to hand back to the caller of
    ///   [`crate::CacheAndPubSub::subscribe`],
    /// - the channel's `Sender`, for the background listener task (new or
    ///   already-running) to forward external notifications onto, and
    /// - `true` exactly once per distinct channel name (for whichever call
    ///   happens to be first): the caller receiving `true` is responsible
    ///   for spawning that channel's background listener task.
    pub(crate) fn subscribe(&self, name: &str) -> (Subscription, broadcast::Sender<Vec<u8>>, bool) {
        let mut channels = self.channels.lock().expect("channel registry poisoned");
        let entry = channels.entry(name.to_string()).or_insert_with(|| Entry {
            sender: broadcast::channel(CHANNEL_CAPACITY).0,
            listener_spawned: false,
        });
        let should_spawn_listener = !entry.listener_spawned;
        entry.listener_spawned = true;
        (
            entry.sender.subscribe(),
            entry.sender.clone(),
            should_spawn_listener,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_subscriber_claims_the_listener_spawn() {
        let registry = ChannelRegistry::new();
        let (_rx, _sender, should_spawn) = registry.subscribe("chan");
        assert!(should_spawn);
    }

    #[test]
    fn second_subscriber_to_the_same_channel_does_not_reclaim_it() {
        let registry = ChannelRegistry::new();
        let (_rx1, _sender1, first) = registry.subscribe("chan");
        let (_rx2, _sender2, second) = registry.subscribe("chan");
        assert!(first);
        assert!(!second);
    }

    #[test]
    fn distinct_channels_each_claim_their_own_listener_spawn() {
        let registry = ChannelRegistry::new();
        let (_rx_a, _sender_a, a) = registry.subscribe("a");
        let (_rx_b, _sender_b, b) = registry.subscribe("b");
        assert!(a);
        assert!(b);
    }

    #[test]
    fn subscribers_to_the_same_channel_share_one_broadcast_sender() {
        let registry = ChannelRegistry::new();
        let (mut rx1, sender, _) = registry.subscribe("chan");
        let (mut rx2, _sender2, _) = registry.subscribe("chan");

        sender.send(b"hello".to_vec()).unwrap();

        assert_eq!(rx1.try_recv().unwrap(), b"hello");
        assert_eq!(rx2.try_recv().unwrap(), b"hello");
    }

    #[test]
    fn distinct_channels_do_not_cross_talk() {
        let registry = ChannelRegistry::new();
        let (_rx_a, sender_a, _) = registry.subscribe("a");
        let (mut rx_b, _sender_b, _) = registry.subscribe("b");

        sender_a.send(b"only-for-a".to_vec()).unwrap();

        assert!(rx_b.try_recv().is_err());
    }
}
