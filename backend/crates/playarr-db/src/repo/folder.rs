//! Persistence for source root folders and the file-derived folder browse
//! cache (`source_root_folders`, `folder_media_entries`).
//!
//! A scanned file is stored as three rows written in one transaction: a hidden
//! backing `works` row (reserved `playarr_folder` external ref, so catalogue
//! enumeration skips it), a normal `media_files` row (so playback, download,
//! thumbnail and watch-progress routes work unchanged) and the
//! `folder_media_entries` row carrying the safe root-relative path.

use std::path::PathBuf;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::{
    folder_work_provider, Availability, FolderFileMetadata, FolderMediaEntry, FolderScanStatus,
    ScannedFolderFile, SourceRootFolder, WorkKind, FOLDER_SOURCE_FILE_PREFIX,
};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    availability_to_str, bool_from_i64, bool_to_i64, folder_scan_status_from_str,
    folder_scan_status_to_str, format_datetime, parse_datetime, parse_uuid, provider_to_str,
    work_kind_from_str, work_kind_to_str,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

const ROOT_COLUMNS: &str = "id, source_instance_id, source_root_id, reported_path, \
    local_path_override, display_name, work_kind, accessible, free_space_bytes, \
    total_space_bytes, active, scan_enabled, scan_status, last_scanned_at, scan_error, \
    updated_at";

const ENTRY_SELECT: &str = "SELECT e.id, e.root_folder_id, e.media_file_id, m.work_id, \
    e.relative_path, e.directory_path, e.file_name, e.work_kind, e.title, e.modified_at, \
    e.metadata, e.scanned_at, m.container, m.codec, m.bitrate, m.duration_ms, m.size_bytes, \
    m.path AS physical_path \
    FROM folder_media_entries e JOIN media_files m ON m.id = e.media_file_id";

/// A root as one source application reports it (before local configuration).
#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveredRoot {
    pub id: Uuid,
    pub source_root_id: String,
    pub reported_path: String,
    pub display_name: String,
    pub work_kind: WorkKind,
    pub accessible: bool,
    pub free_space_bytes: Option<u64>,
    pub total_space_bytes: Option<u64>,
}

/// What the scanner needs to decide whether a stored file is still current.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanIndexRow {
    pub relative_path: String,
    pub size_bytes: u64,
    pub modified_at: Option<DateTime<Utc>>,
}

/// Admin edit of one root. `None` leaves a field unchanged;
/// `local_path_override: Some(None)` clears the override.
#[derive(Debug, Clone, Default)]
pub struct RootConfigUpdate {
    pub scan_enabled: Option<bool>,
    pub local_path_override: Option<Option<PathBuf>>,
    pub display_name: Option<String>,
}

#[async_trait]
pub trait FolderRepo: Send + Sync {
    /// Upserts the roots one source reports and marks that source's other
    /// non-manual roots inactive (their scan cache is kept). Administrator
    /// configuration (`scan_enabled`, local override) and scan state of a
    /// root that is still reported are preserved.
    async fn sync_discovered_roots(
        &self,
        source_instance_id: Uuid,
        roots: &[DiscoveredRoot],
    ) -> Result<(), DbError>;

    /// Inserts or fully replaces one root (used for administrator-added roots).
    async fn upsert_root(&self, root: &SourceRootFolder) -> Result<(), DbError>;

    async fn get_root(&self, id: Uuid) -> Result<SourceRootFolder, DbError>;

    /// Every root, active or not, ordered by kind and name.
    async fn list_roots(&self) -> Result<Vec<SourceRootFolder>, DbError>;

    async fn update_root_config(
        &self,
        id: Uuid,
        update: &RootConfigUpdate,
    ) -> Result<SourceRootFolder, DbError>;

    /// Removes the root and every file it discovered (backing works included).
    async fn delete_root(&self, id: Uuid) -> Result<(), DbError>;

    async fn set_scan_state(
        &self,
        id: Uuid,
        status: FolderScanStatus,
        error: Option<&str>,
        scanned_at: Option<DateTime<Utc>>,
    ) -> Result<(), DbError>;

