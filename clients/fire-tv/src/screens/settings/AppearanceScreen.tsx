/**
 * `/settings/appearance` (design doc §7: "Theme toggle"). Ported against
 * tv-web's `settings/Appearance.tsx`, but narrower than that page in one
 * deliberate, explicitly-stated way -- read this comment before assuming
 * the theme choice below actually repaints anything, because on THIS client
 * it does not yet.
 *
 * tv-web's `ThemeProvider` (`web/src/lib/theme.tsx`) has something real to
 * switch between: a light and a dark set of CSS custom properties, toggled
 * by writing `document.documentElement.dataset.theme`. This app has no
 * equivalent to switch. `theme/tokens.ts`'s `colour` export is one fixed
 * palette harvested from tv-web's *dark* theme only (that file's own doc
 * comment is explicit about this), there is no light palette anywhere in
 * `clients/fire-tv/src/theme/`, and `App.tsx`'s own doc comment already
 * flags why: design doc §2's file tree has no `ThemeProvider` file at all,
 * for this client or in this pass's scope. Inventing one here would mean
 * this settings screen quietly growing a piece of app-shell architecture
 * (a context every screen would need wrapping in) that is not this task's
 * to add -- this task's scope is the settings screens themselves.
 *
 * So this screen does the one genuinely real thing available to it: it
 * persists a theme preference (`system` | `light` | `dark`, matching
 * tv-web's own `ThemePreference` vocabulary exactly) via the same hydrated
 * `localStorage` shim every other persisted Playarr preference already
 * goes through, so the choice survives an app restart. Reading it back is
 * an honest one-line `useState` initialiser, not a stub -- it is a complete
 * implementation of "remember what the user picked". What it deliberately
 * does NOT do is repaint anything today: there is nothing downstream yet
 * that reads this key. The day a real `ThemeProvider` lands (a light
 * palette in `theme/tokens.ts` plus a context wrapping `App.tsx`), it need
 * only read `THEME_PREFERENCE_STORAGE_KEY` to pick up every choice already
 * made on-device -- this screen does not need to change at all.
 *
 * tv-web's Appearance page also has a second, unrelated control -- home
 * screen artwork style (`thumbnail` | `cover`, `lib/homeView.ts`). That
 * preference only means something once `HomeScreen.tsx` exists to render
 * either style (a later, Features-phase screen, not built yet), so it is
 * left out of this screen entirely rather than persisting a preference
 * nothing reads yet with no real consumer even planned within this task's
 * own scope.
 *
 * `navigation` is an explicit prop and autofocus uses `hasTVPreferredFocus`
 * rather than `platform/focus.tsx`'s `TvFocusScope` -- see
 * `SettingsIndexScreen.tsx`'s top comment for the full rationale (a real,
 * reproducible `TvFocusScope` rendering bug this task's own constraints do
 * not permit fixing, and the convention concurrent sibling screens already
 * settled on instead).
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colour} from '../../theme/tokens';
import {focusRing, layout, text} from '../../theme/styles';

export interface AppearanceScreenNavigation {
  goBack: () => void;
}

export interface AppearanceScreenProps {
  navigation: AppearanceScreenNavigation;
}

import {
  THEME_PREFERENCE_STORAGE_KEY,
  parseThemePreference,
  useTheme,
  type ThemePreference,
} from '../../theme/ThemeProvider';

export {THEME_PREFERENCE_STORAGE_KEY, parseThemePreference};
export type {ThemePreference};

const THEME_OPTIONS: readonly {value: ThemePreference; label: string}[] = [
  {value: 'system', label: 'System'},
  {value: 'light', label: 'Light'},
  {value: 'dark', label: 'Dark'},
];

interface ThemeOptionButtonProps {
  label: string;
  selected: boolean;
  autoFocus: boolean;
  onPress: () => void;
}

function ThemeOptionButton({label, selected, autoFocus, onPress}: ThemeOptionButtonProps): React.ReactElement {
  const [focused, setFocused] = React.useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.optionButton,
        selected ? styles.optionButtonSelected : null,
        focused ? focusRing.ring : null,
      ]}
    >
      <Text style={[text.bodyEmphasis, selected ? styles.optionLabelSelected : styles.optionLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

function BackButton({onPress}: {onPress: () => void}): React.ReactElement {
  const [focused, setFocused] = React.useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to Settings"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.backButton, focused ? focusRing.ring : null]}
    >
      <Text style={[text.body, styles.backLabel]}>{'‹ Settings'}</Text>
    </Pressable>
  );
}

export function AppearanceScreen({navigation}: AppearanceScreenProps): React.ReactElement {
  const {preference, setPreference} = useTheme();

  function selectPreference(next: ThemePreference): void {
    if (next !== preference) setPreference(next);
  }

  return (
    <View style={layout.appScreen}>
      <BackButton onPress={navigation.goBack} />

      <View style={styles.header}>
        <Text style={[text.caption, styles.kicker]}>Make it yours</Text>
        <Text style={text.title}>Appearance</Text>
        <Text style={[text.body, styles.description]}>Choose this device's theme.</Text>
      </View>

      <View style={styles.card}>
        <Text style={text.bodyEmphasis}>Colour theme</Text>
        <View style={styles.optionRow}>
          {THEME_OPTIONS.map((option, index) => (
            <ThemeOptionButton
              key={option.value}
              label={option.label}
              selected={preference === option.value}
              autoFocus={index === 0}
              onPress={() => selectPreference(option.value)}
            />
          ))}
        </View>
        <Text style={[text.caption, styles.hint]}>System follows the platform appearance and is dark when it reports none.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
    marginBottom: 20,
  },
  backLabel: {
    color: colour.inkSoft,
  },
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
  card: {
    backgroundColor: colour.surface,
    borderRadius: 12,
    padding: 24,
    maxWidth: 720,
  },
  optionRow: {
    flexDirection: 'row',
    marginTop: 16,
  },
  optionButton: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
    marginRight: 12,
  },
  optionButtonSelected: {
    backgroundColor: colour.accent,
  },
  optionLabel: {
    color: colour.ink,
  },
  optionLabelSelected: {
    color: colour.onAccent,
  },
  hint: {
    color: colour.inkMuted,
    marginTop: 20,
  },
});
