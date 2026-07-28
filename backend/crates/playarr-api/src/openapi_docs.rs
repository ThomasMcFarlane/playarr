//! `GET /api/v1/openapi.json` -- the live OpenAPI spec, admin-gated.
//!
//! Reuses [`crate::openapi_spec`], the same `utoipa::openapi::OpenApi`
//! value `lib.rs`'s own regeneration/drift tests build
//! `backend/openapi/playarr.yaml` from, just serialized as JSON over HTTP
//! instead of written to a checked-in YAML file. Deliberately
//! [`AdminUser`]-gated rather than public: this document is the full
//! internal API surface (every route, every request/response shape), which
//! is useful for admin tooling (e.g. a Swagger UI page embedded in
//! Playarr Server Admin) but not something to hand to an unauthenticated -- or
//! merely logged-in, non-admin -- caller.

use axum::Json;

use crate::auth_extractor::AdminUser;
use crate::openapi_spec;

/// The live OpenAPI 3.x spec for this server, as JSON.
#[utoipa::path(
    get,
    path = "/api/v1/openapi.json",
    tag = "system",
    responses(
        (status = 200, description = "The live OpenAPI 3.x specification for this server"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn openapi_json_handler(_admin: AdminUser) -> Json<utoipa::openapi::OpenApi> {
    Json(openapi_spec())
}
