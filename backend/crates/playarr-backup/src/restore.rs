//! Staged restore. The live installation is only touched by the final
//! cutover, and only after every check on the staged copy has passed.

use std::path::{Path, PathBuf};

use age::x25519::Identity;
use chrono::Utc;
use playarr_db::DbPool;
use serde::Serialize;

use crate::archive::verify_and_extract;
use crate::error::{BackupError, Result};
use crate::manifest::{Engine, Manifest};
use crate::snapshot::{engine_of, max_migration_version, quote_ident, EPHEMERAL_TABLES};

/// How the restored server relates to the one the backup came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityMode {
    /// The replacement takes over: peer identity and group membership are kept.
    /// Use only when the original server is gone.
    Replace,
    /// A copy that runs beside the original: peer identity and group rows are
    /// dropped, and request forwarding, push registrations and the Tdarr
    /// connection are disabled so it cannot act as or for the original.
    Clone,
}

pub struct RestoreOptions {
    pub archive: PathBuf,
    pub identities: Vec<Identity>,
    pub database_url: String,
    /// Where staging happens. For SQLite it must be on the same filesystem as
    /// the database file so cutover is a rename.
    pub work_dir: PathBuf,
    pub artwork_dir: Option<PathBuf>,
    pub remap: Vec<(String, String)>,
    pub identity_mode: IdentityMode,
    pub allow_missing_media: bool,
    /// Validate and stage, then discard without cutover.
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct RestoreReport {
    pub backup_id: String,
    pub engine: String,
    pub archive_schema_version: i64,
    pub partial_backup: bool,
    pub tables_restored: usize,
    pub rows_restored: u64,
    pub migrations_applied_after_restore: bool,
    pub missing_library_roots: Vec<String>,
    pub remapped_paths: u64,
    pub cleared: Vec<String>,
    pub artwork_files_restored: usize,
    pub unavailable: Vec<String>,
    pub cutover: bool,
    /// What to keep or delete after a successful cutover.
    pub previous_installation: Option<String>,
}

pub async fn restore(options: RestoreOptions) -> Result<RestoreReport> {
    let id = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    std::fs::create_dir_all(&options.work_dir)?;
    let stage = options.work_dir.join(format!("restore-{id}"));
    let result = restore_inner(&options, &stage, &id).await;
    let _ = std::fs::remove_dir_all(&stage);
    result
}

async fn restore_inner(options: &RestoreOptions, stage: &Path, id: &str) -> Result<RestoreReport> {
    // 1. Validate: decrypt, check every checksum, extract to the staging dir.
    std::fs::create_dir_all(stage)?;
    let archive = options.archive.clone();
    let identities = options.identities.clone();
    let extract_to = stage.to_path_buf();
    let manifest = tokio::task::spawn_blocking(move || {
        verify_and_extract(&archive, &identities, Some(&extract_to))
    })
    .await
    .map_err(|error| BackupError::Io(std::io::Error::other(error)))??;

    let target_engine = engine_from_url(&options.database_url);
    if manifest.engine != target_engine {
        return Err(BackupError::Incompatible(format!(
            "backup was made on {} but the target database is {}; cross-engine restore is not supported",
            manifest.engine.as_str(),
            target_engine.as_str()
        )));
    }
    let binary_schema = binary_schema_version(target_engine);
    if manifest.schema_version > binary_schema {
        return Err(BackupError::Incompatible(format!(
            "backup schema version {} is newer than this server's {binary_schema}; use a server at least as new as the one that made the backup",
            manifest.schema_version
        )));
    }

    let mut report = RestoreReport {
        backup_id: manifest.backup_id.clone(),
        engine: manifest.engine.as_str().to_string(),
        archive_schema_version: manifest.schema_version,
        partial_backup: manifest.partial,
        unavailable: manifest
            .unavailable
            .iter()
            .map(|item| format!("{}: {}", item.class, item.detail))
            .collect(),
        ..Default::default()
    };

    match target_engine {
        Engine::Sqlite => restore_sqlite(options, stage, id, &manifest, &mut report).await?,
        Engine::Postgres => restore_postgres(options, stage, id, &manifest, &mut report).await?,
    }
    Ok(report)
}

fn engine_from_url(url: &str) -> Engine {
    if url.starts_with("postgres://") || url.starts_with("postgresql://") {
        Engine::Postgres
    } else {
        Engine::Sqlite
    }
}

fn binary_schema_version(engine: Engine) -> i64 {
    let migrator = match engine {
        Engine::Sqlite => &playarr_db::SQLITE_MIGRATIONS,
        Engine::Postgres => &playarr_db::POSTGRES_MIGRATIONS,
    };
    migrator
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or(0)
}

// ---------------------------------------------------------------- SQLite --

fn sqlite_path(url: &str) -> Result<PathBuf> {
    let rest = url
        .strip_prefix("sqlite://")
        .or_else(|| url.strip_prefix("sqlite:"))
        .ok_or_else(|| BackupError::Config("not a SQLite URL".to_string()))?;
    let path = rest.split('?').next().unwrap_or(rest);
    if path.is_empty() || path.contains(":memory:") {
        return Err(BackupError::Refused(
            "cannot restore into an in-memory database".to_string(),
        ));
    }
    Ok(PathBuf::from(path))
}

fn side_file(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

async fn restore_sqlite(
    options: &RestoreOptions,
    stage: &Path,
    id: &str,
    manifest: &Manifest,
    report: &mut RestoreReport,
) -> Result<()> {
    let target = sqlite_path(&options.database_url)?;
    let target_dir = target
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    std::fs::create_dir_all(&target_dir)?;

    // 2. Stage: a private copy of the snapshot next to the target.
    let staged_db = side_file(&target, &format!(".restore-{id}"));
    let cleanup = |path: &Path| {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(side_file(path, suffix));
        }
    };
    std::fs::copy(stage.join("db/playarr.sqlite"), &staged_db)?;
    let outcome = stage_sqlite(options, manifest, &staged_db, report).await;
    if let Err(error) = outcome {
        cleanup(&staged_db);
        return Err(error);
    }
    if options.dry_run {
        cleanup(&staged_db);
        return Ok(());
    }

    // 4. Cutover: keep the old database, then rename the staged one in.
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let previous = side_file(&target, &format!(".pre-restore-{stamp}"));
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    let cutover = (|| -> std::io::Result<()> {
        for suffix in ["", "-wal", "-shm"] {
            let from = side_file(&target, suffix);
            if from.exists() {
                let to = side_file(&previous, suffix);
                std::fs::rename(&from, &to)?;
                moved.push((from, to));
            }
        }
        std::fs::rename(&staged_db, &target)?;
        Ok(())
    })();
    if let Err(error) = cutover {
        for (from, to) in moved.into_iter().rev() {
            let _ = std::fs::rename(to, from);
        }
        cleanup(&staged_db);
        return Err(error.into());
    }
    if !moved.is_empty() {
        report.previous_installation = Some(previous.display().to_string());
    }
    report.cutover = true;
    restore_assets(options, stage, &stamp, report)?;
    Ok(())
}

async fn stage_sqlite(
    options: &RestoreOptions,
    manifest: &Manifest,
    staged_db: &Path,
    report: &mut RestoreReport,
) -> Result<()> {
    let url = format!("sqlite://{}", staged_db.display());
    let pool = playarr_db::connect(&url).await?;
    let result = async {
        let before = max_migration_version(&pool).await?;
        playarr_db::run_migrations(&pool, false).await?;
        report.migrations_applied_after_restore = max_migration_version(&pool).await? > before;

        let integrity: String =
            sqlx::query_scalar("SELECT integrity_check FROM pragma_integrity_check LIMIT 1")
                .fetch_one(&pool)
                .await?;
        if integrity != "ok" {
            return Err(BackupError::Corrupt(format!(
                "restored database failed its integrity check: {integrity}"
            )));
        }
        let violations: Vec<String> =
            sqlx::query_scalar("SELECT \"table\" FROM pragma_foreign_key_check")
                .fetch_all(&pool)
                .await?;
        if !violations.is_empty() {
            return Err(BackupError::Corrupt(format!(
                "restored database has {} foreign-key violations",
                violations.len()
            )));
        }
        let mut rows_total = 0u64;
        for table in &manifest.tables {
            let rows: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {}",
                quote_ident(&table.name)
            ))
            .fetch_one(&pool)
            .await?;
            if rows as u64 != table.rows {
                return Err(BackupError::Corrupt(format!(
                    "table {} has {rows} rows after restore, manifest says {}",
                    table.name, table.rows
                )));
            }
            rows_total += table.rows;
        }
        report.tables_restored = manifest.tables.len();
        report.rows_restored = rows_total;
        apply_policy(&pool, Engine::Sqlite, options, report).await?;
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&pool)
            .await?;
        Ok(())
    }
    .await;
    pool.close().await;
    // A WAL-mode copy may leave sidecar files; they are folded into the main file.
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(side_file(staged_db, suffix));
    }
    result
}

