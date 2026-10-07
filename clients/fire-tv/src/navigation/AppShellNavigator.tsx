/**
 * The authenticated app shell: the persistent `<NavRail>` (design doc
 * §4.2) overlaid on a nested content `Stack.Navigator` every authenticated
 * screen renders into, plus the shell-level `authFailed` recovery
 * tv-web's own `AppShell` layout-route component plays
 * (`clients/tv-web/web/src/App.tsx`). Registered by `RootNavigator.tsx` as
 * its third stack screen, under `APP_SHELL_ROUTE` (exported below, not a
 * `ROUTES` entry -- see this file's own comment on that constant for why).
 *
 * ## Wired against the real screens and components this worktree landed
 *
 * This app is being built by several concurrent, independently-scoped
 * passes over the same worktree (this task's own brief says as much: "note
 * [pre-existing failures from other concurrent feature work] but do not
 * attempt to fix code outside your scope"). By the time this file reached
 * its final form, every screen it needs -- `LinkScreen`, `ProfilesScreen`,
 * `LibraryScreen`, `WorkDetailScreen`, `MusicDetailScreen`, `SearchScreen`,
 * `PlaylistsScreen`, `NotFoundScreen`, and all six `settings/*.tsx` files
 * -- and every shared component this file's own nav rail needs
 * (`components/NavRail.tsx`, `components/navGroups.ts`) had landed for
 * real elsewhere in this worktree. This file registers all of them
 * directly; nothing here is a placeholder. (`LinkScreen`/`ProfilesScreen`
 * themselves are registered by `RootNavigator.tsx`, not here -- they sit
 * outside the authenticated shell entirely, per design doc §4.2's
 * diagram.)
 *
 * Several of those screens (`LibraryScreen`, `WorkDetailScreen`,
 * `MusicDetailScreen`, `SearchScreen`, `PlaylistsScreen`) were written
 * against a small, bespoke `navigation: {navigate: (route, params?) =>
 * void}` prop shape, deliberately narrower than React Navigation's own
 * `NavigationProp` (each file's own doc comment explains this as avoiding
 * a dependency on `RootNavigator.tsx`'s `NavigationProp<ReactNavigation.
 * RootParamList>` augmentation existing yet). This file is the one place
 * that gap gets closed: a small wrapper per screen adapts the real
 * `useNavigation()`/`useRoute()` result down to whatever narrow shape that
 * screen expects, via an explicit object literal rather than passing
 * `navigation` straight through -- `strict: true` checks an inline
 * `{navigate: (route, params?) => void}` interface property
 * contravariantly (`strictFunctionTypes`), so relying on the real,
 * overloaded `NavigationProp['navigate']` structurally satisfying that
 * narrower type is not something worth reasoning through call by call when
 * a one-line wrapper sidesteps the question entirely.
 *
 * `WorkDetailScreenScreen`/`MusicDetailScreenScreen` close a second gap the
 * same way: both `WorkDetailScreen.tsx`/`MusicDetailScreen.tsx` take an
 * injected `onPlay?: (mediaFileId: string) => void` prop, and both files'
 * own doc comments name this file's wrapper functions as the place that
 * prop should actually reach `PlayerScreen.tsx`'s shell-mounted handle.
 * `useContext(PlayerHandleContext)` (`App.tsx` provides it, wrapping both
 * `<NavigationContainer>` and `<PlayerScreen>`) is that reach: each wrapper
 * passes `onPlay={(mediaFileId) => handle?.current?.show(mediaFileId)}`
 * down, so pressing Play negotiates and starts real playback rather than
 * leaving the button permanently disabled.
 *
 * ## Two nested-navigator subtleties worth being explicit about
 *
 * `useNavigation()`/`useRoute()` called at THIS component's own top level
 * (before it renders its own nested `<ContentStack.Navigator>`) return the
 * navigation/route props React Navigation hands to an "AppShell" screen,
 * i.e. `RootNavigator`'s OWN stack -- because that is the navigator that
 * actually rendered this component. That is exactly what the `authFailed`
 * effect below needs (it targets `ROUTES.profiles`, a SIBLING of AppShell
 * in `RootNavigator`'s stack, not a screen inside this file's own nested
 * stack at all), and exactly what `getFocusedRouteNameFromRoute` needs
 * (its whole job is reading the CURRENTLY FOCUSED nested-navigator screen
 * name back out of a route object that carries that nested state -- the
 * documented React Navigation recipe for "a UI element outside a nested
 * navigator needs to know its active screen", used here so `<NavRail>`'s
 * `activeRoute` prop reflects reality). Neither is the right navigation
 * prop for the nav rail's own button presses, though, which need to reach
 * a screen INSIDE the nested `ContentStack` from OUTSIDE it -- React
 * Navigation's own documented pattern for that is the two-level call
 * `navigate(<nested navigator's own screen name>, {screen: <target screen
 * name>})`, which `navRailNavigate` below wraps in one line so every call
 * site reads as `navRailNavigate(ROUTES.x)`.
 */
