use std::collections::BTreeMap;
use std::path::{Component, PathBuf};

use async_trait::async_trait;
use playarr_model::media::LeafRef;
use playarr_model::{
    folder_work_provider, Availability, FolderFileMetadata, FolderMediaEntry, ScannedFolderFile,
    SourceRootFolder,
};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    availability_to_str, bool_from_i64, bool_to_i64, folder_scan_status_from_str,
    folder_scan_status_to_str, format_datetime, leaf_ref_to_str, parse_datetime, parse_uuid,
    provider_to_str, work_kind_from_str, work_kind_to_str,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

const ROOT_COLUMNS: &str = "id, source_instance_id, source_root_id, reported_path, \
    local_path_override, display_name, work_kind, accessible, free_space_bytes, \
    total_space_bytes, active, scan_status, last_scanned_at, scan_error, updated_at";

const ENTRY_COLUMNS: &str = "e.id, e.root_folder_id, e.media_file_id, m.work_id AS work_id, \
    e.relative_path, e.directory_path, e.file_name, e.work_kind, e.title, e.modified_at, \
    e.metadata, e.scanned_at";

const FOLDER_SOURCE_FILE_PREFIX: &str = "playarr_folder:";

/// Persistence boundary for source-root discovery and the file-derived folder
/// browse cache.
#[async_trait]
pub trait FolderRepo: Send + Sync {
    /// Atomically replaces the active root set for one source instance.
    ///
    /// Previously known roots are marked inactive rather than deleted so an
    /// unchanged scan cache can be reused if a temporarily absent root
    /// returns. Every supplied root is forced active; `root.active` is a
    /// hydrated-state field rather than an instruction to this method.
    async fn replace_active_roots(
        &self,
        source_instance_id: Uuid,
        roots: &[SourceRootFolder],
    ) -> Result<(), DbError>;

    async fn list_active_roots(&self) -> Result<Vec<SourceRootFolder>, DbError>;

    async fn list_active_roots_by_source(
        &self,
        source_instance_id: Uuid,
    ) -> Result<Vec<SourceRootFolder>, DbError>;

    /// Cache lookup by the source application's own root-folder identifier.
    async fn find_active_root(
        &self,
        source_instance_id: Uuid,
        source_root_id: &str,
    ) -> Result<Option<SourceRootFolder>, DbError>;

    /// Atomically replaces every explicit current-node path override for one
    /// source. An empty map clears all overrides. Every supplied root must be
    /// active and owned by `source_instance_id`; validation completes before
    /// the existing override set is changed.
    async fn replace_local_path_overrides(
        &self,
        source_instance_id: Uuid,
        overrides: &BTreeMap<Uuid, PathBuf>,
    ) -> Result<(), DbError>;

    /// Atomically persists one scanned file as:
    ///
    /// 1. a hidden backing `Work` carrying the reserved
    ///    `ExternalProvider::Other("playarr_folder")` identity;
    /// 2. a normal `MediaFile` usable by playback/download/thumbnail paths;
    /// 3. a safe root-relative `FolderMediaEntry`.
    ///
    /// No identifier is generated here. Callers must provide deterministic
    /// entry, work and media-file UUIDs.
    async fn upsert_scanned_file(
        &self,
        file: &ScannedFolderFile,
    ) -> Result<FolderMediaEntry, DbError>;

    async fn get_media_entry(&self, id: Uuid) -> Result<FolderMediaEntry, DbError>;

    async fn find_media_entry(
        &self,
        root_folder_id: Uuid,
        relative_path: &str,
    ) -> Result<Option<FolderMediaEntry>, DbError>;

    /// Reverse lookup used to authorise playback, download and thumbnail
    /// requests that start with an existing media-file id.
    async fn find_media_entry_by_media_file_id(
        &self,
        media_file_id: Uuid,
    ) -> Result<Option<FolderMediaEntry>, DbError>;

    async fn list_media_entries(
        &self,
        root_folder_id: Uuid,
    ) -> Result<Vec<FolderMediaEntry>, DbError>;
}

pub struct SqlxFolderRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxFolderRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn root_from_row(row: &AnyRow) -> Result<SourceRootFolder, DbError> {
        let id: String = row.try_get("id")?;
        let source_instance_id: String = row.try_get("source_instance_id")?;
        let reported_path: String = row.try_get("reported_path")?;
        let local_path_override: Option<String> = row.try_get("local_path_override")?;
        let work_kind: String = row.try_get("work_kind")?;
        let accessible: i64 = row.try_get("accessible")?;
        let free_space_bytes: Option<i64> = row.try_get("free_space_bytes")?;
        let total_space_bytes: Option<i64> = row.try_get("total_space_bytes")?;
        let active: i64 = row.try_get("active")?;
        let scan_status: String = row.try_get("scan_status")?;
        let last_scanned_at: Option<String> = row.try_get("last_scanned_at")?;
        let updated_at: String = row.try_get("updated_at")?;

