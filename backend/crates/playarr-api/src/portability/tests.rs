//! API-level tests for the portable user-data export and import: scoping,
//! isolation, matching, idempotency and hostile input.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use chrono::{Duration, TimeZone, Utc};
use playarr_model::media::LeafRef;
use playarr_model::{
    Availability, ExternalProvider, ExternalRef, Playlist, PlaylistMediaType, WatchProgress,
    WatchState, Work, WorkKind,
};
use playarr_portability::{read_package, Limits, UserDataPackage};
use tower::ServiceExt;
use uuid::Uuid;

use crate::test_support::{
    bearer_header, mint_access_token, seed_streaming_user_with_library_allow, test_state, TestState,
};

struct Api {
    router: Router,
}

impl Api {
    async fn call(
        &self,
        method: &str,
        uri: &str,
        token: Option<&str>,
        body: Vec<u8>,
    ) -> (StatusCode, Vec<u8>) {
        let mut request = Request::builder().method(method).uri(uri);
        if let Some(token) = token {
            request = request.header("Authorization", bearer_header(token));
        }
        let response = self
            .router
            .clone()
            .oneshot(request.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024 * 1024)
            .await
            .unwrap();
        (status, bytes.to_vec())
    }

    async fn json(&self, method: &str, uri: &str, token: &str) -> (StatusCode, serde_json::Value) {
        let (status, bytes) = self.call(method, uri, Some(token), vec![]).await;
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    /// Runs an export to completion and returns the package bytes.
    async fn export(&self, token: &str) -> (String, Vec<u8>) {
        let (status, job) = self
            .json("POST", "/api/v1/users/me/data-exports", token)
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{job}");
        let id = job["id"].as_str().unwrap().to_owned();
        for _ in 0..200 {
            let (_, job) = self
                .json("GET", &format!("/api/v1/users/me/data-exports/{id}"), token)
                .await;
            match job["status"].as_str().unwrap() {
                "ready" => break,
                "failed" => panic!("export failed: {job}"),
                _ => tokio::time::sleep(std::time::Duration::from_millis(25)).await,
            }
        }
        let (status, bytes) = self
            .call(
                "GET",
                &format!("/api/v1/users/me/data-exports/{id}/download"),
                Some(token),
                vec![],
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        (id, bytes)
    }

    async fn preview(
        &self,
        token: &str,
        package: &[u8],
        query: &str,
    ) -> (StatusCode, serde_json::Value) {
        let (status, bytes) = self
            .call(
                "POST",
                &format!("/api/v1/users/me/data-imports/preview?{query}"),
                Some(token),
                package.to_vec(),
            )
            .await;
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    async fn apply(
        &self,
        token: &str,
        package: &[u8],
        query: &str,
    ) -> (StatusCode, serde_json::Value) {
        let digest = {
            use sha2::{Digest, Sha256};
            hex::encode(Sha256::digest(package))
        };
        let (status, bytes) = self
            .call(
                "POST",
                &format!("/api/v1/users/me/data-imports?package_sha256={digest}&{query}"),
                Some(token),
                package.to_vec(),
            )
            .await;
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }
}

fn work(title: &str, kind: WorkKind, year: i32, refs: &[(ExternalProvider, &str)]) -> Work {
    Work {
        id: Uuid::new_v4(),
        kind,
        external_refs: refs
            .iter()
            .map(|(provider, id)| ExternalRef {
                provider: provider.clone(),
                external_id: (*id).to_owned(),
            })
            .collect(),
        title: title.to_owned(),
        sort_title: title.to_owned(),
        overview: None,
        images: vec![],
        genres: vec![],
        tags: vec![],
        added_at: Utc::now(),
        release_date: Some(Utc.with_ymd_and_hms(year, 6, 1, 0, 0, 0).unwrap()),
        monitored: true,
        availability: Availability::Available,
    }
}

async fn seed_file(state: &TestState, work_id: Uuid, leaf_ref: LeafRef, source: Uuid) -> Uuid {
    let file = playarr_model::MediaFile {
        id: Uuid::new_v4(),
        work_id,
        leaf_ref,
        path: std::path::PathBuf::from("/media/library/file.mkv"),
        container: "mkv".into(),
        codec: "h264".into(),
        bitrate: None,
        duration_ms: Some(3_600_000),
        size_bytes: 1,
        source_instance_id: source,
        source_file_id: Some(Uuid::new_v4().to_string()),
    };
    state.media_file_repo.create(&file).await.unwrap();
    file.id
}

struct Library {
    source: Uuid,
    movie_alpha: Work,
    movie_alpha_file: Uuid,
    series_beta: Work,
    ep1_file: Uuid,
    ep2_file: Uuid,
}

async fn seed_library(state: &TestState) -> Library {
    let source = Uuid::new_v4();
    let movie_alpha = work(
        "Sample Movie Alpha",
        WorkKind::Movie,
        2010,
        &[
            (ExternalProvider::Tmdb, "27205"),
            (ExternalProvider::Imdb, "tt1375666"),
        ],
    );
    state.work_repo.upsert(&movie_alpha).await.unwrap();
    let movie_alpha_file = seed_file(state, movie_alpha.id, LeafRef::Work, source).await;

    let series_beta = work(
        "Test Series Beta",
        WorkKind::Series,
        2022,
        &[(ExternalProvider::Tvdb, "371980")],
    );
    state.work_repo.upsert(&series_beta).await.unwrap();
    let season = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO seasons (id, series_work_id, season_number, title, overview, monitored, availability) \
         VALUES (?, ?, 1, 'Season 1', NULL, 1, 'available')",
    )
    .bind(season.to_string())
    .bind(series_beta.id.to_string())
    .execute(&state.pool)
    .await
    .unwrap();
    let mut files = Vec::new();
    for (number, title) in [(1, "Good News About Hell"), (2, "Half Loop")] {
        let episode = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO episodes (id, season_id, episode_number, title, overview, images, air_date, runtime_minutes, monitored, availability) \
             VALUES (?, ?, ?, ?, NULL, '[]', NULL, 50, 1, 'available')",
        )
        .bind(episode.to_string())
        .bind(season.to_string())
        .bind(number as i64)
        .bind(title)
        .execute(&state.pool)
        .await
        .unwrap();
        files.push(seed_file(state, series_beta.id, LeafRef::Episode(episode), source).await);
    }
    Library {
        source,
        movie_alpha,
        movie_alpha_file,
        series_beta,
        ep1_file: files[0],
        ep2_file: files[1],
    }
}

async fn progress(
    state: &TestState,
    user: Uuid,
    file: Uuid,
    work: Uuid,
    ws: WatchState,
    pos: u64,
    at: chrono::DateTime<Utc>,
) {
    state
        .app
        .watch_progress
        .upsert(
            user,
            &WatchProgress {
                media_file_id: file,
                work_id: work,
                position_ms: pos,
                duration_ms: 7_200_000,
                state: ws,
                updated_at: Some(at),
            },
        )
        .await
        .unwrap();
}

async fn playlist(state: &TestState, owner: Uuid, name: &str, works: &[Uuid]) -> Uuid {
    let now = Utc::now();
    let id = Uuid::new_v4();
    state
        .app
        .playlist_repo
        .upsert(&Playlist {
            id,
            name: name.to_owned(),
            owner_user_id: Some(owner),
            parent_playlist_id: None,
            media_type: PlaylistMediaType::Video,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap();
    for work in works {
        state
            .app
            .playlist_repo
            .add_item(id, *work, None)
            .await
            .unwrap();
    }
    id
}

async fn user(state: &TestState, source: Uuid) -> (Uuid, String) {
    let id = Uuid::new_v4();
    seed_streaming_user_with_library_allow(state, id, vec![source]).await;
    (id, mint_access_token(state, id))
}

fn read(bytes: &[u8]) -> UserDataPackage {
    read_package(bytes, &Limits::default()).expect("valid package")
}

#[tokio::test]
async fn export_contains_only_the_callers_own_data_and_no_secrets() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let (a, token_a) = user(&state, lib.source).await;
    let (b, _token_b) = user(&state, lib.source).await;
    let at = Utc.with_ymd_and_hms(2026, 9, 1, 20, 0, 0).unwrap();
    progress(
        &state,
        a,
        lib.movie_alpha_file,
        lib.movie_alpha.id,
        WatchState::PartWatched,
        600_000,
        at,
    )
    .await;
    progress(
        &state,
        a,
        lib.ep1_file,
        lib.series_beta.id,
        WatchState::Watched,
        3_000_000,
        at,
    )
    .await;
    progress(
        &state,
        b,
        lib.ep2_file,
        lib.series_beta.id,
        WatchState::PartWatched,
        99_000,
        at,
    )
    .await;
    playlist(&state, a, "Weekend", &[lib.movie_alpha.id, lib.series_beta.id]).await;
    playlist(&state, b, "B private list", &[lib.movie_alpha.id]).await;

    let api = Api { router };
    let (_, bytes) = api.export(&token_a).await;
    let package = read(&bytes);

    assert_eq!(package.watch_progress.len(), 2);
    let episode = package
        .watch_progress
        .iter()
        .find(|w| w.item.kind == "episode")
        .unwrap();
    assert_eq!(episode.item.season_number, Some(1));
    assert_eq!(episode.item.episode_number, Some(1));
    assert_eq!(
        episode.item.episode_title.as_deref(),
        Some("Good News About Hell")
    );
    assert_eq!(
        episode.item.external_ids.get("tvdb").map(String::as_str),
        Some("371980")
    );
    assert_eq!(episode.state, "watched");
    let movie = package
        .watch_progress
        .iter()
        .find(|w| w.item.kind == "movie")
        .unwrap();
    assert_eq!(movie.position_ms, 600_000);
    assert_eq!(movie.item.year, Some(2010));
    assert_eq!(
        movie.item.external_ids.get("tmdb").map(String::as_str),
        Some("27205")
    );

    assert_eq!(package.playlists.len(), 1);
    assert_eq!(package.playlists[0].name, "Weekend");
    let order: Vec<&str> = package.playlists[0]
        .items
        .iter()
        .map(|i| i.item.title.as_str())
        .collect();
    assert_eq!(order, ["Sample Movie Alpha", "Test Series Beta"]);

    // Nothing of B's, no credentials, no server paths in any entry.
    let everything = String::from_utf8_lossy(&bytes).to_string();
    let json = serde_json::to_string(&package).unwrap();
    for needle in [
        "B private list",
        "99000",
        &b.to_string(),
        "password",
        "argon2",
        "/media/",
        "token",
    ] {
        assert!(!json.contains(needle), "package json leaks {needle}");
    }
    assert!(!everything.contains("test-only-password"));
}

#[tokio::test]
async fn export_ids_downloads_and_listing_are_private_to_their_owner() {
    let (router, state) = test_state().await;
    let (_a, token_a) = user(&state, Uuid::new_v4()).await;
    let (_b, token_b) = user(&state, Uuid::new_v4()).await;
    let api = Api { router };

    let (id, _) = api.export(&token_a).await;
    let base = format!("/api/v1/users/me/data-exports/{id}");
    for uri in [base.clone(), format!("{base}/download")] {
        let (status, _) = api.call("GET", &uri, Some(&token_b), vec![]).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
        let (status, _) = api.call("GET", &uri, None, vec![]).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
    }
    let (status, _) = api.call("DELETE", &base, Some(&token_b), vec![]).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, listing) = api
        .json("GET", "/api/v1/users/me/data-exports", &token_b)
        .await;
    assert_eq!(listing["scope"], "own_account_only");
    assert!(listing["exports"].as_array().unwrap().is_empty());
    let (_, listing) = api
        .json("GET", "/api/v1/users/me/data-exports", &token_a)
        .await;
    assert_eq!(listing["exports"].as_array().unwrap().len(), 1);
    // The owner still has it.
    let (status, _) = api
        .call("GET", &format!("{base}/download"), Some(&token_a), vec![])
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn expired_exports_are_gone_and_their_files_removed() {
    let (router, state) = test_state().await;
    let (_a, token_a) = user(&state, Uuid::new_v4()).await;
    let api = Api { router };
    let (id, _) = api.export(&token_a).await;
    let job = state.app.portability.get_for(_a, &id).unwrap();
    let file = job.file.clone().unwrap();
    assert!(file.exists());
    state.app.portability.expire_now(&id);
    let (status, _) = api
        .call(
            "GET",
            &format!("/api/v1/users/me/data-exports/{id}/download"),
            Some(&token_a),
            vec![],
        )
        .await;
    assert_eq!(status, StatusCode::GONE);
    assert!(!file.exists(), "temporary file removed on expiry");
    let (_, job) = api
        .json(
            "GET",
            &format!("/api/v1/users/me/data-exports/{id}"),
            &token_a,
        )
        .await;
    assert_eq!(job["status"], "expired");
    assert!(job["download_url"].is_null());
}

#[tokio::test]
async fn a_second_request_returns_the_unfinished_export_instead_of_starting_another() {
    let (router, state) = test_state().await;
    let (_a, token_a) = user(&state, Uuid::new_v4()).await;
    let api = Api { router };
    let (_, first) = api
        .json("POST", "/api/v1/users/me/data-exports", &token_a)
        .await;
    let (_, second) = api
        .json("POST", "/api/v1/users/me/data-exports", &token_a)
        .await;
    // Either still running (same id) or already finished and a new one starts.
    if first["status"] != "ready" && second["status"] != "ready" {
        assert_eq!(first["id"], second["id"]);
    }
}

#[tokio::test]
async fn round_trip_into_a_fresh_account_preserves_progress_playlists_order_and_unicode() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let jp = work(
        "日本語タイトル",
        WorkKind::Movie,
        2001,
        &[(ExternalProvider::Tmdb, "129")],
    );
    state.work_repo.upsert(&jp).await.unwrap();
    let jp_file = seed_file(&state, jp.id, LeafRef::Work, lib.source).await;

    let (a, token_a) = user(&state, lib.source).await;
    let at = Utc.with_ymd_and_hms(2026, 9, 1, 20, 0, 0).unwrap();
    progress(
        &state,
        a,
        lib.movie_alpha_file,
        lib.movie_alpha.id,
        WatchState::PartWatched,
        600_000,
        at,
    )
    .await;
    progress(
        &state,
        a,
        lib.ep2_file,
        lib.series_beta.id,
        WatchState::Watched,
        3_000_000,
        at,
    )
    .await;
    progress(
        &state,
        a,
        jp_file,
        jp.id,
        WatchState::PartWatched,
        42_000,
        at,
    )
    .await;
    playlist(
        &state,
        a,
        "Ünïcode ✓ list",
        &[jp.id, lib.series_beta.id, lib.movie_alpha.id],
    )
    .await;

    let api = Api { router };
    let (_, bytes) = api.export(&token_a).await;
    let (c, token_c) = user(&state, lib.source).await;

    let (status, preview) = api.preview(&token_c, &bytes, "").await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_eq!(preview["summary"]["watch_progress"]["will_add"], 3);
    assert_eq!(preview["summary"]["playlists"]["new"], 1);
    assert_eq!(preview["summary"]["playlists"]["items_to_add"], 3);
    // Preview wrote nothing.
    assert!(state
        .app
        .watch_progress
        .list_for_user(c)
        .await
        .unwrap()
        .is_empty());

    let (status, result) = api.apply(&token_c, &bytes, "").await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["completed"], true);
    assert_eq!(result["progress_added"], 3);
    assert_eq!(result["playlist_items_added"], 3);

