//! Server-staged, quality-selectable, resumable downloads of media the
//! caller already has playback access to:
//!
//! - [`create_download_ticket_handler`] -- `POST /api/v1/downloads`. A
//!   `quality_id` of `"original"` resolves to a [`playarr_model::
//!   DownloadStatus::Ready`] ticket immediately (the source
//!   [`playarr_model::MediaFile`] is served byte-for-byte, nothing to
//!   produce). A named transcode profile starts `Queued`.
//!
//!   TODO(downloads): named-profile tickets never leave `Queued` in this
//!   pass -- there is no single-file transcode job in `playarr-transcode`
//!   yet to actually produce their output (that crate only knows how to
//!   produce HLS-segmented renditions for playback, see
//!   `TranscodeOrchestrator::spawn_on_demand_transcode`'s doc comment). The
//!   API shape and DB schema for a named-profile ticket are complete and
//!   correct (see [`DownloadTicketResponse`] and
//!   `playarr_db::repo::DownloadTicketRepo`); wiring an actual worker that
//!   drives `mark_ready`/`mark_status` for these is deliberately left as
//!   follow-up rather than risking an untested new ffmpeg job runner here.
//!   Original-quality downloads, the common case, work end to end.
//! - [`list_download_tickets_handler`]/[`get_download_ticket_handler`] --
//!   list/poll.
//! - [`cancel_download_ticket_handler`] -- `DELETE /api/v1/downloads/{id}`.
//!   Soft-cancels (marks [`playarr_model::DownloadStatus::Canceled`])
//!   rather than deleting the row outright, so a caller that raced a poll
//!   against the cancel still sees a real terminal state (410 from
//!   [`download_ticket_file_handler`]) instead of a 404 that looks
//!   indistinguishable from "never existed".
//! - [`download_ticket_file_handler`] -- `GET /api/v1/downloads/{id}/file`,
//!   the actual byte delivery. Reuses [`crate::media::serve_file`] for real
//!   Range/206 support, exactly like every other file-serving handler in
//!   this crate.
//!
//! Every handler here enforces the same three gates, in the same order,
//! that the API contract requires: resolve the underlying
//! [`playarr_model::MediaFile`] (404 if missing), [`ensure_library_allowed`]
//! (the caller's `Policy::library_allow`), then [`ensure_can_download`] (the
//! caller's `Policy::can_download`). Ticket-scoped handlers
//! ([`get_download_ticket_handler`]/[`cancel_download_ticket_handler`]/
//! [`download_ticket_file_handler`]) additionally 404 (never 403) on an
//! unknown ticket id *or* one owned by a different caller -- see
//! [`load_owned_ticket`] -- matching this codebase's "unknown/inaccessible
//! ids are indistinguishable from nonexistent" convention.

use axum::extract::{Path, Request, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use playarr_model::{DownloadStatus, DownloadTicket};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{ensure_can_download, ensure_library_allowed, StreamingUser};
use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDownloadTicketRequest {
    pub media_file_id: Uuid,
    /// `"original"`, or a transcode profile name from
    /// `GET /api/v1/media/{media_file_id}/download-options`.
    pub quality_id: String,
}

/// Wire projection of [`DownloadTicket`] -- not the model type directly,
/// same reasoning as `MediaFile`/`Rendition`'s own DTOs elsewhere in this
/// crate: `DownloadTicket::output_path` is a `PathBuf` (no `ToSchema`
/// mapping, and not something a caller should see the server's real
/// filesystem layout through anyway). `profile` is deliberately omitted --
/// it's an internal detail of how a `Ready` ticket got produced, not part
/// of the documented response contract; `quality_id` is what callers key
/// off of.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DownloadTicketResponse {
    pub id: Uuid,
    pub media_file_id: Uuid,
    pub quality_id: String,
    pub status: DownloadStatus,
    pub container: String,
    pub size_bytes: Option<u64>,
    pub requested_at: DateTime<Utc>,
    pub ready_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
}

impl From<DownloadTicket> for DownloadTicketResponse {
    fn from(ticket: DownloadTicket) -> Self {
        Self {
            id: ticket.id,
            media_file_id: ticket.media_file_id,
            quality_id: ticket.quality_id,
            status: ticket.status,
            container: ticket.container,
            size_bytes: ticket.size_bytes,
            requested_at: ticket.requested_at,
            ready_at: ticket.ready_at,
            expires_at: ticket.expires_at,
            error_message: ticket.error_message,
        }
    }
}

