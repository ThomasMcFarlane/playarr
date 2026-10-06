/**
 * Same storage-hydration posture as `AppearanceScreen.test.tsx` -- see that
 * file's own top comment for why `hydrateLocalStorage`/
 * `resetLocalStorageShimForTests` are needed here and not just
 * `jest.setup.ts`'s AsyncStorage double.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import {hydrateLocalStorage, resetLocalStorageShimForTests} from '../../platform/storage/localStorageShim';
import {
  LanguageScreen,
  LANGUAGE_NAMES,
  LANGUAGE_STORAGE_KEY,
  parseLanguagePreference,
  type LanguageScreenNavigation,
} from './LanguageScreen';

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

function fakeNavigation(): LanguageScreenNavigation & {goBack: jest.Mock} {
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

describe('parseLanguagePreference', () => {
  it('accepts en, th and ja', () => {
    expect(parseLanguagePreference('en')).toBe('en');
    expect(parseLanguagePreference('th')).toBe('th');
    expect(parseLanguagePreference('ja')).toBe('ja');
  });

  it('defaults anything else to system (Auto)', () => {
    expect(parseLanguagePreference(null)).toBe('system');
    expect(parseLanguagePreference('fr')).toBe('system');
  });
});

describe('LanguageScreen', () => {
  beforeEach(async () => {
    resetLocalStorageShimForTests();
    await hydrateLocalStorage(fakeAsyncStorage());
  });

  it('renders every supported language in its own script', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<LanguageScreen navigation={fakeNavigation()} />);
    });

    const rendered = allText(renderer);
    expect(rendered).toContain(LANGUAGE_NAMES.en);
    expect(rendered).toContain(LANGUAGE_NAMES.th);
    expect(rendered).toContain(LANGUAGE_NAMES.ja);
  });

  it('persists a language selection under LANGUAGE_STORAGE_KEY', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<LanguageScreen navigation={fakeNavigation()} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: LANGUAGE_NAMES.th}).props.onPress();
    });

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('th');
  });

  it('clears the stored key when Auto is re-selected', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ja');

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<LanguageScreen navigation={fakeNavigation()} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Auto'}).props.onPress();
    });

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it('calls navigation.goBack when the back button is pressed', () => {
    const navigation = fakeNavigation();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<LanguageScreen navigation={navigation} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Back to Settings'}).props.onPress();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('gives the first option (Auto) hasTVPreferredFocus', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<LanguageScreen navigation={fakeNavigation()} />);
    });

    const autoButton = renderer.root.findByProps({accessibilityLabel: 'Auto'});
    expect(autoButton.type).toBe(Pressable);
    expect(autoButton.props.hasTVPreferredFocus).toBe(true);
  });
});
