use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{LibraryView, ViewCriteria, ViewSort};
use uuid::{uuid, Uuid};

use crate::codec::{
    bool_from_i64, bool_to_i64, decode_err, format_datetime, parse_datetime, parse_uuid,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

fn view_sort_key_to_str(sort: ViewSort) -> &'static str {
    match sort {
        ViewSort::TitleAscending => "title",
        ViewSort::TitleDescending => "title_desc",
        ViewSort::RecentlyAdded => "recent",
        ViewSort::OldestAdded => "oldest",
        ViewSort::RecentlyReleased => "released",
        ViewSort::LastPlayedByUser => "last_played",
    }
}

fn view_sort_key_from_str(raw: &str) -> Result<ViewSort, DbError> {
    match raw {
        "title" => Ok(ViewSort::TitleAscending),
        "title_desc" => Ok(ViewSort::TitleDescending),
        "recent" => Ok(ViewSort::RecentlyAdded),
        "oldest" => Ok(ViewSort::OldestAdded),
        "released" => Ok(ViewSort::RecentlyReleased),
        "last_played" => Ok(ViewSort::LastPlayedByUser),
        other => Err(decode_err(format!("unknown view sort {other:?}"))),
    }
}

/// `sort` is stored as a JSON array of the same short strings
/// `view_sort_key_to_str` produces, e.g. `["last_played","title"]` --
/// ordered, most-significant first, matching `LibraryView::sort`'s own doc
/// comment. Falls back to decoding a single legacy bare string (the format
/// this column held before `LibraryView::sort` became a `Vec`) wrapped in a
/// one-element list, so an existing row from before this change still
/// loads instead of hard-failing on the next read.
fn view_sort_to_json(sort: &[ViewSort]) -> String {
    let keys: Vec<&'static str> = sort.iter().copied().map(view_sort_key_to_str).collect();
    serde_json::to_string(&keys).expect("Vec<&str> always serializes")
}

fn view_sort_from_json(raw: &str) -> Result<Vec<ViewSort>, DbError> {
    if let Ok(keys) = serde_json::from_str::<Vec<String>>(raw) {
        return keys.iter().map(|k| view_sort_key_from_str(k)).collect();
    }
    // Legacy pre-Vec format: a single bare key string, no JSON encoding at all.
    view_sort_key_from_str(raw).map(|key| vec![key])
}

/// Storage boundary for [`LibraryView`] -- see that type's doc comment. A
/// single `upsert` (not separate create/update) matching `WorkRepo`'s
/// convention: callers (`streamarr-api`'s admin handlers) always have a
/// full `LibraryView` value in hand -- constructed fresh for a create, or
/// fetched-then-mutated for an update -- so there's no separate partial-
/// patch shape to support.
#[async_trait]
pub trait LibraryViewRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<LibraryView, DbError>;

    /// Ordered by `created_at ASC` -- deliberately not `default_order` (see
    /// this trait's own module for why): the defaults-first/then-
    /// alphabetical display order callers actually want is computed above
    /// this repo, in `streamarr_api::views`'s shared `sort_views_for_display`
    /// helper.
    async fn list(&self) -> Result<Vec<LibraryView>, DbError>;

    /// Insert-or-update by `LibraryView::id`.
    async fn upsert(&self, view: &LibraryView) -> Result<(), DbError>;

    /// `DbError::NotFound` if no row with this id -- mirrors `WorkRepo::delete`.
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;
}

pub struct SqlxLibraryViewRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxLibraryViewRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<LibraryView, DbError> {
        let id: String = row.try_get("id")?;
        let name: String = row.try_get("name")?;
        let criteria_json: String = row.try_get("criteria")?;
        let sort: String = row.try_get("sort")?;
        let is_default: i64 = row.try_get("is_default")?;
        let default_order: Option<i32> = row.try_get("default_order")?;
        let created_at: String = row.try_get("created_at")?;
        let updated_at: String = row.try_get("updated_at")?;

