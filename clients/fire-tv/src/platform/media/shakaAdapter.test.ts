/**
 * Covers exactly the parts of this file that do not require a real Shaka
 * runtime object to exercise meaningfully: reading `globalThis.shaka`, and
 * the auth-request-filter's own header-attachment logic against a small
 * fake `ShakaPlayerLike`/`ShakaNamespace` pair. `createShakaPlayer` and
 * `configureShakaForHls` are one-line pass-throughs to a real Shaka
 * instance's own methods and are not separately tested here for the same
 * reason `remote.ts`/`lifecycle.ts` are not (see those files' own doc
 * comments) -- there is no real Shaka-for-Vega instance available in this
 * environment to construct one against (this file's own top comment).
 */
import {registerAuthRequestFilter, resolveShakaNamespace, type ShakaNamespace, type ShakaRequest} from './shakaAdapter';

describe('resolveShakaNamespace', () => {
  afterEach(() => {
    delete (globalThis as {shaka?: unknown}).shaka;
  });

  it('returns undefined when the Shaka-for-Vega tarball has never registered a global', () => {
    expect(resolveShakaNamespace()).toBeUndefined();
  });

  it('returns whatever is installed at globalThis.shaka', () => {
    const fakeShaka = {} as ShakaNamespace;
    (globalThis as {shaka?: unknown}).shaka = fakeShaka;

    expect(resolveShakaNamespace()).toBe(fakeShaka);
  });
});

function fakeShakaNamespace(): ShakaNamespace {
  return {
    Player: class {} as unknown as ShakaNamespace['Player'],
    net: {NetworkingEngine: {RequestType: {MANIFEST: 0, SEGMENT: 1, LICENSE: 2}}},
  };
}

describe('registerAuthRequestFilter', () => {
  it('attaches a bearer header to MANIFEST, SEGMENT and LICENSE requests', async () => {
    const shaka = fakeShakaNamespace();
    let capturedFilter: ((type: number, request: ShakaRequest) => void | Promise<void>) | undefined;
    const player = {
      getNetworkingEngine: () => ({
        registerRequestFilter: (filter: typeof capturedFilter) => {
          capturedFilter = filter;
        },
      }),
    } as unknown as Parameters<typeof registerAuthRequestFilter>[0];

    registerAuthRequestFilter(player, shaka, () => 'token-123', () => null);
    expect(capturedFilter).toBeDefined();

    for (const type of [shaka.net.NetworkingEngine.RequestType.MANIFEST, shaka.net.NetworkingEngine.RequestType.SEGMENT, shaka.net.NetworkingEngine.RequestType.LICENSE]) {
      const request: ShakaRequest = {uris: ['https://example.test/x'], headers: {}};
      await capturedFilter?.(type, request);
      expect(request.headers).toEqual({Authorization: 'Bearer token-123'});
    }
  });

  it('leaves an unrelated request type untouched', async () => {
    const shaka = fakeShakaNamespace();
    let capturedFilter: ((type: number, request: ShakaRequest) => void | Promise<void>) | undefined;
    const player = {
      getNetworkingEngine: () => ({
        registerRequestFilter: (filter: typeof capturedFilter) => {
          capturedFilter = filter;
        },
      }),
    } as unknown as Parameters<typeof registerAuthRequestFilter>[0];

    registerAuthRequestFilter(player, shaka, () => 'token-123', () => null);
    const request: ShakaRequest = {uris: ['https://example.test/x'], headers: {}};

    await capturedFilter?.(99, request);

    expect(request.headers).toEqual({});
  });

  it('does nothing when the player has no networking engine yet', () => {
    const shaka = fakeShakaNamespace();
    const player = {getNetworkingEngine: () => null} as unknown as Parameters<typeof registerAuthRequestFilter>[0];

    expect(() => registerAuthRequestFilter(player, shaka, () => 'token-123', () => null)).not.toThrow();
  });
});
