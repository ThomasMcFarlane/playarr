import {attachAuth, AUTH_STRATEGY} from './authTransport';

describe('attachAuth', () => {
  it('attaches a bearer header when a token is available (the default AUTH_STRATEGY)', async () => {
    expect(AUTH_STRATEGY).toBe('bearer-header');
    const headers: Record<string, string> = {};

    await attachAuth(headers, {kind: 'manifest', getAccessToken: () => 'token-123'});

    expect(headers).toEqual({Authorization: 'Bearer token-123'});
  });

  it('supports an async getAccessToken (e.g. a token refresh in flight)', async () => {
    const headers: Record<string, string> = {};

    await attachAuth(headers, {
      kind: 'segment',
      getAccessToken: () => Promise.resolve('refreshed-token'),
    });

    expect(headers).toEqual({Authorization: 'Bearer refreshed-token'});
  });

  it('leaves headers untouched when no token is available yet', async () => {
    const headers: Record<string, string> = {};

    await attachAuth(headers, {kind: 'license', getAccessToken: () => undefined});

    expect(headers).toEqual({});
  });

  it('preserves headers already set by the caller', async () => {
    const headers: Record<string, string> = {'X-Custom': 'value'};

    await attachAuth(headers, {kind: 'manifest', getAccessToken: () => 'token-123'});

    expect(headers).toEqual({'X-Custom': 'value', Authorization: 'Bearer token-123'});
  });

  it('never uses the session-cookie strategy for a subtitle request, even if AUTH_STRATEGY were flipped', async () => {
    const headers: Record<string, string> = {};

    // Simulates AUTH_STRATEGY having been flipped to 'session-cookie' --
    // subtitle requests are plain JS fetch() calls with no platform
    // limitation on Authorization, so they must never lose their bearer
    // token to a cookie strategy meant for pipelines that cannot set headers.
    await attachAuth(headers, {
      kind: 'subtitle',
      getAccessToken: () => 'token-123',
      sessionId: 'session-abc',
    });

    expect(headers).toEqual({Authorization: 'Bearer token-123'});
  });

  it('falls back to bearer-header when no sessionId has been negotiated yet, regardless of strategy', async () => {
    const headers: Record<string, string> = {};

    await attachAuth(headers, {
      kind: 'manifest',
      getAccessToken: () => 'token-123',
      sessionId: null,
    });

    expect(headers).toEqual({Authorization: 'Bearer token-123'});
  });
});
