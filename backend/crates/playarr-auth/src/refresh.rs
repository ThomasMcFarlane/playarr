//! Refresh-token issuance and rotation, with reuse detection.
//!
//! Every refresh token belongs to a *family* (one per device's current
//! login). Each time the token is used it is rotated: the presented token
//! is retired and a new one is issued in its place. If a token that has
//! already been retired is ever presented again, that's strong evidence
//! the token was copied and is being used out-of-band by someone else --
//! the whole family is revoked, forcing the device back through a full
//! login rather than silently trusting whichever of the two holders
//! (legitimate device or thief) happens to poll next.
//!
//! State lives behind [`RefreshTokenStore`] -- re-exported from
//! `playarr_db::RefreshTokenRepo` under this crate's original name so
//! every existing caller (`playarr-bin`, `playarr-api`'s tests, this
//! crate's own tests) keeps working unchanged. The record type
//! (`RefreshTokenRecord`) and both implementations
//! (`InMemoryRefreshTokenStore`, `SqlxRefreshTokenRepo`) live in
//! `playarr-db` now, not here -- they moved so a real, durable
//! implementation could exist at all: `playarr-db` is the only crate
//! allowed to touch `sqlx`/`DbPool` directly (see that crate's own doc
//! comment), and a persisted domain type has to live in `playarr-model`
//! for `playarr-db` to build a repository over it without depending on
//! `playarr-auth` (which itself depends on `playarr-db`) -- the same
//! placement every other persisted type in this codebase already follows.
//! This module still owns all the actual rotation/reuse-detection *logic*
//! below; only the storage boundary moved.
//!
//! Device lifecycle reads/writes (existence checks, `touch_last_seen`,
//! marking a device `trusted`) still go through the real
//! [`playarr_db::DeviceRepo`] trait, unchanged.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{Duration, Utc};
use dashmap::DashMap;
use playarr_db::{DbError, DeviceRepo};
use playarr_model::{Device, Session};
use tokio::sync::OnceCell;
use uuid::Uuid;

pub use playarr_db::{
    InMemoryRefreshTokenStore, RefreshTokenRepo as RefreshTokenStore, SqlxRefreshTokenRepo,
};
pub use playarr_model::RefreshTokenRecord;

use crate::device_flow::TokenResponse;
use crate::jwt::{JwtError, JwtIssuer};
use crate::secret::{hash_token, opaque_token};

/// Default for [`RefreshTokenService::with_reuse_grace`], in seconds.
pub const DEFAULT_REUSE_GRACE_SECS: i64 = 120;

