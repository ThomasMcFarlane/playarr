use std::collections::HashSet;

use async_trait::async_trait;
use dashmap::DashMap;
use playarr_model::RefreshTokenRecord;
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{bool_from_i64, bool_to_i64, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// Storage boundary for [`RefreshTokenRecord`]s, keyed by `device_id` (a
/// device has at most one live token family at a time -- a fresh login
/// replaces whatever family it had). `playarr_auth::RefreshTokenService`
/// depends on this trait (re-exported from that crate under the same name
/// for backward compatibility -- see its `refresh` module), not on either
/// implementation directly.
#[async_trait]
pub trait RefreshTokenRepo: Send + Sync {
    async fn get(&self, device_id: Uuid) -> Result<Option<RefreshTokenRecord>, DbError>;
    async fn put(&self, record: RefreshTokenRecord) -> Result<(), DbError>;
}

/// An in-process, non-durable [`RefreshTokenRepo`] -- fine for tests, and
/// for anyone who genuinely wants "every restart forces a fresh login"
/// (nobody does, in practice; see [`SqlxRefreshTokenRepo`] for the real
/// default `playarr-bin` wires up).
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
impl RefreshTokenRepo for InMemoryRefreshTokenStore {
    async fn get(&self, device_id: Uuid) -> Result<Option<RefreshTokenRecord>, DbError> {
        Ok(self.records.get(&device_id).map(|entry| entry.clone()))
    }

    async fn put(&self, record: RefreshTokenRecord) -> Result<(), DbError> {
        self.records.insert(record.device_id, record);
        Ok(())
    }
}

/// The real, durable [`RefreshTokenRepo`] -- backs `refresh_token_families`
/// (see `backend/migrations/{sqlite,postgres}/*_refresh_token_families.sql`).
/// Closes a real gap `InMemoryRefreshTokenStore` left: since access tokens
/// are short-lived and nothing else re-issues one without a refresh token
/// to redeem, an in-memory-only store meant every process restart
/// eventually forced every logged-in client back through a full login,
/// even though its refresh token was still well within its own (much
/// longer) `refresh_ttl`.
pub struct SqlxRefreshTokenRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxRefreshTokenRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<RefreshTokenRecord, DbError> {
        let device_id: String = row.try_get("device_id")?;
        let user_id: String = row.try_get("user_id")?;
        let session_id: String = row.try_get("session_id")?;
        let family_id: String = row.try_get("family_id")?;
        let generation: i64 = row.try_get("generation")?;
        let current_hash: String = row.try_get("current_hash")?;
        let used_hashes: String = row.try_get("used_hashes")?;
        let issued_at: String = row.try_get("issued_at")?;
        let expires_at: String = row.try_get("expires_at")?;
        let rotated_at: Option<String> = row.try_get("rotated_at")?;
        let revoked: i64 = row.try_get("revoked")?;

        Ok(RefreshTokenRecord {
            device_id: parse_uuid(&device_id)?,
            user_id: parse_uuid(&user_id)?,
            session_id: parse_uuid(&session_id)?,
            family_id: parse_uuid(&family_id)?,
            // Always written from a non-negative `u64` (see `put` below),
            // so casting back is lossless for any value this repository
            // itself ever stored.
            generation: generation as u64,
            current_hash,
            used_hashes: serde_json::from_str::<HashSet<String>>(&used_hashes)?,
            issued_at: parse_datetime(&issued_at)?,
            expires_at: parse_datetime(&expires_at)?,
            rotated_at: rotated_at.map(|raw| parse_datetime(&raw)).transpose()?,
            revoked: bool_from_i64(revoked),
        })
    }
}

