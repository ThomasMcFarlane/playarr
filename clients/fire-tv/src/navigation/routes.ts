/**
 * Route-name constants ONLY -- the navigators themselves (`RootNavigator`,
 * `AppShellNavigator`) are a Features-phase task, not this one. This file
 * is a stable contract several downstream feature agents import from
 * (every `screens/*.tsx` file registers itself under one of these names;
 * every `navigation.navigate(...)` call targets one), so it exists ahead of
 * the navigators that will actually wire it up.
 *
 * Mirrors tv-web's route table 1:1 (design doc §4.3), with two corrections
 * against that section's own illustrative code snippet, made against
 * design doc §7's screen inventory instead (this task's own brief:
 * "get the route names right per the design's screen inventory"):
 *
 *  1. No `downloads` route. §4.3's snippet includes one, but §7 marks
 *     `/downloads` "❌ out of scope" outright (no IndexedDB-equivalent
 *     offline engine on Vega, and a Stick has little storage to spare
 *     regardless) and separately says explicitly: "search -> [/search]
 *     (downloads dropped)". Two parts of the same design doc disagree;
 *     the screen inventory is the more specific and more recently-reasoned
 *     of the two, so it wins.
 *  2. Six settings routes, not one. §4.3's snippet has a single
 *     `settings: 'Settings'` entry, but §2's directory layout and §7's
 *     screen table both list six distinct settings screen files
 *     (`SettingsIndexScreen`, `AppearanceScreen`, `LanguageScreen`,
 *     `PlayerSettingsScreen`, `ServerScreen`, `ProfileLockScreen`) --
 *     each needs its own route name for a downstream navigator to register
 *     it under. `settings` is kept as the layout/index route's name
 *     (§7: "/settings -> settings/Index.tsx | Layout route"); the other
 *     five are added as `settingsX` siblings, following this file's own
 *     existing `workDetail`/`musicDetail` compound-name convention. The
 *     three settings screens §7 marks "⏸ v2" (`profile-avatar`, `invite`,
 *     `request-latency`) are deliberately NOT included here -- adding a
 *     route name for a screen that doesn't exist yet is a bigger footgun
 *     for a later agent than adding it when that screen actually lands.
 */
export const ROUTES = {
  // Pre-authentication / profile selection
  link: 'Link',
  profiles: 'Profiles',

  // Primary content (AppShellNavigator's content stack)
  home: 'Home',
  search: 'Search',
  series: 'Series',
  movies: 'Movies',
  sites: 'Sites',
  music: 'Music',
  playlists: 'Playlists',

  // Detail screens -- one route each covers several tv-web source routes:
  // WorkDetail backs /series/:id, /movies/:id, /search/:id (a search result
  // opens the same detail screen), and /playlists/:id.
  workDetail: 'WorkDetail',
  musicDetail: 'MusicDetail',

  // Settings -- settings is the layout/index route; the rest are its
  // sibling sub-screens (see this file's top comment for why six, not one).
  settings: 'Settings',
  settingsAppearance: 'SettingsAppearance',
  settingsLanguage: 'SettingsLanguage',
  settingsPlayer: 'SettingsPlayer',
  settingsServer: 'SettingsServer',
  settingsProfileLock: 'SettingsProfileLock',

  // Fallback
  notFound: 'NotFound',
} as const;

/** One of `ROUTES`' values -- the type every `navigation.navigate<RouteName>(...)` call and every screen-registration site should use, rather than a bare `string`. */
export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];
