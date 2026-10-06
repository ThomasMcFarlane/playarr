/**
 * `/settings/player` (design doc §7: "Quality, audio/subtitle defaults").
 * Ported against tv-web's `settings/Player.tsx`, which is actually two
 * independent preference stores glued into one page -- kept apart here too,
 * because they behave differently and this screen's tests need to exercise
 * them differently:
 *
 *  1. Preferred audio language is server-backed
 *     (`ApiClient.getPlayerPreferences`/`updatePlayerPreferences`,
 *     `PlayerPreferencesResponse.preferred_audio_language` -- confirmed
 *     directly against the generated OpenAPI schema, not assumed). It
 *     follows the signed-in user across every device, so it round-trips
 *     the real `useApiClient()` this app already has wired.
 *  2. Default playback quality and default subtitle behaviour are NOT
 *     server-backed -- tv-web's own `lib/playerDefaults.ts` persists them
 *     to `localStorage` only, and its own doc comment (and this file's
 *     copy of `deviceNote` below, taken verbatim from tv-web's real
 *     `settings.playerPreferences.deviceNote` string) is explicit that
 *     this is deliberate: "saved on this device", separately from the
 *     account-wide audio-language preference. This screen persists the
 *     same shape under the same storage key
 *     (`PLAYER_DEFAULTS_STORAGE_KEY`, matching `playarr.player-defaults.v1`
 *     byte for byte) rather than reimplementing a different one, but does
 *     NOT import `clients/tv-web/web/src/lib/playerDefaults.ts` itself --
 *     that file is web-app-local (not one of the five `@playarr-tv/*`
 *     packages `metro.config.js`/`tsconfig.json` alias into this project),
 *     and adding a sixth alias is a `metro.config.js`/`tsconfig.json` edit
 *     this task's own constraints rule out. See the type/quality-tier
 *     deviation note below for the one place this necessarily diverges
 *     from that file's shape rather than just its import path.
 *
 * DEVIATION, stated explicitly: tv-web's quality default is chosen from a
 * 4-tier x 3-bitrate matrix (`lib/qualityMatrix.ts`'s `QUALITY_TIERS`, 12
 * concrete options plus "Original", rendered by a dedicated
 * `<QualityMatrix>` component) -- also web-app-local, also not aliased
 * here, and considerably more UI than a "keep it simple" settings screen
 * (this task's own brief) warrants reimplementing from scratch. This
 * screen instead offers four named tiers -- Original, High, Medium, Low --
 * which is a real, working, persisted preference in the same
 * `PlayerQualityDefault` sense tv-web's is, just a coarser vocabulary. The
 * eventual `mode`/`quality_id` this preference feeds into is
 * `PlayerScreen.tsx`'s own concern (a later, not-yet-built step) and can
 * map "High"/"Medium"/"Low" onto whatever concrete quality IDs the server
 * actually offers for a given work at play time -- this screen does not
 * need to know that mapping to store a meaningful default.
 *
 * `navigation` is an explicit prop rather than a `useNavigation()` call, and
 * there is no `platform/focus.tsx` `TvFocusScope` wrapper -- both match the
 * convention `LibraryScreen.tsx`/`SearchScreen.tsx`/`NotFoundScreen.tsx`
 * (concurrent sibling screens) already settled on. See
 * `SettingsIndexScreen.tsx`'s top comment for the full rationale, including
 * the real, reproducible `TvFocusScope` rendering bug that convention
 * avoids.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {ApiError} from '@playarr-tv/api-client';
import {useApiClient} from '../../api/ApiClientProvider';
import {colour} from '../../theme/tokens';
import {focusRing, layout, text} from '../../theme/styles';

export interface PlayerSettingsScreenNavigation {
  goBack: () => void;
}

export interface PlayerSettingsScreenProps {
  navigation: PlayerSettingsScreenNavigation;
}

// --- Local (`localStorage`-only) playback defaults -------------------------

export type PlayerQualityDefault = 'original' | 'high' | 'medium' | 'low';
export type PlayerSubtitleDefault = 'off' | 'forced' | 'always';

export interface PlayerDefaults {
  qualityId: PlayerQualityDefault;
  subtitleMode: PlayerSubtitleDefault;
  subtitleLanguage: string;
}

/** Matches tv-web's `web/src/lib/playerDefaults.ts` `PLAYER_DEFAULTS_STORAGE_KEY` value exactly -- see this file's top comment for why. */
export const PLAYER_DEFAULTS_STORAGE_KEY = 'playarr.player-defaults.v1';