// -------------------------------------------------------------- Postgres --

async fn restore_postgres(
    options: &RestoreOptions,
    stage: &Path,
    id: &str,
    manifest: &Manifest,
    report: &mut RestoreReport,
) -> Result<()> {
    let pool = playarr_db::connect(&options.database_url).await?;
    let outcome = stage_and_cutover_postgres(&pool, options, stage, id, manifest, report).await;
    pool.close().await;
    outcome?;
    if report.cutover {
        let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        restore_assets(options, stage, &stamp, report)?;
    }
    Ok(())
}

async fn stage_and_cutover_postgres(
    pool: &DbPool,
    options: &RestoreOptions,
    stage: &Path,
    id: &str,
    manifest: &Manifest,
    report: &mut RestoreReport,
) -> Result<()> {
    let mut conn = pool.acquire().await?;
    let live_schema: String = sqlx::query_scalar("SELECT current_schema()::text")
        .fetch_one(&mut *conn)
        .await?;
    let staging_schema = format!("playarr_restore_{id}");
    sqlx::query(&format!("CREATE SCHEMA {}", quote_ident(&staging_schema)))
        .execute(&mut *conn)
        .await?;

    let staged =
        load_postgres_stage(&mut conn, options, stage, &staging_schema, manifest, report).await;
    let outcome = match staged {
        Ok(()) if options.dry_run => Ok(()),
        Ok(()) => cutover_postgres(&mut conn, &live_schema, &staging_schema, report).await,
        Err(error) => Err(error),
    };
    // Whatever happened, the staging schema must not outlive the attempt
    // unless it became the live schema.
    if !report.cutover {
        sqlx::query(&format!(
            "DROP SCHEMA IF EXISTS {} CASCADE",
            quote_ident(&staging_schema)
        ))
        .execute(&mut *conn)
        .await
        .ok();
    }
    sqlx::query(&format!("SET search_path TO {}", quote_ident(&live_schema)))
        .execute(&mut *conn)
        .await
        .ok();
    outcome
}

