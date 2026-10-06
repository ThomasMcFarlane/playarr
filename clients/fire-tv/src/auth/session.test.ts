/**
 * `publicIpv4RelayUrl` is exercised as pure input/output, mirroring how
 * `loginServerUrl.test.ts` tests the original on tv-web. `commitLinkedSession`
 * and `ensureFireTvAccessToken` touch real `localStorage`-backed state
 * (`TokenStore`, `@playarr-tv/domain`'s known-server group), so those
 * cases hydrate the same in-memory `localStorageShim` fake
 * `localStorageShim.test.ts` uses, rather than mocking `TokenStore` itself
 * -- exercising the REAL storage path is the whole point (design doc §4.6's
 * "session lost on every app restart" failure mode is exactly what silently
 * breaks if these two disagree). `completeServerDeviceLink` is exercised
 * against a stubbed `globalThis.fetch` (no real network, no timers) rather
 * than an injected `fetchImpl`, because `../api/client.ts`'s
 * `createApiClient` -- which this function calls internally, deliberately
 * un-parameterised on `fetchImpl` since production never needs to override
 * it -- always resolves to RN's global `fetch`.
 */
import type {ApiClient} from '@playarr-tv/api-client';
import type {DeviceTokenSuccess} from '@playarr-tv/device-auth';
import {readKnownServers} from '@playarr-tv/domain';
import {TokenStore} from '@playarr-tv/device-auth';
import {
  hydrateLocalStorage,
  resetLocalStorageShimForTests,
  type AsyncStorageLike,
} from '../platform/storage/localStorageShim';
import type {HostedLinkClaim, HostedLinkCode} from './hostedLink';
import {commitLinkedSession, completeServerDeviceLink, ensureFireTvAccessToken, publicIpv4RelayUrl} from './session';

/** Minimal in-memory stand-in for the real AsyncStorage default export -- same shape `localStorageShim.test.ts` uses. */
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

/**
 * A JWT-shaped (but unsigned, never verified anywhere client-side) access
 * token carrying exactly the claims `decodeAccessTokenUserId`/
 * `decodeAccessTokenDeviceId` read. `btoa` (installed by
 * `src/bootstrap/polyfills.ts`, imported by `jest.setup.ts`) stands in for
 * the base64url encoding a real token would use -- close enough, since
 * `decodeAccessTokenStringClaim`'s own `base64UrlDecode` only ever swaps
 * `-`/`_` back to `+`/`/` before decoding, and plain `btoa` output never
 * contains the URL-unsafe characters that would matter here.
 */
function fakeAccessToken(claims: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(claims))}.signature`;
}

const CLAIM: HostedLinkClaim = {
  user_code: 'ABCD-2345',
  server_url: 'http://playarr.lan:8484',
  server_device_code: 'server-device-secret',
  server_urls: ['http://playarr.lan:8484'],
};

const HOSTED_CODE: HostedLinkCode = {
  deviceCode: 'hosted-secret',
  userCode: 'ABCD-2345',
  verificationUri: 'https://playarr.app/link',
  verificationUriComplete: 'https://playarr.app/link?user_code=ABCD-2345',
  expiresInSeconds: 600,
  intervalSeconds: 2,
  expiresAt: Date.now() + 600_000,
};

describe('publicIpv4RelayUrl', () => {
  it('rewrites a public IPv4 address onto the encoded relay hostname, defaulting to the Streamarr port', () => {
    expect(publicIpv4RelayUrl('http://8.8.8.8:8484')).toBe('https://v4-8-8-8-8.relay.playarr.app:8484');
  });

  it('preserves a path, query and hash across the rewrite', () => {
    expect(publicIpv4RelayUrl('http://8.8.8.8:8484/api/v1?x=1#y')).toBe(
      'https://v4-8-8-8-8.relay.playarr.app:8484/api/v1?x=1#y'
    );
  });

  it('leaves a private LAN address unchanged', () => {
    expect(publicIpv4RelayUrl('http://192.168.1.20:8484')).toBe('http://192.168.1.20:8484');
  });

  it('leaves a loopback address unchanged', () => {
    expect(publicIpv4RelayUrl('http://127.0.0.1:8484')).toBe('http://127.0.0.1:8484');
  });

  it('leaves a hostname (not a bare IPv4 literal) unchanged', () => {
    expect(publicIpv4RelayUrl('https://streamarr.example.test')).toBe('https://streamarr.example.test');
  });

  it('is idempotent: rewriting an already-encoded relay hostname is a no-op', () => {
    const once = publicIpv4RelayUrl('http://8.8.8.8:8484');
    expect(publicIpv4RelayUrl(once)).toBe(once);
  });

  it('returns the original value unchanged for an unparseable input', () => {
    expect(publicIpv4RelayUrl('not a url at all::')).toBe('not a url at all::');
  });
});

describe('completeServerDeviceLink', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("redeems the claim's already-approved server device code, never re-requesting one", async () => {
    const fetch = jest.fn(async (input: Request) =>
      new Response(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'Bearer',
          expires_in: 900,
        }),
        {status: 200, headers: {'content-type': 'application/json'}}
      )
    );
    // Cast against `typeof originalFetch`, NOT `typeof fetch` -- `fetch` is
    // this block's own local `const`, shadowing the global, so `typeof
    // fetch` here would resolve to the mock's own type and make this cast a
    // silent no-op.
    globalThis.fetch = fetch as unknown as typeof originalFetch;

    const token = await completeServerDeviceLink(CLAIM, HOSTED_CODE);

    expect(token).toEqual({
      status: 'success',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresInSeconds: 900,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('http://playarr.lan:8484/api/v1/oauth/token');
    const body = JSON.parse(await request.clone().text()) as Record<string, unknown>;
    expect(body).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'server-device-secret',
    });
  });
});