        let criteria: ViewCriteria = serde_json::from_str(&criteria_json)
            .map_err(|e| decode_err(format!("invalid view criteria json: {e}")))?;

        Ok(LibraryView {
            id: parse_uuid(&id)?,
            name,
            criteria,
            sort: view_sort_from_json(&sort)?,
            is_default: bool_from_i64(is_default),
            default_order,
            created_at: parse_datetime(&created_at)?,
            updated_at: parse_datetime(&updated_at)?,
        })
    }
}

#[async_trait]
impl LibraryViewRepo for SqlxLibraryViewRepo {
    async fn get(&self, id: Uuid) -> Result<LibraryView, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, name, criteria, sort, is_default, default_order, created_at, updated_at \
                 FROM library_views WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, name, criteria, sort, is_default, default_order, created_at, updated_at \
                 FROM library_views WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::from_row(&row)
    }

    async fn list(&self) -> Result<Vec<LibraryView>, DbError> {
        let sql =
            "SELECT id, name, criteria, sort, is_default, default_order, created_at, updated_at \
                    FROM library_views ORDER BY created_at ASC";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn upsert(&self, view: &LibraryView) -> Result<(), DbError> {
        let criteria = serde_json::to_string(&view.criteria)
            .map_err(|e| decode_err(format!("failed to encode view criteria: {e}")))?;

        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO library_views \
                 (id, name, criteria, sort, is_default, default_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, criteria = excluded.criteria, sort = excluded.sort, \
                 is_default = excluded.is_default, default_order = excluded.default_order, \
                 created_at = excluded.created_at, updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO library_views \
                 (id, name, criteria, sort, is_default, default_order, created_at, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, criteria = excluded.criteria, sort = excluded.sort, \
                 is_default = excluded.is_default, default_order = excluded.default_order, \
                 created_at = excluded.created_at, updated_at = excluded.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(view.id.to_string())
            .bind(view.name.as_str())
            .bind(criteria)
            .bind(view_sort_to_json(&view.sort))
            .bind(bool_to_i64(view.is_default))
            .bind(view.default_order)
            .bind(format_datetime(view.created_at))
            .bind(format_datetime(view.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM library_views WHERE id = ?",
            Backend::Postgres => "DELETE FROM library_views WHERE id = $1",
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

/// Fixed, well-known ids for the two seeded default views -- stable across
/// every install so `upsert`-once-if-absent (never overwrite) is safe to
/// call on every boot without clobbering an admin's edits to a default
/// view's name/criteria.
pub const NEWLY_ADDED_VIEW_ID: Uuid = uuid!("00000000-0000-0000-0000-00000000a001");
pub const NEWLY_RELEASED_VIEW_ID: Uuid = uuid!("00000000-0000-0000-0000-00000000a002");

/// Idempotent: inserts each default view only if its fixed id doesn't
/// already exist. Never overwrites an existing row -- an admin who has
/// renamed/retuned "Newly Added" must not have that reverted on the next
/// restart. Call once, after migrations run, from `streamarr-bin`'s
/// `boot_api` -- the same place `SourceInstanceRegistry` is hydrated from
/// `source_instance_repo`.
pub async fn seed_default_views(repo: &dyn LibraryViewRepo) -> Result<(), DbError> {
    let now = chrono::Utc::now();
    let defaults = [
        LibraryView {
            id: NEWLY_ADDED_VIEW_ID,
            name: "Newly Added".to_string(),
            criteria: ViewCriteria::default(),
            sort: vec![ViewSort::RecentlyAdded],
            is_default: true,
            default_order: Some(0),
            created_at: now,
            updated_at: now,
        },
        LibraryView {
            id: NEWLY_RELEASED_VIEW_ID,
            name: "Newly Released".to_string(),
            criteria: ViewCriteria::default(),
            sort: vec![ViewSort::RecentlyReleased],
            is_default: true,
            default_order: Some(1),
            created_at: now,
            updated_at: now,
        },
    ];
    for view in defaults {
        if matches!(repo.get(view.id).await, Err(DbError::NotFound)) {
            repo.upsert(&view).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::SubsecRound;
    use streamarr_model::WorkKind;

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_view(name: &str) -> LibraryView {
        // Storage round-trips through millisecond precision (see
        // `codec::format_datetime`) -- truncate here so the fixture already
        // matches what a `get()` will hand back, same convention as
        // `repo::work::tests::sample_work`.
        let now = chrono::Utc::now().trunc_subsecs(3);
        LibraryView {
            id: Uuid::new_v4(),
            name: name.to_string(),
            criteria: ViewCriteria {
                kind: Some(WorkKind::Movie),
                source_instance_id: Some(Uuid::new_v4()),
                genre: Some("Action".to_string()),
                tag: Some("4k".to_string()),
                available_only: true,
                release_window_days: Some(30),
            },
            sort: vec![ViewSort::LastPlayedByUser, ViewSort::RecentlyReleased],
            is_default: false,
            default_order: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxLibraryViewRepo::new(pool);
        let view = sample_view("Unwatched Action");

        repo.upsert(&view).await.expect("upsert");
        let fetched = repo.get(view.id).await.expect("get");

        assert_eq!(fetched, view);
    }

    #[tokio::test]
    async fn upsert_updates_existing_row_in_place() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxLibraryViewRepo::new(pool);
        let mut view = sample_view("Original Name");
        repo.upsert(&view).await.unwrap();

        view.name = "Renamed View".to_string();
        view.criteria.genre = Some("Comedy".to_string());
        view.sort = vec![ViewSort::TitleAscending];
        view.updated_at = chrono::Utc::now().trunc_subsecs(3);
        repo.upsert(&view).await.unwrap();

        let all = repo.list().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], view);
    }

    #[tokio::test]
    async fn list_returns_every_view() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxLibraryViewRepo::new(pool);
        repo.upsert(&sample_view("View A")).await.unwrap();
        repo.upsert(&sample_view("View B")).await.unwrap();

        let all = repo.list().await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxLibraryViewRepo::new(pool);
        let view = sample_view("Doomed View");
        repo.upsert(&view).await.unwrap();

        repo.delete(view.id).await.unwrap();
        let err = repo.get(view.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn delete_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxLibraryViewRepo::new(pool);
        let err = repo.delete(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn seed_default_views_inserts_both_defaults() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxLibraryViewRepo::new(pool);

        seed_default_views(&repo).await.unwrap();

        let all = repo.list().await.unwrap();
        assert_eq!(all.len(), 2);
        assert!(all
            .iter()
            .any(|v| v.id == NEWLY_ADDED_VIEW_ID && v.name == "Newly Added"));
        assert!(all
            .iter()
            .any(|v| v.id == NEWLY_RELEASED_VIEW_ID && v.name == "Newly Released"));
        assert!(all.iter().all(|v| v.is_default));
    }

    #[tokio::test]
    async fn seed_default_views_is_idempotent_and_preserves_edits() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxLibraryViewRepo::new(pool);

        seed_default_views(&repo).await.unwrap();

        // Simulate an admin renaming/retuning a default view between the
        // two seed calls (e.g. across a restart).
        let mut edited = repo.get(NEWLY_ADDED_VIEW_ID).await.unwrap();
        edited.name = "My Custom Recents".to_string();
        edited.criteria.genre = Some("Horror".to_string());
        repo.upsert(&edited).await.unwrap();

        seed_default_views(&repo).await.unwrap();

        let all = repo.list().await.unwrap();
        assert_eq!(all.len(), 2, "seeding twice must not duplicate rows");
        let still_edited = repo.get(NEWLY_ADDED_VIEW_ID).await.unwrap();
        assert_eq!(still_edited.name, "My Custom Recents");
        assert_eq!(still_edited.criteria.genre.as_deref(), Some("Horror"));
    }
}
