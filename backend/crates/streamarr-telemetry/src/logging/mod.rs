//! Structured JSON logging: [`subscriber`] builds the actual
//! `tracing-subscriber` layer, [`redact`] holds the defense-in-depth
//! secret-redaction helpers used at call sites that can't lean on
//! `streamarr_model::Sensitive<T>` alone.

pub mod redact;
pub mod subscriber;

pub use subscriber::{build_fmt_layer, LoggingGuard};
