import {profileAvatarScope, readStoredAvatar, storedAvatarFromRemote, syncAvatar} from './profileAvatarPref';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function clientReturning(preference: unknown) {
  return {getProfileAvatar: jest.fn().mockResolvedValue({preference})} as never;
}

describe('profile avatar cache', () => {
  const scope = profileAvatarScope('https://server.example/', 'user-1');

  it('maps the server preference: preset ids and JPEG data URLs only', () => {
    expect(storedAvatarFromRemote({kind: 'preset', value: 'alien'})).toEqual({kind: 'preset', preset: 'alien'});
    expect(storedAvatarFromRemote({kind: 'custom', value: JPEG})).toEqual({kind: 'custom', dataUrl: JPEG});
    expect(storedAvatarFromRemote({kind: 'preset', value: 'unicorn'})).toBeUndefined();
    expect(storedAvatarFromRemote({kind: 'custom', value: 'https://example.com/a.jpg'})).toBeUndefined();
    expect(storedAvatarFromRemote(null)).toBeUndefined();
  });

  it('adopts a custom server preference, replacing a stale local preset', async () => {
    await syncAvatar(clientReturning({kind: 'preset', value: 'alien'}), 'https://server.example', 'user-1');
    expect(readStoredAvatar(scope)).toEqual({kind: 'preset', preset: 'alien'});
    await syncAvatar(clientReturning({kind: 'custom', value: JPEG}), 'https://server.example', 'user-1');
    expect(readStoredAvatar(scope)).toEqual({kind: 'custom', dataUrl: JPEG});
  });

  it('clears the cache when the account has no preference, so the id-hash default shows', async () => {
    await syncAvatar(clientReturning({kind: 'custom', value: JPEG}), 'https://server.example', 'user-1');
    await syncAvatar(clientReturning(null), 'https://server.example', 'user-1');
    expect(readStoredAvatar(scope)).toBeUndefined();
  });
});
