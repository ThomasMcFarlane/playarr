//! In-flight playback session tracking, kept separate from the durable
//! `playback_sessions` table (`playarr_db::analytics`). This registry
//! answers "what's happening right now" — for the
//! `playback_sessions_active` gauge, for an admin's live sessions view,
//! for enforcing `playarr_model::Policy::max_concurrent_sessions` —
//! cheaply and in-process, without a DB round-trip on every playback
//! heartbeat.

use std::time::{Duration, Instant};

use dashmap::DashMap;
use playarr_model::PlaybackSession;
use uuid::Uuid;

pub trait SessionRegistry: Send + Sync {
    fn insert(&self, session: PlaybackSession);

    /// Applies `f` to the session if it's still tracked; a no-op if it
    /// isn't (e.g. it already ended). Takes a closure rather than
    /// returning a mutable reference so the registry can use interior
    /// mutability (`DashMap`) without exposing a lock guard's lifetime to
    /// callers.
    fn update(&self, session_id: Uuid, f: &dyn Fn(&mut PlaybackSession));

    fn remove(&self, session_id: Uuid) -> Option<PlaybackSession>;

    fn get(&self, session_id: Uuid) -> Option<PlaybackSession>;

    fn list_for_user(&self, user_id: Uuid) -> Vec<PlaybackSession>;

    /// Every currently-tracked session, regardless of user -- backs the
    /// admin "who's watching now" live-sessions view.
    fn list_all(&self) -> Vec<PlaybackSession>;

    /// Ids of every tracked session whose last `insert`/`update` touch was
    /// more than `idle_after` ago -- input to
    /// [`crate::analytics::reaper::SessionReaper`]. Deliberately does not
    /// remove anything itself: removal happens through the normal
    /// `AnalyticsCollector::on_session_end` path (via `remove`) so the
    /// durable `close_session` write and the registry removal stay
    /// atomic-by-construction with the clean-stop path, rather than this
    /// method silently discarding a session the caller never got to
    /// persist a stop reason for.
    fn stale_session_ids(&self, idle_after: Duration) -> Vec<Uuid>;

    /// Backs the `playback_sessions_active` gauge directly.
    fn count(&self) -> usize;
}

/// `PlaybackSession` plus the `Instant` its entry was last touched by
/// `insert`/`update` -- the staleness clock [`SessionRegistry::stale_session_ids`]
/// reads. Kept out of `playarr_model::PlaybackSession` itself (which
/// mirrors the `playback_sessions` DB schema 1:1 -- see that type's own doc
/// comment) since this is purely in-memory bookkeeping with no durable
/// counterpart.
#[derive(Default)]
pub struct InMemorySessionRegistry {
    sessions: DashMap<Uuid, (PlaybackSession, Instant)>,
}

impl InMemorySessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SessionRegistry for InMemorySessionRegistry {
    fn insert(&self, session: PlaybackSession) {
        self.sessions.insert(session.id, (session, Instant::now()));
    }

    fn update(&self, session_id: Uuid, f: &dyn Fn(&mut PlaybackSession)) {
        if let Some(mut entry) = self.sessions.get_mut(&session_id) {
            let (session, touched_at) = entry.value_mut();
            f(session);
            *touched_at = Instant::now();
        }
    }

    fn remove(&self, session_id: Uuid) -> Option<PlaybackSession> {
        self.sessions
            .remove(&session_id)
            .map(|(_, (session, _))| session)
    }

    fn get(&self, session_id: Uuid) -> Option<PlaybackSession> {
        self.sessions
            .get(&session_id)
            .map(|entry| entry.value().0.clone())
    }

    fn list_for_user(&self, user_id: Uuid) -> Vec<PlaybackSession> {
        self.sessions
            .iter()
            .filter(|entry| entry.value().0.user_id == user_id)
            .map(|entry| entry.value().0.clone())
            .collect()
    }

    fn list_all(&self) -> Vec<PlaybackSession> {
        self.sessions
            .iter()
            .map(|entry| entry.value().0.clone())
            .collect()
    }

