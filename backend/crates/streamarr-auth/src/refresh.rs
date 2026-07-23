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
//! `streamarr_db::RefreshTokenRepo` under this crate's original name so
//! every existing caller (`streamarr-bin`, `streamarr-api`'s tests, this
//! crate's own tests) keeps working unchanged. The record type
//! (`RefreshTokenRecord`) and both implementations
//! (`InMemoryRefreshTokenStore`, `SqlxRefreshTokenRepo`) live in
//! `streamarr-db` now, not here -- they moved so a real, durable
//! implementation could exist at all: `streamarr-db` is the only crate
//! allowed to touch `sqlx`/`DbPool` directly (see that crate's own doc
//! comment), and a persisted domain type has to live in `streamarr-model`
//! for `streamarr-db` to build a repository over it without depending on
//! `streamarr-auth` (which itself depends on `streamarr-db`) -- the same
//! placement every other persisted type in this codebase already follows.
//! This module still owns all the actual rotation/reuse-detection *logic*
//! below; only the storage boundary moved.
//!
//! Device lifecycle reads/writes (existence checks, `touch_last_seen`,
//! marking a device `trusted`) still go through the real
//! [`streamarr_db::DeviceRepo`] trait, unchanged.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{Duration, Utc};
use dashmap::DashMap;
use streamarr_db::{DbError, DeviceRepo};
use streamarr_model::{Device, Session};
use tokio::sync::OnceCell;
use uuid::Uuid;

pub use streamarr_db::{
    InMemoryRefreshTokenStore, RefreshTokenRepo as RefreshTokenStore, SqlxRefreshTokenRepo,
};
pub use streamarr_model::RefreshTokenRecord;

use crate::device_flow::TokenResponse;
use crate::jwt::{JwtError, JwtIssuer};
use crate::secret::{hash_token, opaque_token};

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
/// approval), and whatever `streamarr-api` refresh-grant handler wraps
/// [`Self::rotate`].
pub struct RefreshTokenService {
    store: Arc<dyn RefreshTokenStore>,
    devices: Arc<dyn DeviceRepo>,
    jwt: Arc<JwtIssuer>,
    /// Coalesces genuinely-concurrent [`Self::rotate`] calls that present
    /// the exact same still-current token for the same device -- see that
    /// method's doc comment for why this exists and why it's narrow enough
    /// to stay safe. Keyed by `(device_id, hash_token(presented token))`;
    /// each entry is removed the moment its redeeming call finishes, so
    /// this never outlives the handful of requests that were truly in
    /// flight together.
    in_flight: DashMap<(Uuid, String), Arc<OnceCell<RotationOutcome>>>,
}

impl RefreshTokenService {
    pub fn new(
        store: Arc<dyn RefreshTokenStore>,
        devices: Arc<dyn DeviceRepo>,
        jwt: Arc<JwtIssuer>,
    ) -> Self {
        Self {
            store,
            devices,
            jwt,
            in_flight: DashMap::new(),
        }
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
        self.store.put(record.clone()).await?;

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
    /// before. (A *forgiving* grace period -- accepting the immediately-
    /// prior hash again after the fact -- was considered and rejected: it
    /// cannot tell "my own concurrent request" apart from "an attacker who
    /// redeemed the stolen token a moment before me," and would silently
    /// hand the second presenter the attacker's own rotated token instead
    /// of raising the alarm.)
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
            if record.used_hashes.contains(&presented_hash) {
                record.revoked = true;
                self.store.put(record).await?;
                return Err(RefreshError::ReuseDetected);
            }
            return Err(RefreshError::UnknownToken);
        }

        let raw_new = opaque_token();
        let new_hash = hash_token(&raw_new);
        record.generation += 1;
        record.current_hash = new_hash.clone();
        record.used_hashes.insert(new_hash);
        record.rotated_at = Some(now);
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
    use streamarr_model::ClientPlatform;

    fn service() -> RefreshTokenService {
        let jwt = Arc::new(JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "streamarr",
            Duration::minutes(15),
        ));
        let devices: Arc<dyn DeviceRepo> = Arc::new(FakeDeviceRepo::default());
        let store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
        RefreshTokenService::new(store, devices, jwt)
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
            "streamarr",
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
        let service = Arc::new(RefreshTokenService::new(
            store,
            devices.clone(),
            jwt,
        ));

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
            "streamarr",
            Duration::minutes(15),
        ));
        let devices = Arc::new(FakeDeviceRepo::default());
        let store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
        let service = RefreshTokenService::new(store, devices.clone(), jwt);

        let user_id = Uuid::new_v4();
        let d = device(user_id);
        let device_id = d.id;
        service.issue(d, Duration::days(30)).await.unwrap();

        let stored = devices.get(device_id).await.unwrap();
        assert!(stored.trusted);
    }
}
