//! Ten-foot transfer: move a user-data package to or from a device that has
//! no file picker (television) through a phone or computer.
//!
//! * Export: the signed-in television asks for a one-time download link for a
//!   ready export; the person opens it (QR code) on another device.
//! * Import: the signed-in television opens an import session and shows a
//!   one-time upload link (QR code); the person uploads the package from
//!   another device; the television then previews and applies it with its own
//!   authenticated routes.
//!
//! Security model: a link carries a 256-bit random token (stored only as a
//! SHA-256 digest, in memory, node-local), is bound to the user that created
//! it, expires after 15 minutes and works once. The token grants exactly one
//! action (download that export, or stage one package for that session). An
//! uploaded package is validated like any import, written to a private
//! file, and never applied until the owning, authenticated account previews
//! and applies it. See `docs/architecture/user-portability.md`.

use std::collections::HashMap;
use std::path::PathBuf;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use playarr_auth::secret::{hash_token, opaque_token};
use playarr_portability::Limits;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use super::export::ExportStatus;
use super::{
    apply_package, parse_upload, preview_package, zip_response, ApplyQuery, ImportPreviewResponse,
    ImportResult, PreviewQuery,
};
use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
use crate::AppState;

/// How long a transfer link works.
pub const LINK_TTL: Duration = Duration::minutes(15);
/// How long an uploaded package stays staged for the owner to review.
pub const STAGED_TTL: Duration = Duration::minutes(15);
const MAX_LINKS_PER_USER: usize = 5;
const MAX_SESSIONS: usize = 256;
const TOKEN_LEN: usize = 64;

struct DownloadLink {
    user_id: Uuid,
    export_id: String,
    expires_at: DateTime<Utc>,
    used: bool,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Stage {
    Waiting,
    /// A body is being received; guards against two concurrent uploads.
    Uploading,
    Uploaded {
        file: PathBuf,
        size: u64,
        sha256: String,
    },
}

struct ImportSession {
    user_id: Uuid,
    token_hash: String,
    created_at: DateTime<Utc>,
    /// Until when the upload link works (while `Waiting`), and afterwards
    /// until when the staged package is kept.
    expires_at: DateTime<Utc>,
    stage: Stage,
}

#[derive(Default)]
pub(super) struct Transfers {
    /// Keyed by the SHA-256 of the link token.
    links: HashMap<String, DownloadLink>,
    /// Keyed by the session id (distinct from the upload token).
    sessions: HashMap<String, ImportSession>,
}

fn valid_token(token: &str) -> bool {
    token.len() == TOKEN_LEN && token.bytes().all(|b| b.is_ascii_hexdigit())
}

impl super::ExportRegistry {
    fn transfers(&self) -> std::sync::MutexGuard<'_, Transfers> {
        self.transfers.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Drops expired links and sessions and deletes staged files.
    pub(super) fn sweep_transfers(&self) {
        let now = Utc::now();
        let mut transfers = self.transfers();
        // Used links are kept until they expire so a second visit says
        // "already used" instead of "unknown".
        transfers.links.retain(|_, link| link.expires_at > now);
        let expired: Vec<String> = transfers
            .sessions
            .iter()
            .filter(|(_, s)| s.expires_at <= now && s.stage != Stage::Uploading)
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some(session) = transfers.sessions.remove(&id) {
                remove_staged(&session.stage);
            }
        }
    }

    fn create_link(
        &self,
        user_id: Uuid,
        export_id: &str,
        ceiling: DateTime<Utc>,
    ) -> (String, DateTime<Utc>) {
        self.sweep_transfers();
        let now = Utc::now();
        let expires_at = (now + LINK_TTL).min(ceiling);
        let token = opaque_token();
        let mut transfers = self.transfers();
        let mut own: Vec<(String, DateTime<Utc>)> = transfers
            .links
            .iter()
            .filter(|(_, l)| l.user_id == user_id)
            .map(|(k, l)| (k.clone(), l.created_at))
            .collect();
        own.sort_by_key(|(_, created)| *created);
        while own.len() >= MAX_LINKS_PER_USER {
            let (oldest, _) = own.remove(0);
            transfers.links.remove(&oldest);
        }
        transfers.links.insert(
            hash_token(&token),
            DownloadLink {
                user_id,
                export_id: export_id.to_owned(),
                expires_at,
                used: false,
                created_at: now,
            },
        );
        (token, expires_at)
    }

