//! `streamarr-auth` — everything that decides "is this request allowed":
//! [`policy`] evaluation of a [`streamarr_model::Policy`] against an access
//! attempt, [`jwt`] access-token issuance/verification, [`login`]
//! resolution of the three trust tiers into a session, and the
//! [`device_flow`] (RFC 8628) login path for TV-class clients. [`admin`] is
//! a small, deliberately interim stand-in for real `Policy`-backed admin
//! resolution -- see its module doc comment for why it exists and what
//! replaces it.
//!
//! `streamarr_model::{User, Device, Policy}` themselves live in
//! `streamarr-model` (they're domain types other crates need to reference
//! without pulling in auth logic); this crate is where the *behavior* over
//! them lives.

pub mod admin;
pub mod device_flow;
pub mod jwt;
pub mod login;
pub mod policy;
pub mod refresh;
pub mod secret;
#[cfg(test)]
mod test_support;

pub use admin::InMemoryAdminRegistry;
pub use device_flow::{
    DashMapDeviceFlowHandler, DeviceAuthorization, DeviceAuthorizationStatus,
    DeviceAuthorizationStore, DeviceCodeResponse, DeviceFlowConfig, DeviceFlowError,
    DeviceFlowHandler, InMemoryDeviceAuthorizationStore, TokenError, TokenResponse,
};
pub use jwt::{AccessTokenClaims, JwtError, JwtIssuer};
pub use login::{
    evaluate_login, Argon2PasswordVerifier, AuthMode, Credentials, InMemoryUserDirectory,
    LoginContext, LoginError, LoginOutcome, PasswordVerifier, PinAttempt, TrustedNetwork,
    UserDirectory,
};
pub use policy::{
    AccessContext, DefaultPolicyEvaluator, DenyReason, PolicyDecision, PolicyEvaluator,
};
pub use refresh::{
    InMemoryRefreshTokenStore, RefreshError, RefreshTokenRecord, RefreshTokenService,
    RefreshTokenStore,
};
