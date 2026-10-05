//! Operator-managed group library and peer routing configuration.
//!
//! These endpoints are deliberately separate from the peer-sync routes:
//! administrators author group-scoped configuration locally, while the
//! existing peer sync service distributes the durable rows to group members.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use playarr_model::{DeliveryMode, GroupLibrary, RoutingRule};
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::AdminUser;
use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct GroupLibraryRequest {
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SourceGroupLibraryRequest {
    /// Set to null to remove the source instance's group mapping.
    pub group_library_id: Option<Uuid>,
}

/// The mapping response deliberately excludes the source instance's encrypted
/// credentials and other private configuration.
#[derive(Debug, serde::Serialize, ToSchema)]
pub struct SourceGroupLibraryResponse {
    pub source_instance_id: Uuid,
    pub group_library_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RoutingRuleRequest {
    #[serde(default)]
    pub group_library_id: Option<Uuid>,
    #[serde(default)]
    pub user_id: Option<Uuid>,
    pub priority: i32,
    pub preferred_nodes: Vec<Uuid>,
    pub delivery_mode: DeliveryMode,
}

async fn local_group_id(state: &AppState) -> Result<Uuid, ApiError> {
    let identity = state
        .node_identity_repo
        .get()
        .await?
        .ok_or_else(|| ApiError::conflict("this server has no peer identity"))?;
    let group_id = identity
        .group_id
        .ok_or_else(|| ApiError::conflict("this server has not joined a peer group"))?;
    if state.peer_group_repo.get(group_id).await?.is_none() {
        return Err(ApiError::conflict(
            "this server's peer group is unavailable",
        ));
    }
    Ok(group_id)
}

fn validate_name(name: &str) -> Result<(), ApiError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 100 {
        return Err(ApiError::bad_request(
            "name must contain between 1 and 100 characters",
        ));
    }
    Ok(())
}

async fn library_in_group(
    state: &AppState,
    group_id: Uuid,
    id: Uuid,
) -> Result<GroupLibrary, ApiError> {
    let library = state
        .group_library_repo
        .get(id)
        .await?
        .ok_or_else(|| ApiError::not_found("group library not found"))?;
    if library.group_id != group_id {
        return Err(ApiError::not_found("group library not found"));
    }
    Ok(library)
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/group-libraries",
    responses(
        (status = 200, description = "Group libraries for this server's peer group", body = [GroupLibrary]),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "Server has not joined a peer group")
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_group_libraries_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<GroupLibrary>>, ApiError> {
    let group_id = local_group_id(&state).await?;
    Ok(Json(
        state.group_library_repo.list_for_group(group_id).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/group-libraries",
    request_body = GroupLibraryRequest,
    responses(
        (status = 201, description = "Group library created", body = GroupLibrary),
        (status = 400, description = "Invalid library name"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "Server has not joined a peer group")
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_group_library_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(request): Json<GroupLibraryRequest>,
) -> Result<(StatusCode, Json<GroupLibrary>), ApiError> {
    validate_name(&request.name)?;
    let now = Utc::now();
    let library = GroupLibrary {
        id: Uuid::new_v4(),
        group_id: local_group_id(&state).await?,
        name: request.name.trim().to_owned(),
        created_at: now,
        updated_at: now,
    };
    state.group_library_repo.upsert(&library).await?;
    Ok((StatusCode::CREATED, Json(library)))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/group-libraries/{id}",
    params(("id" = Uuid, Path, description = "Group library ID")),
    request_body = GroupLibraryRequest,
    responses(
        (status = 200, description = "Group library renamed", body = GroupLibrary),
        (status = 400, description = "Invalid library name"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "Group library not found")
    ),
    security(("bearer_auth" = []))
)]
pub async fn rename_group_library_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(request): Json<GroupLibraryRequest>,
) -> Result<Json<GroupLibrary>, ApiError> {
    validate_name(&request.name)?;
    let group_id = local_group_id(&state).await?;
    let mut library = library_in_group(&state, group_id, id).await?;
    library.name = request.name.trim().to_owned();
    library.updated_at = Utc::now();
    state.group_library_repo.upsert(&library).await?;
    Ok(Json(library))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/source-instances/{id}/group-library",
    params(("id" = Uuid, Path, description = "Local source instance ID")),
    request_body = SourceGroupLibraryRequest,
    responses(
        (status = 200, description = "Source instance group-library mapping updated", body = SourceGroupLibraryResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "Source instance or group library not found")
    ),
    security(("bearer_auth" = []))
)]
pub async fn map_source_instance_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(request): Json<SourceGroupLibraryRequest>,
) -> Result<Json<SourceGroupLibraryResponse>, ApiError> {
    let group_id = local_group_id(&state).await?;
    if let Some(library_id) = request.group_library_id {
        library_in_group(&state, group_id, library_id).await?;
    }
    let mut instance = state
        .source_instance_repo
        .get(id)
        .await?
        .ok_or_else(|| ApiError::not_found("source instance not found"))?;
    instance.group_library_id = request.group_library_id;
    state.source_instance_repo.upsert(&instance).await?;
    state.source_instances.upsert(instance.clone());
    Ok(Json(SourceGroupLibraryResponse {
        source_instance_id: instance.id,
        group_library_id: instance.group_library_id,
    }))
}

async fn validate_routing_request(
    state: &AppState,
    group_id: Uuid,
    request: &RoutingRuleRequest,
) -> Result<(), ApiError> {
    if let Some(library_id) = request.group_library_id {
        library_in_group(state, group_id, library_id).await?;
    }
    if let Some(user_id) = request.user_id {
        if state.user_repo.find_by_id(user_id).await?.is_none() {
            return Err(ApiError::bad_request("routing rule user does not exist"));
        }
    }
    let mut unique_nodes = std::collections::HashSet::new();
    for peer_id in &request.preferred_nodes {
        if !unique_nodes.insert(*peer_id) {
            return Err(ApiError::bad_request(
                "preferred_nodes must not contain duplicate peer IDs",
            ));
        }
        state
            .peer_node_repo
            .get(*peer_id)
            .await?
            .filter(|peer| {
                peer.group_id == group_id && peer.status != playarr_model::PeerNodeStatus::Left
            })
            .ok_or_else(|| {
                ApiError::bad_request("preferred node is not a member of this peer group")
            })?;
    }
    Ok(())
}

fn routing_rule_from_request(
    id: Uuid,
    group_id: Uuid,
    request: RoutingRuleRequest,
    created_at: chrono::DateTime<Utc>,
) -> RoutingRule {
    let now = Utc::now();
    RoutingRule {
        id,
        group_id,
        group_library_id: request.group_library_id,
        user_id: request.user_id,
        priority: request.priority,
        preferred_nodes: request.preferred_nodes,
        delivery_mode: request.delivery_mode,
        created_at,
        updated_at: now,
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/routing-rules",
    responses(
        (status = 200, description = "Routing rules for this server's peer group", body = [RoutingRule]),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "Server has not joined a peer group")
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_routing_rules_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<RoutingRule>>, ApiError> {
    let group_id = local_group_id(&state).await?;
    Ok(Json(
        state.routing_rule_repo.list_for_group(group_id).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/routing-rules",
    request_body = RoutingRuleRequest,
    responses(
        (status = 201, description = "Routing rule created", body = RoutingRule),
        (status = 400, description = "Invalid group, user, or preferred peer"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "Group library not found"),
        (status = 409, description = "Server has not joined a peer group")
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_routing_rule_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(request): Json<RoutingRuleRequest>,
) -> Result<(StatusCode, Json<RoutingRule>), ApiError> {
    let group_id = local_group_id(&state).await?;
    validate_routing_request(&state, group_id, &request).await?;
    let rule = routing_rule_from_request(Uuid::new_v4(), group_id, request, Utc::now());
    state.routing_rule_repo.create(&rule).await?;
    Ok((StatusCode::CREATED, Json(rule)))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/routing-rules/{id}",
    params(("id" = Uuid, Path, description = "Routing rule ID")),
    request_body = RoutingRuleRequest,
    responses(
        (status = 200, description = "Routing rule updated", body = RoutingRule),
        (status = 400, description = "Invalid group, user, or preferred peer"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "Routing rule or group library not found")
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_routing_rule_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(request): Json<RoutingRuleRequest>,
) -> Result<Json<RoutingRule>, ApiError> {
    let group_id = local_group_id(&state).await?;
    validate_routing_request(&state, group_id, &request).await?;
    let previous = state
        .routing_rule_repo
        .get(id)
        .await?
        .filter(|rule| rule.group_id == group_id)
        .ok_or_else(|| ApiError::not_found("routing rule not found"))?;
    let rule = routing_rule_from_request(id, group_id, request, previous.created_at);
    state.routing_rule_repo.update(&rule).await?;
    Ok(Json(rule))
}