export const DEFAULT_PLAYER_DEFAULTS: PlayerDefaults = {
  qualityId: 'original',
  subtitleMode: 'off',
  subtitleLanguage: 'en',
};

const QUALITY_OPTIONS: readonly {value: PlayerQualityDefault; label: string}[] = [
  {value: 'original', label: 'Original'},
  {value: 'high', label: 'High'},
  {value: 'medium', label: 'Medium'},
  {value: 'low', label: 'Low'},
];

const SUBTITLE_MODE_OPTIONS: readonly {value: PlayerSubtitleDefault; label: string}[] = [
  {value: 'off', label: 'Off'},
  {value: 'forced', label: 'Forced only'},
  {value: 'always', label: 'Always on'},
];

/**
 * A deliberately short list next to tv-web's 12-language `Player.tsx`
 * table -- this task's brief again: keep these screens simple. Every value
 * here is a real ISO 639-1 code the server's `preferred_audio_language`
 * and a subtitle track's own `language` field can plausibly carry; this is
 * a narrower, not a different, vocabulary.
 */
const LANGUAGE_OPTIONS: readonly {value: string; label: string}[] = [
  {value: 'en', label: 'English'},
  {value: 'es', label: 'Spanish'},
  {value: 'fr', label: 'French'},
  {value: 'de', label: 'German'},
  {value: 'ja', label: 'Japanese'},
  {value: 'th', label: 'Thai'},
];

function isQualityDefault(value: unknown): value is PlayerQualityDefault {
  return value === 'original' || value === 'high' || value === 'medium' || value === 'low';
}

function isSubtitleDefault(value: unknown): value is PlayerSubtitleDefault {
  return value === 'off' || value === 'forced' || value === 'always';
}

/**
 * Pure and exported on its own, mirroring tv-web's `readPlayerDefaults`
 * contract exactly (never throws; a missing, corrupt, or foreign value
 * under this key just reads back as `DEFAULT_PLAYER_DEFAULTS`) but taking
 * the raw stored string directly rather than a `Storage` instance, so it is
 * testable with a plain string fixture and no storage mock at all.
 */
export function parsePlayerDefaults(raw: string | null): PlayerDefaults {
  if (!raw) return DEFAULT_PLAYER_DEFAULTS;
  try {
    // `?? {}` rather than leaving `parsed` as `Partial<PlayerDefaults> |
    // null`: `JSON.parse` legitimately returns `null` for the literal
    // string `"null"`, and folding that into an empty object here means
    // every field access below can stay a plain, ungated `parsed.field`
    // read (each already falls back to `DEFAULT_PLAYER_DEFAULTS` when the
    // guard rejects it) instead of every one of them separately re-proving
    // `parsed` isn't null to the type checker.
    const parsed = (JSON.parse(raw) as Partial<PlayerDefaults> | null) ?? {};
    return {
      qualityId: isQualityDefault(parsed.qualityId) ? parsed.qualityId : DEFAULT_PLAYER_DEFAULTS.qualityId,
      subtitleMode: isSubtitleDefault(parsed.subtitleMode)
        ? parsed.subtitleMode
        : DEFAULT_PLAYER_DEFAULTS.subtitleMode,
      subtitleLanguage:
        typeof parsed.subtitleLanguage === 'string' && parsed.subtitleLanguage.trim()
          ? parsed.subtitleLanguage.trim().toLowerCase()
          : DEFAULT_PLAYER_DEFAULTS.subtitleLanguage,
    };
  } catch {
    return DEFAULT_PLAYER_DEFAULTS;
  }
}

