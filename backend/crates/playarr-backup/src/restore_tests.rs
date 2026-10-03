//! Restore tests against real SQLite databases, including every refusal path.

use std::path::{Path, PathBuf};

use age::x25519::Identity;

use crate::archive::write_archive;
use crate::config::BackupConfig;
use crate::crypto::{generate_key, parse_recipients};
use crate::error::BackupError;
use crate::manifest::{archive_file_name, BackupMode, Manifest};
use crate::restore::{restore, IdentityMode, RestoreOptions};
use crate::runner::BackupService;
use crate::snapshot::take_snapshot;
use crate::tests::{durable_state, fixture, open_sqlite, seed_representative_data, Fixture};

struct Backup {
    archive: PathBuf,
    identity: Identity,
}

async fn seeded_backup(library_root: &str) -> (Fixture, Backup, Vec<String>) {
    let fx = fixture(BackupMode::Full).await;
    seed_representative_data(&fx.pool, library_root).await;
    let before = durable_state(&fx.pool).await;
    let sidecar = fx.service.run_now("test").await.unwrap();
    let backup = Backup {
        archive: fx.dest.join(&sidecar.archive_name),
        identity: fx.identity.clone(),
    };
    (fx, backup, before)
}

fn options(backup: &Backup, root: &Path, target: &Path) -> RestoreOptions {
    RestoreOptions {
        archive: backup.archive.clone(),
        identities: vec![backup.identity.clone()],
        database_url: format!("sqlite://{}", target.display()),
        work_dir: root.join("work"),
        artwork_dir: Some(root.join("restored-artwork")),
        remap: vec![],
        identity_mode: IdentityMode::Replace,
        allow_missing_media: false,
        dry_run: false,
    }
}

fn dir_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

#[tokio::test]
async fn replacement_restore_reproduces_all_durable_state() {
    let library = tempfile::tempdir().unwrap();
    let library_root = library.path().display().to_string();
    let (fx, backup, before) = seeded_backup(&library_root).await;
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("state/playarr.db");

    let report = restore(options(&backup, root.path(), &target))
        .await
        .unwrap();
    assert!(report.cutover);
    assert!(report.rows_restored > 0);
    assert!(report.missing_library_roots.is_empty());
    assert_eq!(report.artwork_files_restored, 1);

    let restored = open_sqlite(&target).await;
    assert_eq!(durable_state(&restored).await, before);

    // Sessions are gone; users and their password hashes are not.
    let tokens: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_token_families")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(tokens, 0);
    // Replacement keeps the peer identity.
    let peer: String = sqlx::query_scalar("SELECT peer_id FROM node_identity")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(peer, "peer-source");
    assert_eq!(
        std::fs::read(root.path().join("restored-artwork/ab/poster.jpg")).unwrap(),
        b"poster bytes"
    );
    // The staging area is cleaned up.
    assert!(dir_names(&root.path().join("work")).is_empty());
    drop(fx);
}

#[tokio::test]
async fn restore_over_an_existing_installation_keeps_it_aside() {
    let library = tempfile::tempdir().unwrap();
    let (_fx, backup, before) = seeded_backup(&library.path().display().to_string()).await;
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("playarr.db");
    let old = open_sqlite(&target).await;
    sqlx::query("UPDATE system_settings SET instance_name = 'Old Server'")
        .execute(&old)
        .await
        .unwrap();
    old.close().await;

    let report = restore(options(&backup, root.path(), &target))
        .await
        .unwrap();
    assert!(report.previous_installation.is_some());
    let previous = PathBuf::from(report.previous_installation.unwrap());
    let kept = open_sqlite(&previous).await;
    let name: String = sqlx::query_scalar("SELECT instance_name FROM system_settings")
        .fetch_one(&kept)
        .await
        .unwrap();
    assert_eq!(name, "Old Server");
    assert_eq!(durable_state(&open_sqlite(&target).await).await, before);
}

