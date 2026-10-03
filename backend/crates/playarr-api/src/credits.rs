//! Cast/crew for a catalog work, and the reverse lookup ("what has this
//! person been in") -- see `playarr_model::person`'s module doc comment
//! for the data-source rationale (Radarr movies only; Sonarr/Lidarr/
//! Readarr works simply have no credits). [`CatalogViewer`]-gated, same as
//! every other catalog-reading endpoint in this crate.
//!
//! Routes:
//! - `GET /api/v1/catalog/{id}/credits` -- a work's cast + crew.
//! - `GET /api/v1/people/{id}` -- one person by id.
//! - `GET /api/v1/people/{id}/works` -- every work this person has a
//!   credit on.

use axum::extract::{Path, State};
use axum::Json;
use playarr_model::{Credit, CreditRole, Person, Work};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PersonResponse {
    pub id: Uuid,
    pub name: String,
    pub headshot_url: Option<String>,
}

impl From<Person> for PersonResponse {
    fn from(person: Person) -> Self {
        PersonResponse {
            id: person.id,
            name: person.name,
            headshot_url: person.headshot_url,
        }
    }
}

/// One credit, with its [`Person`] flattened in -- a caller displaying a
/// cast/crew list wants the name/headshot right there, not a second
/// round trip per credit.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreditResponse {
    pub id: Uuid,
    pub person: PersonResponse,
    /// The character played. Present only on a cast credit.
    pub character: Option<String>,
    /// Present only on a crew credit.
    pub department: Option<String>,
    /// Present only on a crew credit.
    pub job: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct WorkCreditsResponse {
    pub cast: Vec<CreditResponse>,
    pub crew: Vec<CreditResponse>,
}

async fn resolve_credit(state: &AppState, credit: Credit) -> Result<CreditResponse, ApiError> {
    let person = state.credit_repo.get_person(credit.person_id).await?;
    let (character, department, job) = match credit.role {
        CreditRole::Cast { character } => (Some(character), None, None),
        CreditRole::Crew { department, job } => (None, Some(department), Some(job)),
    };
    Ok(CreditResponse {
        id: credit.id,
        person: person.into(),
        character,
        department,
        job,
    })
}

