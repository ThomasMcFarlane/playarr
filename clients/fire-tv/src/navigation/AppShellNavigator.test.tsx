/**
 * Regression test for exactly the class of bug this repo's own history
 * shows can happen silently: a callback typed and threaded all the way
 * down to a screen's props, with every layer beneath it fully implemented
 * and tested, yet never actually connected at the one wiring point that
 * matters -- `AppShellNavigator.tsx`'s `WorkDetailScreenScreen`/
 * `MusicDetailScreenScreen` wrapper functions rendering `WorkDetailScreen`/
 * `MusicDetailScreen` with no `onPlay` prop at all, which
 * `WorkDetailScreen.test.tsx`'s own thorough `onPlay` coverage could never
 * catch, because that file constructs `<WorkDetailScreen onPlay={...}>`
 * directly and never exercises this file's wrapper in between.
 *
 * This mounts the REAL `<AppShellNavigator>` inside a real
 * `<NavigationContainer>`/`<Stack.Navigator>` (the same shape
 * `RootNavigator.tsx` gives it in production) and a real
 * `<ApiClientProvider>`, landed directly on `ROUTES.workDetail` /
 * `ROUTES.musicDetail` via `initialState` -- the one thing replaced is
 * `PlayerScreen` itself, stood in for by a plain fake `PlayerScreenHandle`
 * provided through the real `PlayerHandleContext`, since mounting the real
 * shell-mounted `PlayerScreen` is `App.test.tsx`'s job, not this file's
 * (see that file's own top comment for why its own native-module mock list
 * is heavier: it also loads `PlayerScreen.tsx`'s whole `platform/media/`
 * import graph, which nothing rendered here touches).
 *
 * Every `jest.mock()` below neutralises one native dependency this file's
 * own import graph reaches for that Jest has no host for -- the same
 * technique, and the same set (minus the `react-native-w3cmedia` mock,
 * unneeded here for the reason above), `App.test.tsx` already establishes;
 * kept file-local for the same reason that file gives.
 */
jest.mock('@amazon-devices/react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Path: 'Path',
  Circle: 'Circle',
  Rect: 'Rect',
  G: 'G',
  Defs: 'Defs',
  Stop: 'Stop',
  Line: 'Line',
  Polyline: 'Polyline',
  Polygon: 'Polygon',
  LinearGradient: 'SvgLinearGradient',
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

jest.mock('@amazon-devices/react-linear-gradient', () => ({
  __esModule: true,
  default: 'LinearGradient',
}));

jest.mock('@amazon-devices/react-native-gesture-handler', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    GestureHandlerRootView: RN.View,
  };
});

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
import renderer, {act, type ReactTestRenderer} from 'react-test-renderer';
import {createStackNavigator} from '@amazon-devices/react-navigation__stack';
import {NavigationContainer} from '@amazon-devices/react-navigation__native';
import type {Work, WorkDetail} from '@playarr-tv/api-client';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {AppShellNavigator, APP_SHELL_ROUTE} from './AppShellNavigator';
import {PlayerHandleContext} from './PlayerHandleContext';
import type {PlayerScreenHandle} from '../screens/PlayerScreen';
import {ROUTES} from './routes';

function work(overrides: Partial<Work> & Pick<Work, 'id' | 'title'>): Work {
  return {
    added_at: '2026-01-01T00:00:00Z',
    availability: 'available',
    external_refs: [],
    genres: [],
    images: [],
    kind: 'movie',
    monitored: true,
    overview: null,
    sort_title: overrides.title,
    tags: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

/**
 * Routes every request this render fires to a canned response: the movie
 * itself (`WorkDetailScreen`'s `useWorkDetail`), its `/credits` and
 * `/similar` calls (same as `WorkDetailScreen.test.tsx`'s own
 * `mockDetailFetch`), and `AppShellNavigator`'s own `listCatalogKinds`
 * call (`/catalog/kinds`) that its nav-rail-gating effect fires on mount
 * regardless of which content-stack screen is initially focused.
 */
function mockShellFetch(detail: WorkDetail): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/catalog/kinds')) return jsonResponse(['movie']);
    if (url.includes('/credits')) return jsonResponse({cast: [], crew: []});
    if (url.includes('/similar')) return jsonResponse([]);
    return jsonResponse(detail);
  });
}

