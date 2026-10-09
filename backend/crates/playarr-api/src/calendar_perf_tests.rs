//! Calendar performance: a realistic generated library, per-stage timings
//! and pinned query counts.
//!
//! The fixture is generated here (no real data): a few thousand works with
//! episodes and files, peer availability rows, watch progress and a calendar
//! of a few hundred upcoming releases. `profile_calendar` prints the stage
//! timings (run it with `--ignored --nocapture`); the other tests pin how
//! many SQL statements a cold calendar costs, so an N+1 cannot come back.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Datelike, Duration as ChronoDuration, NaiveDate, Utc};
use playarr_arr_sync::calendar::CalendarCandidate;
use playarr_model::{
    CalendarEntry, CalendarEntrySource, CalendarMediaKind, CalendarReleaseType, ExternalProvider,
    Sensitive, SourceInstance, SourceKind,
};
use tower::ServiceExt;
use tracing::field::{Field, Visit};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::Layer;
use uuid::Uuid;

use crate::test_support::{
    bearer_header, mint_access_token, seed_admin_user, seed_streaming_user_with_library_allow,
    test_state, TestState,
};

/// Sizes of the generated library and calendar.
#[derive(Clone, Copy)]
pub(crate) struct Scale {
    pub series: usize,
    pub movies: usize,
    pub seasons: usize,
    pub episodes_per_season: usize,
    /// Distinct series with releases inside the window, of which the first
    /// `in_library` are in the library.
    pub calendar_series: usize,
    pub in_library: usize,
    pub calendar_movies: usize,
}

impl Scale {
    pub(crate) const REALISTIC: Scale = Scale {
        series: 1200,
        movies: 1500,
        seasons: 3,
        episodes_per_season: 10,
        calendar_series: 150,
        in_library: 90,
        calendar_movies: 60,
    };
    pub(crate) const SMALL: Scale = Scale {
        series: 60,
        movies: 40,
        seasons: 2,
        episodes_per_season: 4,
        calendar_series: 24,
        in_library: 14,
        calendar_movies: 8,
    };
}

pub(crate) struct Fixture {
    pub instance: SourceInstance,
    pub admin_token: String,
    pub viewer_token: String,
}

