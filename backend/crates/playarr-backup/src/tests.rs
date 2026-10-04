//! End-to-end tests of backup creation against real SQLite databases.

use std::path::Path;
use std::sync::Arc;

use age::x25519::Identity;
use playarr_db::DbPool;

use crate::archive::{read_manifest, verify_and_extract};
use crate::config::BackupConfig;
use crate::crypto::{generate_key, parse_recipients};
use crate::error::BackupError;
use crate::manifest::{BackupMode, Engine};
use crate::runner::BackupService;
use crate::store;

pub struct Fixture {
    pub _root: tempfile::TempDir,
    pub dest: std::path::PathBuf,
    pub db_path: std::path::PathBuf,
    pub pool: DbPool,
    pub identity: Identity,
    pub service: BackupService,
}

pub async fn open_sqlite(path: &Path) -> DbPool {
    let pool = playarr_db::connect(&format!("sqlite://{}", path.display()))
        .await
        .unwrap();
    playarr_db::run_migrations(&pool, false).await.unwrap();
    pool
}

pub async fn fixture(mode: BackupMode) -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let dest = root.path().join("backups");
    let db_path = root.path().join("playarr.db");
    let pool = open_sqlite(&db_path).await;
    sqlx::query("UPDATE system_settings SET instance_name = 'Source Server'")
        .execute(&pool)
        .await
        .unwrap();
    let key = generate_key();
    let identity: Identity = key.secret.parse().unwrap();
    let artwork = root.path().join("artwork");
    std::fs::create_dir_all(artwork.join("ab")).unwrap();
    std::fs::write(artwork.join("ab/poster.jpg"), b"poster bytes").unwrap();
    let config = BackupConfig {
        dir: dest.clone(),
        recipients: parse_recipients(&[key.public]).unwrap(),
        mode,
        interval: None,
        keep_last: 3,
        keep_days: 30,
        artwork_dir: Some(artwork),
        max_asset_bytes: 1 << 30,
    };
    let service = BackupService::new(config, pool.clone(), "test");
    Fixture {
        _root: root,
        dest,
        db_path,
        pool,
        identity,
        service,
    }
}

#[tokio::test]
async fn full_backup_round_trips_and_labels_contents() {
    let fx = fixture(BackupMode::Full).await;
    let sidecar = fx.service.run_now("manual").await.unwrap();
    assert_eq!(sidecar.manifest.engine, Engine::Sqlite);
    assert!(!sidecar.manifest.partial);
    assert!(sidecar.manifest.schema_version > 0);
    assert!(sidecar
        .manifest
        .files
        .iter()
        .any(|file| file.path == "assets/artwork/ab/poster.jpg"));

    let records = store::list_backups(&fx.dest).unwrap();
    assert_eq!(records.len(), 1);
    assert!(records[0].complete);

    let archive = fx.dest.join(&sidecar.archive_name);
    let extract = fx._root.path().join("extract");
    let manifest =
        verify_and_extract(&archive, std::slice::from_ref(&fx.identity), Some(&extract)).unwrap();
    assert_eq!(manifest.backup_id, sidecar.manifest.backup_id);
    assert_eq!(
        std::fs::read(extract.join("assets/artwork/ab/poster.jpg")).unwrap(),
        b"poster bytes"
    );
    let copy = open_sqlite(&extract.join("db/playarr.sqlite")).await;
    let name: String = sqlx::query_scalar("SELECT instance_name FROM system_settings")
        .fetch_one(&copy)
        .await
        .unwrap();
    assert_eq!(name, "Source Server");
    assert!(fx.dest.read_dir().unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".staging-")));
}

#[tokio::test]
async fn database_mode_is_labelled_partial_and_skips_assets() {
    let fx = fixture(BackupMode::Database).await;
    let sidecar = fx.service.run_now("manual").await.unwrap();
    assert!(sidecar.manifest.partial);
    assert!(!sidecar
        .manifest
        .files
        .iter()
        .any(|file| file.path.starts_with("assets/")));
    assert!(sidecar
        .manifest
        .excluded
        .iter()
        .any(|item| item.class == "media libraries"));
}

