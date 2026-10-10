//! Connection pool and embedded migrations.
//!
//! [`DbPool`] is `sqlx::AnyPool` backed by the SQLite driver only: Playarr is
//! SQLite-only (ADR 0002). `AnyPool` is kept as the one concrete pool type so
//! the rest of the backend (repositories, `crate::analytics::AnalyticsStore`)
//! does not depend on a driver-specific row type.

use sqlx::any::AnyPoolOptions;
use std::time::Duration;

use crate::error::DbError;

pub type DbPool = sqlx::AnyPool;

const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(30);

/// `PRAGMA optimize` mask run when a connection opens: 0x10000 checks every
/// table (not only the ones this connection used) and 0x2 runs `ANALYZE` where
/// a table has none or has changed a lot. Without `sqlite_stat1` the planner
/// guesses row counts and picked the slow join order for the language reads.
const OPTIMIZE_ON_OPEN: &str = "PRAGMA optimize = 0x10002";

/// Refreshes planner statistics where they have gone stale (`PRAGMA optimize`,
/// cheap when nothing changed). Call about hourly from a maintenance task.
pub async fn optimize(pool: &DbPool) -> Result<(), DbError> {
    sqlx::query("PRAGMA optimize").execute(pool).await?;
    Ok(())
}

/// Embedded SQLite migrations, read from `backend/migrations/sqlite` at
/// *compile* time (the path is relative to this crate's `Cargo.toml`, i.e.
/// `backend/crates/playarr-db/../../migrations/sqlite`). Adding a new
/// `.sql` file there and rebuilding is enough — no separate "embed" step.
pub static SQLITE_MIGRATIONS: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations/sqlite");

/// Opens a SQLite pool against `database_url` (a `sqlite:` URL). Any other
/// scheme, including `postgres://`, is rejected before a connection is
/// attempted. Call once at process startup and share the resulting `DbPool`
/// (it's cheaply `Clone`).
pub async fn connect(database_url: &str) -> Result<DbPool, DbError> {
    ensure_sqlite_url(database_url)?;

    // Registers the compiled-in SQLite driver with sqlx's `Any` registry so
    // `AnyPoolOptions::connect` can open the connection.
    sqlx::any::install_default_drivers();

    let database_url = ensure_sqlite_create_mode(database_url);
    let use_wal = !database_url.contains(":memory:")
        && !database_url.contains("mode=memory")
        && !database_url.contains("mode=ro");

    // SQLite permits one writer at a time. Without a busy timeout on every
    // pooled connection, routine background writes can turn a short
    // collision into SQLITE_BUSY failures across unrelated reads.
    let read_only = database_url.contains("mode=ro");
    let options =
        AnyPoolOptions::new()
            .max_connections(10)
            .after_connect(move |connection, _metadata| {
                let statement =
                    format!("PRAGMA busy_timeout = {}", SQLITE_BUSY_TIMEOUT.as_millis());
                Box::pin(async move {
                    sqlx::query(&statement).execute(&mut *connection).await?;
                    if !read_only {
                        // Statistics are an optimisation: a failure (a busy writer, a
                        // missing table on a fresh file) must not fail the connection.
                        if let Err(error) = sqlx::query(OPTIMIZE_ON_OPEN)
                            .execute(&mut *connection)
                            .await
                        {
                            tracing::debug!(%error, "PRAGMA optimize on connect skipped");
                        }
                    }
                    Ok(())
                })
            });

    let pool = options.connect(&database_url).await?;
    if use_wal {
        // Set WAL before returning the pool to callers. WAL lets readers and
        // the single SQLite writer make progress concurrently; the setting
        // persists in the database, so later pooled connections inherit it.
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode = WAL")
            .fetch_one(&pool)
            .await?;
        if !journal_mode.eq_ignore_ascii_case("wal") {
            return Err(DbError::Backend(sqlx::Error::Protocol(format!(
                "SQLite refused WAL journal mode and returned {journal_mode:?}"
            ))));
        }
    }
    Ok(pool)
}

/// Rejects every URL that is not a `sqlite:` URL. The URL is never echoed
/// into the error: it may carry credentials.
fn ensure_sqlite_url(database_url: &str) -> Result<(), DbError> {
    let lower = database_url.trim_start().to_ascii_lowercase();
    if lower.starts_with("sqlite:") {
        return Ok(());
    }
    let message = if lower.starts_with("postgres://") || lower.starts_with("postgresql://") {
        "Postgres is no longer supported: Playarr is SQLite-only (see ADR 0002); use a `sqlite:` DATABASE_URL"
    } else {
        "unsupported database URL: only `sqlite:` URLs are supported (see ADR 0002)"
    };
    Err(DbError::Backend(sqlx::Error::Configuration(message.into())))
}

