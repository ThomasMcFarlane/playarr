import {profileAvatarScope, readStoredAvatar, subscribeProfileAvatars, syncAvatarPreset, writeAvatarPreset} from './profileAvatarPref';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe('profile avatar store', () => {
  beforeEach(() => {
    (globalThis as unknown as {localStorage: Storage}).localStorage = memoryStorage();
  });

  it('keeps a preset per profile and tells subscribers', () => {
    const scope = profileAvatarScope('https://server.example/', 'u1');
    const heard = jest.fn();
    const stop = subscribeProfileAvatars(heard);
    writeAvatarPreset(scope, 'cat');
    expect(readStoredAvatar(scope)).toEqual({kind: 'preset', preset: 'cat'});
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it('shows the custom photo saved to the profile on another device', async () => {
    const client = {getProfileAvatar: async () => ({preference: {kind: 'custom', value: JPEG}})};
    await syncAvatarPreset(client as never, 'https://server.example', 'u1');
    expect(readStoredAvatar(profileAvatarScope('https://server.example', 'u1'))).toEqual({kind: 'custom', dataUrl: JPEG});
  });

  it('ignores a custom photo that is not a JPEG data URL', async () => {
    const client = {getProfileAvatar: async () => ({preference: {kind: 'custom', value: 'https://elsewhere.example/a.jpg'}})};
    await syncAvatarPreset(client as never, 'https://server.example', 'u1');
    expect(readStoredAvatar(profileAvatarScope('https://server.example', 'u1'))).toBeUndefined();
  });
});