#[tokio::test]
async fn wrong_key_and_damage_are_detected() {
    let fx = fixture(BackupMode::Full).await;
    let sidecar = fx.service.run_now("manual").await.unwrap();
    let archive = fx.dest.join(&sidecar.archive_name);

    let stranger: Identity = generate_key().secret.parse().unwrap();
    assert!(matches!(
        read_manifest(&archive, &[stranger]),
        Err(BackupError::WrongKey)
    ));

    let original = std::fs::read(&archive).unwrap();
    let mut flipped = original.clone();
    let middle = flipped.len() / 2;
    flipped[middle] ^= 0xff;
    std::fs::write(&archive, &flipped).unwrap();
    assert!(matches!(
        verify_and_extract(&archive, std::slice::from_ref(&fx.identity), None),
        Err(BackupError::Corrupt(_))
    ));

    std::fs::write(&archive, &original[..original.len() / 2]).unwrap();
    assert!(matches!(
        verify_and_extract(&archive, std::slice::from_ref(&fx.identity), None),
        Err(BackupError::Corrupt(_))
    ));
    // The truncated archive no longer matches its sidecar size.
    assert!(!store::list_backups(&fx.dest).unwrap()[0].complete);
}

#[tokio::test]
async fn failed_runs_publish_nothing_and_keep_the_last_good_backup() {
    let fx = fixture(BackupMode::Full).await;
    let good = fx.service.run_now("manual").await.unwrap();

    for point in ["before_snapshot", "after_archive", "before_sidecar"] {
        let failing = fx.service.clone().with_fault_hook(Arc::new(move |at| {
            if at == point {
                Err(std::io::Error::other("injected destination failure"))
            } else {
                Ok(())
            }
        }));
        assert!(failing.run_now("schedule").await.is_err(), "{point}");
        let records = store::list_backups(&fx.dest).unwrap();
        assert_eq!(records.len(), 1, "{point}: nothing new may be advertised");
        assert_eq!(
            records[0].sidecar.manifest.backup_id,
            good.manifest.backup_id
        );
        assert!(records[0].complete);
        let leftovers: Vec<String> = fx
            .dest
            .read_dir()
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".partial") || name.starts_with(".staging-"))
            .collect();
        let archives = fx
            .dest
            .read_dir()
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".parbak")
            })
            .count();
        assert!(leftovers.is_empty(), "{point}: {leftovers:?}");
        assert_eq!(archives, 1, "{point}: orphan archive left behind");
    }
    assert_eq!(store::list_failures(&fx.dest, 10).len(), 3);
}

#[tokio::test]
async fn retention_after_repeated_failures_never_removes_the_last_good_backup() {
    let fx = fixture(BackupMode::Database).await;
    let mut config = fx.service.config().clone();
    config.keep_last = 1;
    config.keep_days = 0;
    let service = BackupService::new(config, fx.pool.clone(), "test");
    let good = service.run_now("manual").await.unwrap();
    let failing = service.clone().with_fault_hook(Arc::new(|at| {
        if at == "after_archive" {
            Err(std::io::Error::other("full"))
        } else {
            Ok(())
        }
    }));
    for _ in 0..3 {
        assert!(failing.run_now("schedule").await.is_err());
    }
    let records = store::list_backups(&fx.dest).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].sidecar.manifest.backup_id,
        good.manifest.backup_id
    );
}

