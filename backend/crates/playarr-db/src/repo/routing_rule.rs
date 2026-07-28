//! Routing rule registry -- Phase 3 of `docs/architecture/peer-groups.md`
//! (see that document's §2.4 for the table itself and §5.2 for how a rule
//! is selected and evaluated).
//!
//! A [`playarr_model::RoutingRule`] is the operator-configured policy
//! deciding, for a given (`GroupLibrary`, user) pair, which peer(s) should
//! serve a stream and how. This repository is deliberately a thin CRUD
//! surface only: it does **not** pick "the" matching rule for a request.
//! Selecting the most specific match among several candidates
//! (`(group_library_id, user_id) > (user_id, None) > (group_library_id,
//! None) > none`, per §5.2 step 1) is pure decision logic with no I/O of
//! its own, so it belongs in `playarr-api/src/routing.rs` (a later
//! stage), the same way `playarr-auth::policy::DefaultPolicyEvaluator`
//! is pure judgment logic over an already-fetched
//! [`playarr_model::Policy`] rather than something `PolicyRepo` itself
//! does, and the same way `GroupLibraryRepo`/`PeerNodeRepo` hand back a
//! plain, simply-ordered list rather than pre-filtering in SQL.
//! [`RoutingRuleRepo::list_for_group`] returns every rule in priority order
//! (highest `priority` first -- see `playarr_model::routing`'s own doc
//! comment on the field) so that caller can do the specificity selection in
//! Rust, using `priority` only as the final tiebreak among equally-specific
//! matches, exactly as §5.2 step 1 specifies.
//!
//! A single, ungrouped node -- or a grouped node with no routing rules ever
//! created -- gets an empty list back from every method here: this table is
//! never read on the `ServeLocally` fallback path (§5.2), so it is
//! byte-for-byte inert until an operator actually creates a rule.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use playarr_model::{DeliveryMode, RoutingRule};
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

fn delivery_mode_to_str(mode: DeliveryMode) -> &'static str {
    match mode {
        DeliveryMode::Auto => "auto",
        DeliveryMode::Redirect => "redirect",
        DeliveryMode::Proxy => "proxy",
    }
}

fn delivery_mode_from_str(raw: &str) -> Result<DeliveryMode, DbError> {
    match raw {
        "auto" => Ok(DeliveryMode::Auto),
        "redirect" => Ok(DeliveryMode::Redirect),
        "proxy" => Ok(DeliveryMode::Proxy),
        other => Err(decode_err(format!("unknown delivery mode {other:?}"))),
    }
}

fn from_row(row: &AnyRow) -> Result<RoutingRule, DbError> {
    let id: String = row.try_get("id")?;
    let group_id: String = row.try_get("group_id")?;
    let group_library_id: Option<String> = row.try_get("group_library_id")?;
    let user_id: Option<String> = row.try_get("user_id")?;
    let priority: i32 = row.try_get("priority")?;
    let preferred_nodes: String = row.try_get("preferred_nodes")?;
    let delivery_mode: String = row.try_get("delivery_mode")?;
    let created_at: String = row.try_get("created_at")?;
    let updated_at: String = row.try_get("updated_at")?;

    Ok(RoutingRule {
        id: parse_uuid(&id)?,
        group_id: parse_uuid(&group_id)?,
        group_library_id: group_library_id.as_deref().map(parse_uuid).transpose()?,
        user_id: user_id.as_deref().map(parse_uuid).transpose()?,
        priority,
        preferred_nodes: serde_json::from_str::<Vec<Uuid>>(&preferred_nodes)?,
        delivery_mode: delivery_mode_from_str(&delivery_mode)?,
        created_at: parse_datetime(&created_at)?,
        updated_at: parse_datetime(&updated_at)?,
    })
}

const COLUMNS: &str = "id, group_id, group_library_id, user_id, priority, preferred_nodes, \
                        delivery_mode, created_at, updated_at";

/// Durable CRUD surface over [`RoutingRule`] -- see this module's own doc
/// comment for why "pick the most specific match" is deliberately not a
/// method here. See `docs/architecture/peer-groups.md` §2.4.
#[async_trait]
pub trait RoutingRuleRepo: Send + Sync {
    /// Inserts a brand new row. Fails (via the backend's own PRIMARY KEY
    /// violation, surfaced as `DbError::Backend`) if `rule.id` already
    /// exists -- callers that already have a specific row and want to
    /// change it use [`RoutingRuleRepo::update`] instead.
    async fn create(&self, rule: &RoutingRule) -> Result<(), DbError>;

