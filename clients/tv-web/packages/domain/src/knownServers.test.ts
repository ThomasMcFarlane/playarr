import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetGroup,
  mergeKnownServerGroup,
  readKnownServers,
  rememberGroup,
  rememberServerSuccess,
  resolveReachableServer,
  type KnownServerGroup,
} from "./knownServers";
import type { PeerAddressBundleLike } from "./inviteUrl";

/** Matches `device-auth`'s `deviceId.test.ts`/`tokenStore.test.ts` convention for stubbing `localStorage` under vitest's default `node` environment (no DOM globals). */
function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readKnownServers", () => {
  it("returns undefined when nothing has been remembered", () => {
    expect(readKnownServers()).toBeUndefined();
  });

  it("returns undefined when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readKnownServers()).toBeUndefined();
  });

  it("returns undefined for a malformed stored value rather than throwing", () => {
    localStorage.setItem("streamarr:knownServerGroup", "{ not json");
    expect(readKnownServers()).toBeUndefined();
  });

  it("returns undefined when the stored value doesn't structurally match KnownServerGroup", () => {
    localStorage.setItem("streamarr:knownServerGroup", JSON.stringify({ servers: "not-an-array" }));
    expect(readKnownServers()).toBeUndefined();
  });

  it("round-trips a group written by rememberGroup", () => {
    const group: KnownServerGroup = {
      groupId: "group-1",
      groupName: "Home",
      servers: [{ url: "https://home.example.com" }, { url: "http://192.168.1.5:8484" }],
      lastGoodUrl: "https://home.example.com",
    };
    rememberGroup(group);
    expect(readKnownServers()).toEqual(group);
  });

  it("accepts a group with no groupId/groupName -- the standalone-server shape", () => {
    const group: KnownServerGroup = { servers: [{ url: "http://localhost:8484" }] };
    rememberGroup(group);
    expect(readKnownServers()).toEqual(group);
  });

  it("round-trips a server's peerNodeId attribution", () => {
    const group: KnownServerGroup = {
      groupId: "group-1",
      servers: [
        { url: "https://home.example.com", peerNodeId: "11111111-1111-4111-8111-111111111111" },
        { url: "https://east.example.com", peerNodeId: "22222222-2222-4222-8222-222222222222" },
      ],
    };
    rememberGroup(group);
    expect(readKnownServers()).toEqual(group);
  });

  it("returns undefined when a server's peerNodeId isn't a string", () => {
    localStorage.setItem(
      "streamarr:knownServerGroup",
      JSON.stringify({ servers: [{ url: "https://home.example.com", peerNodeId: 12345 }] })
    );
    expect(readKnownServers()).toBeUndefined();
  });
});