/// Suggested `Content-Disposition` file name for a ticket's download --
/// deliberately simple (quality id + real container extension, e.g.
/// `"original.mkv"`/`"h264-1080p-8mbps.mp4"`) rather than resolving the
/// owning `Work`'s title through an extra repo call this handler doesn't
/// otherwise need.
fn download_file_name(ticket: &DownloadTicket) -> String {
    format!("{}.{}", ticket.quality_id, ticket.container)
}

#[utoipa::path(
    post,
    path = "/api/v1/downloads",
    tag = "downloads",
    request_body(content = CreateDownloadTicketRequest, example = json!({
        "media_file_id": "3f9c1e2d-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
        "quality_id": "original"
    })),
    responses(
        (status = 201, description = "A new download ticket was created", body = DownloadTicketResponse, example = json!({
            "id": "6a5e2c3e-2b9a-4b3e-9b7a-8e2f1c3d4a5b",
            "media_file_id": "3f9c1e2d-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
            "quality_id": "original",
            "status": "ready",
            "container": "mkv",
            "size_bytes": 4_000_000_000_u64,
            "requested_at": "2026-07-20T14:22:05Z",
            "ready_at": "2026-07-20T14:22:05Z",
            "expires_at": null,
            "error_message": null
        })),
        (status = 200, description = "An existing queued/processing/ready ticket for this exact media file + quality already existed; returned instead of creating a duplicate", body = DownloadTicketResponse),
        (status = 400, description = "Unknown quality_id"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access, download access, or access to this media file's library"),
        (status = 404, description = "Unknown media_file_id")
    )
)]
pub async fn create_download_ticket_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Json(body): Json<CreateDownloadTicketRequest>,
) -> Result<(StatusCode, Json<DownloadTicketResponse>), ApiError> {
    let media_file = state
        .media_files
        .get(body.media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {}", body.media_file_id)))?;
    ensure_library_allowed(
        media_file.source_instance_id,
        streaming.allowed_libraries().as_deref(),
    )?;
    ensure_can_download(&streaming.policy)?;

    let is_original = body.quality_id == "original";
    if !is_original
        && !playarr_transcode::TranscodeTargetProfile::supported()
            .iter()
            .any(|profile| profile.name == body.quality_id)
    {
        return Err(ApiError::bad_request(format!(
            "unknown download quality {}",
            body.quality_id
        )));
    }

    if let Some(existing) = state
        .download_tickets
        .find_active(streaming.user_id, media_file.id, &body.quality_id)
        .await?
    {
        return Ok((StatusCode::OK, Json(existing.into())));
    }

    let now = Utc::now();
    let ticket = if is_original {
        DownloadTicket {
            id: Uuid::new_v4(),
            user_id: streaming.user_id,
            media_file_id: media_file.id,
            quality_id: "original".to_string(),
            profile: None,
            container: media_file.container.clone(),
            status: DownloadStatus::Ready,
            output_path: None,
            size_bytes: Some(media_file.size_bytes),
            error_message: None,
            requested_at: now,
            ready_at: Some(now),
            expires_at: None,
        }
    } else {
        DownloadTicket {
            id: Uuid::new_v4(),
            user_id: streaming.user_id,
            media_file_id: media_file.id,
            quality_id: body.quality_id.clone(),
            profile: Some(body.quality_id.clone()),
            // A plain MP4 mux is what a real single-file transcode job
            // would eventually produce here -- not the HLS segmenting
            // `spawn_on_demand_transcode` uses for playback (see this
            // module's doc comment: this path stays `Queued` for now, no
            // job actually runs yet).
            container: "mp4".to_string(),
            status: DownloadStatus::Queued,
            output_path: None,
            size_bytes: None,
            error_message: None,
            requested_at: now,
            ready_at: None,
            expires_at: None,
        }
    };
    state.download_tickets.insert(&ticket).await?;
    Ok((StatusCode::CREATED, Json(ticket.into())))
}

#[utoipa::path(
    get,
    path = "/api/v1/downloads",
    tag = "downloads",
    responses(
        (status = 200, description = "Every download ticket for the caller, restricted to this account's currently allowed libraries", body = [DownloadTicketResponse]),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access or download access")
    )
)]
pub async fn list_download_tickets_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
) -> Result<Json<Vec<DownloadTicketResponse>>, ApiError> {
    ensure_can_download(&streaming.policy)?;

    let all_tickets = state
        .download_tickets
        .list_for_user(streaming.user_id)
        .await?;

    // Unrestricted (`None`) is the common case and needs no per-ticket
    // `MediaFile` resolution -- mirrors `playback::list_watch_progress_handler`'s
    // own restricted-caller filtering, for the same reason: a stale ticket
    // for now-inaccessible content (the admin narrowed `library_allow`
    // after the ticket was created) must not keep confirming that content
    // exists. A ticket whose `MediaFile` no longer resolves at all is
    // dropped for a restricted caller too (fail closed).
    let Some(allowed) = streaming.allowed_libraries() else {
        return Ok(Json(all_tickets.into_iter().map(Into::into).collect()));
    };
    let mut visible = Vec::with_capacity(all_tickets.len());
    for ticket in all_tickets {
        if let Some(media_file) = state.media_files.get(ticket.media_file_id).await {
            if ensure_library_allowed(media_file.source_instance_id, Some(&allowed)).is_ok() {
                visible.push(ticket.into());
            }
        }
    }
    Ok(Json(visible))
}

