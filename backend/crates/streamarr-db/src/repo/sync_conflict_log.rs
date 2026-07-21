//! Generic conflict record for every last-writer-wins (LWW) resolution
//! across a peer group -- Phase 2 of `docs/architecture/peer-groups.md`
//! (see that document's §2.2 for the table itself and §3.5 for the full
//! conflict-resolution model this backs).
//!
//! The losing write of every LWW resolution across `users`/`policies`/
//! `source_instances`/`group_libraries`/`routing_rules` is never silently
//! discarded: it is written here instead, surfaced on a new admin "Sync
//! Conflicts" page (§3.6). `requires_admin_review` distinguishes plain LWW
//! (informational -- an admin can page through purely for visibility) from
//! a privilege-bearing-field conflict that was deliberately **not applied**
//! and needs a human decision (§3.5's privilege-escalation defense).
//!
//! [`SyncConflictLog`] does not (yet) have a home in `streamarr-model` --
//! `streamarr-model/src/group_library.rs` covers this phase's other new
//! types (`GroupLibrary`/`LeafSelector`/`PeerLeafAvailability`) but not this
//! one. Kept local to this module rather than added there, for the same
//! reason `crate::repo::peer_join_token::PeerJoinToken` gives in its own
//! doc comment: this change stays scoped to a single file while sibling
//! Phase 2 repos land in the same directory in parallel; promoting it to
//! `streamarr-model` is a natural follow-up for whichever pass wires this
//! repo into `mod.rs`/`AppState`.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{bool_from_i64, bool_to_i64, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// One losing write from an LWW conflict resolution -- column-for-column
/// mirror of the `sync_conflict_log` table
/// (`backend/migrations/{postgres/0036,sqlite/0033}_peer_sync_state.sql`).
#[derive(Debug, Clone, PartialEq)]
pub struct SyncConflictLog {
    pub id: Uuid,
    /// `"user" | "policy" | "source_instance" | "group_library" |
    /// "routing_rule"` (see the migration's own column comment). Kept a
    /// plain `String` rather than a closed Rust enum: the last of those
    /// values (`"routing_rule"`) has no corresponding domain type until
    /// Phase 3's `RoutingRule` lands (§2.4), and this repo must not grow a
    /// dependency on that phase.
    pub entity_type: String,
    /// The peer-local id of the entity in question (`User::id`,
    /// `Policy::id`, ...) -- always a `Uuid` in this codebase regardless of
    /// `entity_type`.
    pub entity_id: Uuid,
    pub winning_peer_id: Uuid,
    pub losing_peer_id: Uuid,
    /// The losing write's full value, JSON-encoded exactly as `entity_type`
    /// would serialize it. Heterogeneous across `entity_type`, so kept as
    /// the already-serialized `String` rather than a typed union -- the
    /// admin "Sync Conflicts" page renders it for a human, it never
    /// round-trips back into a strongly-typed apply.
    pub losing_value_json: String,
    pub detected_at: DateTime<Utc>,
    pub requires_admin_review: bool,
}

/// Durable record of every LWW conflict resolution across the peer group --
/// see this module's own doc comment and `docs/architecture/peer-groups.md`
/// §3.5.
#[async_trait]
pub trait SyncConflictLogRepo: Send + Sync {
    /// Insert-only: a conflict log row is a historical record of one
    /// specific resolution, never something later updated in place other
    /// than `mark_reviewed`.
    async fn create(&self, conflict: &SyncConflictLog) -> Result<(), DbError>;

    /// Every row with `requires_admin_review = true`, most recently
    /// detected first -- the admin "Sync Conflicts" page's read (§3.6).
    async fn list_requiring_review(&self) -> Result<Vec<SyncConflictLog>, DbError>;

    /// Marks one row `requires_admin_review = false`. Idempotent -- marking
    /// an already-reviewed row again still succeeds, since review is a
    /// one-way acknowledgement rather than a single-use redemption (no
    /// analog to `PeerJoinTokenRepo::consume`'s non-leaking race guard is
    /// needed here). `Err(DbError::NotFound)` if `id` doesn't exist,
    /// matching `SourceInstanceRepo::delete`'s contract for a single-row
    /// mutation by id.
    async fn mark_reviewed(&self, id: Uuid) -> Result<(), DbError>;
}

pub struct SqlxSyncConflictLogRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxSyncConflictLogRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

fn from_row(row: &AnyRow) -> Result<SyncConflictLog, DbError> {
    let id: String = row.try_get("id")?;
    let entity_type: String = row.try_get("entity_type")?;
    let entity_id: String = row.try_get("entity_id")?;
    let winning_peer_id: String = row.try_get("winning_peer_id")?;
    let losing_peer_id: String = row.try_get("losing_peer_id")?;
    let losing_value_json: String = row.try_get("losing_value_json")?;
    let detected_at: String = row.try_get("detected_at")?;
    let requires_admin_review: i64 = row.try_get("requires_admin_review")?;

    Ok(SyncConflictLog {
        id: parse_uuid(&id)?,
        entity_type,
        entity_id: parse_uuid(&entity_id)?,
        winning_peer_id: parse_uuid(&winning_peer_id)?,
        losing_peer_id: parse_uuid(&losing_peer_id)?,
        losing_value_json,
        detected_at: parse_datetime(&detected_at)?,
        requires_admin_review: bool_from_i64(requires_admin_review),
    })
}

