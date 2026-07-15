//! `streamarr-auth` — everything that decides "is this request allowed":
//! [`policy`] evaluation of a [`streamarr_model::Policy`] against an access
//! attempt, [`jwt`] access-token issuance/verification, and the
//! [`device_flow`] (RFC 8628) login path for TV-class clients.
//!
//! `streamarr_model::{User, Device, Policy}` themselves live in
//! `streamarr-model` (they're domain types other crates need to reference
//! without pulling in auth logic); this crate is where the *behavior* over
//! them lives.

pub mod device_flow;
pub mod jwt;
pub mod policy;

pub use device_flow::{
    DeviceAuthorization, DeviceAuthorizationStatus, DeviceCodeResponse, DeviceFlowError,
    DeviceFlowHandler, TokenError, TokenResponse,
};
pub use jwt::{AccessTokenClaims, JwtError, JwtIssuer};
pub use policy::{
    AccessContext, DefaultPolicyEvaluator, DenyReason, PolicyDecision, PolicyEvaluator,
};