async fn load_postgres_stage(
    conn: &mut sqlx::AnyConnection,
    options: &RestoreOptions,
    stage: &Path,
    staging_schema: &str,
    manifest: &Manifest,
    report: &mut RestoreReport,
) -> Result<()> {
    sqlx::query(&format!(
        "SET search_path TO {}",
        quote_ident(staging_schema)
    ))
    .execute(&mut *conn)
    .await?;
    // Build the schema at the archive's version, load, then migrate forward.
    let up_to_archive = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            playarr_db::POSTGRES_MIGRATIONS
                .iter()
                .filter(|migration| migration.version <= manifest.schema_version)
                .cloned()
                .collect(),
        ),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    };
    up_to_archive
        .run(&mut *conn)
        .await
        .map_err(|error| BackupError::Database(error.to_string()))?;

    let listing: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(stage.join("db/_tables.json"))?)?;
    let names: Vec<String> = listing
        .iter()
        .filter_map(|item| item["name"].as_str().map(str::to_string))
        .collect();
    let self_referencing: std::collections::BTreeSet<String> = listing
        .iter()
        .filter(|item| item["self_referencing"].as_bool().unwrap_or(false))
        .filter_map(|item| item["name"].as_str().map(str::to_string))
        .collect();

    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT table_name::text FROM information_schema.tables \
         WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
    )
    .fetch_all(&mut *conn)
    .await?;
    for name in &names {
        if !existing.contains(name) {
            return Err(BackupError::Incompatible(format!(
                "backup contains table {name} which does not exist at schema version {}",
                manifest.schema_version
            )));
        }
    }
    // Migrations seed a few rows; the backup is the whole truth.
    let truncate: Vec<String> = existing
        .iter()
        .filter(|name| !EPHEMERAL_TABLES.contains(&name.as_str()))
        .map(|name| quote_ident(name))
        .collect();
    if !truncate.is_empty() {
        sqlx::query(&format!("TRUNCATE {} CASCADE", truncate.join(", ")))
            .execute(&mut *conn)
            .await?;
    }

    for name in &names {
        let path = stage.join(format!("db/{name}.ndjson"));
        load_table(conn, name, &path, self_referencing.contains(name)).await?;
    }
    let mut rows_total = 0;
    for table in &manifest.tables {
        let rows: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {}",
            quote_ident(&table.name)
        ))
        .fetch_one(&mut *conn)
        .await?;
        if rows as u64 != table.rows {
            return Err(BackupError::Corrupt(format!(
                "table {} has {rows} rows after restore, manifest says {}",
                table.name, table.rows
            )));
        }
        rows_total += table.rows;
    }
    report.tables_restored = manifest.tables.len();
    report.rows_restored = rows_total;

    playarr_db::POSTGRES_MIGRATIONS
        .run(&mut *conn)
        .await
        .map_err(|error| BackupError::Database(error.to_string()))?;
    report.migrations_applied_after_restore =
        manifest.schema_version < binary_schema_version(Engine::Postgres);
    apply_policy_conn(conn, Engine::Postgres, options, report).await
}

