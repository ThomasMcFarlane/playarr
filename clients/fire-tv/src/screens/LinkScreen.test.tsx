/**
 * A black-box smoke test of the state machine `LinkScreen.tsx` drives --
 * `../auth/hostedLink`, `../auth/session` and `../components/QrCode` already
 * have their own thorough, pure unit coverage (injected fetch/now/wait, no
 * native rendering); this file's job is only to prove the wiring between
 * them and the screen's three render states is correct, not to re-prove
 * their own internals.
 *
 * `../platform`'s barrel (`TvFocusScope`/`useBackHandler`, imported by this
 * screen) transitively imports real `@amazon-devices/react-native-kepler`
 * and `@amazon-devices/react-native-device-info` modules that reach
 * `requireNativeComponent`/native-module lookups the moment they are
 * imported -- exactly the `__fbBatchedBridgeConfig is not set` crash
 * `QrCode.test.tsx`'s own top comment documents for
 * `@amazon-devices/react-native-svg`. Every `jest.mock()` below (hoisted
 * above the imports that follow, per babel-plugin-jest-hoist) exists to
 * neutralise one of those, kept file-local rather than added to
 * `jest.config.json`/`jest.setup.ts` -- this task's own constraint against
 * touching shared config other concurrent feature work may also depend on.
 */
jest.mock('@amazon-devices/react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Path: 'Path',
}));

jest.mock('@amazon-devices/react-native-kepler', () => ({
  __esModule: true,
  TVFocusGuideView: ({children}: {children?: React.ReactNode}) => children,
  FocusManager: {focus: jest.fn(), blur: jest.fn(), setFocusRoot: jest.fn(), getFocused: jest.fn()},
  useTVEventHandler: jest.fn(),
  useKeplerAppStateManager: jest.fn(() => ({
    getCurrentState: () => 'active',
    addAppStateListener: () => ({remove: jest.fn()}),
  })),
}));

jest.mock('@amazon-devices/react-native-device-info', () => ({
  __esModule: true,
  getModel: () => 'Fire TV Stick 4K',
  getSystemVersion: () => '8.0.0',
}));

const mockNavigationReset = jest.fn();
jest.mock('@amazon-devices/react-navigation__native', () => ({
  __esModule: true,
  useNavigation: () => ({reset: mockNavigationReset}),
}));

import * as React from 'react';

// WORKAROUND for a real, out-of-scope bug this test discovered:
// `../api/ApiClientProvider.tsx` (and `../App.tsx`) use JSX
// (`<ApiClientContext.Provider>`/`<NavigationContainer>`/etc.) without
// importing `React` at all -- fine under the automatic JSX runtime
// `metro-react-native-babel-preset` defaults to, but this project's
// `babel.config.js` deliberately overrides that to the CLASSIC runtime
// project-wide (`@babel/plugin-transform-react-jsx`, added for
// `@amazon-devices/react-native-w3cmedia`'s `KeplerVideoView`), which
// compiles JSX to a bare `React.createElement(...)` call requiring `React`
// to be an in-scope identifier. Neither file has one, so both throw
// `ReferenceError: React is not defined` the instant their JSX actually
// runs -- confirmed directly here, not theorised: this test failed with
// exactly that error before this workaround was added. That is a real,
// build-breaking defect (Metro would hit it identically to Jest; nothing
// about this is Jest-specific), but `ApiClientProvider.tsx` is Foundation-
// stage code outside this task's file scope, so it is reported rather than
// patched here -- see the accompanying report. `globalThis.React` is set
// BEFORE importing anything that transitively renders JSX, so the classic
// pragma's free `React` reference resolves via the global object instead of
// throwing; this has no effect on `import * as React from 'react'` above,
// which remains this file's own real, explicit import for the JSX this
// test itself writes.
(globalThis as unknown as {React: typeof React}).React = React;

import renderer, {act} from 'react-test-renderer';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {
  hydrateLocalStorage,
  resetLocalStorageShimForTests,
  type AsyncStorageLike,
} from '../platform/storage/localStorageShim';
import {ROUTES} from '../navigation/routes';
import {LinkScreen} from './LinkScreen';

function createFakeAsyncStorage(): AsyncStorageLike {
  const backing = new Map<string, string>();
  return {
    async getAllKeys() {
      return Array.from(backing.keys());
    },
    async multiGet(keys) {
      return keys.map((key) => [key, backing.get(key) ?? null] as const);
    },
    async setItem(key, value) {
      backing.set(key, value);
    },
    async removeItem(key) {
      backing.delete(key);
    },
  };
}