        Ok(SourceRootFolder {
            id: parse_uuid(&id)?,
            source_instance_id: parse_uuid(&source_instance_id)?,
            source_root_id: row.try_get("source_root_id")?,
            reported_path,
            local_path_override: local_path_override.map(PathBuf::from),
            display_name: row.try_get("display_name")?,
            work_kind: work_kind_from_str(&work_kind)?,
            accessible: bool_from_i64(accessible),
            free_space_bytes: free_space_bytes.map(non_negative_u64),
            total_space_bytes: total_space_bytes.map(non_negative_u64),
            active: bool_from_i64(active),
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
        })
    }

    async fn get_root(&self, id: Uuid) -> Result<SourceRootFolder, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                format!("SELECT {ROOT_COLUMNS} FROM source_root_folders WHERE id = ?")
            }
            Backend::Postgres => {
                format!("SELECT {ROOT_COLUMNS} FROM source_root_folders WHERE id = $1")
            }
        };
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::root_from_row(&row)
    }

    async fn fetch_optional_entry(
        &self,
        sql: &str,
        first: String,
        second: Option<String>,
    ) -> Result<Option<FolderMediaEntry>, DbError> {
        let mut query = sqlx::query(sql).bind(first);
        if let Some(second) = second {
            query = query.bind(second);
        }
        let row = query.fetch_optional(&self.pool).await?;
        row.as_ref().map(Self::entry_from_row).transpose()
    }
}