    /// Marks the link used and returns what it unlocks. `Err(true)` means
    /// the link existed but is expired or already used.
    fn redeem_link(&self, token: &str) -> Result<(Uuid, String), bool> {
        self.sweep_transfers();
        let mut transfers = self.transfers();
        let link = transfers.links.get_mut(&hash_token(token)).ok_or(false)?;
        if link.used || link.expires_at <= Utc::now() {
            return Err(true);
        }
        link.used = true;
        Ok((link.user_id, link.export_id.clone()))
    }

    fn unredeem_link(&self, token: &str) {
        if let Some(link) = self.transfers().links.get_mut(&hash_token(token)) {
            link.used = false;
        }
    }

    fn create_session(&self, user_id: Uuid) -> (String, String, DateTime<Utc>) {
        self.sweep_transfers();
        let now = Utc::now();
        let id = opaque_token();
        let token = opaque_token();
        let expires_at = now + LINK_TTL;
        let mut transfers = self.transfers();
        // One session per user: a new one replaces the old.
        let stale: Vec<String> = transfers
            .sessions
            .iter()
            .filter(|(_, s)| s.user_id == user_id)
            .map(|(k, _)| k.clone())
            .collect();
        for key in stale {
            if let Some(old) = transfers.sessions.remove(&key) {
                remove_staged(&old.stage);
            }
        }
        if transfers.sessions.len() >= MAX_SESSIONS {
            // Evict the oldest session rather than refuse; bounded memory and disk.
            if let Some(oldest) = transfers
                .sessions
                .iter()
                .min_by_key(|(_, s)| s.created_at)
                .map(|(k, _)| k.clone())
            {
                if let Some(old) = transfers.sessions.remove(&oldest) {
                    remove_staged(&old.stage);
                }
            }
        }
        transfers.sessions.insert(
            id.clone(),
            ImportSession {
                user_id,
                token_hash: hash_token(&token),
                created_at: now,
                expires_at,
                stage: Stage::Waiting,
            },
        );
        (id, token, expires_at)
    }

    /// Starts an upload for the token. `Err(true)`: expired or used.
    fn begin_upload(&self, token: &str) -> Result<String, bool> {
        self.sweep_transfers();
        let hash = hash_token(token);
        let mut transfers = self.transfers();
        let (id, session) = transfers
            .sessions
            .iter_mut()
            .find(|(_, s)| s.token_hash == hash)
            .ok_or(false)?;
        if session.stage != Stage::Waiting || session.expires_at <= Utc::now() {
            return Err(true);
        }
        session.stage = Stage::Uploading;
        Ok(id.clone())
    }

    fn abort_upload(&self, id: &str) {
        if let Some(session) = self.transfers().sessions.get_mut(id) {
            if session.stage == Stage::Uploading {
                session.stage = Stage::Waiting;
            }
        }
    }

    fn finish_upload(&self, id: &str, file: PathBuf, size: u64, sha256: String) {
        match self.transfers().sessions.get_mut(id) {
            Some(session) => {
                session.stage = Stage::Uploaded { file, size, sha256 };
                session.expires_at = Utc::now() + STAGED_TTL;
            }
            // The session was closed while the body arrived; keep nothing.
            None => {
                let _ = std::fs::remove_file(file);
            }
        }
    }

    fn session_for(&self, user_id: Uuid, id: &str) -> Option<SessionView> {
        self.sweep_transfers();
        let transfers = self.transfers();
        let session = transfers
            .sessions
            .get(id)
            .filter(|s| s.user_id == user_id)?;
        Some(SessionView {
            stage: session.stage.clone(),
            expires_at: session.expires_at,
        })
    }