    async fn get(&self, id: Uuid) -> Result<Option<RoutingRule>, DbError>;

    /// Full-row update by `RoutingRule::id`. Returns `DbError::NotFound` if
    /// no row with that id exists.
    async fn update(&self, rule: &RoutingRule) -> Result<(), DbError>;

    /// Hard delete by id (unlike `users`/`policies`/`source_instances`,
    /// `routing_rules` has no `deleted_at` column to tombstone -- see
    /// `0039_routing_rules.sql`/`0036_routing_rules.sql`'s own schema).
    /// Returns `DbError::NotFound` if no row with that id exists.
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    /// Every `RoutingRule` in one group, ordered by `priority` descending
    /// (highest `priority` first -- ties broken by `id` only for
    /// deterministic test/pagination ordering, not a documented part of
    /// §5.2's resolution order itself). See this module's own doc comment
    /// for why specificity selection is left to the caller.
    async fn list_for_group(&self, group_id: Uuid) -> Result<Vec<RoutingRule>, DbError>;

    /// Every `RoutingRule` in `group_id` whose `updated_at` is strictly
    /// greater than `since` (every row, oldest first, when `since` is
    /// `None`) -- the read behind the `routing_rules` sync entity
    /// (`peer_sync_state.entity = 'routing_rules'`, §3.6). No `deleted_at`
    /// filtering concern, same as `GroupLibraryRepo::list_updated_since`.
    async fn list_updated_since(
        &self,
        group_id: Uuid,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<RoutingRule>, DbError>;
}

pub struct SqlxRoutingRuleRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxRoutingRuleRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl RoutingRuleRepo for SqlxRoutingRuleRepo {
    async fn create(&self, rule: &RoutingRule) -> Result<(), DbError> {
        let preferred_nodes = serde_json::to_string(&rule.preferred_nodes)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO routing_rules \
                 (id, group_id, group_library_id, user_id, priority, preferred_nodes, \
                 delivery_mode, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO routing_rules \
                 (id, group_id, group_library_id, user_id, priority, preferred_nodes, \
                 delivery_mode, created_at, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
            }
        };
        sqlx::query(sql)
            .bind(rule.id.to_string())
            .bind(rule.group_id.to_string())
            .bind(rule.group_library_id.map(|id| id.to_string()))
            .bind(rule.user_id.map(|id| id.to_string()))
            .bind(rule.priority)
            .bind(preferred_nodes)
            .bind(delivery_mode_to_str(rule.delivery_mode))
            .bind(format_datetime(rule.created_at))
            .bind(format_datetime(rule.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get(&self, id: Uuid) -> Result<Option<RoutingRule>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!("SELECT {COLUMNS} FROM routing_rules WHERE id = ?"),
            Backend::Postgres => format!("SELECT {COLUMNS} FROM routing_rules WHERE id = $1"),
        };
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn update(&self, rule: &RoutingRule) -> Result<(), DbError> {
        let preferred_nodes = serde_json::to_string(&rule.preferred_nodes)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE routing_rules SET group_id = ?, group_library_id = ?, user_id = ?, \
                 priority = ?, preferred_nodes = ?, delivery_mode = ?, updated_at = ? \
                 WHERE id = ?"
            }
            Backend::Postgres => {
                "UPDATE routing_rules SET group_id = $1, group_library_id = $2, user_id = $3, \
                 priority = $4, preferred_nodes = $5, delivery_mode = $6, updated_at = $7 \
                 WHERE id = $8"
            }
        };
        let result = sqlx::query(sql)
            .bind(rule.group_id.to_string())
            .bind(rule.group_library_id.map(|id| id.to_string()))
            .bind(rule.user_id.map(|id| id.to_string()))
            .bind(rule.priority)
            .bind(preferred_nodes)
            .bind(delivery_mode_to_str(rule.delivery_mode))
            .bind(format_datetime(rule.updated_at))
            .bind(rule.id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM routing_rules WHERE id = ?",
            Backend::Postgres => "DELETE FROM routing_rules WHERE id = $1",
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

    async fn list_for_group(&self, group_id: Uuid) -> Result<Vec<RoutingRule>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM routing_rules WHERE group_id = ? \
                 ORDER BY priority DESC, id ASC"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM routing_rules WHERE group_id = $1 \
                 ORDER BY priority DESC, id ASC"
            ),
        };
        let rows = sqlx::query(&sql)
            .bind(group_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(from_row).collect()
    }