describe("mergeKnownServerGroup", () => {
  function bundle(
    addresses: ReadonlyArray<{ peer_node_id: string; url: string }>,
    groupId = "11111111-1111-4111-8111-111111111111",
    groupName = "Home Group"
  ): PeerAddressBundleLike {
    return { group_id: groupId, group_name: groupName, addresses };
  }

  it("folds a node-attributed bundle into a KnownServerGroup, preserving peerNodeId", () => {
    const result = mergeKnownServerGroup(
      bundle([
        { peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://home.example.com" },
        { peer_node_id: "22222222-2222-4222-8222-222222222222", url: "https://east.example.com" },
      ]),
      "https://home.example.com"
    );

    expect(result).toEqual({
      groupId: "11111111-1111-4111-8111-111111111111",
      groupName: "Home Group",
      servers: [
        { url: "https://home.example.com", peerNodeId: "11111111-1111-4111-8111-111111111111", lastSuccessAt: undefined },
        { url: "https://east.example.com", peerNodeId: "22222222-2222-4222-8222-222222222222", lastSuccessAt: undefined },
      ],
      lastGoodUrl: "https://home.example.com",
    });
  });

  it("promotes respondingUrl to lastGoodUrl", () => {
    const result = mergeKnownServerGroup(
      bundle([{ peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://east.example.com" }]),
      "https://east.example.com"
    );
    expect(result.lastGoodUrl).toBe("https://east.example.com");
  });

  it("preserves a still-listed address's prior lastSuccessAt", () => {
    rememberGroup({
      servers: [
        {
          url: "https://home.example.com",
          peerNodeId: "11111111-1111-4111-8111-111111111111",
          lastSuccessAt: 1000,
        },
      ],
    });

    const result = mergeKnownServerGroup(
      bundle([{ peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://home.example.com" }]),
      "https://home.example.com"
    );

    expect(result.servers[0]?.lastSuccessAt).toBe(1000);
  });

  it("builds a group from scratch (no lastSuccessAt anywhere) when nothing was remembered before", () => {
    const result = mergeKnownServerGroup(
      bundle([{ peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://home.example.com" }]),
      "https://home.example.com"
    );
    expect(result.servers[0]?.lastSuccessAt).toBeUndefined();
  });

  it("treats an empty-string peer_node_id (the no-real-attribution placeholder) as no attribution", () => {
    const result = mergeKnownServerGroup(
      bundle([{ peer_node_id: "", url: "https://home.example.com" }]),
      "https://home.example.com"
    );
    expect(result.servers[0]?.peerNodeId).toBeUndefined();
  });

  it("maps a null group_id/group_name to undefined, the standalone-node shape", () => {
    const result = mergeKnownServerGroup(
      {
        group_id: null,
        group_name: null,
        addresses: [{ peer_node_id: "11111111-1111-4111-8111-111111111111", url: "http://localhost:8484" }],
      },
      "http://localhost:8484"
    );
    expect(result.groupId).toBeUndefined();
    expect(result.groupName).toBeUndefined();
  });
});

describe("rememberServerSuccess", () => {
  it("is a no-op when no group is remembered yet", () => {
    rememberServerSuccess("https://home.example.com");
    expect(readKnownServers()).toBeUndefined();
  });

  it("bumps lastSuccessAt on the matching server and sets lastGoodUrl", () => {
    rememberGroup({
      servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }],
    });

    rememberServerSuccess("https://east.example.com");

    const group = readKnownServers();
    expect(group?.lastGoodUrl).toBe("https://east.example.com");
    const east = group?.servers.find((server) => server.url === "https://east.example.com");
    const home = group?.servers.find((server) => server.url === "https://home.example.com");
    expect(east?.lastSuccessAt).toEqual(expect.any(Number));
    expect(home?.lastSuccessAt).toBeUndefined();
  });

  it("promotes the successful url to lastGoodUrl (reordering priority) without reordering servers itself", () => {
    rememberGroup({
      servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }],
      lastGoodUrl: "https://home.example.com",
    });

    rememberServerSuccess("https://east.example.com");

    const group = readKnownServers();
    // lastGoodUrl now points at the newly-successful address...
    expect(group?.lastGoodUrl).toBe("https://east.example.com");
    // ...but the underlying priority-ordered servers list is untouched.
    expect(group?.servers.map((server) => server.url)).toEqual([
      "https://home.example.com",
      "https://east.example.com",
    ]);
  });

  it("still updates lastGoodUrl even when the url isn't found among servers", () => {
    rememberGroup({ servers: [{ url: "https://home.example.com" }] });
    rememberServerSuccess("https://unlisted.example.com");
    expect(readKnownServers()?.lastGoodUrl).toBe("https://unlisted.example.com");
  });

  it("is safe to call when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => rememberServerSuccess("https://home.example.com")).not.toThrow();
  });
});

describe("forgetGroup", () => {
  it("clears a remembered group", () => {
    rememberGroup({ servers: [{ url: "https://home.example.com" }] });
    expect(readKnownServers()).toBeDefined();
    forgetGroup();
    expect(readKnownServers()).toBeUndefined();
  });

  it("is safe to call when nothing is remembered", () => {
    expect(() => forgetGroup()).not.toThrow();
  });
});

describe("resolveReachableServer", () => {
  it("tries lastGoodUrl first and skips probing servers[] once it succeeds", async () => {
    const group: KnownServerGroup = {
      servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }],
      lastGoodUrl: "https://east.example.com",
    };
    const probed: string[] = [];
    const url = await resolveReachableServer(group, async (candidate) => {
      probed.push(candidate);
      return candidate === "https://east.example.com";
    });
    expect(url).toBe("https://east.example.com");
    expect(probed).toEqual(["https://east.example.com"]);
  });

  it("falls back through servers[] in order when lastGoodUrl fails", async () => {
    const group: KnownServerGroup = {
      servers: [
        { url: "https://home.example.com" },
        { url: "https://east.example.com" },
        { url: "https://west.example.com" },
      ],
      lastGoodUrl: "https://stale.example.com",
    };
    const probed: string[] = [];
    const url = await resolveReachableServer(group, async (candidate) => {
      probed.push(candidate);
      return candidate === "https://west.example.com";
    });
    expect(url).toBe("https://west.example.com");
    expect(probed).toEqual([
      "https://stale.example.com",
      "https://home.example.com",
      "https://east.example.com",
      "https://west.example.com",
    ]);
  });

  it("works with no lastGoodUrl at all, trying servers[] in priority order", async () => {
    const group: KnownServerGroup = {
      servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }],
    };
    const probed: string[] = [];
    const url = await resolveReachableServer(group, async (candidate) => {
      probed.push(candidate);
      return true;
    });
    expect(url).toBe("https://home.example.com");
    expect(probed).toEqual(["https://home.example.com"]);
  });

  it("doesn't probe lastGoodUrl twice when it also appears in servers[]", async () => {
    const group: KnownServerGroup = {
      servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }],
      lastGoodUrl: "https://home.example.com",
    };
    const probed: string[] = [];
    await resolveReachableServer(group, async (candidate) => {
      probed.push(candidate);
      return candidate === "https://east.example.com";
    });
    expect(probed).toEqual(["https://home.example.com", "https://east.example.com"]);
  });

  it("throws only once every address has failed", async () => {
    const group: KnownServerGroup = {
      servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }],
      lastGoodUrl: "https://stale.example.com",
    };
    await expect(resolveReachableServer(group, async () => false)).rejects.toThrow();
  });

  it("throws immediately for an empty group (no lastGoodUrl, no servers)", async () => {
    const group: KnownServerGroup = { servers: [] };
    const probe = async () => true;
    await expect(resolveReachableServer(group, probe)).rejects.toThrow();
  });
});
