# Playarr Web redesign — handover

> Historical handover: this captured the state immediately before the redesign now present in the
> repository. Keep it as implementation rationale and debugging context; use the current source,
> tests, and root `CHANGELOG.md` as the authority for what is implemented today.

Written for whichever agent/session picks up the Playarr redesign next. This
covers: what's being asked for, what already exists, what was just fixed
(playback was broken end-to-end until this session), and what to watch out
for. Playarr Server Admin (`clients/tv-web/admin`) is **out of scope** here — it's
a separate app being redesigned in parallel to match Sonarr/Radarr's own
look (see `DESIGN.md` at the repo root), not this Dribbble direction.

## The ask, verbatim (chronological, all from the same user)

1. "https://dribbble.com/shots/14655584-White-and-clean-TV-app-by-Gleb-Kuznetsov
   - this is the style of interface I want for Playarr; but with support for
   both light and dark mode"
2. "Playarr needs to error properly when it can't play something"
3. "http://localhost:5173/library - needs to be an infinitely loading list,
   with an alphabet index on the right (like Plex has)"
4. "Also, there should not be a horizontal scroll"

Do not fetch the Dribbble URL yourself if your tooling restricts fetching
arbitrary third-party URLs from a chat context — treat it as the user's own
reference; ask them to describe/screenshot it if you can't access it
directly. The described direction: clean, white/light-first TV browsing UI
(large poster art, generous whitespace, minimal chrome) — but Playarr Server's
own requirement on top is that it must ALSO support a real dark mode, not
just light.

## Current state of Playarr Web

`clients/tv-web/web/` — a Vite + React + TypeScript SPA. Real, working,
tested against a live backend (not mocked) — this is not a scaffold.

```
web/src/
  App.tsx                    -- routes + AppShell (sidebar/header layout)
  pages/
    Home.tsx                 -- "recently added" shelf
    Library.tsx               -- full catalog browse (JUST fixed today, see below)
    WorkDetail.tsx            -- single title detail + Play action
    Player.tsx                -- playback surface (negotiation states + PlayerSurface)
    Settings.tsx               -- API base URL config, connection test, sign out
    Login.tsx                  -- username/password sign-in
  components/
    WorkCard.tsx               -- poster card used by Home/Library grids
    NavIcons.tsx, UpdateToast.tsx
    player/PlayerSurface.tsx   -- <video> + custom controls + overlays
    player/PlayerControls.tsx
    player/PlayerIcons.tsx
  lib/
    ApiClientProvider.tsx      -- auth/session context
    usePlaybackEngine.ts       -- negotiation + Shaka engine lifecycle (JUST fixed, see below)
    useDocumentTitle.ts        -- per-page <title> (JUST added today)
    playbackCapabilities.ts
    appUpdate.ts, images.ts
  styles/global.css            -- dark-only today, CSS custom properties (--color-*)
```

Shared packages this app depends on (also used by the not-yet-built webOS/
Tizen/VIDAA shells under `clients/tv-web/apps/`, which are empty scaffolds —
not a concern for this redesign pass):

- `@playarr-tv/player-shaka` — Shaka Player adapter (`packages/player-shaka/src/index.ts`)
- `@playarr-tv/player-core` — `PlaybackEngine` interface both `player-shaka` and the Tizen `player-avplay` adapter implement
- `@playarr-tv/api-client` — generated OpenAPI client + `useCatalogBrowse`/`useWorkDetail`/etc. React hooks (`packages/api-client/src/hooks.ts`)
- `@playarr-tv/device-auth` — `TokenStore`/session/device-id
- `@playarr-tv/design-tokens` — **read the note below before reusing this as-is**
- `@playarr-tv/domain` — shared constants (default API base URL, etc.)

### `design-tokens` note — don't blindly reuse it

