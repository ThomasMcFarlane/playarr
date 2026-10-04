//! Storage for Home rails: admin-managed rail definitions
//! ([`HomeRailRepo`]) and per-user hide/reorder overrides. Also seeds the
//! default rails per library at boot.

use async_trait::async_trait;
use playarr_model::home_rail::{default_rail_id, default_rail_kinds, DEFAULT_RAIL_LIBRARIES};
use playarr_model::{HomeRail, HomeRailConfig, HomeRailKind, UserRailPref, WorkKind};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    bool_from_i64, bool_to_i64, decode_err, format_datetime, parse_datetime, parse_uuid,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

#[async_trait]
pub trait HomeRailRepo: Send + Sync {
    /// Every rail, ordered by `position` then `created_at`.
    async fn list(&self) -> Result<Vec<HomeRail>, DbError>;
    async fn get(&self, id: Uuid) -> Result<HomeRail, DbError>;
    async fn upsert(&self, rail: &HomeRail) -> Result<(), DbError>;
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;
    /// Sets `position` to each id's index; ids not listed keep their
    /// relative order after the listed ones.
    async fn reorder(&self, ordered_ids: &[Uuid]) -> Result<(), DbError>;
    /// Detaches custom rails from a deleted view.
    async fn delete_for_view(&self, view_id: Uuid) -> Result<(), DbError>;

    async fn user_prefs(&self, user_id: Uuid) -> Result<Vec<UserRailPref>, DbError>;
    /// Replaces the user's overrides wholesale.
    async fn set_user_prefs(&self, user_id: Uuid, prefs: &[UserRailPref]) -> Result<(), DbError>;
}

pub struct SqlxHomeRailRepo {
    pool: DbPool,
    backend: Backend,
}

const COLUMNS: &str =
    "id, kind, library, name, view_id, enabled, position, config, is_default, created_at, updated_at";

fn library_to_str(kind: WorkKind) -> &'static str {
    match kind {
        WorkKind::Movie => "movie",
        WorkKind::Series => "series",
        WorkKind::Artist => "artist",
        WorkKind::Site => "site",
        WorkKind::Author => "author",
        #[allow(unreachable_patterns)]
        _ => "movie",
    }
}

fn library_from_str(raw: &str) -> Option<WorkKind> {
    Some(match raw {
        "movie" => WorkKind::Movie,
        "series" => WorkKind::Series,
        "artist" => WorkKind::Artist,
        "site" => WorkKind::Site,
        "author" => WorkKind::Author,
        _ => return None,
    })
}

impl SqlxHomeRailRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn ph(&self, n: usize) -> String {
        match self.backend {
            Backend::Sqlite => "?".to_string(),
            Backend::Postgres => format!("${n}"),
        }
    }

    fn from_row(row: &AnyRow) -> Result<HomeRail, DbError> {
        let kind: String = row.try_get("kind")?;
        let library: Option<String> = row.try_get("library")?;
        let view_id: Option<String> = row.try_get("view_id")?;
        let config: String = row.try_get("config")?;
        Ok(HomeRail {
            id: parse_uuid(&row.try_get::<String, _>("id")?)?,
            kind: HomeRailKind::parse(&kind)
                .ok_or_else(|| decode_err(format!("unknown home rail kind '{kind}'")))?,
            library: library.as_deref().and_then(library_from_str),
            name: row.try_get("name")?,
            view_id: view_id.as_deref().map(parse_uuid).transpose()?,
            enabled: bool_from_i64(row.try_get("enabled")?),
            position: row.try_get::<i32, _>("position")?,
            config: serde_json::from_str::<HomeRailConfig>(&config)
                .map_err(|e| decode_err(format!("invalid home rail config json: {e}")))?,
            is_default: bool_from_i64(row.try_get("is_default")?),
            created_at: parse_datetime(&row.try_get::<String, _>("created_at")?)?,
            updated_at: parse_datetime(&row.try_get::<String, _>("updated_at")?)?,
        })
    }
}

