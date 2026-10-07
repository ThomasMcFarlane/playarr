/**
 * RN port of `clients/tv-web/web/src/pages/NotFound.tsx` -- the
 * authenticated catch-all `AppShellNavigator`'s content stack falls back to
 * when a `navigation.navigate` call somehow targets a route name that isn't
 * (or is no longer) registered. On the web this is reachable by typing an
 * arbitrary URL; there is no URL bar on a Fire TV remote, so in practice the
 * only way here is a stale deep link (design doc's deferred-to-v2 mechanism)
 * or a programming error in a `navigation.navigate` call elsewhere in this
 * app -- either way, the honest thing to show is "this isn't a real screen",
 * not a crash.
 *
 * Deliberately the simplest screen in this directory: no data fetching, no
 * `AsyncState`, nothing but static copy and a way back. tv-web's version
 * also renders a decorative inline SVG (a screen-and-magnifying-glass
 * illustration) purely for visual interest; that has no equivalent yet on
 * Vega (`components/TvEmptyState.tsx`'s 8 SVG variants are a components-
 * phase task, out of this screen's scope -- see this file's own README-style
 * note in the class doc above) and dropping it costs nothing functional, so
 * this screen renders text only until that component exists to swap in.
 *
 * Strings are hard-coded from `clients/tv-web/web/src/lib/i18n/translations/
 * en.ts`'s `pages.notFound.*` keys rather than routed through a
 * `useLanguage()` call, because `src/i18n/LanguageProvider.tsx` (design doc
 * §2's directory layout, build-order step 8) does not exist yet in this
 * worktree -- wiring this screen to real translations is a mechanical
 * follow-up once that provider lands, not a rewrite of this screen's
 * structure.
 */
// `React` itself must be a real value import, not just `useState` -- this
// project's babel.config.js forces the CLASSIC JSX runtime project-wide
// (`@babel/plugin-transform-react-jsx` with no `runtime: "automatic"`
// option, needed for `@amazon-devices/react-native-w3cmedia`'s
// `KeplerVideoView`, per that file's own comment), so every `.tsx` file's
// JSX compiles to a literal `React.createElement(...)` call. TypeScript's
// own `"jsx": "react-native"` typecheck does not itself demand `React` be in
// scope (it type-checks JSX elements structurally, against the global `JSX`
// namespace, not by requiring the identifier) -- so a file that skips this
// import still typechecks cleanly and only fails at actual render time
// (`ReferenceError: React is not defined`), which is exactly the gap a
// render test like this screen's own `.test.tsx` exists to catch.
import React, {useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {colour} from '../theme/tokens';
import {layout, text} from '../theme/styles';
import {sh, sw} from '../theme/scale';

export interface NotFoundScreenNavigation {
  /** Returns to the previous screen if there is one to return to; `AppShellNavigator` (a later step) supplies the real implementation. */
  goBack: () => void;
  /** Falls back to the home screen when there is nowhere to go back to (e.g. this was the very first screen navigated to). */
  navigateHome: () => void;
  /** Whether `goBack()` actually has somewhere to go -- mirrors React Navigation's own `navigation.canGoBack()`. */
  canGoBack: boolean;
}

export interface NotFoundScreenProps {
  navigation: NotFoundScreenNavigation;
}

export function NotFoundScreen({navigation}: NotFoundScreenProps): JSX.Element {
  // RN 0.72's `Pressable` render-prop state is typed `{pressed: boolean}`
  // only (no `focused`) -- design doc §4.4's own policy is that anything
  // other than a bare `<Button>`/`<TouchableOpacity>` renders its own focus
  // ring via `onFocus`/`onBlur`, which is exactly what this local boolean
  // does, rather than reaching for a `focused` render-prop field this RN
  // version's own `.d.ts` doesn't define.
  const [focused, setFocused] = useState(false);

  return (
    <View style={layout.appScreen}>
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', gap: sh(16)}}>
        <Text style={[text.caption, {color: colour.stageKicker, textTransform: 'uppercase', letterSpacing: sw(2)}]}>
          Lost in the library
        </Text>
        <Text style={[text.display, {color: colour.ink}]}>Page not found</Text>
        <Text style={[text.body, {color: colour.inkSoft, textAlign: 'center', maxWidth: sw(720)}]}>
          The address may be incorrect, or the page may have moved somewhere else.
        </Text>
        <Pressable
          accessibilityRole="button"
          hasTVPreferredFocus
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPress={() => (navigation.canGoBack ? navigation.goBack() : navigation.navigateHome())}
          style={{
            marginTop: sh(24),
            paddingVertical: sh(12),
            paddingHorizontal: sw(28),
            borderRadius: 8,
            backgroundColor: focused ? colour.accent : colour.surfaceStrong,
          }}
        >
          <Text style={[text.bodyEmphasis, {color: focused ? colour.onAccent : colour.ink}]}>
            {navigation.canGoBack ? 'Go back' : 'Back to Home'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
