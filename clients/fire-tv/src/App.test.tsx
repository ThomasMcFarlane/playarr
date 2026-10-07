/**
 * The one test this repo did not yet have before this pass: a genuine
 * mount of `<App>` itself, exercising the real provider chain, the real
 * `NavigationContainer`/`RootNavigator`, and the real shell-mounted
 * `<PlayerScreen>`, all together. `tsc` alone cannot catch the class of bug
 * this guards against -- a component tree that typechecks perfectly but
 * throws the instant it actually renders, because a JSX-emitting file is
 * missing a real `import React` under this project's classic JSX runtime
 * (`babel.config.js`), or because a bare `@amazon-devices/*` import reaches
 * a native module Jest has no host for. `LinkScreen.test.tsx`'s own top
 * comment documents finding exactly the first kind of bug this way; this
 * file exists so the same class of bug at the whole-app level (not just one
 * screen) has a regression test too.
 *
 * Every `jest.mock()` below neutralises one native dependency this
 * project's own `src/platform/` layer (imported transitively by `LinkScreen`,
 * the screen `<App>` actually renders first) or `PlayerScreen.tsx` (shell-
 * mounted here unconditionally, so its whole import graph loads even while
 * it renders `null`) reaches for that Jest has no real host for -- the same
 * technique, and largely the same set, `LinkScreen.test.tsx` and
 * `QrCode.test.tsx` already establish; kept file-local rather than added to
 * `jest.config.json`/`jest.setup.ts` for the same reason those two files
 * give: shared config is a surface concurrent feature work may also depend
 * on.
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
  useComponentInstance: jest.fn(() => ({})),
}));

jest.mock('@amazon-devices/react-native-device-info', () => ({
  __esModule: true,
  getModel: () => 'Fire TV Stick 4K',
  getSystemVersion: () => '8.0.0',
}));

// `RootNavigator.tsx` imports `AppShellNavigator.tsx` statically (it is a
// registered `<Stack.Screen component={...}>`, not lazily required), which
// pulls in every authenticated screen's own import graph -- including
// `components/TvMediaTrack.tsx`'s `@amazon-devices/react-linear-gradient`
// -- even though none of those screens render until a session exists.
// Same mock shape `components/ProfileAvatar.test.tsx` already established.
jest.mock('@amazon-devices/react-linear-gradient', () => ({
  __esModule: true,
  LinearGradient: 'LinearGradient',
}));

// `VegaVideoSurface.tsx` (imported statically by `PlayerScreen.tsx`, which
// `<App>` mounts unconditionally) imports `KeplerVideoView` as a real value,
// which reaches Kepler's native-view registration the moment the module
// loads -- regardless of whether `PlayerScreen` is currently visible, since
// that gate only decides what renders, not what this static `import`
// statement resolves at module-load time. `VideoPlayer`/`MediaError`/etc
// are typed-only imports elsewhere in this app's `platform/media/` layer
// (erased at compile time), so nothing beyond `KeplerVideoView` needs a
// runtime stand-in here.
jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  __esModule: true,
  KeplerVideoView: 'KeplerVideoView',
}));

// The real package reaches for `TurboModuleRegistry`/`Platform.OS`-gated
// native handler classes the moment it is imported, which this environment
// has no host for (confirmed directly: an un-mocked import throws
// `TypeError: Cannot read properties of undefined (reading 'OS')` deep
// inside its own `createHandler.tsx`, before a single test runs). `<App>`
// only ever uses `GestureHandlerRootView` as a plain wrapping view -- the
// same role a bare `View` plays in production once native gesture
// recognition is stripped away -- so that is all this stub needs to be.
jest.mock('@amazon-devices/react-native-gesture-handler', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    GestureHandlerRootView: RN.View,
  };
});

// `@amazon-devices/react-navigation__stack`'s own `GestureHandlerNative.tsx`
// reaches for the UN-scoped `react-native-gesture-handler` module id
// directly (not the `@amazon-devices`-scoped package this app itself
// depends on above) -- there is no such package in this project's
// `node_modules` at all, scoped or otherwise, so this mock exists purely
// to satisfy that one internal import inside a dependency this app does
// not otherwise touch. `PanGestureHandler` is stubbed as a plain `View`
// (the stack navigator only ever wraps children in it for edge-swipe-back
// gesture recognition, irrelevant to this test), and `State` as the small
// numeric enum the real package ships, since `StackView.tsx` reads
// `GestureState.*` members by name.
jest.mock(
  'react-native-gesture-handler',
  () => {
    const RN = jest.requireActual('react-native');
    return {
      __esModule: true,
      GestureHandlerRootView: RN.View,
      PanGestureHandler: RN.View,
      State: {UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5},
    };
  },
  {virtual: true}
);

// `@amazon-devices/react-navigation__stack`'s own `Screens.tsx` requires
// this module successfully (it exists as a real dependency here, unlike
// the unscoped `react-native-gesture-handler` above), so it is genuinely
// used to render the stack's screen container -- and rendering it, not
// merely importing it, is what reaches `NativeScreenContainer`'s own
// `requireNativeComponent` call and throws under Jest (confirmed
// directly: this was the actual crash before this mock was added, not a
// theoretical one). Every export below is a plain `View` stand-in; none of
// this app's own code touches this package directly, only the navigator
// library does, purely for its screen-freezing/native-stack optimisation,
// which has no bearing on whether this test's assertions hold.
jest.mock('@amazon-devices/react-native-screens', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    Screen: RN.View,
    ScreenContainer: RN.View,
    ScreenStack: RN.View,
    InnerScreen: RN.View,
    NativeScreen: RN.View,
    NativeScreenContainer: RN.View,
    NativeScreenNavigationContainer: RN.View,
    SearchBar: RN.View,
    FullWindowOverlay: RN.View,
    enableScreens: jest.fn(),
    enableFreeze: jest.fn(),
    screensEnabled: () => false,
    shouldUseActivityState: false,
    useTransitionProgress: () => ({
      progress: {value: 1},
      closing: {value: 0},
      goingForward: {value: 1},
    }),
    isSearchBarAvailableForCurrentPlatform: false,
    isNewBackTitleImplementation: false,
    executeNativeBackPress: () => false,
  };
});

import * as React from 'react';
import renderer, {act} from 'react-test-renderer';
import App from './App';
import {
  hydrateLocalStorage,
  resetLocalStorageShimForTests,
  type AsyncStorageLike,
} from './platform/storage/localStorageShim';

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

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('<App>', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    // `App` itself awaits `hydrate()` (the real `src/bootstrap/hydrate.ts`)
    // before its first real render, backed by `jest.setup.ts`'s own
    // in-memory `AsyncStorage` double -- calling `hydrateLocalStorage`
    // directly here as well is not redundant with that: it resets this
    // test's `localStorageShim` module state up front (a fresh in-memory
    // Map + a fresh write-behind target) exactly as `LinkScreen.test.tsx`
    // does before every case, so this test starts from a clean, known
    // storage state rather than whatever an earlier test in the same file
    // may have left behind.
    await hydrateLocalStorage(createFakeAsyncStorage());

    // `LinkScreen` (the first real screen `<RootNavigator>` renders, since
    // there is no persisted session in a freshly-hydrated store) requests a
    // hosted link code on mount, a real `fetch()` call. A permanently
    // pending promise keeps that state machine parked in its initial
    // "creating" state for the whole test -- this file is asserting the
    // shell renders correctly, not exercising the link flow itself, which
    // `LinkScreen.test.tsx` already covers on its own.
    globalThis.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  afterEach(() => {
    resetLocalStorageShimForTests();
    globalThis.fetch = originalFetch;
  });

  it('mounts the real provider chain and navigator tree without throwing, landing on LinkScreen', async () => {
    let tree: renderer.ReactTestRenderer | undefined;

    await act(async () => {
      tree = renderer.create(<App />);
    });
    await act(flush);

    expect(tree).toBeDefined();

    // The loading gate has cleared (hydration resolved) and the real
    // `RootNavigator` is showing its `initialRouteName={ROUTES.link}`
    // screen, parked in its "creating" state by the permanently-pending
    // `fetch` above -- "PAIR THIS DEVICE" is `LinkScreen`'s own copy for
    // exactly that state, present only once the placeholder
    // `<Stack.Navigator>` this file used to render has genuinely been
    // replaced by the real navigator tree.
    const json = tree?.toJSON();
    expect(json).not.toBeNull();
    const asText = JSON.stringify(json);
    expect(asText).toContain('PAIR THIS DEVICE');
    expect(asText).toContain('Getting your Playarr code');

    // `<PlayerScreen>` is mounted (its hooks all ran without throwing, the
    // whole point of this test) but hidden -- `show()` was never called, so
    // it renders `null` and contributes nothing to the tree. Confirmed
    // indirectly: nothing above threw despite `PlayerScreen`'s entire
    // `platform/media/` import graph having loaded for real.
    await act(async () => {
      tree?.unmount();
    });
  });
});
