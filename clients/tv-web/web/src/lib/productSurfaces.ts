/**
 * Complete-client product surfaces for Playarr Web identities.
 *
 * Source of truth for VIDAA ↔ standard web parity: every complete client
 * (see docs/architecture/client-principles.md) must expose these routes,
 * shell nav items, and settings sections unless a capability-based
 * degradation applies. Unit tests drive this module and cross-check App
 * routing so tv-vidaa cannot silently thin the product.
 */
import type { PlayarrWebPlatform } from "./clientPlatform";

/** Work kinds that gate library nav items from the server catalogue. */
export type CatalogWorkKind = "series" | "movie" | "site" | "artist";

export interface ProductRoute {
  /** React Router path pattern (static segment or :param). */
  path: string;
  /** Stable id used in parity checklists and tests. */
  id: string;
  /** Human label for checklist rows. */
  label: string;
  /** Whether this route sits inside the authenticated AppShell. */
  shelled: boolean;
}

export interface ProductNavItem {
  to: string;
  labelKey: string;
  end: boolean;
  workKind?: CatalogWorkKind;
  /** Hidden until DownloadsProvider grants storage + server capability. */
  requiresDownload?: boolean;
}

export interface ProductSettingsSection {
  to: string;
  number: string;
  titleKey: string;
  descriptionKey: string;
}

export type DegradationReason =
  | "capability-storage"
  | "capability-file-picker"
  | "capability-codecs"
  | "tv-input-model"
  | "tv-ten-foot-chrome";

export interface IntentionalDegradation {
  id: string;
  reason: DegradationReason;
  /** Short description for parity checklists. */
  note: string;
}

/** Authenticated shell routes every complete client must register. */
export const COMPLETE_CLIENT_SHELL_ROUTES: readonly ProductRoute[] = [
  { path: "/", id: "home", label: "Home", shelled: true },
  { path: "/downloads", id: "downloads", label: "Downloads", shelled: true },
  { path: "/search", id: "search", label: "Search", shelled: true },
  { path: "/search/:workId", id: "search-detail", label: "Search work detail", shelled: true },
  { path: "/series", id: "series", label: "Series library", shelled: true },
  { path: "/series/:workId", id: "series-detail", label: "Series detail", shelled: true },
  { path: "/movies", id: "movies", label: "Movies library", shelled: true },
  { path: "/movies/:workId", id: "movies-detail", label: "Movies detail", shelled: true },
  { path: "/sites", id: "sites", label: "Sites library", shelled: true },
  { path: "/sites/:workId", id: "sites-detail", label: "Sites detail", shelled: true },
  { path: "/music", id: "music", label: "Music library", shelled: true },
  { path: "/music/:workId", id: "music-detail", label: "Music detail", shelled: true },
  { path: "/watchlist", id: "watchlist", label: "Watchlist", shelled: true },
  { path: "/requests", id: "requests", label: "Requests", shelled: true },
  { path: "/playlists", id: "playlists", label: "Playlists", shelled: true },
  { path: "/playlists/:workId", id: "playlists-detail", label: "Playlist detail", shelled: true },
  { path: "/calendar", id: "calendar", label: "Release calendar", shelled: true },
  { path: "/player/:mediaFileId", id: "player", label: "Player", shelled: true },
  { path: "/settings", id: "settings", label: "Settings index", shelled: true },
  { path: "/settings/appearance", id: "settings-appearance", label: "Settings: appearance", shelled: true },
  { path: "/settings/profile-avatar", id: "settings-profile-avatar", label: "Settings: profile avatar", shelled: true },
  { path: "/settings/language", id: "settings-language", label: "Settings: language", shelled: true },
  { path: "/settings/player", id: "settings-player", label: "Settings: player", shelled: true },
  { path: "/settings/server", id: "settings-server", label: "Settings: server", shelled: true },
  { path: "/settings/profile-lock", id: "settings-profile-lock", label: "Settings: profile lock", shelled: true },
  { path: "/settings/invite", id: "settings-invite", label: "Settings: invite", shelled: true },
  { path: "/settings/request-latency", id: "settings-request-latency", label: "Settings: request latency", shelled: true },
  { path: "/settings/your-data", id: "settings-your-data", label: "Settings: your data", shelled: true },
  { path: "/settings/home", id: "settings-home", label: "Settings: customise home", shelled: true },
] as const;

