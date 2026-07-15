//! [`Sensitive<T>`] — a newtype that stops secrets leaking into logs.
//!
//! Wrap API keys, password hashes, session/refresh tokens, and encrypted
//! blobs in `Sensitive<T>` wherever they live on a domain type. `Debug` and
//! `Display` always print the literal text `REDACTED`, regardless of the
//! wrapped value, so a stray `tracing::info!(?source_instance)` or `{:?}`
//! in a panic message can never exfiltrate a secret.
//!
//! `Serialize`/`Deserialize` are intentionally *not* redacted: the wrapper
//! is transparent on the wire (it round-trips exactly like the inner `T`)
//! because callers that legitimately need the value (the encryption-at-rest
//! layer, the outbound HTTP client attaching an API key) still need to get
//! it out. Redaction is a logging/Debug concern, not a serialization one —
//! don't rely on this type alone to keep secrets out of API responses;
//! callers must still choose not to serialize secret-bearing DTOs to
//! clients.

use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Default, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct Sensitive<T>(pub T);

impl<T> Sensitive<T> {
    pub fn new(value: T) -> Self {
        Self(value)
    }

    /// Explicit, greppable escape hatch for the (rare) places that need the
    /// real value — e.g. attaching an `Authorization` header before a
    /// request goes out. Named `expose_secret` rather than `as_ref` so a
    /// `grep -rn expose_secret` audit of the codebase finds every call site.
    pub fn expose_secret(&self) -> &T {
        &self.0
    }

    pub fn into_inner(self) -> T {
        self.0
    }
}

impl<T> From<T> for Sensitive<T> {
    fn from(value: T) -> Self {
        Self(value)
    }
}

impl<T> fmt::Debug for Sensitive<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("REDACTED")
    }
}

impl<T> fmt::Display for Sensitive<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("REDACTED")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_and_display_never_leak() {
        let secret = Sensitive::new("super-secret-api-key".to_string());
        assert_eq!(format!("{secret:?}"), "REDACTED");
        assert_eq!(format!("{secret}"), "REDACTED");
    }

    #[test]
    fn serialize_is_transparent() {
        let secret = Sensitive::new("super-secret-api-key".to_string());
        let json = serde_json::to_string(&secret).unwrap();
        assert_eq!(json, "\"super-secret-api-key\"");
    }
}
