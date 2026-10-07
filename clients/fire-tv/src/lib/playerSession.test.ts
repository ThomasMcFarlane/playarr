import {clearActivePlayerSession, readActivePlayerSession, writeActivePlayerSession} from './playerSession';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

describe('active player session', () => {
  it('round-trips a session for the same profile', () => {
    const storage = createMemoryStorage();
    writeActivePlayerSession('user-1', {mediaFileId: 'media-1', startPositionSeconds: 42.5, title: 'Episode 3'}, storage);

    expect(readActivePlayerSession('user-1', storage)).toEqual({
      mediaFileId: 'media-1',
      startPositionSeconds: 42.5,
      title: 'Episode 3',
    });
  });

  it('does not resurface a session written for a different profile', () => {
    const storage = createMemoryStorage();
    writeActivePlayerSession('user-1', {mediaFileId: 'media-1'}, storage);

    expect(readActivePlayerSession('user-2', storage)).toBeNull();
  });

  it('treats a signed-out session (userId undefined) as its own scope', () => {
    const storage = createMemoryStorage();
    writeActivePlayerSession(undefined, {mediaFileId: 'media-1'}, storage);

    expect(readActivePlayerSession(undefined, storage)).toEqual({mediaFileId: 'media-1', startPositionSeconds: undefined, title: undefined});
    expect(readActivePlayerSession('user-1', storage)).toBeNull();
  });

  it('ignores corrupt cached data', () => {
    const storage = createMemoryStorage();
    storage.setItem('playarr.activePlayerSession.v1', '{not json');

    expect(readActivePlayerSession('user-1', storage)).toBeNull();
  });

  it('ignores a value missing a mediaFileId', () => {
    const storage = createMemoryStorage();
    storage.setItem('playarr.activePlayerSession.v1', JSON.stringify({userId: 'user-1'}));

    expect(readActivePlayerSession('user-1', storage)).toBeNull();
  });

  it('clearActivePlayerSession removes whatever was persisted', () => {
    const storage = createMemoryStorage();
    writeActivePlayerSession('user-1', {mediaFileId: 'media-1'}, storage);

    clearActivePlayerSession(storage);

    expect(readActivePlayerSession('user-1', storage)).toBeNull();
  });

  it('treats a missing storage as "nothing persisted" rather than throwing', () => {
    expect(() => writeActivePlayerSession('user-1', {mediaFileId: 'media-1'}, undefined)).not.toThrow();
    expect(readActivePlayerSession('user-1', undefined)).toBeNull();
    expect(() => clearActivePlayerSession(undefined)).not.toThrow();
  });

  it('falls back to globalThis.localStorage when no storage is passed explicitly', () => {
    const fake = createMemoryStorage();
    (globalThis as {localStorage?: Storage}).localStorage = fake;

    writeActivePlayerSession('user-1', {mediaFileId: 'media-1'});

    expect(readActivePlayerSession('user-1')).toEqual({mediaFileId: 'media-1', startPositionSeconds: undefined, title: undefined});

    delete (globalThis as {localStorage?: Storage}).localStorage;
  });
});
