/**
 * Back-navigation policy for the Vega app shell -- a port of tv-web's
 * `parentRoute()` / `tvBackNavigationTarget()`
 * (`clients/tv-web/web/src/lib/useTvNavigation.ts:540-587`), adapted from
 * that file's pathname model onto Vega's route-NAME model (design doc
 * §4.3). The two pure functions below are named identically to their web
 * counterparts and decide exactly the same question -- "given where the
 * viewer is and what they asked for, where should a Back press land?" --
 * with an outcome type widened by exactly one member (`null`) meaning
 * "leave this press unhandled", matching the web version's own
 * `target === routeKey -> null` convention precisely.
 *
 * What this file deliberately does NOT port is the rest of
 * `useTvNavigation.ts` -- the 741 lines of geometric directional-focus
 * scoring, scroll-into-view maths, and the DOM `keydown`/`data-tv-focus-*`
 * attribute wiring that exist purely because a web `<div>` has no native
 * concept of "the next focusable widget in this direction". Design doc
 * §4.4 is explicit that Vega's own Cartesian focus engine already does that
 * job natively and apps cannot override the D-pad's default behaviour, so
 * there is nothing in that part of the web file for a Vega port to inherit.
 * `useTvBackNavigation` at the bottom of this file is the ONE piece of
 * "wiring" this port does still need to add that tv-web's `useTvNavigation`
 * hook also did (subscribing an actual key/event source and calling
 * `navigate`) -- Back is the one gesture Vega's focus engine has no opinion
 * about at all, so unlike directional movement, this app still owns 100% of
 * deciding what a Back press does.
 */
import {useEffect, useRef} from 'react';
import {useNavigation, useRoute, type NavigationProp, type ParamListBase} from '@amazon-devices/react-navigation__native';
import {useBackHandler} from '../platform';
import {ROUTES, type RouteName} from './routes';

/**
 * Destinations a caller may hand back as `requestedBackTo` and have honoured
 * outright. Mirrors tv-web's own accepted-verbatim pathname list (`/`,
 * `/series`, `/movies`, `/sites`, `/music`, `/profiles`, `/settings`,
 * `/playlists[?playlist=...]`, `/search[?...]`) minus `/clients` -- the
 * public playarr.app download catalogue design doc §7 marks "web-only by
 * definition", so there is no Fire TV route to name here at all.
 */
const REQUESTABLE_PARENTS: ReadonlySet<RouteName> = new Set([
  ROUTES.home,
  ROUTES.search,
  ROUTES.series,
  ROUTES.movies,
  ROUTES.sites,
  ROUTES.music,
  ROUTES.playlists,
  ROUTES.profiles,
  ROUTES.settings,
]);

/**
 * Resolves the route a Back press from `routeName` should land on.
 *
 * An explicit `requestedBackTo` -- when it names one of `REQUESTABLE_PARENTS`
 * -- wins outright, exactly as tv-web's version treats an explicit `backTo`
 * location-state value as authoritative over whatever the current pathname
 * alone would imply. This matters most for `workDetail`: tv-web can tell
 * `/series/:id` from `/movies/:id` from `/search/:id` apart by pathname
 * alone (three distinct regexes in the ported function's web original), but
 * Fire TV backs ALL of series/movies/sites/a search result/a playlist item
 * with the SAME `workDetail` route name (`routes.ts`'s own comment on that
 * entry), so the route name can never by itself recover which rail the
 * viewer actually drilled in from -- only an explicit `requestedBackTo` can.
 * Every `navigation.navigate(ROUTES.workDetail, {backTo: someParent})` call
 * a later screen makes MUST supply it for that reason; `home` below is only
 * the safety net for a caller that forgets, never the intended behaviour.
 */
