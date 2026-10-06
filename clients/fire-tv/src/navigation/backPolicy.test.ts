/**
 * Mirrors tv-web's own back-navigation tests
 * (`clients/tv-web/web/src/lib/useTvNavigation.test.ts`'s "returns client
 * detail pages to the clients hub on remote Back" / "leaves an unhandled
 * root Back press for an installed TV platform" cases), translated onto
 * this file's route-NAME model rather than that file's pathname model --
 * see `backPolicy.ts`'s own doc comment for the full rationale of the port.
 *
 * Only `parentRoute`/`tvBackNavigationTarget` (pure functions, no React, no
 * rendering) are exercised below, but simply `import`ing `./backPolicy`
 * still evaluates that module's OWN top-level imports in full -- including
 * `useBackHandler` from `../platform`'s barrel, which transitively reaches
 * `deviceInfo.ts` -> `@amazon-devices/react-native-device-info`, whose
 * module-load-time `new NativeEventEmitter()` construction throws under
 * Jest (no native host, and `jest.setup.ts` only globally mocks
 * AsyncStorage, not this package). `screens/LinkScreen.test.tsx` hit the
 * identical failure for the identical reason (that screen also imports the
 * `../platform` barrel) and documents the same fix this file copies: a
 * file-local `jest.mock()` for the two packages that construct native
 * bridges at import time, kept here rather than added to
 * `jest.config.json`/`jest.setup.ts` per this task's own constraint against
 * touching shared config other concurrent feature work may also depend on.
 * `@amazon-devices/react-navigation__native` needs no such mock -- it is
 * plain JS/TS with no `requireNativeComponent` of its own, so it loads
 * under Jest without help; only `useNavigation`/`useRoute` themselves would
 * need a real navigation TREE to call successfully, and this file's tests
 * never render anything that would call them.
 */
jest.mock('@amazon-devices/react-native-kepler', () => ({
  __esModule: true,
  TVFocusGuideView: ({children}: {children?: React.ReactNode}) => children,
  FocusManager: {focus: jest.fn(), blur: jest.fn(), setFocusRoot: jest.fn(), getFocused: jest.fn()},
  useTVEventHandler: jest.fn(),
  useKeplerAppStateManager: jest.fn(() => ({
    getCurrentState: () => 'active',
    addAppStateListener: () => ({remove: jest.fn()}),
  })),
}));

jest.mock('@amazon-devices/react-native-device-info', () => ({
  __esModule: true,
  getModel: () => 'Fire TV Stick 4K',
  getSystemVersion: () => '8.0.0',
}));

import type * as React from 'react';
import {parentRoute, tvBackNavigationTarget} from './backPolicy';
import {ROUTES, type RouteName} from './routes';

describe('parentRoute', () => {
  it('returns music detail pages to the music library', () => {
    expect(parentRoute(ROUTES.musicDetail)).toBe(ROUTES.music);
  });

  it('falls back to home for a work detail page reached with no explicit parent', () => {
    // The safety net this file's own doc comment warns every real caller
    // must not rely on -- WorkDetail backs several distinct parents that
    // cannot be recovered from the route name alone.
    expect(parentRoute(ROUTES.workDetail)).toBe(ROUTES.home);
  });

  it('prefers an explicit requestedBackTo over a route detail screen\'s own default parent', () => {
    expect(parentRoute(ROUTES.workDetail, ROUTES.series)).toBe(ROUTES.series);
    expect(parentRoute(ROUTES.workDetail, ROUTES.movies)).toBe(ROUTES.movies);
    expect(parentRoute(ROUTES.workDetail, ROUTES.sites)).toBe(ROUTES.sites);
    expect(parentRoute(ROUTES.workDetail, ROUTES.search)).toBe(ROUTES.search);
    expect(parentRoute(ROUTES.workDetail, ROUTES.playlists)).toBe(ROUTES.playlists);
  });

  it('returns every settings sub-screen to the settings index', () => {
    expect(parentRoute(ROUTES.settingsAppearance)).toBe(ROUTES.settings);
    expect(parentRoute(ROUTES.settingsLanguage)).toBe(ROUTES.settings);
    expect(parentRoute(ROUTES.settingsPlayer)).toBe(ROUTES.settings);
    expect(parentRoute(ROUTES.settingsServer)).toBe(ROUTES.settings);
    expect(parentRoute(ROUTES.settingsProfileLock)).toBe(ROUTES.settings);
  });

  it('returns every top-level shell destination to home, same as tv-web falling every top-level pathname through to "/"', () => {
    const topLevel: RouteName[] = [
      ROUTES.search,
      ROUTES.series,
      ROUTES.movies,
      ROUTES.sites,
      ROUTES.music,
      ROUTES.playlists,
      ROUTES.profiles,
      ROUTES.settings,
    ];
    for (const route of topLevel) {
      expect(parentRoute(route)).toBe(ROUTES.home);
    }
  });

  it('resolves home itself to home, exactly like tv-web resolving "/" to "/"', () => {
    expect(parentRoute(ROUTES.home)).toBe(ROUTES.home);
  });
});

describe('tvBackNavigationTarget', () => {
  it('leaves an unhandled root Back press for the platform\'s own default behaviour', () => {
    expect(tvBackNavigationTarget(ROUTES.home)).toBeNull();
  });

  it('honours an explicit requestedBackTo even at the root', () => {
    expect(tvBackNavigationTarget(ROUTES.home, ROUTES.profiles)).toBe(ROUTES.profiles);
  });

  it('resolves a top-level destination back to home', () => {
    expect(tvBackNavigationTarget(ROUTES.movies)).toBe(ROUTES.home);
  });

  it('resolves a detail screen to its computed parent', () => {
    expect(tvBackNavigationTarget(ROUTES.workDetail, ROUTES.movies)).toBe(ROUTES.movies);
  });

  it('prefers a native stack pop when a navigation origin is present, regardless of the computed parent', () => {
    expect(tvBackNavigationTarget(ROUTES.home, undefined, true)).toBe(-1);
    expect(tvBackNavigationTarget(ROUTES.workDetail, ROUTES.movies, true)).toBe(-1);
  });
});
