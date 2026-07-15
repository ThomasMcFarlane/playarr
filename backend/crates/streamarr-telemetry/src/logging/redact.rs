//! Defense-in-depth log redaction. `streamarr_model::Sensitive<T>` is the
//! primary defense: any field built from a `Sensitive<T>` already prints
//! as `REDACTED` via its `Debug`/`Display` impls, before it ever reaches
//! this module. This exists for the secondary case — a raw string that
//! *contains* a secret (an `Authorization` header value, a URL with an
//! embedded API key) that a call site wants to log for diagnostic purposes
//! without leaking the secret itself.

use std::borrow::Cow;

/// Substrings (case-insensitive) that mark a field/header name as
/// secret-bearing. Deliberately broad (`"token"` catches both
/// `access_token` and `refresh_token`) — false positives here just mean an
/// extra redaction, false negatives mean a leaked secret, so the list
/// errs toward over-matching.
const SENSITIVE_FIELD_NAME_FRAGMENTS: &[&str] = &[
    "password",
    "api_key",
    "api-key",
    "apikey",
    "token",
    "secret",
    "authorization",
    "cookie",
];

/// Whether `name` looks like a secret-bearing field/header name.
pub fn is_sensitive_field_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SENSITIVE_FIELD_NAME_FRAGMENTS
        .iter()
        .any(|fragment| lower.contains(fragment))
}

/// Redacts `value` when `field_name` looks sensitive, otherwise returns it
/// unchanged (borrowed, so the common — non-sensitive — path allocates
/// nothing). Intended for call sites logging something whose *name* is
/// known ahead of time but whose value can't be wrapped in
/// `streamarr_model::Sensitive<T>` at the type level, e.g. because it's
/// borrowed from a third-party type like an HTTP `HeaderMap`.
pub fn redact_if_sensitive<'a>(field_name: &str, value: &'a str) -> Cow<'a, str> {
    if is_sensitive_field_name(field_name) {
        Cow::Borrowed("REDACTED")
    } else {
        Cow::Borrowed(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_common_secret_field_names() {
        for name in [
            "password",
            "api_key",
            "apiKey",
            "X-Api-Key",
            "Authorization",
            "refresh_token",
            "access_token",
            "cookie",
        ] {
            assert!(is_sensitive_field_name(name), "{name} should be sensitive");
        }
    }

    #[test]
    fn does_not_flag_ordinary_field_names() {
        for name in ["title", "user_id", "device_id", "path", "container"] {
            assert!(
                !is_sensitive_field_name(name),
                "{name} should not be sensitive"
            );
        }
    }

    #[test]
    fn redacts_matching_field_leaves_others_untouched() {
        assert_eq!(redact_if_sensitive("api_key", "sk-abc123"), "REDACTED");
        assert_eq!(redact_if_sensitive("title", "Sample Movie Kilo"), "Sample Movie Kilo");
    }
}