/// Generates the library, peers, events, progress and the calendar cache.
pub(crate) async fn build_fixture(state: &TestState, scale: Scale) -> Fixture {
    let admin = Uuid::new_v4();
    seed_admin_user(state, admin).await;
    let instance = SourceInstance {
        id: Uuid::new_v4(),
        kind: SourceKind::Sonarr,
        name: "TV".to_string(),
        base_url: "http://127.0.0.1:1".to_string(),
        api_key_encrypted: Sensitive::new("k".to_string()),
        priority: 0,
        default_root_folder_id: None,
        folder_mappings: Default::default(),
        default_quality_profile_id: None,
        best_effort: false,
        group_library_id: None,
    };
    state.source_instances.upsert(instance.clone());
    let library = instance.id;
    let viewer = Uuid::new_v4();
    seed_streaming_user_with_library_allow(state, viewer, vec![library]).await;

    let now = Utc::now().to_rfc3339();
    let mut tx = state.pool.begin().await.unwrap();
    let group = Uuid::new_v4();
    sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, 'g', ?)")
        .bind(group.to_string())
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();
    let peers: Vec<Uuid> = (0..3).map(|_| Uuid::new_v4()).collect();
    for (i, peer) in peers.iter().enumerate() {
        sqlx::query(
            "INSERT INTO peer_nodes (id, group_id, name, addresses, public_key, is_self, status, joined_at, updated_at) \
             VALUES (?, ?, ?, '[]', 'k', 0, 'active', ?, ?)",
        )
        .bind(peer.to_string())
        .bind(group.to_string())
        .bind(format!("peer-{i}"))
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();
    }

    let mut series_ids = Vec::new();
    let mut file_ids: Vec<Uuid> = Vec::new();
    let mut n_file = 0u64;
    for i in 0..scale.series {
        let work = Uuid::new_v4();
        series_ids.push(work);
        let tvdb = format!("{}", 100_000 + i);
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, monitored, availability) \
             VALUES (?, 'series', ?, ?, ?, 1, 'available')",
        )
        .bind(work.to_string())
        .bind(format!("Sample Series {i}"))
        .bind(format!("sample series {i}"))
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES (?, 'tvdb', ?)",
        )
        .bind(work.to_string())
        .bind(&tvdb)
        .execute(&mut *tx)
        .await
        .unwrap();
        for s in 1..=scale.seasons {
            let season = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO seasons (id, series_work_id, season_number, title, overview, monitored, availability) \
                 VALUES (?, ?, ?, NULL, NULL, 1, 'available')",
            )
            .bind(season.to_string())
            .bind(work.to_string())
            .bind(s as i64)
            .execute(&mut *tx)
            .await
            .unwrap();
            for e in 1..=scale.episodes_per_season {
                let episode = Uuid::new_v4();
                sqlx::query(
                    "INSERT INTO episodes (id, season_id, episode_number, title, overview, images, air_date, runtime_minutes, monitored, availability) \
                     VALUES (?, ?, ?, ?, NULL, '[]', NULL, 40, 1, 'available')",
                )
                .bind(episode.to_string())
                .bind(season.to_string())
                .bind(e as i64)
                .bind(format!("Episode {e}"))
                .execute(&mut *tx)
                .await
                .unwrap();
                // Seven in ten episodes have a file.
                if (i + s + e) % 10 < 7 {
                    n_file += 1;
                    let file = Uuid::new_v4();
                    file_ids.push(file);
                    sqlx::query(
                        "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
                         VALUES (?, ?, ?, '/media/f.mkv', 'mkv', 'h264', 4000000, 2400000, 1000, ?, ?)",
                    )
                    .bind(file.to_string())
                    .bind(work.to_string())
                    .bind(format!("episode:{episode}"))
                    .bind(library.to_string())
                    .bind(n_file.to_string())
                    .execute(&mut *tx)
                    .await
                    .unwrap();
                }
            }
        }
        // Half the series are reported by one or two peers.
        if i % 2 == 0 {
            for peer in peers.iter().take(1 + i % 2 + (i % 3 == 0) as usize) {
                sqlx::query(
                    "INSERT OR IGNORE INTO peer_leaf_availability (peer_node_id, provider, external_id, leaf_selector, availability, local_work_id, title, kind, updated_at) \
                     VALUES (?, 'tvdb', ?, '{\"Episode\":{\"season\":1,\"episode\":1}}', 'available', ?, 'x', 'series', ?)",
                )
                .bind(peer.to_string())
                .bind(&tvdb)
                .bind(work.to_string())
                .bind(&now)
                .execute(&mut *tx)
                .await
                .unwrap();
            }
        }
    }
    let mut movie_ids = Vec::new();
    for i in 0..scale.movies {
        let work = Uuid::new_v4();
        movie_ids.push(work);
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, monitored, availability) \
             VALUES (?, 'movie', ?, ?, ?, 1, 'available')",
        )
        .bind(work.to_string())
        .bind(format!("Test Movie {i}"))
        .bind(format!("test movie {i}"))
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO work_external_refs (work_id, provider, external_id) VALUES (?, 'tmdb', ?)",
        )
        .bind(work.to_string())
        .bind(format!("{}", 500_000 + i))
        .execute(&mut *tx)
        .await
        .unwrap();
        n_file += 1;
        sqlx::query(
            "INSERT INTO media_files (id, work_id, leaf_ref, path, container, codec, bitrate, duration_ms, size_bytes, source_instance_id, source_file_id) \
             VALUES (?, ?, 'work', '/media/m.mkv', 'mkv', 'h264', 4000000, 6000000, 1000, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(work.to_string())
        .bind(library.to_string())
        .bind(n_file.to_string())
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    // Grab/import history for the calendar's series.
    for i in 0..scale.calendar_series {
        for ep in 1..=30 {
            for kind in ["grab", "import"] {
                sqlx::query(
                    "INSERT OR IGNORE INTO availability_events (source_instance_id, provider, external_id, season_number, episode_number, item_id, event_type, occurred_at, air_at, is_upgrade) \
                     VALUES (?, 'tvdb', ?, 1, ?, ?, ?, ?, ?, 0)",
                )
                .bind(library.to_string())
                .bind(format!("{}", 100_000 + i))
                .bind(ep)
                .bind(ep)
                .bind(kind)
                .bind((Utc::now() - ChronoDuration::days(ep)).to_rfc3339())
                .bind((Utc::now() - ChronoDuration::days(ep + 1)).to_rfc3339())
                .execute(&mut *tx)
                .await
                .unwrap();
            }
        }
    }
    // The viewer has part-watched and watched a spread of files.
    for (i, file) in file_ids.iter().take(400).enumerate() {
        sqlx::query(
            "INSERT OR IGNORE INTO watch_progress (user_id, media_file_id, position_ms, duration_ms, state, updated_at) \
             VALUES (?, ?, ?, 2400000, ?, ?)",
        )
        .bind(viewer.to_string())
        .bind(file.to_string())
        .bind(60_000i64 * (i as i64 % 30))
        .bind(if i % 3 == 0 { "part_watched" } else { "watched" })
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();

    // The calendar: episodes across the window, newest releases first in
    // the cache. Series `0..in_library` are in the library.
    let today = Utc::now().date_naive();
    let mut by_month: std::collections::HashMap<String, Vec<CalendarCandidate>> =
        Default::default();
    let mut push = |c: CalendarCandidate| {
        let d = c.entry.date;
        by_month
            .entry(format!("{:04}-{:02}", d.year(), d.month()))
            .or_default()
            .push(c);
    };
    let src = |arr_id: i64| CalendarEntrySource {
        source_instance_id: library,
        source_name: "TV".to_string(),
        display_label: "Series".to_string(),
        source_kind: SourceKind::Sonarr,
        arr_id,
    };
    let mut arr_id = 1i64;
    for i in 0..scale.calendar_series {
        // Library series first, then ones that are not in the library.
        let (ext, title) = if i < scale.in_library {
            (format!("{}", 100_000 + i), format!("Sample Series {i}"))
        } else {
            (
                format!("{}", 900_000 + i),
                format!("Sample Series {}", 900_000 + i),
            )
        };
        for k in 0..((92 * 3) / (scale.calendar_series * 2 / 3).max(1)).max(2) {
            let date = today - ChronoDuration::days(3)
                + ChronoDuration::days(((i * 7 + k * 9) % 95) as i64);
            let (season, episode) = (
                1 + (k % scale.seasons) as i64,
                1 + ((i + k) % scale.episodes_per_season) as i64,
            );
            arr_id += 1;
            push(CalendarCandidate {
                entry: CalendarEntry {
                    id: format!("tvdb:{ext}:{season}:{episode}"),
                    media_kind: CalendarMediaKind::Episode,
                    release_type: CalendarReleaseType::Air,
                    title: title.clone(),
                    subtitle: Some(format!("Episode {episode}")),
                    season_number: Some(season),
                    episode_number: Some(episode),
                    date,
                    release_at: Some(date.and_hms_opt(20, 0, 0).unwrap().and_utc()),
                    monitored: true,
                    has_file: false,
                    poster_url: Some("https://img.example.com/p.jpg".to_string()),
                    work_id: None,
                    average_lag_seconds: None,
                    sources: vec![src(arr_id)],
                    snapshot: None,
                    actions: vec![],
                    members: vec![],
                },
                dedup_key: Some(format!("tvdb:{ext}:{season}:{episode}")),
                work_ref: Some((ExternalProvider::Tvdb, ext.clone())),
            });
        }
    }
    for i in 0..scale.calendar_movies {
        let ext = if i < scale.calendar_movies * 2 / 3 {
            format!("{}", 500_000 + i)
        } else {
            format!("{}", 800_000 + i)
        };
        let date = today + ChronoDuration::days(((i * 5) % 90) as i64);
        arr_id += 1;
        push(CalendarCandidate {
            entry: CalendarEntry {
                id: format!("tmdb:{ext}"),
                media_kind: CalendarMediaKind::Movie,
                release_type: CalendarReleaseType::Digital,
                title: format!("Test Movie {ext}"),
                subtitle: None,
                season_number: None,
                episode_number: None,
                date,
                release_at: None,
                monitored: true,
                has_file: false,
                poster_url: None,
                work_id: None,
                average_lag_seconds: None,
                sources: vec![src(arr_id)],
                snapshot: None,
                actions: vec![],
                members: vec![],
            },
            dedup_key: Some(format!("tmdb:{ext}")),
            work_ref: Some((ExternalProvider::Tmdb, ext)),
        });
    }
    for (month, entries) in by_month {
        state.app.calendar_cache.seed_chunk(library, month, entries);
    }

    Fixture {
        instance,
        admin_token: mint_access_token(state, admin),
        viewer_token: mint_access_token(state, viewer),
    }
}

/// Reads the statements the pool has run and records the stage timings the
/// calendar logs (those events come from the request's own task, so a
/// thread-local subscriber sees them).
#[derive(Clone)]
pub(crate) struct Probe {
    pool: Arc<AtomicUsize>,
    base: Arc<AtomicUsize>,
    pub stages: Arc<std::sync::Mutex<Vec<String>>>,
}

struct FieldText(String);
impl Visit for FieldText {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.push_str(&format!("{}={:?} ", field.name(), value));
    }
}