    async fn scan_index(&self, root_folder_id: Uuid) -> Result<Vec<ScanIndexRow>, DbError>;

    async fn upsert_scanned_file(&self, file: &ScannedFolderFile) -> Result<(), DbError>;

    /// Deletes the entries (and their media files and backing works) at the
    /// given root-relative paths. Returns how many were removed.
    async fn remove_entries(
        &self,
        root_folder_id: Uuid,
        relative_paths: &[String],
    ) -> Result<u64, DbError>;

    /// Every entry at or below `directory_path` (empty means the whole root).
    async fn list_entries_under(
        &self,
        root_folder_id: Uuid,
        directory_path: &str,
    ) -> Result<Vec<FolderMediaEntry>, DbError>;

    async fn find_entry_by_media_file_id(
        &self,
        media_file_id: Uuid,
    ) -> Result<Option<FolderMediaEntry>, DbError>;

    async fn count_entries(&self, root_folder_id: Uuid) -> Result<u64, DbError>;
}

pub struct SqlxFolderRepo {
    pool: DbPool,
    backend: Backend,
}

/// Rewrites `?` placeholders to `$n` for Postgres.
fn sql(backend: Backend, text: &str) -> String {
    match backend {
        Backend::Sqlite => text.to_string(),
        Backend::Postgres => {
            let mut out = String::with_capacity(text.len() + 8);
            let mut n = 0;
            for c in text.chars() {
                if c == '?' {
                    n += 1;
                    out.push('$');
                    out.push_str(&n.to_string());
                } else {
                    out.push(c);
                }
            }
            out
        }
    }
}

fn optional_i64(value: Option<u64>) -> Result<Option<i64>, DbError> {
    value
        .map(|v| i64::try_from(v).map_err(|_| crate::codec::decode_err("byte count exceeds i64")))
        .transpose()
}

fn non_negative_u64(value: i64) -> u64 {
    value.max(0) as u64
}

/// Escapes `%`, `_` and the escape character for a `LIKE ... ESCAPE '\'`.
fn like_prefix(directory: &str) -> String {
    let mut out = String::with_capacity(directory.len() + 2);
    for c in directory.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push_str("/%");
    out
}

impl SqlxFolderRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn q(&self, text: &str) -> String {
        sql(self.backend, text)
    }

    fn root_from_row(row: &AnyRow) -> Result<SourceRootFolder, DbError> {
        let id: String = row.try_get("id")?;
        let source_instance_id: String = row.try_get("source_instance_id")?;
        let local_path_override: Option<String> = row.try_get("local_path_override")?;
        let work_kind: String = row.try_get("work_kind")?;
        let accessible: i64 = row.try_get("accessible")?;
        let free: Option<i64> = row.try_get("free_space_bytes")?;
        let total: Option<i64> = row.try_get("total_space_bytes")?;
        let active: i64 = row.try_get("active")?;
        let scan_enabled: i64 = row.try_get("scan_enabled")?;
        let scan_status: String = row.try_get("scan_status")?;
        let last_scanned_at: Option<String> = row.try_get("last_scanned_at")?;
        let updated_at: String = row.try_get("updated_at")?;
        Ok(SourceRootFolder {
            id: parse_uuid(&id)?,
            source_instance_id: parse_uuid(&source_instance_id)?,
            source_root_id: row.try_get("source_root_id")?,
            reported_path: row.try_get("reported_path")?,
            local_path_override: local_path_override.map(PathBuf::from),
            display_name: row.try_get("display_name")?,
            work_kind: work_kind_from_str(&work_kind)?,
            accessible: bool_from_i64(accessible),
            free_space_bytes: free.map(non_negative_u64),
            total_space_bytes: total.map(non_negative_u64),
            active: bool_from_i64(active),
            scan_enabled: bool_from_i64(scan_enabled),
            scan_status: folder_scan_status_from_str(&scan_status)?,
            last_scanned_at: last_scanned_at
                .map(|raw| parse_datetime(&raw))
                .transpose()?,
            scan_error: row.try_get("scan_error")?,
            updated_at: parse_datetime(&updated_at)?,
        })
    }

    fn entry_from_row(row: &AnyRow) -> Result<FolderMediaEntry, DbError> {
        let id: String = row.try_get("id")?;
        let root_folder_id: String = row.try_get("root_folder_id")?;
        let media_file_id: String = row.try_get("media_file_id")?;
        let work_id: String = row.try_get("work_id")?;
        let work_kind: String = row.try_get("work_kind")?;
        let modified_at: Option<String> = row.try_get("modified_at")?;
        let metadata: String = row.try_get("metadata")?;
        let scanned_at: String = row.try_get("scanned_at")?;
        let bitrate: Option<i64> = row.try_get("bitrate")?;
        let duration_ms: Option<i64> = row.try_get("duration_ms")?;
        let size_bytes: i64 = row.try_get("size_bytes")?;
        let physical_path: String = row.try_get("physical_path")?;
        Ok(FolderMediaEntry {
            id: parse_uuid(&id)?,
            root_folder_id: parse_uuid(&root_folder_id)?,
            media_file_id: parse_uuid(&media_file_id)?,
            work_id: parse_uuid(&work_id)?,
            relative_path: row.try_get("relative_path")?,
            directory_path: row.try_get("directory_path")?,
            file_name: row.try_get("file_name")?,
            work_kind: work_kind_from_str(&work_kind)?,
            title: row.try_get("title")?,
            modified_at: modified_at.map(|raw| parse_datetime(&raw)).transpose()?,
            metadata: serde_json::from_str::<FolderFileMetadata>(&metadata)?,
            scanned_at: parse_datetime(&scanned_at)?,
            container: row.try_get("container")?,
            codec: row.try_get("codec")?,
            bitrate: bitrate.map(non_negative_u64),
            duration_ms: duration_ms.map(non_negative_u64),
            size_bytes: non_negative_u64(size_bytes),
            physical_path: PathBuf::from(physical_path),
        })
    }
}