`packages/design-tokens/src/index.ts` is a hand-authored, **dark-only**
token set deliberately derived from the real Sonarr/Radarr/Lidarr visual
language (verified by live-scanning those apps — see its own doc comment
and `DESIGN.md`). It exists so Playarr Server Admin reads as "part of the *arr
family." That is the opposite of what this Playarr redesign wants (a clean,
light-first, non-*arr-looking consumer app). Do not extend this token set
for Playarr's new look — either fork a separate Playarr-specific token
source, or treat `web/src/styles/global.css` as its own independent design
system going forward. `--color-brand`/`--color-accent` etc. in
`web/src/styles/global.css` today are wired to the *arr-derived tokens;
expect to replace most of this file's palette section wholesale.

## What needs building (no light/dark mechanism exists at all today)

The current CSS is 100% dark, hardcoded — there is no theme-switching
mechanism anywhere in this codebase yet. You're building it from scratch:

- A `data-theme="light"|"dark"` attribute on `<html>` (or `:root`), driven by
  `prefers-color-scheme` by default with a manual override persisted to
  `localStorage`, is the standard pattern — see how this same convention is
  described for Claude Artifacts if you want a concrete reference:
  `@media (prefers-color-scheme: dark)` as the default signal, plus
  `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides that
  win in both directions once a user has explicitly toggled.
- Every color in `global.css` needs both a light and dark value. Don't just
  invert dark values mechanically — follow the Dribbble reference's actual
  light palette (soft off-whites, not pure `#fff`; real shadows/elevation
  instead of pure-dark-mode's border-based separation).
- A visible theme toggle needs a home in the redesigned nav/settings.

## Specific, already-identified requirements to fold in

