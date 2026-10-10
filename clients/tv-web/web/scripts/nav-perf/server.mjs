// Same-origin static server for `dist/` plus a deterministic mock Playarr API.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { buildCatalogue, buildJpegs } from "./fixtures.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".webmanifest": "application/json",
};

const json = (res, body, status = 200) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

/**
 * Reference page for the harness floor: 300 plain cards, one focus ring and one
 * scroll write per key, no framework. Whatever this costs under the same
 * viewport and throttle is the best any real screen can do.
 */
const FLOOR_PAGE = `<!doctype html><html><body style="margin:0"><div id="g" style="height:2160px;overflow:auto"><div id="c" style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:100px">
<script>
const c=document.getElementById('c'),g=document.getElementById('g');
for(let i=0;i<300;i++){const d=document.createElement('a');d.href='#'+i;d.tabIndex=0;d.style.cssText='display:block;height:420px;background:#789;border-radius:12px;box-shadow:0 10px 20px #0004';d.textContent=i;c.appendChild(d)}
let idx=0;const cards=c.children;cards[0].classList.add('on');
addEventListener('keydown',e=>{cards[idx].style.outline='';const m={ArrowDown:3,ArrowUp:-3,ArrowRight:1,ArrowLeft:-1}[e.key];if(!m)return;e.preventDefault();idx=Math.max(0,Math.min(299,idx+m));cards[idx].style.outline='4px solid red';g.scrollTop=Math.floor(idx/3)*440-300;document.body.dataset.inputMode='remote'});
</script></div></div></body></html>
`;

/** A movie's runtime in the mock, derived from its id so a test can tell whose detail a panel shows. */
export function mockRuntimeMinutes(id) {
  return 90 + (parseInt(id.slice(0, 4), 16) % 60);
}

const removedWatchlist = new Set();

