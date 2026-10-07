/**
 * Every case exercises this module purely through a fake `ApiClient`-shaped
 * object (injected, per this task's brief -- not real timers, not real
 * network) -- the same "structural type + fake" pattern
 * `localStorageShim.test.ts` uses for `AsyncStorageLike`.
 */
import type {ApiClient} from '@playarr-tv/api-client';
import {findCurrentProfile, listViewerProfiles, toViewerProfile, verifyProfilePin} from './profiles';

describe('toViewerProfile', () => {
  it("trusts the server's own is_current flag when set", () => {
    const profile = toViewerProfile(
      {id: 'user-1', username: 'alex', display_name: 'Alex', is_current: true, pin_locked: false},
      'user-2'
    );
    expect(profile.isCurrent).toBe(true);
  });

  it('backfills is_current from the decoded access-token user id when the server flag is false', () => {
    const profile = toViewerProfile(
      {id: 'user-1', username: 'alex', display_name: 'Alex', is_current: false, pin_locked: false},
      'user-1'
    );
    expect(profile.isCurrent).toBe(true);
  });

  it('is not current when neither the server flag nor the id match', () => {
    const profile = toViewerProfile(
      {id: 'user-1', username: 'alex', display_name: 'Alex', is_current: false, pin_locked: false},
      'user-2'
    );
    expect(profile.isCurrent).toBe(false);
  });

  it('falls back to username when display_name is empty', () => {
    const profile = toViewerProfile(
      {id: 'user-1', username: 'alex', display_name: '', is_current: false, pin_locked: false},
      undefined
    );
    expect(profile.displayName).toBe('alex');
  });

  it('carries pin_locked through unchanged', () => {
    const profile = toViewerProfile(
      {id: 'user-1', username: 'alex', display_name: 'Alex', is_current: false, pin_locked: true},
      undefined
    );
    expect(profile.pinLocked).toBe(true);
  });
});

describe('listViewerProfiles', () => {
  it('fetches and maps every available profile', async () => {
    const listAvailableProfiles = jest.fn(async () => [
      {id: 'user-1', username: 'alex', display_name: 'Alex', is_current: true, pin_locked: false},
      {id: 'user-2', username: 'kid', display_name: '', is_current: false, pin_locked: true},
    ]);
    const client = {listAvailableProfiles} as unknown as ApiClient;

    const profiles = await listViewerProfiles(client, 'user-1');

    expect(listAvailableProfiles).toHaveBeenCalledTimes(1);
    expect(profiles).toEqual([
      {id: 'user-1', username: 'alex', displayName: 'Alex', isCurrent: true, pinLocked: false},
      {id: 'user-2', username: 'kid', displayName: 'kid', isCurrent: false, pinLocked: true},
    ]);
  });
});

describe('findCurrentProfile', () => {
  it('returns the profile marked current', () => {
    const profiles = [
      {id: 'a', username: 'a', displayName: 'A', isCurrent: false, pinLocked: false},
      {id: 'b', username: 'b', displayName: 'B', isCurrent: true, pinLocked: false},
    ];
    expect(findCurrentProfile(profiles)?.id).toBe('b');
  });

  it('returns undefined when nothing is current', () => {
    const profiles = [{id: 'a', username: 'a', displayName: 'A', isCurrent: false, pinLocked: false}];
    expect(findCurrentProfile(profiles)).toBeUndefined();
  });
});

describe('verifyProfilePin', () => {
  it('resolves true when the server confirms the PIN', async () => {
    const verifyProfilePinCall = jest.fn(async () => ({verified: true}));
    const client = {verifyProfilePin: verifyProfilePinCall} as unknown as ApiClient;

    await expect(verifyProfilePin(client, 'user-2', '1234')).resolves.toBe(true);
    expect(verifyProfilePinCall).toHaveBeenCalledWith('user-2', {pin: '1234'});
  });

  it('resolves false when the server rejects the PIN', async () => {
    const client = {verifyProfilePin: jest.fn(async () => ({verified: false}))} as unknown as ApiClient;

    await expect(verifyProfilePin(client, 'user-2', '0000')).resolves.toBe(false);
  });
});
