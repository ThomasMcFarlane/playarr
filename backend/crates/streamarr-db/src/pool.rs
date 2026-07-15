//! Connection pool and embedded migrations.
//!
//! [`DbPool`] is `sqlx::AnyPool`: one concrete pool type that dispatches at
//! runtime to either the SQLite or Postgres driver based on the connection
//! URL's scheme, so the rest of the backend (repositories,
//! `crate::analytics::AnalyticsStore`) can depend on a single pool type
//! regardless of `streamarr_config::DeploymentTier`. This only dispatches
//! among drivers actually compiled in via this crate's `sqlite`/`postgres`
//! feature flags — enabling `AnyPool` doesn't make an absent driver appear.

use sqlx::any::AnyPoolOptions;

use crate::error::DbError;

pub type DbPool = sqlx::AnyPool;

/// Embedded SQLite migrations, read from `backend/migrations/sqlite` at
/// *compile* time (the path is relative to this crate's `Cargo.toml`, i.e.
/// `backend/crates/streamarr-db/../../migrations/sqlite`). Adding a new
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

    let pool = AnyPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;
    Ok(pool)
}

/// Runs the migration set matching `is_postgres` against an already-open
/// pool. Split from [`connect`] so callers (tests, the CLI's `streamarr
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
/// `DbPool` is `sqlx::AnyPool` so every crate outside `streamarr-db` can
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
