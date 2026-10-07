/**
 * The real app shell, wired for real: polyfills and storage hydration run
 * before anything else, then design doc §4.2's provider chain renders the
 * genuine navigator tree rather than a placeholder screen.
 *
 *   polyfills + hydrate
 *    -> <LanguageProvider>
 *       -> <ApiClientProvider>
 *          -> <PlayerHandleContext.Provider>  exposes playerRef downward
 *             -> <NavigationContainer>
 *                -> <RootNavigator>          Link / Profiles / AppShell
 *             -> <PlayerScreen>              shell-mounted, NOT a route
 *
 * `<ThemeProvider>` is still absent, and deliberately so, for exactly the
 * reason the previous version of this file explained: design doc §2's own
 * directory listing has no such component under `theme/`, which is three
 * files of plain exported constants (`tokens.ts`/`scale.ts`/`styles.ts`),
 * not a React Context. Every screen already imports `colour`/`text`/
 * `layout` directly. A real `ThemeProvider` only earns its keep once
 * `settings/AppearanceScreen.tsx` makes the theme switchable at runtime,
 * which is a later step.
 *
 * `<PlayerScreen>` is mounted here, once, as a sibling of
 * `<NavigationContainer>` rather than inside it -- `PlayerScreen.tsx`'s own
 * doc comment states this literally ("A later stage mounts exactly one
 * `<PlayerScreen ref={...} />` inside App.tsx's render tree"), and it is
 * the only placement that satisfies design doc §4.2's stated reason for
 * shell-mounting it at all: "so a minimised music player survives
 * navigation." A screen registered as a route would unmount the instant
 * navigation moved away from it, which is precisely the behaviour this
 * exists to avoid, and on Vega there is a second, harder reason it matters:
 * `VegaPlaybackEngine` is a singleton wrapping a native decoder the first-
 * generation Fire TV Stick allows only one instance of at a time, so the
 * component that owns it must not be torn down and recreated by ordinary
 * navigation. It renders after (i.e. visually on top of) `RootNavigator`'s
 * whole tree so a visible player overlays whatever screen sits underneath,
 * and renders `null` while hidden, so it costs nothing layout-wise the rest
 * of the time.
 *
 * It sits inside `<ApiClientProvider>` because `PlayerScreen` calls
 * `useApiClient()` for negotiation, watch-progress and analytics calls, but
 * outside `<NavigationContainer>`/`<RootNavigator>` because it is not
 * itself a screen those navigators know about.
 *
 * The integration gap a previous version of this file left open
 * deliberately -- `WorkDetailScreen.tsx`/`MusicDetailScreen.tsx` both take an
 * injected `onPlay?: (mediaFileId: string) => void` prop, but nothing threads
 * a real callback to `AppShellNavigator.tsx`'s `WorkDetailScreenScreen`/
 * `MusicDetailScreenScreen` wrapper functions that actually render those two
 * screens -- is now closed by `PlayerHandleContext` (`navigation/
 * PlayerHandleContext.ts`). This file provides `playerRef` itself (the ref
 * object, not `playerRef.current`, for the reason that module's own doc
 * comment explains) as that context's value, wrapping both
 * `<NavigationContainer>` and `<PlayerScreen>` so every screen mounted below
 * either can reach it via `useContext(PlayerHandleContext)`.
 * `AppShellNavigator.tsx` is the consumer: its two wrapper functions read the
 * context and pass `onPlay={(mediaFileId) => handle?.current?.show(mediaFileId)}`
 * down to the real screens, closing the loop this file's own `playerRef`
 * existed to serve from the start.
 */
import './bootstrap/polyfills';