1. **Library page** (`pages/Library.tsx`) — was JUST rewritten today from a
   single unpaginated fetch (silently capped at 50 items server-side, "not
   seeing all items") to a manual "Load N more" button pattern (`PAGE_SIZE =
   200`, tracks `total`). The user has since asked for this to be **true
   infinite scroll** (auto-load on scroll-near-bottom, not a button), **plus
   an alphabet index rail on the right edge** (like Plex/iOS contacts — click
   a letter, jump to that section of the (alphabetically sorted, `sort:
   "title"`) list). And explicitly: **no horizontal scroll** anywhere on this
   page (or anywhere in the app) — watch for this especially once an
   alphabet-index sidebar is added next to a poster grid; it needs to fit
   within the viewport width without overflow, at every reasonable window
   size.
   - The backend already returns `total` on `GET /api/v1/catalog` and
     supports `limit`/`offset` — no backend change needed for infinite
     scroll itself, just a different client-side fetch trigger (intersection
     observer or scroll-position check) instead of a button.
   - The alphabet index needs `work.title`'s first letter — already present
     client-side once the catalog page is loaded; for a jump-to-letter that
     works before all letters have been paged in yet, you'll likely want a
     lightweight index (e.g. a cheap `GET /api/v1/catalog?sort=title` with a
     small `limit` just to get section boundaries, or scroll-position-based
     jump once enough of the list has loaded — your call on the exact
     approach, just don't let it require loading the entire 2800+-item
     catalog before the index becomes usable).

2. **Player error handling** — `pages/Player.tsx` already has two distinct
   negotiation-failure states (`negotiation.kind === "error"`, with a
   `forbidden` sub-case for 403/no-streaming-access vs. a generic failure +
   "Try again" button) and `PlayerSurface.tsx` already has a fatal
   engine-error overlay (`engineState.state === "error"`, shows
   `engineState.error?.message` + "Try again"). This existed before today.
   What's genuinely new/unverified: whether these states cover every real
   failure mode now that playback actually works end-to-end (see "bugs just
   fixed" below) — e.g. a transcode session that dies mid-playback (ffmpeg
   crash), a network drop mid-stream, an unsupported codec the negotiation
   layer didn't catch. Re-verify this against real failures, not just the
   negotiation-time ones, once the redesign's new UI chrome is in place —
   the error states need re-skinning for the new visual language regardless.

## Playback bugs just fixed this session — read before touching player code

Playback was **completely broken** ("can't seem to actually load/play
anything") going into this session. Root-caused and fixed as FOUR separate,
compounding bugs — mentioning all four so the redesign doesn't accidentally
reintroduce one while restructuring `usePlaybackEngine.ts`/`PlayerSurface.tsx`:

1. **Remote media path** — `MediaFile.path` is stored as the *arr instance's
   own filesystem path (a different machine), not something this backend
   process can open directly. Fixed via `playarr_model::resolve_media_path`
   (backend-side, `PLAYARR_MEDIA_REMOTE_ROOT`/`PLAYARR_MEDIA_LOCAL_ROOT`
   env vars) + an SSHFS mount. Not a frontend concern, just context for why
   playback ever worked at all once this was fixed.

2. **Shaka engine never attached** — `usePlaybackEngine.ts`'s engine-creation
   `useEffect` used to have an EMPTY dependency array (`[]`), meaning it only
   ever ran once, immediately after the hook's first mount — before
   negotiation succeeds and before `PlayerSurface`'s `<video>` element
   (which the hook's `videoRef` points at) even exists in the DOM yet. Net
   effect: the Shaka engine was silently never created, ever — zero network
   activity, an eternal loading spinner, no error. **Fixed** by keying the
   effect's deps off `negotiation.kind === "ready"` instead of `[]`, so it
   fires on the exact render where `PlayerSurface`/`<video>` actually mounts
   (React commits child refs before running a parent's effects in the same
   commit, so this is safe). If you restructure how/when `PlayerSurface`
   mounts relative to negotiation state, re-verify this timing carefully —
   it's an easy regression to reintroduce.

3. **Shaka's default manifest retry budget too short** — a freshly-started
   on-demand transcode session's `playlist.m3u8` doesn't exist on disk until
   ffmpeg actually gets around to writing it (confirmed live: ~7-10s cold
   start for a real 4K source). Shaka's default retry config gives up in
   under 2 seconds. **Fixed** in `packages/player-shaka/src/index.ts`'s
   `attach()` — widened `manifest.retryParameters`/`streaming.retryParameters`
   (`maxAttempts: 15`, `baseDelay: 1000`, `backoffFactor: 1.3`, `timeout:
   30000`). Don't remove this thinking it's dead config.

4. **Session TTL was a hard cap, not an idle timeout** — the on-demand
   session's cache entry had a flat 60s expiry from creation with nothing
   ever refreshing it, so ANY real movie longer than a minute would 404
   mid-playback the moment the fixed window elapsed (confirmed live: played
   3 real segments, then started 404ing). **Fixed** backend-side
   (`TranscodeOrchestrator::lookup_session` now slides the TTL forward on
   every real access) — not a frontend file, but explains why testing
   playback against a real movie is now expected to actually work past the
   first minute; if it doesn't, that's a real regression, not "expected
   because it's just a demo."

Also just added, not a bug fix but relevant context: `TranscodeOrchestrator`
now notifies a background `TdarrDispatcher` (if Tdarr is configured) every
time it starts a live on-demand session, so a popular title gets promoted to
a durable, cached rendition instead of re-transcoding from scratch on every
watch. Purely backend/architecture, no frontend implication.

## Dev environment

- Backend: `playarr-backend` devserver session, `http://localhost:8484`
  (native `cargo run`, not Docker). Real SQLite DB with two registered *arr
  instances (Sonarr + Radarr) and a real, large synced catalog (~2800
  items) — test against this, not a mock.
- Playarr Web: `playarr-web` devserver session, `http://localhost:5173`
  (Vite, HMR). `pnpm -F web exec tsc --noEmit` to typecheck without a full
  build.
- Browser testing: this session used a dedicated Chrome profile (Claude MCP)
  profile via `mcp__chrome-devtools__*` tools — reuse the same approach
  (`tabs_context`/`new_page`/`navigate_page`/`take_screenshot`) rather than
  `claude-in-chrome`, which is blocked for this identity.
- A real movie that plays end-to-end today can be opened at
  `http://localhost:5173/player/<media-id>` using a 4K Blu-ray `.mkv` that needs on-demand
  transcoding — a good stress test for the loading/error states too, since
  it takes several real seconds to start).