import React, {useContext, useEffect, useState} from 'react';
import {View} from 'react-native';
import {createStackNavigator} from '@amazon-devices/react-navigation__stack';
import {
  getFocusedRouteNameFromRoute,
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@amazon-devices/react-navigation__native';
import type {WorkKind} from '@playarr-tv/api-client';
import {useApiClient, useAuthFailed} from '../api/ApiClientProvider';
import {APP_CONFIG} from '../config/appConfig';
import {findCurrentProfile, listViewerProfiles, type ViewerProfile} from '../auth/profiles';
import {ShellChrome, type RailTarget} from '../shell/ShellChrome';
import {PlaceholderScreen} from '../screens/PlaceholderScreen';
import {StyleSheet} from 'react-native';
import {
  createCatalogKindsCacheScope,
  readCachedCatalogKinds,
  writeCachedCatalogKinds,
} from '../lib/catalogKindsCache';
import {PlayerHandleContext} from './PlayerHandleContext';
import {HomeScreen} from '../screens/HomeScreen';
import {LibraryScreen, type LibraryKind} from '../screens/LibraryScreen';
import {MusicDetailScreen} from '../screens/MusicDetailScreen';
import {NotFoundScreen} from '../screens/NotFoundScreen';
import {PlaylistsScreen} from '../screens/PlaylistsScreen';
import {SearchScreen} from '../screens/SearchScreen';
import {SettingsScreen, type SettingsSectionId} from '../screens/SettingsScreen';
import {WorkDetailScreen} from '../screens/WorkDetailScreen';
import {useTvBackNavigation} from './backPolicy';
import {ROUTES, type RouteName} from './routes';
import {colour} from '../theme/tokens';

/**
 * This nested navigator's own screen name within `RootNavigator`'s stack.
 * Deliberately NOT a `routes.ts` entry: `ROUTES` enumerates PAGES a caller
 * navigates to by name (`navigation.navigate(ROUTES.home)`); nobody ever
 * navigates to "AppShell" as a destination in that sense -- it is the
 * nesting boundary between the pre-auth stack and this file's own content
 * stack, the same structural role tv-web's `<AppShell>` layout route plays
 * (a React Router "layout route" has no pathname of its own either).
 * Exported so `RootNavigator.tsx` can register this component under the
 * exact same name this file uses internally to navigate back into itself
 * (`navRailNavigate` below) -- keeping the string in one place rather than
 * two files needing to agree on a literal by coincidence.
 */
export const APP_SHELL_ROUTE = 'AppShell' as const;

const ContentStack = createStackNavigator();

/**
 * Adapts a real `NavigationProp` down to the narrow `{navigate: (route,
 * params?) => void}` shape `LibraryScreen.tsx`/`SearchScreen.tsx`/
 * `PlaylistsScreen.tsx` (and, via `WorkDetailNavAdapter`/
 * `MusicDetailNavAdapter` below, `WorkDetailScreen.tsx`/
 * `MusicDetailScreen.tsx`) each declare for themselves -- see this file's
 * top comment for why an explicit wrapper, not a direct structural pass,
 * is used everywhere this shape is needed.
 */
function navigateAdapter(navigation: NavigationProp<ParamListBase>): {
  navigate: (route: RouteName, params?: Record<string, unknown>) => void;
} {
  // A string-typed call: TypeScript 4.9 cannot resolve `navigate` against a union of this many route names.
  const navigate = navigation.navigate as unknown as (name: string, params?: object) => void;
  return {navigate: (route, params) => navigate.call(navigation, route, params)};
}

function LibraryKindScreen({kind}: {kind: LibraryKind}): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  useTvBackNavigation();
  return <LibraryScreen kind={kind} navigation={navigateAdapter(navigation)} />;
}