    async fn list_updated_since(
        &self,
        group_id: Uuid,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<RoutingRule>, DbError> {
        let sql = match (self.backend, since.is_some()) {
            (Backend::Sqlite, true) => format!(
                "SELECT {COLUMNS} FROM routing_rules WHERE group_id = ? AND updated_at > ? \
                 ORDER BY updated_at ASC, id ASC"
            ),
            (Backend::Sqlite, false) => format!(
                "SELECT {COLUMNS} FROM routing_rules WHERE group_id = ? \
                 ORDER BY updated_at ASC, id ASC"
            ),
            (Backend::Postgres, true) => format!(
                "SELECT {COLUMNS} FROM routing_rules WHERE group_id = $1 AND updated_at > $2 \
                 ORDER BY updated_at ASC, id ASC"
            ),
            (Backend::Postgres, false) => format!(
                "SELECT {COLUMNS} FROM routing_rules WHERE group_id = $1 \
                 ORDER BY updated_at ASC, id ASC"
            ),
        };
        let mut query = sqlx::query(&sql).bind(group_id.to_string());
        if let Some(since) = since {
            query = query.bind(format_datetime(since));
        }
        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::SubsecRound;

    use super::*;
    use crate::pool::test_sqlite_pool;

    /// `routing_rules.group_id` has a `REFERENCES peer_groups (id)` foreign
    /// key (see `0036_routing_rules.sql`), so every test needs a real
    /// `peer_groups` row first -- same bypass-the-sibling-repo pattern
    /// `peer_node.rs`/`group_library.rs`'s own tests use for the identical
    /// foreign key.
    async fn seed_group(pool: &DbPool) -> Uuid {
        let group_id = Uuid::new_v4();
        sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)")
            .bind(group_id.to_string())
            .bind("test group")
            .bind(format_datetime(Utc::now()))
            .execute(pool)
            .await
            .expect("seed peer_groups row");
        group_id
    }

    fn sample_rule(group_id: Uuid) -> RoutingRule {
        let now = Utc::now().trunc_subsecs(3);
        RoutingRule {
            id: Uuid::new_v4(),
            group_id,
            group_library_id: None,
            user_id: None,
            priority: 0,
            preferred_nodes: vec![Uuid::new_v4(), Uuid::new_v4()],
            delivery_mode: DeliveryMode::Auto,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn create_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let rule = sample_rule(group_id);

        repo.create(&rule).await.expect("create");
        let fetched = repo.get(rule.id).await.expect("get").expect("present");

        assert_eq!(fetched, rule);
    }

    #[tokio::test]
    async fn create_duplicate_id_fails() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let rule = sample_rule(group_id);

        repo.create(&rule).await.expect("first create");
        let err = repo
            .create(&rule)
            .await
            .expect_err("duplicate id must fail");
        assert!(matches!(err, DbError::Backend(_)));
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRoutingRuleRepo::new(pool);

        assert!(repo.get(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn all_delivery_modes_round_trip() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);

        for mode in [
            DeliveryMode::Auto,
            DeliveryMode::Redirect,
            DeliveryMode::Proxy,
        ] {
            let mut rule = sample_rule(group_id);
            rule.delivery_mode = mode;
            repo.create(&rule).await.unwrap();
            let fetched = repo.get(rule.id).await.unwrap().unwrap();
            assert_eq!(fetched.delivery_mode, mode);
        }
    }

    #[tokio::test]
    async fn group_library_id_and_user_id_round_trip_when_set() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let mut rule = sample_rule(group_id);
        rule.group_library_id = Some(Uuid::new_v4());
        rule.user_id = Some(Uuid::new_v4());

        repo.create(&rule).await.unwrap();
        let fetched = repo.get(rule.id).await.unwrap().unwrap();

        assert_eq!(fetched, rule);
    }

    #[tokio::test]
    async fn update_changes_an_existing_row() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let mut rule = sample_rule(group_id);
        repo.create(&rule).await.unwrap();

        rule.priority = 42;
        rule.delivery_mode = DeliveryMode::Redirect;
        rule.user_id = Some(Uuid::new_v4());
        rule.preferred_nodes = vec![Uuid::new_v4()];
        rule.updated_at = Utc::now().trunc_subsecs(3);
        repo.update(&rule).await.unwrap();

        let fetched = repo.get(rule.id).await.unwrap().unwrap();
        assert_eq!(fetched, rule);
    }