#[tokio::test]
async fn missing_library_roots_block_cutover_and_leave_the_installation_untouched() {
    let (_fx, backup, _) = seeded_backup("/media/does-not-exist-here").await;
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("playarr.db");
    let old = open_sqlite(&target).await;
    sqlx::query("UPDATE system_settings SET instance_name = 'Old Server'")
        .execute(&old)
        .await
        .unwrap();
    old.close().await;
    let before_files = dir_names(root.path());

    let error = restore(options(&backup, root.path(), &target))
        .await
        .unwrap_err();
    assert!(matches!(error, BackupError::Refused(_)), "{error}");

    let still = open_sqlite(&target).await;
    let name: String = sqlx::query_scalar("SELECT instance_name FROM system_settings")
        .fetch_one(&still)
        .await
        .unwrap();
    assert_eq!(name, "Old Server");
    still.close().await;
    // Only the staging parent directory may have appeared.
    // SQLite's own -wal/-shm files appear whenever the database is opened.
    let relevant = |names: &mut Vec<String>| {
        names.retain(|name| name != "work" && !name.ends_with("-wal") && !name.ends_with("-shm"));
    };
    let mut after = dir_names(root.path());
    relevant(&mut after);
    let mut expected = before_files;
    relevant(&mut expected);
    assert_eq!(after, expected);
    assert!(dir_names(&root.path().join("work")).is_empty());

    // Explicitly allowing missing media restores and reports the gap.
    let mut allowed = options(&backup, root.path(), &target);
    allowed.allow_missing_media = true;
    let report = restore(allowed).await.unwrap();
    assert_eq!(
        report.missing_library_roots,
        vec!["/media/does-not-exist-here"]
    );
}

#[tokio::test]
async fn path_remapping_rewrites_media_and_library_roots() {
    let library = tempfile::tempdir().unwrap();
    let new_root = library.path().display().to_string();
    let (_fx, backup, _) = seeded_backup("/media/movies").await;
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("playarr.db");
    let mut opts = options(&backup, root.path(), &target);
    opts.remap = vec![("/media/movies".to_string(), new_root.clone())];
    let report = restore(opts).await.unwrap();
    assert!(report.remapped_paths >= 3, "{}", report.remapped_paths);
    assert!(report.missing_library_roots.is_empty());

    let restored = open_sqlite(&target).await;
    let path: String = sqlx::query_scalar("SELECT path FROM media_files WHERE id = 'mf-1'")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(path, format!("{new_root}/first.mkv"));
}

#[tokio::test]
async fn clone_mode_cannot_act_as_the_original() {
    let library = tempfile::tempdir().unwrap();
    let (_fx, backup, _) = seeded_backup(&library.path().display().to_string()).await;
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("playarr.db");
    let mut opts = options(&backup, root.path(), &target);
    opts.identity_mode = IdentityMode::Clone;
    restore(opts).await.unwrap();

    let restored = open_sqlite(&target).await;
    let identities: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM node_identity")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(identities, 0);
    let forwarding: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM source_instances WHERE enabled_for_requests = 1")
            .fetch_one(&restored)
            .await
            .unwrap();
    assert_eq!(forwarding, 0);
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(users, 2);
}

#[tokio::test]
async fn dry_run_validates_without_changing_anything() {
    let library = tempfile::tempdir().unwrap();
    let (_fx, backup, _) = seeded_backup(&library.path().display().to_string()).await;
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("playarr.db");
    let mut opts = options(&backup, root.path(), &target);
    opts.dry_run = true;
    let report = restore(opts).await.unwrap();
    assert!(!report.cutover);
    assert!(!target.exists());
    assert!(!root.path().join("restored-artwork").exists());
}

#[tokio::test]
async fn wrong_key_corruption_and_engine_mismatch_change_nothing() {
    let library = tempfile::tempdir().unwrap();
    let (_fx, backup, _) = seeded_backup(&library.path().display().to_string()).await;
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("playarr.db");

    let mut wrong = options(&backup, root.path(), &target);
    wrong.identities = vec![generate_key().secret.parse().unwrap()];
    assert!(matches!(restore(wrong).await, Err(BackupError::WrongKey)));

    let damaged = root.path().join("damaged.parbak");
    let mut bytes = std::fs::read(&backup.archive).unwrap();
    let middle = bytes.len() / 2;
    bytes[middle] ^= 0x55;
    std::fs::write(&damaged, bytes).unwrap();
    let mut corrupt = options(&backup, root.path(), &target);
    corrupt.archive = damaged;
    assert!(matches!(
        restore(corrupt).await,
        Err(BackupError::Corrupt(_))
    ));

    let mut mismatch = options(&backup, root.path(), &target);
    mismatch.database_url = "postgres://nobody@127.0.0.1:1/none".to_string();
    assert!(matches!(
        restore(mismatch).await,
        Err(BackupError::Incompatible(_))
    ));
    assert!(!target.exists());
}

