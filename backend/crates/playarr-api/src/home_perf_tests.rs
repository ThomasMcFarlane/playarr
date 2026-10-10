//! Home rails and Library browse performance: a realistic generated library,
//! per-request statement counts and pinned bounds.
//!
//! The fixture reuses the calendar one (series with seasons, episodes and
//! files; movies; peer availability; watch progress) and adds artists, posters,
//! genres, scores and collections, so each work row is as heavy as a synced
//! one. `profile_home_and_library` prints the numbers (run it with
//! `--ignored --nocapture`); the other tests pin how many SQL statements a
//! cold request costs, so a per-item query or a repeated scan cannot return.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use tracing_subscriber::layer::SubscriberExt;
use uuid::Uuid;

use crate::calendar_perf_tests::{
    build_fixture, Fixture, Probe, Scale, StatementLayer, STATEMENTS,
};
use crate::test_support::{bearer_header, test_state, TestState};

/// Adds artists and gives every work a poster, backdrop, overview, genres,
/// a score and (for movies) a collection, like a synced catalogue row.
pub(crate) async fn enrich(state: &TestState, fx: &Fixture, artists: usize) {
    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = state.pool.begin().await.unwrap();
    for i in 0..artists {
        let work = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, monitored, availability) \
             VALUES (?, 'artist', ?, ?, ?, 1, 'available')",
        )
        .bind(work.to_string())
        .bind(format!("Sample Artist {i}"))
        .bind(format!("sample artist {i}"))
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();
        for t in 0..12 {
            sqlx::query(
                "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
                 VALUES (?, ?, ?, '/media/t.flac', 'flac', 'flac', 900000, 200000, 1000, ?, ?)",
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(work.to_string())
            .bind(format!("track:{}", uuid::Uuid::new_v4()))
            .bind(fx.instance.id.to_string())
            .bind(format!("a{i}-{t}"))
            .execute(&mut *tx)
            .await
            .unwrap();
        }
    }
    // Same shape as arr-sync writes: image list, genres, tags, release date.
    sqlx::query(
        "UPDATE works SET \
           overview = 'A generated overview of a sample title that runs to a couple of sentences, like synced metadata does.', \
           images = '[{\"kind\":\"poster\",\"url\":\"https://img.example.com/p.jpg\",\"width\":600,\"height\":900},{\"kind\":\"backdrop\",\"url\":\"https://img.example.com/b.jpg\",\"width\":1920,\"height\":1080}]', \
           genres = '[\"Drama\",\"Comedy\"]', \
           tags = '[\"score:7.4:1200\",\"collection:42:Sample Collection\"]', \
           release_date = ? \
         WHERE kind IN ('movie','series')",
    )
    .bind((chrono::Utc::now() - chrono::Duration::days(400)).to_rfc3339())
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

pub(crate) async fn get(router: &axum::Router, token: &str, uri: &str) -> (StatusCode, usize) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("Authorization", bearer_header(token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, bytes.len())
}

pub(crate) const HOME: &str = "/api/v1/home/rails?lang=en";
/// What the Library screen asks for first (movies, title order, 50 rows).
pub(crate) const LIBRARY: &str =
    "/api/v1/catalog?kind=movie&available_only=true&sort=title&order=asc&limit=50";
pub(crate) const LIBRARY_SERIES: &str =
    "/api/v1/catalog?kind=series&available_only=true&sort=title&order=asc&limit=50";
/// Home also asks for the site rail.
pub(crate) const SITE: &str = "/api/v1/catalog?kind=site&available_only=true&sort=recent&limit=36";

#[tokio::test]
#[ignore = "profiling run; prints statements and timings"]
async fn profile_home_and_library() {
    let _ = tracing::subscriber::set_global_default(
        tracing_subscriber::registry().with(StatementLayer),
    );
    let (router, state) = test_state().await;
    let fx = build_fixture(&state, Scale::REALISTIC).await;
    enrich(&state, &fx, 300).await;
    let (probe, _guard) = Probe::install(&state);
    for (who, token) in [("admin", &fx.admin_token), ("viewer", &fx.viewer_token)] {
        for (name, uri) in [
            ("home", HOME),
            ("library", LIBRARY),
            ("series", LIBRARY_SERIES),
            ("site", SITE),
            ("plans", "/api/v1/playback/resume-plans"),
            ("progress", "/api/v1/playback/progress"),
        ] {
            *STATEMENTS.lock().unwrap() = Some(Default::default());
            probe.reset();
            let started = std::time::Instant::now();
            let (status, bytes) = get(&router, token, uri).await;
            let cold = started.elapsed();
            let statements = probe.statements();
            let mut by_text: Vec<(String, usize)> = STATEMENTS
                .lock()
                .unwrap()
                .take()
                .unwrap_or_default()
                .into_iter()
                .collect();
            by_text.sort_by_key(|a| std::cmp::Reverse(a.1));
            probe.reset();
            let started = std::time::Instant::now();
            let _ = get(&router, token, uri).await;
            let warm = started.elapsed();
            eprintln!(
                "{who:6} {name:8} {status} {:4} KB  cold {cold:>9.1?}  warm {warm:>9.1?}  sql {statements}",
                bytes / 1024
            );
            for (sql, n) in by_text.iter().take(8) {
                eprintln!("    {n:4} x {sql}");
            }
        }
    }
}

