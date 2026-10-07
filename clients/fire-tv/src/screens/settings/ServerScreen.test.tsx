/**
 * Same integration posture as `PlayerSettingsScreen.test.tsx`: a REAL
 * `<ApiClientProvider>` (only `global.fetch` mocked, though this screen
 * never actually calls it) plus the real hydrated `localStorage` shim, so
 * `readKnownServers`/`forgetGroup`/`TokenStore` all exercise their genuine
 * implementations rather than a test double standing in for them.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import {rememberGroup, type KnownServerGroup} from '@playarr-tv/domain';
import {TokenStore} from '@playarr-tv/device-auth';
import {ApiClientProvider} from '../../api/ApiClientProvider';
import {hydrateLocalStorage, resetLocalStorageShimForTests} from '../../platform/storage/localStorageShim';
import {ServerScreen, summariseKnownServers, type ServerScreenNavigation} from './ServerScreen';
import {ROUTES} from '../../navigation/routes';

// WORKAROUND, not a fix: see `LibraryScreen.test.tsx`'s own comment (same
// project, same root cause) for exactly why this line is necessary --
// `../../api/ApiClientProvider.tsx` renders JSX without importing `React`
// as a value. Flagged in this task's own final report; not this task's
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

function fakeNavigation(): ServerScreenNavigation & {goBack: jest.Mock; navigate: jest.Mock} {
  return {goBack: jest.fn(), navigate: jest.fn()};
}

function allText(renderer: ReactTestRenderer): string {
  return renderer
    .root.findAllByType(Text)
    .map((node) => node.props.children)
    .flat()
    .filter((value) => typeof value === 'string')
    .join(' | ');
}

describe('summariseKnownServers', () => {
  it('returns no rows for an absent group', () => {
    expect(summariseKnownServers(undefined)).toEqual([]);
  });

  it('puts lastGoodUrl first, marked, deduplicated against servers', () => {
    const group: KnownServerGroup = {
      servers: [{url: 'https://a.example'}, {url: 'https://b.example'}],
      lastGoodUrl: 'https://b.example',
    };

    expect(summariseKnownServers(group)).toEqual([
      {url: 'https://b.example', isLastGood: true},
      {url: 'https://a.example', isLastGood: false},
    ]);
  });

  it('handles a group with no lastGoodUrl yet', () => {
    const group: KnownServerGroup = {servers: [{url: 'https://a.example'}]};
    expect(summariseKnownServers(group)).toEqual([{url: 'https://a.example', isLastGood: false}]);
  });
});

describe('ServerScreen', () => {
  beforeEach(async () => {
    resetLocalStorageShimForTests();
    await hydrateLocalStorage(fakeAsyncStorage());
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {status: 200, headers: {'Content-Type': 'application/json'}})
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the connected server address', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ApiClientProvider>
          <ServerScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });

    expect(allText(renderer)).toContain('Server connection');
  });

  it('shows no remembered-servers section when no group is known', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ApiClientProvider>
          <ServerScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });

    expect(allText(renderer)).not.toContain('Remembered server addresses');
  });

  it('lists a remembered server group, marking the last-good address', () => {
    rememberGroup({
      servers: [{url: 'https://one.example'}, {url: 'https://two.example'}],
      lastGoodUrl: 'https://two.example',
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ApiClientProvider>
          <ServerScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });

    const rendered = allText(renderer);
    expect(rendered).toContain('https://one.example');
    expect(rendered).toContain('https://two.example');
    expect(rendered).toContain('Last used');
  });

  it('forgetting the server group clears it from view without signing out', () => {
    rememberGroup({servers: [{url: 'https://one.example'}], lastGoodUrl: 'https://one.example'});
    const navigation = fakeNavigation();

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ApiClientProvider>
          <ServerScreen navigation={navigation} />
        </ApiClientProvider>
      );
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Forget this server group'}).props.onPress();
    });

    expect(allText(renderer)).not.toContain('Remembered server addresses');
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('signing out clears the token store and navigates to Link', () => {
    const tokenStore = new TokenStore();
    tokenStore.set({accessToken: 'a', refreshToken: 'b', tokenType: 'Bearer', expiresAt: Date.now() + 60_000});
    const navigation = fakeNavigation();

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ApiClientProvider>
          <ServerScreen navigation={navigation} />
        </ApiClientProvider>
      );
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Sign out'}).props.onPress();
    });

    expect(tokenStore.get()).toBeUndefined();
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.link);
  });

  it('signing out does NOT clear the remembered server group (§5.5 rule 4)', () => {
    rememberGroup({servers: [{url: 'https://one.example'}], lastGoodUrl: 'https://one.example'});

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ApiClientProvider>
          <ServerScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Sign out'}).props.onPress();
    });

    expect(allText(renderer)).toContain('https://one.example');
  });

  it('calls navigation.goBack when the back button is pressed', () => {
    const navigation = fakeNavigation();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ApiClientProvider>
          <ServerScreen navigation={navigation} />
        </ApiClientProvider>
      );
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Back to Settings'}).props.onPress();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