#[async_trait]
impl FolderRepo for SqlxFolderRepo {
    async fn replace_active_roots(
        &self,
        source_instance_id: Uuid,
        roots: &[SourceRootFolder],
    ) -> Result<(), DbError> {
        for root in roots {
            if root.source_instance_id != source_instance_id {
                return Err(DbError::Conflict(format!(
                    "root {} belongs to source {}, not replacement source {}",
                    root.id, root.source_instance_id, source_instance_id
                )));
            }
        }

        let mut tx = self.pool.begin().await?;
        let deactivate_sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE source_root_folders SET active = 0 WHERE source_instance_id = ?"
            }
            Backend::Postgres => {
                "UPDATE source_root_folders SET active = 0 WHERE source_instance_id = $1"
            }
        };
        sqlx::query(deactivate_sql)
            .bind(source_instance_id.to_string())
            .execute(&mut *tx)
            .await?;

        let upsert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO source_root_folders \
                 (id, source_instance_id, source_root_id, reported_path, local_path_override, \
                  display_name, work_kind, accessible, free_space_bytes, \
                  total_space_bytes, active, scan_status, last_scanned_at, scan_error, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 source_instance_id = excluded.source_instance_id, \
                 source_root_id = excluded.source_root_id, \
                 reported_path = excluded.reported_path, \
                 display_name = excluded.display_name, work_kind = excluded.work_kind, \
                 accessible = excluded.accessible, free_space_bytes = excluded.free_space_bytes, \
                 total_space_bytes = excluded.total_space_bytes, active = 1, \
                 scan_status = CASE \
                     WHEN source_root_folders.local_path_override IS NOT NULL THEN 'pending' \
                     ELSE excluded.scan_status END, \
                 last_scanned_at = excluded.last_scanned_at, \
                 scan_error = CASE \
                     WHEN source_root_folders.local_path_override IS NOT NULL THEN NULL \
                     ELSE excluded.scan_error END, \
                 updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO source_root_folders \
                 (id, source_instance_id, source_root_id, reported_path, local_path_override, \
                  display_name, work_kind, accessible, free_space_bytes, \
                  total_space_bytes, active, scan_status, last_scanned_at, scan_error, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12, $13, $14) \
                 ON CONFLICT (id) DO UPDATE SET \
                 source_instance_id = excluded.source_instance_id, \
                 source_root_id = excluded.source_root_id, \
                 reported_path = excluded.reported_path, \
                 display_name = excluded.display_name, work_kind = excluded.work_kind, \
                 accessible = excluded.accessible, free_space_bytes = excluded.free_space_bytes, \
                 total_space_bytes = excluded.total_space_bytes, active = 1, \
                 scan_status = CASE \
                     WHEN source_root_folders.local_path_override IS NOT NULL THEN 'pending' \
                     ELSE excluded.scan_status END, \
                 last_scanned_at = excluded.last_scanned_at, \
                 scan_error = CASE \
                     WHEN source_root_folders.local_path_override IS NOT NULL THEN NULL \
                     ELSE excluded.scan_error END, \
                 updated_at = excluded.updated_at"
            }
        };

        for root in roots {
            sqlx::query(upsert_sql)
                .bind(root.id.to_string())
                .bind(root.source_instance_id.to_string())
                .bind(root.source_root_id.as_str())
                .bind(root.reported_path.as_str())
                .bind(
                    root.local_path_override
                        .as_ref()
                        .map(|path| path.to_string_lossy().into_owned()),
                )
                .bind(root.display_name.as_str())
                .bind(work_kind_to_str(root.work_kind))
                .bind(bool_to_i64(root.accessible))
                .bind(optional_i64(
                    root.free_space_bytes,
                    "free-space byte count",
                )?)
                .bind(optional_i64(
                    root.total_space_bytes,
                    "total-space byte count",
                )?)
                .bind(folder_scan_status_to_str(root.scan_status))
                .bind(root.last_scanned_at.map(format_datetime))
                .bind(root.scan_error.as_deref())
                .bind(format_datetime(root.updated_at))
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    async fn list_active_roots(&self) -> Result<Vec<SourceRootFolder>, DbError> {
        let sql = format!(
            "SELECT {ROOT_COLUMNS} FROM source_root_folders \
             WHERE active = 1 ORDER BY work_kind, display_name, id"
        );
        let rows = sqlx::query(&sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::root_from_row).collect()
    }

    async fn list_active_roots_by_source(
        &self,
        source_instance_id: Uuid,
    ) -> Result<Vec<SourceRootFolder>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {ROOT_COLUMNS} FROM source_root_folders \
                 WHERE active = 1 AND source_instance_id = ? ORDER BY work_kind, display_name, id"
            ),
            Backend::Postgres => format!(
                "SELECT {ROOT_COLUMNS} FROM source_root_folders \
                 WHERE active = 1 AND source_instance_id = $1 ORDER BY work_kind, display_name, id"
            ),
        };
        let rows = sqlx::query(&sql)
            .bind(source_instance_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::root_from_row).collect()
    }

    async fn find_active_root(
        &self,
        source_instance_id: Uuid,
        source_root_id: &str,
    ) -> Result<Option<SourceRootFolder>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {ROOT_COLUMNS} FROM source_root_folders \
                 WHERE active = 1 AND source_instance_id = ? AND source_root_id = ?"
            ),
            Backend::Postgres => format!(
                "SELECT {ROOT_COLUMNS} FROM source_root_folders \
                 WHERE active = 1 AND source_instance_id = $1 AND source_root_id = $2"
            ),
        };
        let row = sqlx::query(&sql)
            .bind(source_instance_id.to_string())
            .bind(source_root_id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::root_from_row).transpose()
    }

    async fn replace_local_path_overrides(
        &self,
        source_instance_id: Uuid,
        overrides: &BTreeMap<Uuid, PathBuf>,
    ) -> Result<(), DbError> {
        // Validate the complete replacement before opening the transaction so
        // one bad id or path cannot clear otherwise valid existing overrides.
        for (root_id, path) in overrides {
            if !valid_local_root_path(path) {
                return Err(DbError::Conflict(format!(
                    "local override for root {root_id} must be an absolute normal path"
                )));
            }
            let root = self.get_root(*root_id).await?;
            if root.source_instance_id != source_instance_id {
                return Err(DbError::Conflict(format!(
                    "root {root_id} does not belong to source {source_instance_id}"
                )));
            }
            if !root.active {
                return Err(DbError::Conflict(format!(
                    "root {root_id} is no longer active"
                )));
            }
        }

        let updated_at = format_datetime(chrono::Utc::now());
        let mut tx = self.pool.begin().await?;
        let clear_sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE source_root_folders SET \
                 local_path_override = NULL, \
                 scan_status = 'pending', scan_error = NULL, \
                 updated_at = ? \
                 WHERE source_instance_id = ?"
            }
            Backend::Postgres => {
                "UPDATE source_root_folders SET \
                 local_path_override = NULL, \
                 scan_status = 'pending', scan_error = NULL, \
                 updated_at = $1 \
                 WHERE source_instance_id = $2"
            }
        };
        sqlx::query(clear_sql)
            .bind(updated_at.clone())
            .bind(source_instance_id.to_string())
            .execute(&mut *tx)
            .await?;

        let set_sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE source_root_folders SET local_path_override = ?, \
                 scan_status = 'pending', scan_error = NULL, updated_at = ? \
                 WHERE id = ? AND source_instance_id = ? AND active = 1"
            }
            Backend::Postgres => {
                "UPDATE source_root_folders SET local_path_override = $1, \
                 scan_status = 'pending', scan_error = NULL, updated_at = $2 \
                 WHERE id = $3 AND source_instance_id = $4 AND active = 1"
            }
        };
        for (root_id, path) in overrides {
            let result = sqlx::query(set_sql)
                .bind(path.to_string_lossy().into_owned())
                .bind(updated_at.clone())
                .bind(root_id.to_string())
                .bind(source_instance_id.to_string())
                .execute(&mut *tx)
                .await?;
            if result.rows_affected() != 1 {
                return Err(DbError::Conflict(format!(
                    "root {root_id} changed while replacing its local path override"
                )));
            }
        }

        tx.commit().await?;
        Ok(())
    }

    async fn upsert_scanned_file(
        &self,
        file: &ScannedFolderFile,
    ) -> Result<FolderMediaEntry, DbError> {
        let (relative_path, directory_path, file_name) =
            normalise_relative_path(&file.relative_path)?;
        let root = self.get_root(file.root_folder_id).await?;
        if !root.active {
            return Err(DbError::Conflict(format!(
                "root {} is no longer active",
                root.id
            )));
        }
        if !root.accessible {
            return Err(DbError::Conflict(format!(
                "root {} is not accessible",
                root.id
            )));
        }
        if root.work_kind != file.work_kind {
            return Err(DbError::Conflict(format!(
                "file kind {:?} does not match root kind {:?}",
                file.work_kind, root.work_kind
            )));
        }

        let physical_path = file.physical_path.clone();
        if !physical_path.is_absolute() {
            return Err(DbError::Conflict(
                "folder media physical path must be absolute".to_string(),
            ));
        }
        let metadata = serde_json::to_string(&file.metadata)?;
        let provider = provider_to_str(&folder_work_provider());
        let external_id = file.entry_id.to_string();
        let source_file_id = format!("{FOLDER_SOURCE_FILE_PREFIX}{}", file.entry_id);
        let title = if file.title.trim().is_empty() {
            file_name.clone()
        } else {
            file.title.clone()
        };
        let sort_title = if file.sort_title.trim().is_empty() {
            title.clone()
        } else {
            file.sort_title.clone()
        };
        let added_at = file.modified_at.unwrap_or(file.scanned_at);

        let bitrate = optional_i64(file.bitrate, "file bitrate")?;
        let duration_ms = optional_i64(file.duration_ms, "file duration")?;
        let size_bytes = required_i64(file.size_bytes, "file size")?;

        let mut tx = self.pool.begin().await?;

        // Deterministic ids make collisions a caller or data-integrity bug.
        // Refuse to overwrite an unrelated normal Work/MediaFile if one ever
        // occurs instead of silently converting it into folder backing data.
        let work_collision_sql = match self.backend {
            Backend::Sqlite => {
                "SELECT COUNT(*) AS count FROM works w WHERE w.id = ? \
                 AND NOT EXISTS (SELECT 1 FROM work_external_refs r \
                                 WHERE r.work_id = w.id AND r.provider = ? AND r.external_id = ?)"
            }
            Backend::Postgres => {
                "SELECT COUNT(*) AS count FROM works w WHERE w.id = $1 \
                 AND NOT EXISTS (SELECT 1 FROM work_external_refs r \
                                 WHERE r.work_id = w.id AND r.provider = $2 AND r.external_id = $3)"
            }
        };
        let collision: i64 = sqlx::query(work_collision_sql)
            .bind(file.work_id.to_string())
            .bind(provider.as_str())
            .bind(external_id.as_str())
            .fetch_one(&mut *tx)
            .await?
            .try_get("count")?;
        if collision != 0 {
            return Err(DbError::Conflict(format!(
                "work id {} is not the backing work for folder entry {}",
                file.work_id, file.entry_id
            )));
        }

        let media_collision_sql = match self.backend {
            Backend::Sqlite => {
                "SELECT COUNT(*) AS count FROM media_files WHERE id = ? \
                 AND (source_instance_id <> ? OR source_file_id IS NULL OR source_file_id <> ?)"
            }
            Backend::Postgres => {
                "SELECT COUNT(*) AS count FROM media_files WHERE id = $1 \
                 AND (source_instance_id <> $2 OR source_file_id IS NULL OR source_file_id <> $3)"
            }
        };
        let collision: i64 = sqlx::query(media_collision_sql)
            .bind(file.media_file_id.to_string())
            .bind(root.source_instance_id.to_string())
            .bind(source_file_id.as_str())
            .fetch_one(&mut *tx)
            .await?
            .try_get("count")?;
        if collision != 0 {
            return Err(DbError::Conflict(format!(
                "media-file id {} is not owned by folder entry {}",
                file.media_file_id, file.entry_id
            )));
        }

        let entry_collision_sql = match self.backend {
            Backend::Sqlite => {
                "SELECT COUNT(*) AS count FROM folder_media_entries WHERE id = ? \
                 AND (root_folder_id <> ? OR relative_path <> ?)"
            }
            Backend::Postgres => {
                "SELECT COUNT(*) AS count FROM folder_media_entries WHERE id = $1 \
                 AND (root_folder_id <> $2 OR relative_path <> $3)"
            }
        };
        let collision: i64 = sqlx::query(entry_collision_sql)
            .bind(file.entry_id.to_string())
            .bind(file.root_folder_id.to_string())
            .bind(relative_path.as_str())
            .fetch_one(&mut *tx)
            .await?
            .try_get("count")?;
        if collision != 0 {
            return Err(DbError::Conflict(format!(
                "folder entry id {} is already assigned to another path",
                file.entry_id
            )));
        }

        let upsert_work_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO works \
                 (id, kind, title, sort_title, overview, images, genres, tags, added_at, \
                  release_date, monitored, availability) \
                 VALUES (?, ?, ?, ?, NULL, '[]', '[]', '[]', ?, NULL, 0, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 kind = excluded.kind, title = excluded.title, sort_title = excluded.sort_title, \
                 overview = NULL, images = '[]', genres = '[]', tags = '[]', \
                 added_at = excluded.added_at, release_date = NULL, monitored = 0, \
                 availability = excluded.availability"
            }
            Backend::Postgres => {
                "INSERT INTO works \
                 (id, kind, title, sort_title, overview, images, genres, tags, added_at, \
                  release_date, monitored, availability) \
                 VALUES ($1, $2, $3, $4, NULL, '[]', '[]', '[]', $5, NULL, 0, $6) \
                 ON CONFLICT (id) DO UPDATE SET \
                 kind = excluded.kind, title = excluded.title, sort_title = excluded.sort_title, \
                 overview = NULL, images = '[]', genres = '[]', tags = '[]', \
                 added_at = excluded.added_at, release_date = NULL, monitored = 0, \
                 availability = excluded.availability"
            }
        };
        sqlx::query(upsert_work_sql)
            .bind(file.work_id.to_string())
            .bind(work_kind_to_str(file.work_kind))
            .bind(title.as_str())
            .bind(sort_title.as_str())
            .bind(format_datetime(added_at))
            .bind(availability_to_str(Availability::Available))
            .execute(&mut *tx)
            .await?;

        let delete_refs_sql = match self.backend {
            Backend::Sqlite => "DELETE FROM work_external_refs WHERE work_id = ?",
            Backend::Postgres => "DELETE FROM work_external_refs WHERE work_id = $1",
        };
        sqlx::query(delete_refs_sql)
            .bind(file.work_id.to_string())
            .execute(&mut *tx)
            .await?;

        let insert_ref_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES (?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES ($1, $2, $3)"
            }
        };
        sqlx::query(insert_ref_sql)
            .bind(file.work_id.to_string())
            .bind(provider.as_str())
            .bind(external_id.as_str())
            .execute(&mut *tx)
            .await?;

        let upsert_media_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO media_files \
                 (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                  source_instance_id, source_file_id) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 work_id = excluded.work_id, leaf_ref = excluded.leaf_ref, path = excluded.path, \
                 container = excluded.container, codec = excluded.codec, \
                 bitrate = excluded.bitrate, duration_ms = excluded.duration_ms, \
                 size_bytes = excluded.size_bytes, \
                 source_instance_id = excluded.source_instance_id, \
                 source_file_id = excluded.source_file_id"
            }
            Backend::Postgres => {
                "INSERT INTO media_files \
                 (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, \
                  source_instance_id, source_file_id) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (id) DO UPDATE SET \
                 work_id = excluded.work_id, leaf_ref = excluded.leaf_ref, path = excluded.path, \
                 container = excluded.container, codec = excluded.codec, \
                 bitrate = excluded.bitrate, duration_ms = excluded.duration_ms, \
                 size_bytes = excluded.size_bytes, \
                 source_instance_id = excluded.source_instance_id, \
                 source_file_id = excluded.source_file_id"
            }
        };
        sqlx::query(upsert_media_sql)
            .bind(file.media_file_id.to_string())
            .bind(file.work_id.to_string())
            .bind(leaf_ref_to_str(&LeafRef::Work))
            .bind(physical_path.to_string_lossy().into_owned())
            .bind(file.container.as_str())
            .bind(file.codec.as_str())
            .bind(bitrate)
            .bind(duration_ms)
            .bind(size_bytes)
            .bind(root.source_instance_id.to_string())
            .bind(source_file_id.as_str())
            .execute(&mut *tx)
            .await?;

        let upsert_entry_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO folder_media_entries \
                 (id, root_folder_id, media_file_id, relative_path, directory_path, file_name, \
                  work_kind, title, modified_at, metadata, scanned_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 root_folder_id = excluded.root_folder_id, \
                 media_file_id = excluded.media_file_id, \
                 relative_path = excluded.relative_path, \
                 directory_path = excluded.directory_path, file_name = excluded.file_name, \
                 work_kind = excluded.work_kind, title = excluded.title, \
                 modified_at = excluded.modified_at, metadata = excluded.metadata, \
                 scanned_at = excluded.scanned_at"
            }
            Backend::Postgres => {
                "INSERT INTO folder_media_entries \
                 (id, root_folder_id, media_file_id, relative_path, directory_path, file_name, \
                  work_kind, title, modified_at, metadata, scanned_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (id) DO UPDATE SET \
                 root_folder_id = excluded.root_folder_id, \
                 media_file_id = excluded.media_file_id, \
                 relative_path = excluded.relative_path, \
                 directory_path = excluded.directory_path, file_name = excluded.file_name, \
                 work_kind = excluded.work_kind, title = excluded.title, \
                 modified_at = excluded.modified_at, metadata = excluded.metadata, \
                 scanned_at = excluded.scanned_at"
            }
        };
        sqlx::query(upsert_entry_sql)
            .bind(file.entry_id.to_string())
            .bind(file.root_folder_id.to_string())
            .bind(file.media_file_id.to_string())
            .bind(relative_path.as_str())
            .bind(directory_path.as_str())
            .bind(file_name.as_str())
            .bind(work_kind_to_str(file.work_kind))
            .bind(title.as_str())
            .bind(file.modified_at.map(format_datetime))
            .bind(metadata)
            .bind(format_datetime(file.scanned_at))
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        self.get_media_entry(file.entry_id).await
    }

    async fn get_media_entry(&self, id: Uuid) -> Result<FolderMediaEntry, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {ENTRY_COLUMNS} FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id WHERE e.id = ?"
            ),
            Backend::Postgres => format!(
                "SELECT {ENTRY_COLUMNS} FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id WHERE e.id = $1"
            ),
        };
        self.fetch_optional_entry(&sql, id.to_string(), None)
            .await?
            .ok_or(DbError::NotFound)
    }

    async fn find_media_entry(
        &self,
        root_folder_id: Uuid,
        relative_path: &str,
    ) -> Result<Option<FolderMediaEntry>, DbError> {
        let (relative_path, _, _) = normalise_relative_path(relative_path)?;
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {ENTRY_COLUMNS} FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id \
                 WHERE e.root_folder_id = ? AND e.relative_path = ?"
            ),
            Backend::Postgres => format!(
                "SELECT {ENTRY_COLUMNS} FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id \
                 WHERE e.root_folder_id = $1 AND e.relative_path = $2"
            ),
        };
        self.fetch_optional_entry(&sql, root_folder_id.to_string(), Some(relative_path))
            .await
    }

    async fn find_media_entry_by_media_file_id(
        &self,
        media_file_id: Uuid,
    ) -> Result<Option<FolderMediaEntry>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {ENTRY_COLUMNS} FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id WHERE e.media_file_id = ?"
            ),
            Backend::Postgres => format!(
                "SELECT {ENTRY_COLUMNS} FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id WHERE e.media_file_id = $1"
            ),
        };
        self.fetch_optional_entry(&sql, media_file_id.to_string(), None)
            .await
    }

    async fn list_media_entries(
        &self,
        root_folder_id: Uuid,
    ) -> Result<Vec<FolderMediaEntry>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {ENTRY_COLUMNS} FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id \
                 WHERE e.root_folder_id = ? \
                 ORDER BY e.directory_path, e.file_name, e.id"
            ),
            Backend::Postgres => format!(
                "SELECT {ENTRY_COLUMNS} FROM folder_media_entries e \
                 JOIN media_files m ON m.id = e.media_file_id \
                 WHERE e.root_folder_id = $1 \
                 ORDER BY e.directory_path, e.file_name, e.id"
            ),
        };
        let rows = sqlx::query(&sql)
            .bind(root_folder_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::entry_from_row).collect()
    }
}