/// Loads `id`'s ticket for `streaming`'s caller, enforcing every check a
/// ticket-scoped handler needs: 404 for an unknown id *or* one owned by a
/// different caller (never 403 -- see this module's doc comment), then
/// re-runs [`ensure_library_allowed`] against the ticket's *current*
/// underlying `MediaFile` -- a caller whose `Policy::library_allow`
/// narrowed after the ticket was created must not still be able to poll/
/// cancel/download it.
async fn load_owned_ticket(
    state: &AppState,
    streaming: &StreamingUser,
    id: Uuid,
) -> Result<DownloadTicket, ApiError> {
    let ticket = state
        .download_tickets
        .get(id)
        .await?
        .filter(|ticket| ticket.user_id == streaming.user_id)
        .ok_or_else(|| ApiError::not_found(format!("unknown download ticket {id}")))?;
    let media_file = state
        .media_files
        .get(ticket.media_file_id)
        .await
        .ok_or_else(|| {
            ApiError::not_found(format!("unknown media file {}", ticket.media_file_id))
        })?;
    ensure_library_allowed(
        media_file.source_instance_id,
        streaming.allowed_libraries().as_deref(),
    )?;
    Ok(ticket)
}

#[utoipa::path(
    get,
    path = "/api/v1/downloads/{id}",
    tag = "downloads",
    params(("id" = Uuid, Path, description = "DownloadTicket id")),
    responses(
        (status = 200, description = "The ticket's current state", body = DownloadTicketResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access, download access, or access to this media file's library"),
        (status = 404, description = "Unknown ticket id, or it does not belong to the caller")
    )
)]
pub async fn get_download_ticket_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(id): Path<Uuid>,
) -> Result<Json<DownloadTicketResponse>, ApiError> {
    ensure_can_download(&streaming.policy)?;
    let ticket = load_owned_ticket(&state, &streaming, id).await?;
    Ok(Json(ticket.into()))
}