#[async_trait]
impl HomeRailRepo for SqlxHomeRailRepo {
    async fn list(&self) -> Result<Vec<HomeRail>, DbError> {
        let sql = format!(
            "SELECT {COLUMNS} FROM home_rails ORDER BY position ASC, created_at ASC, id ASC"
        );
        let rows = sqlx::query(&sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn get(&self, id: Uuid) -> Result<HomeRail, DbError> {
        let sql = format!("SELECT {COLUMNS} FROM home_rails WHERE id = {}", self.ph(1));
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::from_row(&row)
    }

    async fn upsert(&self, rail: &HomeRail) -> Result<(), DbError> {
        let config = serde_json::to_string(&rail.config)
            .map_err(|e| decode_err(format!("failed to encode home rail config: {e}")))?;
        let p: Vec<String> = (1..=11).map(|n| self.ph(n)).collect();
        let sql = format!(
            "INSERT INTO home_rails ({COLUMNS}) VALUES ({}) \
             ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, library = excluded.library, \
             name = excluded.name, view_id = excluded.view_id, enabled = excluded.enabled, \
             position = excluded.position, config = excluded.config, \
             is_default = excluded.is_default, updated_at = excluded.updated_at",
            p.join(", ")
        );
        sqlx::query(&sql)
            .bind(rail.id.to_string())
            .bind(rail.kind.as_str())
            .bind(rail.library.map(library_to_str))
            .bind(rail.name.as_deref())
            .bind(rail.view_id.map(|v| v.to_string()))
            .bind(bool_to_i64(rail.enabled))
            .bind(rail.position)
            .bind(config)
            .bind(bool_to_i64(rail.is_default))
            .bind(format_datetime(rail.created_at))
            .bind(format_datetime(rail.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = format!("DELETE FROM home_rails WHERE id = {}", self.ph(1));
        let done = sqlx::query(&sql)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        if done.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        let sql = format!(
            "DELETE FROM home_rail_user_prefs WHERE rail_id = {}",
            self.ph(1)
        );
        sqlx::query(&sql)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn reorder(&self, ordered_ids: &[Uuid]) -> Result<(), DbError> {
        let current = self.list().await?;
        let mut order: Vec<Uuid> = ordered_ids.to_vec();
        order.dedup();
        for rail in &current {
            if !order.contains(&rail.id) {
                order.push(rail.id);
            }
        }
        let sql = format!(
            "UPDATE home_rails SET position = {} WHERE id = {}",
            self.ph(1),
            self.ph(2)
        );
        let mut tx = self.pool.begin().await?;
        for (index, id) in order.iter().enumerate() {
            sqlx::query(&sql)
                .bind(index as i32)
                .bind(id.to_string())
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn delete_for_view(&self, view_id: Uuid) -> Result<(), DbError> {
        let ids: Vec<Uuid> = self
            .list()
            .await?
            .into_iter()
            .filter(|rail| rail.view_id == Some(view_id))
            .map(|rail| rail.id)
            .collect();
        for id in ids {
            self.delete(id).await?;
        }
        Ok(())
    }

    async fn user_prefs(&self, user_id: Uuid) -> Result<Vec<UserRailPref>, DbError> {
        let sql = format!(
            "SELECT rail_id, hidden, position FROM home_rail_user_prefs WHERE user_id = {}",
            self.ph(1)
        );
        let rows = sqlx::query(&sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                Ok(UserRailPref {
                    rail_id: parse_uuid(&row.try_get::<String, _>("rail_id")?)?,
                    hidden: bool_from_i64(row.try_get("hidden")?),
                    position: row.try_get::<Option<i32>, _>("position")?,
                })
            })
            .collect()
    }

    async fn set_user_prefs(&self, user_id: Uuid, prefs: &[UserRailPref]) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        let delete = format!(
            "DELETE FROM home_rail_user_prefs WHERE user_id = {}",
            self.ph(1)
        );
        sqlx::query(&delete)
            .bind(user_id.to_string())
            .execute(&mut *tx)
            .await?;
        let insert = format!(
            "INSERT INTO home_rail_user_prefs (user_id, rail_id, hidden, position) \
             VALUES ({}, {}, {}, {})",
            self.ph(1),
            self.ph(2),
            self.ph(3),
            self.ph(4)
        );
        for pref in prefs {
            sqlx::query(&insert)
                .bind(user_id.to_string())
                .bind(pref.rail_id.to_string())
                .bind(bool_to_i64(pref.hidden))
                .bind(pref.position)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

/// Idempotent: inserts each default rail (per library, where sensible) only
/// if its fixed id is absent, so an admin's edits and ordering survive
/// restarts and rails added in later releases appear at the end.
pub async fn seed_default_rails(repo: &dyn HomeRailRepo) -> Result<(), DbError> {
    let existing = repo.list().await?;
    let mut next = existing.iter().map(|r| r.position + 1).max().unwrap_or(0);
    let now = chrono::Utc::now();
    // Library-major order keeps the seeded list readable: all of one
    // library's rails, then the next.
    for kind in HomeRailKind::DEFAULTS {
        for library in DEFAULT_RAIL_LIBRARIES {
            if !default_rail_kinds(library).contains(&kind) {
                continue;
            }
            let id = default_rail_id(kind, library);
            if existing.iter().any(|r| r.id == id) {
                continue;
            }
            repo.upsert(&HomeRail {
                id,
                kind,
                library: Some(library),
                name: None,
                view_id: None,
                enabled: true,
                position: next,
                config: HomeRailConfig::default(),
                is_default: true,
                created_at: now,
                updated_at: now,
            })
            .await?;
            next += 1;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;
    use chrono::SubsecRound;

    fn custom(name: &str, view: Uuid) -> HomeRail {
        let now = chrono::Utc::now().trunc_subsecs(3);
        HomeRail {
            id: Uuid::new_v4(),
            kind: HomeRailKind::Custom,
            library: Some(WorkKind::Movie),
            name: Some(name.into()),
            view_id: Some(view),
            enabled: true,
            position: 100,
            config: HomeRailConfig {
                limit: Some(10),
                ..Default::default()
            },
            is_default: false,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn seeding_is_idempotent_and_keeps_edits() {
        let repo = SqlxHomeRailRepo::new(test_sqlite_pool().await);
        seed_default_rails(&repo).await.unwrap();
        let first = repo.list().await.unwrap();
        // 5 kinds x movie/series + 2 for music.
        assert_eq!(first.len(), 12);
        assert!(first.iter().all(|r| r.is_default && r.enabled));

        let mut edited = first[0].clone();
        edited.enabled = false;
        repo.upsert(&edited).await.unwrap();
        seed_default_rails(&repo).await.unwrap();
        let again = repo.list().await.unwrap();
        assert_eq!(again.len(), 12);
        assert!(!again.iter().find(|r| r.id == edited.id).unwrap().enabled);
    }

    #[tokio::test]
    async fn custom_rail_round_trips_and_reorders() {
        let repo = SqlxHomeRailRepo::new(test_sqlite_pool().await);
        seed_default_rails(&repo).await.unwrap();
        let rail = custom("Dubbed", Uuid::new_v4());
        repo.upsert(&rail).await.unwrap();
        assert_eq!(repo.get(rail.id).await.unwrap(), rail);

        repo.reorder(&[rail.id]).await.unwrap();
        assert_eq!(repo.list().await.unwrap()[0].id, rail.id);

        repo.delete(rail.id).await.unwrap();
        assert!(matches!(repo.get(rail.id).await, Err(DbError::NotFound)));
        assert!(matches!(repo.delete(rail.id).await, Err(DbError::NotFound)));
    }

    #[tokio::test]
    async fn user_prefs_replace_and_cascade_on_delete() {
        let repo = SqlxHomeRailRepo::new(test_sqlite_pool().await);
        let rail = custom("A", Uuid::new_v4());
        repo.upsert(&rail).await.unwrap();
        let user = Uuid::new_v4();
        repo.set_user_prefs(
            user,
            &[UserRailPref {
                rail_id: rail.id,
                hidden: true,
                position: Some(3),
            }],
        )
        .await
        .unwrap();
        assert_eq!(repo.user_prefs(user).await.unwrap().len(), 1);
        repo.set_user_prefs(user, &[]).await.unwrap();
        assert!(repo.user_prefs(user).await.unwrap().is_empty());
        repo.set_user_prefs(
            user,
            &[UserRailPref {
                rail_id: rail.id,
                hidden: false,
                position: None,
            }],
        )
        .await
        .unwrap();
        repo.delete(rail.id).await.unwrap();
        assert!(repo.user_prefs(user).await.unwrap().is_empty());
    }
}
