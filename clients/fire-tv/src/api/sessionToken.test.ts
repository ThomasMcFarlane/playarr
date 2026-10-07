import {TransientAuthError, type TokenStore} from '@playarr-tv/device-auth';
import type {ApiClient} from '@playarr-tv/api-client';
import {createSessionTokenProvider} from './sessionToken';

const client = {} as ApiClient;
const session = {accessToken: 'stored', refreshToken: 'r', tokenType: 'Bearer', expiresAt: 1};

function deps(overrides: {stored?: typeof session | undefined; ensure?: jest.Mock; onAuthFailed?: jest.Mock}) {
  const store = {get: () => ('stored' in overrides ? overrides.stored : session)} as unknown as TokenStore;
  return {
    store,
    getClient: () => client,
    onAuthFailed: overrides.onAuthFailed ?? jest.fn(),
    ensure: overrides.ensure ?? jest.fn().mockResolvedValue('fresh'),
  };
}

describe('createSessionTokenProvider', () => {
  it('sends no token when the device holds no session', async () => {
    const ensure = jest.fn();
    const get = createSessionTokenProvider(deps({stored: undefined, ensure}));
    await expect(get()).resolves.toBeUndefined();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('asks for a valid token, passing a rejected one through as a forced refresh', async () => {
    const ensure = jest.fn().mockResolvedValue('fresh');
    const get = createSessionTokenProvider(deps({ensure}));
    await expect(get()).resolves.toBe('fresh');
    await expect(get({forceRefresh: true, rejectedAccessToken: 'stored'})).resolves.toBe('fresh');
    expect(ensure).toHaveBeenLastCalledWith(client, expect.anything(), {forceRefresh: true, rejectedAccessToken: 'stored'});
  });

  it('keeps the session and sends the stored token when only the network failed', async () => {
    const onAuthFailed = jest.fn();
    const get = createSessionTokenProvider(deps({ensure: jest.fn().mockRejectedValue(new TransientAuthError('offline')), onAuthFailed}));
    await expect(get()).resolves.toBe('stored');
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  it('reports a dead session once renewal is refused everywhere', async () => {
    const onAuthFailed = jest.fn();
    const get = createSessionTokenProvider(deps({ensure: jest.fn().mockRejectedValue(new Error('refused')), onAuthFailed}));
    await expect(get()).resolves.toBeUndefined();
    expect(onAuthFailed).toHaveBeenCalledTimes(1);
  });
});