    let (_, again) = api.export(&token_c).await;
    let original = read(&bytes);
    let copy = read(&again);
    let key = |p: &UserDataPackage| {
        let mut rows: Vec<_> = p
            .watch_progress
            .iter()
            .map(|w| {
                (
                    w.item.title.clone(),
                    w.item.kind.clone(),
                    w.state.clone(),
                    w.position_ms,
                    w.updated_at,
                )
            })
            .collect();
        rows.sort();
        rows
    };
    assert_eq!(key(&original), key(&copy));
    let lists = |p: &UserDataPackage| -> Vec<(String, Vec<String>)> {
        p.playlists
            .iter()
            .map(|l| {
                (
                    l.name.clone(),
                    l.items.iter().map(|i| i.item.title.clone()).collect(),
                )
            })
            .collect()
    };
    assert_eq!(lists(&original), lists(&copy));
    assert_eq!(
        lists(&copy)[0].1,
        ["日本語タイトル", "Test Series Beta", "Sample Movie Alpha"]
    );
    // A's own data is untouched.
    assert_eq!(
        state
            .app
            .watch_progress
            .list_for_user(a)
            .await
            .unwrap()
            .len(),
        3
    );
}

#[tokio::test]
async fn repeated_import_is_idempotent() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let (a, token_a) = user(&state, lib.source).await;
    let at = Utc.with_ymd_and_hms(2026, 9, 1, 20, 0, 0).unwrap();
    progress(
        &state,
        a,
        lib.movie_alpha_file,
        lib.movie_alpha.id,
        WatchState::PartWatched,
        600_000,
        at,
    )
    .await;
    playlist(&state, a, "Weekend", &[lib.movie_alpha.id]).await;
    let api = Api { router };
    let (_, bytes) = api.export(&token_a).await;
    let (c, token_c) = user(&state, lib.source).await;

    let (_, first) = api.apply(&token_c, &bytes, "").await;
    assert_eq!(first["progress_added"], 1);
    let (_, second) = api.apply(&token_c, &bytes, "").await;
    assert_eq!(second["completed"], true);
    assert_eq!(second["progress_added"], 0);
    assert_eq!(second["progress_updated"], 0);
    assert_eq!(second["progress_unchanged"], 1);
    assert_eq!(second["playlists_created"], 0);
    assert_eq!(second["playlist_items_added"], 0);
    assert_eq!(second["playlist_items_already_present"], 1);
    assert_eq!(
        state
            .app
            .playlist_repo
            .list_visible_to_user(c)
            .await
            .unwrap()
            .len(),
        1
    );
}