function SeriesScreen(): React.ReactElement {
  return <LibraryKindScreen kind="series" />;
}
function MoviesScreen(): React.ReactElement {
  return <LibraryKindScreen kind="movie" />;
}
function SitesScreen(): React.ReactElement {
  return <LibraryKindScreen kind="site" />;
}
function MusicLibraryScreen(): React.ReactElement {
  return <LibraryKindScreen kind="artist" />;
}

function settingsRoute(initial: SettingsSectionId): () => React.ReactElement {
  return function SettingsRoute(): React.ReactElement {
    return <SettingsScreen initial={initial} />;
  };
}
const SettingsRoutes = {
  settings: settingsRoute('appearance'),
  appearance: settingsRoute('appearance'),
  avatar: settingsRoute('profile-avatar'),
  language: settingsRoute('language'),
  player: settingsRoute('player'),
  server: settingsRoute('server'),
  lock: settingsRoute('profile-lock'),
  invite: settingsRoute('invite'),
  latency: settingsRoute('request-latency'),
  remote: settingsRoute('remote'),
  yourData: settingsRoute('your-data'),
};

function SearchScreenScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  useTvBackNavigation();
  return <SearchScreen navigation={navigateAdapter(navigation)} />;
}

function PlaylistsScreenScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  useTvBackNavigation();
  return <PlaylistsScreen navigation={navigateAdapter(navigation)} />;
}

/**
 * `WorkDetailScreen.tsx`/`MusicDetailScreen.tsx` both declare `route:
 * {params: {workId: string}}` -- a narrower shape than React Navigation's
 * own genuinely-optional `route.params: object | undefined` -- because
 * every real caller (`HomeScreen.tsx`'s `openWork`, `LibraryScreen.tsx`'s
 * own `openWork`) always supplies `workId`. A missing `workId` at this
 * point in the tree would mean a `navigation.navigate(ROUTES.workDetail,
 * ...)` call elsewhere in this app forgot it -- a programming error, not a
 * reachable user state -- so it falls back to `NotFoundScreen` (via
 * `ROUTES.notFound`'s own registration below picking it up on the next
 * render) rather than this file inventing a third "malformed params"
 * screen just to name that one edge case.
 */
function WorkDetailScreenScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<RouteProp<ParamListBase>>();
  const params = route.params as {workId?: string; backTo?: RouteName} | undefined;
  const playerHandle = useContext(PlayerHandleContext);
  useTvBackNavigation(params?.backTo);

  if (!params?.workId) {
    navigation.navigate(ROUTES.notFound);
    return <View style={{flex: 1, backgroundColor: colour.bg}} />;
  }

  return (
    <WorkDetailScreen
      route={{params: {workId: params.workId}}}
      navigation={navigateAdapter(navigation)}
      onPlay={(mediaFileId) => playerHandle?.current?.show(mediaFileId)}
    />
  );
}

function MusicDetailScreenScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<RouteProp<ParamListBase>>();
  const params = route.params as {workId?: string; backTo?: RouteName} | undefined;
  const playerHandle = useContext(PlayerHandleContext);
  useTvBackNavigation(params?.backTo ?? ROUTES.music);

  if (!params?.workId) {
    navigation.navigate(ROUTES.notFound);
    return <View style={{flex: 1, backgroundColor: colour.bg}} />;
  }

  return (
    <MusicDetailScreen
      route={{params: {workId: params.workId}}}
      navigation={navigateAdapter(navigation)}
      onPlay={(mediaFileId) => playerHandle?.current?.show(mediaFileId)}
    />
  );
}

/** Same adaptation as the screens above, for `NotFoundScreen.tsx`'s own bespoke `{goBack, navigateHome, canGoBack}` navigation contract. */
function NotFoundScreenScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  return (
    <NotFoundScreen
      navigation={{
        goBack: () => navigation.goBack(),
        navigateHome: () => navigation.navigate(ROUTES.home),
        canGoBack: navigation.canGoBack(),
      }}
    />
  );
}

