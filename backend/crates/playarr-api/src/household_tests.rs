//! Bypass-resistance suite for household and child controls (TASKS 57,
//! `docs/architecture/household-controls.md`). Each test attacks a control
//! the way a child (or a modified client) would -- direct API calls, reused
//! tokens, capability media URLs, another profile's PIN -- and asserts the
//! server, not the client, refuses.

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use chrono::{DateTime, Duration, TimeZone, Utc};
use playarr_model::media::LeafRef;
use playarr_model::{
    AccessWindow, ApprovalKind, ClientPlatform, MediaFile, PlayMethod, PlaybackSession, TimeRange,
    UnratedContent, Weekday,
};
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;

use crate::test_support::{
    bearer_header, mint_access_token, seed_admin_user, seed_movie_with_tags, seed_policy_user,
    seed_streaming_user, test_state, TestState,
};

/// A Saturday, so `Weekday::Saturday` windows apply.
fn saturday_noon() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 3, 12, 0, 0).unwrap()
}

async fn call(
    router: &Router,
    token: Option<&str>,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header("Authorization", bearer_header(token));
    }
    let request = match body {
        Some(body) => builder
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

async fn get(router: &Router, token: &str, uri: &str) -> (StatusCode, Value) {
    call(router, Some(token), Method::GET, uri, None).await
}

async fn post(router: &Router, token: &str, uri: &str, body: Value) -> (StatusCode, Value) {
    call(router, Some(token), Method::POST, uri, Some(body)).await
}

/// A media file with real bytes on disk, owned by `work_id` and visible in
/// both the repository (catalog) and the in-memory lookup (media routes).
async fn seed_playable(state: &TestState, work_id: Uuid, instance: Uuid) -> MediaFile {
    let path = std::env::temp_dir().join(format!("playarr-household-test-{}.mp4", Uuid::new_v4()));
    std::fs::write(&path, b"0123456789abcdefghij").unwrap();
    let file = MediaFile {
        id: Uuid::new_v4(),
        work_id,
        leaf_ref: LeafRef::Work,
        path,
        container: "mp4".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(4_000_000),
        duration_ms: Some(60_000),
        size_bytes: 20,
        source_instance_id: instance,
        source_file_id: Some(Uuid::new_v4().to_string()),
    };
    state.media_file_repo.create(&file).await.unwrap();
    state.media_files.insert(file.clone());
    file
}

fn session_for(user_id: Uuid, media_file_id: Uuid) -> PlaybackSession {
    PlaybackSession {
        id: Uuid::new_v4(),
        user_id,
        device_id: Uuid::new_v4(),
        media_file_id,
        rendition_id: None,
        started_at: Utc::now(),
        ended_at: None,
        play_method: PlayMethod::DirectPlay,
        transcode_reason: None,
        source_codec: "h264".to_string(),
        source_container: "mp4".to_string(),
        source_bitrate: Some(4_000_000),
        target_codec: "h264".to_string(),
        target_container: "mp4".to_string(),
        target_bitrate: Some(4_000_000),
        client_platform: ClientPlatform::Web,
        client_version: "test".to_string(),
        ip_address: None,
        bytes_streamed: 0,
        buffering_events: 0,
        buffering_ms_total: 0,
        stop_reason: None,
    }
}

fn saturday_window(start: u16, end: u16) -> AccessWindow {
    AccessWindow {
        weekday: Weekday::Saturday,
        time_range: TimeRange {
            start_minute_of_day: start,
            end_minute_of_day: end,
        },
    }
}

fn hash(pin: &str) -> String {
    playarr_auth::login::hash_password(pin)
}

async fn set_pin(state: &TestState, user: Uuid, pin: &str) {
    state
        .app
        .profile_pin_repo
        .upsert_hash(user, &hash(pin))
        .await
        .unwrap();
}

async fn update_policy(state: &TestState, user: Uuid, f: impl FnOnce(&mut playarr_model::Policy)) {
    let record = state.user_repo.find_by_id(user).await.unwrap().unwrap();
    let mut policy = state
        .policy_repo
        .find_by_id(record.policy_id)
        .await
        .unwrap()
        .unwrap();
    f(&mut policy);
    state.policy_repo.upsert(&policy).await.unwrap();
}

fn ids(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["id"].as_str().unwrap().to_string())
        .collect()
}

// ---------------------------------------------------------------------
// Content rating
// ---------------------------------------------------------------------

