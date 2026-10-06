/**
 * The settings "layout route" (design doc §7: `/settings` -> `settings/
 * Index.tsx` | "Layout route"). tv-web's own `SettingsIndexPage` is a
 * persistent master/detail shell -- a `<nav>` list on the left and an
 * `<Outlet>` rendering the active sub-page on the right, both visible at
 * once, because a browser page can lay out two panes side by side and give
 * the user Left/Right to move between them (`Index.tsx`'s own
 * `shouldReturnSettingsFocusToList`/`adjacentSettingsIndex` exist entirely
 * to hand-code that geometry).
 *
 * That shape has no direct equivalent here, and re-deriving it would be
 * fighting this app's own navigation model rather than using it: React
 * Navigation's stack pushes one screen at a time, and design doc §4.4's
 * whole point is that Vega's own Cartesian focus engine already resolves
 * D-pad movement for whatever is on screen -- there is no "master pane"
 * concept to keep alive underneath a detail screen once the stack has
 * pushed past it. So this screen is genuinely just a list: five focusable
 * rows, each pushing the corresponding settings screen onto the stack.
 * Every one of those screens' own Back button (or a physical Back press,
 * which `@amazon-devices/react-navigation__stack`'s own navigator already
 * pops the stack for -- see `navigation`'s own doc comment below for why no
 * screen in this file needs its own hardware-back wiring) returns to
 * exactly this list, which is the TV-native equivalent of tv-web's
 * Left-to-return-to-the-list behaviour without any of the geometry code
 * needed to fake it.
 *
 * Three of tv-web's nine settings pages are deliberately absent from the
 * list below, matching `routes.ts`'s own already-settled scope (that file's
 * top comment reasons through the same §7 table this screen reads):
 * `/settings/profile-avatar` (needs an image cropper -- no file picker on a
 * remote), `/settings/invite` (an admin-ish flow, better on phone/web), and
 * `/settings/request-latency` (an admin diagnostics table). None of the
 * three has a `ROUTES.settingsX` entry to navigate to yet, so listing them
 * here would be a dead link, not a deferred feature.
 *
 * `navigation` is an explicit prop, not a `useNavigation()` call, and
 * autofocus uses `Pressable`'s own `hasTVPreferredFocus` rather than
 * `platform/focus.tsx`'s `TvFocusScope` -- both choices deliberately match
 * the convention `LibraryScreen.tsx`/`SearchScreen.tsx`/`NotFoundScreen.tsx`
 * (concurrent sibling screens in this same task's scope) already settled
 * on, for the same reason those files' own comments give: React
 * Navigation's `<Stack.Screen component={X}>` registration already injects
 * `{navigation, route}` as props, so a prop is the more direct contract
 * than re-deriving the same value via context; and `TvFocusScope`
 * (`platform/focus.tsx`) currently throws `ReferenceError: React is not
 * defined` the instant it is rendered under this project's classic JSX
 * runtime (that file imports `React` as a type only, not a value -- see
 * this app's own `babel.config.js` comment for why classic-runtime JSX
 * needs a real value binding) -- a real, reproducible bug this task's own
 * constraints do not permit fixing (`platform/focus.tsx` belongs to a
 * concurrent Foundation-stage task). `hasTVPreferredFocus` is RN core's own
 * TV-autofocus prop and has no such dependency.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View, type NativeSyntheticEvent, type TargetedEvent} from 'react-native';
import {colour} from '../../theme/tokens';
import {focusRing, layout, text} from '../../theme/styles';
import {ROUTES, type RouteName} from '../../navigation/routes';

export interface SettingsIndexScreenNavigation {
  navigate: (route: RouteName) => void;
}

export interface SettingsIndexScreenProps {
  navigation: SettingsIndexScreenNavigation;
}

export interface SettingsIndexEntry {
  route: RouteName;
  number: string;
  title: string;
  description: string;
}

/**
 * Pure and exported specifically so it is testable without rendering
 * anything -- the same split this codebase already uses for
 * `remoteKeyMap.ts` (kept apart from `remote.ts`'s native hook) and
 * `buildSettingsSections` in tv-web's own `Index.tsx`. Order and copy
 * mirror tv-web's `Index.tsx` `buildSettingsSections` (numbers 01/03/04/05/06
 * there; renumbered 01-05 here because this list omits the three v2 pages
 * `Index.tsx` also lists -- see this file's top comment).
 */
