//! JWT issuance and verification for access tokens. Session-level refresh
//! tokens (the long-lived, revocable side of auth — see
//! `streamarr_model::Session::refresh_token`) are opaque, DB-backed
//! secrets, not JWTs; only the short-lived access token handed to a client
//! after login/refresh is a JWT, so `JwtIssuer` never needs to consult the
//! database to validate one.

use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum JwtError {
    #[error(transparent)]
    Token(#[from] jsonwebtoken::errors::Error),
}

/// Claims embedded in every access token. `sub` is the user id (the JWT
/// spec's own name for the subject claim); `device_id`/`session_id` are
/// carried so downstream handlers can enforce
/// `Policy::max_concurrent_sessions` and per-device revocation without a
/// second lookup.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccessTokenClaims {
    pub sub: Uuid,
    pub device_id: Uuid,
    pub session_id: Uuid,
    pub iss: String,
    /// Issued-at, seconds since the epoch (standard `iat` claim).
    pub iat: i64,
    /// Expiry, seconds since the epoch (standard `exp` claim) —
    /// `jsonwebtoken` validates this automatically on decode.
    pub exp: i64,
    /// Set only on a token minted via [`JwtIssuer::issue_access_token_for`]
    /// with a caller-supplied admin id -- i.e. an admin-impersonation
    /// token, not a normal login/refresh-issued one. Carries the
    /// impersonating admin's user id so a handler acting on `sub` (the
    /// *impersonated* user) can still tell, and audit-log, who is actually
    /// behind the request. `#[serde(default)]` so tokens issued (or test
    /// fixtures constructed) before this field existed still decode/build
    /// fine with `impersonated_by: None`.
    #[serde(default)]
    pub impersonated_by: Option<Uuid>,
}

/// Issues and verifies HMAC-signed (HS256) access tokens. Holds both the
/// encoding and decoding key because, for a symmetric algorithm, they're
/// the same secret — an asymmetric (RS256/ES256) deployment would instead
/// hold a private key here and distribute only the public key to whichever
/// services only need to verify, not issue.
pub struct JwtIssuer {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    algorithm: Algorithm,
    issuer: String,
    access_ttl: Duration,
}

impl JwtIssuer {
    pub fn new(hmac_secret: &[u8], issuer: impl Into<String>, access_ttl: Duration) -> Self {
        Self {
            encoding_key: EncodingKey::from_secret(hmac_secret),
            decoding_key: DecodingKey::from_secret(hmac_secret),
            algorithm: Algorithm::HS256,
            issuer: issuer.into(),
            access_ttl,
        }
    }

    /// The configured access-token TTL, e.g. so a token-response builder
    /// elsewhere in this crate can populate `expires_in` without
    /// duplicating the value this issuer was constructed with.
    pub fn access_ttl(&self) -> Duration {
        self.access_ttl
    }

    pub fn issue_access_token(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        session_id: Uuid,
    ) -> Result<String, JwtError> {
        self.issue_access_token_for(user_id, device_id, session_id, None)
    }

    /// The real token-minting logic behind [`Self::issue_access_token`]
    /// (a thin wrapper calling this with `impersonated_by: None`) --
    /// also used directly by admin impersonation (`streamarr-api`'s
    /// `admin::impersonate_user_handler`) to mint a token for a *different*
    /// user than the caller, with `impersonated_by` set to the
    /// impersonating admin's own user id.
    pub fn issue_access_token_for(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        session_id: Uuid,
        impersonated_by: Option<Uuid>,
    ) -> Result<String, JwtError> {
        let now = Utc::now();
        let claims = AccessTokenClaims {
            sub: user_id,
            device_id,
            session_id,
            iss: self.issuer.clone(),
            iat: now.timestamp(),
            exp: (now + self.access_ttl).timestamp(),
            impersonated_by,
        };
        let header = Header::new(self.algorithm);
        Ok(jsonwebtoken::encode(&header, &claims, &self.encoding_key)?)
    }

    pub fn verify_access_token(&self, token: &str) -> Result<AccessTokenClaims, JwtError> {
        let mut validation = Validation::new(self.algorithm);
        validation.set_issuer(&[self.issuer.as_str()]);
        let data =
            jsonwebtoken::decode::<AccessTokenClaims>(token, &self.decoding_key, &validation)?;
        Ok(data.claims)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issued_token_verifies_and_round_trips_claims() {
        let issuer = JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "streamarr",
            Duration::minutes(15),
        );
        let user_id = Uuid::new_v4();
        let device_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        let token = issuer
            .issue_access_token(user_id, device_id, session_id)
            .unwrap();
        let claims = issuer.verify_access_token(&token).unwrap();

        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.device_id, device_id);
        assert_eq!(claims.session_id, session_id);
        assert_eq!(claims.iss, "streamarr");
    }

    #[test]
    fn token_signed_with_different_secret_is_rejected() {
        let issuer_a = JwtIssuer::new(
            b"secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "streamarr",
            Duration::minutes(15),
        );
        let issuer_b = JwtIssuer::new(
            b"secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "streamarr",
            Duration::minutes(15),
        );

        let token = issuer_a
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();

        assert!(issuer_b.verify_access_token(&token).is_err());
    }

    #[test]
    fn expired_token_is_rejected() {
        // `jsonwebtoken`'s default `Validation` applies a 60s leeway on
        // `exp`, so the TTL here has to be comfortably past that to
        // actually exercise expiry rejection rather than the leeway window.
        let issuer = JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "streamarr",
            Duration::seconds(-120),
        );
        let token = issuer
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();
        assert!(issuer.verify_access_token(&token).is_err());
    }
}