    #[tokio::test]
    async fn update_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let rule = sample_rule(group_id);

        let err = repo.update(&rule).await.expect_err("missing row must fail");
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let rule = sample_rule(group_id);
        repo.create(&rule).await.unwrap();

        repo.delete(rule.id).await.unwrap();

        assert!(repo.get(rule.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxRoutingRuleRepo::new(pool);

        let err = repo
            .delete(Uuid::new_v4())
            .await
            .expect_err("missing row must fail");
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn list_for_group_orders_by_priority_descending() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let mut low = sample_rule(group_id);
        low.priority = 1;
        let mut high = sample_rule(group_id);
        high.priority = 10;
        let mut mid = sample_rule(group_id);
        mid.priority = 5;

        repo.create(&low).await.unwrap();
        repo.create(&high).await.unwrap();
        repo.create(&mid).await.unwrap();

        let all = repo.list_for_group(group_id).await.unwrap();
        assert_eq!(
            all.iter().map(|r| r.priority).collect::<Vec<_>>(),
            vec![10, 5, 1]
        );
    }

    #[tokio::test]
    async fn list_for_group_excludes_other_groups() {
        let pool = test_sqlite_pool().await;
        let group_a = seed_group(&pool).await;
        let group_b = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let rule_a = sample_rule(group_a);
        let rule_b = sample_rule(group_b);

        repo.create(&rule_a).await.unwrap();
        repo.create(&rule_b).await.unwrap();

        let fetched = repo.list_for_group(group_a).await.unwrap();
        assert_eq!(fetched, vec![rule_a]);
    }

    #[tokio::test]
    async fn list_for_group_empty_for_single_ungrouped_node() {
        // Phase 3 must be byte-for-byte inert for a single, ungrouped node
        // (and for a grouped node with no routing rules ever created): with
        // no `RoutingRule` ever created, the list stays empty, so §5.2's
        // resolution always falls through to `RoutingDecision::ServeLocally`
        // -- today's exact existing behavior.
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);

        assert!(repo.list_for_group(group_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn list_updated_since_none_returns_every_row_in_the_group() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let a = sample_rule(group_id);
        let b = sample_rule(group_id);
        repo.create(&a).await.unwrap();
        repo.create(&b).await.unwrap();

        let rows = repo.list_updated_since(group_id, None).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
        assert!(ids.contains(&a.id));
        assert!(ids.contains(&b.id));
    }

    #[tokio::test]
    async fn list_updated_since_excludes_other_groups() {
        let pool = test_sqlite_pool().await;
        let group_a = seed_group(&pool).await;
        let group_b = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let rule_a = sample_rule(group_a);
        let rule_b = sample_rule(group_b);
        repo.create(&rule_a).await.unwrap();
        repo.create(&rule_b).await.unwrap();

        let fetched = repo.list_updated_since(group_a, None).await.unwrap();
        assert_eq!(fetched, vec![rule_a]);
    }

    #[tokio::test]
    async fn list_updated_since_a_cursor_excludes_rows_at_or_before_it() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let now = Utc::now().trunc_subsecs(3);
        let mut old = sample_rule(group_id);
        old.updated_at = now - chrono::Duration::minutes(10);
        repo.create(&old).await.unwrap();
        let cursor = old.updated_at;

        let mut fresh = sample_rule(group_id);
        fresh.updated_at = now;
        repo.create(&fresh).await.unwrap();

        let rows = repo
            .list_updated_since(group_id, Some(cursor))
            .await
            .unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
        assert!(
            !ids.contains(&old.id),
            "a row at or before the cursor must not be re-reported"
        );
        assert!(ids.contains(&fresh.id));
    }

    #[tokio::test]
    async fn list_updated_since_orders_oldest_first() {
        let pool = test_sqlite_pool().await;
        let group_id = seed_group(&pool).await;
        let repo = SqlxRoutingRuleRepo::new(pool);
        let now = Utc::now().trunc_subsecs(3);
        let mut older = sample_rule(group_id);
        older.updated_at = now - chrono::Duration::minutes(10);
        let mut newer = sample_rule(group_id);
        newer.updated_at = now;
        repo.create(&newer).await.unwrap();
        repo.create(&older).await.unwrap();

        let rows = repo.list_updated_since(group_id, None).await.unwrap();
        let position = |id: Uuid| rows.iter().position(|r| r.id == id).unwrap();
        assert!(position(older.id) < position(newer.id));
    }
}