/// Builds an archive whose manifest has been altered by `tamper`.
async fn tampered_archive(fx: &Fixture, tamper: impl FnOnce(&mut Manifest)) -> (PathBuf, Identity) {
    let stage = fx
        ._root
        .path()
        .join(format!("tamper-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&stage).unwrap();
    let snapshot = take_snapshot(&fx.pool, &stage).await.unwrap();
    let sidecar = crate::store::list_backups(&fx.dest)
        .unwrap()
        .remove(0)
        .sidecar;
    let mut manifest = sidecar.manifest;
    manifest.files = snapshot.files;
    manifest.tables = snapshot.tables;
    manifest.schema_version = snapshot.schema_version;
    tamper(&mut manifest);
    let key = generate_key();
    let out = fx._root.path().join(archive_file_name(
        manifest.created_at,
        &uuid::Uuid::new_v4().simple().to_string()[..8],
    ));
    write_archive(
        &manifest,
        &stage,
        &parse_recipients(&[key.public]).unwrap(),
        &out,
    )
    .unwrap();
    (out, key.secret.parse().unwrap())
}

#[tokio::test]
async fn newer_schema_and_inconsistent_counts_are_refused() {
    let library = tempfile::tempdir().unwrap();
    let (fx, backup, _) = seeded_backup(&library.path().display().to_string()).await;
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("playarr.db");

    let (archive, identity) = tampered_archive(&fx, |m| m.schema_version += 1000).await;
    let mut opts = options(&backup, root.path(), &target);
    opts.archive = archive;
    opts.identities = vec![identity];
    assert!(matches!(
        restore(opts).await,
        Err(BackupError::Incompatible(_))
    ));

    let (archive, identity) = tampered_archive(&fx, |m| {
        m.tables
            .iter_mut()
            .find(|t| t.name == "users")
            .unwrap()
            .rows += 1;
    })
    .await;
    let mut opts = options(&backup, root.path(), &target);
    opts.archive = archive;
    opts.identities = vec![identity];
    opts.allow_missing_media = true;
    assert!(matches!(restore(opts).await, Err(BackupError::Corrupt(_))));
    assert!(!target.exists());
    assert!(dir_names(&root.path().join("work")).is_empty());
}

#[tokio::test]
async fn an_older_backup_is_migrated_forward_after_restore() {
    // Source database stopped at an earlier migration.
    let root = tempfile::tempdir().unwrap();
    let source_path = root.path().join("old.db");
    let pool = playarr_db::connect(&format!("sqlite://{}", source_path.display()))
        .await
        .unwrap();
    let latest = playarr_db::SQLITE_MIGRATIONS
        .iter()
        .map(|m| m.version)
        .max()
        .unwrap();
    let older = playarr_db::SQLITE_MIGRATIONS
        .iter()
        .map(|m| m.version)
        .filter(|v| *v < latest)
        .max()
        .unwrap();
    let partial = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            playarr_db::SQLITE_MIGRATIONS
                .iter()
                .filter(|m| m.version <= older)
                .cloned()
                .collect(),
        ),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    };
    partial.run(&pool).await.unwrap();

    let key = generate_key();
    let identity: Identity = key.secret.parse().unwrap();
    let dest = root.path().join("backups");
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

    let target = root.path().join("new.db");
    let report = restore(RestoreOptions {
        archive: dest.join(&sidecar.archive_name),
        identities: vec![identity],
        database_url: format!("sqlite://{}", target.display()),
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
    assert!(report.partial_backup);
    let restored = playarr_db::connect(&format!("sqlite://{}", target.display()))
        .await
        .unwrap();
    assert_eq!(
        crate::snapshot::max_migration_version(&restored)
            .await
            .unwrap(),
        latest
    );
}
