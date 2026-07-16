//! Storage boundary for [`Playlist`]/[`PlaylistItem`] -- see
//! `streamarr_model::playlist`'s module doc comment for the full
//! rationale. Two aggregates, one trait: playlist metadata (name/owner/
//! parent) and its ordered item membership are different enough shapes
//! (upsert-a-whole-row vs. append-one/remove-one/reorder-many) that they
//! don't share a single CRUD verb set, but they're small and always used
//! together, so one trait covers both rather than splitting into
//! `PlaylistRepo` + `PlaylistItemRepo`.

use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{Playlist, PlaylistItem};
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

#[async_trait]
pub trait PlaylistRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Playlist, DbError>;

    /// Every playlist a given user can see: their own personal playlists
    /// plus every System playlist (`owner_user_id IS NULL`) -- the exact
    /// set `streamarr_api::playlists`' user-facing list endpoint returns
    /// unfiltered (access control is "is it visible", not "is it yours",
    /// beyond that).
    async fn list_visible_to_user(&self, user_id: Uuid) -> Result<Vec<Playlist>, DbError>;

    /// Every System playlist (`owner_user_id IS NULL`) -- the admin
    /// management view.
    async fn list_system(&self) -> Result<Vec<Playlist>, DbError>;

    /// Every playlist regardless of owner -- System and every user's
    /// personal ones. The admin "view everything" surface: an admin can
    /// see who has what, even though only System playlists are
    /// admin-writable (see `streamarr_api::playlists`'s `can_write`).
    async fn list_all(&self) -> Result<Vec<Playlist>, DbError>;

    /// Insert-or-update by `Playlist::id` -- same single-verb convention
    /// as `LibraryViewRepo::upsert`.
    async fn upsert(&self, playlist: &Playlist) -> Result<(), DbError>;

    /// Cascades to every nested child playlist and every item on this
    /// playlist and its children, via the schema's own `ON DELETE CASCADE`
    /// chain (see `0015_playlists.sql`) -- a single delete here is enough,
    /// no recursive application-level cleanup needed.
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    /// Ordered by `position ASC`.
    async fn list_items(&self, playlist_id: Uuid) -> Result<Vec<PlaylistItem>, DbError>;

    /// Appends `work_id` at the end of `playlist_id`'s current ordering
    /// (`MAX(position) + 1`, or `0` for an empty playlist) and returns the
    /// created row. Generating `id`/`position`/`added_at` here (not
    /// caller-supplied, unlike `upsert`) is the one place this trait
    /// departs from `LibraryViewRepo`'s "caller always has a full value in
    /// hand" convention -- the next position is inherently a
    /// server-computed value a caller can't know without a round trip
    /// anyway, so there is no meaningful "fresh vs. fetched-then-mutated"
    /// case to support here the way there is for a `Playlist`/`LibraryView`
    /// rename.
    async fn add_item(&self, playlist_id: Uuid, work_id: Uuid) -> Result<PlaylistItem, DbError>;

    /// `DbError::NotFound` if no such item exists on this playlist.
    async fn remove_item(&self, playlist_id: Uuid, item_id: Uuid) -> Result<(), DbError>;

    /// Replaces the full ordering of `playlist_id`'s items: each id in
    /// `item_ids_in_order` gets `position` set to its index in the slice.
    /// An id that isn't actually one of this playlist's items is silently
    /// a no-op for that id (the `UPDATE ... WHERE playlist_id = ? AND id =
    /// ?` simply matches no row) rather than an error -- callers are
    /// expected to submit exactly the set `list_items` just returned, and
    /// failing the whole reorder over one stray id would be a worse
    /// failure mode than ignoring it.
    async fn reorder_items(
        &self,
        playlist_id: Uuid,
        item_ids_in_order: &[Uuid],
    ) -> Result<(), DbError>;
}

pub struct SqlxPlaylistRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxPlaylistRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn playlist_from_row(row: &AnyRow) -> Result<Playlist, DbError> {
        let id: String = row.try_get("id")?;
        let name: String = row.try_get("name")?;
        let owner_user_id: Option<String> = row.try_get("owner_user_id")?;
        let parent_playlist_id: Option<String> = row.try_get("parent_playlist_id")?;
        let created_at: String = row.try_get("created_at")?;
        let updated_at: String = row.try_get("updated_at")?;