/** A stand-in for the real, shell-mounted `PlayerScreen`'s imperative handle -- see this file's top comment for why the real component is not mounted here. */
function fakePlayerHandle(): {ref: React.RefObject<PlayerScreenHandle>; show: jest.Mock} {
  const show = jest.fn();
  const handle: PlayerScreenHandle = {show, hide: jest.fn(), stop: jest.fn(), isVisible: () => false};
  return {ref: {current: handle}, show};
}

const Stack = createStackNavigator();

/**
 * Mounts `<AppShellNavigator>` exactly as `RootNavigator.tsx` registers it
 * in production (a single `Stack.Screen` under `APP_SHELL_ROUTE`), landed
 * directly on the given nested content-stack route via `initialState` --
 * the standard React Navigation recipe for starting a test somewhere other
 * than a navigator's default initial route.
 */
async function renderShellOn(
  routeName: string,
  params: Record<string, unknown>,
  playerHandleRef: React.RefObject<PlayerScreenHandle>
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <ApiClientProvider>
        <PlayerHandleContext.Provider value={playerHandleRef}>
          <NavigationContainer
            initialState={{
              routes: [{name: APP_SHELL_ROUTE, state: {routes: [{name: routeName, params}]}}],
            }}
          >
            <Stack.Navigator screenOptions={{headerShown: false}}>
              <Stack.Screen name={APP_SHELL_ROUTE} component={AppShellNavigator} />
            </Stack.Navigator>
          </NavigationContainer>
        </PlayerHandleContext.Provider>
      </ApiClientProvider>
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
}

describe('AppShellNavigator player wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('wires WorkDetailScreen\'s Play button through to the real PlayerScreen handle', async () => {
    mockShellFetch({
      available_on: [],
      children: 'Movie',
      media_file_id: 'mf-1',
      runtime_ms: 5_400_000,
      work: work({id: 'w1', title: 'The First Film'}),
    });
    const {ref: playerHandleRef, show} = fakePlayerHandle();

    const tree = await renderShellOn(ROUTES.workDetail, {workId: 'w1'}, playerHandleRef);

    await act(async () => {
      tree.root.findByProps({accessibilityLabel: 'Play'}).props.onPress();
    });

    expect(show).toHaveBeenCalledWith('mf-1');

    await act(async () => {
      tree.unmount();
    });
  });

  it('wires MusicDetailScreen\'s track rows through to the real PlayerScreen handle', async () => {
    mockShellFetch({
      available_on: [],
      children: {
        Artist: [
          {
            album: {
              album_type: 'studio',
              artist_work_id: 'w2',
              availability: 'available',
              id: 'album-1',
              images: [],
              monitored: true,
              release_date: null,
              title: 'A Great Album',
            },
            tracks: [
              {
                media_file_id: 'mf-track-1',
                track: {
                  album_id: 'album-1',
                  availability: 'available',
                  disc_number: 1,
                  duration_seconds: 210,
                  id: 'track-1',
                  title: 'Opening Track',
                  track_number: 1,
                },
              },
            ],
          },
        ],
      },
      media_file_id: null,
      runtime_ms: null,
      work: work({id: 'w2', title: 'A Great Artist', kind: 'artist'}),
    });
    const {ref: playerHandleRef, show} = fakePlayerHandle();

    const tree = await renderShellOn(ROUTES.musicDetail, {workId: 'w2'}, playerHandleRef);

    await act(async () => {
      tree.root.findByProps({accessibilityLabel: 'Play Opening Track'}).props.onPress();
    });

    expect(show).toHaveBeenCalledWith('mf-track-1');

    await act(async () => {
      tree.unmount();
    });
  });
});