    fn remove_session(&self, user_id: Uuid, id: &str) -> bool {
        let mut transfers = self.transfers();
        match transfers.sessions.get(id) {
            Some(s) if s.user_id == user_id => {
                if let Some(old) = transfers.sessions.remove(id) {
                    remove_staged(&old.stage);
                }
                true
            }
            _ => false,
        }
    }

    /// Test hook: end the session's window now.
    #[cfg(test)]
    pub fn expire_session_now(&self, id: &str) {
        if let Some(s) = self.transfers().sessions.get_mut(id) {
            s.expires_at = Utc::now() - Duration::seconds(1);
        }
    }

    /// Test hook: end a download link's window now.
    #[cfg(test)]
    pub fn expire_links_now(&self) {
        for link in self.transfers().links.values_mut() {
            link.expires_at = Utc::now() - Duration::seconds(1);
        }
    }
}

struct SessionView {
    stage: Stage,
    expires_at: DateTime<Utc>,
}

fn remove_staged(stage: &Stage) {
    if let Stage::Uploaded { file, .. } = stage {
        let _ = std::fs::remove_file(file);
    }
}

fn gone(message: &str) -> ApiError {
    ApiError::new(StatusCode::GONE, "gone", message)
}

/// Headers for responses served to an unauthenticated browser on the
/// transfer links: never cache, never leak the link through `Referer`.
fn harden(response: &mut Response) {
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow"),
    );
}