#[utoipa::path(
    delete,
    path = "/api/v1/downloads/{id}",
    tag = "downloads",
    params(("id" = Uuid, Path, description = "DownloadTicket id")),
    responses(
        (status = 204, description = "Ticket canceled (soft: marked Canceled, not deleted -- see this module's doc comment)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access, download access, or access to this media file's library"),
        (status = 404, description = "Unknown ticket id, or it does not belong to the caller")
    )
)]
pub async fn cancel_download_ticket_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    ensure_can_download(&streaming.policy)?;
    let ticket = load_owned_ticket(&state, &streaming, id).await?;
    state
        .download_tickets
        .mark_status(ticket.id, DownloadStatus::Canceled, None)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/downloads/{id}/file",
    tag = "downloads",
    params(("id" = Uuid, Path, description = "DownloadTicket id")),
    responses(
        (status = 200, description = "Full file content, Content-Disposition: attachment"),
        (status = 206, description = "Partial content for a `Range` request"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access, download access, or access to this media file's library"),
        (status = 404, description = "Unknown ticket id, or it does not belong to the caller"),
        (status = 409, description = "The ticket has not finished processing yet (queued/processing/failed)"),
        (status = 410, description = "The ticket expired or was canceled")
    )
)]
pub async fn download_ticket_file_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(id): Path<Uuid>,
    request: Request,
) -> Result<Response, ApiError> {
    ensure_can_download(&streaming.policy)?;
    let ticket = load_owned_ticket(&state, &streaming, id).await?;

    match ticket.status {
        DownloadStatus::Ready => {}
        DownloadStatus::Expired | DownloadStatus::Canceled => {
            return Err(ApiError::new(
                StatusCode::GONE,
                "gone",
                "this download ticket is no longer available",
            ));
        }
        DownloadStatus::Queued | DownloadStatus::Processing | DownloadStatus::Failed => {
            return Err(ApiError::conflict(
                "this download ticket has not finished processing yet",
            ));
        }
    }

    let resolved_path = match &ticket.output_path {
        Some(path) => path.clone(),
        None => {
            // Original-quality tickets have no separately-produced output
            // file -- they serve the source `MediaFile` itself.
            let media_file = state
                .media_files
                .get(ticket.media_file_id)
                .await
                .ok_or_else(|| {
                    ApiError::not_found(format!("unknown media file {}", ticket.media_file_id))
                })?;
            playarr_model::resolve_media_path(&media_file.path)
        }
    };

    let file_name = download_file_name(&ticket);
    let mut response = crate::media::serve_file(&resolved_path, request).await?;
    if let Ok(value) =
        axum::http::HeaderValue::from_str(&format!("attachment; filename=\"{file_name}\""))
    {
        response
            .headers_mut()
            .insert(axum::http::header::CONTENT_DISPOSITION, value);
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_downloadable_media_file, seed_movie,
        seed_streaming_user, seed_streaming_user_with_library_allow,
        seed_streaming_user_without_download_access, test_state,
    };
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use tower::ServiceExt;

    fn post_downloads(token: &str, body: serde_json::Value) -> HttpRequest<Body> {
        HttpRequest::builder()
            .method("POST")
            .uri("/api/v1/downloads")
            .header("Authorization", bearer_header(token))
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap()
    }

    fn get_with_auth(uri: impl AsRef<str>, token: &str) -> HttpRequest<Body> {
        HttpRequest::builder()
            .uri(uri.as_ref())
            .header("Authorization", bearer_header(token))
            .body(Body::empty())
            .unwrap()
    }

    fn delete_with_auth(uri: impl AsRef<str>, token: &str) -> HttpRequest<Body> {
        HttpRequest::builder()
            .method("DELETE")
            .uri(uri.as_ref())
            .header("Authorization", bearer_header(token))
            .body(Body::empty())
            .unwrap()
    }

    async fn fetch_ticket(response: axum::response::Response) -> DownloadTicketResponse {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn original_quality_ticket_is_ready_immediately_and_is_listable() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Test Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(post_downloads(
                &token,
                serde_json::json!({ "media_file_id": file.id, "quality_id": "original" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let ticket = fetch_ticket(response).await;
        assert_eq!(ticket.status, DownloadStatus::Ready);
        assert_eq!(ticket.media_file_id, file.id);
        assert_eq!(ticket.size_bytes, Some(file.size_bytes));
        assert!(ticket.error_message.is_none());

        let list_response = router
            .clone()
            .oneshot(get_with_auth("/api/v1/downloads", &token))
            .await
            .unwrap();
        assert_eq!(list_response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(list_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let tickets: Vec<DownloadTicketResponse> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(tickets.len(), 1);
        assert_eq!(tickets[0].id, ticket.id);

        let get_response = router
            .oneshot(get_with_auth(
                format!("/api/v1/downloads/{}", ticket.id),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(get_response.status(), StatusCode::OK);
        let refetched = fetch_ticket(get_response).await;
        assert_eq!(refetched.id, ticket.id);
    }

    #[tokio::test]
    async fn repeated_create_for_the_same_triple_returns_the_existing_ticket_with_200() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Test Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);
        let body = serde_json::json!({ "media_file_id": file.id, "quality_id": "original" });

        let first = router
            .clone()
            .oneshot(post_downloads(&token, body.clone()))
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::CREATED);
        let first_ticket = fetch_ticket(first).await;

        let second = router.oneshot(post_downloads(&token, body)).await.unwrap();
        assert_eq!(second.status(), StatusCode::OK);
        let second_ticket = fetch_ticket(second).await;
        assert_eq!(second_ticket.id, first_ticket.id);
    }

    #[tokio::test]
    async fn named_profile_ticket_stays_queued_and_its_file_is_409() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Test Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(post_downloads(
                &token,
                serde_json::json!({ "media_file_id": file.id, "quality_id": "h264-720p-4mbps" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let ticket = fetch_ticket(response).await;
        assert_eq!(ticket.status, DownloadStatus::Queued);

        let file_response = router
            .oneshot(get_with_auth(
                format!("/api/v1/downloads/{}/file", ticket.id),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(file_response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn unknown_quality_id_is_rejected_with_400() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Test Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(post_downloads(
                &token,
                serde_json::json!({ "media_file_id": file.id, "quality_id": "not-a-real-profile" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn unknown_media_file_id_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(post_downloads(
                &token,
                serde_json::json!({ "media_file_id": Uuid::new_v4(), "quality_id": "original" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn caller_outside_the_medias_library_is_403() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Test Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![Uuid::new_v4()]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(post_downloads(
                &token,
                serde_json::json!({ "media_file_id": file.id, "quality_id": "original" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn caller_without_download_policy_grant_is_403() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Test Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_without_download_access(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(post_downloads(
                &token,
                serde_json::json!({ "media_file_id": file.id, "quality_id": "original" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn a_ticket_is_invisible_and_404s_for_a_different_caller() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Test Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let owner_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, owner_id, vec![file.source_instance_id])
            .await;
        let owner_token = mint_access_token(&state, owner_id);
        let create_response = router
            .clone()
            .oneshot(post_downloads(
                &owner_token,
                serde_json::json!({ "media_file_id": file.id, "quality_id": "original" }),
            ))
            .await
            .unwrap();
        let ticket = fetch_ticket(create_response).await;

        let other_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, other_id, vec![file.source_instance_id])
            .await;
        let other_token = mint_access_token(&state, other_id);

        let get_response = router
            .clone()
            .oneshot(get_with_auth(
                format!("/api/v1/downloads/{}", ticket.id),
                &other_token,
            ))
            .await
            .unwrap();
        assert_eq!(get_response.status(), StatusCode::NOT_FOUND);

        let delete_response = router
            .oneshot(delete_with_auth(
                format!("/api/v1/downloads/{}", ticket.id),
                &other_token,
            ))
            .await
            .unwrap();
        assert_eq!(delete_response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn cancel_soft_cancels_and_the_file_route_then_returns_410() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Test Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);

        let create_response = router
            .clone()
            .oneshot(post_downloads(
                &token,
                serde_json::json!({ "media_file_id": file.id, "quality_id": "original" }),
            ))
            .await
            .unwrap();
        let ticket = fetch_ticket(create_response).await;

        let cancel_response = router
            .clone()
            .oneshot(delete_with_auth(
                format!("/api/v1/downloads/{}", ticket.id),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(cancel_response.status(), StatusCode::NO_CONTENT);

        // Soft-canceled, not deleted -- a poll still resolves the ticket
        // (200, status canceled), matching this module's doc comment.
        let get_response = router
            .clone()
            .oneshot(get_with_auth(
                format!("/api/v1/downloads/{}", ticket.id),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(get_response.status(), StatusCode::OK);
        let refetched = fetch_ticket(get_response).await;
        assert_eq!(refetched.status, DownloadStatus::Canceled);

        let file_response = router
            .oneshot(get_with_auth(
                format!("/api/v1/downloads/{}/file", ticket.id),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(file_response.status(), StatusCode::GONE);
    }

    #[tokio::test]
    async fn original_ticket_file_serves_source_bytes_with_range_and_attachment_disposition() {
        let (router, state) = test_state().await;
        let contents = b"hello playarr downloads".to_vec();
        let path = std::env::temp_dir().join(format!(
            "playarr-api-downloads-test-{}.mkv",
            Uuid::new_v4()
        ));
        std::fs::write(&path, &contents).expect("write temp fixture file");

        let work_id = seed_movie(&state, "Test Movie").await;
        let mut file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        file.path = path.clone();
        file.size_bytes = contents.len() as u64;
        state.media_files.insert(file.clone());
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);

        let create_response = router
            .clone()
            .oneshot(post_downloads(
                &token,
                serde_json::json!({ "media_file_id": file.id, "quality_id": "original" }),
            ))
            .await
            .unwrap();
        let ticket = fetch_ticket(create_response).await;

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/downloads/{}/file", ticket.id))
                    .header("Authorization", bearer_header(&token))
                    .header("Range", "bytes=0-4")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        let content_disposition = response
            .headers()
            .get(axum::http::header::CONTENT_DISPOSITION)
            .expect("Content-Disposition header")
            .to_str()
            .unwrap()
            .to_string();
        assert!(content_disposition.starts_with("attachment"));
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body_bytes.as_ref(), b"hello");

        let _ = std::fs::remove_file(&path);
    }
}
