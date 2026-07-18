import { describe, expect, it } from "vitest";
import {
  clearActivePlayerSession,
  hydrateActivePlayerSession,
  readActivePlayerSession,
  writeActivePlayerSession,
  type ActivePlayerSession,
} from "./playerSession";

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

const session: ActivePlayerSession = {
  mediaFileId: "media-1",
  locationState: {
    title: "Example title",
    backTo: "/movies/work-1",
  },
};

describe("active player session storage", () => {
  it("restores the playing item for the same user after a refresh", () => {
    const storage = createMemoryStorage();
    writeActivePlayerSession("user-1", session, storage);

    expect(readActivePlayerSession("user-1", storage)).toEqual(session);
  });

  it("hydrates a user-scoped session after authentication resolves", () => {
    const storage = createMemoryStorage();
    writeActivePlayerSession("user-1", session, storage);

    expect(readActivePlayerSession(undefined, storage)).toBeNull();
    expect(hydrateActivePlayerSession(null, "user-1", storage)).toEqual(session);
  });

  it("does not restore another user's playing item", () => {
    const storage = createMemoryStorage();
    writeActivePlayerSession("user-1", session, storage);

    expect(readActivePlayerSession("user-2", storage)).toBeNull();
  });

  it("ignores corrupt or incomplete stored state", () => {
    const storage = createMemoryStorage();
    storage.setItem("playarr.activePlayerSession.v1", '{"mediaFileId":42}');

    expect(readActivePlayerSession("user-1", storage)).toBeNull();
  });

  it("removes the stored item when playback is closed", () => {
    const storage = createMemoryStorage();
    writeActivePlayerSession("user-1", session, storage);
    clearActivePlayerSession(storage);

    expect(readActivePlayerSession("user-1", storage)).toBeNull();
  });
});