struct StageLayer(Arc<std::sync::Mutex<Vec<String>>>);

impl<S: tracing::Subscriber> Layer<S> for StageLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        if event
            .metadata()
            .target()
            .starts_with("playarr_api::calendar")
        {
            let mut text = FieldText(String::new());
            event.record(&mut text);
            self.0.lock().unwrap().push(text.0);
        }
    }
}

/// Counts statements by text (statement events come from the sqlite worker
/// threads, so this needs a global subscriber; the profiling test installs it).
static STATEMENTS: std::sync::Mutex<Option<std::collections::HashMap<String, usize>>> =
    std::sync::Mutex::new(None);

struct StatementLayer;

struct StatementText(String);
impl Visit for StatementText {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "db.statement" {
            self.0 = format!("{value:?}");
        }
    }
}

impl<S: tracing::Subscriber> Layer<S> for StatementLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        if event.metadata().target() == "sqlx::query" {
            let mut text = StatementText(String::new());
            event.record(&mut text);
            let sql: String = text
                .0
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(260)
                .collect();
            *STATEMENTS
                .lock()
                .unwrap()
                .get_or_insert_with(Default::default)
                .entry(sql)
                .or_default() += 1;
        }
    }
}

impl Probe {
    pub(crate) fn install(state: &TestState) -> (Self, tracing::subscriber::DefaultGuard) {
        let stages = Arc::new(std::sync::Mutex::new(Vec::new()));
        let guard = tracing::subscriber::set_default(
            tracing_subscriber::registry().with(StageLayer(stages.clone())),
        );
        let probe = Probe {
            pool: state.pool_acquisitions.clone(),
            base: Arc::new(AtomicUsize::new(0)),
            stages,
        };
        probe.reset();
        (probe, guard)
    }
    pub(crate) fn reset(&self) {
        self.base
            .store(self.pool.load(Ordering::Relaxed), Ordering::Relaxed);
        self.stages.lock().unwrap().clear();
    }
    /// Statements run since the last reset.
    pub(crate) fn statements(&self) -> usize {
        self.pool.load(Ordering::Relaxed) - self.base.load(Ordering::Relaxed)
    }
}