/** Pre-auth and account surfaces shared by web and hosted TV identities. */
export const COMPLETE_CLIENT_PUBLIC_ROUTES: readonly ProductRoute[] = [
  { path: "/login", id: "login", label: "Login", shelled: false },
  { path: "/login/qr", id: "qr-login", label: "QR login", shelled: false },
  { path: "/signup", id: "signup", label: "Signup", shelled: false },
  { path: "/link", id: "device-link", label: "Device link approval", shelled: false },
  { path: "/profiles", id: "profiles", label: "Profiles", shelled: false },
  // "/clients" (a landing grid of every client) and "/clients/:clientId"
  // (that same grid morphed into a coverflow, plus install details) are a
  // single React Router route -- see the "/clients/:clientId?" route in
  // App.tsx -- so they're one surface here too, not two.
  { path: "/clients/:clientId?", id: "clients", label: "Clients / install", shelled: false },
] as const;

export const COMPLETE_CLIENT_ROUTES: readonly ProductRoute[] = [
  ...COMPLETE_CLIENT_PUBLIC_ROUTES,
  ...COMPLETE_CLIENT_SHELL_ROUTES,
] as const;

/**
 * Shell navigation groups. Order and membership must match App.tsx rendering.
 * Icons stay in App.tsx (React components); this is the task hierarchy only.
 */
export const PRODUCT_NAV_GROUPS: readonly {
  id: string;
  items: readonly ProductNavItem[];
}[] = [
  {
    id: "search",
    items: [
      {
        to: "/downloads",
        labelKey: "shell.nav.downloads",
        end: false,
        requiresDownload: true,
      },
      { to: "/search", labelKey: "shell.nav.search", end: false },
    ],
  },
  {
    id: "library",
    items: [
      { to: "/", labelKey: "shell.nav.home", end: true },
      {
        to: "/series",
        labelKey: "shell.nav.series",
        end: false,
        workKind: "series",
      },
      {
        to: "/movies",
        labelKey: "shell.nav.movies",
        end: false,
        workKind: "movie",
      },
      {
        to: "/sites",
        labelKey: "shell.nav.sites",
        end: false,
        workKind: "site",
      },
      {
        to: "/music",
        labelKey: "shell.nav.music",
        end: false,
        workKind: "artist",
      },
    ],
  },
  {
    id: "playlists",
    items: [
      {
        to: "/playlists",
        labelKey: "shell.nav.playlists",
        end: false,
      },
      {
        to: "/watchlist",
        labelKey: "shell.nav.watchlist",
        end: false,
      },
      {
        to: "/requests",
        labelKey: "shell.nav.requests",
        end: false,
      },
      {
        to: "/calendar",
        labelKey: "shell.nav.calendar",
        end: false,
      },
    ],
  },
] as const;