## Explicitly out of scope for this pass

- Playarr Server Admin (`clients/tv-web/admin`) — separate app, separate
  concurrent workflow, matches Sonarr/Radarr's own look per `DESIGN.md`, not
  this Dribbble direction.
- Native clients (Android/iOS/webOS/Tizen/VIDAA) — unstarted or bare
  scaffolds, not part of this pass. `@playarr-tv/player-core`'s
  `PlaybackEngine` interface is the seam that keeps them decoupled from
  whatever this redesign does inside `player-shaka`'s Shaka-specific
  internals, as long as the interface itself doesn't change shape.

## New backend feature: "Views" (saved catalog filter shelves)

Playarr Server Admin now has a "Views" feature -- named, saved filter+sort
presets over the catalog (e.g. "Newly Added", "Newly Released"), created
and managed by the operator, global to the instance (not per-user). This
is the intended data source for Home screen shelves beyond the current
single "recently added" one.

**Endpoints** (same auth as everything else Home/Library already call --
`CatalogViewer` gate, i.e. any token that already works for
`GET /api/v1/catalog` works here unchanged, no new login/permission flow
needed):

- `GET /api/v1/views` -- list every view:
  `{ id: string, name: string, is_default: boolean, default_order: number | null }[]`,
  already returned in display order (defaults first by `default_order`,
  then custom views alphabetically) -- render Home shelves in the order
  this list comes back in, don't re-sort client-side.
- `GET /api/v1/views/{id}/resolve?limit=&offset=` -- runs that view's
  saved filter/sort and returns a page of results, **identical shape** to
  `GET /api/v1/catalog`'s response (`{ items: Work[], total: number | null }`).
  No new client-side rendering code needed -- feed the `items` straight
  into whatever component already renders a `Work[]` shelf today
  (`Home.tsx`'s existing "recently added" shelf / `WorkCard`).

Both are already exposed on `@playarr-tv/api-client`'s `ApiClient` (built
straight off `backend/openapi/playarr.yaml`, no hand-written duplicate
types needed):

```ts
listViews(): Promise<ViewSummary[]>;
resolveView(id: string, params?: { limit?: number; offset?: number }): Promise<CatalogPage>;
```

`ViewSummary` and `CatalogPage` (the latter identical to what
`browseCatalog` already returns) are both exported types from
`@playarr-tv/api-client`.

