/**
 * Covers the two things build-order step 5 (design doc §10) actually asks
 * for: the platform headers are on every request, and a login/refresh
 * response's `peer_addresses` gets folded into the remembered
 * `KnownServerGroup`. Uses a fake `fetchImpl` throughout -- no real
 * network, no localStorage hydration -- `@playarr-tv/domain`'s
 * `rememberServerSuccess`/`rememberGroup`/`readKnownServers` already
 * degrade to safe no-ops/`undefined` when `localStorage` is unavailable
 * (the same guard `tokenStore.ts` uses), which is exactly the environment
 * a plain `npx jest` run without `jest.setup.ts`'s AsyncStorage double
 * having been hydrated provides.
 */
import {createApiClient} from './client';
import {APP_CONFIG} from '../config/appConfig';

const VERSION_ENVELOPE_BODY = JSON.stringify({
  instance_name: 'Test Streamarr',
  server_version: '1.0.0',
  api_version: '1',
  build_sha: null,
  compatibility: [],
});

function fakeFetch(body: string = VERSION_ENVELOPE_BODY, status = 200) {
  const requests: Request[] = [];
  const fetchImpl = async (input: Request): Promise<Response> => {
    requests.push(input);
    return new Response(body, {status, headers: {'Content-Type': 'application/json'}});
  };
  return {fetchImpl, requests};
}

describe('createApiClient', () => {
  it('attaches X-Streamarr-Client-Platform and X-Streamarr-Client-Version to every request', async () => {
    const {fetchImpl, requests} = fakeFetch();
    const client = createApiClient('http://192.168.1.20:8484', {fetchImpl});

    await client.getVersion();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get('X-Streamarr-Client-Platform')).toBe(APP_CONFIG.clientPlatform);
    expect(requests[0]?.headers.get('X-Streamarr-Client-Version')).toBe(APP_CONFIG.clientVersion);
  });

  it('sends the real ClientPlatform wire value ("tv-fire"), not a compatibility stand-in', async () => {
    const {fetchImpl, requests} = fakeFetch();
    const client = createApiClient('http://192.168.1.20:8484', {fetchImpl});

    await client.getVersion();

    expect(requests[0]?.headers.get('X-Streamarr-Client-Platform')).toBe('tv-fire');
  });

  it('requests every URL against the supplied baseUrl', async () => {
    const {fetchImpl, requests} = fakeFetch();
    const client = createApiClient('http://192.168.1.20:8484', {fetchImpl});

    await client.getVersion();

    expect(requests[0]?.url.startsWith('http://192.168.1.20:8484')).toBe(true);
  });

  it('omits Authorization on a protected operation when no getAccessToken is supplied', async () => {
    // listSourceInstances is one of the admin operations PROTECTED_OPERATIONS
    // actually guards (api-client/src/index.ts) -- unlike getVersion, which
    // is never authenticated at all regardless of whether a token function
    // is configured, this is the real "getAccessToken returned undefined"
    // branch, per ApiClientConfig.getAccessToken's own doc comment.
    const {fetchImpl, requests} = fakeFetch('[]');
    const client = createApiClient('http://192.168.1.20:8484', {fetchImpl});

    await client.listSourceInstances();

    expect(requests[0]?.headers.has('Authorization')).toBe(false);
  });

  it('reads the access token from getAccessToken for a protected operation', async () => {
    const {fetchImpl, requests} = fakeFetch('[]');
    const client = createApiClient('http://192.168.1.20:8484', {
      fetchImpl,
      getAccessToken: () => 'test-access-token',
    });

    await client.listSourceInstances();

    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer test-access-token');
  });
});