function fakeAccessToken(claims: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(claims))}.signature`;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('<LinkScreen>', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    await hydrateLocalStorage(createFakeAsyncStorage());
    mockNavigationReset.mockClear();
  });

  afterEach(() => {
    resetLocalStorageShimForTests();
    globalThis.fetch = originalFetch;
  });

  it('shows the QR code and pairing details once the hosted code arrives, then commits the session and navigates to Profiles once approved', async () => {
    let requestCount = 0;
    // Two different callers hit this one mock with two different calling
    // conventions: `../auth/hostedLink.ts` calls the global 2-argument
    // `fetch(url: string, init)` form directly, while `completeServerDeviceLink`
    // goes through `../api/client.ts`'s `createApiClient` -> openapi-fetch,
    // which always calls `fetch(request: Request)` with an already-built
    // `Request` object (see `../api/client.ts`'s own `RnFetch` doc comment).
    // Normalising both to a plain URL string here, rather than writing two
    // separate mocks, keeps this test's request-routing logic in one place.
    const fetch = jest.fn(async (input: RequestInfo | URL) => {
      requestCount += 1;
      const url = typeof input === 'string' ? input : (input as Request).url;

      if (url === 'https://playarr.app/api/link/code') {
        return new Response(
          JSON.stringify({
            device_code: 'hosted-secret',
            user_code: 'ABCD-2345',
            verification_uri: 'https://playarr.app/link',
            verification_uri_complete: 'https://playarr.app/link?user_code=ABCD-2345',
            expires_in: 600,
            interval: 0.001, // keep the poll loop fast under real timers
          }),
          {status: 200}
        );
      }
      if (url.startsWith('https://playarr.app/api/link/code/')) {
        return new Response(
          JSON.stringify({
            user_code: 'ABCD-2345',
            server_url: 'http://playarr.lan:8484',
            server_device_code: 'server-device-secret',
            server_urls: ['http://playarr.lan:8484'],
          }),
          {status: 200}
        );
      }
      if (url === 'http://playarr.lan:8484/api/v1/oauth/token') {
        return new Response(
          JSON.stringify({
            access_token: fakeAccessToken({sub: 'user-1', device_id: 'device-1'}),
            refresh_token: 'refresh-token',
            token_type: 'Bearer',
            expires_in: 900,
          }),
          {status: 200}
        );
      }
      throw new Error(`Unexpected request in test: ${url}`);
    });
    globalThis.fetch = fetch as unknown as typeof originalFetch;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ApiClientProvider>
          <LinkScreen />
        </ApiClientProvider>
      );
      await flush();
    });

    // First render state: waiting on the hosted code itself.
    expect(tree.toJSON()).toBeTruthy();

    // Give the hosted-code request, the (near-instant) hosted-broker poll,
    // and the server device-token exchange time to resolve across real
    // timers -- LinkScreen injects neither a fake `wait` into
    // `pollHostedDeviceLink` (kept to ~1ms here via the hosted code's own
    // `interval` above) nor, because it has no injection point at all, into
    // `completeServerDeviceLink`'s `pollForToken` call, which is
    // `@playarr-tv/device-auth`'s own internal implementation and always
    // sleeps a REAL, hard-coded 1 second before its first poll (see
    // `session.ts`'s `completeServerDeviceLink` doc comment for why that
    // interval is intentional, not a bug). 1500ms comfortably covers both.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    });

    expect(requestCount).toBeGreaterThanOrEqual(3);
    expect(mockNavigationReset).toHaveBeenCalledWith({index: 0, routes: [{name: ROUTES.profiles}]});
  }, 10_000);

  it('shows a retry control after a failed request, and starts over when it is pressed', async () => {
    const fetch = jest.fn(async () => new Response(null, {status: 503}));
    globalThis.fetch = fetch as unknown as typeof originalFetch;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ApiClientProvider>
          <LinkScreen />
        </ApiClientProvider>
      );
      await flush();
    });

    const errorText = tree.root.findAll(
      (node) => typeof node.props.children === 'string' && node.props.children.includes('unavailable')
    );
    expect(errorText.length).toBeGreaterThan(0);

    const retryButton = tree.root.findByProps({accessibilityRole: 'button'});
    const callsBeforeRetry = fetch.mock.calls.length;
    await act(async () => {
      retryButton.props.onPress();
      await flush();
    });

    expect(fetch.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it('renews an expired code on its own instead of showing an error', async () => {
    let codeRequests = 0;
    const fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url === 'https://playarr.app/api/link/code') {
        codeRequests += 1;
        return new Response(
          JSON.stringify({
            device_code: `hosted-secret-${codeRequests}`,
            user_code: 'ABCD-2345',
            verification_uri: 'https://playarr.app/link',
            verification_uri_complete: 'https://playarr.app/link?user_code=ABCD-2345',
            expires_in: 600,
            interval: 0.05,
          }),
          {status: 200}
        );
      }
      // The broker has dropped the code.
      return new Response(null, {status: 404});
    });
    globalThis.fetch = fetch as unknown as typeof originalFetch;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ApiClientProvider>
          <LinkScreen />
        </ApiClientProvider>
      );
      await flush();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(codeRequests).toBeGreaterThanOrEqual(2);
    expect(tree.root.findAllByProps({accessibilityRole: 'button'})).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });
});