#[tokio::test]
async fn insufficient_space_is_refused_before_any_write() {
    let fx = fixture(BackupMode::Full).await;
    let service = fx.service.clone().with_free_space(10);
    assert!(matches!(
        service.run_now("manual").await,
        Err(BackupError::InsufficientSpace(_))
    ));
    assert!(store::list_backups(&fx.dest).unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_second_run_is_refused_while_one_is_active() {
    let fx = fixture(BackupMode::Database).await;
    let blocker = fx.service.clone().with_fault_hook(Arc::new(|at| {
        if at == "before_snapshot" {
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
        Ok(())
    }));
    blocker.start("manual").unwrap();
    assert!(matches!(blocker.start("manual"), Err(BackupError::Busy)));
    assert!(blocker.current().is_some());
    for _ in 0..100 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if blocker.current().is_none() {
            break;
        }
    }
    assert_eq!(store::list_backups(&fx.dest).unwrap().len(), 1);
}

#[tokio::test]
async fn snapshot_is_consistent_while_writers_continue() {
    let fx = fixture(BackupMode::Database).await;
    sqlx::query("CREATE TABLE IF NOT EXISTS churn (n INTEGER NOT NULL)")
        .execute(&fx.pool)
        .await
        .unwrap();
    let writer_pool = fx.pool.clone();
    let writer = tokio::spawn(async move {
        for n in 0..400 {
            sqlx::query("INSERT INTO churn (n) VALUES (?)")
                .bind(n as i64)
                .execute(&writer_pool)
                .await
                .unwrap();
        }
    });
    let sidecar = fx.service.run_now("manual").await.unwrap();
    writer.await.unwrap();

    let extract = fx._root.path().join("extract");
    verify_and_extract(
        &fx.dest.join(&sidecar.archive_name),
        std::slice::from_ref(&fx.identity),
        Some(&extract),
    )
    .unwrap();
    let copy = open_sqlite(&extract.join("db/playarr.sqlite")).await;
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM churn")
        .fetch_one(&copy)
        .await
        .unwrap();
    let recorded = sidecar
        .manifest
        .tables
        .iter()
        .find(|table| table.name == "churn")
        .unwrap()
        .rows as i64;
    assert_eq!(rows, recorded);
    assert!(fx.db_path.exists());
}

// ------------------------------------------------------------------------
// Shared helpers for restore tests (SQLite here, PostgreSQL in postgres_tests)
// ------------------------------------------------------------------------

/// A representative multi-user, multi-library dataset using only literal SQL
/// so the same statements run on both engines.
pub async fn seed_representative_data(pool: &DbPool, library_root: &str) {
    let statements = [
        "UPDATE system_settings SET instance_name = 'Source Server'",
        "INSERT INTO policies (id, name, is_admin, library_allow, blocked_tags, can_download) VALUES ('pol-admin', 'Administrators', 1, '[]', '[]', 1)",
        "INSERT INTO policies (id, name, is_admin, library_allow, blocked_tags, can_download) VALUES ('pol-kid', 'Kids', 0, '[\"lib-tv\"]', '[\"horror\"]', 0)",
        "INSERT INTO users (id, username, display_name, password_hash, policy_id, created_at) VALUES ('u-alice', 'alice', 'Alice', 'argon2-hash-alice', 'pol-admin', '2026-01-01T00:00:00Z')",
        "INSERT INTO users (id, username, display_name, password_hash, policy_id, created_at) VALUES ('u-bob', 'bob', 'Bob Ünïcode', 'argon2-hash-bob', 'pol-kid', '2026-01-02T00:00:00Z')",
        "INSERT INTO source_instances (id, kind, name, base_url, api_key_encrypted) VALUES ('src-1', 'sonarr', 'TV', 'http://sonarr.invalid', 'key-1')",
        "INSERT INTO source_instances (id, kind, name, base_url, api_key_encrypted, enabled_for_requests) VALUES ('src-2', 'radarr', 'Movies', 'http://radarr.invalid', 'key-2', 1)",
        "INSERT INTO works (id, kind, title, sort_title, added_at, availability) VALUES ('w-1', 'movie', 'First', 'first', '2026-01-01T00:00:00Z', 'available')",
        "INSERT INTO works (id, kind, title, sort_title, added_at, availability) VALUES ('w-2', 'movie', 'Second', 'second', '2026-01-01T00:00:00Z', 'available')",
        "INSERT INTO works (id, kind, title, sort_title, added_at, availability) VALUES ('w-3', 'movie', 'Third', 'third', '2026-01-01T00:00:00Z', 'available')",
        "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, size_bytes, source_instance_id) VALUES ('mf-1', 'w-1', 'w-1', '/media/movies/first.mkv', 'mkv', 'h264', 100, 'src-2')",
        "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, size_bytes, source_instance_id) VALUES ('mf-2', 'w-2', 'w-2', '/media/movies/second.mkv', 'mkv', 'hevc', 200, 'src-2')",
        "INSERT INTO watch_progress (user_id, media_file_id, position_ms, duration_ms, state, updated_at) VALUES ('u-bob', 'mf-1', 60000, 120000, 'in_progress', '2026-02-01T00:00:00Z')",
        "INSERT INTO playlists (id, name, owner_user_id, parent_playlist_id, created_at, updated_at) VALUES ('pl-parent', 'Weekend', 'u-alice', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        "INSERT INTO playlists (id, name, owner_user_id, parent_playlist_id, created_at, updated_at) VALUES ('pl-child', 'Weekend Extras', 'u-alice', 'pl-parent', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        "INSERT INTO playlist_items (id, playlist_id, work_id, position, added_at) VALUES ('pi-3', 'pl-parent', 'w-3', 3, '2026-01-01T00:00:00Z')",
        "INSERT INTO playlist_items (id, playlist_id, work_id, position, added_at) VALUES ('pi-1', 'pl-parent', 'w-1', 1, '2026-01-01T00:00:00Z')",
        "INSERT INTO playlist_items (id, playlist_id, work_id, position, added_at) VALUES ('pi-2', 'pl-parent', 'w-2', 2, '2026-01-01T00:00:00Z')",
        "INSERT INTO refresh_token_families (device_id, user_id, session_id, family_id, generation, current_hash, issued_at, expires_at) VALUES ('dev-1', 'u-bob', 's-1', 'f-1', 1, 'h', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')",
        "INSERT INTO node_identity (id, peer_id, private_key, created_at) VALUES ('self', 'peer-source', 'private-key-material', '2026-01-01T00:00:00Z')",
    ];
    for statement in statements {
        sqlx::query(statement).execute(pool).await.unwrap();
    }
    let root_sql = format!(
        "INSERT INTO source_root_folders (id, source_instance_id, source_root_id, reported_path, local_path_override, display_name, work_kind, accessible, active, scan_status, updated_at) VALUES ('rf-1', 'src-2', '1', '{library_root}', NULL, 'Movies', 'movie', 1, 1, 'complete', '2026-01-01T00:00:00Z')"
    );
    sqlx::query(&root_sql).execute(pool).await.unwrap();
    sqlx::query(
        "INSERT INTO folder_media_entries (id, root_folder_id, media_file_id, relative_path, directory_path, file_name, work_kind, title, modified_at, metadata, scanned_at) VALUES ('fme-1', 'rf-1', 'mf-1', 'first.mkv', '', 'first.mkv', 'movie', 'First', NULL, '{}', '2026-01-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Text rendering of the durable state that restore must reproduce exactly.
pub async fn durable_state(pool: &DbPool) -> Vec<String> {
    let queries = [
        "SELECT instance_name FROM system_settings",
        "SELECT id || '|' || name || '|' || CAST(is_admin AS TEXT) || '|' || library_allow || '|' || blocked_tags || '|' || CAST(can_download AS TEXT) FROM policies ORDER BY id",
        "SELECT id || '|' || username || '|' || display_name || '|' || password_hash || '|' || policy_id FROM users ORDER BY id",
        "SELECT id || '|' || kind || '|' || name || '|' || base_url || '|' || api_key_encrypted FROM source_instances ORDER BY id",
        "SELECT id || '|' || title FROM works ORDER BY id",
        "SELECT id || '|' || work_id || '|' || path || '|' || codec FROM media_files ORDER BY id",
        "SELECT id || '|' || source_instance_id || '|' || reported_path || '|' || COALESCE(local_path_override, '-') || '|' || CAST(accessible AS TEXT) || '|' || scan_status FROM source_root_folders ORDER BY id",
        "SELECT id || '|' || root_folder_id || '|' || media_file_id || '|' || relative_path || '|' || metadata FROM folder_media_entries ORDER BY id",
        "SELECT user_id || '|' || media_file_id || '|' || CAST(position_ms AS TEXT) || '|' || state FROM watch_progress ORDER BY user_id",
        "SELECT id || '|' || name || '|' || COALESCE(parent_playlist_id, '-') FROM playlists ORDER BY id",
        "SELECT playlist_id || '|' || CAST(position AS TEXT) || '|' || work_id FROM playlist_items ORDER BY playlist_id, position",
    ];
    let mut out = Vec::new();
    for query in queries {
        let rows: Vec<String> = sqlx::query_scalar(query).fetch_all(pool).await.unwrap();
        out.push(format!("{query}\n{}", rows.join("\n")));
    }
    out
}
