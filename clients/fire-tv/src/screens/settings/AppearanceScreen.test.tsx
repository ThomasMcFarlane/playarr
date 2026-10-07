/**
 * `AppearanceScreen` has no `ApiClientProvider`/platform dependency, but it
 * DOES touch `localStorage` directly -- so unlike `SettingsIndexScreen.test.
 * tsx`, every test here must hydrate the real storage shim first (`platform/
 * storage/localStorageShim.ts`'s `hydrateLocalStorage`, against a trivial
 * in-memory `AsyncStorageLike` fake) rather than relying on `jest.setup.ts`
 * alone, which only mocks the native AsyncStorage module -- it does not call
 * `hydrateLocalStorage()` itself (see `api/client.test.ts`'s own comment on
 * this exact point). `resetLocalStorageShimForTests()` between tests keeps
 * one test's stored preference from leaking into the next.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import {hydrateLocalStorage, resetLocalStorageShimForTests} from '../../platform/storage/localStorageShim';
import {
  AppearanceScreen,
  parseThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
  type AppearanceScreenNavigation,
} from './AppearanceScreen';

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

function fakeNavigation(): AppearanceScreenNavigation & {goBack: jest.Mock} {
  return {goBack: jest.fn()};
}

function allText(renderer: ReactTestRenderer): string {
  return renderer
    .root.findAllByType(Text)
    .map((node) => node.props.children)
    .flat()
    .filter((value) => typeof value === 'string')
    .join(' | ');
}

describe('parseThemePreference', () => {
  it('accepts light and dark', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
  });

  it('defaults anything else (absent, corrupt, unrecognised) to system', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('')).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
  });
});

describe('AppearanceScreen', () => {
  beforeEach(async () => {
    resetLocalStorageShimForTests();
    await hydrateLocalStorage(fakeAsyncStorage());
  });

  it('defaults to System selected when nothing is stored yet', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<AppearanceScreen navigation={fakeNavigation()} />);
    });

    const systemButton = renderer.root.findByProps({accessibilityLabel: 'System'});
    expect(systemButton.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({backgroundColor: expect.any(String)})])
    );
    expect(allText(renderer)).toContain('Appearance');
  });

  it('persists a selection to localStorage under THEME_PREFERENCE_STORAGE_KEY', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<AppearanceScreen navigation={fakeNavigation()} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Dark'}).props.onPress();
    });

    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('dark');
  });

  it('removes the stored key when System is re-selected', () => {
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'light');

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<AppearanceScreen navigation={fakeNavigation()} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'System'}).props.onPress();
    });

    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBeNull();
  });

  it('picks up a previously-stored preference on mount', () => {
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'dark');

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<AppearanceScreen navigation={fakeNavigation()} />);
    });

    // The selected button gets the "selected" background colour, distinct
    // from the two unselected ones -- read back via the rendered style array
    // rather than re-deriving the theme's own colour constants here.
    const darkStyle = renderer.root.findByProps({accessibilityLabel: 'Dark'}).props.style;
    const systemStyle = renderer.root.findByProps({accessibilityLabel: 'System'}).props.style;
    expect(darkStyle).not.toEqual(systemStyle);
  });

  it('calls navigation.goBack when the back button is pressed', () => {
    const navigation = fakeNavigation();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<AppearanceScreen navigation={navigation} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Back to Settings'}).props.onPress();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('gives the first theme option hasTVPreferredFocus', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<AppearanceScreen navigation={fakeNavigation()} />);
    });

    const systemButton = renderer.root.findByProps({accessibilityLabel: 'System'});
    expect(systemButton.type).toBe(Pressable);
    expect(systemButton.props.hasTVPreferredFocus).toBe(true);
  });
});
