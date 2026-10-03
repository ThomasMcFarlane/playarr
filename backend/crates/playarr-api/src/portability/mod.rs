//! Portable per-user data export and import (TASKS 67 to 71).
//!
//! Design: `docs/architecture/user-portability.md`. Format:
//! `docs/formats/user-data-export-v1.md`.
//!
//! Every route acts on the authenticated user only: no route takes a user id,
//! export ids belong to the user that created them (another user's id is
//! indistinguishable from an unknown one), and imports write as the caller.

mod export;
mod import;
mod resolve;
#[cfg(test)]
mod tests;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use chrono::{DateTime, Utc};
use playarr_portability::{Limits, PackageError, UserDataPackage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::ToSchema;

use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
use crate::AppState;

pub use export::ExportRegistry;
use export::{ExportCounts, ExportJob, ExportProgress, ExportStatus};
use import::{ImportOptions, ImportResult, ImportSample, ImportSummary, ProgressConflicts};

#[derive(Debug, Serialize, ToSchema)]
pub struct ExportJobResponse {
    /// Opaque, unguessable identifier; only the creating account can use it.
    pub id: String,
    pub status: ExportStatus,
    pub created_at: DateTime<Utc>,
    /// When the download stops working (set once the package is ready).
    pub expires_at: Option<DateTime<Utc>>,
    pub progress: ExportProgress,
    pub counts: ExportCounts,
    pub size_bytes: Option<u64>,
    /// Relative URL of the package, present while `status` is `ready`.
    pub download_url: Option<String>,
    pub error: Option<String>,
}

impl From<&ExportJob> for ExportJobResponse {
    fn from(job: &ExportJob) -> Self {
        Self {
            id: job.id.clone(),
            status: job.status,
            created_at: job.created_at,
            expires_at: job.expires_at,
            progress: job.progress.clone(),
            counts: job.counts.clone(),
            size_bytes: job.size_bytes,
            download_url: (job.status == ExportStatus::Ready)
                .then(|| format!("/api/v1/users/me/data-exports/{}/download", job.id)),
            error: job.error.clone(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ExportListResponse {
    /// Always `own_account_only`: exports contain only the signed-in
    /// account's data, never anyone else's.
    pub scope: String,
    pub exports: Vec<ExportJobResponse>,
}

fn gone_or_missing(state: &AppState, user: uuid::Uuid, id: &str) -> Result<ExportJob, ApiError> {
    state
        .portability
        .get_for(user, id)
        .ok_or_else(|| ApiError::not_found("export not found"))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/data-exports",
    tag = "portability",
    responses(
        (status = 202, description = "Export started (or the caller's unfinished export returned)", body = ExportJobResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Account may not use the catalogue")
    )
)]
pub async fn create_export_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<(StatusCode, Json<ExportJobResponse>), ApiError> {
    let job = state
        .portability
        .start(state.clone(), viewer.user_id, viewer.allowed_libraries());
    tracing::info!(user_id = %viewer.user_id, export_id_prefix = %&job.id[..8], "user data export requested");
    Ok((StatusCode::ACCEPTED, Json((&job).into())))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/data-exports",
    tag = "portability",
    responses(
        (status = 200, description = "The caller's own recent exports", body = ExportListResponse),
        (status = 401, description = "Missing or invalid access token")
    )
)]
pub async fn list_exports_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<Json<ExportListResponse>, ApiError> {
    Ok(Json(ExportListResponse {
        scope: "own_account_only".into(),
        exports: state
            .portability
            .list_for(viewer.user_id)
            .iter()
            .map(Into::into)
            .collect(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/data-exports/{export_id}",
    tag = "portability",
    params(("export_id" = String, Path, description = "Export id")),
    responses(
        (status = 200, description = "Export status and progress", body = ExportJobResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown export, or one belonging to another account")
    )
)]
pub async fn get_export_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(export_id): Path<String>,
) -> Result<Json<ExportJobResponse>, ApiError> {
    let job = gone_or_missing(&state, viewer.user_id, &export_id)?;
    Ok(Json((&job).into()))
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/me/data-exports/{export_id}",
    tag = "portability",
    params(("export_id" = String, Path, description = "Export id")),
    responses(
        (status = 204, description = "Export and its temporary file deleted"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown export, or one belonging to another account")
    )
)]
pub async fn delete_export_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(export_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    if state.portability.remove_for(viewer.user_id, &export_id) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found("export not found"))
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/data-exports/{export_id}/download",
    tag = "portability",
    params(("export_id" = String, Path, description = "Export id")),
    responses(
        (status = 200, description = "The portable user-data package (ZIP)", content_type = "application/zip"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown export, or one belonging to another account"),
        (status = 409, description = "The export is not ready yet"),
        (status = 410, description = "The export expired; start a new one")
    )
)]
pub async fn download_export_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(export_id): Path<String>,
) -> Result<Response, ApiError> {
    let job = gone_or_missing(&state, viewer.user_id, &export_id)?;
    let path = match (job.status, job.file) {
        (ExportStatus::Ready, Some(path)) => path,
        (ExportStatus::Expired, _) => {
            return Err(ApiError::new(
                StatusCode::GONE,
                "gone",
                "this export has expired; start a new one",
            ))
        }
        (ExportStatus::Failed, _) => {
            return Err(ApiError::conflict("this export failed; start a new one"))
        }
        _ => return Err(ApiError::conflict("this export is not ready yet")),
    };
    let file = tokio::fs::File::open(&path).await.map_err(|_| {
        ApiError::new(
            StatusCode::GONE,
            "gone",
            "this export is no longer available",
        )
    })?;
    let stream = futures::stream::unfold(file, |mut file| async move {
        use tokio::io::AsyncReadExt;
        let mut buffer = vec![0u8; 64 * 1024];
        match file.read(&mut buffer).await {
            Ok(0) => None,
            Ok(n) => {
                buffer.truncate(n);
                Some((
                    Ok::<_, std::io::Error>(axum::body::Bytes::from(buffer)),
                    file,
                ))
            }
            Err(error) => Some((Err(error), file)),
        }
    });
    let filename = format!(
        "playarr-user-data-{}.zip",
        job.created_at.format("%Y-%m-%d")
    );
    let mut response = Response::new(Body::from_stream(stream));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{filename}\"")) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    if let Some(size) = job.size_bytes {
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from(size));
    }
    Ok(response)
}

// ---- import -------------------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct ImportPreviewResponse {
    /// SHA-256 of the uploaded bytes. Send it back unchanged to apply, which
    /// guarantees that what was previewed is what is applied.
    pub package_sha256: String,
    pub schema_version: u32,
    pub generated_at: DateTime<Utc>,
    pub source_instance_name: String,
    pub summary: ImportSummary,
    pub samples: Vec<ImportSample>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct PreviewQuery {
    /// Include the audio-language preference in the preview. Default false.
    #[serde(default)]
    pub include_preferences: bool,
    #[serde(default)]
    pub progress_conflicts: ProgressConflicts,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ApplyQuery {
    /// Digest returned by the preview of this exact upload.
    pub package_sha256: String,
    #[serde(default)]
    pub include_preferences: bool,
    #[serde(default)]
    pub progress_conflicts: ProgressConflicts,
}

fn package_error(error: PackageError) -> ApiError {
    let status = match error {
        PackageError::ArchiveTooLarge(_) | PackageError::TooLargeExpanded => {
            StatusCode::PAYLOAD_TOO_LARGE
        }
        _ => StatusCode::UNPROCESSABLE_ENTITY,
    };
    ApiError::new(status, "invalid_package", error.to_string())
}

async fn read_upload(body: Body) -> Result<(Vec<u8>, UserDataPackage, String), ApiError> {
    let limits = Limits::default();
    let bytes = axum::body::to_bytes(body, limits.max_archive_bytes + 1)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "invalid_package",
                "the upload is larger than the permitted size",
            )
        })?;
    let digest = hex::encode(Sha256::digest(&bytes));
    let parsed = {
        let bytes = bytes.to_vec();
        tokio::task::spawn_blocking(move || {
            if bytes.first() == Some(&b'{') {
                playarr_portability::parse_json(&bytes, &limits)
            } else {
                playarr_portability::read_package(&bytes, &limits)
            }
        })
        .await
        .map_err(|_| ApiError::internal("package validation failed"))?
        .map_err(package_error)?
    };
    Ok((bytes.to_vec(), parsed, digest))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/data-imports/preview",
    tag = "portability",
    params(PreviewQuery),
    request_body(content = Vec<u8>, content_type = "application/zip", description = "A package produced by an export"),
    responses(
        (status = 200, description = "What an import would do; nothing is written", body = ImportPreviewResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 413, description = "Upload or its expanded content is too large"),
        (status = 422, description = "Not a valid package, or an unsupported schema version")
    )
)]
pub async fn preview_import_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(query): Query<PreviewQuery>,
    body: Body,
) -> Result<Json<ImportPreviewResponse>, ApiError> {
    let (_, package, digest) = read_upload(body).await?;
    let mut warnings = Vec::new();
    if !package.owner.display_name.is_empty() {
        warnings.push(format!(
            "This package was exported by \"{}\"; it is shown for information only and is imported into your own account.",
            package.owner.display_name
        ));
    }
    let schema_version = package.schema_version;
    let generated_at = package.generated_at;
    let source_instance_name = package.source.instance_name.clone();
    let plan = import::plan_import(
        &state,
        viewer.user_id,
        viewer.allowed_libraries(),
        package,
        ImportOptions {
            include_preferences: query.include_preferences,
            progress_conflicts: query.progress_conflicts,
        },
    )
    .await?;
    Ok(Json(ImportPreviewResponse {
        package_sha256: digest,
        schema_version,
        generated_at,
        source_instance_name,
        summary: plan.summary,
        samples: plan.samples,
        warnings,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/data-imports",
    tag = "portability",
    params(ApplyQuery),
    request_body(content = Vec<u8>, content_type = "application/zip", description = "The same package that was previewed"),
    responses(
        (status = 200, description = "What was written. `completed` is false when a step failed; re-running is safe", body = ImportResult),
        (status = 401, description = "Missing or invalid access token"),
        (status = 409, description = "The upload does not match the previewed digest"),
        (status = 413, description = "Upload or its expanded content is too large"),
        (status = 422, description = "Not a valid package, or an unsupported schema version")
    )
)]
pub async fn apply_import_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(query): Query<ApplyQuery>,
    body: Body,
) -> Result<Json<ImportResult>, ApiError> {
    let (_, package, digest) = read_upload(body).await?;
    if !digest.eq_ignore_ascii_case(query.package_sha256.trim()) {
        return Err(ApiError::conflict(
            "the upload differs from the previewed package; preview it again",
        ));
    }
    let plan = import::plan_import(
        &state,
        viewer.user_id,
        viewer.allowed_libraries(),
        package,
        ImportOptions {
            include_preferences: query.include_preferences,
            progress_conflicts: query.progress_conflicts,
        },
    )
    .await?;
    let result = import::apply_plan(&state, viewer.user_id, &plan).await;
    tracing::info!(
        user_id = %viewer.user_id,
        completed = result.completed,
        progress_added = result.progress_added,
        progress_updated = result.progress_updated,
        playlists_created = result.playlists_created,
        playlist_items_added = result.playlist_items_added,
        unmatched = result.unmatched_total,
        "user data import applied"
    );
    Ok(Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/data-imports/unmatched",
    tag = "portability",
    params(PreviewQuery),
    request_body(content = Vec<u8>, content_type = "application/zip", description = "The previewed package"),
    responses(
        (status = 200, description = "A package of everything that could not be placed, valid for a later import", content_type = "application/zip"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 413, description = "Upload or its expanded content is too large"),
        (status = 422, description = "Not a valid package, or an unsupported schema version")
    )
)]
pub async fn unmatched_import_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(query): Query<PreviewQuery>,
    body: Body,
) -> Result<Response, ApiError> {
    let (_, package, _) = read_upload(body).await?;
    let mut out = UserDataPackage::new(Utc::now());
    out.generator = package.generator.clone();
    out.source = package.source.clone();
    out.owner = package.owner.clone();
    let plan = import::plan_import(
        &state,
        viewer.user_id,
        viewer.allowed_libraries(),
        package,
        ImportOptions {
            include_preferences: false,
            progress_conflicts: query.progress_conflicts,
        },
    )
    .await?;
    out.unmatched = plan.unmatched;
    let bytes = playarr_portability::package_to_bytes(&out)
        .map_err(|_| ApiError::internal("could not build the package"))?;
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"playarr-unmatched.zip\""),
    );
    Ok(response)
}
