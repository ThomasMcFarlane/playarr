/**
 * Page-header coverage registry.
 *
 * Every file under `src/pages` that renders a routed page must appear here,
 * either as `header` (it renders its heading through the shared `PageHeader`
 * in `components/shell`, directly or via `TvDetailHeading`) or as `exempt`
 * with a reason. `pageHeaderRegistry.test.ts` fails when a page is missing,
 * when a `header` page stops using the shared component, or when a shelled
 * route has no owner, so new pages cannot drift from the canonical layout
 * (back button top-left, large title, divider/detail, right-side actions).
 */
export type PageHeaderCoverage =
  | { file: string; mode: "header"; routes: readonly string[] }
  | { file: string; mode: "exempt"; routes: readonly string[]; reason: string };

export const PAGE_HEADER_COVERAGE: readonly PageHeaderCoverage[] = [
  { file: "Calendar.tsx", mode: "header", routes: ["calendar"] },
  { file: "Downloads.tsx", mode: "header", routes: ["downloads"] },
  // `/folders` is a web and Android surface for now; other clients are parked, so it is not in
  // COMPLETE_CLIENT_SHELL_ROUTES yet.
  { file: "Folders.tsx", mode: "header", routes: [] },
  { file: "Library.tsx", mode: "header", routes: ["series", "movies", "sites", "music"] },
  { file: "MusicDetail.tsx", mode: "header", routes: ["music-detail"] },
  { file: "Playlists.tsx", mode: "header", routes: ["playlists"] },
  { file: "Requests.tsx", mode: "header", routes: ["requests"] },
  { file: "Search.tsx", mode: "header", routes: ["search"] },
  { file: "settings/Index.tsx", mode: "header", routes: ["settings"] },
  { file: "Watchlist.tsx", mode: "header", routes: ["watchlist"] },
  { file: "HomeCustomise.tsx", mode: "header", routes: ["customise-home"] },
  {
    file: "WorkDetail.tsx",
    mode: "header",
    routes: ["series-detail", "movies-detail", "sites-detail", "search-detail", "playlists-detail"],
  },
  {
    file: "Home.tsx",
    mode: "exempt",
    routes: ["home"],
    reason: "Root surface: nothing to go back to; the hero replaces the title row.",
  },
  {
    file: "Player.tsx",
    mode: "exempt",
    routes: ["player"],
    reason: "Full-bleed playback with its own transport chrome.",
  },
  {
    file: "NotFound.tsx",
    mode: "exempt",
    routes: [],
    reason: "404 illustration; the nav rail is the way out.",
  },
  {
    file: "NavPerfHarness.tsx",
    mode: "exempt",
    routes: [],
    reason: "Dev-only performance harness.",
  },
  { file: "Login.tsx", mode: "exempt", routes: ["login", "qr-login"], reason: "Pre-auth profile layout." },
  { file: "Signup.tsx", mode: "exempt", routes: ["signup"], reason: "Pre-auth profile layout." },
  { file: "DeviceLink.tsx", mode: "exempt", routes: ["device-link"], reason: "Pre-auth profile layout." },
  { file: "Profiles.tsx", mode: "exempt", routes: ["profiles"], reason: "Profile picker chrome (TvStageChrome)." },
  { file: "Household.tsx", mode: "exempt", routes: [], reason: "Household gate with its own bare page layout." },
  { file: "Clients.tsx", mode: "exempt", routes: ["clients"], reason: "Public install landing (TvStageChrome)." },
  { file: "Legal.tsx", mode: "exempt", routes: [], reason: "Public legal documents with their own article layout." },
];
