//! User + System playlists -- named, ordered lists of video works or audio tracks, optionally
//! nested. See `streamarr_model::playlist`'s module doc comment for the
//! full domain rationale.
//!
//! Access control (checked in every handler below, not just at the route
//! level, since a single playlist can be someone's personal one or a
//! System one):
//! - A "System" playlist (`owner_user_id: None`) is readable by any
//!   [`CatalogViewer`] (any streaming-capable user, or an admin) and
//!   writable only by an [`AdminUser`].
//! - A personal playlist (`owner_user_id: Some(user_id)`) is readable and
//!   writable by that owning user, or by an admin (support/moderation) --
//!   any other caller gets `404`, not `403`, so a personal playlist's mere
//!   existence isn't leaked to a caller who doesn't own it.
//!
//! Routes:
//! - `GET /api/v1/playlists` -- every playlist visible to the caller (own +
//!   System), [`CatalogViewer`]-gated.
//! - `POST /api/v1/playlists` -- create a personal playlist for the caller,
//!   or (admin only, via `is_system: true`) a System playlist.
//! - `GET/PUT/DELETE /api/v1/playlists/{id}` -- read/rename-or-move/delete
//!   one playlist, access-checked per playlist as above.
//! - `POST /api/v1/playlists/{id}/items` -- append a work.
//! - `DELETE /api/v1/playlists/{id}/items/{item_id}` -- remove one item.
//! - `PUT /api/v1/playlists/{id}/items/order` -- reorder every item.
//! - `GET /api/v1/admin/playlists` -- every playlist regardless of owner
//!   (System + every user's personal ones), [`AdminUser`]-gated. The admin
//!   "view everything" surface for `PlaylistsPage`/`PlaylistEditPage` in
//!   Streamarr's own admin UI: an admin can *see* any user's personal
//!   playlist for visibility, but the existing per-playlist [`can_write`]
//!   check (unchanged by this route) is what actually gates whether they
//!   can edit it -- the admin UI itself additionally chooses to only
//!   expose edit/delete controls for System playlists, personal ones are
//!   rendered read-only there even though the backend would technically
//!   allow an admin write.
//!
//! [`list_playlist_items_handler`] and [`reorder_playlist_items_handler`]
//! additionally filter out items whose `work_id` falls outside the caller's
//! per-user library access control ceiling
//! ([`CatalogViewer::allowed_libraries`], via
//! `streamarr_catalog::CatalogService::is_work_visible`) before returning
//! them -- a playlist itself (its name, its existence) is an owner/
//! System-visibility concern handled entirely by [`can_read`]/[`can_write`]
//! above, but the *content* of an item on it is subject to the same
//! `Policy::library_allow` enforcement as every other catalog read path,
//! on every response that echoes items back, not just the initial `GET`.
//! [`add_playlist_item_handler`] additionally resolves the work being added
//! via [`CatalogViewer::allowed_libraries`] (same
//! `streamarr_catalog::CatalogService::get_by_id` call every other
//! work-detail read path uses) rather than an unrestricted lookup, so a
//! restricted caller can neither probe for a work's existence outside their
//! own libraries nor persist a `PlaylistItem` row pointing at one --
//! owning the playlist grants write access to its structure, not a bypass
//! of the caller's library grants. Removing/reordering items already on a
//! playlist perform no such re-check (they operate on ids already agreed to
//! be part of the playlist; visibility is re-applied on every read via
//! [`list_playlist_items_handler`]/[`reorder_playlist_items_handler`]
//! above, so a since-revoked grant still hides the item without needing a
//! check on the mutation itself).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use streamarr_catalog::WorkChildren;
use streamarr_model::{Playlist, PlaylistItem, PlaylistMediaType, WorkKind};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{AdminUser, CatalogViewer};
use crate::error::ApiError;
use crate::AppState;

/// `true` if `viewer` may read/write `playlist` -- see the module doc
/// comment's access-control summary. A System playlist is readable by
/// anyone reaching this handler at all (the [`CatalogViewer`] gate already
/// covers "streaming-capable or admin"); write access to a System playlist
/// is separately checked with [`can_write`], not this function, since read
/// and write diverge for that case.
fn can_read(playlist: &Playlist, viewer_user_id: Uuid, is_admin: bool) -> bool {
    match playlist.owner_user_id {
        None => true,
        Some(owner) => owner == viewer_user_id || is_admin,
    }
}

/// `true` if `viewer` may create/rename/move/delete/mutate-items-on
/// `playlist`. A System playlist (`owner_user_id: None`) requires admin;
/// a personal playlist requires being its owner, or an admin.
fn can_write(playlist: &Playlist, viewer_user_id: Uuid, is_admin: bool) -> bool {
    match playlist.owner_user_id {
        None => is_admin,
        Some(owner) => owner == viewer_user_id || is_admin,
    }
}

