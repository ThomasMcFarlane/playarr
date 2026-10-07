//! Lenient serde helpers shared by the *arr DTOs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer};

/// An optional RFC 3339 timestamp that never fails the surrounding
/// document: absent, null, blank or unparseable values all become `None`,
/// so one odd `added` value cannot make a whole library list fail to sync.
pub(crate) fn lenient_datetime<'de, D>(deserializer: D) -> Result<Option<DateTime<Utc>>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .and_then(|raw| raw.trim().parse::<DateTime<Utc>>().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Probe {
        #[serde(default, deserialize_with = "lenient_datetime")]
        added: Option<DateTime<Utc>>,
    }

    fn parse(json: &str) -> Option<DateTime<Utc>> {
        serde_json::from_str::<Probe>(json)
            .expect("never fails")
            .added
    }

    #[test]
    fn parses_valid_missing_null_and_garbage() {
        assert_eq!(
            parse(r#"{"added":"2024-03-02T10:20:30Z"}"#),
            Some("2024-03-02T10:20:30Z".parse().unwrap())
        );
        assert_eq!(
            parse(r#"{"added":"2024-03-02T10:20:30.123456Z"}"#).map(|d| d.timestamp()),
            Some(1_709_374_830)
        );
        assert_eq!(parse("{}"), None);
        assert_eq!(parse(r#"{"added":null}"#), None);
        assert_eq!(parse(r#"{"added":""}"#), None);
        assert_eq!(parse(r#"{"added":"yesterday"}"#), None);
        assert_eq!(parse(r#"{"added":12}"#), None);
    }
}
