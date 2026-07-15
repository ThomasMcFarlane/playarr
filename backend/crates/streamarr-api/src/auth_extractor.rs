//! Bearer-JWT authentication: [`AuthUser`] verifies `Authorization: Bearer
//! <token>` against `AppState::jwt` (the same `streamarr_auth::JwtIssuer`
//! the RFC 8628 device flow, and `POST /api/v1/auth/login`, already issue
//! tokens through) and exposes the verified claims to any handler that
//! takes it as a parameter; [`AdminUser`] additionally requires the
//! caller's `sub` to resolve as an admin via `AppState::admin_registry`
//! (see `streamarr_auth::admin`'s doc comment for exactly what "admin"
//! means in this pass -- a deliberately interim mechanism, not a
//! permanent design).
//!
//! Both are real Axum extractors (`FromRequestParts`), not middleware --
//! any handler opts in simply by taking one as a parameter, the same way it
//! already takes `State`/`Path`/`Query`. A missing/malformed/invalid/expired
//! token rejects with a real 401 before the handler body ever runs; a valid
//! token from a non-admin user rejects `AdminUser` (but not `AuthUser`)
//! with a real 403.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use streamarr_auth::AccessTokenClaims;
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

fn unauthorized(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
}

fn bearer_token(parts: &Parts) -> Result<&str, ApiError> {
    let header_value = parts
        .headers
        .get(header::AUTHORIZATION)
        .ok_or_else(|| unauthorized("missing Authorization header"))?;
    let raw = header_value
        .to_str()
        .map_err(|_| unauthorized("Authorization header is not valid UTF-8"))?;
    raw.strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| unauthorized("Authorization header must be `Bearer <token>`"))
}

/// A request whose `Authorization: Bearer <token>` header verified
/// successfully. `user_id` is `claims.sub` pulled out to a named field
/// since that's what every handler that uses this extractor actually
/// wants; the full `claims` are still available for handlers that need
/// `device_id`/`session_id` too.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub claims: AccessTokenClaims,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts)?;
        let claims = state
            .jwt
            .verify_access_token(token)
            .map_err(|_| unauthorized("invalid or expired access token"))?;
        Ok(AuthUser {
            user_id: claims.sub,
            claims,
        })
    }
}

/// [`AuthUser`] plus proof the caller is an admin -- see the module doc
/// comment. Exposes `AuthUser`'s fields via [`std::ops::Deref`] so a
/// handler that took `AdminUser` can still just write `admin.user_id`.
#[derive(Debug, Clone)]
pub struct AdminUser(pub AuthUser);

impl std::ops::Deref for AdminUser {
    type Target = AuthUser;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        if state.admin_registry.is_admin(user.user_id) {
            Ok(AdminUser(user))
        } else {
            Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "forbidden",
                "caller is not an admin",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn parts_with_auth_header(value: Option<&str>) -> Parts {
        let mut request = axum::http::Request::builder().uri("/").body(()).unwrap();
        if let Some(value) = value {
            request
                .headers_mut()
                .insert(header::AUTHORIZATION, HeaderValue::from_str(value).unwrap());
        }
        let (parts, _) = request.into_parts();
        parts
    }

    #[test]
    fn bearer_token_rejects_missing_header() {
        let parts = parts_with_auth_header(None);
        assert!(bearer_token(&parts).is_err());
    }

    #[test]
    fn bearer_token_rejects_non_bearer_scheme() {
        let parts = parts_with_auth_header(Some("Basic dXNlcjpwYXNz"));
        assert!(bearer_token(&parts).is_err());
    }

    #[test]
    fn bearer_token_rejects_empty_token() {
        let parts = parts_with_auth_header(Some("Bearer "));
        assert!(bearer_token(&parts).is_err());
    }

    #[test]
    fn bearer_token_extracts_the_token() {
        let parts = parts_with_auth_header(Some("Bearer abc.def.ghi"));
        assert_eq!(bearer_token(&parts).unwrap(), "abc.def.ghi");
    }
}