/** See `AppearanceScreen.tsx`'s own `hasLocalStorage` for exactly why this guard is load-bearing, not defensive theatre: `localStorage` genuinely does not exist on `globalThis` until `hydrateLocalStorage()` resolves. */
function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function readStoredPlayerDefaults(): PlayerDefaults {
  return parsePlayerDefaults(hasLocalStorage() ? localStorage.getItem(PLAYER_DEFAULTS_STORAGE_KEY) : null);
}

function writeStoredPlayerDefaults(defaults: PlayerDefaults): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(PLAYER_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
}

function isSupportedAudioLanguage(value: string): boolean {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

// --- Server-backed preferred audio language ---------------------------------

type AudioLanguageState =
  | {status: 'loading'}
  | {status: 'ready'}
  | {status: 'saving'}
  | {status: 'error'; message: string};

interface ChoiceButtonProps {
  label: string;
  selected: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onPress: () => void;
}

function ChoiceButton({label, selected, disabled, autoFocus, onPress}: ChoiceButtonProps): React.ReactElement {
  const [focused, setFocused] = React.useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={autoFocus}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.choiceButton,
        selected ? styles.choiceButtonSelected : null,
        focused ? focusRing.ring : null,
        disabled ? styles.choiceButtonDisabled : null,
      ]}
    >
      <Text style={[text.body, selected ? styles.choiceLabelSelected : styles.choiceLabel]}>{label}</Text>
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