const BATCH_BYTES: usize = 8 * 1024 * 1024;
const BATCH_ROWS: usize = 1000;

async fn load_table(
    conn: &mut sqlx::AnyConnection,
    name: &str,
    path: &Path,
    whole_table: bool,
) -> Result<()> {
    use std::io::BufRead;
    let table = quote_ident(name);
    let sql = format!(
        "INSERT INTO {table} SELECT * FROM json_populate_recordset(NULL::{table}, CAST($1 AS json))"
    );
    let reader = std::io::BufReader::new(std::fs::File::open(path)?);
    let mut batch = String::from("[");
    let mut rows = 0usize;
    for line in reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        if rows > 0 {
            batch.push(',');
        }
        batch.push_str(&line);
        rows += 1;
        // Self-referencing tables load in one statement so parent and child
        // rows are checked together.
        if !whole_table && (rows >= BATCH_ROWS || batch.len() >= BATCH_BYTES) {
            batch.push(']');
            sqlx::query(&sql).bind(batch).execute(&mut *conn).await?;
            batch = String::from("[");
            rows = 0;
        }
    }
    if rows > 0 {
        batch.push(']');
        sqlx::query(&sql).bind(batch).execute(&mut *conn).await?;
    }
    Ok(())
}

async fn cutover_postgres(
    conn: &mut sqlx::AnyConnection,
    live_schema: &str,
    staging_schema: &str,
    report: &mut RestoreReport,
) -> Result<()> {
    let stamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
    let previous = format!("pre_restore_{stamp}");
    sqlx::query("BEGIN").execute(&mut *conn).await?;
    let swap = async {
        sqlx::query(&format!(
            "ALTER SCHEMA {} RENAME TO {}",
            quote_ident(live_schema),
            quote_ident(&previous)
        ))
        .execute(&mut *conn)
        .await?;
        sqlx::query(&format!(
            "ALTER SCHEMA {} RENAME TO {}",
            quote_ident(staging_schema),
            quote_ident(live_schema)
        ))
        .execute(&mut *conn)
        .await?;
        Ok::<(), sqlx::Error>(())
    }
    .await;
    match swap {
        Ok(()) => {
            sqlx::query("COMMIT").execute(&mut *conn).await?;
            report.cutover = true;
            report.previous_installation = Some(format!("schema {previous}"));
            Ok(())
        }
        Err(error) => {
            sqlx::query("ROLLBACK").execute(&mut *conn).await.ok();
            Err(error.into())
        }
    }
}

// ----------------------------------------------------- shared policy/media --

async fn apply_policy(
    pool: &DbPool,
    engine: Engine,
    options: &RestoreOptions,
    report: &mut RestoreReport,
) -> Result<()> {
    let mut conn = pool.acquire().await?;
    apply_policy_conn(&mut conn, engine, options, report).await
}

async fn table_exists(conn: &mut sqlx::AnyConnection, engine: Engine, name: &str) -> Result<bool> {
    let sql = match engine {
        Engine::Sqlite => "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        Engine::Postgres => {
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1"
        }
    };
    let count: i64 = sqlx::query_scalar(sql)
        .bind(name)
        .fetch_one(&mut *conn)
        .await?;
    Ok(count > 0)
}

async fn clear_table(
    conn: &mut sqlx::AnyConnection,
    engine: Engine,
    name: &str,
    report: &mut RestoreReport,
) -> Result<()> {
    if table_exists(conn, engine, name).await? {
        let done = sqlx::query(&format!("DELETE FROM {}", quote_ident(name)))
            .execute(&mut *conn)
            .await?;
        if done.rows_affected() > 0 {
            report
                .cleared
                .push(format!("{name} ({} rows)", done.rows_affected()));
        }
    }
    Ok(())
}