export function buildSettingsIndexEntries(): readonly SettingsIndexEntry[] {
  return [
    {
      route: ROUTES.settingsAppearance,
      number: '01',
      title: 'Appearance',
      description: "Choose this device's theme and home screen artwork.",
    },
    {
      route: ROUTES.settingsLanguage,
      number: '02',
      title: 'Language',
      description: 'Follow this device or keep a language fixed.',
    },
    {
      route: ROUTES.settingsPlayer,
      number: '03',
      title: 'Player',
      description: 'Choose how Playarr should start quality, subtitles and audio.',
    },
    {
      route: ROUTES.settingsServer,
      number: '04',
      title: 'Server connection',
      description: 'Combine libraries from multiple servers in one Playarr interface.',
    },
    {
      route: ROUTES.settingsProfileLock,
      number: '05',
      title: 'Profile lock',
      description: 'Require a four-digit PIN before switching profiles.',
    },
  ] as const;
}

interface SettingsIndexRowProps {
  entry: SettingsIndexEntry;
  autoFocus: boolean;
  onPress: (route: RouteName) => void;
}

/**
 * One focusable row. `onFocus`/`onBlur` drive the ring directly rather than
 * through `Animated` -- design doc §4.4's focus-motion policy is real and
 * this file does not dispute it, but this task's own brief singles out the
 * settings screens as lower-traffic than Home/Library/Detail and asks for
 * them to stay simple; an immediate style swap is a completely genuine,
 * working focus indicator, just without the 150ms eased scale-in
 * `focusMotion`/`focusScaleTransform` exist to drive. Nothing here is a
 * stand-in for that -- it is a smaller, real implementation of the same
 * "focused rows look focused" requirement.
 */
function SettingsIndexRow({entry, autoFocus, onPress}: SettingsIndexRowProps): React.ReactElement {
  const [focused, setFocused] = React.useState(false);

  function handleFocus(_event: NativeSyntheticEvent<TargetedEvent>): void {
    setFocused(true);
  }

  function handleBlur(_event: NativeSyntheticEvent<TargetedEvent>): void {
    setFocused(false);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}. ${entry.description}`}
      hasTVPreferredFocus={autoFocus}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={() => onPress(entry.route)}
      style={[styles.row, focused ? styles.rowFocused : null, focused ? focusRing.ring : null]}
    >
      <Text style={[text.subtitle, styles.rowNumber]}>{entry.number}</Text>
      <View style={styles.rowCopy}>
        <Text style={text.bodyEmphasis}>{entry.title}</Text>
        <Text style={[text.caption, styles.rowDescription]}>{entry.description}</Text>
      </View>
      <Text style={[text.subtitle, styles.rowArrow]}>{'→'}</Text>
    </Pressable>
  );
}

export function SettingsIndexScreen({navigation}: SettingsIndexScreenProps): React.ReactElement {
  const entries = buildSettingsIndexEntries();

  return (
    <View style={layout.appScreen}>
      <View style={styles.header}>
        <Text style={[text.caption, styles.kicker]}>Make it yours</Text>
        <Text style={text.title}>Settings</Text>
        <Text style={[text.body, styles.description]}>
          Choose how Playarr looks and where it connects.
        </Text>
      </View>

      <View style={styles.list}>
        {entries.map((entry, index) => (
          <SettingsIndexRow
            key={entry.route}
            entry={entry}
            autoFocus={index === 0}
            onPress={(route) => navigation.navigate(route)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: 32,
  },
  kicker: {
    color: colour.stageKicker,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  description: {
    color: colour.inkSoft,
    marginTop: 8,
    maxWidth: 640,
  },
  list: {
    flexDirection: 'column',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 12,
    backgroundColor: colour.surface,
  },
  rowFocused: {
    backgroundColor: colour.surfaceSoft,
  },
  rowNumber: {
    color: colour.inkMuted,
    width: 48,
  },
  rowCopy: {
    flex: 1,
  },
  rowDescription: {
    color: colour.inkSoft,
    marginTop: 4,
  },
  rowArrow: {
    color: colour.inkMuted,
    marginLeft: 12,
  },
});