/// A work's cast and crew, in the source's own billing/department order
/// -- empty (not 404) for a work with no credits, which is the normal
/// case for every non-Radarr-sourced work (see this module's doc
/// comment).
#[utoipa::path(
    get,
    path = "/api/v1/catalog/{id}/credits",
    tag = "credits",
    params(("id" = Uuid, Path, description = "Work id")),
    responses(
        (status = 200, description = "This work's cast and crew", body = WorkCreditsResponse, example = json!({
            "cast": [{
                "id": "7c3a9e21-4f8d-4b6a-9c1e-2d5f8a3b7c90",
                "person": {
                    "id": "1a2b3c4d-5e6f-4890-abcd-ef1234567890",
                    "name": "Sample Actor",
                    "headshot_url": "https://image.tmdb.org/t/p/original/qCpZn2e4ZTe8YHBaJcs4gEqvhX8.jpg"
                },
                "character": "Sample Character / Sample Vigilante",
                "department": null,
                "job": null
            }],
            "crew": [{
                "id": "8d4b1f32-5e9c-4a7b-8d2f-3e6a9c4b8d10",
                "person": {
                    "id": "2b3c4d5e-6f70-4901-bcde-f01234567891",
                    "name": "Sample Director",
                    "headshot_url": "https://image.tmdb.org/t/p/original/xuAIuYSmsUzKlUMBFGVZaWsY3DZ.jpg"
                },
                "character": null,
                "department": "Directing",
                "job": "Director"
            }]
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn work_credits_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkCreditsResponse>, ApiError> {
    // Same visibility gate `get_work_handler` applies -- 404s (not 403s)
    // for a work outside the caller's allowed libraries, indistinguishably
    // from a genuinely nonexistent one, before this endpoint leaks any
    // cast/crew detail for it.
    let allowed = viewer.allowed_libraries();
    let gate = state
        .household
        .gate_for(&viewer.policy, viewer.user_id)
        .await;
    state
        .catalog
        .get_by_id_with(
            id,
            crate::household::access(allowed.as_deref(), gate.as_deref()),
        )
        .await?;

    let credits = state.credit_repo.list_for_work(id).await?;
    let mut cast = Vec::new();
    let mut crew = Vec::new();
    for credit in credits {
        let is_cast = matches!(credit.role, CreditRole::Cast { .. });
        let resolved = resolve_credit(&state, credit).await?;
        if is_cast {
            cast.push(resolved);
        } else {
            crew.push(resolved);
        }
    }
    Ok(Json(WorkCreditsResponse { cast, crew }))
}

/// One person by id.
#[utoipa::path(
    get,
    path = "/api/v1/people/{id}",
    tag = "credits",
    params(("id" = Uuid, Path, description = "Person id")),
    responses(
        (status = 200, description = "The person", body = PersonResponse, example = json!({
            "id": "1a2b3c4d-5e6f-4890-abcd-ef1234567890",
            "name": "Sample Actor",
            "headshot_url": "https://image.tmdb.org/t/p/original/qCpZn2e4ZTe8YHBaJcs4gEqvhX8.jpg"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No person with this id")
    )
)]
pub async fn get_person_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<PersonResponse>, ApiError> {
    let person = state.credit_repo.get_person(id).await?;

    // A person is only exposed if at least one of their credited works is
    // visible to this caller -- otherwise their existence (and identity)
    // would leak through a library a restricted caller has no grant for.
    // 404, not 403, matching `get_work_handler`'s visibility-miss posture.
    let allowed = viewer.allowed_libraries();
    let gate = state
        .household
        .gate_for(&viewer.policy, viewer.user_id)
        .await;
    let visible_works =
        visible_works_for_person(&state, id, allowed.as_deref(), gate.as_deref()).await?;
    if visible_works.is_empty() {
        return Err(ApiError::not_found("person not found"));
    }

    Ok(Json(person.into()))
}

/// Every work this person has a credit on (cast or crew, any work kind),
/// title-sorted. A work id whose `Work` row has since been removed (e.g.
/// the source deleted the movie) is silently skipped rather than failing
/// the whole request.
#[utoipa::path(
    get,
    path = "/api/v1/people/{id}/works",
    tag = "credits",
    params(("id" = Uuid, Path, description = "Person id")),
    responses(
        (status = 200, description = "Every work this person has a credit on", body = Vec<Work>, example = json!([{
            "id": "6b1e4f83-2a9c-4d7e-8b3f-1c6a9e2d4b70",
            "kind": "movie",
            "external_refs": [{"provider": "tmdb", "external_id": "272"}],
            "title": "Sample Movie Hotel",
            "sort_title": "Sample Movie Hotel",
            "overview": "After training with his mentor, Sample Vigilante begins his fight to free crime-ridden Gotham City from corruption.",
            "images": [{
                "kind": "poster",
                "url": "https://image.tmdb.org/t/p/original/dr6x4GyyESClpG4RG3aSVSXVMlv.jpg",
                "width": 2000,
                "height": 3000
            }],
            "genres": ["Action", "Crime", "Drama"],
            "tags": [],
            "added_at": "2024-01-10T08:15:00Z",
            "release_date": "2005-06-15T00:00:00Z",
            "monitored": true,
            "availability": "available"
        }, {
            "id": "4c9e2a1b-7f3d-4e6a-9b2c-8d5f1e3a7c90",
            "kind": "movie",
            "external_refs": [{"provider": "tmdb", "external_id": "155"}],
            "title": "The Test Film",
            "sort_title": "Test Film, The",
            "overview": "Sample Vigilante raises the stakes in his war on crime with the help of Lt. Jim Gordon and District Attorney Harvey Dent.",
            "images": [{
                "kind": "poster",
                "url": "https://image.tmdb.org/t/p/original/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
                "width": 2000,
                "height": 3000
            }],
            "genres": ["Action", "Crime", "Drama"],
            "tags": [],
            "added_at": "2024-01-15T10:30:00Z",
            "release_date": "2008-07-16T00:00:00Z",
            "monitored": true,
            "availability": "available"
        }])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No person with this id")
    )
)]
pub async fn person_works_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<Work>>, ApiError> {
    state.credit_repo.get_person(id).await?;

    // Same visibility gate as `get_person_handler`: 404, not 200 with an
    // empty array, when every one of this person's credited works lies
    // outside the caller's `library_allow` -- otherwise a restricted
    // caller could tell "person exists, credited only on a library I
    // can't see" (200, []) apart from "this id was never a real person"
    // (404), the exact existence oracle `get_person_handler` is written
    // to prevent.
    let allowed = viewer.allowed_libraries();
    let gate = state
        .household
        .gate_for(&viewer.policy, viewer.user_id)
        .await;
    let mut works =
        visible_works_for_person(&state, id, allowed.as_deref(), gate.as_deref()).await?;
    if works.is_empty() {
        return Err(ApiError::not_found("person not found"));
    }
    works.sort_by(|a, b| a.sort_title.cmp(&b.sort_title));
    Ok(Json(works))
}

/// Every [`Work`] `person_id` has a credit on that both still exists (a
/// work id whose row was since removed, e.g. the source deleted the movie,
/// is silently skipped) and is visible under `allowed` -- the same
/// allow-list semantics as `playarr_catalog::CatalogService::
/// is_work_visible`, applied per-work since this list can span multiple
/// source instances. Shared by [`person_works_handler`] (the full filtered
/// list) and [`get_person_handler`] (existence-of-at-least-one gate) so
/// both apply identical visibility rules.
async fn visible_works_for_person(
    state: &AppState,
    person_id: Uuid,
    allowed: Option<&[Uuid]>,
    gate: Option<&crate::household::HouseholdGate>,
) -> Result<Vec<Work>, ApiError> {
    let work_ids = state
        .credit_repo
        .list_work_ids_for_person(person_id)
        .await?;
    let mut works = Vec::with_capacity(work_ids.len());
    for work_id in work_ids {
        let work = match state.work_repo.get(work_id).await {
            Ok(work) => work,
            Err(playarr_db::DbError::NotFound) => continue,
            Err(err) => return Err(err.into()),
        };
        if state
            .catalog
            .is_work_visible_with(work.id, crate::household::access(allowed, gate))
            .await?
        {
            works.push(work);
        }
    }
    Ok(works)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_media_file, seed_movie,
        seed_streaming_user, seed_streaming_user_with_library_allow, test_state,
    };
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use playarr_model::media::LeafRef;
    use tower::ServiceExt;

    async fn json_body<T: serde::de::DeserializeOwned>(response: axum::response::Response) -> T {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    async fn seed_credit(
        state: &crate::test_support::TestState,
        work_id: Uuid,
        person_name: &str,
        role: CreditRole,
        order: i32,
    ) -> Uuid {
        let person = Person {
            id: Uuid::new_v4(),
            name: person_name.to_string(),
            tmdb_id: Some(rand_tmdb_id()),
            headshot_url: Some("https://image.tmdb.org/t/p/original/headshot.jpg".to_string()),
        };
        state.app.credit_repo.upsert_person(&person).await.unwrap();
        let existing = state.app.credit_repo.list_for_work(work_id).await.unwrap();
        let mut credits = existing;
        credits.push(Credit {
            id: Uuid::new_v4(),
            work_id,
            person_id: person.id,
            role,
            order,
        });
        state
            .app
            .credit_repo
            .replace_credits_for_work(work_id, &credits)
            .await
            .unwrap();
        person.id
    }

    // A real tmdb_id isn't required to be globally unique across test
    // runs (each test gets a fresh in-memory db), just unique within one
    // test's own seeded people.
    fn rand_tmdb_id() -> i64 {
        use std::sync::atomic::{AtomicI64, Ordering};
        static NEXT: AtomicI64 = AtomicI64::new(1);
        NEXT.fetch_add(1, Ordering::Relaxed)
    }

    #[tokio::test]
    async fn work_credits_splits_cast_and_crew() {
        let (router, state) = test_state().await;
        let movie_id = seed_movie(&state, "10 Brambleford Lane").await;
        seed_credit(
            &state,
            movie_id,
            "Mary Elizabeth Winstead",
            CreditRole::Cast {
                character: "Michelle".to_string(),
            },
            1,
        )
        .await;
        seed_credit(
            &state,
            movie_id,
            "Dan Trachtenberg",
            CreditRole::Crew {
                department: "Directing".to_string(),
                job: "Director".to_string(),
            },
            0,
        )
        .await;

        let user_id = Uuid::new_v4();
        // Admin, not a plain streaming user, so this test exercises credit
        // resolution rather than tripping the (empty-by-default, deny-all)
        // `library_allow` visibility gate -- that gate has its own
        // dedicated tests below.
        seed_admin_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{movie_id}/credits"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: WorkCreditsResponse = json_body(response).await;
        assert_eq!(body.cast.len(), 1);
        assert_eq!(body.cast[0].person.name, "Mary Elizabeth Winstead");
        assert_eq!(body.cast[0].character.as_deref(), Some("Michelle"));
        assert_eq!(body.crew.len(), 1);
        assert_eq!(body.crew[0].person.name, "Dan Trachtenberg");
        assert_eq!(body.crew[0].department.as_deref(), Some("Directing"));
        assert_eq!(body.crew[0].job.as_deref(), Some("Director"));
    }

    #[tokio::test]
    async fn work_credits_is_empty_for_a_work_with_none() {
        let (router, state) = test_state().await;
        let movie_id = seed_movie(&state, "No Credits Yet").await;
        let user_id = Uuid::new_v4();
        seed_admin_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{movie_id}/credits"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: WorkCreditsResponse = json_body(response).await;
        assert!(body.cast.is_empty());
        assert!(body.crew.is_empty());
    }

    #[tokio::test]
    async fn person_works_finds_every_credited_work() {
        let (router, state) = test_state().await;
        let movie_a = seed_movie(&state, "Movie A").await;
        let movie_b = seed_movie(&state, "Movie B").await;
        let unrelated_movie = seed_movie(&state, "Unrelated Movie").await;

        let person_id = seed_credit(
            &state,
            movie_a,
            "Prolific Actor",
            CreditRole::Cast {
                character: "Role A".to_string(),
            },
            0,
        )
        .await;
        // Same person (by re-adding a credit on a second work with the
        // repo directly, reusing the id `seed_credit` just minted).
        state
            .app
            .credit_repo
            .replace_credits_for_work(
                movie_b,
                &[Credit {
                    id: Uuid::new_v4(),
                    work_id: movie_b,
                    person_id,
                    role: CreditRole::Cast {
                        character: "Role B".to_string(),
                    },
                    order: 0,
                }],
            )
            .await
            .unwrap();
        let _ = unrelated_movie;

        let user_id = Uuid::new_v4();
        // Admin, not a plain streaming user -- see the comment on
        // `work_credits_splits_cast_and_crew` above for why.
        seed_admin_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/people/{person_id}/works"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let works: Vec<Work> = json_body(response).await;
        let titles: Vec<&str> = works.iter().map(|w| w.title.as_str()).collect();
        assert_eq!(titles.len(), 2);
        assert!(titles.contains(&"Movie A"));
        assert!(titles.contains(&"Movie B"));
        assert!(!titles.contains(&"Unrelated Movie"));

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/people/{person_id}"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let person: PersonResponse = json_body(response).await;
        assert_eq!(person.name, "Prolific Actor");
    }

    #[tokio::test]
    async fn get_person_missing_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/people/{}", Uuid::new_v4()))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn credits_without_token_is_unauthorized() {
        let (router, state) = test_state().await;
        let movie_id = seed_movie(&state, "Gated Movie").await;

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{movie_id}/credits"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    /// A work outside the caller's `library_allow` 404s on `GET
    /// /api/v1/catalog/{id}/credits`, indistinguishably from a nonexistent
    /// work id -- same posture as `catalog::get_work_outside_allowed_
    /// libraries_is_404`, proving this endpoint doesn't leak cast/crew for
    /// a work the caller has no library grant for.
    #[tokio::test]
    async fn work_credits_outside_allowed_libraries_is_404() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let other_movie = seed_movie(&state, "Other Library Movie").await;
        seed_media_file(&state, other_movie, LeafRef::Work, other_instance).await;
        seed_credit(
            &state,
            other_movie,
            "Hidden Actor",
            CreditRole::Cast {
                character: "Someone".to_string(),
            },
            0,
        )
        .await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{other_movie}/credits"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// `GET /api/v1/people/{id}/works` filters out a work outside the
    /// caller's `library_allow` while still returning one that's allowed --
    /// a person credited on both an in-library and an out-of-library work
    /// must not leak the latter's existence to a restricted caller.
    #[tokio::test]
    async fn person_works_filters_out_works_outside_allowed_libraries() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let allowed_movie = seed_movie(&state, "Allowed Movie").await;
        seed_media_file(&state, allowed_movie, LeafRef::Work, allowed_instance).await;
        let other_movie = seed_movie(&state, "Other Movie").await;
        seed_media_file(&state, other_movie, LeafRef::Work, other_instance).await;

        let person_id = seed_credit(
            &state,
            allowed_movie,
            "Cross-Library Actor",
            CreditRole::Cast {
                character: "Role A".to_string(),
            },
            0,
        )
        .await;
        state
            .app
            .credit_repo
            .replace_credits_for_work(
                other_movie,
                &[Credit {
                    id: Uuid::new_v4(),
                    work_id: other_movie,
                    person_id,
                    role: CreditRole::Cast {
                        character: "Role B".to_string(),
                    },
                    order: 0,
                }],
            )
            .await
            .unwrap();

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/people/{person_id}/works"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let works: Vec<Work> = json_body(response).await;
        let titles: Vec<&str> = works.iter().map(|w| w.title.as_str()).collect();
        assert_eq!(titles, vec!["Allowed Movie"]);
    }

    /// `GET /api/v1/people/{id}` 404s for a person whose only credited
    /// work lies outside the caller's `library_allow` -- the person's
    /// existence must not be inferable through a library the caller has no
    /// grant for, matching `get_work_handler`'s 404-not-403 posture.
    #[tokio::test]
    async fn get_person_with_no_visible_credited_work_is_404() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let other_movie = seed_movie(&state, "Only Other Movie").await;
        seed_media_file(&state, other_movie, LeafRef::Work, other_instance).await;
        let person_id = seed_credit(
            &state,
            other_movie,
            "Fully Hidden Actor",
            CreditRole::Cast {
                character: "Role".to_string(),
            },
            0,
        )
        .await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/people/{person_id}"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// `GET /api/v1/people/{id}/works` 404s for a person whose only
    /// credited work lies outside the caller's `library_allow`, mirroring
    /// `get_person_with_no_visible_credited_work_is_404` -- a 200 with an
    /// empty array would let a restricted caller distinguish "this person
    /// exists, just not visible to me" from "this id was never a real
    /// person", the existence oracle both endpoints must close identically.
    #[tokio::test]
    async fn person_works_with_no_visible_credited_work_is_404() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let other_movie = seed_movie(&state, "Only Other Movie").await;
        seed_media_file(&state, other_movie, LeafRef::Work, other_instance).await;
        let person_id = seed_credit(
            &state,
            other_movie,
            "Fully Hidden Actor",
            CreditRole::Cast {
                character: "Role".to_string(),
            },
            0,
        )
        .await;

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/people/{person_id}/works"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