fn valid_local_root_path(path: &std::path::Path) -> bool {
    path.is_absolute()
        && path
            .components()
            .any(|component| matches!(component, Component::Normal(_)))
        && !path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
}

fn normalise_relative_path(raw: &str) -> Result<(String, String, String), DbError> {
    let replaced = raw.replace('\\', "/");
    if replaced.is_empty() || replaced.starts_with('/') {
        return Err(invalid_relative_path(raw));
    }

    let components = replaced.split('/').collect::<Vec<_>>();
    let has_windows_prefix = components
        .first()
        .is_some_and(|first| first.len() == 2 && first.as_bytes()[1] == b':');
    if has_windows_prefix
        || components
            .iter()
            .any(|component| component.is_empty() || *component == "." || *component == "..")
    {
        return Err(invalid_relative_path(raw));
    }

    let file_name = components
        .last()
        .expect("non-empty path has a final component")
        .to_string();
    let directory_path = components[..components.len() - 1].join("/");
    Ok((components.join("/"), directory_path, file_name))
}

fn invalid_relative_path(raw: &str) -> DbError {
    DbError::Conflict(format!(
        "folder media path must be a normal root-relative path: {raw:?}"
    ))
}

fn optional_i64(value: Option<u64>, label: &str) -> Result<Option<i64>, DbError> {
    value.map(|value| required_i64(value, label)).transpose()
}

