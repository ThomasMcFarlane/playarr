//! String/JSON encodings for the domain identifiers/enums that `sqlx::Any`
//! cannot encode/decode natively.
//!
//! `playarr_db::DbPool` is `sqlx::AnyPool`, and the `Any` driver's own
//! type system only has `Encode`/`Decode` impls for
//! `bool`/`i16`/`i32`/`i64`/`f32`/`f64`/`String`/`&str`/`Vec<u8>`/`&[u8]` —
//! there is no `Uuid` or `chrono` support at the `Any` layer, and (contrary
//! to what a `BOOLEAN`-declared SQLite column might suggest) no reliable
//! `bool` support either: SQLite's per-*value* storage classes are only
//! Null/Integer/Real/Text/Blob, so `Any` maps a `BOOLEAN`-declared column's
//! actual value to `AnyValueKind::BigInt`, not `::Bool`, and decoding it as
//! `bool` fails with a type mismatch at runtime. Every boolean-shaped column
//! this crate reads/writes is therefore encoded as `i64` (0/1) instead —
//! this mirrors (independently derived, `playarr_db::codec` is private to
//! that crate) the same convention `playarr-db` uses for its own tables.
//!
//! `playarr-catalog` only ever *reads* the shared `works`/
//! `work_external_refs` tables through `playarr_db::WorkRepo` in
//! production, so in normal builds only the decode ("from") direction of
//! these helpers is reachable; the encode ("to") direction exists for the
//! `#[cfg(test)]` `WorkRepo` double in `lib.rs`'s test module, which seeds
//! rows directly since `playarr-db`'s own `SqlxWorkRepo` is still
//! `unimplemented!()`.

use chrono::{DateTime, NaiveDate, Utc};
use playarr_model::{Availability, ExternalProvider, WorkKind};
use uuid::Uuid;

use crate::CatalogError;

fn decode_err(msg: impl Into<String>) -> CatalogError {
    CatalogError::Data(msg.into())
}

pub(crate) fn parse_uuid(raw: &str) -> Result<Uuid, CatalogError> {
    Uuid::parse_str(raw).map_err(|e| decode_err(format!("invalid uuid {raw:?}: {e}")))
}

#[allow(dead_code)] // encode direction: only used by the `#[cfg(test)]` WorkRepo double
pub(crate) fn format_datetime(at: DateTime<Utc>) -> String {
    at.to_rfc3339()
}

#[allow(dead_code)] // not currently needed by production read paths; kept for symmetry/tests
pub(crate) fn parse_datetime(raw: &str) -> Result<DateTime<Utc>, CatalogError> {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| decode_err(format!("invalid timestamp {raw:?}: {e}")))
}

#[allow(dead_code)] // encode direction: only used by the `#[cfg(test)]` seed helpers
pub(crate) fn format_date(day: NaiveDate) -> String {
    day.format("%Y-%m-%d").to_string()
}

pub(crate) fn parse_date(raw: &str) -> Result<NaiveDate, CatalogError> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|e| decode_err(format!("invalid date {raw:?}: {e}")))
}

#[allow(dead_code)] // encode direction: only used by the `#[cfg(test)]` WorkRepo double
pub(crate) fn work_kind_to_str(kind: WorkKind) -> &'static str {
    match kind {
        WorkKind::Movie => "movie",
        WorkKind::Series => "series",
        WorkKind::Site => "site",
        WorkKind::Artist => "artist",
        WorkKind::Author => "author",
    }
}

#[allow(dead_code)] // only used by the `#[cfg(test)]` WorkRepo double (production gets a
                    // typed `WorkKind` back from `WorkRepo` directly)
pub(crate) fn work_kind_from_str(raw: &str) -> Result<WorkKind, CatalogError> {
    match raw {
        "movie" => Ok(WorkKind::Movie),
        "series" => Ok(WorkKind::Series),
        "site" => Ok(WorkKind::Site),
        "artist" => Ok(WorkKind::Artist),
        "author" => Ok(WorkKind::Author),
        other => Err(decode_err(format!("unknown work kind {other:?}"))),
    }
}

#[allow(dead_code)] // encode direction: only used by the `#[cfg(test)]` seed helpers
pub(crate) fn availability_to_str(availability: Availability) -> &'static str {
    match availability {
        Availability::Unknown => "unknown",
        Availability::Pending => "pending",
        Availability::Processing => "processing",
        Availability::PartiallyAvailable => "partially_available",
        Availability::Available => "available",
        Availability::Deleted => "deleted",
    }
}

pub(crate) fn availability_from_str(raw: &str) -> Result<Availability, CatalogError> {
    match raw {
        "unknown" => Ok(Availability::Unknown),
        "pending" => Ok(Availability::Pending),
        "processing" => Ok(Availability::Processing),
        "partially_available" => Ok(Availability::PartiallyAvailable),
        "available" => Ok(Availability::Available),
        "deleted" => Ok(Availability::Deleted),
        other => Err(decode_err(format!("unknown availability {other:?}"))),
    }
}

/// `ExternalProvider` round-trips through a single TEXT column: the closed
/// variants use their own snake_case name, and `Other(label)` is prefixed
/// (`"other:<label>"`) rather than needing a second nullable column. Matches
/// `playarr_db::codec`'s (private, so not reusable directly) convention
/// for the same `work_external_refs.provider` column.
#[allow(dead_code)] // encode direction: only used by the `#[cfg(test)]` WorkRepo double
pub(crate) fn provider_to_str(provider: &ExternalProvider) -> String {
    match provider {
        ExternalProvider::Tmdb => "tmdb".to_string(),
        ExternalProvider::Tvdb => "tvdb".to_string(),
        ExternalProvider::Imdb => "imdb".to_string(),
        ExternalProvider::MusicBrainzArtist => "music_brainz_artist".to_string(),
        ExternalProvider::MusicBrainzReleaseGroup => "music_brainz_release_group".to_string(),
        ExternalProvider::Goodreads => "goodreads".to_string(),
        ExternalProvider::Isbn => "isbn".to_string(),
        ExternalProvider::Asin => "asin".to_string(),
        ExternalProvider::Tpdb => "tpdb".to_string(),
        ExternalProvider::Other(label) => format!("other:{label}"),
    }
}

#[allow(dead_code)] // only used by the `#[cfg(test)]` WorkRepo double
pub(crate) fn provider_from_str(raw: &str) -> ExternalProvider {
    match raw {
        "tmdb" => ExternalProvider::Tmdb,
        "tvdb" => ExternalProvider::Tvdb,
        "imdb" => ExternalProvider::Imdb,
        "music_brainz_artist" => ExternalProvider::MusicBrainzArtist,
        "music_brainz_release_group" => ExternalProvider::MusicBrainzReleaseGroup,
        "goodreads" => ExternalProvider::Goodreads,
        "isbn" => ExternalProvider::Isbn,
        "asin" => ExternalProvider::Asin,
        "tpdb" => ExternalProvider::Tpdb,
        other => ExternalProvider::Other(other.strip_prefix("other:").unwrap_or(other).to_string()),
    }
}