/// Fetches `id`, mapping "doesn't exist" and "exists but not visible to
/// this caller" to the same `404` -- see the module doc comment on why a
/// personal playlist's existence isn't leaked to a non-owner.
async fn get_visible(
    state: &AppState,
    id: Uuid,
    viewer_user_id: Uuid,
    is_admin: bool,
) -> Result<Playlist, ApiError> {
    let playlist = state.playlist_repo.get(id).await?;
    if !can_read(&playlist, viewer_user_id, is_admin) {
        return Err(ApiError::not_found("playlist not found"));
    }
    Ok(playlist)
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlaylistResponse {
    pub id: Uuid,
    pub name: String,
    /// `true` for a System (admin-managed, globally visible) playlist,
    /// `false` for a personal one.
    pub is_system: bool,
    /// `None` for a System playlist. Present (including for a personal
    /// playlist that isn't the caller's own) only on the admin
    /// "view everything" listing ([`list_admin_playlists_handler`]) -- the
    /// ordinary [`list_playlists_handler`]/[`get_playlist_handler`]
    /// responses a non-admin caller sees also carry this, but a caller
    /// only ever gets back playlists they can already read (their own +
    /// System, see [`can_read`]), so it's never a stranger's id in
    /// practice for them.
    pub owner_user_id: Option<Uuid>,
    pub parent_playlist_id: Option<Uuid>,
    pub media_type: PlaylistMediaType,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Playlist> for PlaylistResponse {
    fn from(playlist: Playlist) -> Self {
        PlaylistResponse {
            id: playlist.id,
            name: playlist.name,
            is_system: playlist.owner_user_id.is_none(),
            owner_user_id: playlist.owner_user_id,
            parent_playlist_id: playlist.parent_playlist_id,
            media_type: playlist.media_type,
            created_at: playlist.created_at,
            updated_at: playlist.updated_at,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreatePlaylistRequest {
    pub name: String,
    /// `Some(id)` nests this playlist under an existing one the caller can
    /// already write to (e.g. "Sample Movie Golf" under "MCU") -- checked in
    /// [`create_playlist_handler`], not structurally enforced here.
    #[serde(default)]
    pub parent_playlist_id: Option<Uuid>,
    /// Requires [`AdminUser`] when `true` -- a non-admin caller setting
    /// this is rejected with `403`, not silently downgraded to a personal
    /// playlist, so a client bug never creates the wrong kind of playlist
    /// unnoticed.
    #[serde(default)]
    pub is_system: bool,
    /// Existing clients default to video; new clients present this choice
    /// when creating a top-level playlist.
    #[serde(default)]
    pub media_type: PlaylistMediaType,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdatePlaylistRequest {
    pub name: String,
    #[serde(default)]
    pub parent_playlist_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlaylistItemResponse {
    pub id: Uuid,
    pub playlist_id: Uuid,
    pub work_id: Uuid,
    pub track_id: Option<Uuid>,
    pub position: i32,
    pub added_at: DateTime<Utc>,
}

impl From<PlaylistItem> for PlaylistItemResponse {
    fn from(item: PlaylistItem) -> Self {
        PlaylistItemResponse {
            id: item.id,
            playlist_id: item.playlist_id,
            work_id: item.work_id,
            track_id: item.track_id,
            position: item.position,
            added_at: item.added_at,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddPlaylistItemRequest {
    pub work_id: Uuid,
    #[serde(default)]
    pub track_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReorderPlaylistItemsRequest {
    /// Every item id currently on this playlist, in the desired new order.
    /// An id that isn't actually one of this playlist's items is silently
    /// ignored -- see `PlaylistRepo::reorder_items`'s own doc comment.
    pub item_ids: Vec<Uuid>,
}

/// Every playlist visible to the caller: their own personal playlists plus
/// every System playlist.
#[utoipa::path(
    get,
    path = "/api/v1/playlists",
    tag = "playlists",
    responses(
        (status = 200, description = "Every playlist visible to the caller", body = Vec<PlaylistResponse>, example = json!([
            {
                "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "name": "Sample Cinematic Universe",
                "is_system": false,
                "owner_user_id": "9d3b3f8a-6b34-4b1e-8a4a-2e6f6b1a9c11",
                "parent_playlist_id": null,
                "media_type": "video",
                "created_at": "2026-01-15T10:30:00Z",
                "updated_at": "2026-01-16T08:45:00Z"
            },
            {
                "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                "name": "Staff Picks",
                "is_system": true,
                "owner_user_id": null,
                "parent_playlist_id": null,
                "media_type": "video",
                "created_at": "2026-01-10T09:00:00Z",
                "updated_at": "2026-01-10T09:00:00Z"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn list_playlists_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<Json<Vec<PlaylistResponse>>, ApiError> {
    let playlists = state
        .playlist_repo
        .list_visible_to_user(viewer.user_id)
        .await?;
    Ok(Json(
        playlists.into_iter().map(PlaylistResponse::from).collect(),
    ))
}

/// Every playlist regardless of owner -- see the module doc comment.
#[utoipa::path(
    get,
    path = "/api/v1/admin/playlists",
    tag = "playlists",
    responses(
        (status = 200, description = "Every playlist, System and personal", body = Vec<PlaylistResponse>, example = json!([
            {
                "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                "name": "Staff Picks",
                "is_system": true,
                "owner_user_id": null,
                "parent_playlist_id": null,
                "media_type": "video",
                "created_at": "2026-01-10T09:00:00Z",
                "updated_at": "2026-01-10T09:00:00Z"
            },
            {
                "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "name": "Sample Cinematic Universe",
                "is_system": false,
                "owner_user_id": "9d3b3f8a-6b34-4b1e-8a4a-2e6f6b1a9c11",
                "parent_playlist_id": null,
                "media_type": "video",
                "created_at": "2026-01-15T10:30:00Z",
                "updated_at": "2026-01-16T08:45:00Z"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_admin_playlists_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<PlaylistResponse>>, ApiError> {
    let playlists = state.playlist_repo.list_all().await?;
    Ok(Json(
        playlists.into_iter().map(PlaylistResponse::from).collect(),
    ))
}

/// Creates a playlist owned by the caller, or (admin-only, `is_system:
/// true`) a System playlist. If `parent_playlist_id` is set, the caller
/// must already have write access to that parent (same [`can_write`]
/// check used for every other mutation) -- this is also what keeps a
/// parent/child pair's ownership consistent, since a child can only ever
/// be created under a parent the same caller could already mutate.
#[utoipa::path(
    post,
    path = "/api/v1/playlists",
    tag = "playlists",
    request_body(content = CreatePlaylistRequest, example = json!({
        "name": "Sample Movie Golf",
        "parent_playlist_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "is_system": false,
        "media_type": "video"
    })),
    responses(
        (status = 200, description = "The created playlist", body = PlaylistResponse, example = json!({
            "id": "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
            "name": "Sample Movie Golf",
            "is_system": false,
            "owner_user_id": "9d3b3f8a-6b34-4b1e-8a4a-2e6f6b1a9c11",
            "parent_playlist_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "media_type": "video",
            "created_at": "2026-01-15T10:30:00Z",
            "updated_at": "2026-01-15T10:30:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Non-admin caller set is_system, or lacks write access to the requested parent"),
        (status = 404, description = "No such parent_playlist_id")
    )
)]
pub async fn create_playlist_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Json(body): Json<CreatePlaylistRequest>,
) -> Result<Json<PlaylistResponse>, ApiError> {
    let is_admin = viewer.policy.is_admin;
    if body.is_system && !is_admin {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "only an admin may create a System playlist",
        ));
    }

    if let Some(parent_id) = body.parent_playlist_id {
        let parent = get_visible(&state, parent_id, viewer.user_id, is_admin).await?;
        if !can_write(&parent, viewer.user_id, is_admin) {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "forbidden",
                "caller does not have write access to the requested parent playlist",
            ));
        }
        if parent.media_type != body.media_type {
            return Err(ApiError::bad_request(
                "a nested playlist must use the same media type as its parent",
            ));
        }
    }

    let now = Utc::now();
    let playlist = Playlist {
        id: Uuid::new_v4(),
        name: body.name,
        owner_user_id: if body.is_system {
            None
        } else {
            Some(viewer.user_id)
        },
        parent_playlist_id: body.parent_playlist_id,
        media_type: body.media_type,
        created_at: now,
        updated_at: now,
    };
    state.playlist_repo.upsert(&playlist).await?;
    Ok(Json(playlist.into()))
}

/// One playlist by id.
#[utoipa::path(
    get,
    path = "/api/v1/playlists/{id}",
    tag = "playlists",
    params(("id" = Uuid, Path, description = "Playlist id")),
    responses(
        (status = 200, description = "The playlist", body = PlaylistResponse, example = json!({
            "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "name": "Sample Cinematic Universe",
            "is_system": false,
            "owner_user_id": "9d3b3f8a-6b34-4b1e-8a4a-2e6f6b1a9c11",
            "parent_playlist_id": null,
            "media_type": "video",
            "created_at": "2026-01-15T10:30:00Z",
            "updated_at": "2026-01-16T08:45:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "No such playlist, or not visible to the caller")
    )
)]
pub async fn get_playlist_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<PlaylistResponse>, ApiError> {
    let is_admin = viewer.policy.is_admin;
    let playlist = get_visible(&state, id, viewer.user_id, is_admin).await?;
    Ok(Json(playlist.into()))
}

/// Renames and/or re-nests a playlist in place. Ownership
/// (`owner_user_id`)/System-vs-personal can never change through this
/// endpoint -- only [`can_write`]-gated for the playlist's *existing*
/// owner, so a personal playlist can't be converted into a System one (or
/// vice versa) by an update.
#[utoipa::path(
    put,
    path = "/api/v1/playlists/{id}",
    tag = "playlists",
    params(("id" = Uuid, Path, description = "Playlist id")),
    request_body(content = UpdatePlaylistRequest, example = json!({
        "name": "Sample Cinematic Universe",
        "parent_playlist_id": null
    })),
    responses(
        (status = 200, description = "The updated playlist", body = PlaylistResponse, example = json!({
            "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "name": "Sample Cinematic Universe",
            "is_system": false,
            "owner_user_id": "9d3b3f8a-6b34-4b1e-8a4a-2e6f6b1a9c11",
            "parent_playlist_id": null,
            "media_type": "video",
            "created_at": "2026-01-15T10:30:00Z",
            "updated_at": "2026-01-16T08:45:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks write access to this playlist, or to the requested new parent"),
        (status = 404, description = "No such playlist, or not visible to the caller")
    )
)]
pub async fn update_playlist_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePlaylistRequest>,
) -> Result<Json<PlaylistResponse>, ApiError> {
    let is_admin = viewer.policy.is_admin;
    let existing = get_visible(&state, id, viewer.user_id, is_admin).await?;
    if !can_write(&existing, viewer.user_id, is_admin) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "caller does not have write access to this playlist",
        ));
    }
    if let Some(parent_id) = body.parent_playlist_id {
        let parent = get_visible(&state, parent_id, viewer.user_id, is_admin).await?;
        if !can_write(&parent, viewer.user_id, is_admin) {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "forbidden",
                "caller does not have write access to the requested parent playlist",
            ));
        }
        if parent.media_type != existing.media_type {
            return Err(ApiError::bad_request(
                "a nested playlist must use the same media type as its parent",
            ));
        }
    }

    let updated = Playlist {
        id: existing.id,
        name: body.name,
        owner_user_id: existing.owner_user_id,
        parent_playlist_id: body.parent_playlist_id,
        media_type: existing.media_type,
        created_at: existing.created_at,
        updated_at: Utc::now(),
    };
    state.playlist_repo.upsert(&updated).await?;
    Ok(Json(updated.into()))
}

/// Deletes a playlist -- cascades to nested child playlists and items, see
/// `PlaylistRepo::delete`'s doc comment.
#[utoipa::path(
    delete,
    path = "/api/v1/playlists/{id}",
    tag = "playlists",
    params(("id" = Uuid, Path, description = "Playlist id")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks write access to this playlist"),
        (status = 404, description = "No such playlist, or not visible to the caller")
    )
)]
pub async fn delete_playlist_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let is_admin = viewer.policy.is_admin;
    let existing = get_visible(&state, id, viewer.user_id, is_admin).await?;
    if !can_write(&existing, viewer.user_id, is_admin) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "caller does not have write access to this playlist",
        ));
    }
    state.playlist_repo.delete(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Every item on a playlist, in order.
#[utoipa::path(
    get,
    path = "/api/v1/playlists/{id}/items",
    tag = "playlists",
    params(("id" = Uuid, Path, description = "Playlist id")),
    responses(
        (status = 200, description = "This playlist's items, position-ordered", body = Vec<PlaylistItemResponse>, example = json!([
            {
                "id": "e8b3a0c4-1d5f-4061-8c3d-4e5f6a7b8c9d",
                "playlist_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "work_id": "c6f1e8a2-9b3d-4e5f-8a1b-2c3d4e5f6a7b",
                "track_id": null,
                "position": 0,
                "added_at": "2026-01-15T10:31:00Z"
            },
            {
                "id": "f9c4b1d5-2e60-4172-9d4e-5f6a7b8c9d0e",
                "playlist_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "work_id": "b5e0d7f1-8a2c-4d3e-9f0a-1b2c3d4e5f6a",
                "track_id": null,
                "position": 1,
                "added_at": "2026-01-15T10:32:00Z"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "No such playlist, or not visible to the caller")
    )
)]
pub async fn list_playlist_items_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<PlaylistItemResponse>>, ApiError> {
    let is_admin = viewer.policy.is_admin;
    get_visible(&state, id, viewer.user_id, is_admin).await?;
    let items = state.playlist_repo.list_items(id).await?;

    // Per-user library access control: an item pointing at a work the
    // caller has no `Policy::library_allow` grant for is silently omitted
    // rather than 403ing the whole list -- a playlist (System or personal)
    // can perfectly legitimately mix works from libraries the current
    // viewer isn't allowed to see, and hiding just those entries mirrors
    // how `browse`/`search` already behave for the same caller.
    let allowed = viewer.allowed_libraries();
    let mut visible = Vec::with_capacity(items.len());
    for item in items {
        if state
            .catalog
            .is_work_visible(item.work_id, allowed.as_deref())
            .await?
        {
            visible.push(item);
        }
    }

    Ok(Json(
        visible
            .into_iter()
            .map(PlaylistItemResponse::from)
            .collect(),
    ))
}

/// Appends a video work or individual audio track to the end of a playlist.
#[utoipa::path(
    post,
    path = "/api/v1/playlists/{id}/items",
    tag = "playlists",
    params(("id" = Uuid, Path, description = "Playlist id")),
    request_body(content = AddPlaylistItemRequest, example = json!({
        "work_id": "c6f1e8a2-9b3d-4e5f-8a1b-2c3d4e5f6a7b",
        "track_id": null
    })),
    responses(
        (status = 200, description = "The created item", body = PlaylistItemResponse, example = json!({
            "id": "e8b3a0c4-1d5f-4061-8c3d-4e5f6a7b8c9d",
            "playlist_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "work_id": "c6f1e8a2-9b3d-4e5f-8a1b-2c3d4e5f6a7b",
            "track_id": null,
            "position": 0,
            "added_at": "2026-01-15T10:31:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks write access to this playlist"),
        (status = 404, description = "No such playlist (or not visible to the caller), or the referenced work is outside the caller's allowed libraries")
    )
)]
pub async fn add_playlist_item_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
    Json(body): Json<AddPlaylistItemRequest>,
) -> Result<Json<PlaylistItemResponse>, ApiError> {
    let is_admin = viewer.policy.is_admin;
    let playlist = get_visible(&state, id, viewer.user_id, is_admin).await?;
    if !can_write(&playlist, viewer.user_id, is_admin) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "caller does not have write access to this playlist",
        ));
    }
    // Per-user library access control: validating/adding an item is gated
    // by the same `Policy::library_allow` ceiling as every other catalog
    // read path (`get_work_handler`, `is_work_visible` above in
    // `list_playlist_items_handler`) -- owning the playlist grants write
    // access to the playlist's *structure*, not a bypass of the caller's
    // library grants, so a work outside `allowed` 404s here exactly as it
    // would via `GET /api/v1/catalog/works/{id}`.
    let allowed = viewer.allowed_libraries();
    let detail = state
        .catalog
        .get_by_id(body.work_id, allowed.as_deref())
        .await?;
    match playlist.media_type {
        PlaylistMediaType::Video => {
            if body.track_id.is_some()
                || !matches!(
                    detail.work.kind,
                    WorkKind::Movie | WorkKind::Series | WorkKind::Site
                )
            {
                return Err(ApiError::bad_request(
                    "video playlists accept only movie, series, or site works",
                ));
            }
        }
        PlaylistMediaType::Audio => {
            let Some(track_id) = body.track_id else {
                return Err(ApiError::bad_request(
                    "audio playlists require an individual track",
                ));
            };
            let track_belongs_to_artist = match &detail.children {
                WorkChildren::Artist(albums) => albums
                    .iter()
                    .flat_map(|album| &album.tracks)
                    .any(|track| track.track.id == track_id),
                _ => false,
            };
            if detail.work.kind != WorkKind::Artist || !track_belongs_to_artist {
                return Err(ApiError::bad_request(
                    "audio playlist track does not belong to the supplied artist work",
                ));
            }
        }
    }
    let item = state
        .playlist_repo
        .add_item(id, body.work_id, body.track_id)
        .await?;
    Ok(Json(item.into()))
}

/// Removes one item from a playlist.
#[utoipa::path(
    delete,
    path = "/api/v1/playlists/{id}/items/{item_id}",
    tag = "playlists",
    params(
        ("id" = Uuid, Path, description = "Playlist id"),
        ("item_id" = Uuid, Path, description = "Playlist item id")
    ),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks write access to this playlist"),
        (status = 404, description = "No such playlist/item, or playlist not visible to the caller")
    )
)]
pub async fn remove_playlist_item_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path((id, item_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let is_admin = viewer.policy.is_admin;
    let playlist = get_visible(&state, id, viewer.user_id, is_admin).await?;
    if !can_write(&playlist, viewer.user_id, is_admin) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "caller does not have write access to this playlist",
        ));
    }
    state.playlist_repo.remove_item(id, item_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Replaces the full item ordering of a playlist. The returned item list is
/// filtered by the caller's `Policy::library_allow` exactly like
/// [`list_playlist_items_handler`] -- see that handler's doc comment.
#[utoipa::path(
    put,
    path = "/api/v1/playlists/{id}/items/order",
    tag = "playlists",
    params(("id" = Uuid, Path, description = "Playlist id")),
    request_body(content = ReorderPlaylistItemsRequest, example = json!({
        "item_ids": [
            "f9c4b1d5-2e60-4172-9d4e-5f6a7b8c9d0e",
            "e8b3a0c4-1d5f-4061-8c3d-4e5f6a7b8c9d"
        ]
    })),
    responses(
        (status = 200, description = "The playlist's items in their new order", body = Vec<PlaylistItemResponse>, example = json!([
            {
                "id": "f9c4b1d5-2e60-4172-9d4e-5f6a7b8c9d0e",
                "playlist_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "work_id": "b5e0d7f1-8a2c-4d3e-9f0a-1b2c3d4e5f6a",
                "track_id": null,
                "position": 0,
                "added_at": "2026-01-15T10:32:00Z"
            },
            {
                "id": "e8b3a0c4-1d5f-4061-8c3d-4e5f6a7b8c9d",
                "playlist_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "work_id": "c6f1e8a2-9b3d-4e5f-8a1b-2c3d4e5f6a7b",
                "track_id": null,
                "position": 1,
                "added_at": "2026-01-15T10:31:00Z"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks write access to this playlist"),
        (status = 404, description = "No such playlist, or not visible to the caller")
    )
)]
pub async fn reorder_playlist_items_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
    Json(body): Json<ReorderPlaylistItemsRequest>,
) -> Result<Json<Vec<PlaylistItemResponse>>, ApiError> {
    let is_admin = viewer.policy.is_admin;
    let playlist = get_visible(&state, id, viewer.user_id, is_admin).await?;
    if !can_write(&playlist, viewer.user_id, is_admin) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "caller does not have write access to this playlist",
        ));
    }
    state
        .playlist_repo
        .reorder_items(id, &body.item_ids)
        .await?;
    let items = state.playlist_repo.list_items(id).await?;

    // Per-user library access control, mirroring `list_playlist_items_handler`
    // exactly (see its doc comment): the reordered list returned here is the
    // same response shape and must be gated by the same
    // `Policy::library_allow` ceiling, not just the initial `GET`.
    let allowed = viewer.allowed_libraries();
    let mut visible = Vec::with_capacity(items.len());
    for item in items {
        if state
            .catalog
            .is_work_visible(item.work_id, allowed.as_deref())
            .await?
        {
            visible.push(item);
        }
    }

    Ok(Json(
        visible
            .into_iter()
            .map(PlaylistItemResponse::from)
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_streaming_user, test_state,
    };
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    async fn json_body<T: serde::de::DeserializeOwned>(response: axum::response::Response) -> T {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn create_without_token_is_unauthorized() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::json!({"name": "MCU"}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn non_admin_cannot_create_system_playlist() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({"name": "Staff Picks", "is_system": true}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn create_read_update_delete_round_trip_as_owner() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(serde_json::json!({"name": "MCU"}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let created: PlaylistResponse = json_body(response).await;
        assert_eq!(created.name, "MCU");
        assert!(!created.is_system);

        // Create a nested sub-playlist under it.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({
                            "name": "Sample Movie Golf",
                            "parent_playlist_id": created.id,
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let child: PlaylistResponse = json_body(response).await;
        assert_eq!(child.parent_playlist_id, Some(created.id));

        // List includes both.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/playlists")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let listed: Vec<PlaylistResponse> = json_body(response).await;
        assert!(listed.iter().any(|p| p.id == created.id));
        assert!(listed.iter().any(|p| p.id == child.id));

        // Rename.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playlists/{}", created.id))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({"name": "Sample Cinematic Universe"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let updated: PlaylistResponse = json_body(response).await;
        assert_eq!(updated.name, "Sample Cinematic Universe");

        // Delete the parent -- cascades to the child.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/playlists/{}", created.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playlists/{}", child.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn personal_playlist_is_not_visible_to_another_user() {
        let (router, state) = test_state().await;
        let owner_id = Uuid::new_v4();
        seed_streaming_user(&state, owner_id).await;
        let owner_token = mint_access_token(&state, owner_id);

        let other_id = Uuid::new_v4();
        seed_streaming_user(&state, other_id).await;
        let other_token = mint_access_token(&state, other_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&owner_token))
                    .body(Body::from(
                        serde_json::json!({"name": "Private"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let created: PlaylistResponse = json_body(response).await;

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playlists/{}", created.id))
                    .header("Authorization", bearer_header(&other_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // Not writable by the other user either -- gets the same 404, not 403.
        let response = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/playlists/{}", created.id))
                    .header("Authorization", bearer_header(&other_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn system_playlist_readable_by_any_streaming_user_writable_only_by_admin() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&admin_token))
                    .body(Body::from(
                        serde_json::json!({"name": "Staff Picks", "is_system": true}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let system: PlaylistResponse = json_body(response).await;
        assert!(system.is_system);

        let viewer_id = Uuid::new_v4();
        seed_streaming_user(&state, viewer_id).await;
        let viewer_token = mint_access_token(&state, viewer_id);

        // Readable.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playlists/{}", system.id))
                    .header("Authorization", bearer_header(&viewer_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Not writable.
        let response = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playlists/{}", system.id))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&viewer_token))
                    .body(Body::from(
                        serde_json::json!({"name": "Hijacked"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn add_list_remove_and_reorder_items() {
        use crate::test_support::{
            seed_media_file, seed_movie, seed_streaming_user_with_library_allow,
        };
        use streamarr_model::media::LeafRef;

        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();

        // The two playlist items need to resolve to a real, visible `Work`
        // -- `list_playlist_items_handler` now filters items through
        // `CatalogService::is_work_visible`, which requires a synced
        // `MediaFile` whose `source_instance_id` is in the caller's
        // `Policy::library_allow` (see that handler's doc comment). Bare
        // random work ids with no backing file would be invisible to any
        // non-admin caller and make the `listed.len()` assertions below
        // fail regardless of the CRUD logic actually under test here.
        let source_instance_a = Uuid::new_v4();
        let source_instance_b = Uuid::new_v4();
        let work_a = seed_movie(&state, "Watchlist Movie A").await;
        seed_media_file(&state, work_a, LeafRef::Work, source_instance_a).await;
        let work_b = seed_movie(&state, "Watchlist Movie B").await;
        seed_media_file(&state, work_b, LeafRef::Work, source_instance_b).await;

        seed_streaming_user_with_library_allow(
            &state,
            user_id,
            vec![source_instance_a, source_instance_b],
        )
        .await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({"name": "Watchlist"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let playlist: PlaylistResponse = json_body(response).await;

        let mut items = Vec::new();
        for work_id in [work_a, work_b] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                        .header("content-type", "application/json")
                        .header("Authorization", bearer_header(&token))
                        .body(Body::from(
                            serde_json::json!({"work_id": work_id}).to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            items.push(json_body::<PlaylistItemResponse>(response).await);
        }

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let listed: Vec<PlaylistItemResponse> = json_body(response).await;
        assert_eq!(listed.len(), 2);

        // Reorder: reverse the two.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playlists/{}/items/order", playlist.id))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({"item_ids": [items[1].id, items[0].id]}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let reordered: Vec<PlaylistItemResponse> = json_body(response).await;
        assert_eq!(reordered[0].id, items[1].id);
        assert_eq!(reordered[1].id, items[0].id);

        // Remove one.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!(
                        "/api/v1/playlists/{}/items/{}",
                        playlist.id, items[0].id
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let listed: Vec<PlaylistItemResponse> = json_body(response).await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, items[1].id);
    }

    #[tokio::test]
    async fn audio_playlist_rejects_video_items_and_video_children() {
        use crate::test_support::{
            seed_media_file, seed_movie, seed_streaming_user_with_library_allow,
        };
        use streamarr_model::media::LeafRef;

        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        // `seed_streaming_user`'s policy has an empty (deny-all)
        // `library_allow`, and `get_by_id` now enforces that ceiling on
        // this endpoint too -- grant an explicit instance and give the
        // movie a synced media file under it, so this test still exercises
        // the media-type/kind mismatch it's named for rather than
        // incidentally 404ing on library ACL first.
        let source_instance = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance]).await;
        let token = mint_access_token(&state, user_id);
        let movie_id = seed_movie(&state, "Wrong media type").await;
        seed_media_file(&state, movie_id, LeafRef::Work, source_instance).await;

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({"name": "Road Trip", "media_type": "audio"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let playlist: PlaylistResponse = json_body(response).await;
        assert_eq!(playlist.media_type, PlaylistMediaType::Audio);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({"work_id": movie_id}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({
                            "name": "Video child",
                            "parent_playlist_id": playlist.id,
                            "media_type": "video"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    /// Per-user library access control: an admin-authored System playlist
    /// can legitimately mix works from multiple libraries -- a restricted
    /// viewer listing its items must only see the ones inside their own
    /// `Policy::library_allow`, with the rest silently omitted (not a
    /// `403` for the whole list, and not a partial/broken response).
    #[tokio::test]
    async fn list_items_omits_works_outside_the_callers_allowed_libraries() {
        use crate::test_support::{
            seed_media_file, seed_movie, seed_streaming_user_with_library_allow,
        };
        use streamarr_model::media::LeafRef;

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();
        let allowed_work = seed_movie(&state, "Playlist Allowed Movie").await;
        seed_media_file(&state, allowed_work, LeafRef::Work, allowed_instance).await;
        let other_work = seed_movie(&state, "Playlist Other Movie").await;
        seed_media_file(&state, other_work, LeafRef::Work, other_instance).await;

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&admin_token))
                    .body(Body::from(
                        serde_json::json!({"name": "Mixed Library Playlist", "is_system": true})
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let playlist: PlaylistResponse = json_body(response).await;

        for work_id in [allowed_work, other_work] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                        .header("content-type", "application/json")
                        .header("Authorization", bearer_header(&admin_token))
                        .body(Body::from(
                            serde_json::json!({"work_id": work_id}).to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }

        let viewer_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, viewer_id, vec![allowed_instance]).await;
        let viewer_token = mint_access_token(&state, viewer_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                    .header("Authorization", bearer_header(&viewer_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let listed: Vec<PlaylistItemResponse> = json_body(response).await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].work_id, allowed_work);
    }

    /// Regression test for the ACL gap where `add_playlist_item_handler`
    /// resolved `body.work_id` via `CatalogService::get_by_id(.., None)` --
    /// an unrestricted lookup -- even though the caller is a library-
    /// restricted (non-admin) user. Owning a personal playlist grants write
    /// access to that playlist's structure, not a bypass of the caller's
    /// own `Policy::library_allow`: a work outside the caller's allowed
    /// libraries must 404 here exactly as it would via
    /// `GET /api/v1/catalog/works/{id}`, both so the endpoint can't be used
    /// as a cross-library existence oracle and so no `PlaylistItem` ever
    /// gets persisted pointing at a work the caller has no grant for.
    #[tokio::test]
    async fn add_item_outside_the_callers_allowed_libraries_is_404() {
        use crate::test_support::{
            seed_media_file, seed_movie, seed_streaming_user_with_library_allow,
        };
        use streamarr_model::media::LeafRef;

        let (router, state) = test_state().await;

        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();
        let allowed_work = seed_movie(&state, "Owner Allowed Movie").await;
        seed_media_file(&state, allowed_work, LeafRef::Work, allowed_instance).await;
        let other_work = seed_movie(&state, "Owner Restricted Movie").await;
        seed_media_file(&state, other_work, LeafRef::Work, other_instance).await;

        let viewer_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, viewer_id, vec![allowed_instance]).await;
        let viewer_token = mint_access_token(&state, viewer_id);

        // A personal playlist owned by the restricted viewer -- `can_write`
        // grants them write access to it regardless of library_allow.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&viewer_token))
                    .body(Body::from(
                        serde_json::json!({"name": "My Movies"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let playlist: PlaylistResponse = json_body(response).await;

        // A work outside the viewer's library_allow 404s -- not a 400/403,
        // and indistinguishable from a genuinely nonexistent work_id, same
        // as `get_work_handler`.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&viewer_token))
                    .body(Body::from(
                        serde_json::json!({"work_id": other_work}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // A work inside the viewer's library_allow still succeeds.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&viewer_token))
                    .body(Body::from(
                        serde_json::json!({"work_id": allowed_work}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // The rejected add must never have been persisted -- listing items
        // back (as the same viewer, so no visibility filtering hides a
        // written-but-blocked row) shows only the one that succeeded.
        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                    .header("Authorization", bearer_header(&viewer_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let listed: Vec<PlaylistItemResponse> = json_body(response).await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].work_id, allowed_work);
    }

    /// Same enforcement as `list_items_omits_works_outside_the_callers_allowed_libraries`,
    /// but for `PUT /api/v1/playlists/{id}/items/order`: an admin can add an
    /// item to a user's own personal playlist on their behalf (bypassing
    /// the target user's `Policy::library_allow`, per this module's doc
    /// comment), so the owner's playlist can legitimately contain a work
    /// outside their own allow-list. Reordering that playlist is something
    /// the owner (not just the admin) can call, and its response echoes the
    /// full post-reorder item list -- that response must omit the
    /// out-of-library item exactly like the plain `GET` does, not leak its
    /// `work_id` just because the request happened to be a `PUT`.
    #[tokio::test]
    async fn reorder_response_omits_items_outside_the_callers_allowed_libraries() {
        use crate::test_support::{
            seed_media_file, seed_movie, seed_streaming_user_with_library_allow,
        };
        use streamarr_model::media::LeafRef;

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();
        let allowed_work = seed_movie(&state, "Reorder Allowed Movie").await;
        seed_media_file(&state, allowed_work, LeafRef::Work, allowed_instance).await;
        let other_work = seed_movie(&state, "Reorder Other Movie").await;
        seed_media_file(&state, other_work, LeafRef::Work, other_instance).await;

        // The owner's own `Policy::library_allow` only covers one of the
        // two source instances.
        let owner_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, owner_id, vec![allowed_instance]).await;
        let owner_token = mint_access_token(&state, owner_id);

        // Owner creates their own personal playlist.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&owner_token))
                    .body(Body::from(
                        serde_json::json!({"name": "Owner Watchlist"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let playlist: PlaylistResponse = json_body(response).await;

        // Admin adds both works on the owner's behalf -- admin's own
        // `allowed_libraries()` is unrestricted, so this succeeds even
        // though the owner could not have added `other_work` themselves.
        let mut items = Vec::new();
        for work_id in [allowed_work, other_work] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/api/v1/playlists/{}/items", playlist.id))
                        .header("content-type", "application/json")
                        .header("Authorization", bearer_header(&admin_token))
                        .body(Body::from(
                            serde_json::json!({"work_id": work_id}).to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            items.push(json_body::<PlaylistItemResponse>(response).await);
        }

        // Owner reorders their own playlist (reversing the two items).
        let response = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playlists/{}/items/order", playlist.id))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&owner_token))
                    .body(Body::from(
                        serde_json::json!({"item_ids": [items[1].id, items[0].id]}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let reordered: Vec<PlaylistItemResponse> = json_body(response).await;

        // The reorder response must be filtered exactly like `list_items`:
        // only the item inside the owner's own `Policy::library_allow`
        // comes back, and its `work_id` is never the out-of-library one.
        assert_eq!(reordered.len(), 1);
        assert_eq!(reordered[0].work_id, allowed_work);
        assert!(reordered.iter().all(|item| item.work_id != other_work));
    }

    #[tokio::test]
    async fn admin_list_sees_every_users_personal_playlists() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let owner_id = Uuid::new_v4();
        seed_streaming_user(&state, owner_id).await;
        let owner_token = mint_access_token(&state, owner_id);

        // A personal playlist, created by a plain streaming user -- not
        // visible to that user's own `GET /api/v1/playlists` from anyone
        // else, but should show up on the admin "view everything" list.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/playlists")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&owner_token))
                    .body(Body::from(
                        serde_json::json!({"name": "Personal"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let personal: PlaylistResponse = json_body(response).await;

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playlists")
                    .header("Authorization", bearer_header(&admin_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let all: Vec<PlaylistResponse> = json_body(response).await;
        assert!(all
            .iter()
            .any(|p| p.id == personal.id && p.owner_user_id == Some(owner_id)));
    }

    #[tokio::test]
    async fn admin_list_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playlists")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}
