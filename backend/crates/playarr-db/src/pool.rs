//! Connection pool and embedded migrations.
//!
//! [`DbPool`] is `sqlx::AnyPool`: one concrete pool type that dispatches at
//! runtime to either the SQLite or Postgres driver based on the connection
//! URL's scheme, so the rest of the backend (repositories,
//! `crate::analytics::AnalyticsStore`) can depend on a single pool type
//! regardless of `playarr_config::DeploymentTier`. This only dispatches
//! among drivers actually compiled in via this crate's `sqlite`/`postgres`
//! feature flags — enabling `AnyPool` doesn't make an absent driver appear.

use sqlx::any::AnyPoolOptions;
use std::time::Duration;

use crate::error::DbError;

pub type DbPool = sqlx::AnyPool;

const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(30);

/// Embedded SQLite migrations, read from `backend/migrations/sqlite` at
/// *compile* time (the path is relative to this crate's `Cargo.toml`, i.e.
/// `backend/crates/playarr-db/../../migrations/sqlite`). Adding a new
/// `.sql` file there and rebuilding is enough — no separate "embed" step.
pub static SQLITE_MIGRATIONS: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations/sqlite");

/// Embedded Postgres migrations, from `backend/migrations/postgres`.
pub static POSTGRES_MIGRATIONS: sqlx::migrate::Migrator =
    sqlx::migrate!("../../migrations/postgres");

/// Opens a pool against `database_url`, auto-detecting SQLite vs Postgres
/// from the URL scheme via `sqlx::Any`. Call once at process startup and
/// share the resulting `DbPool` (it's cheaply `Clone`).
pub async fn connect(database_url: &str) -> Result<DbPool, DbError> {
    // `AnyPool` dispatches among whichever drivers this crate compiled in
    // (see the `sqlite`/`postgres` features); this call registers them with
    // sqlx's internal `Any` driver registry so `AnyPoolOptions::connect`
    // can pick the right one from the URL scheme.
    sqlx::any::install_default_drivers();

    let database_url = ensure_sqlite_create_mode(database_url);
    let is_sqlite = database_url.starts_with("sqlite:");
    let use_wal = is_sqlite
        && !database_url.contains(":memory:")
        && !database_url.contains("mode=memory")
        && !database_url.contains("mode=ro");

    let mut options = AnyPoolOptions::new().max_connections(10);
    if is_sqlite {
        // SQLite permits one writer at a time. Without a busy timeout on
        // every pooled connection, routine background writes can turn a
        // short collision into SQLITE_BUSY failures across unrelated reads.
        options = options.after_connect(|connection, _metadata| {
            let statement = format!("PRAGMA busy_timeout = {}", SQLITE_BUSY_TIMEOUT.as_millis());
            Box::pin(async move {
                sqlx::query(&statement).execute(&mut *connection).await?;
                Ok(())
            })
        });
    }

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

/// `sqlx`'s SQLite driver does **not** create the database file on first
/// connect unless the connection string explicitly opts in
/// (`?mode=rwc` -- "read-write-create") -- without it, connecting to a
/// `sqlite://` URL whose file doesn't exist yet fails outright
/// (`SQLITE_CANTOPEN`, "unable to open database file"). That's a real
/// first-boot bug for the exact zero-dependency single-node deployment
/// SQLite exists to serve (ADR 0001's Tier 1): an operator's very first
/// `docker run`/`systemctl start` against a fresh volume/disk would
/// otherwise crash-loop before ever reaching a migration, with no
/// actionable error beyond a low-level SQLite error code. This function is
/// the fix: every `sqlite:` URL passed to [`connect`] gets `mode=rwc`
/// appended (only if the caller hasn't already set a `mode=` param
/// themselves, so an explicit `?mode=ro` for a read-only replica-style
/// connection is still respected). Postgres URLs pass through unchanged.
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

/// Runs the migration set matching `is_postgres` against an already-open
/// pool. Split from [`connect`] so callers (tests, the CLI's `playarr
/// update` path, the main boot sequence) can control exactly when schema
/// changes are applied.
pub async fn run_migrations(pool: &DbPool, is_postgres: bool) -> Result<(), DbError> {
    let migrator = if is_postgres {
        &POSTGRES_MIGRATIONS
    } else {
        &SQLITE_MIGRATIONS
    };
    migrator.run(pool).await?;
    Ok(())
}

/// Which concrete engine a [`DbPool`] is actually talking to.
///
/// `DbPool` is `sqlx::AnyPool` so every crate outside `playarr-db` can
/// depend on one pool type — but `sqlx::Any`'s query layer does *not*
/// translate placeholder syntax between engines (unlike, say, an ORM query
/// builder): text bound for `Any` is passed straight through to whichever
/// concrete driver is behind the connection, so it must already be in that
/// driver's native placeholder style (`?` for SQLite, `$1, $2, ...` for
/// Postgres). Repositories detect the backend once at construction time
/// (see `Backend::detect`) and pick the matching SQL text per query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Backend {
    Sqlite,
    Postgres,
}

impl Backend {
    /// Reads the scheme off the pool's connect URL — available synchronously
    /// via `Pool::connect_options()` without acquiring a live connection —
    /// and classifies it. Defaults to `Sqlite` for anything that isn't
    /// recognizably Postgres, matching `run_migrations`'s own
    /// `is_postgres`-else-sqlite convention.
    pub(crate) fn detect(pool: &DbPool) -> Self {
        let scheme = pool
            .connect_options()
            .database_url
            .scheme()
            .to_ascii_lowercase();
        if scheme.starts_with("postgres") {
            Backend::Postgres
        } else {
            Backend::Sqlite
        }
    }
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
    run_migrations(&pool, false)
        .await
        .expect("run sqlite migrations");
    pool
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

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

    #[test]
    fn leaves_postgres_urls_unchanged() {
        assert_eq!(
            ensure_sqlite_create_mode("postgres://user:pass@host/db"),
            "postgres://user:pass@host/db"
        );
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
        run_migrations(&pool, false)
            .await
            .expect("migrations must run against the freshly created file");
        pool.close().await;

        assert!(path.exists(), "connect should have created the file");
        let _ = std::fs::remove_file(&path);
    }
}
