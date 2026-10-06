/**
 * `/settings/language` (design doc §7: "en / th / ja"). Ported against
 * tv-web's `settings/Language.tsx` and, for the actual language vocabulary,
 * `web/src/lib/i18n/languages.ts` (`SUPPORTED_LANGUAGES`/`LANGUAGE_NAMES`)
 * -- the three supported languages and their native-script display names
 * below are copied from that file's real values, not re-guessed.
 *
 * Same honest limitation as `AppearanceScreen.tsx`, for the same underlying
 * reason, stated once there and not repeated at length here: design doc
 * §2's own directory listing puts `i18n/LanguageProvider.tsx` -- "RN port;
 * re-uses tv-web's translations/{en,th,ja}.ts as data" -- in a later,
 * Features-phase pass, not this one. Until that provider exists, no screen
 * in this app actually renders translated copy (every screen built so far,
 * including this one, is hard-coded English -- see `App.tsx`'s own
 * placeholder screen for the same state of affairs one level up). This
 * screen still does something completely real: it persists a language
 * preference so the choice is there, waiting, the moment that provider
 * lands.
 *
 * The storage key deliberately does NOT follow this app's own `playarr.
 * tv.*` naming convention (contrast `AppearanceScreen.tsx`'s
 * `THEME_PREFERENCE_STORAGE_KEY`) -- it reuses tv-web's own literal
 * `LANGUAGE_STORAGE_KEY` value (`web/src/lib/i18n/LanguageProvider.tsx`)
 * on purpose. Design doc §2 says the eventual `i18n/LanguageProvider.tsx`
 * here "re-uses tv-web's translations/{en,th,ja}.ts as DATA" -- the most
 * likely shape for a straightforward RN port of that exact file is one that
 * also re-uses its storage-key convention rather than inventing a second,
 * fire-tv-specific one with no reason to differ. If that guess is wrong,
 * changing one string constant costs nothing; if it's right, this screen's
 * preference is picked up automatically without that later step needing to
 * migrate anything.
 *
 * `navigation` is an explicit prop and autofocus uses `hasTVPreferredFocus`
 * rather than `platform/focus.tsx`'s `TvFocusScope` -- see
 * `SettingsIndexScreen.tsx`'s top comment for the full rationale.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colour} from '../../theme/tokens';
import {focusRing, layout, text} from '../../theme/styles';

export interface LanguageScreenNavigation {
  goBack: () => void;
}

export interface LanguageScreenProps {
  navigation: LanguageScreenNavigation;
}

/** Mirrors tv-web's `ResolvedLanguage`. */
export type ResolvedLanguage = 'en' | 'th' | 'ja';
/** Mirrors tv-web's `LanguagePreference`. */
export type LanguagePreference = 'system' | ResolvedLanguage;

/** Mirrors tv-web's `LANGUAGE_NAMES` -- each language's own name, in its own script, not translated. */
export const LANGUAGE_NAMES: Record<ResolvedLanguage, string> = {
  en: 'English',
  th: 'ไทย',
  ja: '日本語',
};

/** Matches `web/src/lib/i18n/LanguageProvider.tsx`'s literal storage key -- see this file's top comment for why. */
export const LANGUAGE_STORAGE_KEY = 'playarr-language';

const LANGUAGE_OPTIONS: readonly {value: LanguagePreference; label: string}[] = [
  {value: 'system', label: 'Auto'},
  {value: 'en', label: LANGUAGE_NAMES.en},
  {value: 'th', label: LANGUAGE_NAMES.th},
  {value: 'ja', label: LANGUAGE_NAMES.ja},
];

/** Guards a raw stored string down to a real `LanguagePreference`, the same "unrecognised defaults to auto" contract `parseThemePreference` uses one file over. */
export function parseLanguagePreference(raw: string | null): LanguagePreference {
  return raw === 'en' || raw === 'th' || raw === 'ja' ? raw : 'system';
}

/** See `AppearanceScreen.tsx`'s own `hasLocalStorage` for exactly why this guard is load-bearing, not defensive theatre: `localStorage` genuinely does not exist on `globalThis` until `hydrateLocalStorage()` resolves. */
function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function readStoredLanguagePreference(): LanguagePreference {
  return parseLanguagePreference(hasLocalStorage() ? localStorage.getItem(LANGUAGE_STORAGE_KEY) : null);
}

interface LanguageOptionButtonProps {
  label: string;
  selected: boolean;
  autoFocus: boolean;
  onPress: () => void;
}

function LanguageOptionButton({label, selected, autoFocus, onPress}: LanguageOptionButtonProps): React.ReactElement {
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

export function LanguageScreen({navigation}: LanguageScreenProps): React.ReactElement {
  const [preference, setPreference] = React.useState<LanguagePreference>(readStoredLanguagePreference);

  function selectPreference(next: LanguagePreference): void {
    if (next === preference) return;
    setPreference(next);
    if (!hasLocalStorage()) return;
    if (next === 'system') {
      localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } else {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    }
  }

  return (
    <View style={layout.appScreen}>
      <BackButton onPress={navigation.goBack} />

      <View style={styles.header}>
        <Text style={[text.caption, styles.kicker]}>Make it yours</Text>
        <Text style={text.title}>Language</Text>
        <Text style={[text.body, styles.description]}>Follow this device or keep a language fixed.</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.optionRow}>
          {LANGUAGE_OPTIONS.map((option, index) => (
            <LanguageOptionButton
              key={option.value}
              label={option.label}
              selected={preference === option.value}
              autoFocus={index === 0}
              onPress={() => selectPreference(option.value)}
            />
          ))}
        </View>
        <Text style={[text.caption, styles.hint]}>
          Playarr currently renders every screen in English regardless of this choice -- see this
          file's own doc comment for why, and what picks this preference up once that changes.
        </Text>
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
    flexWrap: 'wrap',
  },
  optionButton: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
    marginRight: 12,
    marginBottom: 12,
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
    marginTop: 8,
  },
});
