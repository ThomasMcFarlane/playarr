//! In-flight playback session tracking, kept separate from the durable
//! `playback_sessions` table (`streamarr_db::analytics`). This registry
//! answers "what's happening right now" — for the
//! `playback_sessions_active` gauge, for an admin's live sessions view,
//! for enforcing `streamarr_model::Policy::max_concurrent_sessions` —
//! cheaply and in-process, without a DB round-trip on every playback
//! heartbeat.

use dashmap::DashMap;
use streamarr_model::PlaybackSession;
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

    /// Backs the `playback_sessions_active` gauge directly.
    fn count(&self) -> usize;
}

#[derive(Default)]
pub struct InMemorySessionRegistry {
    sessions: DashMap<Uuid, PlaybackSession>,
}

impl InMemorySessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SessionRegistry for InMemorySessionRegistry {
    fn insert(&self, session: PlaybackSession) {
        self.sessions.insert(session.id, session);
    }

    fn update(&self, session_id: Uuid, f: &dyn Fn(&mut PlaybackSession)) {
        if let Some(mut entry) = self.sessions.get_mut(&session_id) {
            f(entry.value_mut());
        }
    }

    fn remove(&self, session_id: Uuid) -> Option<PlaybackSession> {
        self.sessions
            .remove(&session_id)
            .map(|(_, session)| session)
    }

    fn get(&self, session_id: Uuid) -> Option<PlaybackSession> {
        self.sessions
            .get(&session_id)
            .map(|entry| entry.value().clone())
    }

    fn list_for_user(&self, user_id: Uuid) -> Vec<PlaybackSession> {
        self.sessions
            .iter()
            .filter(|entry| entry.value().user_id == user_id)
            .map(|entry| entry.value().clone())
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
    use streamarr_model::{ClientPlatform, PlayMethod};

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
}