#[derive(Debug, thiserror::Error)]
pub enum RefreshError {
    #[error("unknown device or refresh token")]
    UnknownToken,
    #[error("refresh token has expired")]
    Expired,
    #[error("refresh token reuse detected; token family revoked")]
    ReuseDetected,
    #[error("token family has been revoked")]
    FamilyRevoked,
    #[error(transparent)]
    Db(#[from] DbError),
    #[error(transparent)]
    Jwt(#[from] JwtError),
}

/// A [`Result<(Session, TokenResponse), RefreshError>`] from
/// [`RefreshTokenService::rotate_uncoalesced`], reshaped into a `Clone`
/// value so it can be cached in [`RefreshTokenService::in_flight`] and
/// handed identically to every caller coalesced onto one redemption --
/// including the caller whose own attempt actually executed. `RefreshError`
/// itself can't be `Clone` (it wraps `DbError`/`JwtError`, neither of which
/// is), and re-running [`RefreshTokenService::rotate_uncoalesced`] a second
/// time to reconstruct an equivalent error would observe state the first
/// run already mutated (e.g. `revoked` already flipped from `false` to
/// `true`), turning a specific `ReuseDetected` into a generic
/// `FamilyRevoked` for whichever caller re-ran it -- exactly the kind of
/// self-inflicted mismatch this type exists to avoid.
#[derive(Clone)]
enum RotationOutcome {
    Success(Session, TokenResponse),
    UnknownToken,
    Expired,
    ReuseDetected,
    FamilyRevoked,
    /// The redeeming call failed for an infrastructure reason (a database
    /// or JWT-issuance error) rather than a security-relevant outcome --
    /// too rare, and too dependent on non-`Clone` inner error types, to
    /// preserve exactly. Every caller coalesced onto this falls back to
    /// attempting its own redemption solo, same as it would for any other
    /// transient failure.
    Infra,
}

impl From<Result<(Session, TokenResponse), RefreshError>> for RotationOutcome {
    fn from(result: Result<(Session, TokenResponse), RefreshError>) -> Self {
        match result {
            Ok((session, token_response)) => RotationOutcome::Success(session, token_response),
            Err(RefreshError::UnknownToken) => RotationOutcome::UnknownToken,
            Err(RefreshError::Expired) => RotationOutcome::Expired,
            Err(RefreshError::ReuseDetected) => RotationOutcome::ReuseDetected,
            Err(RefreshError::FamilyRevoked) => RotationOutcome::FamilyRevoked,
            Err(RefreshError::Db(_)) | Err(RefreshError::Jwt(_)) => RotationOutcome::Infra,
        }
    }
}

/// Mints and rotates refresh-token families, backed by a [`RefreshTokenStore`]
/// for the secret material and a real [`DeviceRepo`] for device lifecycle
/// (existence, `trusted`, `last_seen_at`). Shared by [`crate::login`]
/// (all three trust tiers), [`crate::device_flow`] (issuance on
/// approval), and whatever `playarr-api` refresh-grant handler wraps
/// [`Self::rotate`].
pub struct RefreshTokenService {
    store: Arc<dyn RefreshTokenStore>,
    devices: Arc<dyn DeviceRepo>,
    jwt: Arc<JwtIssuer>,
    refresh_ttl: Duration,
    /// How long after a rotation a just-retired token is still honoured
    /// (see [`Self::with_reuse_grace`]).
    reuse_grace: Duration,
    /// Coalesces genuinely-concurrent [`Self::rotate`] calls that present
    /// the exact same still-current token for the same device -- see that
    /// method's doc comment for why this exists and why it's narrow enough
    /// to stay safe. Keyed by `(device_id, hash_token(presented token))`;
    /// each entry is removed the moment its redeeming call finishes, so
    /// this never outlives the handful of requests that were truly in
    /// flight together.
    in_flight: DashMap<(Uuid, String), Arc<OnceCell<RotationOutcome>>>,
    /// Serialises every read-modify-write of one device's token family.
    /// Rotations of *different* tokens (the current one and one still inside
    /// the reuse grace window) are not coalesced, and without this they could
    /// both read the same record and the later write would drop the other's
    /// freshly minted token.
    device_locks: DashMap<Uuid, Arc<tokio::sync::Mutex<()>>>,
}

impl RefreshTokenService {
    pub fn new(
        store: Arc<dyn RefreshTokenStore>,
        devices: Arc<dyn DeviceRepo>,
        jwt: Arc<JwtIssuer>,
        refresh_ttl: Duration,
    ) -> Self {
        Self {
            store,
            devices,
            jwt,
            refresh_ttl,
            reuse_grace: Duration::seconds(DEFAULT_REUSE_GRACE_SECS),
            in_flight: DashMap::new(),
            device_locks: DashMap::new(),
        }
    }

    /// Sets the reuse grace window: a token that was retired no more than
    /// `grace` before the family's latest rotation is treated as a late
    /// duplicate of a legitimate request (a response lost on a flaky
    /// network and retried, a second tab or client racing the first, a
    /// request that was in flight across a rollout) instead of theft. The
    /// caller gets a fresh rotation rather than a revoked family. A token
    /// replayed after the window still revokes the whole family. A zero
    /// grace restores strict single-use behaviour.
    pub fn with_reuse_grace(mut self, grace: Duration) -> Self {
        self.reuse_grace = grace;
        self
    }

    /// First issuance of a token family for `device`: upserts the device
    /// row (marking it `trusted`, since a completed login is exactly the
    /// event `Device::trusted`'s doc comment describes), mints a fresh
    /// refresh token and starts a new family for it, and returns both the
    /// domain [`Session`] and an RFC 6749-shaped [`TokenResponse`].
    pub async fn issue(
        &self,
        mut device: Device,
        refresh_ttl: Duration,
    ) -> Result<(Session, TokenResponse), RefreshError> {
        device.trusted = true;
        self.devices.upsert(&device).await?;

        let now = Utc::now();
        let raw = opaque_token();
        let hash = hash_token(&raw);
        let session_id = Uuid::new_v4();
        let record = RefreshTokenRecord {
            device_id: device.id,
            user_id: device.user_id,
            session_id,
            family_id: Uuid::new_v4(),
            generation: 0,
            current_hash: hash.clone(),
            used_hashes: HashSet::from([hash]),
            issued_at: now,
            expires_at: now + refresh_ttl,
            rotated_at: None,
            revoked: false,
        };
        {
            let device_lock = self
                .device_locks
                .entry(device.id)
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone();
            let _guard = device_lock.lock().await;
            self.store.put(record.clone()).await?;
        }

        let access_token = self
            .jwt
            .issue_access_token(device.user_id, device.id, session_id)?;
        let token_response = TokenResponse {
            access_token,
            token_type: "Bearer".to_string(),
            expires_in: self.jwt.access_ttl().num_seconds(),
            refresh_token: raw,
        };
        let session = Session {
            id: session_id,
            user_id: device.user_id,
            device_id: device.id,
            issued_at: record.issued_at,
            expires_at: record.expires_at,
            refresh_token: token_response.refresh_token.clone().into(),
            revoked: false,
        };
        Ok((session, token_response))
    }

    /// Presents `raw_token` for `device_id`. If it's the currently-valid
    /// token for that device's family it is rotated (retired, with a new
    /// one minted in its place) and a fresh token bundle is returned. If
    /// it's a token this family has already retired, that's treated as
    /// reuse: the whole family is revoked and every future presentation --
    /// even of the token that *was* still valid -- is rejected until the
    /// device completes a fresh login via [`Self::issue`].
    ///
    /// Callers presenting the exact same still-current token for the same
    /// device at (nearly) the same moment -- e.g. a client whose REST and
    /// playback authenticators both 401 after the app resumes from
    /// background, or two browser tabs sharing one session -- are
    /// coalesced onto a single redemption via [`Self::in_flight`], rather
    /// than each independently racing this method's rotation below. That
    /// race would otherwise be indistinguishable from theft to the loser:
    /// by the time it runs, the winner has already retired the very hash
    /// it's presenting, so it would hit reuse detection and revoke a
    /// perfectly legitimate session. This is deliberately narrow, not a
    /// grace period: the coalescing entry exists only from the first
    /// caller's arrival to that same redemption's completion, so a call
    /// that shows up even slightly later -- including a real replay of a
    /// stolen, already-retired token -- still goes through
    /// [`Self::rotate_uncoalesced`] on its own and is rejected exactly as
    /// before. (Later duplicates of an already-retired token are handled
    /// by the separate, time-boxed [`Self::with_reuse_grace`] window in
    /// [`Self::rotate_uncoalesced`]: inside it a late duplicate is rotated
    /// again rather than revoked, because a lost response or a second tab
    /// is far more likely than theft and a signed-out owner is the worse
    /// failure; beyond it reuse still revokes the family.)
    pub async fn rotate(
        &self,
        device_id: Uuid,
        raw_token: &str,
    ) -> Result<(Session, TokenResponse), RefreshError> {
        let key = (device_id, hash_token(raw_token));
        let cell = self
            .in_flight
            .entry(key.clone())
            .or_insert_with(|| Arc::new(OnceCell::new()))
            .clone();

        let outcome = cell
            .get_or_init(|| async {
                RotationOutcome::from(self.rotate_uncoalesced(device_id, raw_token).await)
            })
            .await
            .clone();

        // Only genuinely-concurrent callers should ever observe a resolved
        // cell -- drop it the moment the redeeming call finishes so anyone
        // presenting this same hash afterward takes the normal path below.
        self.in_flight.remove(&key);

        // Every caller coalesced onto this redemption -- including
        // whichever one actually executed it -- maps the exact same cached
        // `RotationOutcome` to its own return value. Nobody re-runs
        // `rotate_uncoalesced` to "double check," which would just observe
        // state the first run already mutated (see that type's doc
        // comment) and report something subtly wrong.
        match outcome {
            RotationOutcome::Success(session, token_response) => Ok((session, token_response)),
            RotationOutcome::UnknownToken => Err(RefreshError::UnknownToken),
            RotationOutcome::Expired => Err(RefreshError::Expired),
            RotationOutcome::ReuseDetected => Err(RefreshError::ReuseDetected),
            RotationOutcome::FamilyRevoked => Err(RefreshError::FamilyRevoked),
            RotationOutcome::Infra => self.rotate_uncoalesced(device_id, raw_token).await,
        }
    }

    /// The actual single-use rotation/reuse-detection logic behind
    /// [`Self::rotate`] -- see that method's doc comment for the
    /// concurrency coalescing wrapped around this.
    async fn rotate_uncoalesced(
        &self,
        device_id: Uuid,
        raw_token: &str,
    ) -> Result<(Session, TokenResponse), RefreshError> {
        let device_lock = self
            .device_locks
            .entry(device_id)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        let _guard = device_lock.lock().await;
        match self.devices.get(device_id).await {
            Ok(_) => {}
            Err(DbError::NotFound) => return Err(RefreshError::UnknownToken),
            Err(other) => return Err(RefreshError::Db(other)),
        }

        let mut record = self
            .store
            .get(device_id)
            .await?
            .ok_or(RefreshError::UnknownToken)?;

        if record.revoked {
            return Err(RefreshError::FamilyRevoked);
        }

        let now = Utc::now();
        if now > record.expires_at {
            return Err(RefreshError::Expired);
        }

        let presented_hash = hash_token(raw_token);

        if presented_hash != record.current_hash {
            if !record.used_hashes.contains(&presented_hash) {
                tracing::info!(%device_id, "refresh rejected: token not recognised for this device");
                return Err(RefreshError::UnknownToken);
            }
            let within_grace = self.reuse_grace > Duration::zero()
                && record
                    .rotated_at
                    .is_some_and(|rotated_at| now - rotated_at <= self.reuse_grace);
            if !within_grace {
                tracing::warn!(
                    %device_id,
                    family_id = %record.family_id,
                    generation = record.generation,
                    "refresh token reuse outside the grace window; revoking token family"
                );
                record.revoked = true;
                self.store.put(record).await?;
                return Err(RefreshError::ReuseDetected);
            }
            tracing::info!(
                %device_id,
                family_id = %record.family_id,
                "refresh token reuse within the grace window; rotating again without revoking"
            );
        }

        let raw_new = opaque_token();
        let new_hash = hash_token(&raw_new);
        record.generation += 1;
        record.current_hash = new_hash.clone();
        record.used_hashes.insert(new_hash);
        record.rotated_at = Some(now);
        // A refresh family expires after inactivity, not after a fixed
        // wall-clock period from the first login. Every legitimate use
        // proves that this trusted device is still active, so slide the
        // deadline forward while retaining rotation and reuse detection.
        record.expires_at = now + self.refresh_ttl;
        self.store.put(record.clone()).await?;

        self.devices.touch_last_seen(device_id, now).await?;

        let access_token =
            self.jwt
                .issue_access_token(record.user_id, device_id, record.session_id)?;
        let token_response = TokenResponse {
            access_token,
            token_type: "Bearer".to_string(),
            expires_in: self.jwt.access_ttl().num_seconds(),
            refresh_token: raw_new,
        };
        let session = Session {
            id: record.session_id,
            user_id: record.user_id,
            device_id,
            issued_at: record.issued_at,
            expires_at: record.expires_at,
            refresh_token: token_response.refresh_token.clone().into(),
            revoked: false,
        };
        Ok((session, token_response))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jwt::JwtIssuer;
    use crate::test_support::FakeDeviceRepo;
    use playarr_model::ClientPlatform;

    fn service() -> RefreshTokenService {
        let jwt = Arc::new(JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "playarr",
            Duration::minutes(15),
        ));
        let devices: Arc<dyn DeviceRepo> = Arc::new(FakeDeviceRepo::default());
        let store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
        RefreshTokenService::new(store, devices, jwt, Duration::days(30))
            .with_reuse_grace(Duration::zero())
    }

    fn device(user_id: Uuid) -> Device {
        Device {
            id: Uuid::new_v4(),
            user_id,
            name: "test device".to_string(),
            platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            last_seen_at: None,
            trusted: false,
        }
    }

    #[tokio::test]
    async fn issue_then_rotate_succeeds_and_changes_the_token() {
        let service = service();
        let user_id = Uuid::new_v4();
        let (session, first) = service
            .issue(device(user_id), Duration::days(30))
            .await
            .unwrap();

        let (rotated_session, second) = service
            .rotate(session.device_id, &first.refresh_token)
            .await
            .unwrap();

        assert_ne!(first.refresh_token, second.refresh_token);
        assert_eq!(
            session.id, rotated_session.id,
            "session id stays stable across rotation"
        );
        assert_eq!(session.user_id, user_id);
    }

    #[tokio::test]
    async fn rotation_slides_the_refresh_expiry_forward() {
        let service = service();
        let user_id = Uuid::new_v4();
        let (session, first) = service
            .issue(device(user_id), Duration::days(30))
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let (rotated, _) = service
            .rotate(session.device_id, &first.refresh_token)
            .await
            .unwrap();

        assert!(rotated.expires_at > session.expires_at);
    }

    #[tokio::test]
    async fn reuse_of_retired_token_revokes_whole_family() {
        let service = service();
        let user_id = Uuid::new_v4();
        let (session, first) = service
            .issue(device(user_id), Duration::days(30))
            .await
            .unwrap();

        let (_, second) = service
            .rotate(session.device_id, &first.refresh_token)
            .await
            .unwrap();

        // Replaying the now-retired first token is theft evidence.
        let reuse = service
            .rotate(session.device_id, &first.refresh_token)
            .await;
        assert!(matches!(reuse, Err(RefreshError::ReuseDetected)));

        // The whole family is revoked -- even the legitimately-current
        // second token is now rejected.
        let after_revocation = service
            .rotate(session.device_id, &second.refresh_token)
            .await;
        assert!(matches!(after_revocation, Err(RefreshError::FamilyRevoked)));
    }

    /// The bug this coalescing fix targets: a client whose REST and
    /// playback/download authenticators (or two browser tabs sharing one
    /// session) both redeem the *same* still-current refresh token at
    /// (nearly) the same moment. Before the fix, the loser would present a
    /// hash the winner had already retired and get `ReuseDetected`,
    /// revoking a perfectly legitimate session out from under the user.
    ///
    /// Wraps `FakeDeviceRepo` to pause the leader mid-`rotate_uncoalesced`
    /// (at `touch_last_seen`, right before the new token is minted) so the
    /// follower's call is deterministically guaranteed to observe the
    /// leader's rotation still in flight, rather than hoping real thread
    /// scheduling happens to overlap two instant calls.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_callers_presenting_the_same_still_current_token_are_coalesced() {
        use tokio::sync::Notify;

        struct PausingDeviceRepo {
            inner: FakeDeviceRepo,
            paused: Notify,
            release: Notify,
        }

        #[async_trait::async_trait]
        impl DeviceRepo for PausingDeviceRepo {
            async fn get(&self, id: Uuid) -> Result<Device, DbError> {
                self.inner.get(id).await
            }
            async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<Device>, DbError> {
                self.inner.list_for_user(user_id).await
            }
            async fn upsert(&self, device: &Device) -> Result<(), DbError> {
                self.inner.upsert(device).await
            }
            async fn delete(&self, id: Uuid) -> Result<(), DbError> {
                self.inner.delete(id).await
            }
            async fn touch_last_seen(
                &self,
                id: Uuid,
                at: chrono::DateTime<Utc>,
            ) -> Result<(), DbError> {
                self.paused.notify_one();
                self.release.notified().await;
                self.inner.touch_last_seen(id, at).await
            }
        }

        let jwt = Arc::new(JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "playarr",
            Duration::minutes(15),
        ));
        let inner = FakeDeviceRepo::default();
        let user_id = Uuid::new_v4();
        let d = device(user_id);
        let device_id = d.id;
        inner.upsert(&d).await.unwrap();
        let devices = Arc::new(PausingDeviceRepo {
            inner,
            paused: Notify::new(),
            release: Notify::new(),
        });
        let store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
        let service = Arc::new(
            RefreshTokenService::new(store, devices.clone(), jwt, Duration::days(30))
                .with_reuse_grace(Duration::zero()),
        );

        let (_, issued) = service.issue(d, Duration::days(30)).await.unwrap();
        let token = issued.refresh_token;

        let leader = tokio::spawn({
            let service = service.clone();
            let token = token.clone();
            async move { service.rotate(device_id, &token).await }
        });

        // Deterministic handoff: don't proceed until the leader is
        // actually parked mid-rotation, still holding the token retired.
        devices.paused.notified().await;

        let follower = tokio::spawn({
            let service = service.clone();
            let token = token.clone();
            async move { service.rotate(device_id, &token).await }
        });
        // Give the follower a real chance to reach the in-flight join
        // point before the leader is released and the entry is cleared.
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;

        devices.release.notify_one();

        let (leader_result, follower_result) = tokio::join!(leader, follower);
        let (leader_session, leader_response) =
            leader_result.unwrap().expect("leader rotation succeeds");
        let (follower_session, follower_response) = follower_result
            .unwrap()
            .expect("a truly concurrent caller must be coalesced onto the leader's result, not rejected as reuse");

        assert_eq!(
            leader_response.refresh_token, follower_response.refresh_token,
            "coalesced callers must share the exact same rotated token, not each mint their own"
        );
        assert_eq!(leader_session.id, follower_session.id);

        // The original token is still genuinely single-use: a later,
        // non-concurrent replay of it is rejected exactly as before.
        let reuse = service.rotate(device_id, &token).await;
        assert!(matches!(reuse, Err(RefreshError::ReuseDetected)));
    }