**Suggested integration**: on `Home.tsx`, replace (or supplement) the
current single hardcoded "recently added" shelf with one shelf per entry
from `listViews()`, each populated via its own `resolveView(id, { limit:
<shelf size> })` call, in the order the list comes back in. At minimum two
views exist out of the box -- "Newly Added" (sorted by when Playarr Server
synced it) and "Newly Released" (sorted by the title's real release date,
backed by a new `Work.release_date` field, itself populated from Radarr's
`digitalRelease`/`physicalRelease` and Sonarr's `firstAired`) -- but treat
the list as dynamic: an operator can rename/retune these or add their own
custom views (e.g. "Unwatched Action Movies" is **not** currently
supported server-side -- Views can't filter on per-user watch state today,
only on kind/library/genre/tag/availability/release-window, all
catalog-level not user-level), and the Home screen should render however
many come back, not assume exactly two.

`is_default: true` entries are the two seeded defaults and can't be
deleted (only renamed/retuned) by the operator, so at least one "Newly
Added"-shaped shelf is always safe to assume exists; `is_default: false`
entries are fully operator-authored and may be renamed, added, or removed
at any time -- don't hardcode any view's `id` or `name` client-side, always
go through `listViews()`.

**Admin-only surface** (not relevant to Playarr, listed for completeness):
`createView`/`updateView`/`deleteView`/`listAdminViews` on `ApiClient`
back `POST/PUT/DELETE/GET /api/v1/admin/views[/{id}]`, gated by `AdminUser`
(same as source-instance/user management) -- these are what Playarr Server
Admin's own new "Views" screen (`clients/tv-web/admin/src/pages/
{ViewsPage,ViewEditPage}.tsx`) uses to manage the set; Playarr never calls
them.

---

## Playback activity tracking -- what Playarr needs to call, and when

New backend surface, built to require the minimum possible client change.
This is the **final, actually-shipped** shape (superseding any earlier
draft of this note elsewhere) -- verified against the checked-in
`backend/openapi/playarr.yaml` and a real end-to-end test
(`crates/playarr-api/src/playback.rs`'s
`event_endpoint_updates_registry_and_stop_closes_the_session` test) that
exercises negotiate -> heartbeat -> buffer start/end -> stop against a real
router.

1. **Session creation is automatic -- no new call needed.** `GET
   /api/v1/playback/{media_file_id}` (`getPlaybackInfo`, already called
   today) now also returns a `session_id` field (UUID) in its JSON
   response, alongside the existing `mode`/`url`:

   ```json
   { "mode": "direct" | "hls", "url": "...", "session_id": "<uuid>" }
   ```

   The backend derives everything else (device id from your JWT, platform/
   version from the `X-Playarr-Client-Platform`/`X-Playarr-Client-Version`
   headers you already send on every request, source/target codec) from
   data it already has. You don't need to send anything new to get a
   session created -- just read `session_id` out of the response you
   already parse.

2. **Heartbeat, roughly every 15 seconds while actively playing:**

   `POST /api/v1/playback/sessions/{session_id}/events`
   ```json
   { "kind": "heartbeat", "position_ms": 123456, "bytes_streamed_total": 987654 }
   ```
   `bytes_streamed_total` is optional (omit it, or send `null`) -- if your
   player can cheaply expose a running cumulative byte count (e.g. from the
   `<video>` element / Shaka Player's network stats), send it and the
   admin Activity page's "bytes streamed" column will be accurate for your
   sessions; if not, omit it and that column just stays `0` for you.
   Best-effort either way -- a missed heartbeat or two is fine (see point 4).

3. **Buffering events, if cheap to wire up (recommended, not required):**

   `POST /api/v1/playback/sessions/{session_id}/events`
   ```json
   { "kind": "buffer_start", "position_ms": 123456 }
   ```
   ```json
   { "kind": "buffer_end", "duration_ms": 850 }
   ```
   Without these two, buffering-events/buffering-ms telemetry in the admin
   Activity page stays at zero for your sessions -- everything else still
   works fine without them.

4. **On player teardown / navigation away, best-effort clean stop:**

   `POST /api/v1/playback/sessions/{session_id}/events`
   ```json
   { "kind": "stop", "reason": "user_stopped", "position_ms": 123456 }
   ```
   `reason` can also be `"completed"` or `"error"` as appropriate. This is
   **not required for correctness** -- if it's missed (tab closed, app
   crashed, network dropped), the backend automatically force-closes the
   session after ~60 seconds of no heartbeat/event (checked every 30s).
   Sending `stop` explicitly just gets you an accurate `stop_reason` and an
   immediately-accurate admin "who's watching now" view instead of a
   ~60s-stale one.

All four event kinds above go to the **same endpoint**
(`POST /api/v1/playback/sessions/{session_id}/events`), distinguished by
the `kind` field -- there is no separate endpoint per event type. Every
call needs the same `Authorization: Bearer <token>` header you already
send everywhere else; the backend checks the session belongs to your
account (403 if not, 404 if the session id is unknown/already closed).

No changes needed to auth, to the headers you already send, or to how you
call `getPlaybackInfo` itself -- only the three new lightweight POSTs
above, and #3/#4 of those are optional.
