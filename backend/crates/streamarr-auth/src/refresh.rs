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
//! State lives behind [`RefreshTokenStore`], backed by an in-memory
//! `DashMap` by default (see [`InMemoryRefreshTokenStore`]), with a trait
//! boundary so a real deployment can swap in a shared/persistent store
//! later without touching the rotation logic below.
//!
//! TODO(schema): `streamarr_model::Device` has no `refresh_token_hash`/
//! family columns yet, so the secret material tracked here can't ride
//! along on the `devices` table the way a fully wired-up version of this
//! would. This module owns that state itself instead, while still routing
//! every device lifecycle read/write through the real
//! [`streamarr_db::DeviceRepo`] trait (existence checks, `touch_last_seen`,
//! marking a device `trusted`). A follow-up pass that adds those columns
//! to `Device` and `DeviceRepo` should be able to replace
//! `InMemoryRefreshTokenStore` with a `DeviceRepo`-backed implementation
//! without changing anything that calls into `RefreshTokenService`.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use streamarr_db::{DbError, DeviceRepo};
use streamarr_model::{Device, Session};
use uuid::Uuid;

use crate::device_flow::TokenResponse;
use crate::jwt::{JwtError, JwtIssuer};
use crate::secret::{hash_token, opaque_token};

/// Server-side bookkeeping for one device's current refresh-token family.
#[derive(Debug, Clone)]
pub struct RefreshTokenRecord {
    pub device_id: Uuid,
    pub user_id: Uuid,
    /// Stable across rotations -- the same login "session" as far as
    /// `AccessTokenClaims::session_id` / `Policy::max_concurrent_sessions`
    /// are concerned, even though the underlying secret changes.
    pub session_id: Uuid,
    /// Identifies the family a token belongs to; a brand-new family is
    /// started on every fresh [`RefreshTokenService::issue`] call.
    pub family_id: Uuid,
    /// Incremented on every successful rotation; 0 at issuance.
    pub generation: u64,
    pub current_hash: String,
    /// Every hash this family has ever had as its `current_hash`,
    /// including the current one -- checked on reuse so a token from *any*
    /// earlier generation (not just the immediately-prior one) is caught.
    pub used_hashes: HashSet<String>,
    pub issued_at: DateTime<Utc>,
    /// Fixed at issuance (not extended by rotation) -- a deliberately
    /// simple, secure-by-default choice: the device must complete a full
    /// login again after this point no matter how often it refreshes.
    /// TODO: a sliding-expiration policy could be layered on top later if
    /// operators want "stay logged in as long as you're active" instead.
    pub expires_at: DateTime<Utc>,
    pub rotated_at: Option<DateTime<Utc>>,
    pub revoked: bool,
}

/// Storage boundary for [`RefreshTokenRecord`]s, keyed by `device_id` (a
/// device has at most one live token family at a time -- a fresh
/// [`RefreshTokenService::issue`] call replaces whatever family it had).
#[async_trait]
pub trait RefreshTokenStore: Send + Sync {
    async fn get(&self, device_id: Uuid) -> Option<RefreshTokenRecord>;
    async fn put(&self, record: RefreshTokenRecord);
}

/// The default [`RefreshTokenStore`]: an in-process `DashMap`. Fine for a
/// single-node deployment; a multi-node one should implement the trait
/// against a shared store (Redis, Postgres, ...) instead.
#[derive(Default)]
pub struct InMemoryRefreshTokenStore {
    records: DashMap<Uuid, RefreshTokenRecord>,
}

impl InMemoryRefreshTokenStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl RefreshTokenStore for InMemoryRefreshTokenStore {
    async fn get(&self, device_id: Uuid) -> Option<RefreshTokenRecord> {
        self.records.get(&device_id).map(|entry| entry.clone())
    }

    async fn put(&self, record: RefreshTokenRecord) {
        self.records.insert(record.device_id, record);
    }
}

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
        self.store.put(record.clone()).await;

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
    pub async fn rotate(
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
            .await
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
                self.store.put(record).await;
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
        self.store.put(record.clone()).await;

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