    fn stale_session_ids(&self, idle_after: Duration) -> Vec<Uuid> {
        let now = Instant::now();
        self.sessions
            .iter()
            .filter(|entry| now.duration_since(entry.value().1) >= idle_after)
            .map(|entry| *entry.key())
            .collect()
    }

    fn count(&self) -> usize {
        self.sessions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use playarr_model::{ClientPlatform, PlayMethod};

    fn sample_session(user_id: Uuid) -> PlaybackSession {
        PlaybackSession {
            id: Uuid::new_v4(),
            user_id,
            device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            rendition_id: None,
            started_at: Utc::now(),
            ended_at: None,
            play_method: PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mkv".to_string(),
            source_bitrate: Some(8_000_000),
            target_codec: "h264".to_string(),
            target_container: "mkv".to_string(),
            target_bitrate: Some(8_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        }
    }

    #[test]
    fn insert_get_remove_round_trip() {
        let registry = InMemorySessionRegistry::new();
        let user_id = Uuid::new_v4();
        let session = sample_session(user_id);
        let session_id = session.id;

        registry.insert(session.clone());
        assert_eq!(registry.count(), 1);
        assert_eq!(registry.get(session_id), Some(session.clone()));
        assert_eq!(registry.list_for_user(user_id), vec![session.clone()]);

        let removed = registry.remove(session_id);
        assert_eq!(removed, Some(session));
        assert_eq!(registry.count(), 0);
        assert_eq!(registry.get(session_id), None);
    }

    #[test]
    fn update_mutates_tracked_session_only() {
        let registry = InMemorySessionRegistry::new();
        let session = sample_session(Uuid::new_v4());
        let session_id = session.id;
        registry.insert(session);

        registry.update(session_id, &|s| s.bytes_streamed = 1_000);
        assert_eq!(registry.get(session_id).unwrap().bytes_streamed, 1_000);

        // Updating an untracked id is a silent no-op, not a panic.
        registry.update(Uuid::new_v4(), &|s| s.bytes_streamed = 9_999);
    }

    #[test]
    fn list_all_returns_every_tracked_session_regardless_of_user() {
        let registry = InMemorySessionRegistry::new();
        let a = sample_session(Uuid::new_v4());
        let b = sample_session(Uuid::new_v4());
        registry.insert(a.clone());
        registry.insert(b.clone());

        let mut all = registry.list_all();
        all.sort_by_key(|s| s.id);
        let mut expected = vec![a, b];
        expected.sort_by_key(|s| s.id);
        assert_eq!(all, expected);
    }

    #[test]
    fn stale_session_ids_finds_only_sessions_past_the_idle_threshold() {
        let registry = InMemorySessionRegistry::new();
        let stale = sample_session(Uuid::new_v4());
        let stale_id = stale.id;
        registry.insert(stale);

        std::thread::sleep(std::time::Duration::from_millis(50));

        let fresh = sample_session(Uuid::new_v4());
        let fresh_id = fresh.id;
        registry.insert(fresh);

        let idle = registry.stale_session_ids(std::time::Duration::from_millis(30));
        assert_eq!(idle, vec![stale_id]);
        assert!(!idle.contains(&fresh_id));

        // `stale_session_ids` never removes anything itself -- see its own
        // doc comment.
        assert_eq!(registry.count(), 2);
    }

    #[test]
    fn update_refreshes_staleness_clock() {
        let registry = InMemorySessionRegistry::new();
        let session = sample_session(Uuid::new_v4());
        let session_id = session.id;
        registry.insert(session);

        std::thread::sleep(std::time::Duration::from_millis(50));
        // A real access (a heartbeat/event) must slide the staleness clock
        // forward, same as `TranscodeSession`'s idle-deadline sliding on
        // real lookups -- otherwise an actively-watched session would still
        // get reaped as though it were abandoned.
        registry.update(session_id, &|s| s.bytes_streamed += 1);

        let idle = registry.stale_session_ids(std::time::Duration::from_millis(30));
        assert!(idle.is_empty());
    }
}
