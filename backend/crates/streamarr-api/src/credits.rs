//! Cast/crew for a catalog work, and the reverse lookup ("what has this
//! person been in") -- see `streamarr_model::person`'s module doc comment
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
use serde::{Deserialize, Serialize};
use streamarr_model::{Credit, CreditRole, Person, Work};
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
        (status = 200, description = "This work's cast and crew", body = WorkCreditsResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn work_credits_handler(
    State(state): State<AppState>,
    _viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkCreditsResponse>, ApiError> {
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
        (status = 200, description = "The person", body = PersonResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No person with this id")
    )
)]
pub async fn get_person_handler(
    State(state): State<AppState>,
    _viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<PersonResponse>, ApiError> {
    let person = state.credit_repo.get_person(id).await?;
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
        (status = 200, description = "Every work this person has a credit on", body = Vec<Work>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No person with this id")
    )
)]
pub async fn person_works_handler(
    State(state): State<AppState>,
    _viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<Work>>, ApiError> {
    // 404s if the person doesn't exist, rather than silently returning an
    // empty list -- distinguishes "no credits recorded yet" (200, empty)
    // from "this id was never a real person" (404).
    state.credit_repo.get_person(id).await?;

    let work_ids = state.credit_repo.list_work_ids_for_person(id).await?;
    let mut works = Vec::with_capacity(work_ids.len());
    for work_id in work_ids {
        match state.work_repo.get(work_id).await {
            Ok(work) => works.push(work),
            Err(streamarr_db::DbError::NotFound) => continue,
            Err(err) => return Err(err.into()),
        }
    }
    works.sort_by(|a, b| a.sort_title.cmp(&b.sort_title));
    Ok(Json(works))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_movie, seed_streaming_user, test_state,
    };
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
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
        seed_streaming_user(&state, user_id).await;
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
        seed_streaming_user(&state, user_id).await;
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
        seed_streaming_user(&state, user_id).await;
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
}
