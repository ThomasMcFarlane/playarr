//! End-to-end tests for unsorted folders: fixture directory trees with tiny
//! generated media (ffmpeg), the scanner, the viewer and admin routes, access
//! control, live events and playback through the existing routes.
//!
//! Media is generated, never real: `Sample Clip 01.mp4` and friends are a
//! second of a test pattern. Tests that need ffmpeg skip (with a message) on
//! hosts without it.

use std::path::Path;
use std::process::Command;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use playarr_model::{Sensitive, SourceInstance, SourceKind};
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::test_support::{
    bearer_header, mint_access_token, seed_admin_user, seed_policy_user,
    seed_streaming_user_with_library_allow, test_state, TestState,
};

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok_and(|out| out.status.success())
        && Command::new("ffprobe")
            .arg("-version")
            .output()
            .is_ok_and(|out| out.status.success())
}

macro_rules! require_ffmpeg {
    () => {
        if !ffmpeg_available() {
            eprintln!("skipping: ffmpeg/ffprobe not installed");
            return;
        }
    };
}

/// One second of test pattern plus a sine tone. `seed` varies the picture so
/// two files never share bytes.
fn make_video(path: &Path, seed: u32) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
        .arg(format!("testsrc=size=64x48:rate=5:decimals={}", seed % 10))
        .args(["-f", "lavfi", "-i"])
        .arg(format!("sine=frequency={}", 300 + seed))
        .args(["-t", "1", "-c:v", "mpeg4", "-c:a", "mp2"])
        .arg(path)
        .status()
        .expect("run ffmpeg");
    assert!(status.success(), "ffmpeg failed for {}", path.display());
}

fn make_audio(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let status = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
        ])
        .args(["-t", "1", "-metadata", "title=Sample Track"])
        .arg(path)
        .status()
        .expect("run ffmpeg");
    assert!(status.success());
}

/// A fixture library:
///
/// ```text
/// Sample Clip 01.mp4
/// Season A/Sample Clip 02.mkv
/// Season A/notes.txt
/// Season A/Deep/Sample Clip 04.mp4
/// Audio Only/Sample Track.mp3        (ignored in a video root)
/// Broken.mp4                          (not media: skipped)
/// .hidden/Sample Clip 03.mp4          (hidden: ignored)
/// ```
fn build_tree(root: &Path) {
    make_video(&root.join("Sample Clip 01.mp4"), 1);
    make_video(&root.join("Season A/Sample Clip 02.mkv"), 2);
    make_video(&root.join("Season A/Deep/Sample Clip 04.mp4"), 4);
    std::fs::write(root.join("Season A/notes.txt"), b"not media").unwrap();
    make_audio(&root.join("Audio Only/Sample Track.mp3"));
    std::fs::write(root.join("Broken.mp4"), b"this is not a video").unwrap();
    make_video(&root.join(".hidden/Sample Clip 03.mp4"), 3);
}