describe('commitLinkedSession', () => {
  beforeEach(async () => {
    await hydrateLocalStorage(createFakeAsyncStorage());
  });

  afterEach(() => {
    resetLocalStorageShimForTests();
  });

  function successToken(overrides: Partial<Record<'sub' | 'device_id', string>> = {}): DeviceTokenSuccess {
    return {
      status: 'success',
      accessToken: fakeAccessToken({sub: 'user-1', device_id: 'device-1', ...overrides}),
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresInSeconds: 900,
    };
  }

  it('throws rather than storing a session with no usable identity', () => {
    const token: DeviceTokenSuccess = {
      status: 'success',
      accessToken: fakeAccessToken({}), // no sub, no device_id
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresInSeconds: 900,
    };

    expect(() => commitLinkedSession({token, claim: CLAIM, setApiBaseUrl: jest.fn()})).toThrow(
      'Playarr returned a device session with no usable identity.'
    );
  });

  it('points ApiClientProvider at the (relay-rewritten) primary server address', () => {
    const setApiBaseUrl = jest.fn();
    const claim: HostedLinkClaim = {...CLAIM, server_url: 'http://8.8.8.8:8484', server_urls: ['http://8.8.8.8:8484']};

    const result = commitLinkedSession({token: successToken(), claim, setApiBaseUrl});

    expect(result.apiBaseUrl).toBe('https://v4-8-8-8-8.relay.playarr.app:8484');
    expect(setApiBaseUrl).toHaveBeenCalledWith('https://v4-8-8-8-8.relay.playarr.app:8484');
  });

  it('calls setApiBaseUrl BEFORE writing the session -- reversing this order would silently wipe the session (see session.ts doc comment)', () => {
    const callOrder: string[] = [];
    const setApiBaseUrl = jest.fn(() => {
      callOrder.push('setApiBaseUrl');
      // Faithful to the real ApiClientProvider.setApiBaseUrl: clears any
      // existing session as a side effect of pointing at a new server.
      new TokenStore().clear();
    });

    commitLinkedSession({token: successToken(), claim: CLAIM, setApiBaseUrl});
    callOrder.push('assert');

    expect(callOrder).toEqual(['setApiBaseUrl', 'assert']);
    // The session written AFTER setApiBaseUrl's clear() must have survived.
    expect(new TokenStore().get()?.accessToken).toBe(successToken().accessToken);
  });

  it('stores the resulting session in TokenStore', () => {
    const token = successToken();
    commitLinkedSession({token, claim: CLAIM, setApiBaseUrl: jest.fn()});

    const stored = new TokenStore().get();
    expect(stored).toMatchObject({
      accessToken: token.accessToken,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
    });
  });

  it('remembers every claimed server address as a KnownServerGroup, deduplicated, with lastGoodUrl set to the primary', () => {
    const claim: HostedLinkClaim = {
      ...CLAIM,
      server_url: 'http://playarr.lan:8484',
      server_urls: ['http://playarr.lan:8484', 'http://10.0.0.5:8484'],
    };

    const result = commitLinkedSession({token: successToken(), claim, setApiBaseUrl: jest.fn()});

    expect(result.serverUrls).toEqual(['http://playarr.lan:8484', 'http://10.0.0.5:8484']);
    expect(readKnownServers()).toEqual({
      groupId: undefined,
      groupName: undefined,
      servers: [{url: 'http://playarr.lan:8484'}, {url: 'http://10.0.0.5:8484'}],
      lastGoodUrl: 'http://playarr.lan:8484',
    });
  });
});

describe('ensureFireTvAccessToken', () => {
  beforeEach(async () => {
    await hydrateLocalStorage(createFakeAsyncStorage());
  });

  afterEach(() => {
    resetLocalStorageShimForTests();
  });

  it("passes the token's own embedded device_id claim as the identity, not a locally-generated one", async () => {
    const store = new TokenStore();
    store.set({
      accessToken: fakeAccessToken({sub: 'user-1', device_id: 'server-assigned-device-1'}),
      refreshToken: 'stale-refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1_000, // already expired -> forces the refresh branch
    });

    const refresh = jest.fn(async (body: {device_id: string; refresh_token: string}) => {
      expect(body.device_id).toBe('server-assigned-device-1');
      return {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        token_type: 'Bearer',
        expires_in: 900,
      };
    });
    const client = {refresh} as unknown as ApiClient;

    const accessToken = await ensureFireTvAccessToken(client, store);

    expect(accessToken).toBe('new-access-token');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('returns the still-valid stored access token without calling refresh at all', async () => {
    const store = new TokenStore();
    store.set({
      accessToken: fakeAccessToken({sub: 'user-1', device_id: 'device-1'}),
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const refresh = jest.fn();
    const client = {refresh} as unknown as ApiClient;

    await ensureFireTvAccessToken(client, store);

    expect(refresh).not.toHaveBeenCalled();
  });
});