        Ok(Playlist {
            id: parse_uuid(&id)?,
            name,
            owner_user_id: owner_user_id.map(|s| parse_uuid(&s)).transpose()?,
            parent_playlist_id: parent_playlist_id.map(|s| parse_uuid(&s)).transpose()?,
            created_at: parse_datetime(&created_at)?,
            updated_at: parse_datetime(&updated_at)?,
        })
    }

    fn item_from_row(row: &AnyRow) -> Result<PlaylistItem, DbError> {
        let id: String = row.try_get("id")?;
        let playlist_id: String = row.try_get("playlist_id")?;
        let work_id: String = row.try_get("work_id")?;
        let position: i32 = row.try_get("position")?;
        let added_at: String = row.try_get("added_at")?;

        Ok(PlaylistItem {
            id: parse_uuid(&id)?,
            playlist_id: parse_uuid(&playlist_id)?,
            work_id: parse_uuid(&work_id)?,
            position,
            added_at: parse_datetime(&added_at)?,
        })
    }
}

#[async_trait]
impl PlaylistRepo for SqlxPlaylistRepo {
    async fn get(&self, id: Uuid) -> Result<Playlist, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, name, owner_user_id, parent_playlist_id, created_at, updated_at \
                 FROM playlists WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, name, owner_user_id, parent_playlist_id, created_at, updated_at \
                 FROM playlists WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::playlist_from_row(&row)
    }

    async fn list_visible_to_user(&self, user_id: Uuid) -> Result<Vec<Playlist>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, name, owner_user_id, parent_playlist_id, created_at, updated_at \
                 FROM playlists WHERE owner_user_id = ? OR owner_user_id IS NULL \
                 ORDER BY created_at ASC"
            }
            Backend::Postgres => {
                "SELECT id, name, owner_user_id, parent_playlist_id, created_at, updated_at \
                 FROM playlists WHERE owner_user_id = $1 OR owner_user_id IS NULL \
                 ORDER BY created_at ASC"
            }
        };
        let rows = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::playlist_from_row).collect()
    }

    async fn list_system(&self) -> Result<Vec<Playlist>, DbError> {
        let sql = "SELECT id, name, owner_user_id, parent_playlist_id, created_at, updated_at \
                    FROM playlists WHERE owner_user_id IS NULL ORDER BY created_at ASC";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::playlist_from_row).collect()
    }

    async fn list_all(&self) -> Result<Vec<Playlist>, DbError> {
        let sql = "SELECT id, name, owner_user_id, parent_playlist_id, created_at, updated_at \
                    FROM playlists ORDER BY created_at ASC";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::playlist_from_row).collect()
    }

    async fn upsert(&self, playlist: &Playlist) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO playlists \
                 (id, name, owner_user_id, parent_playlist_id, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, owner_user_id = excluded.owner_user_id, \
                 parent_playlist_id = excluded.parent_playlist_id, \
                 created_at = excluded.created_at, updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO playlists \
                 (id, name, owner_user_id, parent_playlist_id, created_at, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, owner_user_id = excluded.owner_user_id, \
                 parent_playlist_id = excluded.parent_playlist_id, \
                 created_at = excluded.created_at, updated_at = excluded.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(playlist.id.to_string())
            .bind(playlist.name.as_str())
            .bind(playlist.owner_user_id.map(|id| id.to_string()))
            .bind(playlist.parent_playlist_id.map(|id| id.to_string()))
            .bind(format_datetime(playlist.created_at))
            .bind(format_datetime(playlist.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM playlists WHERE id = ?",
            Backend::Postgres => "DELETE FROM playlists WHERE id = $1",
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

    async fn list_items(&self, playlist_id: Uuid) -> Result<Vec<PlaylistItem>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, playlist_id, work_id, position, added_at FROM playlist_items \
                 WHERE playlist_id = ? ORDER BY position ASC"
            }
            Backend::Postgres => {
                "SELECT id, playlist_id, work_id, position, added_at FROM playlist_items \
                 WHERE playlist_id = $1 ORDER BY position ASC"
            }
        };
        let rows = sqlx::query(sql)
            .bind(playlist_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::item_from_row).collect()
    }

    async fn add_item(&self, playlist_id: Uuid, work_id: Uuid) -> Result<PlaylistItem, DbError> {
        let max_position_sql = match self.backend {
            Backend::Sqlite => "SELECT MAX(position) FROM playlist_items WHERE playlist_id = ?",
            Backend::Postgres => "SELECT MAX(position) FROM playlist_items WHERE playlist_id = $1",
        };
        let current_max: Option<i32> = sqlx::query(max_position_sql)
            .bind(playlist_id.to_string())
            .fetch_one(&self.pool)
            .await?
            .try_get(0)
            .map_err(|e| decode_err(format!("failed to read MAX(position): {e}")))?;

        let item = PlaylistItem {
            id: Uuid::new_v4(),
            playlist_id,
            work_id,
            position: current_max.map(|p| p + 1).unwrap_or(0),
            added_at: chrono::Utc::now(),
        };

        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO playlist_items (id, playlist_id, work_id, position, added_at) \
                 VALUES (?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO playlist_items (id, playlist_id, work_id, position, added_at) \
                 VALUES ($1, $2, $3, $4, $5)"
            }
        };
        sqlx::query(insert_sql)
            .bind(item.id.to_string())
            .bind(item.playlist_id.to_string())
            .bind(item.work_id.to_string())
            .bind(item.position)
            .bind(format_datetime(item.added_at))
            .execute(&self.pool)
            .await?;

        Ok(item)
    }

    async fn remove_item(&self, playlist_id: Uuid, item_id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM playlist_items WHERE playlist_id = ? AND id = ?",
            Backend::Postgres => "DELETE FROM playlist_items WHERE playlist_id = $1 AND id = $2",
        };
        let result = sqlx::query(sql)
            .bind(playlist_id.to_string())
            .bind(item_id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    async fn reorder_items(
        &self,
        playlist_id: Uuid,
        item_ids_in_order: &[Uuid],
    ) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND id = ?"
            }
            Backend::Postgres => {
                "UPDATE playlist_items SET position = $1 WHERE playlist_id = $2 AND id = $3"
            }
        };
        // Two passes through negative positions first: `playlist_items`
        // has a UNIQUE(playlist_id, position) index, so writing final
        // positions directly, one row at a time, can collide with a row
        // that hasn't moved out of that slot yet (e.g. swapping items at
        // position 0 and 1). Staging every row at a distinct negative
        // position first guarantees no intermediate collision, since the
        // negative range never overlaps the final non-negative one. No
        // explicit transaction needed beyond that: a reorder is idempotent
        // to retry in full if one statement in the middle somehow failed --
        // unlike `add_item`'s MAX-then-INSERT, there's no read to go stale.
        for (index, item_id) in item_ids_in_order.iter().enumerate() {
            sqlx::query(sql)
                .bind(-(index as i32) - 1)
                .bind(playlist_id.to_string())
                .bind(item_id.to_string())
                .execute(&self.pool)
                .await?;
        }
        for (index, item_id) in item_ids_in_order.iter().enumerate() {
            sqlx::query(sql)
                .bind(index as i32)
                .bind(playlist_id.to_string())
                .bind(item_id.to_string())
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::SubsecRound;

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_playlist(name: &str, owner_user_id: Option<Uuid>) -> Playlist {
        let now = chrono::Utc::now().trunc_subsecs(3);
        Playlist {
            id: Uuid::new_v4(),
            name: name.to_string(),
            owner_user_id,
            parent_playlist_id: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let user_id = Uuid::new_v4();
        let playlist = sample_playlist("MCU", Some(user_id));

        repo.upsert(&playlist).await.expect("upsert");
        let fetched = repo.get(playlist.id).await.expect("get");

        assert_eq!(fetched, playlist);
    }

    #[tokio::test]
    async fn system_playlist_has_no_owner() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let playlist = sample_playlist("Staff Picks", None);

        repo.upsert(&playlist).await.unwrap();
        let fetched = repo.get(playlist.id).await.unwrap();
        assert_eq!(fetched.owner_user_id, None);

        let system = repo.list_system().await.unwrap();
        assert_eq!(system.len(), 1);
        assert_eq!(system[0].id, playlist.id);
    }

    #[tokio::test]
    async fn list_all_includes_system_and_every_users_personal_playlists() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();

        let system = sample_playlist("Staff Picks", None);
        let mine = sample_playlist("My Playlist", Some(user_a));
        let someone_elses = sample_playlist("Not Mine", Some(user_b));
        for p in [&system, &mine, &someone_elses] {
            repo.upsert(p).await.unwrap();
        }

        let all = repo.list_all().await.unwrap();
        let ids: Vec<Uuid> = all.iter().map(|p| p.id).collect();
        assert_eq!(ids.len(), 3);
        assert!(ids.contains(&system.id));
        assert!(ids.contains(&mine.id));
        assert!(ids.contains(&someone_elses.id));
    }

    #[tokio::test]
    async fn list_visible_to_user_includes_own_and_system_but_not_others() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();

        let mine = sample_playlist("My Playlist", Some(user_a));
        let system = sample_playlist("System Playlist", None);
        let someone_elses = sample_playlist("Not Mine", Some(user_b));
        for p in [&mine, &system, &someone_elses] {
            repo.upsert(p).await.unwrap();
        }

        let visible = repo.list_visible_to_user(user_a).await.unwrap();
        let ids: Vec<Uuid> = visible.iter().map(|p| p.id).collect();
        assert!(ids.contains(&mine.id));
        assert!(ids.contains(&system.id));
        assert!(!ids.contains(&someone_elses.id));
    }

    #[tokio::test]
    async fn sub_playlist_nests_under_parent() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let user_id = Uuid::new_v4();

        let mut parent = sample_playlist("MCU", Some(user_id));
        repo.upsert(&parent).await.unwrap();

        let mut child = sample_playlist("Sample Movie Golf", Some(user_id));
        child.parent_playlist_id = Some(parent.id);
        repo.upsert(&child).await.unwrap();

        let fetched_child = repo.get(child.id).await.unwrap();
        assert_eq!(fetched_child.parent_playlist_id, Some(parent.id));

        // Deleting the parent cascades to the child (schema-level ON
        // DELETE CASCADE, see 0015_playlists.sql).
        repo.delete(parent.id).await.unwrap();
        let err = repo.get(child.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));

        // Silence "unused mut" -- parent is intentionally never mutated
        // after upsert in this test, only read back indirectly via cascade.
        let _ = &mut parent;
    }

    #[tokio::test]
    async fn add_item_appends_at_the_end_with_increasing_positions() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let playlist = sample_playlist("Watchlist", None);
        repo.upsert(&playlist).await.unwrap();

        let work_a = Uuid::new_v4();
        let work_b = Uuid::new_v4();
        let item_a = repo.add_item(playlist.id, work_a).await.unwrap();
        let item_b = repo.add_item(playlist.id, work_b).await.unwrap();

        assert_eq!(item_a.position, 0);
        assert_eq!(item_b.position, 1);

        let items = repo.list_items(playlist.id).await.unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, item_a.id);
        assert_eq!(items[1].id, item_b.id);
    }

    #[tokio::test]
    async fn remove_item_removes_only_that_item() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let playlist = sample_playlist("Watchlist", None);
        repo.upsert(&playlist).await.unwrap();

        let item_a = repo.add_item(playlist.id, Uuid::new_v4()).await.unwrap();
        let item_b = repo.add_item(playlist.id, Uuid::new_v4()).await.unwrap();

        repo.remove_item(playlist.id, item_a.id).await.unwrap();

        let items = repo.list_items(playlist.id).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, item_b.id);
    }

    #[tokio::test]
    async fn remove_missing_item_is_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let playlist = sample_playlist("Watchlist", None);
        repo.upsert(&playlist).await.unwrap();

        let err = repo
            .remove_item(playlist.id, Uuid::new_v4())
            .await
            .unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn reorder_items_applies_the_new_order() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let playlist = sample_playlist("Watchlist", None);
        repo.upsert(&playlist).await.unwrap();

        let item_a = repo.add_item(playlist.id, Uuid::new_v4()).await.unwrap();
        let item_b = repo.add_item(playlist.id, Uuid::new_v4()).await.unwrap();
        let item_c = repo.add_item(playlist.id, Uuid::new_v4()).await.unwrap();

        repo.reorder_items(playlist.id, &[item_c.id, item_a.id, item_b.id])
            .await
            .unwrap();

        let items = repo.list_items(playlist.id).await.unwrap();
        let ids: Vec<Uuid> = items.iter().map(|i| i.id).collect();
        assert_eq!(ids, vec![item_c.id, item_a.id, item_b.id]);
    }

    #[tokio::test]
    async fn delete_missing_playlist_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPlaylistRepo::new(pool);
        let err = repo.delete(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }
}