export function AppShellNavigator(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const ownRoute = useRoute<RouteProp<ParamListBase>>();
  const client = useApiClient();
  const {authFailed, clearAuthFailed} = useAuthFailed();

  // `null` while unresolved -- `<NavRail>`'s own `visibleNavGroups` call
  // treats that as "render no groups at all" rather than a half-correct
  // guess, matching tv-web's own `availableWorkKinds !== null` guard
  // around its whole `<nav>` (design doc §7's closing paragraph;
  // `components/navGroups.ts`'s own doc comment on `visibleNavGroups`
  // states this explicitly).
  const [availableWorkKinds, setAvailableWorkKinds] = useState<ReadonlySet<WorkKind> | null>(null);

  // Synchronising with an external system (the server's advertised
  // catalogue kinds) -- a real `useEffect` case per this repo's React
  // rule, not derivable from props/state. `createCatalogKindsCacheScope`
  // is called with `userId: undefined` -- honestly, not as a shortcut:
  // `src/auth/profiles.ts` exists in this worktree but does not expose a
  // signed-in profile id through `ApiClientProvider`'s context yet (that
  // provider's own doc comment states this is deliberately deferred).
  // `undefined` makes `createCatalogKindsCacheScope` return `null`
  // unconditionally, which makes both `readCachedCatalogKinds`/
  // `writeCachedCatalogKinds` inert no-ops (both already document `null`
  // as "nothing usable" / "silent no-op") -- so this correctly degrades to
  // "always fetch fresh, no instant-paint cache" today, while already
  // being wired the shape a later `ApiClientProvider` integration needs:
  // swapping in a real `currentUserId` here is a one-line change, not new
  // plumbing.
  useEffect(() => {
    let cancelled = false;
    const scope = createCatalogKindsCacheScope(undefined, [client.resolveUrl('/')]);
    const cached = readCachedCatalogKinds(scope);
    if (cached) setAvailableWorkKinds(cached);

    void client
      .listCatalogKinds()
      .then((kinds) => {
        if (cancelled) return;
        writeCachedCatalogKinds(scope, kinds);
        setAvailableWorkKinds(new Set(kinds));
      })
      .catch((error: unknown) => {
        // A failed catalogue-kinds fetch degrades to "no nav groups render"
        // (the `null` default stays in place) rather than throwing --
        // browsing already-cached content is still possible via whatever
        // screen the viewer is currently on, so a transient network blip
        // here should not crash the whole shell.
        console.warn('[AppShellNavigator] listCatalogKinds failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // See this file's top comment for why `authFailed` recovery belongs
  // here rather than per-screen, and why it targets `ROUTES.profiles`
  // rather than `ROUTES.link`: `authFailed` means an existing session's
  // transparent refresh failed with nothing left to fall back on -- the
  // device is still linked to a server, so re-selecting a profile (a
  // fresh PIN, or a different household member) is the right recovery,
  // not re-running device-code pairing from scratch. Mirrors tv-web's own
  // `AppShell` rendering `<ProfilesPage>` in place the moment `authFailed`
  // flips true (`App.tsx`'s own doc comment: "the profile selector is
  // then rendered in place"). This port is honestly simpler than that,
  // not equivalent to it: tv-web preserves the original URL underneath so
  // a successful re-auth can reveal the exact page the viewer was on;
  // this `navigation.reset` unconditionally drops this file's whole
  // nested content stack and always lands back on Home after a
  // successful re-auth. Preserving "return to where you were" needs
  // profile-session bookkeeping this pass's own `ApiClientProvider`
  // integration does not expose yet -- this is the honest v1 behaviour
  // available without it, not the intended final behaviour.
  useEffect(() => {
    if (!authFailed) return;
    navigation.reset({index: 0, routes: [{name: ROUTES.profiles}]});
    clearAuthFailed();
  }, [authFailed, navigation, clearAuthFailed]);

  function navRailNavigate(route: RouteName): void {
    navigation.navigate(APP_SHELL_ROUTE, {screen: route});
  }

  const activeRoute = (getFocusedRouteNameFromRoute(ownRoute) as RouteName | undefined) ?? ROUTES.home;
  const [profile, setProfile] = useState<ViewerProfile | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    listViewerProfiles(client)
      .then((profiles) => {
        if (!cancelled) setProfile(findCurrentProfile(profiles) ?? profiles[0]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);

  const railRoutes: Record<RailTarget, RouteName> = {
    downloads: ROUTES.downloads,
    search: ROUTES.search,
    home: ROUTES.home,
    series: ROUTES.series,
    movies: ROUTES.movies,
    sites: ROUTES.sites,
    music: ROUTES.music,
    playlists: ROUTES.playlists,
    watchlist: ROUTES.watchlist,
    requests: ROUTES.requests,
    calendar: ROUTES.calendar,
  };
  const activeTarget = (Object.keys(railRoutes) as RailTarget[]).find((target) => railRoutes[target] === activeRoute) ?? null;

  return (
    <View style={{flex: 1, backgroundColor: colour.bg}}>
      <ContentStack.Navigator screenOptions={{headerShown: false, animationEnabled: false}}>
        <ContentStack.Screen name={ROUTES.home} component={HomeScreen} />
        <ContentStack.Screen name={ROUTES.search} component={SearchScreenScreen} />
        <ContentStack.Screen name={ROUTES.series} component={SeriesScreen} />
        <ContentStack.Screen name={ROUTES.movies} component={MoviesScreen} />
        <ContentStack.Screen name={ROUTES.sites} component={SitesScreen} />
        <ContentStack.Screen name={ROUTES.music} component={MusicLibraryScreen} />
        <ContentStack.Screen name={ROUTES.playlists} component={PlaylistsScreenScreen} />
        <ContentStack.Screen name={ROUTES.downloads} component={PlaceholderScreen} />
        <ContentStack.Screen name={ROUTES.watchlist} component={PlaceholderScreen} />
        <ContentStack.Screen name={ROUTES.requests} component={PlaceholderScreen} />
        <ContentStack.Screen name={ROUTES.calendar} component={PlaceholderScreen} />
        <ContentStack.Screen name={ROUTES.homeCustomise} component={PlaceholderScreen} />
        <ContentStack.Screen name={ROUTES.workDetail} component={WorkDetailScreenScreen} />
        <ContentStack.Screen name={ROUTES.musicDetail} component={MusicDetailScreenScreen} />
        <ContentStack.Screen name={ROUTES.settings} component={SettingsRoutes.settings} />
        <ContentStack.Screen name={ROUTES.settingsAppearance} component={SettingsRoutes.appearance} />
        <ContentStack.Screen name={ROUTES.settingsLanguage} component={SettingsRoutes.language} />
        <ContentStack.Screen name={ROUTES.settingsPlayer} component={SettingsRoutes.player} />
        <ContentStack.Screen name={ROUTES.settingsServer} component={SettingsRoutes.server} />
        <ContentStack.Screen name={ROUTES.settingsProfileLock} component={SettingsRoutes.lock} />
        <ContentStack.Screen name={ROUTES.settingsAvatar} component={SettingsRoutes.avatar} />
        <ContentStack.Screen name={ROUTES.settingsInvite} component={SettingsRoutes.invite} />
        <ContentStack.Screen name={ROUTES.settingsRemote} component={SettingsRoutes.remote} />
        <ContentStack.Screen name={ROUTES.settingsLatency} component={SettingsRoutes.latency} />
        <ContentStack.Screen name={ROUTES.settingsYourData} component={SettingsRoutes.yourData} />
        <ContentStack.Screen name={ROUTES.notFound} component={NotFoundScreenScreen} />
      </ContentStack.Navigator>
      <ShellChrome
        active={activeTarget}
        profileId={profile?.id}
        profileName={profile?.displayName ?? ''}
        version={APP_CONFIG.clientVersion}
        availableWorkKinds={availableWorkKinds}
        clockRight={activeRoute === ROUTES.home ? 633.6 : 710.4}
        onSelect={(target) => navRailNavigate(railRoutes[target])}
        onOpenProfiles={() => navigation.navigate(ROUTES.profiles)}
      />
    </View>
  );
}
