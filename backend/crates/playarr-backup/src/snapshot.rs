//! Consistent database snapshots written into a staging directory.
//!
//! SQLite: `VACUUM INTO` copies the database inside one read transaction while
//! writers continue (WAL). PostgreSQL: every table is streamed from a single
//! `REPEATABLE READ, READ ONLY` transaction, so all tables share one snapshot.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use futures::TryStreamExt;
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

pub fn engine_of(pool: &DbPool) -> Engine {
    let scheme = pool
        .connect_options()
        .database_url
        .scheme()
        .to_ascii_lowercase();
    if scheme.starts_with("postgres") {
        Engine::Postgres
    } else {
        Engine::Sqlite
    }
}

pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub async fn take_snapshot(pool: &DbPool, stage: &Path) -> Result<Snapshot> {
    match engine_of(pool) {
        Engine::Sqlite => snapshot_sqlite(pool, stage).await,
        Engine::Postgres => snapshot_postgres(pool, stage).await,
    }
}

/// Approximate size of the live database, used for the free-space check.
pub async fn database_size_bytes(pool: &DbPool) -> Result<u64> {
    match engine_of(pool) {
        Engine::Sqlite => {
            let page_count: i64 = sqlx::query_scalar("SELECT page_count FROM pragma_page_count")
                .fetch_one(pool)
                .await?;
            let page_size: i64 = sqlx::query_scalar("SELECT page_size FROM pragma_page_size")
                .fetch_one(pool)
                .await?;
            Ok((page_count.max(0) as u64) * (page_size.max(0) as u64))
        }
        Engine::Postgres => {
            let size: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
                .fetch_one(pool)
                .await?;
            Ok(size.max(0) as u64)
        }
    }
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

/// Tables in foreign-key dependency order (parents first) plus the set of
/// tables that reference themselves.
pub async fn postgres_table_order(
    conn: &mut sqlx::AnyConnection,
) -> Result<(Vec<String>, BTreeSet<String>)> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT table_name::text FROM information_schema.tables \
         WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name",
    )
    .fetch_all(&mut *conn)
    .await?;
    let edges: Vec<(String, String)> = sqlx::query_as(
        "SELECT child.relname::text, parent.relname::text FROM pg_constraint c \
         JOIN pg_class child ON child.oid = c.conrelid \
         JOIN pg_class parent ON parent.oid = c.confrelid \
         WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace",
    )
    .fetch_all(&mut *conn)
    .await?;
    order_tables(tables, edges)
}

pub fn order_tables(
    tables: Vec<String>,
    edges: Vec<(String, String)>,
) -> Result<(Vec<String>, BTreeSet<String>)> {
    let mut self_referencing = BTreeSet::new();
    let mut parents: BTreeMap<String, BTreeSet<String>> = tables
        .iter()
        .map(|table| (table.clone(), BTreeSet::new()))
        .collect();
    for (child, parent) in edges {
        if child == parent {
            self_referencing.insert(child);
        } else if let Some(set) = parents.get_mut(&child) {
            set.insert(parent);
        }
    }
    let mut ordered = Vec::new();
    let mut done: BTreeSet<String> = BTreeSet::new();
    while ordered.len() < tables.len() {
        let ready: Vec<String> = tables
            .iter()
            .filter(|table| !done.contains(*table))
            .filter(|table| parents[*table].iter().all(|parent| done.contains(parent)))
            .cloned()
            .collect();
        if ready.is_empty() {
            return Err(BackupError::Incompatible(
                "the schema has a foreign-key cycle between tables; backup cannot order it"
                    .to_string(),
            ));
        }
        for table in ready {
            done.insert(table.clone());
            ordered.push(table);
        }
    }
    Ok((ordered, self_referencing))
}

async fn snapshot_postgres(pool: &DbPool, stage: &Path) -> Result<Snapshot> {
    let db_dir = stage.join("db");
    std::fs::create_dir_all(&db_dir)?;
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *conn)
        .await?;
    let result = dump_postgres(&mut conn, &db_dir).await;
    // Read-only transaction: roll back in every case.
    sqlx::query("ROLLBACK").execute(&mut *conn).await.ok();
    result
}

async fn dump_postgres(conn: &mut sqlx::AnyConnection, db_dir: &Path) -> Result<Snapshot> {
    let (ordered, self_referencing) = postgres_table_order(&mut *conn).await?;
    let schema_version = max_migration_version_conn(conn).await?;
    let mut files = Vec::new();
    let mut tables = Vec::new();
    let mut order_listing = Vec::new();

    for table in ordered
        .iter()
        .filter(|table| !EPHEMERAL_TABLES.contains(&table.as_str()))
    {
        let path = db_dir.join(format!("{table}.ndjson"));
        let mut writer = HashingWriter::new(BufWriter::new(std::fs::File::create(&path)?));
        let mut rows = 0u64;
        let sql = format!("SELECT row_to_json(t)::text FROM {} t", quote_ident(table));
        {
            let mut stream = sqlx::query_scalar::<_, String>(&sql).fetch(&mut *conn);
            while let Some(line) = stream.try_next().await? {
                writer.write_all(line.as_bytes())?;
                writer.write_all(b"\n")?;
                rows += 1;
            }
        }
        let (size, sha256, inner) = writer.finish();
        inner.into_inner().map_err(|e| e.into_error())?.sync_all()?;
        files.push(FileEntry {
            path: format!("db/{table}.ndjson"),
            size,
            sha256,
        });
        tables.push(TableEntry {
            name: table.clone(),
            rows,
        });
        order_listing.push(serde_json::json!({
            "name": table,
            "self_referencing": self_referencing.contains(table),
        }));
    }

    let listing = serde_json::to_vec_pretty(&order_listing)?;
    let listing_path = db_dir.join("_tables.json");
    std::fs::write(&listing_path, &listing)?;
    let (size, sha256) = hash_file(&listing_path)?;
    files.push(FileEntry {
        path: "db/_tables.json".to_string(),
        size,
        sha256,
    });
    Ok(Snapshot {
        engine: Engine::Postgres,
        schema_version,
        files,
        tables,
    })
}

async fn max_migration_version_conn(conn: &mut sqlx::AnyConnection) -> Result<i64> {
    let version: Option<i64> =
        sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations WHERE success")
            .fetch_one(&mut *conn)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn orders_parents_before_children_and_flags_self_references() {
        let (order, selfref) = order_tables(
            s(&["items", "lists", "users"]),
            vec![
                ("items".into(), "lists".into()),
                ("lists".into(), "users".into()),
                ("lists".into(), "lists".into()),
            ],
        )
        .unwrap();
        assert_eq!(order, s(&["users", "lists", "items"]));
        assert!(selfref.contains("lists"));
    }

    #[test]
    fn cycles_are_reported() {
        let error = order_tables(
            s(&["a", "b"]),
            vec![("a".into(), "b".into()), ("b".into(), "a".into())],
        );
        assert!(error.is_err());
    }
}
