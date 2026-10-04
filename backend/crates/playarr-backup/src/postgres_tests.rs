//! PostgreSQL backup and restore tests. They need a scratch server and are
//! skipped unless `PLAYARR_TEST_POSTGRES_URL` points at one (for example a
//! throwaway container). Every test creates and drops its own database.

use age::x25519::Identity;
use playarr_db::DbPool;

use crate::config::BackupConfig;
use crate::crypto::{generate_key, parse_recipients};
use crate::error::BackupError;
use crate::manifest::{BackupMode, Engine};
use crate::restore::{restore, IdentityMode, RestoreOptions};
use crate::runner::BackupService;
use crate::tests::{durable_state, seed_representative_data};

fn base_url() -> Option<String> {
    std::env::var("PLAYARR_TEST_POSTGRES_URL")
        .ok()
        .filter(|value| !value.is_empty())
}

struct ScratchDb {
    admin: DbPool,
    name: String,
    url: String,
}

impl ScratchDb {
    async fn create(base: &str) -> Self {
        sqlx::any::install_default_drivers();
        let admin = playarr_db::connect(base).await.unwrap();
        let name = format!("t_{}", uuid::Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE DATABASE \"{name}\""))
            .execute(&admin)
            .await
            .unwrap();
        let (prefix, _) = base.rsplit_once('/').unwrap();
        let url = format!("{prefix}/{name}");
        Self { admin, name, url }
    }

    async fn pool(&self) -> DbPool {
        playarr_db::connect(&self.url).await.unwrap()
    }

    async fn migrated(&self) -> DbPool {
        let pool = self.pool().await;
        playarr_db::run_migrations(&pool, true).await.unwrap();
        pool
    }

    async fn drop_db(self) {
        sqlx::query(&format!(
            "DROP DATABASE IF EXISTS \"{}\" WITH (FORCE)",
            self.name
        ))
        .execute(&self.admin)
        .await
        .unwrap();
    }
}

struct Source {
    db: ScratchDb,
    pool: DbPool,
    service: BackupService,
    identity: Identity,
    dest: std::path::PathBuf,
    _root: tempfile::TempDir,
}

async fn source(base: &str, library_root: &str) -> (Source, Vec<String>) {
    let db = ScratchDb::create(base).await;
    let pool = db.migrated().await;
    seed_representative_data(&pool, library_root).await;
    let before = durable_state(&pool).await;
    let root = tempfile::tempdir().unwrap();
    let dest = root.path().join("backups");
    let key = generate_key();
    let identity: Identity = key.secret.parse().unwrap();
    let service = BackupService::new(
        BackupConfig {
            dir: dest.clone(),
            recipients: parse_recipients(&[key.public]).unwrap(),
            mode: BackupMode::Database,
            interval: None,
            keep_last: 3,
            keep_days: 30,
            artwork_dir: None,
            max_asset_bytes: 0,
        },
        pool.clone(),
        "test",
    );
    (
        Source {
            db,
            pool,
            service,
            identity,
            dest,
            _root: root,
        },
        before,
    )
}

fn opts(src: &Source, archive: &str, target_url: &str, work: &std::path::Path) -> RestoreOptions {
    RestoreOptions {
        archive: src.dest.join(archive),
        identities: vec![src.identity.clone()],
        database_url: target_url.to_string(),
        work_dir: work.to_path_buf(),
        artwork_dir: None,
        remap: vec![],
        identity_mode: IdentityMode::Replace,
        allow_missing_media: false,
        dry_run: false,
    }
}

async fn schemas(pool: &DbPool) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT schema_name::text FROM information_schema.schemata \
         WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY 1",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn postgres_replacement_restore_reproduces_all_durable_state() {
    let Some(base) = base_url() else { return };
    let library = tempfile::tempdir().unwrap();
    let (src, before) = source(&base, &library.path().display().to_string()).await;
    let sidecar = src.service.run_now("test").await.unwrap();
    assert_eq!(sidecar.manifest.engine, Engine::Postgres);
    assert!(sidecar
        .manifest
        .tables
        .iter()
        .any(|t| t.name == "users" && t.rows == 2));
    assert!(!sidecar
        .manifest
        .tables
        .iter()
        .any(|t| t.name == "cluster_leader"));

    let target = ScratchDb::create(&base).await;
    let work = tempfile::tempdir().unwrap();
    let report = restore(opts(&src, &sidecar.archive_name, &target.url, work.path()))
        .await
        .unwrap();
    assert!(report.cutover);

    let restored = target.pool().await;
    assert_eq!(durable_state(&restored).await, before);
    let tokens: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_token_families")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(tokens, 0);
    // The restored schema is a normal, migrated one.
    playarr_db::run_migrations(&restored, true).await.unwrap();
    assert!(!schemas(&restored)
        .await
        .iter()
        .any(|s| s.starts_with("playarr_restore_")));
    restored.close().await;
    target.drop_db().await;
    src.pool.close().await;
    src.db.drop_db().await;
}

