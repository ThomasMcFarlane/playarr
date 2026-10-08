/**
 * Page registry (docs/design/page-layout.md, section 7.1).
 *
 * Every file under `src/pages` that renders a routed page is listed here, as one of:
 *   - `layout`: it renders `<PageLayout pageId=...>`, so it has the one canonical header, actions, body and states;
 *   - `unmigrated`: it still renders the legacy frame (`PageShell`, `TvStageShell`, `PageHeader` or `TvDetailHeading`
 *     directly). This list may only shrink: `pageRegistry.test.ts` fails when a listed file already uses
 *     `PageLayout`, and when the list grows past `MAX_UNMIGRATED`. It is empty when the migration is finished;
 *   - `exempt`: it has no standard header, with a reason the test checks against the source (`evidence`).
 */
export type PageId =
  | "home"
  | "downloads"
  | "search"
  | "library"
  | "playlists"
  | "calendar"
  | "folders"
  | "settings"
  | "work-detail"
  | "music-detail"
  | "watchlist"
  | "requests";

export type PageCoverage =
  | { file: string; mode: "layout"; pageId: PageId; routes: readonly string[]; urls: readonly string[] }
  | { file: string; mode: "unmigrated"; pageId: PageId; routes: readonly string[]; urls: readonly string[]; step: string }
  | {
      file: string;
      mode: "exempt";
      routes: readonly string[];
      reason: string;
      /** A pattern the file's source must contain, so a stale reason fails (for example "TvStageChrome" must be rendered). */
      evidence: string;
    };

export const PAGE_REGISTRY: readonly PageCoverage[] = [
  { file: "Calendar.tsx", mode: "layout", pageId: "calendar", routes: ["calendar"], urls: ["/calendar"] },
  { file: "Downloads.tsx", mode: "layout", pageId: "downloads", routes: ["downloads"], urls: ["/downloads"] },
  // `/folders` is a web and Android surface for now; other clients are parked, so it is not in
  // COMPLETE_CLIENT_SHELL_ROUTES yet.
  { file: "Folders.tsx", mode: "layout", pageId: "folders", routes: [], urls: ["/folders"] },
  { file: "Library.tsx", mode: "layout", pageId: "library", routes: ["series", "movies", "sites", "music"], urls: ["/movies", "/series"] },
  { file: "MusicDetail.tsx", mode: "unmigrated", pageId: "music-detail", routes: ["music-detail"], urls: [], step: "W6" },
  { file: "Playlists.tsx", mode: "layout", pageId: "playlists", routes: ["playlists"], urls: ["/playlists"] },
  { file: "Requests.tsx", mode: "layout", pageId: "requests", routes: ["requests"], urls: ["/requests"] },
  { file: "Search.tsx", mode: "layout", pageId: "search", routes: ["search"], urls: ["/search"] },
  { file: "settings/Index.tsx", mode: "layout", pageId: "settings", routes: ["settings"], urls: ["/settings"] },
  { file: "Watchlist.tsx", mode: "layout", pageId: "watchlist", routes: ["watchlist"], urls: ["/watchlist"] },
  {
    file: "WorkDetail.tsx",
    mode: "unmigrated",
    pageId: "work-detail",
    routes: ["series-detail", "movies-detail", "sites-detail", "search-detail", "playlists-detail"],
    urls: [],
    step: "W6",
  },
  {
    file: "Home.tsx",
    mode: "exempt",
    routes: ["home"],
    reason: "Root surface: nothing to go back to; the hero replaces the title row. It has no action button: Customise Home lives in Settings.",
    evidence: "tv-home-feature",
  },
  {
    file: "Player.tsx",
    mode: "exempt",
    routes: ["player"],
    reason: "Full-bleed playback with its own transport chrome.",
    evidence: "player-page",
  },
  {
    file: "NotFound.tsx",
    mode: "exempt",
    routes: [],
    reason: "404 illustration; the nav rail is the way out.",
    evidence: "not-found-heading",
  },
  {
    file: "NavPerfHarness.tsx",
    mode: "exempt",
    routes: [],
    reason: "Dev-only performance harness.",
    evidence: "data-nav-perf-harness",
  },
  {
    file: "LayoutHarness.tsx",
    mode: "exempt",
    routes: [],
    reason: "Dev-only canonical page layout used by the layout parity capture; it renders PageLayout from query parameters.",
    evidence: "<PageLayout",
  },
  { file: "Login.tsx", mode: "exempt", routes: ["login", "qr-login"], reason: "Pre-auth profile layout.", evidence: "ProfileAuthLayout" },
  { file: "Signup.tsx", mode: "exempt", routes: ["signup"], reason: "Pre-auth profile layout.", evidence: "ProfileAuthLayout" },
  { file: "DeviceLink.tsx", mode: "exempt", routes: ["device-link"], reason: "Pre-auth profile layout.", evidence: "ProfileAuthLayout" },
  { file: "Profiles.tsx", mode: "exempt", routes: ["profiles"], reason: "Profile picker chrome (TvStageChrome).", evidence: "TvStageChrome" },
  { file: "Household.tsx", mode: "exempt", routes: [], reason: "Household gate with its own bare page layout; it gets the standard Back in W7.", evidence: "<h1" },
  { file: "Clients.tsx", mode: "exempt", routes: ["clients"], reason: "Public install landing (TvStageChrome).", evidence: "TvStageChrome" },
  { file: "Legal.tsx", mode: "exempt", routes: [], reason: "Public legal documents with their own article layout.", evidence: "ProfileAuthLayout" },
];

/** The ratchet: a literal, lowered by the PR that migrates a page; the test fails when more pages are listed than this. */
export const MAX_UNMIGRATED = 2;