    fn service_with(
        store: Arc<dyn RefreshTokenStore>,
        devices: Arc<dyn DeviceRepo>,
        grace: Duration,
    ) -> RefreshTokenService {
        let jwt = Arc::new(JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "playarr",
            Duration::minutes(15),
        ));
        RefreshTokenService::new(store, devices, jwt, Duration::days(30)).with_reuse_grace(grace)
    }

    #[tokio::test]
    async fn late_duplicate_inside_the_grace_window_is_rotated_not_revoked() {
        let service = service_with(
            Arc::new(InMemoryRefreshTokenStore::new()),
            Arc::new(FakeDeviceRepo::default()),
            Duration::seconds(120),
        );
        let (session, first) = service
            .issue(device(Uuid::new_v4()), Duration::days(30))
            .await
            .unwrap();
        // Tab A redeems the token; tab B (stale, or a retry after a lost
        // response) presents the same, now retired, token afterwards.
        let (_, a) = service
            .rotate(session.device_id, &first.refresh_token)
            .await
            .unwrap();
        let (_, b) = service
            .rotate(session.device_id, &first.refresh_token)
            .await
            .expect("duplicate inside the grace window must not sign the user out");
        assert_ne!(a.refresh_token, b.refresh_token);
        // Both holders keep working: each one's token is accepted once
        // within the window, and the family is never revoked.
        service
            .rotate(session.device_id, &a.refresh_token)
            .await
            .expect("tab A continues");
        let latest = service.rotate(session.device_id, &b.refresh_token).await;
        assert!(latest.is_ok(), "tab B continues: {latest:?}");
    }

    #[tokio::test]
    async fn reuse_after_the_grace_window_still_revokes_the_family() {
        let store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
        let service = service_with(
            store.clone(),
            Arc::new(FakeDeviceRepo::default()),
            Duration::seconds(120),
        );
        let (session, first) = service
            .issue(device(Uuid::new_v4()), Duration::days(30))
            .await
            .unwrap();
        service
            .rotate(session.device_id, &first.refresh_token)
            .await
            .unwrap();
        // Age the rotation beyond the window.
        let mut record = store.get(session.device_id).await.unwrap().unwrap();
        record.rotated_at = Some(Utc::now() - Duration::seconds(600));
        store.put(record).await.unwrap();
        let replay = service
            .rotate(session.device_id, &first.refresh_token)
            .await;
        assert!(matches!(replay, Err(RefreshError::ReuseDetected)));
    }

    /// The server restarts (new process, new pool, new `JwtIssuer` built
    /// from the same configured secret): the refresh family and every
    /// access token issued earlier must keep working.
    #[tokio::test]
    async fn session_survives_a_server_restart() {
        use playarr_db::{connect, run_migrations};
        let path = std::env::temp_dir().join(format!("playarr-restart-{}.db", Uuid::new_v4()));
        let url = format!("sqlite://{}", path.display());
        let secret = b"restart-secret-key-at-least-32-bytes!!";
        let devices: Arc<dyn DeviceRepo> = Arc::new(FakeDeviceRepo::default());
        let user_id = Uuid::new_v4();
        let d = device(user_id);
        devices.upsert(&d).await.unwrap();

        let pool = connect(&url).await.unwrap();
        run_migrations(&pool, false).await.unwrap();
        let jwt_before = Arc::new(JwtIssuer::new(secret, "playarr", Duration::minutes(15)));
        let before = RefreshTokenService::new(
            Arc::new(SqlxRefreshTokenRepo::new(pool.clone())),
            devices.clone(),
            jwt_before,
            Duration::days(30),
        );
        let (session, issued) = before.issue(d.clone(), Duration::days(30)).await.unwrap();
        let (_, rotated) = before
            .rotate(session.device_id, &issued.refresh_token)
            .await
            .unwrap();
        drop(before);
        pool.close().await;

        // "Restart".
        let pool = connect(&url).await.unwrap();
        run_migrations(&pool, false).await.unwrap();
        let jwt_after = Arc::new(JwtIssuer::new(secret, "playarr", Duration::minutes(15)));
        jwt_after
            .verify_access_token(&rotated.access_token)
            .await
            .expect("an access token issued before the restart still verifies");
        let after = RefreshTokenService::new(
            Arc::new(SqlxRefreshTokenRepo::new(pool.clone())),
            devices,
            jwt_after.clone(),
            Duration::days(30),
        );
        let (restored, next) = after
            .rotate(session.device_id, &rotated.refresh_token)
            .await
            .expect("refresh token issued before the restart still rotates");
        assert_eq!(restored.id, session.id);
        jwt_after
            .verify_access_token(&next.access_token)
            .await
            .unwrap();
        pool.close().await;
        let _ = std::fs::remove_file(&path);
    }

    /// Many clients (tabs, native authenticators, the live-events stream)
    /// redeem the same token at once, repeatedly: nobody is rejected and
    /// the family survives.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn many_concurrent_refreshes_never_sign_the_user_out() {
        let service = Arc::new(service_with(
            Arc::new(InMemoryRefreshTokenStore::new()),
            Arc::new(FakeDeviceRepo::default()),
            Duration::seconds(120),
        ));
        let (session, issued) = service
            .issue(device(Uuid::new_v4()), Duration::days(30))
            .await
            .unwrap();
        let mut tokens = vec![issued.refresh_token];
        for _round in 0..5 {
            let mut handles = Vec::new();
            for token in tokens.iter() {
                for _ in 0..8 {
                    let service = service.clone();
                    let token = token.clone();
                    let device_id = session.device_id;
                    handles.push(tokio::spawn(async move {
                        service.rotate(device_id, &token).await
                    }));
                }
            }
            let mut next = Vec::new();
            for handle in handles {
                let (_, response) = handle
                    .await
                    .unwrap()
                    .expect("no concurrent refresh may fail");
                if !next.contains(&response.refresh_token) {
                    next.push(response.refresh_token);
                }
            }
            tokens = next;
        }
    }

    #[tokio::test]
    async fn unknown_token_is_rejected_without_revoking_the_family() {
        let service = service();
        let user_id = Uuid::new_v4();
        let (session, first) = service
            .issue(device(user_id), Duration::days(30))
            .await
            .unwrap();

        let bogus = service.rotate(session.device_id, "not-a-real-token").await;
        assert!(matches!(bogus, Err(RefreshError::UnknownToken)));

        // An unrecognized token alone isn't proof of compromise -- the
        // real one still works afterward.
        let legit = service
            .rotate(session.device_id, &first.refresh_token)
            .await;
        assert!(legit.is_ok());
    }

    #[tokio::test]
    async fn rotate_for_unknown_device_is_rejected() {
        let service = service();
        let result = service.rotate(Uuid::new_v4(), "whatever").await;
        assert!(matches!(result, Err(RefreshError::UnknownToken)));
    }

    #[tokio::test]
    async fn expired_refresh_token_is_rejected() {
        let service = service();
        let user_id = Uuid::new_v4();
        let (session, first) = service
            .issue(device(user_id), Duration::seconds(-1))
            .await
            .unwrap();

        let result = service
            .rotate(session.device_id, &first.refresh_token)
            .await;
        assert!(matches!(result, Err(RefreshError::Expired)));
    }

    #[tokio::test]
    async fn issue_marks_the_device_trusted_via_device_repo() {
        let jwt = Arc::new(JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "playarr",
            Duration::minutes(15),
        ));
        let devices = Arc::new(FakeDeviceRepo::default());
        let store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
        let service = RefreshTokenService::new(store, devices.clone(), jwt, Duration::days(30));

        let user_id = Uuid::new_v4();
        let d = device(user_id);
        let device_id = d.id;
        service.issue(d, Duration::days(30)).await.unwrap();

        let stored = devices.get(device_id).await.unwrap();
        assert!(stored.trusted);
    }
}