export const PRODUCT_SETTINGS_SECTIONS: readonly ProductSettingsSection[] = [
  {
    to: "/settings/appearance",
    number: "01",
    titleKey: "settings.index.appearance.title",
    descriptionKey: "settings.index.appearance.description",
  },
  {
    to: "/settings/profile-avatar",
    number: "02",
    titleKey: "settings.index.profileAvatar.title",
    descriptionKey: "settings.index.profileAvatar.description",
  },
  {
    to: "/settings/language",
    number: "03",
    titleKey: "settings.index.language.title",
    descriptionKey: "settings.language.description",
  },
  {
    to: "/settings/player",
    number: "04",
    titleKey: "settings.index.player.title",
    descriptionKey: "settings.playerPreferences.description",
  },
  {
    to: "/settings/server",
    number: "05",
    titleKey: "settings.index.server.title",
    descriptionKey: "settings.index.server.description",
  },
  {
    to: "/settings/profile-lock",
    number: "06",
    titleKey: "settings.index.profileLock.title",
    descriptionKey: "settings.index.profileLock.description",
  },
  {
    to: "/settings/invite",
    number: "07",
    titleKey: "settings.index.invite.title",
    descriptionKey: "settings.index.invite.description",
  },
  {
    to: "/settings/request-latency",
    number: "08",
    titleKey: "settings.index.requestLatency.title",
    descriptionKey: "settings.index.requestLatency.description",
  },
  {
    to: "/settings/remote",
    number: "09",
    titleKey: "settings.index.remote.title",
    descriptionKey: "settings.index.remote.description",
  },
  {
    to: "/settings/your-data",
    number: "10",
    titleKey: "settings.index.yourData.title",
    descriptionKey: "settings.index.yourData.description",
  },
  {
    to: "/settings/home",
    number: "11",
    titleKey: "pages.home.customise.title",
    descriptionKey: "pages.home.customise.hint",
  },
] as const;

/** Platforms that share the ten-foot television chrome/CSS profile. */
export function usesTenFootChrome(platform: PlayarrWebPlatform): boolean {
  return (
    platform === "tv-vidaa" ||
    platform === "android-tv" ||
    platform === "tv-webos" ||
    platform === "tv-tizen" ||
    platform === "xbox"
  );
}

/** Platforms that sign in via device-code / QR rather than password form. */
export function usesDeviceCodeLogin(platform: PlayarrWebPlatform): boolean {
  return usesTenFootChrome(platform);
}

/**
 * Intentional degradations for a platform relative to full desktop web.
 * These are allowed by client principles; they must not be treated as parity gaps.
 */
export function intentionalDegradationsFor(
  platform: PlayarrWebPlatform
): readonly IntentionalDegradation[] {
  if (platform === "web" || platform === "android-mobile") {
    return [];
  }

  const degradations: IntentionalDegradation[] = [
    {
      id: "auth-device-code",
      reason: "tv-input-model",
      note: "TV remote: device-code/QR login instead of on-TV password typing",
    },
    {
      id: "ten-foot-chrome",
      reason: "tv-ten-foot-chrome",
      note: "Shared android-tv/tv-vidaa ten-foot focus scale and stage geometry",
    },
    {
      id: "custom-avatar-upload",
      reason: "capability-file-picker",
      note: "Hide custom avatar file upload where TV remotes lack a usable file picker",
    },
    {
      id: "user-data-file-transfer",
      reason: "capability-file-picker",
      note: "Your data export/import has no on-TV file picker or file save; TV identities show a one-time QR code to download on, or upload from, a phone or computer instead",
    },
    {
      id: "downloads-storage",
      reason: "capability-storage",
      note: "Hide downloads nav when OPFS/managed storage is unavailable (runtime gate, not platform hard-code)",
    },
  ];

  if (platform === "tv-vidaa") {
    degradations.push({
      id: "playback-codecs",
      reason: "capability-codecs",
      note: "Conservative H.264/H.265/VP9 + AAC/Opus/MP3 claims for VIDAA browser pipeline",
    });
  }

  return degradations;
}

export interface PlatformProductSurfaceSnapshot {
  platform: PlayarrWebPlatform;
  routeIds: readonly string[];
  navTargets: readonly string[];
  settingsPaths: readonly string[];
  usesDeviceCodeLogin: boolean;
  usesTenFootChrome: boolean;
  intentionalDegradations: readonly IntentionalDegradation[];
}

/**
 * Snapshot of product surfaces for a platform identity.
 * Routes, nav, and settings are identical across web and tv-vidaa; only
 * interaction model and capability claims differ.
 */