const COLUMNS: &str = "id, entity_type, entity_id, winning_peer_id, losing_peer_id, \
                        losing_value_json, detected_at, requires_admin_review";

#[async_trait]
impl SyncConflictLogRepo for SqlxSyncConflictLogRepo {
    async fn create(&self, conflict: &SyncConflictLog) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                format!("INSERT INTO sync_conflict_log ({COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            }
            Backend::Postgres => format!(
                "INSERT INTO sync_conflict_log ({COLUMNS}) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
            ),
        };
        sqlx::query(&sql)
            .bind(conflict.id.to_string())
            .bind(conflict.entity_type.as_str())
            .bind(conflict.entity_id.to_string())
            .bind(conflict.winning_peer_id.to_string())
            .bind(conflict.losing_peer_id.to_string())
            .bind(conflict.losing_value_json.as_str())
            .bind(format_datetime(conflict.detected_at))
            .bind(bool_to_i64(conflict.requires_admin_review))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_requiring_review(&self) -> Result<Vec<SyncConflictLog>, DbError> {
        // Literal `1` rather than a bound param: not user input, same
        // convention as `peer_node::list_others`'s `is_self = 0`.
        let sql = format!(
            "SELECT {COLUMNS} FROM sync_conflict_log WHERE requires_admin_review = 1 \
             ORDER BY detected_at DESC"
        );
        let rows = sqlx::query(&sql).fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }

    async fn mark_reviewed(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE sync_conflict_log SET requires_admin_review = 0 WHERE id = ?"
            }
            Backend::Postgres => {
                "UPDATE sync_conflict_log SET requires_admin_review = 0 WHERE id = $1"
            }
        };
        let result = sqlx::query(sql)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, SubsecRound};

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_conflict(entity_type: &str, detected_at: DateTime<Utc>) -> SyncConflictLog {
        SyncConflictLog {
            id: Uuid::new_v4(),
            entity_type: entity_type.to_string(),
            entity_id: Uuid::new_v4(),
            winning_peer_id: Uuid::new_v4(),
            losing_peer_id: Uuid::new_v4(),
            losing_value_json: r#"{"display_name":"stale"}"#.to_string(),
            detected_at: detected_at.trunc_subsecs(3),
            requires_admin_review: true,
        }
    }

    #[tokio::test]
    async fn create_then_list_requiring_review_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSyncConflictLogRepo::new(pool);
        let conflict = sample_conflict("user", Utc::now());

        repo.create(&conflict).await.expect("create");
        let pending = repo.list_requiring_review().await.expect("list");

        assert_eq!(pending, vec![conflict]);
    }

    #[tokio::test]
    async fn list_requiring_review_excludes_already_reviewed_rows() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSyncConflictLogRepo::new(pool);
        let mut reviewed = sample_conflict("policy", Utc::now());
        reviewed.requires_admin_review = false;
        let pending = sample_conflict("policy", Utc::now());

        repo.create(&reviewed).await.unwrap();
        repo.create(&pending).await.unwrap();

        let result = repo.list_requiring_review().await.unwrap();
        assert_eq!(result, vec![pending]);
    }

    #[tokio::test]
    async fn list_requiring_review_orders_most_recently_detected_first() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSyncConflictLogRepo::new(pool);
        let now = Utc::now();
        let oldest = sample_conflict("source_instance", now - Duration::hours(2));
        let newest = sample_conflict("source_instance", now);
        let middle = sample_conflict("source_instance", now - Duration::hours(1));

        repo.create(&oldest).await.unwrap();
        repo.create(&newest).await.unwrap();
        repo.create(&middle).await.unwrap();

        let result = repo.list_requiring_review().await.unwrap();
        assert_eq!(
            result.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![newest.id, middle.id, oldest.id]
        );
    }

    #[tokio::test]
    async fn mark_reviewed_removes_row_from_the_review_queue() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSyncConflictLogRepo::new(pool);
        let conflict = sample_conflict("group_library", Utc::now());
        repo.create(&conflict).await.unwrap();

        repo.mark_reviewed(conflict.id).await.expect("mark_reviewed");

        assert!(repo.list_requiring_review().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn mark_reviewed_is_idempotent() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSyncConflictLogRepo::new(pool);
        let conflict = sample_conflict("routing_rule", Utc::now());
        repo.create(&conflict).await.unwrap();

        repo.mark_reviewed(conflict.id).await.unwrap();
        // Marking an already-reviewed row again still succeeds -- see the
        // trait method's own doc comment.
        repo.mark_reviewed(conflict.id).await.unwrap();
    }

    #[tokio::test]
    async fn mark_reviewed_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSyncConflictLogRepo::new(pool);

        let err = repo.mark_reviewed(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn list_requiring_review_empty_for_single_ungrouped_node() {
        // Phase 2 must be inert for a single, ungrouped node: with no rows
        // ever written (nothing runs conflict resolution without a peer),
        // the review queue is empty.
        let pool = test_sqlite_pool().await;
        let repo = SqlxSyncConflictLogRepo::new(pool);

        assert!(repo.list_requiring_review().await.unwrap().is_empty());
    }
}