#[async_trait]
impl RefreshTokenRepo for SqlxRefreshTokenRepo {
    async fn get(&self, device_id: Uuid) -> Result<Option<RefreshTokenRecord>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT device_id, user_id, session_id, family_id, generation, current_hash, \
                 used_hashes, issued_at, expires_at, rotated_at, revoked \
                 FROM refresh_token_families WHERE device_id = ?"
            }
            Backend::Postgres => {
                "SELECT device_id, user_id, session_id, family_id, generation, current_hash, \
                 used_hashes, issued_at, expires_at, rotated_at, revoked \
                 FROM refresh_token_families WHERE device_id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(device_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn put(&self, record: RefreshTokenRecord) -> Result<(), DbError> {
        let used_hashes = serde_json::to_string(&record.used_hashes)?;

        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO refresh_token_families \
                 (device_id, user_id, session_id, family_id, generation, current_hash, \
                 used_hashes, issued_at, expires_at, rotated_at, revoked) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (device_id) DO UPDATE SET \
                 user_id = excluded.user_id, session_id = excluded.session_id, \
                 family_id = excluded.family_id, generation = excluded.generation, \
                 current_hash = excluded.current_hash, used_hashes = excluded.used_hashes, \
                 issued_at = excluded.issued_at, expires_at = excluded.expires_at, \
                 rotated_at = excluded.rotated_at, revoked = excluded.revoked"
            }
            Backend::Postgres => {
                "INSERT INTO refresh_token_families \
                 (device_id, user_id, session_id, family_id, generation, current_hash, \
                 used_hashes, issued_at, expires_at, rotated_at, revoked) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (device_id) DO UPDATE SET \
                 user_id = excluded.user_id, session_id = excluded.session_id, \
                 family_id = excluded.family_id, generation = excluded.generation, \
                 current_hash = excluded.current_hash, used_hashes = excluded.used_hashes, \
                 issued_at = excluded.issued_at, expires_at = excluded.expires_at, \
                 rotated_at = excluded.rotated_at, revoked = excluded.revoked"
            }
        };
        sqlx::query(sql)
            .bind(record.device_id.to_string())
            .bind(record.user_id.to_string())
            .bind(record.session_id.to_string())
            .bind(record.family_id.to_string())
            .bind(record.generation as i64)
            .bind(record.current_hash)
            .bind(used_hashes)
            .bind(format_datetime(record.issued_at))
            .bind(format_datetime(record.expires_at))
            .bind(record.rotated_at.map(format_datetime))
            .bind(bool_to_i64(record.revoked))
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_record(device_id: Uuid) -> RefreshTokenRecord {
        // Truncated to millisecond precision -- `format_datetime`/
        // `parse_datetime` round-trip at millisecond precision, same as
        // every other repo's own tests (e.g. `user.rs`'s
        // `created_at: Utc::now().trunc_subsecs(3)`), so constructing the
        // fixture with sub-millisecond precision would make an exact
        // equality check fail even on a correct implementation.
        let now = Utc::now().trunc_subsecs(3);
        RefreshTokenRecord {
            device_id,
            user_id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            family_id: Uuid::new_v4(),
            generation: 0,
            current_hash: "hash-0".to_string(),
            used_hashes: HashSet::from(["hash-0".to_string()]),
            issued_at: now,
            expires_at: now + chrono::Duration::days(30),
            rotated_at: None,
            revoked: false,
        }
    }

    #[tokio::test]
    async fn put_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRefreshTokenRepo::new(pool);
        let device_id = Uuid::new_v4();
        let record = sample_record(device_id);

        repo.put(record.clone()).await.expect("put");
        let fetched = repo.get(device_id).await.expect("get");

        assert_eq!(fetched, Some(record));
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRefreshTokenRepo::new(pool);
        let found = repo.get(Uuid::new_v4()).await.expect("get");
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn put_upserts_by_device_id_surviving_rotation() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRefreshTokenRepo::new(pool);
        let device_id = Uuid::new_v4();
        let mut record = sample_record(device_id);
        repo.put(record.clone()).await.unwrap();

        // A rotation: same device_id, new hash/generation.
        record.generation = 1;
        record.current_hash = "hash-1".to_string();
        record.used_hashes.insert("hash-1".to_string());
        record.rotated_at = Some(Utc::now().trunc_subsecs(3));
        repo.put(record.clone()).await.unwrap();

        let fetched = repo.get(device_id).await.unwrap();
        assert_eq!(fetched, Some(record));
    }

    #[tokio::test]
    async fn revoked_family_survives_round_trip() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRefreshTokenRepo::new(pool);
        let device_id = Uuid::new_v4();
        let mut record = sample_record(device_id);
        record.revoked = true;
        repo.put(record.clone()).await.unwrap();

        let fetched = repo.get(device_id).await.unwrap();
        assert_eq!(fetched, Some(record));
    }
}