export function productSurfacesFor(
  platform: PlayarrWebPlatform
): PlatformProductSurfaceSnapshot {
  return {
    platform,
    routeIds: COMPLETE_CLIENT_ROUTES.map((route) => route.id),
    navTargets: PRODUCT_NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => item.to)
    ),
    settingsPaths: PRODUCT_SETTINGS_SECTIONS.map((section) => section.to),
    usesDeviceCodeLogin: usesDeviceCodeLogin(platform),
    usesTenFootChrome: usesTenFootChrome(platform),
    intentionalDegradations: intentionalDegradationsFor(platform),
  };
}

/**
 * Behavioural parity between two platforms: same routes, nav hierarchy, and
 * settings sections. Differences in login model / ten-foot chrome / listed
 * degradations are allowed and do not fail the comparison.
 */
export function productSurfaceParityGaps(
  reference: PlatformProductSurfaceSnapshot,
  candidate: PlatformProductSurfaceSnapshot
): string[] {
  const gaps: string[] = [];

  const missingRoutes = reference.routeIds.filter(
    (id) => !candidate.routeIds.includes(id)
  );
  const extraRoutes = candidate.routeIds.filter(
    (id) => !reference.routeIds.includes(id)
  );
  if (missingRoutes.length > 0) {
    gaps.push(`missing routes: ${missingRoutes.join(", ")}`);
  }
  if (extraRoutes.length > 0) {
    gaps.push(`extra routes: ${extraRoutes.join(", ")}`);
  }

  if (reference.navTargets.join("|") !== candidate.navTargets.join("|")) {
    gaps.push(
      `nav hierarchy differs: ref=[${reference.navTargets.join(", ")}] cand=[${candidate.navTargets.join(", ")}]`
    );
  }

  if (reference.settingsPaths.join("|") !== candidate.settingsPaths.join("|")) {
    gaps.push(
      `settings sections differ: ref=[${reference.settingsPaths.join(", ")}] cand=[${candidate.settingsPaths.join(", ")}]`
    );
  }

  return gaps;
}

/** Flat parity checklist rows for browser / manual audit evidence. */
export function parityChecklistRows(): readonly {
  id: string;
  category: "surface" | "style" | "nav" | "settings" | "player" | "auth";
  label: string;
}[] {
  return [
    { id: "auth-profiles", category: "auth", label: "Profiles picker + PIN path" },
    { id: "auth-login", category: "auth", label: "Sign-in (password on web; device-code on tv-vidaa)" },
    { id: "auth-signout", category: "auth", label: "Sign-out / switch profile" },
    { id: "home", category: "surface", label: "Home feature stage + rails" },
    { id: "search", category: "surface", label: "Search query + kind filters + results" },
    { id: "library-series", category: "surface", label: "Series library sort/view" },
    { id: "library-movies", category: "surface", label: "Movies library sort/view" },
    { id: "library-sites", category: "surface", label: "Sites library sort/view" },
    { id: "library-music", category: "surface", label: "Music library sort/view" },
    { id: "work-detail", category: "surface", label: "Work detail hierarchy + play actions" },
    { id: "music-detail", category: "surface", label: "Music detail + playable tracks" },
    { id: "playlists", category: "surface", label: "Playlists list/create/reorder/remove" },
    { id: "calendar", category: "surface", label: "Release calendar: agenda/week/month, source banner, subscription" },
    { id: "player", category: "player", label: "Player chrome: play/resume/tracks/quality" },
    { id: "settings-all", category: "settings", label: "All eight settings sections present" },
    { id: "clients", category: "surface", label: "Clients / install info" },
    { id: "errors-offline", category: "surface", label: "Recoverable error / offline shell" },
    { id: "nav-shell", category: "nav", label: "Shell nav items and groupings" },
    { id: "style-tokens", category: "style", label: "Shared design tokens / shell chrome" },
    { id: "style-empty", category: "style", label: "Empty and error state chrome" },
    { id: "style-scroll", category: "style", label: "Scroll containers (data-tv-scroll-container)" },
    {
      id: "downloads-capability",
      category: "surface",
      label: "Downloads nav when storage APIs allow (hidden when not)",
    },
  ] as const;
}