export async function startServer({ distDir, port = 0, movies = 1746, series = 944, artists = 120, searchLimit = 60, onDeck = 0, detailDelayMs = 0, progressDelayMs = 0, calendarDelayMs = 0, calendarPerDay = 4, resumePlanDelayMs = -1, railsDelayMs = 0, seasons = 0, seasonEpisodes = 14, canDownload = false, playlists = 0, playlistItems = 0, nestedPlaylists = false, folders = false, watchlist = 0, listDelayMs = 0, lagAverageSeconds = null }) {
  /** Detail answer delay in ms; a test can change it while the server runs (`setDetailDelay`). */
  let detailDelay = detailDelayMs;
  const catalogue = buildCatalogue({ movies, series, artists });
  const byId = new Map();
  for (const list of Object.values(catalogue)) for (const w of list) byId.set(w.id, w);
  const jpegs = buildJpegs();
  const unknown = new Set();
  const userId = "00000000-0000-4000-8000-000000000001";

  const handleApi = (url, req, res, delivered = false) => {
    const p = url.pathname;
    const q = url.searchParams;
    // Optional: Home's rail and site-browse calls answer late (a cold start where the first request goes out late).
    if (railsDelayMs > 0 && !delivered && (p === "/api/v1/home/rails" || (p === "/api/v1/catalog" && q.get("kind") === "site"))) {
      return void setTimeout(() => handleApi(url, req, res, true), railsDelayMs);
    }
    // Optional: the first-screen lists of the nav sections (library pages, playlists, watchlist) answer late, so a
    // first visit without a warmed cache shows its skeleton for a while.
    if (listDelayMs > 0 && !delivered && req.method === "GET" && (
      (p === "/api/v1/catalog" && q.get("kind") !== "site") || p === "/api/v1/watchlist" || /^\/api\/v1\/playlists(\/|$)/.test(p)
    )) {
      return void setTimeout(() => handleApi(url, req, res, true), listDelayMs);
    }
    if (p === "/api/v1/auth/login") {
      return json(res, { access_token: "nav-perf-token", refresh_token: "nav-perf-refresh", expires_in: 86400, token_type: "Bearer", user_id: userId });
    }
    if (p === "/api/v1/catalog/kinds") return json(res, ["movie", "series", "artist"]);
    if (p === "/api/v1/catalog") {
      const kind = q.get("kind") ?? "movie";
      let items = [...(catalogue[kind] ?? [])];
      const sort = q.get("sort") ?? "title";
      if (sort === "added_at") items.sort((a, b) => b.added_at.localeCompare(a.added_at));
      else if (sort === "release_date") items.sort((a, b) => b.release_date.localeCompare(a.release_date));
      else items.sort((a, b) => a.sort_title.localeCompare(b.sort_title));
      if (q.get("order") === "desc" && sort === "title") items.reverse();
      const offset = Number(q.get("offset") ?? 0);
      const limit = Number(q.get("limit") ?? 50);
      return json(res, { items: items.slice(offset, offset + limit), total: items.length });
    }
    if (p === "/api/v1/home/rails") {
      const rail = (id, kind, library, title, items) => ({ id, kind, library, title, title_key: kind, view_id: null, items, total: items.length });
      const recent = (kind) => [...catalogue[kind]].sort((a, b) => b.added_at.localeCompare(a.added_at)).slice(0, 24);
      return json(res, {
        lang: "en",
        generated_at: new Date().toISOString(),
        rails: [
          rail("rail-movies-added", "recently_added", "movie", "Recently Added in Movies", recent("movie")),
          rail("rail-series-added", "recently_added", "series", "Recently Added in Series", recent("series")),
          rail("rail-movies-top", "top_unwatched", "movie", "Top Unwatched Movies", [...catalogue.movie].slice(30, 54)),
        ],
      });
    }
    if (p === "/api/v1/catalog/search") {
      const term = (q.get("q") ?? "").toLowerCase();
      const items = [...catalogue.movie, ...catalogue.series]
        .filter((w) => w.title.toLowerCase().includes(term))
        .slice(0, Number(q.get("limit") ?? searchLimit));
      return json(res, { items, remote_only: [] });
    }
    const art = p.match(/^\/api\/v1\/artwork\/work\/([^/]+)\/([^/]+)$/);
    if (art) {
      const n = parseInt(art[1].slice(0, 4), 16) % jpegs.poster.length;
      const buf = art[2] === "backdrop" ? jpegs.backdrop[n] : jpegs.poster[n];
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=3600" });
      return res.end(buf);
    }
    const detail = p.match(/^\/api\/v1\/catalog\/([^/]+)$/);
    if (detail && byId.has(detail[1])) {
      const work = byId.get(detail[1]);
      const season = { id: `s-${work.id}`, season_number: 1, series_work_id: work.id, availability: "available", monitored: true };
      const episode = { id: `e-${work.id}`, season_id: season.id, episode_number: 3, title: "A Slowly Loaded Episode", overview: "Hero description that arrives late.", images: [], availability: "available", monitored: true };
      const body = {
        work,
        children: work.kind === "movie" ? "Movie" : { Series: seasons > 0
          ? Array.from({ length: seasons }, (_, si) => {
              const sn = { ...season, id: `s${si}-${work.id}`, season_number: si + 1 };
              return { season: sn, episodes: Array.from({ length: seasonEpisodes }, (_, ei) => ({ episode: { ...episode, id: `e${si}-${ei}-${work.id}`, season_id: sn.id, episode_number: ei + 1, title: `Episode ${ei + 1}` }, media_file_id: `mf${si}-${ei}-${work.id}` })) };
            })
          : [{ season, episodes: [{ episode, media_file_id: `mf-${work.id}` }] }] },
        available_on: [],
        media_files: [],
        ...(work.kind === "movie" ? { media_file_id: `mf-${work.id}`, runtime_ms: mockRuntimeMinutes(work.id) * 60_000 } : {}),
      };
      if (detailDelay > 0) return void setTimeout(() => json(res, body), detailDelay);
      return json(res, body);
    }
    // The per-work availability-lag statistic: no samples by default (a library series nothing has been imported
    // for yet), or a mean of `lagAverageSeconds`.
    if (/^\/api\/v1\/catalog\/[^/]+\/availability-lag$/.test(p)) {
      return json(res, {
        average_seconds: lagAverageSeconds, average_grab_seconds: null, sample_count: lagAverageSeconds === null ? 0 : 6,
        backfill_count: 0, unknown_count: 0, backfill_threshold_days: 30, samples: [],
      });
    }
    // Optional: a series resume plan (a "Resume" button on the detail page), delivered after `resumePlanDelayMs`.
    const planMatch = resumePlanDelayMs >= 0 ? p.match(/^\/api\/v1\/catalog\/([^/]+)\/resume-plan$/) : null;
    if (planMatch && byId.has(planMatch[1])) {
      const option = { duration_ms: 2_400_000, episode_id: `e0-0-${planMatch[1]}`, episode_number: 1, kind: "next_in_series", label: "S01E01", media_file_id: `mf0-0-${planMatch[1]}`, position_ms: 0, progress_percent: 0, season_number: 1, title: "Episode 1" };
      const body = { action: "resume", ask_reasons: [], needs_choice: false, options: [option], reason: "next_in_order", series_work_id: planMatch[1], target: option };
      if (resumePlanDelayMs > 0) return void setTimeout(() => json(res, body), resumePlanDelayMs);
      return json(res, body);
    }
    if (p === "/api/v1/playback/progress" && progressDelayMs > 0 && !delivered) {
      return void setTimeout(() => handleApi(new URL(`${url.href}#now`), req, res, true), progressDelayMs);
    }
    if (p === "/api/v1/playback/progress") {
      // Optionally some part-watched series so Home resolves "On Deck" via slow detail calls.
      return json(res, catalogue.series.slice(0, onDeck).map((w, i) => ({
        work_id: w.id, media_file_id: `mf-${w.id}`, position_ms: 600_000, duration_ms: 2_400_000,
        state: "part_watched", updated_at: new Date(Date.UTC(2026, 9, 1) - i * 60_000).toISOString(),
      })));
    }
    if (/continue|on-deck|progress/.test(p)) return json(res, []);
    if (p === "/api/v1/calendar") {
      const start = q.get("start") ?? "2026-10-01";
      const end = q.get("end") ?? start;
      const entries = [];
      for (let day = new Date(`${start}T00:00:00Z`), n = 0; day <= new Date(`${end}T00:00:00Z`); day = new Date(day.getTime() + 86_400_000), n += 1) {
        const date = day.toISOString().slice(0, 10);
        for (let i = 0; i < 1 + (n % calendarPerDay); i += 1) {
          entries.push({ id: `e-${date}-${i}`, media_kind: "episode", release_type: "air", title: `Show ${(n + i) % 7}`, season_number: 1, episode_number: n + i, date, release_at: null, monitored: true, has_file: i % 2 === 0, work_id: null, sources: [{ source_instance_id: "s1", source_name: "Library source", source_kind: "sonarr", arr_id: n }] });
        }
      }
      const body = { start, end, entries, sources: [{ source_instance_id: "s1", name: "Library source", kind: "series_source", status: "ok", entry_count: entries.length }] };
      if (calendarDelayMs > 0) return void setTimeout(() => json(res, body), calendarDelayMs);
      return json(res, body);
    }
    if (p === "/api/v1/calendar/feed") return json(res, { active: false, created_at: null, last_used_at: null });
    if (playlists > 0 && p === "/api/v1/playlists") {
      const now = new Date().toISOString();
      return json(res, Array.from({ length: playlists }, (_, i) => ({
        id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, name: `Test list ${i + 1}`, is_system: false,
        media_type: "video", parent_playlist_id: nestedPlaylists && i > 0 ? "00000000-0000-4000-8000-000000000100" : null, owner_user_id: userId, created_at: now, updated_at: now,
      })));
    }
    if (playlists > 0 && /^\/api\/v1\/playlists\/[^/]+\/items$/.test(p)) {
      // Optionally some movies per playlist, so the playlist page shows real rails.
      const playlistId = p.split("/")[4];
      return json(res, catalogue.movie.slice(0, playlistItems).map((w, i) => ({
        id: `${playlistId.slice(0, 30)}${String(i).padStart(6, "0")}`, playlist_id: playlistId, work_id: w.id, position: i,
        track_id: null, added_at: new Date().toISOString(),
      })));
    }
    if (folders && p === "/api/v1/folders/roots") {
      return json(res, { roots: ["Root A", "Root B"].map((name, i) => ({
        id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`, source_instance_id: "00000000-0000-4000-8000-000000000300",
        source_name: "Source", library_kind: "movie", name, available: true, scan_status: "idle", item_count: 2,
      })) });
    }
    if (folders && /^\/api\/v1\/folders\/roots\/[^/]+\/browse$/.test(p)) {
      const path = q.get("path") ?? "";
      const root = { id: p.split("/")[5], source_instance_id: "00000000-0000-4000-8000-000000000300", source_name: "Source", library_kind: "movie", name: "Root A", available: true, scan_status: "idle", item_count: 2 };
      const dir = (name) => ({ name, path: path ? `${path}/${name}` : name, entry_type: "directory", item_count: 1 });
      return json(res, {
        root, path, breadcrumbs: [{ name: "Root A", path: "" }, ...(path ? [{ name: path.split("/").pop(), path }] : [])],
        entries: path ? [] : [dir("Sub A"), dir("Sub B")], total: path ? 0 : 2, offset: 0, limit: 100,
      });
    }
    if (watchlist > 0 && req.method === "DELETE" && p.startsWith("/api/v1/watchlist/")) {
      removedWatchlist.add(decodeURIComponent(p.slice("/api/v1/watchlist/".length)));
      res.writeHead(204);
      return res.end();
    }
    if (watchlist > 0 && p === "/api/v1/watchlist") {
      return json(res, { items: catalogue.movie.slice(0, watchlist).map((w, i) => ({
        title: { title_key: `key-${i}`, kind: "movie", title: w.title, year: 2020, external_refs: {}, sources: [{ source: "library", label: "Library", availability: "available", work_id: w.id }] },
        in_watchlist: true,
        actions: [{ action: "play", enabled: true, work_id: w.id, media_file_id: `mf-${w.id}` }],
      })).filter((item) => !removedWatchlist.has(item.title.title_key)) });
    }
    if (p === "/api/v1/playlists" || p === "/api/v1/admin/playlists") return json(res, []);
    if (p === "/api/v1/users/me/capabilities") return json(res, { can_download: canDownload, can_request: false });
    unknown.add(`${req.method} ${p}`);
    return json(res, { error: "nav-perf mock: not implemented", path: p }, 404);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/") || /^\/(healthz|readyz)$/.test(url.pathname)) {
      if (url.pathname.startsWith("/api/")) return handleApi(url, req, res);
      return json(res, { status: "ok" });
    }
    if (url.pathname === "/__floor.html") {
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      return res.end(FLOOR_PAGE);
    }
    let file = join(distDir, normalize(url.pathname));
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(distDir, "index.html");
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { server, port: server.address().port, unknown, setDetailDelay: (ms) => { detailDelay = ms; }, close: () => new Promise((r) => server.close(r)) };
}