export function PlayerSettingsScreen({navigation}: PlayerSettingsScreenProps): React.ReactElement {
  const client = useApiClient();

  const [defaults, setDefaults] = useState<PlayerDefaults>(readStoredPlayerDefaults);
  const [audioLanguage, setAudioLanguage] = useState('en');
  const [audioLanguageState, setAudioLanguageState] = useState<AudioLanguageState>({status: 'loading'});
  const requestIdRef = useRef(0);

  // Synchronising with the server on mount -- exactly the kind of external-
  // system fetch this repo's own React rule (CLAUDE.md) reserves useEffect
  // for; the value cannot be derived from anything already in this
  // component, it must be asked for.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setAudioLanguageState({status: 'loading'});

    client
      .getPlayerPreferences()
      .then((preferences) => {
        if (requestIdRef.current !== requestId) return;
        const language = preferences.preferred_audio_language;
        setAudioLanguage(isSupportedAudioLanguage(language) ? language : 'en');
        setAudioLanguageState({status: 'ready'});
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setAudioLanguageState({
          status: 'error',
          message: error instanceof ApiError ? error.message : String(error),
        });
      });
  }, [client]);

  function updateDefaults(update: Partial<PlayerDefaults>): void {
    const next = {...defaults, ...update};
    writeStoredPlayerDefaults(next);
    setDefaults(next);
  }

  async function selectAudioLanguage(nextLanguage: string): Promise<void> {
    if (
      nextLanguage === audioLanguage ||
      audioLanguageState.status === 'loading' ||
      audioLanguageState.status === 'saving'
    ) {
      return;
    }

    const previousLanguage = audioLanguage;
    const requestId = ++requestIdRef.current;
    setAudioLanguage(nextLanguage);
    setAudioLanguageState({status: 'saving'});

    try {
      const preferences = await client.updatePlayerPreferences({preferred_audio_language: nextLanguage});
      if (requestIdRef.current !== requestId) return;
      const saved = preferences.preferred_audio_language;
      setAudioLanguage(isSupportedAudioLanguage(saved) ? saved : nextLanguage);
      setAudioLanguageState({status: 'ready'});
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setAudioLanguage(previousLanguage);
      setAudioLanguageState({
        status: 'error',
        message: error instanceof ApiError ? error.message : String(error),
      });
    }
  }

  return (
    <View style={layout.appScreen}>
      <BackButton onPress={navigation.goBack} />

      <View style={styles.header}>
        <Text style={[text.caption, styles.kicker]}>Make it yours</Text>
        <Text style={text.title}>Player</Text>
        <Text style={[text.body, styles.description]}>
          Choose how Playarr should start quality, subtitles and audio.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.group}>
          <Text style={text.bodyEmphasis}>Default quality</Text>
          <Text style={[text.caption, styles.groupHint]}>
            Start playback at this quality when the server can provide it.
          </Text>
          <View style={styles.optionRow}>
            {QUALITY_OPTIONS.map((option, index) => (
              <ChoiceButton
                key={option.value}
                label={option.label}
                selected={defaults.qualityId === option.value}
                autoFocus={index === 0}
                onPress={() => updateDefaults({qualityId: option.value})}
              />
            ))}
          </View>
        </View>

        <View style={styles.group}>
          <Text style={text.bodyEmphasis}>Default subtitles</Text>
          <Text style={[text.caption, styles.groupHint]}>
            Keep subtitles off, show forced dialogue only, or turn them on automatically.
          </Text>
          <View style={styles.optionRow}>
            {SUBTITLE_MODE_OPTIONS.map((option) => (
              <ChoiceButton
                key={option.value}
                label={option.label}
                selected={defaults.subtitleMode === option.value}
                onPress={() => updateDefaults({subtitleMode: option.value})}
              />
            ))}
          </View>

          {defaults.subtitleMode !== 'off' ? (
            <View style={styles.optionRow}>
              {LANGUAGE_OPTIONS.map((option) => (
                <ChoiceButton
                  key={option.value}
                  label={option.label}
                  selected={defaults.subtitleLanguage === option.value}
                  onPress={() => updateDefaults({subtitleLanguage: option.value})}
                />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.group}>
          <Text style={text.bodyEmphasis}>Default audio track</Text>
          <Text style={[text.caption, styles.groupHint]}>
            Prefer this audio language whenever a matching track is available.
          </Text>
          <View style={styles.optionRow}>
            {LANGUAGE_OPTIONS.map((option) => (
              <ChoiceButton
                key={option.value}
                label={option.label}
                selected={audioLanguage === option.value}
                disabled={audioLanguageState.status === 'loading' || audioLanguageState.status === 'saving'}
                onPress={() => void selectAudioLanguage(option.value)}
              />
            ))}
          </View>
          <Text style={[text.caption, audioLanguageState.status === 'error' ? styles.errorText : styles.groupHint]}>
            {audioLanguageState.status === 'loading'
              ? 'Loading your player preference…'
              : audioLanguageState.status === 'saving'
                ? 'Saving…'
                : audioLanguageState.status === 'error'
                  ? `Could not update the player preference (${audioLanguageState.message}).`
                  : 'This audio language follows your profile across every device.'}
          </Text>
        </View>

        <Text style={[text.caption, styles.deviceNote]}>
          Quality and subtitle defaults are saved on this device. Audio language follows your profile.
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
    maxWidth: 900,
  },
  group: {
    marginBottom: 24,
  },
  groupHint: {
    color: colour.inkSoft,
    marginTop: 4,
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  choiceButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
    marginRight: 10,
    marginBottom: 10,
  },
  choiceButtonSelected: {
    backgroundColor: colour.accent,
  },
  choiceButtonDisabled: {
    opacity: 0.5,
  },
  choiceLabel: {
    color: colour.ink,
  },
  choiceLabelSelected: {
    color: colour.onAccent,
  },
  errorText: {
    color: colour.danger,
    marginTop: 4,
  },
  deviceNote: {
    color: colour.inkMuted,
    marginTop: 4,
  },
});