async fn get_json(router: &axum::Router, token: &str, uri: &str) -> serde_json::Value {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("Authorization", bearer_header(token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "{uri}");
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// Statements a cold request costs once the catalogue snapshot exists.
const HOME_BOUND: usize = 8;
const LIBRARY_BOUND: usize = 6;

/// A cold Home or Library request runs a fixed handful of statements (the
/// session check, the viewer's own rows and the page's availability) however
/// large the library is: the catalogue itself is read from the in-memory
/// snapshot. Before it, Home scanned the works, the file ids and the
/// work/source pairs once per library (19 to 22 statements, three full scans of
/// each) and a Library page scanned them all again.
#[tokio::test]
async fn cold_home_and_library_statement_counts_do_not_grow_with_the_library() {
    let bigger = Scale {
        series: 120,
        movies: 100,
        calendar_series: 24,
        in_library: 14,
        calendar_movies: 8,
        ..Scale::SMALL
    };
    for scale in [Scale::SMALL, bigger] {
        let (router, state) = test_state().await;
        let fx = build_fixture(&state, scale).await;
        enrich(&state, &fx, 20).await;
        let (probe, _guard) = Probe::install(&state);
        // The first request builds the snapshot (the server does it at start).
        let _ = get(&router, &fx.viewer_token, HOME).await;
        for token in [&fx.viewer_token, &fx.admin_token] {
            let user = if token == &fx.viewer_token {
                fx.viewer_id
            } else {
                fx.admin_id
            };
            state.app.home_rails_cache.invalidate_user(user).await;
            probe.reset();
            let (status, _) = get(&router, token, HOME).await;
            assert_eq!(status, StatusCode::OK);
            assert!(
                probe.statements() <= HOME_BOUND,
                "cold Home: {} statements",
                probe.statements()
            );
            for (i, uri) in [LIBRARY, LIBRARY_SERIES, SITE].iter().enumerate() {
                // A page not asked for before, so the page cache cannot answer.
                let uri = format!("{uri}&offset={}", i + 1);
                probe.reset();
                let (status, _) = get(&router, token, &uri).await;
                assert_eq!(status, StatusCode::OK);
                assert!(
                    probe.statements() <= LIBRARY_BOUND,
                    "cold {uri}: {} statements",
                    probe.statements()
                );
            }
        }
    }
}

/// Resume plans cost a fixed number of statements per series, not one per
/// episode: before, every episode looked up its file on its own (803
/// statements for 20 series of 30 episodes).
#[tokio::test]
async fn resume_plans_cost_a_few_statements_per_series() {
    let (router, state) = test_state().await;
    let fx = build_fixture(&state, Scale::SMALL).await;
    let (probe, _guard) = Probe::install(&state);
    let plans = get_json(&router, &fx.viewer_token, "/api/v1/playback/resume-plans").await;
    let series = plans.as_array().unwrap().len();
    assert!(
        series > 1,
        "the fixture should give the viewer history in several series"
    );
    probe.reset();
    let _ = get_json(&router, &fx.viewer_token, "/api/v1/playback/resume-plans").await;
    assert!(
        probe.statements() <= 12 * series + 4,
        "{} statements for {series} series",
        probe.statements()
    );
}

/// A library change makes the next read rebuild the snapshot; without one the
/// copy is reused.
#[tokio::test]
async fn catalogue_snapshot_follows_library_changes() {
    let (router, state) = test_state().await;
    let fx = build_fixture(&state, Scale::SMALL).await;
    let uri = "/api/v1/catalog?kind=movie&available_only=true&limit=500&sort=recent";
    let before = get_json(&router, &fx.admin_token, uri).await["total"]
        .as_i64()
        .unwrap();
    let work = crate::test_support::seed_movie(&state, "Fresh Import").await;
    sqlx::query(
        "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
         VALUES (?, ?, 'work', '/media/n.mkv', 'mkv', 'h264', 4000000, 6000000, 1000, ?, 'fresh-import')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(work.to_string())
    .bind(fx.instance.id.to_string())
    .execute(&state.pool)
    .await
    .unwrap();
    state.app.catalog.invalidate_snapshot();
    // A different page, so only the snapshot decides.
    let after = get_json(&router, &fx.admin_token, &format!("{uri}&offset=1")).await["total"]
        .as_i64()
        .unwrap();
    assert_eq!(after, before + 1);
    // Home is derived from the snapshot too, so it is recomputed after a rebuild.
    let home = get_json(&router, &fx.admin_token, HOME).await;
    assert!(home["rails"].as_array().is_some_and(|r| !r.is_empty()));
}