pub(crate) async fn get_calendar(
    router: &axum::Router,
    token: &str,
    query: &str,
) -> (StatusCode, usize, usize) {
    get_calendar_encoded(router, token, query, None).await
}

pub(crate) async fn get_calendar_encoded(
    router: &axum::Router,
    token: &str,
    query: &str,
    accept_encoding: Option<&str>,
) -> (StatusCode, usize, usize) {
    let mut request = Request::builder()
        .uri(format!("/api/v1/calendar?{query}"))
        .header("Authorization", bearer_header(token));
    if let Some(encoding) = accept_encoding {
        request = request.header("Accept-Encoding", encoding);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let entries = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|v| v["entries"].as_array().map(|a| a.len()))
        .unwrap_or(0);
    (status, bytes.len(), entries)
}

fn window(from: i64, days: i64) -> String {
    let today: NaiveDate = Utc::now().date_naive();
    format!(
        "start={}&end={}",
        today + ChronoDuration::days(from),
        today + ChronoDuration::days(from + days)
    )
}

#[tokio::test]
#[ignore = "profiling run; prints stage timings"]
async fn profile_calendar() {
    let _ = tracing::subscriber::set_global_default(
        tracing_subscriber::registry().with(StatementLayer),
    );
    let (router, state) = test_state().await;
    let t = std::time::Instant::now();
    let fx = build_fixture(&state, Scale::REALISTIC).await;
    eprintln!("fixture built in {:?}", t.elapsed());
    let (probe, _guard) = Probe::install(&state);
    for (who, token) in [("admin", &fx.admin_token), ("viewer", &fx.viewer_token)] {
        // Statements of one cold agenda by text, most frequent first.
        *STATEMENTS.lock().unwrap() = Some(Default::default());
        let _ = get_calendar(&router, token, &window(0, 30)).await;
        let mut by_text: Vec<(String, usize)> = STATEMENTS
            .lock()
            .unwrap()
            .take()
            .unwrap_or_default()
            .into_iter()
            .collect();
        by_text.sort_by_key(|a| std::cmp::Reverse(a.1));
        eprintln!("{who}: cold 30-day agenda statements by text");
        for (sql, n) in by_text.iter().take(12) {
            eprintln!("  {n:5} x {sql}");
        }
        // Drop that response from the cache so the table below starts cold.
        state
            .app
            .calendar_cache
            .seed_chunk(fx.instance.id, "0000-00".into(), vec![]);
        for (name, from, days) in [
            ("day", 0, 0),
            ("week", 0, 6),
            ("month", -3, 30),
            ("agenda", 0, 30),
            ("agenda92", 0, 92),
        ] {
            probe.reset();
            let started = std::time::Instant::now();
            let (status, bytes, entries) = get_calendar(&router, token, &window(from, days)).await;
            let cold = started.elapsed();
            let statements = probe.statements();
            let stages = probe.stages.lock().unwrap().join(" | ");
            probe.reset();
            let started = std::time::Instant::now();
            let _ = get_calendar(&router, token, &window(from, days)).await;
            let warm = started.elapsed();
            let started = std::time::Instant::now();
            let (_, wire_bytes, _) =
                get_calendar_encoded(&router, token, &window(from, days), Some("br, gzip")).await;
            let warm_br = started.elapsed();
            eprintln!(
                "{who:6} {name:9} {status} {entries:4} entries {:4} KB (br {:3} KB)  cold {cold:>9.1?}  warm {warm:>9.1?}  warm+br {warm_br:>9.1?}  sql {statements:5}  [{stages}]",
                bytes / 1024,
                wire_bytes / 1024
            );
        }
    }
}

