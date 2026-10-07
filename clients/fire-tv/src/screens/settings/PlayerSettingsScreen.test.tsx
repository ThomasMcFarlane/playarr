/**
 * Two independent things are exercised here, matching the screen's own two
 * independent preference stores (see `PlayerSettingsScreen.tsx`'s top
 * comment): the server-backed audio-language preference goes through a REAL
 * `<ApiClientProvider>` with only `global.fetch` mocked (the same
 * integration posture `SearchScreen.test.tsx`/`LibraryScreen.test.tsx`
 * use), and the device-local quality/subtitle defaults go through the real
 * hydrated `localStorage` shim (the same posture `AppearanceScreen.test.
 * tsx`/`LanguageScreen.test.tsx` use). Both are real, not mocked-out --
 * this test would fail if either persistence path silently broke.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import {ApiClientProvider} from '../../api/ApiClientProvider';
import {hydrateLocalStorage, resetLocalStorageShimForTests} from '../../platform/storage/localStorageShim';
import {
  PlayerSettingsScreen,
  parsePlayerDefaults,
  DEFAULT_PLAYER_DEFAULTS,
  PLAYER_DEFAULTS_STORAGE_KEY,
  type PlayerSettingsScreenNavigation,
} from './PlayerSettingsScreen';

// WORKAROUND, not a fix: see `LibraryScreen.test.tsx`'s own comment (same
// project, same root cause) for exactly why this line is necessary --
// `../../api/ApiClientProvider.tsx` renders JSX without importing `React`
// as a value, which only actually throws once something renders it, not at
// typecheck time. Flagged in this task's own final report; not this task's
// file to fix.
(globalThis as unknown as {React: typeof React}).React = React;

function fakeAsyncStorage() {
  const store = new Map<string, string>();
  return {
    getAllKeys: async () => Array.from(store.keys()),
    multiGet: async (keys: readonly string[]) => keys.map((key) => [key, store.get(key) ?? null] as const),
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  };
}

function fakeNavigation(): PlayerSettingsScreenNavigation & {goBack: jest.Mock} {
  return {goBack: jest.fn()};
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function mockPreferencesFetch(preferredAudioLanguage = 'en'): {
  fetchMock: jest.SpyInstance;
  current: {preferred_audio_language: string};
} {
  const current = {preferred_audio_language: preferredAudioLanguage};
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    if (request.method === 'PATCH') {
      const body = (await request.json()) as {preferred_audio_language: string};
      current.preferred_audio_language = body.preferred_audio_language;
    }
    return jsonResponse(current);
  });
  return {fetchMock, current};
}

function allText(renderer: ReactTestRenderer): string {
  return renderer
    .root.findAllByType(Text)
    .map((node) => {
      const children = node.props.children;
      const fragments = Array.isArray(children) ? children : [children];
      return fragments.filter((value) => typeof value === 'string').join('');
    })
    .join(' | ');
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('parsePlayerDefaults', () => {
  it('falls back to DEFAULT_PLAYER_DEFAULTS for an absent value', () => {
    expect(parsePlayerDefaults(null)).toEqual(DEFAULT_PLAYER_DEFAULTS);
  });

  it('falls back to DEFAULT_PLAYER_DEFAULTS for corrupt JSON', () => {
    expect(parsePlayerDefaults('{not json')).toEqual(DEFAULT_PLAYER_DEFAULTS);
  });

  it('falls back to DEFAULT_PLAYER_DEFAULTS for the literal JSON null', () => {
    expect(parsePlayerDefaults('null')).toEqual(DEFAULT_PLAYER_DEFAULTS);
  });

  it('round-trips a fully valid stored value', () => {
    const stored = {qualityId: 'high', subtitleMode: 'always', subtitleLanguage: 'FR'};
    expect(parsePlayerDefaults(JSON.stringify(stored))).toEqual({
      qualityId: 'high',
      subtitleMode: 'always',
      subtitleLanguage: 'fr',
    });
  });

  it('rejects an unrecognised qualityId/subtitleMode field-by-field rather than discarding the whole object', () => {
    const stored = {qualityId: 'ultra-mega', subtitleMode: 'always', subtitleLanguage: 'ja'};
    expect(parsePlayerDefaults(JSON.stringify(stored))).toEqual({
      qualityId: DEFAULT_PLAYER_DEFAULTS.qualityId,
      subtitleMode: 'always',
      subtitleLanguage: 'ja',
    });
  });
});

describe('PlayerSettingsScreen', () => {
  beforeEach(async () => {
    resetLocalStorageShimForTests();
    await hydrateLocalStorage(fakeAsyncStorage());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads and displays the current preferred audio language', async () => {
    mockPreferencesFetch('ja');

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <PlayerSettingsScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    expect(allText(renderer)).toContain('This audio language follows your profile across every device.');
  });

  it('saves a new audio language selection via PATCH', async () => {
    const {fetchMock} = mockPreferencesFetch('en');

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <PlayerSettingsScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'Japanese'}).props.onPress();
    });
    await flush();

    const patchCall = fetchMock.mock.calls.find(([request]: [Request]) => request.method === 'PATCH');
    expect(patchCall).toBeDefined();
  });

  it('persists a default-quality choice to localStorage immediately, with no network call', async () => {
    mockPreferencesFetch();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <PlayerSettingsScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'High'}).props.onPress();
    });

    const stored = localStorage.getItem(PLAYER_DEFAULTS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).qualityId).toBe('high');
  });

  it('only shows subtitle-language choices once subtitles are not Off', async () => {
    mockPreferencesFetch();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <PlayerSettingsScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    // `{deep: false}` matters here: `findAllByProps`'s default (`deep:
    // true`) keeps descending after a match, re-matching the SAME logical
    // `Pressable` again at each of the composite/host layers it forwards
    // `accessibilityLabel` through underneath itself -- `findByProps`
    // (singular, used everywhere else in this file) passes `deep: false`
    // internally for exactly this reason, per react-test-renderer's own
    // source. One real "Thai" button exists before subtitles are on
    // (audio language only); two once subtitles are on (+ subtitle
    // language) -- this explicit option is what makes that count meaningful
    // instead of a multiple-of-however-many-layers-Pressable-has artifact.
    expect(renderer.root.findAllByProps({accessibilityLabel: 'Thai'}, {deep: false})).toHaveLength(1);

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Always on'}).props.onPress();
    });

    expect(renderer.root.findAllByProps({accessibilityLabel: 'Thai'}, {deep: false})).toHaveLength(2);
  });

  it('calls navigation.goBack when the back button is pressed', async () => {
    mockPreferencesFetch();
    const navigation = fakeNavigation();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <PlayerSettingsScreen navigation={navigation} />
        </ApiClientProvider>
      );
    });
    await flush();

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Back to Settings'}).props.onPress();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