import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {GestureHandlerRootView} from '@amazon-devices/react-native-gesture-handler';
import {SafeAreaProvider} from '@amazon-devices/react-native-safe-area-context';
import {NavigationContainer} from '@amazon-devices/react-navigation__native';
import {hydrate} from './bootstrap/hydrate';
import {LanguageProvider} from './i18n/LanguageProvider';
import {ApiClientProvider} from './api/ApiClientProvider';
import {RootNavigator} from './navigation/RootNavigator';
import {PlayerHandleContext} from './navigation/PlayerHandleContext';
import {PlayerScreen, type PlayerScreenHandle} from './screens/PlayerScreen';
import {colour} from './theme/tokens';
import {ThemeBoundary, ThemeProvider} from './theme/ThemeProvider';
import {layout} from './theme/styles';

/**
 * `<SafeAreaProvider>` renders NO children at all until it has received a
 * real `onInsetsChange` event from the native side (confirmed directly
 * against this Vega fork's own `SafeAreaContext.js`: `insets` starts as
 * `null` and stays `null`, gating the whole child tree, unless an
 * `initialMetrics`/`initialSafeAreaInsets` prop seeds it). This package's
 * own `initialWindowMetrics` export -- the usual escape hatch other RN
 * apps reach for -- is hard-coded `null` in this fork's own
 * `InitialWindow.js`, so it provides nothing to seed with here. Two
 * independent reasons make an explicit zero value the right seed rather
 * than leaving this unset: a Fire TV's 1920x1080 broadcast-safe canvas has
 * no notch, no home indicator and no rounded-corner inset the way a phone
 * does, so zero is not a placeholder guess, it is the geometrically correct
 * answer for this whole device class; and, practically, leaving this unset
 * means the entire app renders nothing at all until that native event
 * arrives, which is also exactly what made `<App>`'s own render-level
 * smoke test hang under Jest (there is no native host to ever send it).
 */
const ZERO_SAFE_AREA_INSETS = {top: 0, right: 0, bottom: 0, left: 0};

function LoadingScreen(): JSX.Element {
  return (
    <View style={[layout.appScreen, styles.centered]}>
      <ActivityIndicator color={colour.focusRing} size="large" />
    </View>
  );
}

export default function App(): JSX.Element {
  // Synchronising with an external system (AsyncStorage, via the
  // localStorage shim) before this app can safely render anything that
  // reads @playarr-tv/device-auth's TokenStore or
  // @playarr-tv/domain's getStoredApiBaseUrl -- exactly the case
  // useEffect exists for, per this repo's own React rule; it is not
  // derivable from props/state and is not itself a response to a user
  // action.
  const [hydrated, setHydrated] = useState(false);

  // Lives at this level, not inside PlayerScreen itself, because it is the
  // handle onPlay wiring (see this file's top comment, and
  // PlayerHandleContext.ts) needs to reach from below, via context. Created
  // unconditionally, even before hydration finishes, since a ref itself has
  // no dependency on storage being ready -- only the component it is
  // attached to does.
  const playerRef = useRef<PlayerScreenHandle>(null);

  useEffect(() => {
    let cancelled = false;
    hydrate()
      .then(() => {
        if (!cancelled) setHydrated(true);
      })
      .catch((error: unknown) => {
        // Hydration failing outright (rather than a single key's
        // write-behind failing, which localStorageShim.ts already logs
        // and swallows) would mean AsyncStorage itself is unusable --
        // logged loudly here rather than leaving the app stuck on
        // LoadingScreen forever with no signal why.
        console.error('[App] storage hydration failed:', error);
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hydrated) {
    return <LoadingScreen />;
  }

  return (
    <ThemeProvider>
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider initialSafeAreaInsets={ZERO_SAFE_AREA_INSETS}>
        <LanguageProvider>
          <ApiClientProvider>
            <PlayerHandleContext.Provider value={playerRef}>
              <NavigationContainer>
                <ThemeBoundary>
                  <RootNavigator />
                </ThemeBoundary>
              </NavigationContainer>
              <PlayerScreen ref={playerRef} />
            </PlayerHandleContext.Provider>
          </ApiClientProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