/// A cold calendar costs a fixed number of statements however many titles,
/// episodes and files the window holds. Before the batching it was several per
/// title plus one per episode of every series (545 for a week of 31 entries on
/// the realistic fixture, 2369 for 92 days); now it is a dozen. The bound sits
/// above the measured count so one harmless extra statement does not fail it,
/// and far below anything that grows with the library.
#[tokio::test]
async fn cold_calendar_statement_count_does_not_grow_with_titles() {
    const BOUND: usize = 20;
    let bigger = Scale {
        series: 120,
        movies: 80,
        calendar_series: 48,
        in_library: 28,
        calendar_movies: 16,
        ..Scale::SMALL
    };
    let mut counts = Vec::new();
    for scale in [Scale::SMALL, bigger] {
        let (router, state) = test_state().await;
        let fx = build_fixture(&state, scale).await;
        let (probe, _guard) = Probe::install(&state);
        for token in [&fx.admin_token, &fx.viewer_token] {
            for query in [window(0, 6), window(-3, 92)] {
                probe.reset();
                let (status, _, entries) = get_calendar(&router, token, &query).await;
                assert_eq!(status, StatusCode::OK);
                assert!(
                    entries > 5,
                    "the fixture should fill the window ({entries})"
                );
                counts.push(probe.statements());
            }
        }
    }
    assert!(
        counts.iter().all(|n| *n <= BOUND),
        "statements per cold calendar (small admin week, 92 days, viewer week, 92 days, then the bigger library): {counts:?}"
    );
    // The same window on a library twice the size costs the same.
    let (small, big) = counts.split_at(4);
    for (a, b) in small.iter().zip(big) {
        assert!(a.abs_diff(*b) <= 2, "{counts:?}");
    }
}

/// A cached calendar is answered with no statement beyond authentication.
/// Other tests in the same process publish live events into the shared change
/// log, which can make one attempt stale, so a few attempts are allowed.
#[tokio::test]
async fn warm_calendar_runs_no_statements_beyond_the_session_check() {
    let (router, state) = test_state().await;
    let fx = build_fixture(&state, Scale::SMALL).await;
    let (probe, _guard) = Probe::install(&state);
    let query = window(0, 30);
    let mut best = usize::MAX;
    for _ in 0..5 {
        get_calendar(&router, &fx.admin_token, &query).await;
        probe.reset();
        get_calendar(&router, &fx.admin_token, &query).await;
        best = best.min(probe.statements());
        if best <= 4 {
            break;
        }
    }
    assert!(best <= 4, "a hit only authenticates: {best}");
}
