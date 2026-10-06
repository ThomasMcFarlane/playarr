/**
 * Same integration posture as `PlayerSettingsScreen.test.tsx`/
 * `ServerScreen.test.tsx`: a REAL `<ApiClientProvider>` with only
 * `global.fetch` mocked, round-tripping the actual
 * `getProfilePinSetting`/`updateProfilePinSetting` calls this screen makes.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import {ApiClientProvider} from '../../api/ApiClientProvider';
import {hydrateLocalStorage, resetLocalStorageShimForTests} from '../../platform/storage/localStorageShim';
import {
  ProfileLockScreen,
  appendPinDigit,
  removeLastPinDigit,
  isCompletePin,
  type ProfileLockScreenNavigation,
} from './ProfileLockScreen';

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

function fakeNavigation(): ProfileLockScreenNavigation & {goBack: jest.Mock} {
  return {goBack: jest.fn()};
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function mockPinFetch(initiallyLocked: boolean): {
  fetchMock: jest.SpyInstance;
  state: {pin_locked: boolean};
  lastPatchBody: Array<{pin: string | null}>;
} {
  const state = {pin_locked: initiallyLocked};
  // `Request.clone()` only works before the body stream has been consumed
  // -- reading `.json()` here to decide `state.pin_locked` consumes it, so
  // a caller trying to `.clone()` the captured `Request` afterwards (the
  // obvious way to inspect what was sent) hits `TypeError: unusable`. This
  // records the already-parsed body directly instead, which is both
  // simpler and avoids relying on `Request` body-stream semantics at all.
  const lastPatchBody: Array<{pin: string | null}> = [];
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    if (request.method === 'PATCH') {
      const body = (await request.json()) as {pin: string | null};
      lastPatchBody.push(body);
      state.pin_locked = body.pin !== null;
    }
    return jsonResponse(state);
  });
  return {fetchMock, state, lastPatchBody};
}

function allText(renderer: ReactTestRenderer): string {
  return renderer
    .root.findAllByType(Text)
    .map((node) => node.props.children)
    .flat()
    .filter((value) => typeof value === 'string')
    .join(' | ');
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function pressDigits(renderer: ReactTestRenderer, digits: string): void {
  for (const digit of digits) {
    act(() => {
      renderer.root.findByProps({accessibilityLabel: `Digit ${digit}`}).props.onPress();
    });
  }
}

describe('appendPinDigit', () => {
  it('appends a digit', () => {
    expect(appendPinDigit('12', '3')).toBe('123');
  });

  it('refuses to grow past four digits', () => {
    expect(appendPinDigit('1234', '5')).toBe('1234');
  });

  it('ignores a non-digit', () => {
    expect(appendPinDigit('12', 'x')).toBe('12');
  });
});

describe('removeLastPinDigit', () => {
  it('removes the last digit', () => {
    expect(removeLastPinDigit('123')).toBe('12');
  });

  it('is a no-op on an empty buffer', () => {
    expect(removeLastPinDigit('')).toBe('');
  });
});

describe('isCompletePin', () => {
  it('accepts exactly four digits', () => {
    expect(isCompletePin('1234')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isCompletePin('123')).toBe(false);
    expect(isCompletePin('12345')).toBe(false);
    expect(isCompletePin('12a4')).toBe(false);
  });
});

describe('ProfileLockScreen', () => {
  beforeEach(async () => {
    resetLocalStorageShimForTests();
    await hydrateLocalStorage(fakeAsyncStorage());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows "PIN lock is off" and a New PIN label when nothing is set', async () => {
    mockPinFetch(false);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <ProfileLockScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    const rendered = allText(renderer);
    expect(rendered).toContain('PIN lock is off.');
    expect(rendered).toContain('New PIN');
  });

  it('shows "PIN lock is on", a Replace PIN label, and a Remove PIN button when a PIN is set', async () => {
    mockPinFetch(true);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <ProfileLockScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    const rendered = allText(renderer);
    expect(rendered).toContain('PIN lock is on.');
    expect(rendered).toContain('Replace PIN');
    expect(() => renderer.root.findByProps({accessibilityLabel: 'Remove PIN'})).not.toThrow();
  });

  it('the submit key is disabled until exactly four digits are entered, then submits via PATCH', async () => {
    const {lastPatchBody} = mockPinFetch(false);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <ProfileLockScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    expect(renderer.root.findByProps({accessibilityLabel: 'Confirm PIN'}).props.disabled).toBe(true);

    pressDigits(renderer, '123');
    expect(renderer.root.findByProps({accessibilityLabel: 'Confirm PIN'}).props.disabled).toBe(true);

    pressDigits(renderer, '4');
    expect(renderer.root.findByProps({accessibilityLabel: 'Confirm PIN'}).props.disabled).toBe(false);

    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'Confirm PIN'}).props.onPress();
    });
    await flush();

    expect(lastPatchBody).toEqual([{pin: '1234'}]);
    expect(allText(renderer)).toContain('PIN lock is on.');
  });

  it('backspace removes the most recently entered digit', async () => {
    mockPinFetch(false);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <ProfileLockScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    pressDigits(renderer, '12');
    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Delete last digit'}).props.onPress();
    });
    pressDigits(renderer, '99');

    // Confirm becomes enabled only once four digits are buffered ("1" + "9"
    // + "9" = 3 digits after the backspace removed the "2") -- this proves
    // the backspace actually took effect rather than merely not crashing.
    expect(renderer.root.findByProps({accessibilityLabel: 'Confirm PIN'}).props.disabled).toBe(true);
  });

  it('removing an existing PIN calls PATCH with pin: null', async () => {
    const {lastPatchBody} = mockPinFetch(true);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <ProfileLockScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
    });
    await flush();

    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'Remove PIN'}).props.onPress();
    });
    await flush();

    expect(lastPatchBody).toEqual([{pin: null}]);
    expect(allText(renderer)).toContain('PIN lock is off.');
  });

  it('calls navigation.goBack when the back button is pressed', async () => {
    mockPinFetch(false);
    const navigation = fakeNavigation();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <ProfileLockScreen navigation={navigation} />
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