/// `sqlx`'s SQLite driver does **not** create the database file on first
/// connect unless the connection string explicitly opts in
/// (`?mode=rwc` -- "read-write-create") -- without it, connecting to a
/// `sqlite://` URL whose file doesn't exist yet fails outright
/// (`SQLITE_CANTOPEN`, "unable to open database file"). That's a real
/// first-boot bug for the exact zero-dependency single-node deployment
/// SQLite exists to serve: an operator's very first
/// `docker run`/`systemctl start` against a fresh volume/disk would
/// otherwise crash-loop before ever reaching a migration, with no
/// actionable error beyond a low-level SQLite error code. This function is
/// the fix: every `sqlite:` URL passed to [`connect`] gets `mode=rwc`
/// appended (only if the caller hasn't already set a `mode=` param
/// themselves, so an explicit `?mode=ro` for a read-only replica-style
/// connection is still respected).
/// `sqlite::memory:` also gets `mode=rwc` appended -- harmless (an
/// in-memory database is always freshly created regardless) but simpler
/// than special-casing it, and confirmed not to break sqlx's parsing by
/// this module's own tests.
fn ensure_sqlite_create_mode(database_url: &str) -> std::borrow::Cow<'_, str> {
    if !database_url.starts_with("sqlite:") {
        return std::borrow::Cow::Borrowed(database_url);
    }

    let (base, query) = match database_url.split_once('?') {
        Some((base, query)) => (base, Some(query)),
        None => (database_url, None),
    };

    if let Some(query) = query {
        if query.split('&').any(|param| param.starts_with("mode=")) {
            return std::borrow::Cow::Borrowed(database_url);
        }
        std::borrow::Cow::Owned(format!("{base}?{query}&mode=rwc"))
    } else {
        std::borrow::Cow::Owned(format!("{base}?mode=rwc"))
    }
}

/// Runs the embedded SQLite migrations against an already-open pool. Split
/// from [`connect`] so callers (tests, the CLI's `playarr update` path, the
/// main boot sequence) can control exactly when schema changes are applied.
pub async fn run_migrations(pool: &DbPool) -> Result<(), DbError> {
    reconcile_reworded_migrations(pool, &SQLITE_MIGRATIONS).await?;
    SQLITE_MIGRATIONS.run(pool).await?;
    Ok(())
}

/// SQLite migrations whose file was edited in comments only after databases
/// had applied it, as `(version, hex SHA-384 checksums of every earlier text
/// that existing databases may have applied)`. sqlx refuses to start when an
/// applied migration's checksum no longer matches the embedded file, so for
/// exactly these known, comment-only edits the stored checksum is rewritten to
/// the embedded one first. Any other mismatch still fails startup.
///
/// Version 15 (`0015_playlists.sql`): its example comment was reworded twice
/// (once in a crate rename, once to neutralise an example title), and the
/// planned history rewrite rewrites both earlier texts again. The list holds
/// the text applied by the regional servers before the reword, the older
/// rename-era text, and both texts as the history rewrite will produce them,
/// so a database created by an image built from rewritten history also starts.
/// Every entry differs from the current file only in `--` comments.
const REWORDED_SQLITE_MIGRATIONS: &[(i64, &[&str])] = &[(
    15,
    &[
        // Applied by the regional servers before the reword (pre-scrub text).
        "766ac1e36e13df0c6948459db91dd69d6afac884f2bba7c31d8205c7609a160f7680a28bb449f855e15499d71e183613",
        // Rename-era text.
        "a07e1bca67d641a8dac46d39119b24c71f78ae636ed1fa8f467d810e2ea18425594ee71e8643e6a6fc88daeb8298abab",
        // The pre-scrub text after the history rewrite.
        "50d5c014e627572bfc39a3b2438ab5f94033955a8cfe3fa7486646c35f9d51a0e27ba376ace8ed555505bb07928f8708",
        // The rename-era text after the history rewrite.
        "7c32fe98908d28a86eea9e237c5a1f2b99f9386c634b1ad19d5b54c00b610390fcd44d26e43699f5321b7074c8cf8bfa",
    ],
)];