fn hand_package(items: serde_json::Value) -> Vec<u8> {
    let doc = serde_json::json!({
        "format": "playarr.user-data",
        "schema_version": 1,
        "generated_at": "2026-09-01T20:00:00Z",
        "source": {"instance_name": "Elsewhere"},
        "owner": {"display_name": "someone else"},
        "watch_progress": items,
    });
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        zip.start_file(
            "playarr-user-data.json",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        std::io::Write::write_all(&mut zip, doc.to_string().as_bytes()).unwrap();
        zip.finish().unwrap();
    }
    cursor.into_inner()
}

fn watch(item: serde_json::Value, state: &str, pos: u64, at: Option<&str>) -> serde_json::Value {
    serde_json::json!({"item": item, "state": state, "position_ms": pos, "duration_ms": 7_200_000, "updated_at": at})
}

#[tokio::test]
async fn cross_server_matching_uses_ids_then_titles_and_keeps_unmatched_recoverable() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    for (title, year, id) in [("Sample Title", 1984, "d1"), ("Sample Title", 2021, "d2")] {
        let w = work(
            title,
            WorkKind::Movie,
            year,
            &[(ExternalProvider::Other(id.into()), id)],
        );
        state.work_repo.upsert(&w).await.unwrap();
        seed_file(&state, w.id, LeafRef::Work, lib.source).await;
    }
    let (c, token_c) = user(&state, lib.source).await;
    let api = Api { router };
    let package = hand_package(serde_json::json!([
        // Local ids are unknown here; the provider id decides.
        watch(
            serde_json::json!({"kind":"movie","title":"Totally different title","external_ids":{"tmdb":"27205"},
            "playarr":{"work_id": Uuid::new_v4()}}),
            "part_watched",
            1_000,
            Some("2026-09-01T20:00:00Z")
        ),
        // No ids: fuzzy title with an agreeing year.
        watch(
            serde_json::json!({"kind":"episode","title":"series_beta","year":2022,"season_number":1,"episode_number":2}),
            "watched",
            2_000_000,
            Some("2026-09-02T20:00:00Z")
        ),
        // Ambiguous: two Dunes and no year.
        watch(
            serde_json::json!({"kind":"movie","title":"Sample Title"}),
            "part_watched",
            500,
            None
        ),
        // Not in this library at all.
        watch(
            serde_json::json!({"kind":"movie","title":"Nonexistent Picture","external_ids":{"tmdb":"1"}}),
            "watched",
            9,
            None
        ),
        // Unknown kind from the future.
        watch(
            serde_json::json!({"kind":"game","title":"Tile Game"}),
            "watched",
            9,
            None
        ),
        // Invalid state.
        watch(
            serde_json::json!({"kind":"movie","title":"Sample Movie Alpha"}),
            "bogus",
            9,
            None
        ),
    ]));

    let (status, preview) = api.preview(&token_c, &package, "").await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let wp = &preview["summary"]["watch_progress"];
    assert_eq!(wp["total"], 6);
    assert_eq!(wp["will_add"], 2);
    assert_eq!(wp["ambiguous"], 1);
    assert_eq!(wp["unmatched"], 3);
    let ambiguous = preview["samples"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["outcome"] == "ambiguous")
        .unwrap();
    assert_eq!(ambiguous["candidates"].as_array().unwrap().len(), 2);

    let (_, result) = api.apply(&token_c, &package, "").await;
    assert_eq!(result["progress_added"], 2);
    assert_eq!(result["unmatched_total"], 4);
    let rows = state.app.watch_progress.list_for_user(c).await.unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .any(|r| r.media_file_id == lib.movie_alpha_file && r.position_ms == 1_000));
    assert!(rows.iter().any(|r| r.media_file_id == lib.ep2_file));

    // The unmatched records are downloadable as a package and importable later.
    let (status, unmatched_bytes) = api
        .call(
            "POST",
            "/api/v1/users/me/data-imports/unmatched",
            Some(&token_c),
            package.clone(),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let unmatched = read(&unmatched_bytes);
    assert_eq!(unmatched.unmatched.len(), 4);
    assert!(unmatched.watch_progress.is_empty());

    // Add the missing title; the unmatched package now places it.
    let missing = work(
        "Nonexistent Picture",
        WorkKind::Movie,
        2000,
        &[(ExternalProvider::Tmdb, "1")],
    );
    state.work_repo.upsert(&missing).await.unwrap();
    let missing_file = seed_file(&state, missing.id, LeafRef::Work, lib.source).await;
    let (_, retry) = api.apply(&token_c, &unmatched_bytes, "").await;
    assert_eq!(retry["progress_added"], 1, "{retry}");
    assert!(state
        .app
        .watch_progress
        .get(c, missing_file)
        .await
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn conflicting_progress_follows_the_chosen_policy() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let (c, token_c) = user(&state, lib.source).await;
    let old = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    progress(
        &state,
        c,
        lib.movie_alpha_file,
        lib.movie_alpha.id,
        WatchState::PartWatched,
        100,
        old,
    )
    .await;
    let api = Api { router };
    let item =
        serde_json::json!({"kind":"movie","title":"Sample Movie Alpha","external_ids":{"tmdb":"27205"}});

    // Older incoming record does not overwrite newer local progress.
    let older = hand_package(serde_json::json!([watch(
        item.clone(),
        "watched",
        7_000_000,
        Some("2025-01-01T00:00:00Z")
    )]));
    let (_, r) = api.apply(&token_c, &older, "").await;
    assert_eq!(r["progress_conflicts_kept"], 1);
    assert_eq!(
        state
            .app
            .watch_progress
            .get(c, lib.movie_alpha_file)
            .await
            .unwrap()
            .unwrap()
            .position_ms,
        100
    );

    // keep_existing keeps even a newer record.
    let newer = hand_package(serde_json::json!([watch(
        item.clone(),
        "watched",
        7_000_000,
        Some("2026-06-01T00:00:00Z")
    )]));
    let (_, r) = api
        .apply(&token_c, &newer, "progress_conflicts=keep_existing")
        .await;
    assert_eq!(r["progress_conflicts_kept"], 1);
    assert_eq!(
        state
            .app
            .watch_progress
            .get(c, lib.movie_alpha_file)
            .await
            .unwrap()
            .unwrap()
            .position_ms,
        100
    );

    // The default policy takes the newer one.
    let (_, r) = api.apply(&token_c, &newer, "").await;
    assert_eq!(r["progress_updated"], 1);
    let row = state
        .app
        .watch_progress
        .get(c, lib.movie_alpha_file)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (row.position_ms, row.state),
        (7_000_000, WatchState::Watched)
    );
}