#[tokio::test]
async fn rating_ceiling_blocks_every_read_path_for_a_child_but_not_an_admin() {
    let (router, state) = test_state().await;
    state.clock.set(saturday_noon());
    let instance = Uuid::new_v4();
    let family = seed_movie_with_tags(&state, "Movie Family", &["rating:PG"]).await;
    let adult = seed_movie_with_tags(&state, "Movie Adult", &["rating:R"]).await;
    let unrated = seed_movie_with_tags(&state, "Movie Unrated", &[]).await;
    let family_file = seed_playable(&state, family, instance).await;
    let adult_file = seed_playable(&state, adult, instance).await;
    let unrated_file = seed_playable(&state, unrated, instance).await;

    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| {
        p.library_allow = vec![instance];
        p.max_rating = Some("PG".into());
    })
    .await;
    let token = mint_access_token(&state, child);

    // Browse and search only list what the ceiling allows.
    let (status, page) = get(&router, &token, "/api/v1/catalog?limit=50").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ids(&page), vec![family.to_string()]);
    assert_eq!(page["total"], 1);
    let (_, found) = get(&router, &token, "/api/v1/catalog/search?q=Movie").await;
    assert_eq!(
        found["items"].as_array().unwrap().len(),
        1,
        "search leaked a blocked title: {found}"
    );

    // Detail 404s exactly like a title that does not exist.
    assert_eq!(
        get(&router, &token, &format!("/api/v1/catalog/{family}"))
            .await
            .0,
        StatusCode::OK
    );
    for blocked in [adult, unrated] {
        assert_eq!(
            get(&router, &token, &format!("/api/v1/catalog/{blocked}"))
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        // Credits and artwork hang off the same visibility gate.
        assert_eq!(
            get(
                &router,
                &token,
                &format!("/api/v1/catalog/{blocked}/credits")
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get(
                &router,
                &token,
                &format!("/api/v1/artwork/work/{blocked}/poster")
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        get(&router, &token, &format!("/api/v1/catalog/{unrated}"))
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    // Bytes: direct stream, progress and downloads by media-file id.
    assert_eq!(
        get(
            &router,
            &token,
            &format!("/api/v1/media/{}/stream", family_file.id)
        )
        .await
        .0,
        StatusCode::OK
    );
    for file in [&adult_file, &unrated_file] {
        let (status, body) = get(
            &router,
            &token,
            &format!("/api/v1/media/{}/stream", file.id),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(body["error"], "household_blocked");
        assert_eq!(
            get(
                &router,
                &token,
                &format!("/api/v1/playback/{}/progress", file.id)
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        let (status, _) = post(
            &router,
            &token,
            "/api/v1/downloads",
            json!({"media_file_id": file.id, "quality_id": "original"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        for path in [
            "chapters",
            "metadata",
            "playback-options",
            "download-options",
        ] {
            assert_eq!(
                get(
                    &router,
                    &token,
                    &format!("/api/v1/media/{}/{path}", file.id)
                )
                .await
                .0,
                StatusCode::FORBIDDEN,
                "{path} leaked a blocked file"
            );
        }
    }
    let (status, body) = get(
        &router,
        &token,
        &format!("/api/v1/media/{}/stream", adult_file.id),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["details"]["reason"], "rating_too_high");

    // An unrated title becomes visible when the household allows unrated.
    update_policy(&state, child, |p| {
        p.household.unrated = UnratedContent::Allow;
    })
    .await;
    let (_, page) = get(&router, &token, "/api/v1/catalog?limit=50").await;
    assert_eq!(page["total"], 2);

    // Admins are never gated.
    let admin = Uuid::new_v4();
    seed_admin_user(&state, admin).await;
    let admin_token = mint_access_token(&state, admin);
    let (_, page) = get(&router, &admin_token, "/api/v1/catalog?limit=50").await;
    assert_eq!(page["total"], 3);
}

#[tokio::test]
async fn discovery_search_and_resolve_do_not_leak_blocked_titles() {
    let (router, state) = test_state().await;
    let instance = Uuid::new_v4();
    let family = seed_movie_with_tags(&state, "Zebra Family", &["rating:G"]).await;
    let adult = seed_movie_with_tags(&state, "Zebra Adult", &["rating:R"]).await;
    seed_playable(&state, family, instance).await;
    seed_playable(&state, adult, instance).await;
    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| {
        p.library_allow = vec![instance];
        p.max_rating = Some("PG".into());
    })
    .await;
    let token = mint_access_token(&state, child);
    let (status, body) = get(&router, &token, "/api/v1/discover?q=Zebra").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let text = body.to_string();
    assert!(text.contains("Zebra Family"), "{text}");
    assert!(
        !text.contains("Zebra Adult"),
        "discovery leaked a blocked title: {text}"
    );

    // Resolving a snapshot of the blocked title does not link it to the
    // library entry, so no library work id, resume or play action leaks.
    let (status, resolved) = post(
        &router,
        &token,
        "/api/v1/discover/resolve",
        json!({"kind": "movie", "title": "Zebra Adult", "work_id": adult}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{resolved}");
    assert!(
        !resolved.to_string().contains(&adult.to_string()),
        "resolve exposed the blocked library work: {resolved}"
    );
}

#[tokio::test]
async fn admin_rating_override_and_blocked_tags_apply() {
    let (router, state) = test_state().await;
    let instance = Uuid::new_v4();
    let downgraded =
        seed_movie_with_tags(&state, "Movie Down", &["rating:R", "rating-override:G"]).await;
    let upgraded =
        seed_movie_with_tags(&state, "Movie Up", &["rating:G", "rating-override:NC-17"]).await;
    let spoilery = seed_movie_with_tags(&state, "Movie Tagged", &["rating:G", "horror"]).await;
    for work in [downgraded, upgraded, spoilery] {
        seed_playable(&state, work, instance).await;
    }
    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| {
        p.library_allow = vec![instance];
        p.max_rating = Some("PG".into());
        p.blocked_tags = vec!["Horror".into()];
    })
    .await;
    let token = mint_access_token(&state, child);
    let (_, page) = get(&router, &token, "/api/v1/catalog?limit=50").await;
    assert_eq!(ids(&page), vec![downgraded.to_string()]);
}

// ---------------------------------------------------------------------
// Tokens, sessions and direct media URLs
// ---------------------------------------------------------------------

#[tokio::test]
async fn a_reused_access_token_cannot_outlive_a_policy_change() {
    let (router, state) = test_state().await;
    state.clock.set(saturday_noon());
    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| p.library_allow = vec![Uuid::new_v4()]).await;
    let token = mint_access_token(&state, child);
    assert_eq!(
        get(&router, &token, "/api/v1/catalog").await.0,
        StatusCode::OK
    );

    // A guardian locks the profile out; the very same token is refused.
    update_policy(&state, child, |p| p.access_schedule = Some(vec![])).await;
    let (status, body) = get(&router, &token, "/api/v1/catalog").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "household_blocked");
    assert_eq!(body["details"]["reason"], "outside_schedule");

    // Streaming revoked entirely: same token, still refused.
    update_policy(&state, child, |p| {
        p.access_schedule = None;
        p.can_stream = false;
    })
    .await;
    assert_eq!(
        get(&router, &token, "/api/v1/catalog").await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn capability_media_urls_are_reauthorised_on_every_request() {
    let (router, state) = test_state().await;
    state.clock.set(saturday_noon());
    let instance = Uuid::new_v4();
    let work = seed_movie_with_tags(&state, "Movie Cap", &["rating:G"]).await;
    let file = seed_playable(&state, work, instance).await;
    let adult = seed_movie_with_tags(&state, "Movie Cap Adult", &["rating:R"]).await;
    let adult_file = seed_playable(&state, adult, instance).await;

    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| {
        p.library_allow = vec![instance];
        p.max_rating = Some("PG".into());
    })
    .await;

    let session = session_for(child, file.id);
    let url = format!(
        "/api/v1/media/{}/stream?playback_session_id={}",
        file.id, session.id
    );
    state.app.session_registry.insert(session.clone());
    assert_eq!(
        call(&router, None, Method::GET, &url, None).await.0,
        StatusCode::OK
    );

    // A session minted before the rating was tightened (or for a title the
    // child should never have negotiated) cannot be used to read the bytes.
    let adult_session = session_for(child, adult_file.id);
    state.app.session_registry.insert(adult_session.clone());
    let adult_url = format!(
        "/api/v1/media/{}/stream?playback_session_id={}",
        adult_file.id, adult_session.id
    );
    let (status, body) = call(&router, None, Method::GET, &adult_url, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "household_blocked");

    // A session id for one file does not open another.
    let cross = format!(
        "/api/v1/media/{}/stream?playback_session_id={}",
        adult_file.id, session.id
    );
    assert_eq!(
        call(&router, None, Method::GET, &cross, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    // An invented id opens nothing.
    let invented = format!(
        "/api/v1/media/{}/stream?playback_session_id={}",
        file.id,
        Uuid::new_v4()
    );
    assert_eq!(
        call(&router, None, Method::GET, &invented, None).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Locking the profile out kills the already-issued capability URL.
    update_policy(&state, child, |p| p.access_schedule = Some(vec![])).await;
    let (status, body) = call(&router, None, Method::GET, &url, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["details"]["reason"], "outside_schedule");
    // And streaming revoked kills it too.
    update_policy(&state, child, |p| {
        p.access_schedule = None;
        p.can_stream = false;
    })
    .await;
    assert_eq!(
        call(&router, None, Method::GET, &url, None).await.0,
        StatusCode::FORBIDDEN
    );
}

// ---------------------------------------------------------------------
// Schedule, timezone and budget
// ---------------------------------------------------------------------

#[tokio::test]
async fn schedule_follows_the_server_clock_in_the_profiles_time_zone() {
    let (router, state) = test_state().await;
    let child = Uuid::new_v4();
    // Saturday 08:00-20:00 London time (BST, UTC+1, on this date).
    seed_policy_user(&state, child, |p| {
        p.library_allow = vec![Uuid::new_v4()];
        p.access_schedule = Some(vec![saturday_window(8 * 60, 20 * 60)]);
        p.household.timezone = Some("Europe/London".into());
    })
    .await;
    let token = mint_access_token(&state, child);

    state
        .clock
        .set(Utc.with_ymd_and_hms(2026, 10, 3, 6, 59, 0).unwrap());
    let (status, body) = get(&router, &token, "/api/v1/catalog").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "07:59 BST is before opening");
    assert_eq!(body["details"]["next_start_at"], "2026-10-03T07:00:00Z");

    state
        .clock
        .set(Utc.with_ymd_and_hms(2026, 10, 3, 7, 0, 0).unwrap());
    assert_eq!(
        get(&router, &token, "/api/v1/catalog").await.0,
        StatusCode::OK
    );

    // End of the window is exclusive.
    state
        .clock
        .set(Utc.with_ymd_and_hms(2026, 10, 3, 19, 0, 0).unwrap());
    assert_eq!(
        get(&router, &token, "/api/v1/catalog").await.0,
        StatusCode::FORBIDDEN
    );

    // Changing the profile's zone changes the decision; nothing the client
    // sends does (a forged Date/zone header is ignored).
    update_policy(&state, child, |p| {
        p.household.timezone = Some("Asia/Tokyo".into());
    })
    .await;
    state
        .clock
        .set(Utc.with_ymd_and_hms(2026, 10, 3, 6, 59, 0).unwrap());
    let request = Request::builder()
        .uri("/api/v1/catalog")
        .header("Authorization", bearer_header(&token))
        .header("Date", "Sat, 03 Oct 2026 23:00:00 GMT")
        .header("X-Timezone", "Pacific/Kiritimati")
        .body(Body::empty())
        .unwrap();
    // 06:59Z is 15:59 in Tokyo: inside the window.
    assert_eq!(
        router.clone().oneshot(request).await.unwrap().status(),
        StatusCode::OK
    );
    state
        .clock
        .set(Utc.with_ymd_and_hms(2026, 10, 3, 11, 0, 0).unwrap());
    // 20:00 in Tokyo: closed.
    assert_eq!(
        get(&router, &token, "/api/v1/catalog").await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn playback_crossing_the_schedule_boundary_stops_at_the_next_request() {
    let (router, state) = test_state().await;
    let instance = Uuid::new_v4();
    let work = seed_movie_with_tags(&state, "Movie Bedtime", &["rating:G"]).await;
    let file = seed_playable(&state, work, instance).await;
    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| {
        p.library_allow = vec![instance];
        p.access_schedule = Some(vec![saturday_window(8 * 60, 20 * 60)]);
    })
    .await;
    let session = session_for(child, file.id);
    state.app.session_registry.insert(session.clone());
    let url = format!(
        "/api/v1/media/{}/stream?playback_session_id={}",
        file.id, session.id
    );

    state
        .clock
        .set(Utc.with_ymd_and_hms(2026, 10, 3, 19, 58, 0).unwrap());
    assert_eq!(
        call(&router, None, Method::GET, &url, None).await.0,
        StatusCode::OK
    );
    state.clock.advance(Duration::minutes(1));
    assert_eq!(
        call(&router, None, Method::GET, &url, None).await.0,
        StatusCode::OK
    );
    state.clock.advance(Duration::minutes(1));
    let (status, body) = call(&router, None, Method::GET, &url, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["details"]["reason"], "outside_schedule");
}

#[tokio::test]
async fn daily_budget_is_counted_by_the_server_and_resets_next_local_day() {
    let (router, state) = test_state().await;
    state.clock.set(saturday_noon());
    let instance = Uuid::new_v4();
    let work = seed_movie_with_tags(&state, "Movie Budget", &["rating:G"]).await;
    let file = seed_playable(&state, work, instance).await;
    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| {
        p.library_allow = vec![instance];
        p.household.daily_budget_minutes = Some(1);
    })
    .await;
    let token = mint_access_token(&state, child);
    let stream = format!("/api/v1/media/{}/stream", file.id);

    // Each served request 25 s apart is charged for the gap (capped at 30 s),
    // regardless of anything the client reports. One minute runs out.
    let mut served = 0;
    let mut blocked_body = Value::Null;
    for _ in 0..10 {
        let (status, body) = get(&router, &token, &stream).await;
        if status == StatusCode::OK {
            served += 1;
            state.clock.advance(Duration::seconds(25));
        } else {
            assert_eq!(status, StatusCode::FORBIDDEN);
            blocked_body = body;
            break;
        }
    }
    assert!((2..=5).contains(&served), "served {served} requests");
    assert_eq!(blocked_body["error"], "household_blocked");
    assert_eq!(blocked_body["details"]["reason"], "budget_exhausted");
    assert_eq!(
        get(&router, &token, "/api/v1/catalog").await.0,
        StatusCode::FORBIDDEN,
        "browsing is also closed once the budget is spent"
    );

    // The status route stays reachable and explains the state.
    let (status, state_body) = get(&router, &token, "/api/v1/household/status").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(state_body["state"], "budget_exhausted");
    assert_eq!(state_body["remaining_seconds"], 0);

    // Next local day: counter starts again.
    state.clock.advance(Duration::hours(13));
    assert_eq!(get(&router, &token, &stream).await.0, StatusCode::OK);
}

#[tokio::test]
async fn status_endpoint_reports_remaining_time_without_trusting_the_client() {
    let (router, state) = test_state().await;
    state.clock.set(saturday_noon());
    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| {
        p.max_rating = Some("PG".into());
        p.household.daily_budget_minutes = Some(30);
        p.access_schedule = Some(vec![saturday_window(8 * 60, 18 * 60)]);
    })
    .await;
    let token = mint_access_token(&state, child);
    let (status, body) = get(&router, &token, "/api/v1/household/status").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["restricted"], true);
    assert_eq!(body["state"], "allowed");
    assert_eq!(body["remaining_seconds"], 1800);
    assert_eq!(body["window_ends_at"], "2026-10-03T18:00:00Z");
    assert_eq!(body["max_rating"], "PG");
    assert!(body["offline_valid_until"].as_str().unwrap() > body["server_time"].as_str().unwrap());

    // Unrestricted profile.
    let adult = Uuid::new_v4();
    seed_streaming_user(&state, adult).await;
    let token = mint_access_token(&state, adult);
    let (_, body) = get(&router, &token, "/api/v1/household/status").await;
    assert_eq!(body["restricted"], false);
    assert_eq!(body["state"], "unrestricted");
}

// ---------------------------------------------------------------------
// Guardians, approvals and PIN-protected switching
// ---------------------------------------------------------------------

struct Household {
    router: Router,
    state: TestState,
    child: Uuid,
    guardian: Uuid,
    child_token: String,
    guardian_token: String,
    instance: Uuid,
}

async fn household() -> Household {
    let (router, state) = test_state().await;
    state.clock.set(saturday_noon());
    let instance = Uuid::new_v4();
    let guardian = Uuid::new_v4();
    seed_policy_user(&state, guardian, |p| p.library_allow = vec![instance]).await;
    set_pin(&state, guardian, "2468").await;
    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |p| {
        p.library_allow = vec![instance];
        p.max_rating = Some("PG".into());
        p.household.guardian_user_ids = vec![guardian];
        p.access_schedule = Some(vec![]);
    })
    .await;
    let child_token = mint_access_token(&state, child);
    let guardian_token = mint_access_token(&state, guardian);
    Household {
        router,
        state,
        child,
        guardian,
        child_token,
        guardian_token,
        instance,
    }
}

#[tokio::test]
async fn a_child_cannot_approve_its_own_request_or_anyone_elses() {
    let h = household().await;
    let (status, created) = post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "time", "subject": "schedule"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let id = created["id"].as_str().unwrap();
    let decide = format!("/api/v1/household/approvals/{id}/decision");

    // Self-approval, with or without the guardian's PIN in hand.
    for body in [
        json!({"approve": true}),
        json!({"approve": true, "pin": "2468"}),
    ] {
        let (status, _) = post(&h.router, &h.child_token, &decide, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    // A sibling who is not a guardian cannot either.
    let sibling = Uuid::new_v4();
    seed_policy_user(&h.state, sibling, |p| p.library_allow = vec![h.instance]).await;
    set_pin(&h.state, sibling, "1357").await;
    let sibling_token = mint_access_token(&h.state, sibling);
    let (status, _) = post(
        &h.router,
        &sibling_token,
        &decide,
        json!({"approve": true, "pin": "1357"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Nothing was granted: still locked out.
    assert_eq!(
        get(&h.router, &h.child_token, "/api/v1/catalog").await.0,
        StatusCode::FORBIDDEN
    );
    // The sibling cannot even see the child's request.
    let (_, list) = get(&h.router, &sibling_token, "/api/v1/household/approvals").await;
    assert!(list.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn guardian_approval_needs_the_guardians_own_pin_and_is_bounded() {
    let h = household().await;
    let (_, created) = post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "time", "subject": "schedule"}),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_string();
    let decide = format!("/api/v1/household/approvals/{id}/decision");

    // Wrong or missing PIN.
    assert_eq!(
        post(
            &h.router,
            &h.guardian_token,
            &decide,
            json!({"approve": true})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        post(
            &h.router,
            &h.guardian_token,
            &decide,
            json!({"approve": true, "pin": "0000"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );

    // Correct PIN: schedule waived for 30 minutes, not indefinitely.
    let (status, approved) = post(
        &h.router,
        &h.guardian_token,
        &decide,
        json!({"approve": true, "pin": "2468", "duration_minutes": 30}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{approved}");
    assert_eq!(approved["status"], "approved");
    assert_eq!(
        get(&h.router, &h.child_token, "/api/v1/catalog").await.0,
        StatusCode::OK
    );
    // A second decision on the same request loses.
    assert_eq!(
        post(
            &h.router,
            &h.guardian_token,
            &decide,
            json!({"approve": true, "pin": "2468"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    // The approval expires on its own.
    h.state.clock.advance(Duration::minutes(31));
    let (status, body) = get(&h.router, &h.child_token, "/api/v1/catalog").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["details"]["reason"], "outside_schedule");
}

#[tokio::test]
async fn a_guardian_without_a_pin_cannot_approve() {
    let h = household().await;
    h.state
        .app
        .profile_pin_repo
        .delete(h.guardian)
        .await
        .unwrap();
    let (_, created) = post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "time", "subject": "schedule"}),
    )
    .await;
    let id = created["id"].as_str().unwrap();
    let (status, _) = post(
        &h.router,
        &h.guardian_token,
        &format!("/api/v1/household/approvals/{id}/decision"),
        json!({"approve": true, "pin": "2468"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unanswered_and_expired_requests_cannot_be_approved_later() {
    let h = household().await;
    let (_, created) = post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "time", "subject": "schedule"}),
    )
    .await;
    let id = created["id"].as_str().unwrap();
    h.state.clock.advance(Duration::minutes(16));
    let (status, _) = post(
        &h.router,
        &h.guardian_token,
        &format!("/api/v1/household/approvals/{id}/decision"),
        json!({"approve": true, "pin": "2468"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        get(&h.router, &h.child_token, "/api/v1/catalog").await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn content_approval_unlocks_one_title_until_it_expires() {
    let h = household().await;
    update_policy(&h.state, h.child, |p| p.access_schedule = None).await;
    let adult = seed_movie_with_tags(&h.state, "Movie Approved", &["rating:R"]).await;
    let other = seed_movie_with_tags(&h.state, "Movie Still Blocked", &["rating:R"]).await;
    let file = seed_playable(&h.state, adult, h.instance).await;
    let other_file = seed_playable(&h.state, other, h.instance).await;
    let stream = format!("/api/v1/media/{}/stream", file.id);
    assert_eq!(
        get(&h.router, &h.child_token, &stream).await.0,
        StatusCode::FORBIDDEN
    );

    let (status, created) = post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "content", "subject": adult.to_string()}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let id = created["id"].as_str().unwrap();
    post(
        &h.router,
        &h.guardian_token,
        &format!("/api/v1/household/approvals/{id}/decision"),
        json!({"approve": true, "pin": "2468", "duration_minutes": 60}),
    )
    .await;

    assert_eq!(
        get(&h.router, &h.child_token, &stream).await.0,
        StatusCode::OK
    );
    assert_eq!(
        get(
            &h.router,
            &h.child_token,
            &format!("/api/v1/catalog/{adult}")
        )
        .await
        .0,
        StatusCode::OK
    );
    // Only that title.
    assert_eq!(
        get(
            &h.router,
            &h.child_token,
            &format!("/api/v1/media/{}/stream", other_file.id)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    // Expired approvals do not linger (HLS-style repeated requests too).
    h.state.clock.advance(Duration::minutes(61));
    assert_eq!(
        get(&h.router, &h.child_token, &stream).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get(
            &h.router,
            &h.child_token,
            &format!("/api/v1/catalog/{adult}")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn purchase_approval_is_single_use_scoped_to_the_profile_and_expiring() {
    let h = household().await;
    update_policy(&h.state, h.child, |p| {
        p.household.approval_required = vec![ApprovalKind::Purchase];
    })
    .await;
    let (_, created) = post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "purchase", "subject": "store:item-42", "note": "a game"}),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_string();
    let consume = format!("/api/v1/household/approvals/{id}/consume");

    // Not approved yet.
    assert_eq!(
        post(&h.router, &h.child_token, &consume, json!({})).await.0,
        StatusCode::FORBIDDEN
    );
    post(
        &h.router,
        &h.guardian_token,
        &format!("/api/v1/household/approvals/{id}/decision"),
        json!({"approve": true, "pin": "2468"}),
    )
    .await;

    // Another profile cannot spend it.
    let sibling = Uuid::new_v4();
    seed_policy_user(&h.state, sibling, |_| {}).await;
    let sibling_token = mint_access_token(&h.state, sibling);
    assert_eq!(
        post(&h.router, &sibling_token, &consume, json!({})).await.0,
        StatusCode::FORBIDDEN
    );
    // The profile spends it once.
    assert_eq!(
        post(&h.router, &h.child_token, &consume, json!({})).await.0,
        StatusCode::OK
    );
    // Replay fails.
    assert_eq!(
        post(&h.router, &h.child_token, &consume, json!({})).await.0,
        StatusCode::FORBIDDEN
    );

    // A fresh approval that expires unused cannot be spent afterwards.
    let (_, created) = post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "install", "subject": "app:example"}),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_string();
    post(
        &h.router,
        &h.guardian_token,
        &format!("/api/v1/household/approvals/{id}/decision"),
        json!({"approve": true, "pin": "2468", "duration_minutes": 5}),
    )
    .await;
    h.state.clock.advance(Duration::minutes(6));
    assert_eq!(
        post(
            &h.router,
            &h.child_token,
            &format!("/api/v1/household/approvals/{id}/consume"),
            json!({})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn budget_bonus_approval_extends_today_only() {
    let h = household().await;
    update_policy(&h.state, h.child, |p| {
        p.access_schedule = None;
        p.household.daily_budget_minutes = Some(1);
    })
    .await;
    let adult_work = seed_movie_with_tags(&h.state, "Movie Bonus", &["rating:G"]).await;
    let file = seed_playable(&h.state, adult_work, h.instance).await;
    let stream = format!("/api/v1/media/{}/stream", file.id);
    for _ in 0..10 {
        if get(&h.router, &h.child_token, &stream).await.0 != StatusCode::OK {
            break;
        }
        h.state.clock.advance(Duration::seconds(25));
    }
    assert_eq!(
        get(&h.router, &h.child_token, &stream).await.0,
        StatusCode::FORBIDDEN
    );

    let (_, created) = post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "time", "subject": "budget"}),
    )
    .await;
    let id = created["id"].as_str().unwrap();
    post(
        &h.router,
        &h.guardian_token,
        &format!("/api/v1/household/approvals/{id}/decision"),
        json!({"approve": true, "pin": "2468", "bonus_minutes": 10, "duration_minutes": 120}),
    )
    .await;
    assert_eq!(
        get(&h.router, &h.child_token, &stream).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn pin_brute_force_is_locked_out_and_a_locked_pin_stays_locked() {
    let h = household().await;
    let verify = format!("/api/v1/users/profiles/{}/verify-pin", h.guardian);
    for _ in 0..5 {
        let (status, body) = post(&h.router, &h.child_token, &verify, json!({"pin": "1111"})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"], "invalid_pin");
    }
    // Now locked: even the correct PIN is refused until the lock lapses.
    let (status, body) = post(&h.router, &h.child_token, &verify, json!({"pin": "2468"})).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["error"], "pin_locked");
    assert!(body["details"]["retry_after_seconds"].as_i64().unwrap() > 0);

    h.state.clock.advance(Duration::seconds(61));
    let (status, _) = post(&h.router, &h.child_token, &verify, json!({"pin": "2468"})).await;
    assert_eq!(status, StatusCode::OK);
    // Success resets the counter.
    let (status, _) = post(&h.router, &h.child_token, &verify, json!({"pin": "9999"})).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn many_children_guessing_one_pin_hit_the_per_target_lockout() {
    let h = household().await;
    let verify = format!("/api/v1/users/profiles/{}/verify-pin", h.guardian);
    let mut tokens = Vec::new();
    for _ in 0..5 {
        let kid = Uuid::new_v4();
        seed_policy_user(&h.state, kid, |p| p.max_rating = Some("PG".into())).await;
        tokens.push(mint_access_token(&h.state, kid));
    }
    // 4 guesses each (below the per-pair limit) from 5 different profiles.
    for token in &tokens {
        for _ in 0..4 {
            post(&h.router, token, &verify, json!({"pin": "1111"})).await;
        }
    }
    let fresh = Uuid::new_v4();
    seed_policy_user(&h.state, fresh, |p| p.max_rating = Some("PG".into())).await;
    let fresh_token = mint_access_token(&h.state, fresh);
    let (status, body) = post(&h.router, &fresh_token, &verify, json!({"pin": "2468"})).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
}

#[tokio::test]
async fn a_restricted_profile_cannot_switch_up_into_an_unprotected_profile() {
    let h = household().await;
    // An adult profile with no PIN.
    let adult = Uuid::new_v4();
    seed_policy_user(&h.state, adult, |p| p.library_allow = vec![h.instance]).await;
    let (status, body) = post(
        &h.router,
        &h.child_token,
        &format!("/api/v1/users/profiles/{adult}/verify-pin"),
        json!({"pin": "0000"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "guardian_pin_required");

    // A sibling under the same restrictions is fine, and the locked child
    // can still reach the switching endpoint to do so.
    let sibling = Uuid::new_v4();
    seed_policy_user(&h.state, sibling, |p| p.max_rating = Some("PG".into())).await;
    let (status, _) = post(
        &h.router,
        &h.child_token,
        &format!("/api/v1/users/profiles/{sibling}/verify-pin"),
        json!({"pin": ""}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // The profile list is reachable while locked and shows PIN locks.
    let (status, list) = get(&h.router, &h.child_token, "/api/v1/users/profiles").await;
    assert_eq!(status, StatusCode::OK);
    assert!(list
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == h.guardian.to_string() && p["pin_locked"] == true));
}

#[tokio::test]
async fn approvals_are_private_to_the_profile_and_its_guardians() {
    let h = household().await;
    post(
        &h.router,
        &h.child_token,
        "/api/v1/household/approvals",
        json!({"kind": "purchase", "subject": "x"}),
    )
    .await;
    let (_, own) = get(&h.router, &h.child_token, "/api/v1/household/approvals").await;
    assert_eq!(own.as_array().unwrap().len(), 1);
    let (_, guardian_view) = get(&h.router, &h.guardian_token, "/api/v1/household/approvals").await;
    assert_eq!(guardian_view.as_array().unwrap().len(), 1);
    let (_, status) = get(&h.router, &h.guardian_token, "/api/v1/household/status").await;
    assert_eq!(status["guardian_for"], json!([h.child.to_string()]));

    let stranger = Uuid::new_v4();
    seed_policy_user(&h.state, stranger, |_| {}).await;
    let stranger_token = mint_access_token(&h.state, stranger);
    let (_, none) = get(&h.router, &stranger_token, "/api/v1/household/approvals").await;
    assert!(none.as_array().unwrap().is_empty());
}

// ---------------------------------------------------------------------
// Admin configuration
// ---------------------------------------------------------------------

#[tokio::test]
async fn admin_household_settings_validate_and_round_trip() {
    let (router, state) = test_state().await;
    let admin = Uuid::new_v4();
    seed_admin_user(&state, admin).await;
    let admin_token = mint_access_token(&state, admin);
    let guardian = Uuid::new_v4();
    seed_policy_user(&state, guardian, |_| {}).await;
    let child = Uuid::new_v4();
    seed_policy_user(&state, child, |_| {}).await;
    let uri = format!("/api/v1/admin/users/{child}/household");

    let valid = json!({
        "max_rating": "PG-13",
        "blocked_tags": ["horror"],
        "access_schedule": [{"weekday": "saturday", "time_range": {"start_minute_of_day": 480, "end_minute_of_day": 1200}}],
        "household": {
            "unrated": "block",
            "timezone": "Europe/London",
            "daily_budget_minutes": 90,
            "guardian_user_ids": [guardian],
            "approval_required": ["purchase", "install"],
            "offline_ttl_hours": 12
        }
    });
    let (status, saved) = call(&router, Some(&admin_token), Method::PUT, &uri, Some(valid)).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (_, read) = get(&router, &admin_token, &uri).await;
    assert_eq!(read["max_rating"], "PG-13");
    assert_eq!(read["household"]["timezone"], "Europe/London");
    assert_eq!(read["household"]["daily_budget_minutes"], 90);

    let invalid = |patch: Value| {
        let mut body = json!({"max_rating": null, "access_schedule": null, "household": {}});
        for (k, v) in patch.as_object().unwrap() {
            if k == "household" {
                body["household"] = v.clone();
            } else {
                body[k] = v.clone();
            }
        }
        body
    };
    for bad in [
        invalid(json!({"max_rating": "PG-99"})),
        invalid(json!({"household": {"timezone": "Mars/Olympus"}})),
        invalid(json!({"household": {"daily_budget_minutes": 0}})),
        invalid(json!({"household": {"daily_budget_minutes": 2000}})),
        invalid(json!({"household": {"offline_ttl_hours": 500}})),
        invalid(json!({"household": {"guardian_user_ids": [child]}})),
        invalid(json!({"household": {"guardian_user_ids": [Uuid::new_v4()]}})),
        invalid(
            json!({"access_schedule": [{"weekday": "monday", "time_range": {"start_minute_of_day": 600, "end_minute_of_day": 600}}]}),
        ),
    ] {
        let (status, body) = call(
            &router,
            Some(&admin_token),
            Method::PUT,
            &uri,
            Some(bad.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} -> {body}");
    }

    // A restricted profile is not an acceptable guardian.
    let restricted = Uuid::new_v4();
    seed_policy_user(&state, restricted, |p| p.max_rating = Some("G".into())).await;
    let (status, _) = call(
        &router,
        Some(&admin_token),
        Method::PUT,
        &uri,
        Some(invalid(
            json!({"household": {"guardian_user_ids": [restricted]}}),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Only admins may read or change it: the child cannot lift their own limits.
    let child_token = mint_access_token(&state, child);
    assert_eq!(
        call(
            &router,
            Some(&child_token),
            Method::PUT,
            &uri,
            Some(invalid(json!({})))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get(&router, &child_token, &uri).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, None, Method::GET, &uri, None).await.0,
        StatusCode::UNAUTHORIZED
    );
}
