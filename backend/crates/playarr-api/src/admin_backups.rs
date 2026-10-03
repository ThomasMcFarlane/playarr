//! Administrator API for server backups (`docs/architecture/server-backups.md`).
//!
//! Everything here requires an administrator. Responses never carry key
//! material: only recipient fingerprints. Download streams the archive exactly
//! as stored, already encrypted.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use chrono::{DateTime, Utc};
use playarr_backup::manifest::InventoryItem;
use playarr_backup::{store, BackupError};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{AdminUser, ApiError, AppState};

#[derive(Debug, Serialize, ToSchema)]
pub struct BackupInventoryItem {
    pub class: String,
    pub detail: String,
}

impl From<&InventoryItem> for BackupInventoryItem {
    fn from(item: &InventoryItem) -> Self {
        Self {
            class: item.class.clone(),
            detail: item.detail.clone(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BackupSummary {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub archive_name: String,
    pub size_bytes: u64,
    pub engine: String,
    pub schema_version: i64,
    pub server_version: String,
    /// `full` or `database`.
    pub mode: String,
    /// True when the backup does not contain everything (database mode, or an
    /// asset class skipped); see `unavailable` and `excluded`.
    pub partial: bool,
    /// False when the archive named by the commit record is missing or has the
    /// wrong size. Incomplete backups are never offered for restore.
    pub complete: bool,
    pub tables: usize,
    pub rows: u64,
    pub included: Vec<BackupInventoryItem>,
    pub excluded: Vec<BackupInventoryItem>,
    pub unavailable: Vec<BackupInventoryItem>,
    pub library_roots: Vec<String>,
    pub required_secrets: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BackupRunStatus {
    pub id: String,
    pub started_at: DateTime<Utc>,
    /// `manual`, `schedule` or `cli`.
    pub trigger: String,
    /// `starting`, `preflight`, `snapshot`, `assets`, `archive`, `publish` or `retention`.
    pub phase: String,
    pub bytes_staged: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BackupFailure {
    pub id: String,
    pub at: DateTime<Utc>,
    pub phase: String,
    pub error: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BackupOverview {
    /// False until `PLAYARR_BACKUP_DIR` and `PLAYARR_BACKUP_RECIPIENTS` are set.
    pub enabled: bool,
    pub destination: Option<String>,
    pub mode: Option<String>,
    /// Hours between scheduled runs; absent means manual only.
    pub schedule_hours: Option<u64>,
    pub keep_last: Option<usize>,
    pub keep_days: Option<i64>,
    /// Short identifiers of the configured recovery public keys.
    pub recipient_fingerprints: Vec<String>,
    pub current: Option<BackupRunStatus>,
    pub backups: Vec<BackupSummary>,
    pub failures: Vec<BackupFailure>,
    /// Command to run on the replacement server to restore a backup.
    pub restore_command: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StartedBackup {
    pub id: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BackupVerification {
    pub ok: bool,
    pub expected_sha256: String,
    pub actual_sha256: String,
    pub size_bytes: u64,
}

fn service(state: &AppState) -> Result<&playarr_backup::BackupService, ApiError> {
    state
        .backup
        .as_deref()
        .ok_or_else(|| ApiError::not_found("backups are not configured on this server"))
}

fn map_error(error: BackupError) -> ApiError {
    match error {
        BackupError::NotFound => ApiError::not_found("backup not found"),
        BackupError::Busy => ApiError::conflict("a backup is already running"),
        BackupError::Refused(message) => ApiError::conflict(message),
        other => ApiError::internal(format!("backup operation failed: {other}")),
    }
}

fn summarise(record: &store::BackupRecord) -> BackupSummary {
    let manifest = &record.sidecar.manifest;
    BackupSummary {
        id: manifest.backup_id.clone(),
        created_at: manifest.created_at,
        archive_name: record.sidecar.archive_name.clone(),
        size_bytes: record.sidecar.archive_size,
        engine: manifest.engine.as_str().to_string(),
        schema_version: manifest.schema_version,
        server_version: manifest.server_version.clone(),
        mode: match manifest.mode {
            playarr_backup::manifest::BackupMode::Full => "full",
            playarr_backup::manifest::BackupMode::Database => "database",
        }
        .to_string(),
        partial: manifest.partial,
        complete: record.complete,
        tables: manifest.tables.len(),
        rows: manifest.tables.iter().map(|table| table.rows).sum(),
        included: manifest.included.iter().map(Into::into).collect(),
        excluded: manifest.excluded.iter().map(Into::into).collect(),
        unavailable: manifest.unavailable.iter().map(Into::into).collect(),
        library_roots: manifest.external_dependencies.library_roots.clone(),
        required_secrets: manifest.external_dependencies.required_secrets.clone(),
    }
}

const RESTORE_COMMAND: &str = "playarr-server backup restore --archive <file> --identity-file <recovery-key-file> [--remap-path OLD=NEW] [--identity replace|clone] [--dry-run]";

#[utoipa::path(
    get,
    path = "/api/v1/admin/backups",
    tag = "admin",
    responses(
        (status = 200, description = "Backup configuration, current run, history and recent failures", body = BackupOverview),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn get_backups_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<BackupOverview>, ApiError> {
    let Some(service) = state.backup.as_deref() else {
        return Ok(Json(BackupOverview {
            enabled: false,
            destination: None,
            mode: None,
            schedule_hours: None,
            keep_last: None,
            keep_days: None,
            recipient_fingerprints: vec![],
            current: None,
            backups: vec![],
            failures: vec![],
            restore_command: RESTORE_COMMAND.to_string(),
        }));
    };
    let config = service.config();
    let dir = config.dir.clone();
    let (records, failures) = tokio::task::spawn_blocking(move || {
        (store::list_backups(&dir), store::list_failures(&dir, 10))
    })
    .await
    .map_err(|error| ApiError::internal(error.to_string()))?;
    let records = records.map_err(map_error)?;
    Ok(Json(BackupOverview {
        enabled: true,
        destination: Some(config.dir.display().to_string()),
        mode: Some(
            match config.mode {
                playarr_backup::manifest::BackupMode::Full => "full",
                playarr_backup::manifest::BackupMode::Database => "database",
            }
            .to_string(),
        ),
        schedule_hours: config.interval.map(|interval| interval.as_secs() / 3600),
        keep_last: Some(config.keep_last),
        keep_days: Some(config.keep_days),
        recipient_fingerprints: config.recipient_fingerprints(),
        current: service.current().map(|run| BackupRunStatus {
            id: run.id,
            started_at: run.started_at,
            trigger: run.trigger,
            phase: run.phase,
            bytes_staged: run.bytes_staged,
        }),
        backups: records.iter().map(summarise).collect(),
        failures: failures
            .into_iter()
            .map(|failure| BackupFailure {
                id: failure.id,
                at: failure.at,
                phase: failure.phase,
                error: failure.error,
            })
            .collect(),
        restore_command: RESTORE_COMMAND.to_string(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/backups",
    tag = "admin",
    responses(
        (status = 202, description = "A backup run was started in the background", body = StartedBackup),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "Backups are not configured"),
        (status = 409, description = "A backup is already running")
    )
)]
pub async fn start_backup_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<(StatusCode, Json<StartedBackup>), ApiError> {
    let id = service(&state)?.start("manual").map_err(map_error)?;
    Ok((StatusCode::ACCEPTED, Json(StartedBackup { id })))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/backups/{id}/download",
    tag = "admin",
    params(("id" = String, Path, description = "Backup id")),
    responses(
        (status = 200, description = "The encrypted archive, byte for byte", content_type = "application/octet-stream"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No complete backup with this id")
    )
)]
pub async fn download_backup_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let service = service(&state)?;
    let dir = service.config().dir.clone();
    let record = store::find_backup(&dir, &id).map_err(map_error)?;
    if !record.complete {
        return Err(ApiError::not_found("backup is incomplete"));
    }
    let file = tokio::fs::File::open(dir.join(&record.sidecar.archive_name))
        .await
        .map_err(|error| ApiError::internal(format!("cannot open backup: {error}")))?;
    let body = Body::from_stream(tokio_util::io::ReaderStream::with_capacity(
        file,
        256 * 1024,
    ));
    let mut response = Response::new(body);
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from(record.sidecar.archive_size),
    );
    if let Ok(value) = HeaderValue::from_str(&format!(
        "attachment; filename=\"{}\"",
        record.sidecar.archive_name
    )) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    Ok(response)
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/backups/{id}/verify",
    tag = "admin",
    params(("id" = String, Path, description = "Backup id")),
    responses(
        (status = 200, description = "Whether the stored archive still matches its recorded checksum. Decrypting needs the recovery key and is done with the CLI.", body = BackupVerification),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No backup with this id")
    )
)]
pub async fn verify_backup_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> Result<Json<BackupVerification>, ApiError> {
    let dir = service(&state)?.config().dir.clone();
    let result =
        tokio::task::spawn_blocking(move || -> playarr_backup::Result<BackupVerification> {
            let record = store::find_backup(&dir, &id)?;
            let actual = if record.complete {
                playarr_backup::archive::sha256_of(&dir.join(&record.sidecar.archive_name))?
            } else {
                String::new()
            };
            Ok(BackupVerification {
                ok: record.complete && actual == record.sidecar.archive_sha256,
                expected_sha256: record.sidecar.archive_sha256.clone(),
                actual_sha256: actual,
                size_bytes: record.sidecar.archive_size,
            })
        })
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?
        .map_err(map_error)?;
    Ok(Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/backups/{id}",
    tag = "admin",
    params(("id" = String, Path, description = "Backup id")),
    responses(
        (status = 204, description = "Backup deleted"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No backup with this id"),
        (status = 409, description = "This is the only complete backup")
    )
)]
pub async fn delete_backup_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let dir = service(&state)?.config().dir.clone();
    tokio::task::spawn_blocking(move || store::delete_backup(&dir, &id))
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?
        .map_err(map_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, test_state, test_version_gate,
    };
    use crate::{build_router, AppState};
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use playarr_backup::config::BackupConfig;
    use playarr_backup::crypto::{generate_key, parse_recipients};
    use std::sync::Arc;
    use tower::ServiceExt;
    use uuid::Uuid;

    struct Setup {
        router: Router,
        token: String,
        user_token: String,
        identity: playarr_backup::crypto::Identity,
        _dir: tempfile::TempDir,
    }

    async fn setup(configured: bool) -> Setup {
        let (_, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let user_token = mint_access_token(&state, state.default_user_id);
        let dir = tempfile::tempdir().unwrap();
        let key = generate_key();
        let identity: playarr_backup::crypto::Identity = key.secret.parse().unwrap();
        let mut app: AppState = state.app.clone();
        if configured {
            let config = BackupConfig {
                dir: dir.path().join("backups"),
                recipients: parse_recipients(&[key.public]).unwrap(),
                mode: playarr_backup::manifest::BackupMode::Database,
                interval: None,
                keep_last: 3,
                keep_days: 30,
                artwork_dir: None,
                max_asset_bytes: 0,
            };
            // A file-backed database, like every real SQLite deployment; the
            // router's own in-memory test pool cannot be copied with VACUUM INTO.
            let pool = playarr_db::connect(&format!(
                "sqlite://{}",
                dir.path().join("playarr.db").display()
            ))
            .await
            .unwrap();
            playarr_db::run_migrations(&pool, false).await.unwrap();
            app.backup = Some(Arc::new(playarr_backup::BackupService::new(
                config, pool, "test",
            )));
        }
        let (router, _) = build_router(app, test_version_gate(), None);
        Setup {
            router,
            token,
            user_token,
            identity,
            _dir: dir,
        }
    }

    async fn call(
        router: &Router,
        method: &str,
        uri: &str,
        token: Option<&str>,
    ) -> (StatusCode, Vec<u8>) {
        let mut request = Request::builder().method(method).uri(uri);
        if let Some(token) = token {
            request = request.header("authorization", bearer_header(token));
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, bytes.to_vec())
    }

    #[tokio::test]
    async fn every_endpoint_requires_an_administrator() {
        let setup = setup(true).await;
        for (method, uri) in [
            ("GET", "/api/v1/admin/backups"),
            ("POST", "/api/v1/admin/backups"),
            ("GET", "/api/v1/admin/backups/abc/download"),
            ("POST", "/api/v1/admin/backups/abc/verify"),
            ("DELETE", "/api/v1/admin/backups/abc"),
        ] {
            let (status, _) = call(&setup.router, method, uri, None).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
            let (status, _) = call(&setup.router, method, uri, Some(&setup.user_token)).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
        }
    }

    #[tokio::test]
    async fn unconfigured_server_reports_disabled() {
        let setup = setup(false).await;
        let (status, body) = call(
            &setup.router,
            "GET",
            "/api/v1/admin/backups",
            Some(&setup.token),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let overview: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(overview["enabled"], false);
        let (status, _) = call(
            &setup.router,
            "POST",
            "/api/v1/admin/backups",
            Some(&setup.token),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn admin_can_run_list_download_verify_and_delete_a_backup() {
        let setup = setup(true).await;
        let (status, body) = call(
            &setup.router,
            "POST",
            "/api/v1/admin/backups",
            Some(&setup.token),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::ACCEPTED,
            "{}",
            String::from_utf8_lossy(&body)
        );

        let mut overview = serde_json::Value::Null;
        for _ in 0..200 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let (_, body) = call(
                &setup.router,
                "GET",
                "/api/v1/admin/backups",
                Some(&setup.token),
            )
            .await;
            overview = serde_json::from_slice(&body).unwrap();
            if overview["current"].is_null() && !overview["backups"].as_array().unwrap().is_empty()
            {
                break;
            }
        }
        assert_eq!(overview["enabled"], true, "{overview}");
        assert_eq!(overview["mode"], "database");
        assert_eq!(
            overview["recipient_fingerprints"].as_array().unwrap().len(),
            1
        );
        let backup = &overview["backups"][0];
        assert!(!backup.is_null(), "{overview}");
        assert_eq!(backup["complete"], true);
        assert_eq!(backup["partial"], true);
        let id = backup["id"].as_str().unwrap().to_string();

        let (status, archive) = call(
            &setup.router,
            "GET",
            &format!("/api/v1/admin/backups/{id}/download"),
            Some(&setup.token),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        // The download is the encrypted archive and decrypts with the recovery key.
        assert!(!archive.windows(8).any(|w| w == b"SQLite f"));
        let path = setup._dir.path().join("download.parbak");
        std::fs::write(&path, &archive).unwrap();
        let manifest = playarr_backup::archive::verify_and_extract(
            &path,
            std::slice::from_ref(&setup.identity),
            None,
        )
        .unwrap();
        assert_eq!(manifest.backup_id, id);

        let (status, body) = call(
            &setup.router,
            "POST",
            &format!("/api/v1/admin/backups/{id}/verify"),
            Some(&setup.token),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let verification: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(verification["ok"], true);

        // The only complete backup cannot be deleted.
        let (status, _) = call(
            &setup.router,
            "DELETE",
            &format!("/api/v1/admin/backups/{id}"),
            Some(&setup.token),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);

        let (status, _) = call(
            &setup.router,
            "GET",
            "/api/v1/admin/backups/missing/download",
            Some(&setup.token),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}
