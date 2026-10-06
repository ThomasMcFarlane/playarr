/**
 * Mirrors `clients/tv-web/web/src/lib/hostedDeviceLink.test.ts`'s own cases
 * for `requestHostedDeviceLink`/`pollHostedDeviceLink` -- same fetch/now/wait
 * injection pattern (no real timers, no real network), same assertions
 * against the wire shape -- translated from vitest's `vi.fn`/`vi.stubGlobal`
 * to jest's equivalents, and with the approver-side cases
 * (`inspectHostedLink`/`authoriseHostedLink`) dropped, since this file does
 * not port those functions at all (see `hostedLink.ts`'s own top comment
 * for why: no TV client ever acts as the approver).
 */
import {
  pollHostedDeviceLink,
  requestFireTvHostedLinkCode,
  requestHostedDeviceLink,
  type HostedLinkCode,
} from './hostedLink';

describe('hosted device linking (Fire TV)', () => {
  it.each(['tv-webos', 'tv-tizen', 'tv-vidaa', 'tv-fire'] as const)(
    'requests a first-contact code for packaged %s clients',
    async (clientPlatform) => {
      const fetch = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            device_code: 'hosted-secret',
            user_code: 'ABCD-2345',
            verification_uri: 'https://playarr.app/link',
            verification_uri_complete: 'https://playarr.app/link?user_code=ABCD-2345',
            expires_in: 600,
            interval: 2,
          }),
          {status: 200}
        )
      );

      const code = await requestHostedDeviceLink(clientPlatform, {
        fetchImpl: fetch as typeof globalThis.fetch,
        now: () => 1_000,
      });

      expect(code).toMatchObject({
        deviceCode: 'hosted-secret',
        userCode: 'ABCD-2345',
        expiresAt: 601_000,
      });
      const requestInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(requestInit?.body))).toEqual({
        client_platform: clientPlatform,
      });
      // The hosted origin comes from APP_CONFIG, not a second hard-coded
      // literal -- see hostedLink.ts's own top comment for why that matters.
      expect(fetch.mock.calls[0]?.[0]).toBe('https://playarr.app/api/link/code');
    }
  );

  it("requestFireTvHostedLinkCode always sends this app's own platform identity ('tv-fire')", async () => {
    const fetch = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          device_code: 'hosted-secret',
          user_code: 'ABCD-2345',
          verification_uri: 'https://playarr.app/link',
          verification_uri_complete: 'https://playarr.app/link?user_code=ABCD-2345',
          expires_in: 600,
          interval: 2,
        }),
        {status: 200}
      )
    );

    await requestFireTvHostedLinkCode({fetchImpl: fetch as typeof globalThis.fetch, now: () => 0});

    const requestInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body))).toEqual({client_platform: 'tv-fire'});
  });

  it('rejects a non-OK first-contact response with the HTTP status in the message', async () => {
    const fetch = jest.fn(async () => new Response(null, {status: 503}));

    await expect(
      requestHostedDeviceLink('tv-fire', {fetchImpl: fetch as typeof globalThis.fetch})
    ).rejects.toThrow('Playarr linking is unavailable (HTTP 503).');
  });

  it('polls the hosted broker until it returns the selected Streamarr server', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({error: 'authorization_pending'}), {status: 202}))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user_code: 'ABCD-2345',
            server_url: 'http://playarr.lan:8484',
            server_device_code: 'server-device-secret',
            server_urls: ['http://playarr.lan:8484'],
          }),
          {status: 200}
        )
      );
    const wait = jest.fn(async () => undefined);

    await expect(
      pollHostedDeviceLink(
        {
          deviceCode: 'hosted-secret',
          userCode: 'ABCD-2345',
          verificationUri: 'https://playarr.app/link',
          verificationUriComplete: 'https://playarr.app/link?user_code=ABCD-2345',
          expiresInSeconds: 600,
          intervalSeconds: 2,
          expiresAt: 601_000,
        },
        {
          fetchImpl: fetch as typeof globalThis.fetch,
          now: () => 1_000,
          wait,
        }
      )
    ).resolves.toMatchObject({
      server_url: 'http://playarr.lan:8484',
      server_device_code: 'server-device-secret',
    });
    expect(wait).toHaveBeenCalledTimes(2);
    // Sleeps the code's own interval before every poll -- never hammers the
    // broker immediately after the code was issued.
    expect(wait).toHaveBeenNthCalledWith(1, 2_000, undefined);
  });

  it('reports an expired code once the deadline passes with no claim', async () => {
    const fetch = jest.fn(async () => new Response(JSON.stringify({error: 'authorization_pending'}), {status: 202}));
    const wait = jest.fn(async () => undefined);
    let now = 599_000;

    await expect(
      pollHostedDeviceLink(
        {
          deviceCode: 'hosted-secret',
          userCode: 'ABCD-2345',
          verificationUri: 'https://playarr.app/link',
          verificationUriComplete: 'https://playarr.app/link?user_code=ABCD-2345',
          expiresInSeconds: 600,
          intervalSeconds: 2,
          expiresAt: 600_000,
        },
        {
          fetchImpl: fetch as typeof globalThis.fetch,
          now: () => {
            const current = now;
            now += 2_000;
            return current;
          },
          wait,
        }
      )
    ).rejects.toThrow('That Playarr link code expired. Try again.');
  });

  it('treats a 404 from the broker as an expired code, even before the deadline', async () => {
    const fetch = jest.fn(async () => new Response(null, {status: 404}));
    const wait = jest.fn(async () => undefined);

    await expect(
      pollHostedDeviceLink(
        {
          deviceCode: 'hosted-secret',
          userCode: 'ABCD-2345',
          verificationUri: 'https://playarr.app/link',
          verificationUriComplete: 'https://playarr.app/link?user_code=ABCD-2345',
          expiresInSeconds: 600,
          intervalSeconds: 2,
          expiresAt: 601_000,
        },
        {fetchImpl: fetch as typeof globalThis.fetch, now: () => 1_000, wait}
      )
    ).rejects.toThrow('That Playarr link code expired. Try again.');
  });

  it('rejects a claim missing required fields as an invalid TV link response', async () => {
    const fetch = jest.fn(async () => new Response(JSON.stringify({server_url: 'http://playarr.lan:8484'}), {status: 200}));
    const wait = jest.fn(async () => undefined);

    await expect(
      pollHostedDeviceLink(
        {
          deviceCode: 'hosted-secret',
          userCode: 'ABCD-2345',
          verificationUri: 'https://playarr.app/link',
          verificationUriComplete: 'https://playarr.app/link?user_code=ABCD-2345',
          expiresInSeconds: 600,
          intervalSeconds: 2,
          expiresAt: 601_000,
        },
        {fetchImpl: fetch as typeof globalThis.fetch, now: () => 1_000, wait}
      )
    ).rejects.toThrow('Playarr returned an invalid TV link response.');
  });

  it('forwards the AbortSignal to both the wait and the fetch call', async () => {
    const controller = new AbortController();
    const fetch = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          user_code: 'ABCD-2345',
          server_url: 'http://playarr.lan:8484',
          server_device_code: 'server-device-secret',
          server_urls: ['http://playarr.lan:8484'],
        }),
        {status: 200}
      )
    );
    const wait = jest.fn(async () => undefined);
    const code: HostedLinkCode = {
      deviceCode: 'hosted-secret',
      userCode: 'ABCD-2345',
      verificationUri: 'https://playarr.app/link',
      verificationUriComplete: 'https://playarr.app/link?user_code=ABCD-2345',
      expiresInSeconds: 600,
      intervalSeconds: 2,
      expiresAt: 601_000,
    };

    await pollHostedDeviceLink(code, {
      fetchImpl: fetch as typeof globalThis.fetch,
      now: () => 1_000,
      wait,
      signal: controller.signal,
    });

    expect(wait).toHaveBeenCalledWith(2_000, controller.signal);
    const requestInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit?.signal).toBe(controller.signal);
  });
});