const UPSERT_ROOT: &str = "INSERT INTO source_root_folders \
    (id, source_instance_id, source_root_id, reported_path, local_path_override, display_name, \
     work_kind, accessible, free_space_bytes, total_space_bytes, active, scan_enabled, \
     scan_status, last_scanned_at, scan_error, updated_at) \
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
    ON CONFLICT (source_instance_id, source_root_id) DO UPDATE SET \
    source_instance_id = excluded.source_instance_id, source_root_id = excluded.source_root_id, \
    reported_path = excluded.reported_path, local_path_override = excluded.local_path_override, \
    display_name = excluded.display_name, work_kind = excluded.work_kind, \
    accessible = excluded.accessible, free_space_bytes = excluded.free_space_bytes, \
    total_space_bytes = excluded.total_space_bytes, active = excluded.active, \
    scan_enabled = excluded.scan_enabled, scan_status = excluded.scan_status, \
    last_scanned_at = excluded.last_scanned_at, scan_error = excluded.scan_error, \
    updated_at = excluded.updated_at";

#[async_trait]
impl FolderRepo for SqlxFolderRepo {
    async fn sync_discovered_roots(
        &self,
        source_instance_id: Uuid,
        roots: &[DiscoveredRoot],
    ) -> Result<(), DbError> {
        let now = format_datetime(Utc::now());
        let mut tx = self.pool.begin().await?;
        sqlx::query(&self.q("UPDATE source_root_folders SET active = 0 \
             WHERE source_instance_id = ? AND source_root_id NOT LIKE 'manual:%'"))
        .bind(source_instance_id.to_string())
        .execute(&mut *tx)
        .await?;
        // Configuration and scan state survive: only what the source owns is
        // refreshed on conflict. The conflict target is the natural key the
        // table is unique on, not `id`: a row that already exists for this
        // source root under another id (an older id scheme, a replicated row,
        // a concurrent discovery) is updated in place and keeps its id, so
        // the entries that reference it stay attached.
        let upsert = self.q("INSERT INTO source_root_folders \
             (id, source_instance_id, source_root_id, reported_path, display_name, work_kind, \
              accessible, free_space_bytes, total_space_bytes, active, scan_enabled, scan_status, \
              updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'pending', ?) \
             ON CONFLICT (source_instance_id, source_root_id) DO UPDATE SET \
             reported_path = excluded.reported_path, display_name = excluded.display_name, \
             work_kind = excluded.work_kind, accessible = excluded.accessible, \
             free_space_bytes = excluded.free_space_bytes, \
             total_space_bytes = excluded.total_space_bytes, active = 1, \
             updated_at = excluded.updated_at");
        for root in roots {
            sqlx::query(&upsert)
                .bind(root.id.to_string())
                .bind(source_instance_id.to_string())
                .bind(root.source_root_id.as_str())
                .bind(root.reported_path.as_str())
                .bind(root.display_name.as_str())
                .bind(work_kind_to_str(root.work_kind))
                .bind(bool_to_i64(root.accessible))
                .bind(optional_i64(root.free_space_bytes)?)
                .bind(optional_i64(root.total_space_bytes)?)
                .bind(now.as_str())
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn upsert_root(&self, root: &SourceRootFolder) -> Result<(), DbError> {
        sqlx::query(&self.q(UPSERT_ROOT))
            .bind(root.id.to_string())
            .bind(root.source_instance_id.to_string())
            .bind(root.source_root_id.as_str())
            .bind(root.reported_path.as_str())
            .bind(
                root.local_path_override
                    .as_ref()
                    .map(|p| p.to_string_lossy().into_owned()),
            )
            .bind(root.display_name.as_str())
            .bind(work_kind_to_str(root.work_kind))
            .bind(bool_to_i64(root.accessible))
            .bind(optional_i64(root.free_space_bytes)?)
            .bind(optional_i64(root.total_space_bytes)?)
            .bind(bool_to_i64(root.active))
            .bind(bool_to_i64(root.scan_enabled))
            .bind(folder_scan_status_to_str(root.scan_status))
            .bind(root.last_scanned_at.map(format_datetime))
            .bind(root.scan_error.as_deref())
            .bind(format_datetime(root.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_root(&self, id: Uuid) -> Result<SourceRootFolder, DbError> {
        let row = sqlx::query(&self.q(&format!(
            "SELECT {ROOT_COLUMNS} FROM source_root_folders WHERE id = ?"
        )))
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(DbError::NotFound)?;
        Self::root_from_row(&row)
    }

    async fn list_roots(&self) -> Result<Vec<SourceRootFolder>, DbError> {
        let rows = sqlx::query(&format!(
            "SELECT {ROOT_COLUMNS} FROM source_root_folders ORDER BY work_kind, display_name, id"
        ))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::root_from_row).collect()
    }

    async fn update_root_config(
        &self,
        id: Uuid,
        update: &RootConfigUpdate,
    ) -> Result<SourceRootFolder, DbError> {
        let mut root = self.get_root(id).await?;
        if let Some(enabled) = update.scan_enabled {
            root.scan_enabled = enabled;
        }
        let path_changed = update.local_path_override.is_some();
        if let Some(path) = &update.local_path_override {
            root.local_path_override = path.clone();
        }
        if let Some(name) = &update.display_name {
            root.display_name = name.clone();
        }
        if path_changed {
            // A different directory invalidates the previous scan result.
            root.scan_status = FolderScanStatus::Pending;
            root.scan_error = None;
        }
        root.updated_at = Utc::now();
        self.upsert_root(&root).await?;
        Ok(root)
    }

    async fn delete_root(&self, id: Uuid) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        // Backing works cascade to media_files and then to entries.
        sqlx::query(&self.q(
            "DELETE FROM works WHERE id IN (SELECT m.work_id FROM folder_media_entries e \
             JOIN media_files m ON m.id = e.media_file_id WHERE e.root_folder_id = ?)",
        ))
        .bind(id.to_string())
        .execute(&mut *tx)
        .await?;
        let result = sqlx::query(&self.q("DELETE FROM source_root_folders WHERE id = ?"))
            .bind(id.to_string())
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        tx.commit().await?;
        Ok(())
    }

    async fn set_scan_state(
        &self,
        id: Uuid,
        status: FolderScanStatus,
        error: Option<&str>,
        scanned_at: Option<DateTime<Utc>>,
    ) -> Result<(), DbError> {
        sqlx::query(&self.q(
            "UPDATE source_root_folders SET scan_status = ?, scan_error = ?, \
             last_scanned_at = COALESCE(?, last_scanned_at) WHERE id = ?",
        ))
        .bind(folder_scan_status_to_str(status))
        .bind(error)
        .bind(scanned_at.map(format_datetime))
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn scan_index(&self, root_folder_id: Uuid) -> Result<Vec<ScanIndexRow>, DbError> {
        let rows = sqlx::query(
            &self.q("SELECT e.relative_path, e.modified_at, m.size_bytes \
             FROM folder_media_entries e JOIN media_files m ON m.id = e.media_file_id \
             WHERE e.root_folder_id = ?"),
        )
        .bind(root_folder_id.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                let modified_at: Option<String> = row.try_get("modified_at")?;
                let size: i64 = row.try_get("size_bytes")?;
                Ok(ScanIndexRow {
                    relative_path: row.try_get("relative_path")?,
                    size_bytes: non_negative_u64(size),
                    modified_at: modified_at.map(|raw| parse_datetime(&raw)).transpose()?,
                })
            })
            .collect()
    }

    async fn upsert_scanned_file(&self, file: &ScannedFolderFile) -> Result<(), DbError> {
        validate_relative_path(&file.relative_path)?;
        let (directory_path, file_name) = match file.relative_path.rsplit_once('/') {
            Some((dir, name)) => (dir.to_string(), name.to_string()),
            None => (String::new(), file.relative_path.clone()),
        };
        let metadata = serde_json::to_string(&file.metadata)?;
        let mut tx = self.pool.begin().await?;

        sqlx::query(&self.q(
            "INSERT INTO works (id, kind, title, sort_title, overview, images, genres, tags, \
             added_at, release_date, monitored, availability) \
             VALUES (?, ?, ?, ?, NULL, '[]', '[]', '[]', ?, NULL, 0, ?) \
             ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, title = excluded.title, \
             sort_title = excluded.sort_title, availability = excluded.availability",
        ))
        .bind(file.work_id.to_string())
        .bind(work_kind_to_str(file.work_kind))
        .bind(file.title.as_str())
        .bind(file.sort_title.as_str())
        .bind(format_datetime(file.scanned_at))
        .bind(availability_to_str(Availability::Available))
        .execute(&mut *tx)
        .await?;

        sqlx::query(&self.q("DELETE FROM work_external_refs WHERE work_id = ?"))
            .bind(file.work_id.to_string())
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            &self.q(
                "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES (?, ?, ?)",
            ),
        )
        .bind(file.work_id.to_string())
        .bind(provider_to_str(&folder_work_provider()))
        .bind(file.work_id.to_string())
        .execute(&mut *tx)
        .await?;

        let source_file_id = format!(
            "{FOLDER_SOURCE_FILE_PREFIX}{}:{}",
            file.root_folder_id, file.relative_path
        );
        sqlx::query(&self.q(
            "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, bitrate, \
             duration_ms, size_bytes, source_instance_id, source_file_id) \
             VALUES (?, ?, 'work', ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (id) DO UPDATE SET path = excluded.path, container = excluded.container, \
             codec = excluded.codec, bitrate = excluded.bitrate, \
             duration_ms = excluded.duration_ms, size_bytes = excluded.size_bytes, \
             source_instance_id = excluded.source_instance_id, \
             source_file_id = excluded.source_file_id",
        ))
        .bind(file.media_file_id.to_string())
        .bind(file.work_id.to_string())
        .bind(file.physical_path.to_string_lossy().into_owned())
        .bind(file.container.as_str())
        .bind(file.codec.as_str())
        .bind(optional_i64(file.bitrate)?)
        .bind(optional_i64(file.duration_ms)?)
        .bind(optional_i64(Some(file.size_bytes))?)
        .bind(file.source_instance_id.to_string())
        .bind(source_file_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(&self.q(
            "INSERT INTO folder_media_entries (id, root_folder_id, media_file_id, relative_path, \
             directory_path, file_name, work_kind, title, modified_at, metadata, scanned_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (id) DO UPDATE SET relative_path = excluded.relative_path, \
             directory_path = excluded.directory_path, file_name = excluded.file_name, \
             work_kind = excluded.work_kind, title = excluded.title, \
             modified_at = excluded.modified_at, metadata = excluded.metadata, \
             scanned_at = excluded.scanned_at",
        ))
        .bind(file.entry_id.to_string())
        .bind(file.root_folder_id.to_string())
        .bind(file.media_file_id.to_string())
        .bind(file.relative_path.as_str())
        .bind(directory_path)
        .bind(file_name)
        .bind(work_kind_to_str(file.work_kind))
        .bind(file.title.as_str())
        .bind(file.modified_at.map(format_datetime))
        .bind(metadata)
        .bind(format_datetime(file.scanned_at))
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    async fn remove_entries(
        &self,
        root_folder_id: Uuid,
        relative_paths: &[String],
    ) -> Result<u64, DbError> {
        let mut removed = 0;
        let mut tx = self.pool.begin().await?;
        for path in relative_paths {
            let result = sqlx::query(&self.q(
                "DELETE FROM works WHERE id IN (SELECT m.work_id FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id \
                 WHERE e.root_folder_id = ? AND e.relative_path = ?)",
            ))
            .bind(root_folder_id.to_string())
            .bind(path.as_str())
            .execute(&mut *tx)
            .await?;
            removed += result.rows_affected();
        }
        tx.commit().await?;
        Ok(removed)
    }

    async fn list_entries_under(
        &self,
        root_folder_id: Uuid,
        directory_path: &str,
    ) -> Result<Vec<FolderMediaEntry>, DbError> {
        let rows = if directory_path.is_empty() {
            sqlx::query(&self.q(&format!(
                "{ENTRY_SELECT} WHERE e.root_folder_id = ? ORDER BY e.relative_path"
            )))
            .bind(root_folder_id.to_string())
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(&self.q(&format!(
                "{ENTRY_SELECT} WHERE e.root_folder_id = ? \
                 AND (e.directory_path = ? OR e.directory_path LIKE ? ESCAPE '\\') \
                 ORDER BY e.relative_path"
            )))
            .bind(root_folder_id.to_string())
            .bind(directory_path)
            .bind(like_prefix(directory_path))
            .fetch_all(&self.pool)
            .await?
        };
        rows.iter().map(Self::entry_from_row).collect()
    }

    async fn find_entry_by_media_file_id(
        &self,
        media_file_id: Uuid,
    ) -> Result<Option<FolderMediaEntry>, DbError> {
        let row = sqlx::query(&self.q(&format!("{ENTRY_SELECT} WHERE e.media_file_id = ?")))
            .bind(media_file_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::entry_from_row).transpose()
    }

    async fn count_entries(&self, root_folder_id: Uuid) -> Result<u64, DbError> {
        let row = sqlx::query(
            &self.q("SELECT COUNT(*) AS n FROM folder_media_entries WHERE root_folder_id = ?"),
        )
        .bind(root_folder_id.to_string())
        .fetch_one(&self.pool)
        .await?;
        let n: i64 = row.try_get("n")?;
        Ok(non_negative_u64(n))
    }
}

/// Rejects anything but a normalised, root-relative `a/b/c.ext` path.
fn validate_relative_path(path: &str) -> Result<(), DbError> {
    let bad = path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..");
    if bad {
        return Err(DbError::Conflict(format!(
            "folder entry path {path:?} is not a normalised relative path"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::{
        MediaFileRepo, SourceInstanceRepo, SqlxMediaFileRepo, SqlxSourceInstanceRepo,
    };
    use playarr_model::{Sensitive, SourceInstance, SourceKind};
    use std::collections::BTreeMap;

    async fn fixture() -> (SqlxFolderRepo, SqlxMediaFileRepo, DbPool, Uuid) {
        let pool = test_sqlite_pool().await;
        let source = SourceInstance {
            id: Uuid::new_v4(),
            kind: SourceKind::Radarr,
            name: "Sample Source".into(),
            base_url: "https://source.example".into(),
            api_key_encrypted: Sensitive::new("key".into()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: BTreeMap::new(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        };
        SqlxSourceInstanceRepo::new(pool.clone())
            .upsert(&source)
            .await
            .unwrap();
        (
            SqlxFolderRepo::new(pool.clone()),
            SqlxMediaFileRepo::new(pool.clone()),
            pool,
            source.id,
        )
    }

    fn discovered(id: Uuid, name: &str, rid: &str) -> DiscoveredRoot {
        DiscoveredRoot {
            id,
            source_root_id: rid.into(),
            reported_path: format!("/library/{name}"),
            display_name: name.into(),
            work_kind: WorkKind::Movie,
            accessible: true,
            free_space_bytes: Some(10),
            total_space_bytes: Some(20),
        }
    }

    fn scanned(root: Uuid, source: Uuid, rel: &str, size: u64) -> ScannedFolderFile {
        let key = Uuid::new_v5(&root, rel.as_bytes());
        ScannedFolderFile {
            entry_id: Uuid::new_v5(&key, b"entry"),
            work_id: Uuid::new_v5(&key, b"work"),
            media_file_id: Uuid::new_v5(&key, b"file"),
            root_folder_id: root,
            source_instance_id: source,
            physical_path: PathBuf::from(format!("/library/{rel}")),
            relative_path: rel.into(),
            work_kind: WorkKind::Movie,
            title: rel.rsplit('/').next().unwrap().into(),
            sort_title: rel.to_lowercase(),
            container: "mkv".into(),
            codec: "h264".into(),
            bitrate: Some(1000),
            duration_ms: Some(5000),
            size_bytes: size,
            modified_at: None,
            metadata: FolderFileMetadata::default(),
            scanned_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn discovery_preserves_admin_config_and_deactivates_vanished_roots() {
        let (repo, _files, _pool, source) = fixture().await;
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        repo.sync_discovered_roots(
            source,
            &[discovered(a, "Alpha", "1"), discovered(b, "Beta", "2")],
        )
        .await
        .unwrap();
        repo.update_root_config(
            a,
            &RootConfigUpdate {
                scan_enabled: Some(true),
                local_path_override: Some(Some(PathBuf::from("/srv/alpha"))),
                display_name: None,
            },
        )
        .await
        .unwrap();
        repo.sync_discovered_roots(source, &[discovered(a, "Alpha renamed", "1")])
            .await
            .unwrap();
        let roots = repo.list_roots().await.unwrap();
        let alpha = roots.iter().find(|r| r.id == a).unwrap();
        assert!(alpha.active && alpha.scan_enabled);
        assert_eq!(alpha.display_name, "Alpha renamed");
        assert_eq!(alpha.local_path(), PathBuf::from("/srv/alpha"));
        assert!(!roots.iter().find(|r| r.id == b).unwrap().active);
    }

    #[tokio::test]
    async fn discovery_adopts_existing_rows_under_another_id() {
        let (repo, _files, _pool, source) = fixture().await;
        let old = Uuid::new_v4();
        // A row already present for the same source root, with a different id.
        repo.sync_discovered_roots(source, &[discovered(old, "Alpha", "1")])
            .await
            .unwrap();
        repo.update_root_config(
            old,
            &RootConfigUpdate {
                scan_enabled: Some(true),
                local_path_override: None,
                display_name: None,
            },
        )
        .await
        .unwrap();
        let fresh = Uuid::new_v4();
        repo.sync_discovered_roots(
            source,
            &[
                discovered(fresh, "Alpha renamed", "1"),
                discovered(Uuid::new_v4(), "Beta", "2"),
            ],
        )
        .await
        .unwrap();
        // Idempotent: a third run changes nothing structurally.
        repo.sync_discovered_roots(source, &[discovered(fresh, "Alpha renamed", "1")])
            .await
            .unwrap();
        let roots = repo.list_roots().await.unwrap();
        let alpha: Vec<_> = roots.iter().filter(|r| r.source_root_id == "1").collect();
        assert_eq!(alpha.len(), 1);
        assert_eq!(alpha[0].id, old, "the existing row keeps its id");
        assert_eq!(alpha[0].display_name, "Alpha renamed");
        assert!(alpha[0].scan_enabled && alpha[0].active);
        assert_eq!(roots.len(), 2);
    }

    #[tokio::test]
    async fn concurrent_discoveries_do_not_collide() {
        let (repo, _files, _pool, source) = fixture().await;
        let repo = std::sync::Arc::new(repo);
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let repo = repo.clone();
            tasks.push(tokio::spawn(async move {
                repo.sync_discovered_roots(
                    source,
                    &[
                        discovered(Uuid::new_v4(), "Alpha", "1"),
                        discovered(Uuid::new_v4(), "Beta", "2"),
                    ],
                )
                .await
            }));
        }
        for task in tasks {
            task.await.unwrap().unwrap();
        }
        assert_eq!(repo.list_roots().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn scanned_files_round_trip_and_stay_out_of_catalogue_listings() {
        let (repo, files, pool, source) = fixture().await;
        let root = Uuid::new_v4();
        repo.sync_discovered_roots(source, &[discovered(root, "Alpha", "1")])
            .await
            .unwrap();
        let file = scanned(root, source, "Sub Dir/Sample Clip 01.mkv", 42);
        repo.upsert_scanned_file(&file).await.unwrap();
        repo.upsert_scanned_file(&file).await.unwrap();
        assert_eq!(repo.count_entries(root).await.unwrap(), 1);

        let entry = repo
            .find_entry_by_media_file_id(file.media_file_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(entry.directory_path, "Sub Dir");
        assert_eq!(entry.file_name, "Sample Clip 01.mkv");
        assert_eq!(entry.size_bytes, 42);
        assert_eq!(
            files.get_by_id(file.media_file_id).await.unwrap().work_id,
            file.work_id
        );

        use crate::repo::{SqlxWorkRepo, WorkRepo};
        let works = SqlxWorkRepo::new(pool);
        assert!(works
            .list_by_kind(WorkKind::Movie, 10, 0)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(works.get(file.work_id).await.unwrap().id, file.work_id);
    }

    #[tokio::test]
    async fn subtree_listing_and_incremental_index_and_removal() {
        let (repo, _files, _pool, source) = fixture().await;
        let root = Uuid::new_v4();
        repo.sync_discovered_roots(source, &[discovered(root, "Alpha", "1")])
            .await
            .unwrap();
        for rel in [
            "a.mkv",
            "Dir/b.mkv",
            "Dir/Deep/c.mkv",
            "Dir_x/d.mkv",
            "100%/e.mkv",
        ] {
            repo.upsert_scanned_file(&scanned(root, source, rel, 1))
                .await
                .unwrap();
        }
        let under_dir = repo.list_entries_under(root, "Dir").await.unwrap();
        let paths: Vec<_> = under_dir.iter().map(|e| e.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["Dir/Deep/c.mkv", "Dir/b.mkv"]);
        assert_eq!(
            repo.list_entries_under(root, "100%").await.unwrap().len(),
            1
        );
        assert_eq!(repo.list_entries_under(root, "").await.unwrap().len(), 5);
        assert_eq!(repo.scan_index(root).await.unwrap().len(), 5);

        let removed = repo
            .remove_entries(root, &["Dir/b.mkv".to_string(), "missing.mkv".to_string()])
            .await
            .unwrap();
        assert_eq!(removed, 1);
        assert_eq!(repo.count_entries(root).await.unwrap(), 4);
        repo.delete_root(root).await.unwrap();
        assert!(matches!(repo.get_root(root).await, Err(DbError::NotFound)));
    }

    #[tokio::test]
    async fn traversal_paths_are_rejected() {
        let (repo, _files, _pool, source) = fixture().await;
        let root = Uuid::new_v4();
        repo.sync_discovered_roots(source, &[discovered(root, "Alpha", "1")])
            .await
            .unwrap();
        for bad in ["../x.mkv", "/abs.mkv", "a//b.mkv", "a/./b.mkv", ""] {
            let mut file = scanned(root, source, "ok.mkv", 1);
            file.relative_path = bad.into();
            assert!(repo.upsert_scanned_file(&file).await.is_err(), "{bad}");
        }
    }
}