export function parentRoute(routeName: RouteName, requestedBackTo?: RouteName): RouteName {
  if (requestedBackTo && REQUESTABLE_PARENTS.has(requestedBackTo)) {
    return requestedBackTo;
  }

  switch (routeName) {
    case ROUTES.musicDetail:
      return ROUTES.music;
    case ROUTES.workDetail:
      return ROUTES.home;
    case ROUTES.settingsAppearance:
    case ROUTES.settingsLanguage:
    case ROUTES.settingsPlayer:
    case ROUTES.settingsServer:
    case ROUTES.settingsProfileLock:
      return ROUTES.settings;
    default:
      // Every top-level shell destination (home, search, series, movies,
      // sites, music, playlists, profiles, settings) falls through to here
      // and resolves to itself (home) -- exactly mirroring tv-web's
      // parentRoute() falling through every top-level pathname, AND "/"
      // itself, to the same `return "/"`. `link` and `notFound` fall
      // through here too, for the same reason tv-web's version has no
      // special case for them either: neither is a "page with a knowable
      // parent", so home is the only sane universal default.
      // `tvBackNavigationTarget` below is what turns "the resolved target
      // IS the current route" into "leave this press unhandled" -- not
      // this function, which always returns a real `RouteName`.
      return ROUTES.home;
  }
}

/**
 * `-1` means "pop the native stack" (the RN equivalent of tv-web's
 * `navigate(-1)` browser-history back); `null` means "leave this Back press
 * unhandled", which `useBackHandler`'s contract (see `platform/lifecycle.ts`)
 * turns into "let Vega's own default behaviour proceed" -- e.g. exiting the
 * app from Home, since Home has no further parent to walk up to.
 *
 * `hasNavigationOrigin` is this port's one adapted concept rather than a
 * literal port: tv-web's version reads a same-named flag off React Router's
 * location state, because a single-page app's browser history can contain
 * entries with no real in-app predecessor (a fresh deep link, a reload) that
 * `navigate(-1)` would be unsafe to trust. React Navigation's native stack
 * has no such ambiguity -- `navigation.canGoBack()` answers exactly the same
 * question directly and reliably, because the stack genuinely does or does
 * not have a previous entry to pop to. Every caller of `parentRoute`/
 * `tvBackNavigationTarget` directly (this file's own tests included) still
 * passes it explicitly, for parity with the web function's signature and
 * so a caller with its own reason to override the default can; the
 * `useTvBackNavigation` hook below is what supplies `navigation.canGoBack()`
 * for real screens.
 */
export function tvBackNavigationTarget(
  routeName: RouteName,
  requestedBackTo?: RouteName,
  hasNavigationOrigin = false
): RouteName | -1 | null {
  if (hasNavigationOrigin) return -1;
  const target = parentRoute(routeName, requestedBackTo);
  return target === routeName ? null : target;
}

/**
 * The wiring a real screen needs to actually act on the policy above: reads
 * this screen's own route name (and, when the screen was navigated to with
 * one, its `backTo` param) via `useRoute()`, subscribes to the de-duplicated
 * remote/hardware Back signal via `platform/lifecycle.ts`'s
 * `useBackHandler`, and calls `navigation.goBack()` or `navigation.navigate`
 * with whatever `tvBackNavigationTarget` decides.
 *
 * A screen that wants a fixed parent regardless of how it was reached
 * (uncommon, but true of e.g. a screen only ever pushed from exactly one
 * place) may pass `fallbackBackTo` explicitly; screens reached from several
 * different parents (`WorkDetailScreen` chief among them) should instead
 * pass the `backTo` they themselves received via `navigation.navigate(...,
 * {backTo})` when THEY pushed a child screen -- this hook only reads its
 * OWN screen's incoming `backTo` param automatically, it does not invent
 * one.
 */
const backLayers: Array<() => void> = [];

/**
 * An open drawer, menu or dialog owns Back while it is `active` (web's layered Back): the press closes the topmost layer
 * and the screen's own Back policy does not run.
 */
export function useBackLayer(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!active) return undefined;
    const layer = (): void => onBackRef.current();
    backLayers.push(layer);
    return () => {
      const index = backLayers.lastIndexOf(layer);
      if (index >= 0) backLayers.splice(index, 1);
    };
  }, [active]);
}

export function useTvBackNavigation(fallbackBackTo?: RouteName): void {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute();
  const routeName = route.name as RouteName;
  const routeBackTo = (route.params as {backTo?: RouteName} | undefined)?.backTo;

  useBackHandler(() => {
    const layer = backLayers[backLayers.length - 1];
    if (layer) {
      layer();
      return true;
    }
    const target = tvBackNavigationTarget(
      routeName,
      routeBackTo ?? fallbackBackTo,
      navigation.canGoBack()
    );
    if (target === null) return false;
    if (target === -1) {
      navigation.goBack();
    } else {
      (navigation.navigate as unknown as (name: string) => void).call(navigation, target);
    }
    return true;
  });
}