#[tokio::test]
async fn imports_only_ever_change_the_callers_account() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let (a, token_a) = user(&state, lib.source).await;
    let (b, token_b) = user(&state, lib.source).await;
    let at = Utc.with_ymd_and_hms(2026, 9, 1, 20, 0, 0).unwrap();
    progress(
        &state,
        a,
        lib.movie_alpha_file,
        lib.movie_alpha.id,
        WatchState::PartWatched,
        600_000,
        at,
    )
    .await;
    playlist(&state, a, "A list", &[lib.movie_alpha.id]).await;
    let api = Api { router };
    let (_, bytes_a) = api.export(&token_a).await;
    let before_a = state.app.watch_progress.list_for_user(a).await.unwrap();

    // B imports A's package; a user_id in the query string is ignored.
    let (status, r) = api
        .apply(&token_b, &bytes_a, &format!("user_id={a}&owner={a}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{r}");
    assert_eq!(
        state
            .app
            .watch_progress
            .list_for_user(b)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        state.app.watch_progress.list_for_user(a).await.unwrap(),
        before_a
    );
    let a_lists = state
        .app
        .playlist_repo
        .list_visible_to_user(a)
        .await
        .unwrap();
    let b_lists = state
        .app
        .playlist_repo
        .list_visible_to_user(b)
        .await
        .unwrap();
    assert_eq!(a_lists.len(), 1);
    assert_eq!(b_lists.len(), 1);
    assert_ne!(
        a_lists[0].id, b_lists[0].id,
        "package ids are remapped, never reused"
    );
    assert_eq!(b_lists[0].owner_user_id, Some(b));
    assert_eq!(
        state
            .app
            .playlist_repo
            .list_items(a_lists[0].id)
            .await
            .unwrap()
            .len(),
        1
    );

    // No import route accepts a path or body field selecting another user.
    let (status, _) = api
        .call(
            "POST",
            &format!("/api/v1/users/{a}/data-imports"),
            Some(&token_b),
            bytes_a.clone(),
        )
        .await;
    assert!(status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn import_requires_the_previewed_digest_and_authentication() {
    let (router, state) = test_state().await;
    let (_c, token_c) = user(&state, Uuid::new_v4()).await;
    let api = Api { router };
    let package = hand_package(serde_json::json!([]));
    let (status, _) = api
        .call(
            "POST",
            "/api/v1/users/me/data-imports?package_sha256=deadbeef",
            Some(&token_c),
            package.clone(),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = api
        .call(
            "POST",
            "/api/v1/users/me/data-imports/preview",
            None,
            package.clone(),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = api
        .call(
            "POST",
            "/api/v1/users/me/data-imports?package_sha256=x",
            None,
            package,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn malformed_unsupported_and_hostile_uploads_are_rejected_without_changes() {
    let (router, state) = test_state().await;
    let (c, token_c) = user(&state, Uuid::new_v4()).await;
    let api = Api { router };

    let (status, body) = api.preview(&token_c, b"this is not a zip", "").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "invalid_package");

    let future = serde_json::json!({"format":"playarr.user-data","schema_version":2,"generated_at":"2026-09-01T20:00:00Z"});
    let (status, body) = api
        .preview(&token_c, future.to_string().as_bytes(), "")
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(body["message"].as_str().unwrap().contains("version 2"));

    let wrong = serde_json::json!({"format":"somebody.else","schema_version":1,"generated_at":"2026-09-01T20:00:00Z"});
    let (status, _) = api
        .preview(&token_c, wrong.to_string().as_bytes(), "")
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Zip slip names.
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        zip.start_file(
            "../../etc/cron.d/evil",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        std::io::Write::write_all(&mut zip, b"x").unwrap();
        zip.finish().unwrap();
    }
    let (status, _) = api.preview(&token_c, &cursor.into_inner(), "").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // An oversized body is refused before it is read in full.
    let huge = vec![0u8; 51 * 1024 * 1024];
    let (status, _) = api
        .call(
            "POST",
            "/api/v1/users/me/data-imports/preview",
            Some(&token_c),
            huge,
        )
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

    assert!(state
        .app
        .watch_progress
        .list_for_user(c)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn malicious_text_is_neutralised_and_playlist_names_are_bounded() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let (c, token_c) = user(&state, lib.source).await;
    let api = Api { router };
    let long = "x".repeat(300);
    let doc = serde_json::json!({
        "format": "playarr.user-data", "schema_version": 1, "generated_at": "2026-09-01T20:00:00Z",
        "playlists": [
            {"id": Uuid::new_v4(), "name": "=HYPERLINK(\"http://evil\",\"x\")\u{202e}\u{0}  spaced", "media_type": "video",
             "created_at": "2026-09-01T20:00:00Z", "updated_at": "2026-09-01T20:00:00Z",
             "items": [{"position":0,"added_at":"2026-09-01T20:00:00Z","item":{"kind":"movie","title":"Sample Movie Alpha","external_ids":{"tmdb":"27205"}}}]},
            {"id": Uuid::new_v4(), "name": long, "media_type": "video",
             "created_at": "2026-09-01T20:00:00Z", "updated_at": "2026-09-01T20:00:00Z",
             "items": [{"position":0,"added_at":"2026-09-01T20:00:00Z","item":{"kind":"movie","title":"Sample Movie Alpha","external_ids":{"tmdb":"27205"}}}]},
        ]
    });
    // 300 characters is under the reader's field cap but over the playlist name cap.
    let (status, result) = api.apply(&token_c, doc.to_string().as_bytes(), "").await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["playlists_created"], 1);
    assert_eq!(result["unmatched_total"], 1);
    let lists = state
        .app
        .playlist_repo
        .list_visible_to_user(c)
        .await
        .unwrap();
    assert_eq!(lists.len(), 1);
    assert!(!lists[0].name.contains('\u{202e}') && !lists[0].name.contains('\0'));
    assert_eq!(lists[0].name, "=HYPERLINK(\"http://evil\",\"x\") spaced");
    // Re-exported CSV neutralises the leading '='.
    let (_, bytes) = api.export(&token_c).await;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut csv = String::new();
    std::io::Read::read_to_string(&mut zip.by_name("playlists.csv").unwrap(), &mut csv).unwrap();
    assert!(csv.contains("'=HYPERLINK"), "{csv}");
    let _ = lib;
}

#[tokio::test]
async fn library_restrictions_apply_to_imports_and_exports() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let (a, token_a) = user(&state, lib.source).await;
    let at = Utc.with_ymd_and_hms(2026, 9, 1, 20, 0, 0).unwrap();
    progress(
        &state,
        a,
        lib.movie_alpha_file,
        lib.movie_alpha.id,
        WatchState::PartWatched,
        600_000,
        at,
    )
    .await;
    let api = Api { router };
    let (_, bytes) = api.export(&token_a).await;

    // D may only see an unrelated library: nothing matches, nothing is written,
    // and nothing in the response hints that the title exists.
    let d = Uuid::new_v4();
    seed_streaming_user_with_library_allow(&state, d, vec![Uuid::new_v4()]).await;
    let token_d = mint_access_token(&state, d);
    let (_, preview) = api.preview(&token_d, &bytes, "").await;
    assert_eq!(preview["summary"]["watch_progress"]["unmatched"], 1);
    assert_eq!(preview["summary"]["watch_progress"]["will_add"], 0);
    assert_eq!(preview["samples"][0]["outcome"], "no_match");
    let (_, result) = api.apply(&token_d, &bytes, "").await;
    assert_eq!(result["progress_added"], 0);
    assert!(state
        .app
        .watch_progress
        .list_for_user(d)
        .await
        .unwrap()
        .is_empty());

    // A progress row for content D lost access to is omitted from D's export.
    progress(
        &state,
        d,
        lib.movie_alpha_file,
        lib.movie_alpha.id,
        WatchState::PartWatched,
        5,
        at,
    )
    .await;
    let (_, d_export) = api.export(&token_d).await;
    assert!(read(&d_export).watch_progress.is_empty());
    let _ = Duration::seconds(0);
}

#[tokio::test]
async fn preferences_import_only_when_chosen_and_playback_choices_are_never_applied() {
    let (router, state) = test_state().await;
    let (c, token_c) = user(&state, Uuid::new_v4()).await;
    let api = Api { router };
    let doc = serde_json::json!({
        "format": "playarr.user-data", "schema_version": 1, "generated_at": "2026-09-01T20:00:00Z",
        "preferences": {"preferred_audio_language": "JA"},
        "playback_preferences": [{"item": {"kind":"movie","title":"Sample Movie Alpha"}, "quality_id": "original"}]
    });
    let bytes = doc.to_string().into_bytes();
    let (_, r) = api.apply(&token_c, &bytes, "").await;
    assert_eq!(r["preferred_audio_language_updated"], false);
    let (_, preview) = api
        .preview(&token_c, &bytes, "include_preferences=true")
        .await;
    assert_eq!(preview["summary"]["preferred_audio_language_change"], "ja");
    assert_eq!(preview["summary"]["playback_preferences_not_applied"], 1);
    let (_, r) = api
        .apply(&token_c, &bytes, "include_preferences=true")
        .await;
    assert_eq!(r["preferred_audio_language_updated"], true);
    let user = state.app.user_repo.find_by_id(c).await.unwrap().unwrap();
    assert_eq!(user.preferred_audio_language, "ja");
}

#[tokio::test]
async fn system_playlists_and_other_peoples_playlists_are_never_exported() {
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let (a, token_a) = user(&state, lib.source).await;
    let (b, _) = user(&state, lib.source).await;
    playlist(&state, a, "Mine", &[lib.movie_alpha.id]).await;
    playlist(&state, b, "Theirs", &[lib.movie_alpha.id]).await;
    // An administrator-managed "System" playlist is visible to everyone but is
    // not the user's own data.
    let now = Utc::now();
    let system = Uuid::new_v4();
    state
        .app
        .playlist_repo
        .upsert(&Playlist {
            id: system,
            name: "Household picks".into(),
            owner_user_id: None,
            parent_playlist_id: None,
            media_type: PlaylistMediaType::Video,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap();
    state
        .app
        .playlist_repo
        .add_item(system, lib.movie_alpha.id, None)
        .await
        .unwrap();

    let api = Api { router };
    let (_, bytes) = api.export(&token_a).await;
    let names: Vec<String> = read(&bytes).playlists.into_iter().map(|p| p.name).collect();
    assert_eq!(names, ["Mine"]);
}

#[tokio::test]
async fn watchlist_round_trips_including_titles_that_are_not_in_any_library() {
    use playarr_model::discovery::{identity_key, DiscoveryKind, WatchlistItem};
    let (router, state) = test_state().await;
    let lib = seed_library(&state).await;
    let (a, token_a) = user(&state, lib.source).await;
    let (b, _) = user(&state, lib.source).await;
    let at = Utc.with_ymd_and_hms(2026, 9, 1, 20, 0, 0).unwrap();
    let add = |user: Uuid, kind: DiscoveryKind, title: &str, year: i32, refs: Vec<ExternalRef>| {
        let item = WatchlistItem {
            title_key: identity_key(kind, title, Some(year), &refs),
            kind,
            title: title.to_owned(),
            year: Some(year),
            work_id: None,
            external_refs: refs,
            poster_url: Some("https://example.invalid/poster.jpg".into()),
            added_at: at,
        };
        let repo = state.app.watchlist_repo.clone();
        async move { repo.add(user, &item).await.unwrap() }
    };
    add(
        a,
        DiscoveryKind::Movie,
        "Sample Movie Alpha",
        2010,
        vec![ExternalRef {
            provider: ExternalProvider::Tmdb,
            external_id: "27205".into(),
        }],
    )
    .await;
    add(
        a,
        DiscoveryKind::Series,
        "Future Show",
        2030,
        vec![ExternalRef {
            provider: ExternalProvider::Tvdb,
            external_id: "999".into(),
        }],
    )
    .await;
    add(a, DiscoveryKind::Game, "Tile Game", 1984, vec![]).await;
    add(b, DiscoveryKind::Movie, "Only Bs", 2001, vec![]).await;

    let api = Api { router };
    let (_, bytes) = api.export(&token_a).await;
    let package = read(&bytes);
    let mut titles: Vec<&str> = package
        .watchlist
        .iter()
        .map(|w| w.item.title.as_str())
        .collect();
    titles.sort();
    assert_eq!(titles, ["Future Show", "Sample Movie Alpha", "Tile Game"]);
    assert!(
        !serde_json::to_string(&package).unwrap().contains("poster"),
        "poster URLs are not exported"
    );
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
    let mut csv = String::new();
    std::io::Read::read_to_string(&mut zip.by_name("watchlist.csv").unwrap(), &mut csv).unwrap();
    assert!(csv.contains("Future Show") && !csv.contains("Only Bs"));

    let (c, token_c) = user(&state, lib.source).await;
    let (_, preview) = api.preview(&token_c, &bytes, "").await;
    assert_eq!(preview["summary"]["watchlist"]["will_add"], 3, "{preview}");
    let (_, result) = api.apply(&token_c, &bytes, "").await;
    assert_eq!(result["watchlist_added"], 3, "{result}");
    let rows = state.app.watchlist_repo.list(c).await.unwrap();
    assert_eq!(rows.len(), 3);
    let library_title = rows.iter().find(|r| r.title == "Sample Movie Alpha").unwrap();
    assert_eq!(
        library_title.work_id,
        Some(lib.movie_alpha.id),
        "linked to the local work"
    );
    assert!(rows
        .iter()
        .find(|r| r.title == "Future Show")
        .unwrap()
        .work_id
        .is_none());
    assert!(state
        .app
        .watchlist_repo
        .list(b)
        .await
        .unwrap()
        .iter()
        .all(|r| r.title == "Only Bs"));

    let (_, again) = api.apply(&token_c, &bytes, "").await;
    assert_eq!(again["watchlist_added"], 0);
    assert_eq!(again["watchlist_already_present"], 3);
    assert_eq!(state.app.watchlist_repo.list(c).await.unwrap().len(), 3);

    // An unknown kind from a future version is kept recoverable, not dropped.
    let doc = serde_json::json!({
        "format": "playarr.user-data", "schema_version": 1, "generated_at": "2026-09-01T20:00:00Z",
        "watchlist": [{"item": {"kind": "hologram", "title": "Tomorrow"}, "added_at": "2026-09-01T20:00:00Z"}]
    });
    let (_, result) = api.apply(&token_c, doc.to_string().as_bytes(), "").await;
    assert_eq!(result["unmatched_total"], 1);
}