fn required_i64(value: u64, label: &str) -> Result<i64, DbError> {
    i64::try_from(value)
        .map_err(|_| DbError::Conflict(format!("{label} exceeds the database integer range")))
}

fn non_negative_u64(value: i64) -> u64 {
    value.max(0) as u64
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};
    use playarr_model::{FolderScanStatus, WorkKind, FOLDER_WORK_PROVIDER};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::{MediaFileRepo, SqlxMediaFileRepo, SqlxWorkRepo, WorkRepo};

    async fn insert_source(pool: &DbPool, source_instance_id: Uuid) {
        sqlx::query(
            "INSERT INTO source_instances \
             (id, kind, name, base_url, api_key_encrypted) \
             VALUES (?, 'radarr', 'Folder source', 'http://source.invalid', 'redacted')",
        )
        .bind(source_instance_id.to_string())
        .execute(pool)
        .await
        .expect("insert source instance");
    }

    fn sample_root(
        source_instance_id: Uuid,
        source_root_id: &str,
        display_name: &str,
        work_kind: WorkKind,
    ) -> SourceRootFolder {
        SourceRootFolder {
            id: Uuid::new_v4(),
            source_instance_id,
            source_root_id: source_root_id.to_string(),
            reported_path: format!("/remote/media/{source_root_id}"),
            local_path_override: None,
            display_name: display_name.to_string(),
            work_kind,
            accessible: true,
            free_space_bytes: Some(8_589_934_592),
            total_space_bytes: Some(17_179_869_184),
            active: false,
            scan_status: FolderScanStatus::Ready,
            last_scanned_at: Some(Utc::now().trunc_subsecs(3)),
            scan_error: None,
            updated_at: Utc::now().trunc_subsecs(3),
        }
    }

    fn sample_file(
        root_folder_id: Uuid,
        work_kind: WorkKind,
        relative_path: &str,
    ) -> ScannedFolderFile {
        ScannedFolderFile {
            entry_id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            root_folder_id,
            physical_path: PathBuf::from("/srv/media").join(relative_path.replace('\\', "/")),
            relative_path: relative_path.to_string(),
            work_kind,
            title: "Episode One".to_string(),
            sort_title: "Episode One".to_string(),
            container: "mkv".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(8_000_000),
            duration_ms: Some(3_600_000),
            size_bytes: 5_368_709_120,
            modified_at: Some(Utc::now().trunc_subsecs(3)),
            metadata: FolderFileMetadata {
                title: Some("Episode One".to_string()),
                artist: None,
                album: None,
                year: Some(2025),
                video_codec: Some("h264".to_string()),
                audio_codec: Some("aac".to_string()),
                width: Some(1920),
                height: Some(1080),
                audio_channels: Some(6),
                embedded_artwork: false,
            },
            scanned_at: Utc::now().trunc_subsecs(3),
        }
    }

    #[tokio::test]
    async fn replace_active_roots_updates_cache_and_marks_missing_roots_inactive() {
        let pool = test_sqlite_pool().await;
        let source_instance_id = Uuid::new_v4();
        insert_source(&pool, source_instance_id).await;
        let repo = SqlxFolderRepo::new(pool.clone());
        let first = sample_root(source_instance_id, "1", "Films", WorkKind::Movie);
        let second = sample_root(source_instance_id, "2", "Television", WorkKind::Series);

        repo.replace_active_roots(source_instance_id, &[first.clone(), second.clone()])
            .await
            .unwrap();

        let active = repo
            .list_active_roots_by_source(source_instance_id)
            .await
            .unwrap();
        assert_eq!(active.len(), 2);
        assert!(active.iter().all(|root| root.active));
        assert_eq!(
            repo.find_active_root(source_instance_id, "2")
                .await
                .unwrap()
                .map(|root| root.id),
            Some(second.id)
        );

        let mut renamed = first.clone();
        renamed.display_name = "Films 4K".to_string();
        renamed.updated_at += chrono::Duration::seconds(1);
        repo.replace_active_roots(source_instance_id, &[renamed.clone()])
            .await
            .unwrap();

        let active = repo.list_active_roots().await.unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, first.id);
        assert_eq!(active[0].display_name, "Films 4K");
        assert_eq!(active[0].free_space_bytes, first.free_space_bytes);
        assert_eq!(active[0].last_scanned_at, first.last_scanned_at);
        assert!(repo
            .find_active_root(source_instance_id, "2")
            .await
            .unwrap()
            .is_none());

        let stale_active: i64 =
            sqlx::query_scalar("SELECT active FROM source_root_folders WHERE id = ?")
                .bind(second.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stale_active, 0);
    }

    #[tokio::test]
    async fn root_overrides_survive_refresh_and_clear_back_to_safe_fallbacks() {
        let pool = test_sqlite_pool().await;
        let source_instance_id = Uuid::new_v4();
        insert_source(&pool, source_instance_id).await;
        let repo = SqlxFolderRepo::new(pool);
        let root = sample_root(source_instance_id, "movies", "Films", WorkKind::Movie);
        repo.replace_active_roots(source_instance_id, std::slice::from_ref(&root))
            .await
            .unwrap();

        let override_path = PathBuf::from("/mnt/library/films");
        repo.replace_local_path_overrides(
            source_instance_id,
            &BTreeMap::from([(root.id, override_path.clone())]),
        )
        .await
        .unwrap();

        let mut refreshed = root.clone();
        refreshed.reported_path = "/source/new-films".to_string();
        refreshed.local_path_override = None;
        refreshed.scan_status = FolderScanStatus::Failed;
        refreshed.scan_error = Some("stale mapping error".to_string());
        repo.replace_active_roots(source_instance_id, &[refreshed])
            .await
            .unwrap();

        let persisted = repo
            .find_active_root(source_instance_id, "movies")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(persisted.reported_path, "/source/new-films");
        assert_eq!(persisted.local_path_override, Some(override_path.clone()));
        assert_eq!(persisted.scan_status, FolderScanStatus::Pending);
        assert_eq!(persisted.scan_error, None);

        repo.replace_local_path_overrides(source_instance_id, &BTreeMap::new())
            .await
            .unwrap();
        let cleared = repo
            .find_active_root(source_instance_id, "movies")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cleared.local_path_override, None);
        assert_eq!(cleared.scan_status, FolderScanStatus::Pending);
    }

    #[tokio::test]
    async fn root_override_replacement_validates_ownership_before_clearing() {
        let pool = test_sqlite_pool().await;
        let first_source_id = Uuid::new_v4();
        let second_source_id = Uuid::new_v4();
        insert_source(&pool, first_source_id).await;
        insert_source(&pool, second_source_id).await;
        let repo = SqlxFolderRepo::new(pool);
        let mut first = sample_root(first_source_id, "1", "Films", WorkKind::Movie);
        first.scan_status = FolderScanStatus::Failed;
        first.scan_error =
            Some("This root has no mapping on the current Playarr server.".to_string());
        let second = sample_root(second_source_id, "2", "Other", WorkKind::Movie);
        repo.replace_active_roots(first_source_id, std::slice::from_ref(&first))
            .await
            .unwrap();
        repo.replace_active_roots(second_source_id, std::slice::from_ref(&second))
            .await
            .unwrap();

        let original_override = PathBuf::from("/mnt/films");
        repo.replace_local_path_overrides(
            first_source_id,
            &BTreeMap::from([(first.id, original_override.clone())]),
        )
        .await
        .unwrap();

        let error = repo
            .replace_local_path_overrides(
                first_source_id,
                &BTreeMap::from([(second.id, PathBuf::from("/mnt/other"))]),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, DbError::Conflict(_)));
        let unchanged = repo
            .find_active_root(first_source_id, "1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            unchanged.local_path_override,
            Some(original_override.clone())
        );

        repo.replace_local_path_overrides(first_source_id, &BTreeMap::new())
            .await
            .unwrap();
        let cleared = repo
            .find_active_root(first_source_id, "1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cleared.local_path_override, None);
        assert_eq!(cleared.scan_status, FolderScanStatus::Pending);
        assert_eq!(cleared.scan_error, None);
    }

    #[tokio::test]
    async fn scanned_file_upsert_atomically_creates_hidden_playable_rows_and_lookups() {
        let pool = test_sqlite_pool().await;
        let source_instance_id = Uuid::new_v4();
        insert_source(&pool, source_instance_id).await;
        let repo = SqlxFolderRepo::new(pool.clone());
        let root = sample_root(source_instance_id, "series", "Series", WorkKind::Series);
        repo.replace_active_roots(source_instance_id, std::slice::from_ref(&root))
            .await
            .unwrap();
        let mut scanned = sample_file(root.id, WorkKind::Series, r"Show\Season 01\Episode 01.mkv");

        let entry = repo.upsert_scanned_file(&scanned).await.unwrap();
        assert_eq!(entry.id, scanned.entry_id);
        assert_eq!(entry.relative_path, "Show/Season 01/Episode 01.mkv");
        assert_eq!(entry.directory_path, "Show/Season 01");
        assert_eq!(entry.file_name, "Episode 01.mkv");
        assert_eq!(entry.metadata, scanned.metadata);

        assert_eq!(repo.get_media_entry(scanned.entry_id).await.unwrap(), entry);
        assert_eq!(
            repo.find_media_entry(root.id, &scanned.relative_path)
                .await
                .unwrap(),
            Some(entry.clone())
        );
        assert_eq!(
            repo.find_media_entry_by_media_file_id(scanned.media_file_id)
                .await
                .unwrap(),
            Some(entry.clone())
        );
        assert_eq!(
            repo.list_media_entries(root.id).await.unwrap(),
            vec![entry.clone()]
        );

        let work_repo = SqlxWorkRepo::new(pool.clone());
        let work = work_repo.get(scanned.work_id).await.unwrap();
        assert_eq!(work.title, scanned.title);
        assert_eq!(work.external_refs.len(), 1);
        assert_eq!(work.external_refs[0].provider, folder_work_provider());
        assert_eq!(
            work.external_refs[0].external_id,
            scanned.entry_id.to_string()
        );
        assert!(work_repo
            .list_by_kind(WorkKind::Series, 10, 0)
            .await
            .unwrap()
            .is_empty());

        let media_repo = SqlxMediaFileRepo::new(pool.clone());
        let media_file = media_repo.get_by_id(scanned.media_file_id).await.unwrap();
        assert_eq!(media_file.path, scanned.physical_path);
        assert_eq!(media_file.work_id, scanned.work_id);
        assert_eq!(media_file.source_instance_id, source_instance_id);
        let expected_source_file_id = format!("{FOLDER_SOURCE_FILE_PREFIX}{}", scanned.entry_id);
        assert_eq!(
            media_file.source_file_id.as_deref(),
            Some(expected_source_file_id.as_str())
        );

        scanned.title = "Updated file title".to_string();
        scanned.metadata.title = Some(scanned.title.clone());
        scanned.duration_ms = Some(3_700_000);
        scanned.scanned_at += chrono::Duration::seconds(1);
        let updated = repo.upsert_scanned_file(&scanned).await.unwrap();
        assert_eq!(updated.title, scanned.title);
        assert_eq!(updated.metadata.title, scanned.metadata.title);
        assert_eq!(
            media_repo
                .get_by_id(scanned.media_file_id)
                .await
                .unwrap()
                .duration_ms,
            scanned.duration_ms
        );

        let entry_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM folder_media_entries")
            .fetch_one(&pool)
            .await
            .unwrap();
        let work_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM work_external_refs WHERE provider = ?")
                .bind(format!("other:{FOLDER_WORK_PROVIDER}"))
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(entry_count, 1);
        assert_eq!(work_count, 1);
    }

    #[tokio::test]
    async fn failed_entry_insert_rolls_back_backing_work_and_media_file() {
        let pool = test_sqlite_pool().await;
        let source_instance_id = Uuid::new_v4();
        insert_source(&pool, source_instance_id).await;
        let repo = SqlxFolderRepo::new(pool.clone());
        let root = sample_root(source_instance_id, "movies", "Movies", WorkKind::Movie);
        repo.replace_active_roots(source_instance_id, std::slice::from_ref(&root))
            .await
            .unwrap();
        let first = sample_file(root.id, WorkKind::Movie, "Film/movie.mkv");
        repo.upsert_scanned_file(&first).await.unwrap();

        let conflicting = sample_file(root.id, WorkKind::Movie, "Film/movie.mkv");
        let error = repo.upsert_scanned_file(&conflicting).await.unwrap_err();
        assert!(error.is_constraint_violation());

        let work_error = SqlxWorkRepo::new(pool.clone())
            .get(conflicting.work_id)
            .await
            .unwrap_err();
        assert!(matches!(work_error, DbError::NotFound));
        let media_error = SqlxMediaFileRepo::new(pool.clone())
            .get_by_id(conflicting.media_file_id)
            .await
            .unwrap_err();
        assert!(matches!(media_error, DbError::NotFound));
        assert_eq!(
            repo.find_media_entry(root.id, "Film/movie.mkv")
                .await
                .unwrap()
                .map(|entry| entry.id),
            Some(first.entry_id)
        );
    }

    #[tokio::test]
    async fn rejects_unsafe_or_non_normal_relative_paths_before_writing() {
        for raw in [
            "",
            "/absolute/movie.mkv",
            "../escape.mkv",
            "folder/../escape.mkv",
            "folder//movie.mkv",
            r"C:\media\movie.mkv",
        ] {
            assert!(
                matches!(normalise_relative_path(raw), Err(DbError::Conflict(_))),
                "{raw:?} must be rejected"
            );
        }
        assert_eq!(
            normalise_relative_path(r"Season 1\Episode 1.mkv").unwrap(),
            (
                "Season 1/Episode 1.mkv".to_string(),
                "Season 1".to_string(),
                "Episode 1.mkv".to_string()
            )
        );
    }
}
