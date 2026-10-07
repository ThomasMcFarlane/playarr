/**
 * The top-level stack: Link -> Profiles -> AppShell (design doc §4.2's
 * diagram, and §2's directory-layout comment for this file verbatim). Not
 * yet wired into `src/App.tsx` -- that file's own doc comment explains why
 * its current `<Stack.Navigator>` with one placeholder screen is a
 * deliberately temporary stand-in for exactly this file, and wiring the
 * two together is an integration step this task's own scope does not
 * include (this task's constraints permit creating only the files it was
 * asked for, and `App.tsx` is not one of them). Once that wiring happens,
 * `App.tsx`'s `<NavigationContainer>` should render `<RootNavigator />`
 * directly in place of its own temporary `<Stack.Navigator>` block.
 *
 * `LinkScreen`/`ProfilesScreen` are the real, already-landed screens from
 * `screens/LinkScreen.tsx`/`screens/ProfilesScreen.tsx` (both zero-prop --
 * each calls `useNavigation()` itself internally, per their own doc
 * comments on why), registered directly rather than through any adapter.
 *
 * ## What "gates" the initial screen, honestly
 *
 * tv-web's own equivalent decision (`App.tsx`'s `shouldStartPackagedTvLink`)
 * reads `currentUserId`/`savedProfiles.length` off `useAuth()` to decide
 * whether a packaged TV app should start on `/login` or reveal already-
 * authenticated content. `ApiClientProvider.tsx`'s own doc comment states
 * plainly that it does not yet expose an equivalent "is there already a
 * usable session" signal (that provider is deliberately narrower for this
 * build-order pass than tv-web's 1381-line original). Rather than
 * inventing that contract here to make a more elaborate gating decision
 * look complete, this file is honest about what it can decide today:
 * `initialRouteName={ROUTES.link}` is the conservative default (an app
 * that has not verified a session exists should not silently reveal
 * authenticated content), and `AppShellNavigator` separately reacts to
 * `authFailed` (a real, already-wired signal) to fall back to
 * `ROUTES.profiles` once a session that WAS trusted turns out not to be
 * any more. Swapping `initialRouteName` for a real "do we already have a
 * stored session" check is a one-line change once `ApiClientProvider`
 * exposes one; nothing about this stack's shape needs to change for it.
 *
 * ## An integration gap observed, not fixed (outside this file's scope)
 *
 * `ProfilesScreen.tsx` (line ~282) calls `navigation.navigate(ROUTES.home)`
 * directly after a successful profile selection. `ROUTES.home` is a screen
 * inside `AppShellNavigator`'s own NESTED `ContentStack`, not a screen of
 * `RootNavigator`'s stack that `ProfilesScreen` itself is registered in --
 * React Navigation's `navigate()` bubbles a lookup UP to parent navigators
 * when a name isn't found locally, it does not drill DOWN into an
 * unrelated sibling's own nested navigator. The correct call is the
 * two-level form this file's sibling `AppShellNavigator.tsx` uses for
 * exactly this reason: `navigation.navigate(APP_SHELL_ROUTE, {screen:
 * ROUTES.home})`. `ProfilesScreen.tsx` could not have known
 * `APP_SHELL_ROUTE` at the time it was written -- that constant is defined
 * in `AppShellNavigator.tsx`, part of this same task's own scope, written
 * concurrently. Left as an explicit note rather than an edit: fixing it
 * means editing `screens/ProfilesScreen.tsx`, a file outside this task's
 * assigned scope. `navigation.navigate(ROUTES.link)` (used both after a
 * PIN failure and by `AddProfileTile`) is unaffected -- `ROUTES.link` IS a
 * `RootNavigator`-level sibling, so that bare call already resolves
 * correctly.
 */
import React from 'react';
import {createStackNavigator} from '@amazon-devices/react-navigation__stack';
import {TokenStore} from '@playarr-tv/device-auth';
import {AppShellNavigator, APP_SHELL_ROUTE} from './AppShellNavigator';
import {LinkScreen} from '../screens/LinkScreen';
import {ProfilesScreen} from '../screens/ProfilesScreen';
import {ROUTES} from './routes';

const Stack = createStackNavigator();

/**
 * A device that already holds a session opens on the profile picker (which verifies the session and falls back to
 * re-pairing through `authFailed`); only a device with no stored session pairs. Starting on Link regardless made every
 * launch show a fresh QR code even though the device was signed in.
 */
export function initialRouteName(): typeof ROUTES.link | typeof ROUTES.profiles {
  return new TokenStore().get() ? ROUTES.profiles : ROUTES.link;
}

export function RootNavigator(): React.ReactElement {
  const [initialRoute] = React.useState(initialRouteName);
  return (
    <Stack.Navigator initialRouteName={initialRoute} screenOptions={{headerShown: false}}>
      <Stack.Screen name={ROUTES.link} component={LinkScreen} />
      <Stack.Screen name={ROUTES.profiles} component={ProfilesScreen} />
      <Stack.Screen name={APP_SHELL_ROUTE} component={AppShellNavigator} />
    </Stack.Navigator>
  );
}