// ---- export link ---------------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct TransferLinkResponse {
    /// Origin-relative path of the one-time link; resolve it against the
    /// server address the client already uses and show it as a QR code.
    pub path: String,
    /// The same link as an absolute URL built from the address the request
    /// arrived on (proxy headers honoured), ready for a QR code.
    pub url: String,
    /// The link stops working at this time (at most 15 minutes) or after its
    /// first use, whichever is first.
    pub expires_at: DateTime<Utc>,
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/data-exports/{export_id}/transfer-link",
    tag = "portability",
    params(("export_id" = String, Path, description = "Export id")),
    responses(
        (status = 201, description = "A one-time link to download this export on another device", body = TransferLinkResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown export, or one belonging to another account"),
        (status = 409, description = "The export is not ready"),
        (status = 410, description = "The export expired")
    )
)]
pub async fn create_transfer_link_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    headers: HeaderMap,
    Path(export_id): Path<String>,
) -> Result<(StatusCode, Json<TransferLinkResponse>), ApiError> {
    let job = state
        .portability
        .get_for(viewer.user_id, &export_id)
        .ok_or_else(|| ApiError::not_found("export not found"))?;
    match job.status {
        ExportStatus::Ready => {}
        ExportStatus::Expired => return Err(gone("this export has expired; start a new one")),
        _ => return Err(ApiError::conflict("this export is not ready")),
    }
    let ceiling = job.expires_at.unwrap_or_else(|| Utc::now() + LINK_TTL);
    let (token, expires_at) = state
        .portability
        .create_link(viewer.user_id, &job.id, ceiling);
    tracing::info!(user_id = %viewer.user_id, "user data transfer link created");
    let path = format!("/api/v1/transfer/export/{token}");
    Ok((
        StatusCode::CREATED,
        Json(TransferLinkResponse {
            url: crate::oauth::request_verification_uri(&headers, &path),
            path,
            expires_at,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/transfer/export/{token}",
    tag = "portability",
    params(("token" = String, Path, description = "One-time link token")),
    responses(
        (status = 200, description = "The user-data package (ZIP); the link works once", content_type = "application/zip"),
        (status = 404, description = "Unknown link"),
        (status = 410, description = "The link expired or was already used")
    )
)]
pub async fn transfer_export_download_handler(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response, ApiError> {
    let not_found = || ApiError::not_found("transfer link not found");
    if !valid_token(&token) {
        return Err(not_found());
    }
    let (user_id, export_id) = state.portability.redeem_link(&token).map_err(|used| {
        if used {
            gone("this link has expired or was already used")
        } else {
            not_found()
        }
    })?;
    let opened = async {
        let job = state
            .portability
            .get_for(user_id, &export_id)
            .filter(|job| job.status == ExportStatus::Ready)?;
        let file = tokio::fs::File::open(job.file.as_ref()?).await.ok()?;
        Some((job, file))
    }
    .await;
    let Some((job, file)) = opened else {
        // Nothing was handed out, so the link stays usable until it expires.
        state.portability.unredeem_link(&token);
        return Err(gone("this export is no longer available"));
    };
    let mut response = zip_response(file, &job);
    harden(&mut response);
    tracing::info!(user_id = %user_id, "user data downloaded through a transfer link");
    Ok(response)
}

// ---- import sessions -----------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct ImportSessionResponse {
    /// Opaque id used by the signed-in client to poll, preview and apply.
    pub id: String,
    /// `waiting` (no upload yet), `uploading` or `uploaded` (ready to preview).
    pub status: String,
    /// Origin-relative path of the one-time upload page; present only while
    /// `waiting`, and only in the response that created the session.
    pub upload_path: Option<String>,
    /// `upload_path` as an absolute URL (see `TransferLinkResponse::url`).
    pub upload_url: Option<String>,
    /// When the upload link (waiting) or the staged package (uploaded) expires.
    pub expires_at: DateTime<Utc>,
    pub size_bytes: Option<u64>,
}

fn session_response(
    id: &str,
    view: &SessionView,
    upload_path: Option<String>,
) -> ImportSessionResponse {
    let (status, size_bytes) = match &view.stage {
        Stage::Waiting => ("waiting", None),
        Stage::Uploading => ("uploading", None),
        Stage::Uploaded { size, .. } => ("uploaded", Some(*size)),
    };
    ImportSessionResponse {
        id: id.to_owned(),
        status: status.into(),
        upload_path,
        upload_url: None,
        expires_at: view.expires_at,
        size_bytes,
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/data-import-sessions",
    tag = "portability",
    responses(
        (status = 201, description = "An import session with a one-time upload link for another device; replaces any earlier session of the caller", body = ImportSessionResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Account may not use the catalogue")
    )
)]
pub async fn create_import_session_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<ImportSessionResponse>), ApiError> {
    let (id, token, expires_at) = state.portability.create_session(viewer.user_id);
    tracing::info!(user_id = %viewer.user_id, "user data import session opened");
    let path = format!("/api/v1/transfer/import/{token}");
    Ok((
        StatusCode::CREATED,
        Json(ImportSessionResponse {
            id,
            status: "waiting".into(),
            upload_url: Some(crate::oauth::request_verification_uri(&headers, &path)),
            upload_path: Some(path),
            expires_at,
            size_bytes: None,
        }),
    ))
}

fn session_gone_or_missing(
    state: &AppState,
    user: Uuid,
    id: &str,
) -> Result<SessionView, ApiError> {
    state
        .portability
        .session_for(user, id)
        .ok_or_else(|| ApiError::not_found("import session not found or expired"))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/data-import-sessions/{session_id}",
    tag = "portability",
    params(("session_id" = String, Path, description = "Import session id")),
    responses(
        (status = 200, description = "Whether a package has arrived", body = ImportSessionResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown, expired, or another account's session")
    )
)]
pub async fn get_import_session_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(session_id): Path<String>,
) -> Result<Json<ImportSessionResponse>, ApiError> {
    let view = session_gone_or_missing(&state, viewer.user_id, &session_id)?;
    Ok(Json(session_response(&session_id, &view, None)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/me/data-import-sessions/{session_id}",
    tag = "portability",
    params(("session_id" = String, Path, description = "Import session id")),
    responses(
        (status = 204, description = "Session closed and any staged package deleted"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown, expired, or another account's session")
    )
)]
pub async fn delete_import_session_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(session_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    if state
        .portability
        .remove_session(viewer.user_id, &session_id)
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found("import session not found or expired"))
    }
}

/// Loads the staged package of the caller's session.
async fn staged_package(
    state: &AppState,
    user_id: Uuid,
    id: &str,
) -> Result<(playarr_portability::UserDataPackage, String), ApiError> {
    let view = session_gone_or_missing(state, user_id, id)?;
    let Stage::Uploaded { file, sha256, .. } = view.stage else {
        return Err(ApiError::conflict("no package has been uploaded yet"));
    };
    let bytes = tokio::fs::read(&file)
        .await
        .map_err(|_| gone("the uploaded package is no longer available; upload it again"))?;
    let (package, digest) = parse_upload(&bytes).await?;
    if digest != sha256 {
        return Err(ApiError::internal("the staged package changed"));
    }
    Ok((package, digest))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/data-import-sessions/{session_id}/preview",
    tag = "portability",
    params(("session_id" = String, Path, description = "Import session id"), PreviewQuery),
    responses(
        (status = 200, description = "What importing the uploaded package would do; nothing is written", body = ImportPreviewResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown, expired, or another account's session"),
        (status = 409, description = "Nothing has been uploaded yet")
    )
)]
pub async fn preview_import_session_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(session_id): Path<String>,
    Query(query): Query<PreviewQuery>,
) -> Result<Json<ImportPreviewResponse>, ApiError> {
    let (package, digest) = staged_package(&state, viewer.user_id, &session_id).await?;
    Ok(Json(
        preview_package(&state, &viewer, &query, package, digest).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/data-import-sessions/{session_id}/apply",
    tag = "portability",
    params(("session_id" = String, Path, description = "Import session id"), ApplyQuery),
    responses(
        (status = 200, description = "What was written; the staged package is deleted once everything applied", body = ImportResult),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown, expired, or another account's session"),
        (status = 409, description = "Nothing uploaded yet, or the digest differs from the previewed one")
    )
)]
pub async fn apply_import_session_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(session_id): Path<String>,
    Query(query): Query<ApplyQuery>,
) -> Result<Json<ImportResult>, ApiError> {
    let (package, digest) = staged_package(&state, viewer.user_id, &session_id).await?;
    let result = apply_package(&state, &viewer, &query, package, digest).await?;
    if result.completed {
        state
            .portability
            .remove_session(viewer.user_id, &session_id);
    }
    Ok(Json(result))
}

// ---- the phone's upload page ----------------------------------------------

const UPLOAD_PAGE: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>Upload your Playarr data</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#111;color:#eee}
main{max-width:30rem;margin:0 auto}h1{font-size:1.3rem}
button,input{font:inherit}button{padding:.7rem 1.2rem;border:0;border-radius:.5rem;background:#7c5cff;color:#fff}
button:disabled{opacity:.5}p.note{color:#aaa;font-size:.9rem}#msg{margin-top:1rem;font-weight:600}
</style></head><body><main>
<h1>Upload your Playarr data</h1>
<p>Choose the Playarr data file (.zip) you exported. It goes straight to the television that showed this code; you then review it there before anything is changed.</p>
<p><input id="f" type="file" accept=".zip,application/zip,application/json"></p>
<p><button id="b" disabled>Upload</button></p>
<p id="msg" role="status" aria-live="polite"></p>
<p class="note">This link works once and expires 15 minutes after it was shown.</p>
</main>
<script>
(function(){
var f=document.getElementById('f'),b=document.getElementById('b'),m=document.getElementById('msg');
f.onchange=function(){b.disabled=!f.files.length;m.textContent='';};
b.onclick=function(){
  var file=f.files[0];if(!file)return;
  b.disabled=true;m.textContent='Uploading...';
  fetch(location.pathname,{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream'},credentials:'omit',referrerPolicy:'no-referrer'})
  .then(function(r){
    if(r.ok){m.textContent='Done. Return to the television to review and apply your data.';f.disabled=true;return;}
    r.json().catch(function(){return {};}).then(function(j){
      m.textContent=(j&&j.message)||('The upload failed ('+r.status+').');
      b.disabled=r.status===410||r.status===404;
    });
  }).catch(function(){m.textContent='The upload could not be sent. Check your connection and try again.';b.disabled=false;});
};
})();
</script></body></html>"#;

const GONE_PAGE: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Link expired</title></head><body style="font:16px system-ui,sans-serif;padding:24px;background:#111;color:#eee">
<h1>This link has expired or was already used</h1>
<p>Go back to Playarr on your television and start the import again to get a new code.</p></body></html>"#;

fn html(status: StatusCode, body: &'static str) -> Response {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        ),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    harden(&mut response);
    response
}

#[utoipa::path(
    get,
    path = "/api/v1/transfer/import/{token}",
    tag = "portability",
    params(("token" = String, Path, description = "One-time upload link token")),
    responses(
        (status = 200, description = "A minimal HTML page with a file chooser", content_type = "text/html", body = String),
        (status = 404, description = "Unknown link"),
        (status = 410, description = "The link expired or was already used")
    )
)]
pub async fn transfer_import_page_handler(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Response {
    if !valid_token(&token) {
        return html(StatusCode::NOT_FOUND, GONE_PAGE);
    }
    state.portability.sweep_transfers();
    let hash = hash_token(&token);
    let live = {
        let transfers = state.portability.transfers();
        transfers
            .sessions
            .values()
            .any(|s| s.token_hash == hash && s.stage == Stage::Waiting && s.expires_at > Utc::now())
    };
    if live {
        html(StatusCode::OK, UPLOAD_PAGE)
    } else {
        html(StatusCode::GONE, GONE_PAGE)
    }
}

/// Releases an in-progress upload if the request is dropped or fails.
struct UploadGuard<'a> {
    registry: &'a super::ExportRegistry,
    id: String,
    armed: bool,
}

impl Drop for UploadGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            self.registry.abort_upload(&self.id);
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/transfer/import/{token}",
    tag = "portability",
    params(("token" = String, Path, description = "One-time upload link token")),
    request_body(content = Vec<u8>, content_type = "application/octet-stream", description = "A package produced by an export"),
    responses(
        (status = 204, description = "The package was validated and staged for the television to review"),
        (status = 404, description = "Unknown link"),
        (status = 410, description = "The link expired or was already used"),
        (status = 413, description = "Upload or its expanded content is too large"),
        (status = 422, description = "Not a valid package, or an unsupported schema version")
    )
)]
pub async fn transfer_import_upload_handler(
    State(state): State<AppState>,
    Path(token): Path<String>,
    body: Body,
) -> Result<StatusCode, ApiError> {
    if !valid_token(&token) {
        return Err(ApiError::not_found("transfer link not found"));
    }
    let registry = state.portability.clone();
    let id = registry.begin_upload(&token).map_err(|used| {
        if used {
            gone("this link has expired or was already used")
        } else {
            ApiError::not_found("transfer link not found")
        }
    })?;
    let mut guard = UploadGuard {
        registry: &registry,
        id: id.clone(),
        armed: true,
    };
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
    // Same layered validation as any import, before anything is kept.
    let (_package, digest) = parse_upload(&bytes).await?;
    let path = registry.dir().join(format!("import-{id}.zip"));
    let write_path = path.clone();
    let data = bytes.to_vec();
    let size = tokio::task::spawn_blocking(move || -> std::io::Result<u64> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&write_path)?;
        file.write_all(&data)?;
        Ok(data.len() as u64)
    })
    .await
    .map_err(|_| ApiError::internal("could not stage the package"))?
    .map_err(|_| ApiError::internal("could not stage the package"))?;
    registry.finish_upload(&id, path, size, digest);
    guard.armed = false;
    tracing::info!("user data package staged through a transfer link");
    Ok(StatusCode::NO_CONTENT)
}