#[tokio::test]
async fn postgres_restore_checks_and_remaps_library_roots() {
    let Some(base) = base_url() else { return };
    let (src, before) = source(&base, "/media/pg-movies-missing").await;
    let sidecar = src.service.run_now("test").await.unwrap();
    assert!(sidecar
        .manifest
        .tables
        .iter()
        .any(|t| t.name == "source_root_folders" && t.rows == 1));
    assert!(sidecar
        .manifest
        .tables
        .iter()
        .any(|t| t.name == "folder_media_entries" && t.rows == 1));
    assert_eq!(
        sidecar.manifest.external_dependencies.library_roots,
        vec!["/media/pg-movies-missing"]
    );

    // A missing library root blocks cut-over and leaves the target untouched.
    let target = ScratchDb::create(&base).await;
    let work = tempfile::tempdir().unwrap();
    let error = restore(opts(&src, &sidecar.archive_name, &target.url, work.path()))
        .await
        .unwrap_err();
    assert!(matches!(error, BackupError::Refused(_)), "{error}");

    // Remapping to a directory that exists rewrites media paths and roots.
    let library = tempfile::tempdir().unwrap();
    let new_root = library.path().display().to_string();
    let mut remap = opts(&src, &sidecar.archive_name, &target.url, work.path());
    remap.remap = vec![("/media/pg-movies-missing".to_string(), new_root.clone())];
    let report = restore(remap).await.unwrap();
    assert_eq!(report.remapped_paths, 1);
    assert!(report.missing_library_roots.is_empty());

    let restored = target.pool().await;
    let root: String =
        sqlx::query_scalar("SELECT reported_path FROM source_root_folders WHERE id = 'rf-1'")
            .fetch_one(&restored)
            .await
            .unwrap();
    assert_eq!(root, new_root);
    let entries: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM folder_media_entries")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(entries, 1);
    // Everything else is unchanged by the remap.
    let after = durable_state(&restored).await;
    assert_eq!(after.len(), before.len());
    restored.close().await;
    target.drop_db().await;
    src.pool.close().await;
    src.db.drop_db().await;
}

#[tokio::test]
async fn postgres_restore_over_a_live_database_keeps_the_old_schema_aside() {
    let Some(base) = base_url() else { return };
    let library = tempfile::tempdir().unwrap();
    let (src, before) = source(&base, &library.path().display().to_string()).await;
    let sidecar = src.service.run_now("test").await.unwrap();

    let target = ScratchDb::create(&base).await;
    let old = target.migrated().await;
    sqlx::query("UPDATE system_settings SET instance_name = 'Old Server'")
        .execute(&old)
        .await
        .unwrap();
    old.close().await;

    let work = tempfile::tempdir().unwrap();
    let report = restore(opts(&src, &sidecar.archive_name, &target.url, work.path()))
        .await
        .unwrap();
    let previous = report.previous_installation.unwrap();
    let previous = previous.strip_prefix("schema ").unwrap().to_string();

    let restored = target.pool().await;
    assert_eq!(durable_state(&restored).await, before);
    let name: String = sqlx::query_scalar(&format!(
        "SELECT instance_name FROM \"{previous}\".system_settings"
    ))
    .fetch_one(&restored)
    .await
    .unwrap();
    assert_eq!(name, "Old Server");
    restored.close().await;
    target.drop_db().await;
    src.pool.close().await;
    src.db.drop_db().await;
}

#[tokio::test]
async fn postgres_failed_restore_leaves_the_current_database_untouched() {
    let Some(base) = base_url() else { return };
    let (src, _) = source(&base, "/media/x").await;
    let sidecar = src.service.run_now("test").await.unwrap();

    let target = ScratchDb::create(&base).await;
    let old = target.migrated().await;
    sqlx::query("UPDATE system_settings SET instance_name = 'Old Server'")
        .execute(&old)
        .await
        .unwrap();
    let schemas_before = schemas(&old).await;

    // An archive whose manifest disagrees with its data fails after the rows
    // are loaded into staging, which is the most expensive place to fail.
    let work = tempfile::tempdir().unwrap();
    let stage = work.path().join("tamper");
    std::fs::create_dir_all(&stage).unwrap();
    let snapshot = crate::snapshot::take_snapshot(&src.pool, &stage)
        .await
        .unwrap();
    let mut manifest = sidecar.manifest.clone();
    manifest.files = snapshot.files;
    manifest.tables = snapshot.tables;
    manifest
        .tables
        .iter_mut()
        .find(|t| t.name == "users")
        .unwrap()
        .rows += 1;
    let tampered = src.dest.join("tampered.parbak");
    let recipient = generate_key();
    crate::archive::write_archive(
        &manifest,
        &stage,
        &parse_recipients(&[recipient.public]).unwrap(),
        &tampered,
    )
    .unwrap();
    let mut bad = opts(&src, "tampered.parbak", &target.url, work.path());
    bad.identities = vec![recipient.secret.parse().unwrap()];
    let error = restore(bad).await.unwrap_err();
    assert!(matches!(error, BackupError::Corrupt(_)), "{error}");
    assert_eq!(schemas(&old).await, schemas_before);
    let name: String = sqlx::query_scalar("SELECT instance_name FROM system_settings")
        .fetch_one(&old)
        .await
        .unwrap();
    assert_eq!(name, "Old Server");

    // Wrong key and corruption also leave it alone.
    let mut wrong = opts(&src, &sidecar.archive_name, &target.url, work.path());
    wrong.identities = vec![generate_key().secret.parse().unwrap()];
    assert!(matches!(restore(wrong).await, Err(BackupError::WrongKey)));
    assert_eq!(schemas(&old).await, schemas_before);
    old.close().await;
    target.drop_db().await;
    src.pool.close().await;
    src.db.drop_db().await;
}

