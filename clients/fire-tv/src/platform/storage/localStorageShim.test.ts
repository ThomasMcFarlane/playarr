/**
 * Every case here exercises hydrateLocalStorage/the installed shim purely
 * through an injected fake -- no jest.mock(), no real
 * @amazon-devices/react-native-async-storage__async-storage, no Vega. That
 * is the whole point of storage/asyncStorage.ts being a separate file this
 * one never imports: if the real package's shape ever drifts, THAT file (or
 * its own integration test, once one exists) is where it breaks, not here.
 */
import {
  hydrateLocalStorage,
  resetLocalStorageShimForTests,
  type AsyncStorageLike,
} from './localStorageShim';

/** Minimal in-memory stand-in for the real AsyncStorage default export. */
function createFakeAsyncStorage(seed: Record<string, string> = {}) {
  const backing = new Map<string, string>(Object.entries(seed));
  const calls = {setItem: 0, removeItem: 0};

  const fake: AsyncStorageLike = {
    async getAllKeys() {
      return Array.from(backing.keys());
    },
    async multiGet(keys) {
      return keys.map((key) => [key, backing.get(key) ?? null] as const);
    },
    async setItem(key, value) {
      calls.setItem += 1;
      backing.set(key, value);
    },
    async removeItem(key) {
      calls.removeItem += 1;
      backing.delete(key);
    },
  };

  return {fake, backing, calls};
}

/** Lets any fire-and-forget write-behind promise settle before assertions. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('localStorageShim', () => {
  afterEach(() => {
    resetLocalStorageShimForTests();
  });

  it('does not call multiGet with an empty key list on a first launch', async () => {
    const {fake} = createFakeAsyncStorage();
    const multiGet = jest.fn(fake.multiGet);
    multiGet.mockRejectedValue(new Error('At least one key is needed for this operation'));

    await expect(hydrateLocalStorage({...fake, multiGet})).resolves.toBeUndefined();

    expect(multiGet).not.toHaveBeenCalled();
  });

  it('hydrates persisted-prefix keys from AsyncStorage and exposes them synchronously', async () => {
    const {fake} = createFakeAsyncStorage({
      'streamarr:session': '{"accessToken":"a"}',
      'playarr.currentUserName': 'Alex',
    });

    await hydrateLocalStorage(fake);

    expect(globalThis.localStorage.getItem('streamarr:session')).toBe('{"accessToken":"a"}');
    expect(globalThis.localStorage.getItem('playarr.currentUserName')).toBe('Alex');
    expect(globalThis.localStorage.getItem('never-set')).toBeNull();
  });

  it('persists the shared packages\' current `playarr:` keys (session, device id, server address)', async () => {
    const {fake, backing} = createFakeAsyncStorage({});
    await hydrateLocalStorage(fake);

    globalThis.localStorage.setItem('playarr:session', '{"accessToken":"a"}');
    globalThis.localStorage.setItem('playarr:deviceId', 'device-1');
    globalThis.localStorage.setItem('playarr:apiBaseUrl', 'https://server.example');
    await flushMicrotasks();

    expect(backing.get('playarr:session')).toBe('{"accessToken":"a"}');
    expect(backing.get('playarr:deviceId')).toBe('device-1');
    expect(backing.get('playarr:apiBaseUrl')).toBe('https://server.example');

    resetLocalStorageShimForTests();
    await hydrateLocalStorage(fake);
    expect(globalThis.localStorage.getItem('playarr:session')).toBe('{"accessToken":"a"}');
  });

  it('never hydrates a key outside the streamarr:/playarr. allowlist', async () => {
    const {fake} = createFakeAsyncStorage({
      'some-other-library-key': 'should not appear',
    });

    await hydrateLocalStorage(fake);

    expect(globalThis.localStorage.getItem('some-other-library-key')).toBeNull();
  });

  it('is idempotent: a second hydrate call does not clobber writes made since the first', async () => {
    const {fake} = createFakeAsyncStorage({'streamarr:deviceId': 'device-1'});

    await hydrateLocalStorage(fake);
    globalThis.localStorage.setItem('streamarr:deviceId', 'device-2');
    await hydrateLocalStorage(fake); // second call, same fake -- must be a no-op

    expect(globalThis.localStorage.getItem('streamarr:deviceId')).toBe('device-2');
  });

  it('setItem writes through to AsyncStorage for an allowlisted key', async () => {
    const {fake, backing} = createFakeAsyncStorage();
    await hydrateLocalStorage(fake);

    globalThis.localStorage.setItem('streamarr:apiBaseUrl', 'http://192.168.1.20:8484');
    await flushMicrotasks();

    expect(backing.get('streamarr:apiBaseUrl')).toBe('http://192.168.1.20:8484');
  });

  it('setItem does NOT write through to AsyncStorage for a non-allowlisted key', async () => {
    const {fake, backing, calls} = createFakeAsyncStorage();
    await hydrateLocalStorage(fake);

    globalThis.localStorage.setItem('some-scratch-key', 'ephemeral');
    await flushMicrotasks();

    expect(globalThis.localStorage.getItem('some-scratch-key')).toBe('ephemeral');
    expect(backing.has('some-scratch-key')).toBe(false);
    expect(calls.setItem).toBe(0);
  });

  it('removeItem deletes from the Map immediately and write-behinds the deletion', async () => {
    const {fake, backing} = createFakeAsyncStorage({'streamarr:session': 'stale'});
    await hydrateLocalStorage(fake);

    globalThis.localStorage.removeItem('streamarr:session');
    expect(globalThis.localStorage.getItem('streamarr:session')).toBeNull();

    await flushMicrotasks();
    expect(backing.has('streamarr:session')).toBe(false);
  });

  it('clear() empties every key and write-behinds a removal for each allowlisted one', async () => {
    const {fake, backing, calls} = createFakeAsyncStorage({
      'streamarr:session': 'a',
      'playarr.currentUserName': 'b',
    });
    await hydrateLocalStorage(fake);

    globalThis.localStorage.clear();
    await flushMicrotasks();

    expect(globalThis.localStorage.length).toBe(0);
    expect(backing.size).toBe(0);
    expect(calls.removeItem).toBe(2);
  });

  it('key() and length reflect the current Map contents', async () => {
    const {fake} = createFakeAsyncStorage({
      'streamarr:session': 'a',
      'playarr.currentUserName': 'b',
    });
    await hydrateLocalStorage(fake);

    expect(globalThis.localStorage.length).toBe(2);
    const keys = [globalThis.localStorage.key(0), globalThis.localStorage.key(1)];
    expect(keys.sort()).toEqual(['playarr.currentUserName', 'streamarr:session']);
    expect(globalThis.localStorage.key(2)).toBeNull();
  });

  it('logs rather than throws when a write-behind rejects', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const {fake} = createFakeAsyncStorage();
    await hydrateLocalStorage(fake);
    fake.setItem = async () => {
      throw new Error('AsyncStorage is full');
    };

    expect(() => globalThis.localStorage.setItem('streamarr:session', 'x')).not.toThrow();
    await flushMicrotasks();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('streamarr:session'),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });
});
