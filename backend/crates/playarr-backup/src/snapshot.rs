//! Consistent database snapshots written into a staging directory.
//!
//! `VACUUM INTO` copies the database inside one read transaction while
//! writers continue (WAL).

use std::io::Write;
use std::path::{Path, PathBuf};

use playarr_db::DbPool;
use sha2::{Digest, Sha256};

use crate::error::{BackupError, Result};
use crate::manifest::{Engine, FileEntry, TableEntry};

/// Tables that hold only coordination or cache state and are not backed up.
pub const EPHEMERAL_TABLES: &[&str] = &["cluster_leader", "cache_entries", "_sqlx_migrations"];

pub struct Snapshot {
    pub engine: Engine,
    pub schema_version: i64,
    pub files: Vec<FileEntry>,
    pub tables: Vec<TableEntry>,
}

pub fn engine_of(_pool: &DbPool) -> Engine {
    Engine::Sqlite
}

pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub async fn take_snapshot(pool: &DbPool, stage: &Path) -> Result<Snapshot> {
    snapshot_sqlite(pool, stage).await
}

/// Approximate size of the live database, used for the free-space check.
pub async fn database_size_bytes(pool: &DbPool) -> Result<u64> {
    let page_count: i64 = sqlx::query_scalar("SELECT page_count FROM pragma_page_count")
        .fetch_one(pool)
        .await?;
    let page_size: i64 = sqlx::query_scalar("SELECT page_size FROM pragma_page_size")
        .fetch_one(pool)
        .await?;
    Ok((page_count.max(0) as u64) * (page_size.max(0) as u64))
}

pub fn hash_file(path: &Path) -> Result<(u64, String)> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let size = std::io::copy(&mut file, &mut hasher)?;
    Ok((size, hex::encode(hasher.finalize())))
}

async fn snapshot_sqlite(pool: &DbPool, stage: &Path) -> Result<Snapshot> {
    let db_dir = stage.join("db");
    std::fs::create_dir_all(&db_dir)?;
    let target = db_dir.join("playarr.sqlite");
    let literal = target
        .to_str()
        .ok_or_else(|| BackupError::Config("staging path is not valid UTF-8".to_string()))?
        .replace('\'', "''");
    sqlx::query(&format!("VACUUM INTO '{literal}'"))
        .execute(pool)
        .await?;

    // Work on the copy only: drop ephemeral rows, then read versions and counts.
    let url = format!("sqlite://{}?mode=rw", target.display());
    let copy = playarr_db::connect(&url).await?;
    let result = describe_sqlite_copy(&copy).await;
    copy.close().await;
    let (schema_version, tables) = result?;
    // `connect` switches the copy to WAL; fold it back into a single file.
    remove_sidecars(&target);

    let (size, sha256) = hash_file(&target)?;
    Ok(Snapshot {
        engine: Engine::Sqlite,
        schema_version,
        files: vec![FileEntry {
            path: "db/playarr.sqlite".to_string(),
            size,
            sha256,
        }],
        tables,
    })
}

fn remove_sidecars(db: &Path) {
    for suffix in ["-wal", "-shm"] {
        let mut name = db.as_os_str().to_owned();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
}

async fn describe_sqlite_copy(copy: &DbPool) -> Result<(i64, Vec<TableEntry>)> {
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(copy)
    .await?;
    for ephemeral in EPHEMERAL_TABLES {
        if *ephemeral != "_sqlx_migrations" && names.iter().any(|name| name == ephemeral) {
            sqlx::query(&format!("DELETE FROM {}", quote_ident(ephemeral)))
                .execute(copy)
                .await?;
        }
    }
    let integrity: String =
        sqlx::query_scalar("SELECT integrity_check FROM pragma_integrity_check LIMIT 1")
            .fetch_one(copy)
            .await?;
    if integrity != "ok" {
        return Err(BackupError::Corrupt(format!(
            "SQLite integrity check of the snapshot failed: {integrity}"
        )));
    }
    let mut tables = Vec::new();
    for name in &names {
        if name == "_sqlx_migrations" {
            continue;
        }
        let rows: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", quote_ident(name)))
            .fetch_one(copy)
            .await?;
        tables.push(TableEntry {
            name: name.clone(),
            rows: rows.max(0) as u64,
        });
    }
    let schema_version = max_migration_version(copy).await?;
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(copy)
        .await?;
    Ok((schema_version, tables))
}

pub async fn max_migration_version(pool: &DbPool) -> Result<i64> {
    let version: Option<i64> =
        sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations WHERE success")
            .fetch_one(pool)
            .await?;
    Ok(version.unwrap_or(0))
}

/// Computes the SHA-256 and length of everything written through it.
pub struct HashingWriter<W: Write> {
    inner: W,
    hasher: Sha256,
    written: u64,
}

impl<W: Write> HashingWriter<W> {
    pub fn new(inner: W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            written: 0,
        }
    }

    pub fn finish(self) -> (u64, String, W) {
        (
            self.written,
            hex::encode(self.hasher.finalize()),
            self.inner,
        )
    }
}

impl<W: Write> Write for HashingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let count = self.inner.write(buf)?;
        self.hasher.update(&buf[..count]);
        self.written += count as u64;
        Ok(count)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}