#[tokio::test]
async fn postgres_snapshot_is_consistent_under_concurrent_writes() {
    let Some(base) = base_url() else { return };
    let (src, _) = source(&base, "/media/x").await;
    sqlx::query("CREATE TABLE churn (n INTEGER NOT NULL)")
        .execute(&src.pool)
        .await
        .unwrap();
    let writer_pool = src.pool.clone();
    let writer = tokio::spawn(async move {
        for n in 0..300 {
            sqlx::query("INSERT INTO churn (n) VALUES ($1)")
                .bind(n)
                .execute(&writer_pool)
                .await
                .unwrap();
        }
    });
    let sidecar = src.service.run_now("test").await.unwrap();
    writer.await.unwrap();
    let recorded = sidecar
        .manifest
        .tables
        .iter()
        .find(|t| t.name == "churn")
        .unwrap()
        .rows;
    let extract = tempfile::tempdir().unwrap();
    crate::archive::verify_and_extract(
        &src.dest.join(&sidecar.archive_name),
        std::slice::from_ref(&src.identity),
        Some(extract.path()),
    )
    .unwrap();
    let lines = std::fs::read_to_string(extract.path().join("db/churn.ndjson"))
        .unwrap()
        .lines()
        .count() as u64;
    assert_eq!(lines, recorded);
    src.pool.close().await;
    src.db.drop_db().await;
}

#[tokio::test]
async fn postgres_backup_cannot_be_restored_into_sqlite() {
    let Some(base) = base_url() else { return };
    let (src, _) = source(&base, "/media/x").await;
    let sidecar = src.service.run_now("test").await.unwrap();
    let work = tempfile::tempdir().unwrap();
    let error = restore(opts(
        &src,
        &sidecar.archive_name,
        &format!("sqlite://{}/x.db", work.path().display()),
        work.path(),
    ))
    .await
    .unwrap_err();
    assert!(matches!(error, BackupError::Incompatible(_)), "{error}");
    src.pool.close().await;
    src.db.drop_db().await;
}

#[tokio::test]
async fn postgres_older_backup_is_migrated_forward() {
    let Some(base) = base_url() else { return };
    let db = ScratchDb::create(&base).await;
    let pool = db.pool().await;
    let latest = playarr_db::POSTGRES_MIGRATIONS
        .iter()
        .map(|m| m.version)
        .max()
        .unwrap();
    let older = playarr_db::POSTGRES_MIGRATIONS
        .iter()
        .map(|m| m.version)
        .filter(|v| *v < latest)
        .max()
        .unwrap();
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            playarr_db::POSTGRES_MIGRATIONS
                .iter()
                .filter(|m| m.version <= older)
                .cloned()
                .collect(),
        ),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    }
    .run(&pool)
    .await
    .unwrap();
    let root = tempfile::tempdir().unwrap();
    let key = generate_key();
    let identity: Identity = key.secret.parse().unwrap();
    let dest = root.path().join("b");
    let service = BackupService::new(
        BackupConfig {
            dir: dest.clone(),
            recipients: parse_recipients(&[key.public]).unwrap(),
            mode: BackupMode::Database,
            interval: None,
            keep_last: 2,
            keep_days: 30,
            artwork_dir: None,
            max_asset_bytes: 0,
        },
        pool.clone(),
        "old",
    );
    let sidecar = service.run_now("test").await.unwrap();
    assert_eq!(sidecar.manifest.schema_version, older);

    let target = ScratchDb::create(&base).await;
    let report = restore(RestoreOptions {
        archive: dest.join(&sidecar.archive_name),
        identities: vec![identity],
        database_url: target.url.clone(),
        work_dir: root.path().join("work"),
        artwork_dir: None,
        remap: vec![],
        identity_mode: IdentityMode::Replace,
        allow_missing_media: true,
        dry_run: false,
    })
    .await
    .unwrap();
    assert!(report.migrations_applied_after_restore);
    let restored = target.pool().await;
    assert_eq!(
        crate::snapshot::max_migration_version(&restored)
            .await
            .unwrap(),
        latest
    );
    restored.close().await;
    pool.close().await;
    target.drop_db().await;
    db.drop_db().await;
}