async fn call(
    router: &Router,
    token: Option<&str>,
    http_method: Method,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(http_method).uri(uri);
    if let Some(token) = token {
        builder = builder.header("Authorization", bearer_header(token));
    }
    let mut request = match body {
        Some(body) => builder
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    request
        .extensions_mut()
        .insert(ConnectInfo(std::net::SocketAddr::from((
            [127, 0, 0, 1],
            5000,
        ))));
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn get(router: &Router, token: &str, uri: &str) -> (StatusCode, Value) {
    call(router, Some(token), Method::GET, uri, None).await
}

fn radarr_source(base_url: &str) -> SourceInstance {
    SourceInstance {
        id: Uuid::new_v4(),
        kind: SourceKind::Radarr,
        name: "Sample Library".into(),
        base_url: base_url.into(),
        api_key_encrypted: Sensitive::new("test-key".into()),
        priority: 0,
        default_root_folder_id: None,
        folder_mappings: Default::default(),
        default_quality_profile_id: None,
        best_effort: false,
        group_library_id: None,
    }
}

async fn add_source(state: &TestState, source: &SourceInstance) {
    state.app.source_instance_repo.upsert(source).await.unwrap();
    state.source_instances.upsert(source.clone());
}

struct Fixture {
    router: Router,
    state: TestState,
    admin: String,
    viewer: String,
    source: SourceInstance,
    tree: tempfile::TempDir,
}

async fn fixture() -> Fixture {
    let (router, state) = test_state().await;
    let admin_id = Uuid::new_v4();
    seed_admin_user(&state, admin_id).await;
    let viewer_id = Uuid::new_v4();
    let source = radarr_source("https://source.invalid");
    add_source(&state, &source).await;
    seed_streaming_user_with_library_allow(&state, viewer_id, vec![source.id]).await;
    let tree = tempfile::tempdir().unwrap();
    Fixture {
        router,
        admin: mint_access_token(&state, admin_id),
        viewer: mint_access_token(&state, viewer_id),
        state,
        source,
        tree,
    }
}

impl Fixture {
    /// Adds `dir` as an enabled manual root without the background scan the
    /// admin route starts, then scans it once and returns that scan's summary.
    async fn add_root(&self, dir: &Path) -> (Uuid, Value) {
        let text = dir.to_string_lossy().into_owned();
        let id = crate::folder_scan::stable_id(self.source.id, &format!("manual:{text}"));
        self.state
            .app
            .folder_repo
            .upsert_root(&playarr_model::SourceRootFolder {
                id,
                source_instance_id: self.source.id,
                source_root_id: format!("manual:{text}"),
                reported_path: text,
                local_path_override: None,
                display_name: "Sample Unsorted".into(),
                work_kind: playarr_model::WorkKind::Movie,
                accessible: true,
                free_space_bytes: None,
                total_space_bytes: None,
                active: true,
                scan_enabled: true,
                scan_status: playarr_model::FolderScanStatus::Pending,
                last_scanned_at: None,
                scan_error: None,
                updated_at: chrono::Utc::now(),
            })
            .await
            .unwrap();
        (id, self.scan(id).await)
    }

    async fn scan(&self, root: Uuid) -> Value {
        // The create call also starts a background scan; wait it out so the
        // explicit scan below is the one that reports.
        for _ in 0..200 {
            if !crate::folder_scan::is_scanning(root) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        let (status, body) = call(
            &self.router,
            Some(&self.admin),
            Method::POST,
            &format!("/api/v1/admin/folders/roots/{root}/scan"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body
    }

    async fn register_media_files(&self, root: Uuid) {
        for entry in self
            .state
            .app
            .folder_repo
            .list_entries_under(root, "")
            .await
            .unwrap()
        {
            let file = self
                .state
                .media_file_repo
                .get_by_id(entry.media_file_id)
                .await
                .unwrap();
            self.state.media_files.insert(file);
        }
    }

    async fn browse(&self, token: &str, root: Uuid, query: &str) -> (StatusCode, Value) {
        get(
            &self.router,
            token,
            &format!("/api/v1/folders/roots/{root}/browse{query}"),
        )
        .await
    }
}

fn names(body: &Value) -> Vec<String> {
    body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn scan_is_incremental_skips_junk_and_publishes_one_event_per_change() {
    require_ffmpeg!();
    let fx = fixture().await;
    build_tree(fx.tree.path());
    let (root, summary) = fx.add_root(fx.tree.path()).await;

    // Three real videos; the broken file is skipped; hidden, text and audio
    // files never reach the probe.
    assert_eq!(summary["added"], 3, "{summary}");
    assert_eq!(summary["skipped"], 1);
    assert_eq!(summary["removed"], 0);

    let again = fx.scan(root).await;
    assert_eq!(again["unchanged"], 3);
    assert_eq!(again["added"], 0);
    assert_eq!(again["updated"], 0);

    make_video(&fx.tree.path().join("Season A/Sample Clip 05.mp4"), 5);
    std::fs::remove_file(fx.tree.path().join("Sample Clip 01.mp4")).unwrap();
    make_video(&fx.tree.path().join("Season A/Sample Clip 02.mkv"), 22);
    let changed = fx.scan(root).await;
    assert_eq!(changed["added"], 1, "{changed}");
    assert_eq!(changed["removed"], 1);
    assert_eq!(changed["updated"], 1);
    assert_eq!(changed["unchanged"], 1);

    // Folder-backing works never leak into the catalogue.
    let (status, page) = get(&fx.router, &fx.admin, "/api/v1/catalog?kind=movie").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["total"], 0, "{page}");

    // Live events: one library event per scan that changed something, scoped
    // to the source's library.
    let events = fx
        .state
        .app
        .live_events
        .repo()
        .list_after(0, 100)
        .await
        .unwrap();
    let folder_events: Vec<_> = events
        .iter()
        .filter(|e| e.kind == "library" && e.entity == "folder_root")
        .collect();
    assert_eq!(folder_events.len(), 2, "first scan and the changing rescan");
    assert!(folder_events
        .iter()
        .all(|e| e.source_instance_id == Some(fx.source.id)
            && e.entity_id.as_deref() == Some(&root.to_string())));
}

#[tokio::test]
async fn files_managed_by_a_source_are_not_unsorted() {
    require_ffmpeg!();
    let fx = fixture().await;
    build_tree(fx.tree.path());
    // The source application already imported one of the files.
    let managed = fx
        .tree
        .path()
        .canonicalize()
        .unwrap()
        .join("Sample Clip 01.mp4");
    let work = crate::test_support::seed_movie(&fx.state, "Managed Sample").await;
    let mut file = playarr_model::MediaFile {
        id: Uuid::new_v4(),
        work_id: work,
        leaf_ref: playarr_model::media::LeafRef::Work,
        path: managed,
        container: "mp4".into(),
        codec: "mpeg4".into(),
        bitrate: None,
        duration_ms: None,
        size_bytes: 1,
        source_instance_id: fx.source.id,
        source_file_id: Some("42".into()),
    };
    file.size_bytes = 1;
    fx.state.media_file_repo.create(&file).await.unwrap();

    let (root, summary) = fx.add_root(fx.tree.path()).await;
    assert_eq!(summary["added"], 2, "{summary}");
    let (_, body) = fx.browse(&fx.viewer, root, "").await;
    assert!(!names(&body).contains(&"Sample Clip 01.mp4".to_string()));
}

#[tokio::test]
async fn viewers_browse_search_sort_page_and_see_resume_state() {
    require_ffmpeg!();
    let fx = fixture().await;
    build_tree(fx.tree.path());
    let (root, _) = fx.add_root(fx.tree.path()).await;
    fx.register_media_files(root).await;

    let (status, roots) = get(&fx.router, &fx.viewer, "/api/v1/folders/roots?kind=movie").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(roots["roots"][0]["name"], "Sample Unsorted");
    assert_eq!(roots["roots"][0]["item_count"], 3);
    assert_eq!(roots["roots"][0]["available"], true);
    // No server path is ever exposed to viewers.
    assert!(!roots
        .to_string()
        .contains(&fx.tree.path().to_string_lossy().to_string()));
    let (_, wrong_kind) = get(&fx.router, &fx.viewer, "/api/v1/folders/roots?kind=artist").await;
    assert!(wrong_kind["roots"].as_array().unwrap().is_empty());

    let (status, top) = fx.browse(&fx.viewer, root, "").await;
    assert_eq!(status, StatusCode::OK, "{top}");
    assert_eq!(names(&top), vec!["Season A", "Sample Clip 01.mp4"]);
    assert_eq!(top["entries"][0]["entry_type"], "directory");
    assert_eq!(top["entries"][0]["item_count"], 2);
    assert_eq!(top["breadcrumbs"].as_array().unwrap().len(), 1);
    let clip = &top["entries"][1];
    assert_eq!(clip["entry_type"], "media");
    assert_eq!(clip["title"], "Sample Clip 01");
    assert_eq!(clip["container"], "mp4");
    assert_eq!(clip["video_codec"], "mpeg4");
    assert_eq!(clip["width"], 64);
    assert!(clip["duration_ms"].as_u64().unwrap() >= 900);

    let (_, nested) = fx.browse(&fx.viewer, root, "?path=Season%20A").await;
    assert_eq!(names(&nested), vec!["Deep", "Sample Clip 02.mkv"]);
    assert_eq!(nested["breadcrumbs"][1]["name"], "Season A");
    assert_eq!(nested["breadcrumbs"][1]["path"], "Season A");
    let (_, deep) = fx.browse(&fx.viewer, root, "?path=Season%20A/Deep").await;
    assert_eq!(names(&deep), vec!["Sample Clip 04.mp4"]);

    // Filters, sort and paging.
    let (_, found) = fx.browse(&fx.viewer, root, "?q=season").await;
    assert_eq!(names(&found), vec!["Season A"]);
    let (_, only_media) = fx.browse(&fx.viewer, root, "?type=media").await;
    assert_eq!(names(&only_media), vec!["Sample Clip 01.mp4"]);
    let (_, only_dirs) = fx.browse(&fx.viewer, root, "?type=directories").await;
    assert_eq!(names(&only_dirs), vec!["Season A"]);
    let (_, by_size) = fx
        .browse(&fx.viewer, root, "?path=Season%20A&sort=size&order=desc")
        .await;
    assert_eq!(names(&by_size)[0], "Deep");
    let (_, page) = fx.browse(&fx.viewer, root, "?limit=1&offset=1").await;
    assert_eq!(names(&page), vec!["Sample Clip 01.mp4"]);
    assert_eq!(page["total"], 2);

    // Traversal and unknown folders.
    for bad in ["?path=..", "?path=a/../b", "?path=a%5Cb"] {
        assert_eq!(
            fx.browse(&fx.viewer, root, bad).await.0,
            StatusCode::BAD_REQUEST,
            "{bad}"
        );
    }
    assert_eq!(
        fx.browse(&fx.viewer, root, "?path=Nope").await.0,
        StatusCode::NOT_FOUND
    );

    // Resume: progress recorded through the normal route shows in the listing.
    let media_id = clip["media_file_id"].as_str().unwrap().to_string();
    let (status, _) = call(
        &fx.router,
        Some(&fx.viewer),
        Method::PUT,
        &format!("/api/v1/playback/{media_id}/progress"),
        Some(json!({"position_ms": 400, "duration_ms": 1000, "completed": false})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, resumed) = fx.browse(&fx.viewer, root, "?type=media").await;
    assert_eq!(resumed["entries"][0]["watch_state"], "part_watched");
    assert_eq!(resumed["entries"][0]["position_ms"], 400);
}

#[tokio::test]
async fn folder_items_play_through_the_existing_pipeline() {
    require_ffmpeg!();
    let fx = fixture().await;
    build_tree(fx.tree.path());
    let (root, _) = fx.add_root(fx.tree.path()).await;
    fx.register_media_files(root).await;
    let (_, top) = fx.browse(&fx.viewer, root, "?type=media").await;
    let id = top["entries"][0]["media_file_id"]
        .as_str()
        .unwrap()
        .to_string();

    let (status, info) = get(&fx.router, &fx.viewer, &format!("/api/v1/playback/{id}")).await;
    assert_eq!(status, StatusCode::OK, "{info}");
    // Negotiation succeeded for a folder item: a playable URL and an audio
    // track list were produced from the file itself.
    assert!(
        info["url"].as_str().is_some_and(|u| !u.is_empty()),
        "{info}"
    );
    assert!(
        info["duration_ms"].as_u64().is_some_and(|d| d >= 900),
        "{info}"
    );
    assert!(
        !info["audio_tracks"].as_array().unwrap().is_empty(),
        "{info}"
    );
    let response = fx
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/media/{id}/stream"))
                .header("Authorization", bearer_header(&fx.viewer))
                .header("Range", "bytes=0-15")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(bytes.len(), 16);

    // Keep the generated frame out of the working tree.
    let cache = tempfile::tempdir().unwrap();
    std::env::set_var("PLAYARR_ARTWORK_CACHE_DIR", cache.path());
    let thumbnail = top["entries"][0]["thumbnail_url"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(thumbnail.contains(&id));
    let response = fx
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(thumbnail.as_str())
                .header("Authorization", bearer_header(&fx.viewer))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn library_household_and_folder_rules_gate_browsing_and_playback() {
    require_ffmpeg!();
    let fx = fixture().await;
    build_tree(fx.tree.path());
    let (root, _) = fx.add_root(fx.tree.path()).await;
    fx.register_media_files(root).await;
    let (_, top) = fx.browse(&fx.viewer, root, "?type=media").await;
    let id = top["entries"][0]["media_file_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Unauthenticated callers get nothing.
    assert_eq!(
        call(&fx.router, None, Method::GET, "/api/v1/folders/roots", None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    // A user restricted to another library neither sees the root nor can
    // browse or play it.
    let other = Uuid::new_v4();
    seed_policy_user(&fx.state, other, |policy| {
        policy.library_allow = vec![Uuid::new_v4()];
    })
    .await;
    let other_token = mint_access_token(&fx.state, other);
    let (_, roots) = get(&fx.router, &other_token, "/api/v1/folders/roots").await;
    assert!(roots["roots"].as_array().unwrap().is_empty());
    assert_eq!(
        fx.browse(&other_token, root, "").await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get(&fx.router, &other_token, &format!("/api/v1/playback/{id}"))
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    // A profile under rating rules gets no unrated folder content.
    let child = Uuid::new_v4();
    let source_id = fx.source.id;
    seed_policy_user(&fx.state, child, |policy| {
        policy.library_allow = vec![source_id];
        policy.max_rating = Some("PG".into());
    })
    .await;
    let child_token = mint_access_token(&fx.state, child);
    let (_, roots) = get(&fx.router, &child_token, "/api/v1/folders/roots").await;
    assert!(roots["roots"].as_array().unwrap().is_empty());
    let (status, body) = fx.browse(&child_token, root, "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "household_blocked");
    assert_eq!(
        get(&fx.router, &child_token, &format!("/api/v1/playback/{id}"))
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    // A blocked folder hides its files from listings and playback.
    let blocked = fx.tree.path().canonicalize().unwrap().join("Season A");
    let careful = Uuid::new_v4();
    seed_policy_user(&fx.state, careful, |policy| {
        policy.library_allow = vec![source_id];
        policy.blocked_folders = vec![blocked.to_string_lossy().into_owned()];
    })
    .await;
    let careful_token = mint_access_token(&fx.state, careful);
    let (_, top) = fx.browse(&careful_token, root, "").await;
    assert_eq!(names(&top), vec!["Sample Clip 01.mp4"]);
    assert_eq!(
        fx.browse(&careful_token, root, "?path=Season%20A").await.0,
        StatusCode::NOT_FOUND
    );
    let hidden_id = fx
        .state
        .app
        .folder_repo
        .list_entries_under(root, "Season A")
        .await
        .unwrap()[0]
        .media_file_id;
    assert_eq!(
        get(
            &fx.router,
            &careful_token,
            &format!("/api/v1/playback/{hidden_id}")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn admin_controls_which_folders_are_scanned_and_who_can_manage_them() {
    require_ffmpeg!();
    let fx = fixture().await;
    build_tree(fx.tree.path());
    let (root, _) = fx.add_root(fx.tree.path()).await;
    let uri = format!("/api/v1/admin/folders/roots/{root}");

    // Admin-only.
    assert_eq!(
        get(&fx.router, &fx.viewer, "/api/v1/admin/folders/roots")
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (_, list) = get(&fx.router, &fx.admin, "/api/v1/admin/folders/roots").await;
    assert_eq!(list["roots"][0]["manual"], true);
    assert_eq!(list["roots"][0]["scan_status"], "ready");
    assert_eq!(list["roots"][0]["item_count"], 3);
    assert_eq!(list["roots"][0]["path_available"], true);

    // Validation.
    let create = |path: &str, source: Uuid| json!({"source_instance_id": source, "path": path});
    for (body, expected) in [
        (
            create("relative/dir", fx.source.id),
            StatusCode::BAD_REQUEST,
        ),
        (create("/srv/../etc", fx.source.id), StatusCode::BAD_REQUEST),
        (
            create("/srv/media", Uuid::new_v4()),
            StatusCode::BAD_REQUEST,
        ),
        (
            create(&fx.tree.path().to_string_lossy(), fx.source.id),
            StatusCode::CONFLICT,
        ),
    ] {
        let (status, _) = call(
            &fx.router,
            Some(&fx.admin),
            Method::POST,
            "/api/v1/admin/folders/roots",
            Some(body),
        )
        .await;
        assert_eq!(status, expected);
    }

    // Disabling hides the root from viewers without losing its cache.
    let (status, body) = call(
        &fx.router,
        Some(&fx.admin),
        Method::PATCH,
        &uri,
        Some(json!({"scan_enabled": false})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, roots) = get(&fx.router, &fx.viewer, "/api/v1/folders/roots").await;
    assert!(roots["roots"].as_array().unwrap().is_empty());
    assert_eq!(
        fx.browse(&fx.viewer, root, "").await.0,
        StatusCode::NOT_FOUND
    );
    let (_, list) = get(&fx.router, &fx.admin, "/api/v1/admin/folders/roots").await;
    assert_eq!(list["roots"][0]["item_count"], 3);

    // Re-pointing at a missing directory fails the next scan visibly.
    let (_, body) = call(
        &fx.router,
        Some(&fx.admin),
        Method::PATCH,
        &uri,
        Some(json!({"scan_enabled": true, "local_path": "/nonexistent/sample-root"})),
    )
    .await;
    assert_eq!(body["path_available"], false);
    for _ in 0..200 {
        if !crate::folder_scan::is_scanning(root) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let (status, body) = call(
        &fx.router,
        Some(&fx.admin),
        Method::POST,
        &format!("{uri}/scan"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (_, list) = get(&fx.router, &fx.admin, "/api/v1/admin/folders/roots").await;
    assert_eq!(list["roots"][0]["scan_status"], "failed");
    assert!(list["roots"][0]["scan_error"]
        .as_str()
        .unwrap()
        .contains("not available"));

    // Clearing the override restores the original directory.
    let (_, body) = call(
        &fx.router,
        Some(&fx.admin),
        Method::PATCH,
        &uri,
        Some(json!({"local_path": ""})),
    )
    .await;
    assert_eq!(body["path_available"], true);
    assert!(body["local_path"].is_null());

    // Deleting a manual root removes its files too.
    let (status, _) = call(&fx.router, Some(&fx.admin), Method::DELETE, &uri, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        fx.state.app.folder_repo.count_entries(root).await.unwrap(),
        0
    );
    assert!(fx
        .state
        .media_file_repo
        .list_all()
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn roots_are_discovered_from_the_source_and_start_disabled() {
    require_ffmpeg!();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v3/rootfolder"))
        .and(header("X-Api-Key", "test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"id": 1, "path": "/library/sample-movies", "accessible": true,
             "freeSpace": 10, "totalSpace": 20}
        ])))
        .mount(&server)
        .await;
    let (router, state) = test_state().await;
    let admin_id = Uuid::new_v4();
    seed_admin_user(&state, admin_id).await;
    let viewer_id = Uuid::new_v4();
    let source = radarr_source(&server.uri());
    add_source(&state, &source).await;
    seed_streaming_user_with_library_allow(&state, viewer_id, vec![source.id]).await;
    let admin = mint_access_token(&state, admin_id);
    let viewer = mint_access_token(&state, viewer_id);

    let (status, list) = call(
        &router,
        Some(&admin),
        Method::POST,
        "/api/v1/admin/folders/discover",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["roots"].as_array().unwrap().len(), 1);
    let discovered = &list["roots"][0];
    assert_eq!(discovered["name"], "sample-movies");
    assert_eq!(discovered["manual"], false);
    assert_eq!(discovered["scan_enabled"], false);
    assert_eq!(discovered["path_available"], false);
    let id = discovered["id"].as_str().unwrap().to_string();

    // Not offered to viewers until enabled; reported roots cannot be deleted.
    let (_, roots) = get(&router, &viewer, "/api/v1/folders/roots").await;
    assert!(roots["roots"].as_array().unwrap().is_empty());
    let (status, _) = call(
        &router,
        Some(&admin),
        Method::DELETE,
        &format!("/api/v1/admin/folders/roots/{id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Map it to a local fixture directory and enable it.
    let tree = tempfile::tempdir().unwrap();
    make_video(&tree.path().join("Sample Clip 01.mp4"), 1);
    let (status, body) = call(
        &router,
        Some(&admin),
        Method::PATCH,
        &format!("/api/v1/admin/folders/roots/{id}"),
        Some(json!({"scan_enabled": true, "local_path": tree.path().to_string_lossy()})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for _ in 0..200 {
        let (_, roots) = get(&router, &viewer, "/api/v1/folders/roots").await;
        if roots["roots"][0]["item_count"] == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let (_, roots) = get(&router, &viewer, "/api/v1/folders/roots").await;
    assert_eq!(roots["roots"][0]["item_count"], 1, "{roots}");

    // A second discovery keeps the admin's configuration.
    let (_, list) = call(
        &router,
        Some(&admin),
        Method::POST,
        "/api/v1/admin/folders/discover",
        None,
    )
    .await;
    assert_eq!(list["roots"][0]["scan_enabled"], true);
    assert!(list["roots"][0]["local_path"].is_string());
}

#[tokio::test]
async fn viewer_root_list_never_shows_the_admin_instance_name() {
    let (router, state) = test_state().await;
    let admin_id = Uuid::new_v4();
    seed_admin_user(&state, admin_id).await;
    let viewer_id = Uuid::new_v4();
    let mut source = radarr_source("https://source.invalid");
    source.name = "Radarr 4K".into();
    add_source(&state, &source).await;
    seed_streaming_user_with_library_allow(&state, viewer_id, vec![source.id]).await;
    let tree = tempfile::tempdir().unwrap();
    let text = tree.path().to_string_lossy().into_owned();
    state
        .app
        .folder_repo
        .upsert_root(&playarr_model::SourceRootFolder {
            id: Uuid::new_v4(),
            source_instance_id: source.id,
            source_root_id: format!("manual:{text}"),
            reported_path: text,
            local_path_override: None,
            display_name: "Sample Unsorted".into(),
            work_kind: playarr_model::WorkKind::Movie,
            accessible: true,
            free_space_bytes: None,
            total_space_bytes: None,
            active: true,
            scan_enabled: true,
            scan_status: playarr_model::FolderScanStatus::Ready,
            last_scanned_at: Some(chrono::Utc::now()),
            scan_error: None,
            updated_at: chrono::Utc::now(),
        })
        .await
        .unwrap();

    let viewer = mint_access_token(&state, viewer_id);
    let (status, roots) = get(&router, &viewer, "/api/v1/folders/roots").await;
    assert_eq!(status, StatusCode::OK, "{roots}");
    assert_eq!(roots["roots"][0]["display_label"], "Movies");
    assert_eq!(roots["roots"][0]["source_name"], "Movies");
    assert!(
        !roots.to_string().to_lowercase().contains("radarr"),
        "{roots}"
    );

    // Admins still get the real name on the admin route.
    let admin = mint_access_token(&state, admin_id);
    let (_, admin_roots) = get(&router, &admin, "/api/v1/admin/folders/roots").await;
    assert_eq!(admin_roots["roots"][0]["source_name"], "Radarr 4K");
}