fn decode_hex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .filter_map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

async fn reconcile_reworded_migrations(
    pool: &DbPool,
    migrator: &sqlx::migrate::Migrator,
) -> Result<(), DbError> {
    let table_exists: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(pool)
    .await?;
    if table_exists.is_none() {
        return Ok(());
    }
    for (version, old_hexes) in REWORDED_SQLITE_MIGRATIONS {
        let Some(embedded) = migrator.iter().find(|m| m.version == *version) else {
            continue;
        };
        for old_hex in *old_hexes {
            sqlx::query(
                "UPDATE _sqlx_migrations SET checksum = ? WHERE version = ? AND checksum = ?",
            )
            .bind(embedded.checksum.to_vec())
            .bind(*version)
            .bind(decode_hex(old_hex))
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

/// Test-only helper shared by `crate::repo`/`crate::analytics` unit tests: a
/// migrated, in-memory SQLite-backed [`DbPool`].
///
/// Pinned to `max_connections(1)` deliberately — SQLite's `:memory:`
/// database is private to the connection that opened it, so a pool with more
/// than one connection would let some queries silently land on a second,
/// empty/unmigrated database.
#[cfg(test)]
pub(crate) async fn test_sqlite_pool() -> DbPool {
    sqlx::any::install_default_drivers();
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect in-memory sqlite pool");
    run_migrations(&pool).await.expect("run sqlite migrations");
    pool
}

#[cfg(test)]
mod tests {
    /// sqlx keys `_sqlx_migrations` by version, so two files that share a version number make a fresh
    /// database fail part-way (a duplicate key on `_sqlx_migrations_pkey`). The SQLite set may not repeat one.
    #[test]
    fn sqlite_migration_versions_are_unique() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../migrations");
        for backend in ["sqlite"] {
            let mut seen = std::collections::BTreeMap::new();
            for entry in std::fs::read_dir(root.join(backend)).unwrap() {
                let name = entry.unwrap().file_name().to_string_lossy().into_owned();
                if !name.ends_with(".sql") {
                    continue;
                }
                let version = name.split('_').next().unwrap().to_string();
                if let Some(other) = seen.insert(version.clone(), name.clone()) {
                    panic!("{backend}: migrations {other} and {name} share version {version}");
                }
            }
            assert!(!seen.is_empty(), "{backend}: no migrations found");
        }
    }

    use super::*;
    use uuid::Uuid;

    /// A database that applied any earlier comment-only text of migration 15
    /// (before the reword, or as rewritten by the history rewrite) carries
    /// that text's checksum; startup must accept it and keep working.
    #[tokio::test]
    async fn every_known_earlier_checksum_for_migration_15_still_migrates() {
        let embedded = SQLITE_MIGRATIONS
            .iter()
            .find(|m| m.version == 15)
            .unwrap()
            .checksum
            .to_vec();
        let (version, old_hexes) = REWORDED_SQLITE_MIGRATIONS[0];
        assert_eq!(version, 15);
        assert_eq!(old_hexes.len(), 4);
        for old_hex in old_hexes {
            let old = decode_hex(old_hex);
            assert_eq!(old.len(), 48, "SHA-384 checksum");
            assert_ne!(old, embedded);
            let pool = test_sqlite_pool().await;
            sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = 15")
                .bind(old)
                .execute(&pool)
                .await
                .unwrap();
            run_migrations(&pool)
                .await
                .expect("a known earlier checksum is reconciled");
            let stored: Vec<u8> =
                sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 15")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(stored, embedded);
        }
    }

    /// The embedded file is the reworded text the list was computed against.
    #[test]
    fn migration_15_embedded_checksum_is_the_current_text() {
        let embedded = SQLITE_MIGRATIONS
            .iter()
            .find(|m| m.version == 15)
            .unwrap()
            .checksum
            .to_vec();
        assert_eq!(
            embedded,
            decode_hex(
                "86437c733c8e2907301962f40eb0cc834c446a104d765d9e0171c3f441cdaaf29b9bcdfb6c11f8d7ca351f9723b748b0"
            ),
            "0015_playlists.sql changed: recompute REWORDED_SQLITE_MIGRATIONS"
        );
    }

    /// Any other checksum mismatch must still stop startup.
    #[tokio::test]
    async fn an_unknown_checksum_mismatch_still_fails_startup() {
        let pool = test_sqlite_pool().await;
        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = 15")
            .bind(vec![1u8, 2, 3])
            .execute(&pool)
            .await
            .unwrap();
        assert!(run_migrations(&pool).await.is_err());
    }

    #[test]
    fn appends_mode_rwc_to_a_bare_sqlite_url() {
        assert_eq!(
            ensure_sqlite_create_mode("sqlite:///data/playarr.db"),
            "sqlite:///data/playarr.db?mode=rwc"
        );
        assert_eq!(
            ensure_sqlite_create_mode("sqlite://playarr.db"),
            "sqlite://playarr.db?mode=rwc"
        );
        assert_eq!(
            ensure_sqlite_create_mode("sqlite::memory:"),
            "sqlite::memory:?mode=rwc"
        );
    }

    #[test]
    fn appends_mode_rwc_alongside_existing_query_params() {
        assert_eq!(
            ensure_sqlite_create_mode("sqlite:///data/playarr.db?cache=shared"),
            "sqlite:///data/playarr.db?cache=shared&mode=rwc"
        );
    }

    #[test]
    fn respects_an_explicit_mode_param() {
        assert_eq!(
            ensure_sqlite_create_mode("sqlite:///data/playarr.db?mode=ro"),
            "sqlite:///data/playarr.db?mode=ro"
        );
    }

    #[tokio::test]
    async fn connect_rejects_postgres_urls_without_echoing_them() {
        for url in [
            "postgres://user:secret@host/db",
            "postgresql://user:secret@host/db",
        ] {
            let err = connect(url).await.expect_err("postgres must be rejected");
            let message = err.to_string();
            assert!(message.contains("SQLite-only"), "{message}");
            assert!(!message.contains("secret"), "{message}");
        }
    }

    #[tokio::test]
    async fn connect_rejects_other_non_sqlite_urls() {
        let err = connect("mysql://host/db").await.expect_err("must reject");
        assert!(err.to_string().contains("only `sqlite:` URLs"));
    }

    /// Reproduces the exact bug this fix closes: connecting to a `sqlite:`
    /// URL whose file doesn't exist yet, via the real public `connect`
    /// entrypoint every deployment tier actually calls (not the
    /// `max_connections(1)`-pinned `test_sqlite_pool` test helper, which
    /// only ever uses `:memory:`) -- before this fix, this failed with
    /// `SQLITE_CANTOPEN` on every fresh install.
    #[tokio::test]
    async fn connect_creates_a_fresh_sqlite_file_that_does_not_exist_yet() {
        let path = std::env::temp_dir().join(format!("playarr-pool-test-{}.db", Uuid::new_v4()));
        assert!(!path.exists(), "test file must not already exist");

        let url = format!("sqlite://{}", path.display());
        let pool = connect(&url)
            .await
            .expect("connect must create the database file, not error");
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .expect("read journal mode");
        let busy_timeout: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
            .fetch_one(&pool)
            .await
            .expect("read busy timeout");
        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");
        assert_eq!(busy_timeout, SQLITE_BUSY_TIMEOUT.as_millis() as i64);
        run_migrations(&pool)
            .await
            .expect("migrations must run against the freshly created file");
        pool.close().await;

        assert!(path.exists(), "connect should have created the file");
        let _ = std::fs::remove_file(&path);
    }

    /// Opening a connection analyses tables that have no statistics yet, so the
    /// planner knows their sizes; `optimize` keeps them current afterwards.
    #[tokio::test]
    async fn a_new_connection_gathers_planner_statistics_and_optimize_runs() {
        let path = std::env::temp_dir().join(format!("playarr-pool-test-{}.db", Uuid::new_v4()));
        let url = format!("sqlite://{}", path.display());
        let pool = connect(&url).await.unwrap();
        run_migrations(&pool).await.unwrap();
        for i in 0..300 {
            sqlx::query("INSERT INTO media_file_language_state (media_file_id, source, scanned_ms) VALUES (?, 'arr', 1)")
                .bind(format!("file-{i}"))
                .execute(&pool)
                .await
                .unwrap();
        }
        pool.close().await;

        let pool = connect(&url).await.unwrap();
        let analysed: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_stat1 WHERE tbl = 'media_file_language_state'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(analysed > 0, "the table was not analysed on connect");
        optimize(&pool).await.unwrap();
        pool.close().await;
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }
}