async fn apply_policy_conn(
    conn: &mut sqlx::AnyConnection,
    engine: Engine,
    options: &RestoreOptions,
    report: &mut RestoreReport,
) -> Result<()> {
    // Sessions and derived state never survive a restore: everyone signs in
    // again, open download tickets are void and renditions are regenerated.
    for table in [
        "refresh_token_families",
        "download_tickets",
        "renditions",
        // Re-derived from the restored library by the language indexer.
        "media_file_languages",
        "media_file_language_state",
    ] {
        clear_table(conn, engine, table, report).await?;
    }

    if options.identity_mode == IdentityMode::Clone {
        for table in [
            "peer_media_inventory",
            "peer_leaf_availability",
            "peer_source_instances",
            "peer_sync_state",
            "sync_conflict_log",
            "group_libraries",
            "peer_join_tokens",
            "peer_nodes",
            "peer_groups",
            "node_identity",
            "push_registrations",
            "tdarr_connection",
        ] {
            clear_table(conn, engine, table, report).await?;
        }
        if table_exists(conn, engine, "source_instances").await? {
            let done = sqlx::query("UPDATE source_instances SET enabled_for_requests = 0")
                .execute(&mut *conn)
                .await?;
            report.cleared.push(format!(
                "request forwarding disabled on {} source instances",
                done.rows_affected()
            ));
        }
    }

    remap_paths(conn, engine, &options.remap, report).await?;

    let roots: Vec<String> = if table_exists(conn, engine, "source_root_folders").await? {
        sqlx::query_scalar(
            "SELECT COALESCE(local_path_override, reported_path) FROM source_root_folders ORDER BY 1",
        )
        .fetch_all(&mut *conn)
        .await?
    } else {
        Vec::new()
    };
    report.missing_library_roots = roots
        .into_iter()
        .filter(|root| std::fs::read_dir(root).is_err())
        .collect();
    if !report.missing_library_roots.is_empty() && !options.allow_missing_media && !options.dry_run
    {
        return Err(BackupError::Refused(format!(
            "{} library root(s) are missing or unreadable on this machine ({}); mount them, use --remap-path, or pass --allow-missing-media",
            report.missing_library_roots.len(),
            report.missing_library_roots.join(", ")
        )));
    }
    Ok(())
}

fn placeholder(engine: Engine, n: usize) -> String {
    match engine {
        Engine::Sqlite => "?".to_string(),
        Engine::Postgres => format!("${n}"),
    }
}

async fn remap_paths(
    conn: &mut sqlx::AnyConnection,
    engine: Engine,
    remap: &[(String, String)],
    report: &mut RestoreReport,
) -> Result<()> {
    let columns = [
        ("media_files", "path"),
        ("source_root_folders", "local_path_override"),
        ("source_root_folders", "reported_path"),
    ];
    for (old, new) in remap {
        for (table, column) in columns {
            if !table_exists(conn, engine, table).await? {
                continue;
            }
            let (c, t) = (quote_ident(column), quote_ident(table));
            let sql = format!(
                "UPDATE {t} SET {c} = CAST({p1} AS TEXT) || substr({c}, length(CAST({p2} AS TEXT)) + 1) \
                 WHERE {c} IS NOT NULL AND substr({c}, 1, length(CAST({p3} AS TEXT))) = CAST({p4} AS TEXT)",
                p1 = placeholder(engine, 1),
                p2 = placeholder(engine, 2),
                p3 = placeholder(engine, 3),
                p4 = placeholder(engine, 4),
            );
            let done = sqlx::query(&sql)
                .bind(new.clone())
                .bind(old.clone())
                .bind(old.clone())
                .bind(old.clone())
                .execute(&mut *conn)
                .await?;
            report.remapped_paths += done.rows_affected();
        }
    }
    Ok(())
}

/// Moves restored artwork into place, keeping whatever was there.
fn restore_assets(
    options: &RestoreOptions,
    stage: &Path,
    stamp: &str,
    report: &mut RestoreReport,
) -> Result<()> {
    let source = stage.join("assets/artwork");
    if !source.is_dir() {
        return Ok(());
    }
    let Some(target) = options.artwork_dir.clone() else {
        report
            .unavailable
            .push("artwork cache: no artwork directory configured, not restored".to_string());
        return Ok(());
    };
    let count = count_files(&source);
    if target.exists() {
        let previous = side_file(&target, &format!(".pre-restore-{stamp}"));
        std::fs::rename(&target, previous)?;
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::rename(&source, &target).is_err() {
        copy_tree(&source, &target)?;
    }
    report.artwork_files_restored = count;
    Ok(())
}

fn count_files(dir: &Path) -> usize {
    let mut total = 0;
    let mut pending = vec![dir.to_path_buf()];
    while let Some(current) = pending.pop() {
        if let Ok(read) = std::fs::read_dir(current) {
            for entry in read.flatten() {
                match entry.file_type() {
                    Ok(kind) if kind.is_dir() => pending.push(entry.path()),
                    Ok(kind) if kind.is_file() => total += 1,
                    _ => {}
                }
            }
        }
    }
    total
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// The engine behind an open pool; used by callers that restore through a pool.
pub fn pool_engine(pool: &DbPool) -> Engine {
    engine_of(pool)
}
