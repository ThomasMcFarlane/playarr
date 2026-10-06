import { ApiError, type CalendarFeedStatus } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import {
  classifyCalendarLinkError,
  loadStoredCalendarLink,
  openCalendarLink,
  planCalendarLinkOpen,
  resetCalendarLink,
  storeCalendarLink,
} from "./calendarLink";

function memory(profile?: object) {
  const data = new Map<string, string>();
  if (profile) data.set("playarr.activeProfile.v1", JSON.stringify(profile));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("classifyCalendarLinkError", () => {
  it("separates an unreachable server from one that does not support calendar links", () => {
    expect(classifyCalendarLinkError(new TypeError("Failed to fetch"))).toBe("unreachable");
    expect(classifyCalendarLinkError(new ApiError(404, "Not Found", undefined))).toBe("unsupported");
    expect(classifyCalendarLinkError(new ApiError(405, "Method Not Allowed", undefined))).toBe("unsupported");
    expect(classifyCalendarLinkError(new ApiError(401, "Unauthorized", undefined))).toBe("signin");
    expect(classifyCalendarLinkError(new ApiError(500, "Boom", undefined))).toBe("other");
  });
});

describe("stored calendar link", () => {
  it("is scoped per server and user", () => {
    const a = memory({ apiBaseUrl: "https://a", userId: "u1" });
    storeCalendarLink("https://a/feed/abc", a);
    expect(loadStoredCalendarLink(a)).toBe("https://a/feed/abc");
    const other = { ...a, getItem: (k: string) => (k === "playarr.activeProfile.v1" ? JSON.stringify({ apiBaseUrl: "https://a", userId: "u2" }) : a.getItem(k)) };
    expect(loadStoredCalendarLink(other)).toBeNull();
    storeCalendarLink(null, a);
    expect(loadStoredCalendarLink(a)).toBeNull();
  });

  it("stores nothing without an active profile", () => {
    const s = memory();
    storeCalendarLink("https://x", s);
    expect(loadStoredCalendarLink(s)).toBeNull();
  });
});

describe("planCalendarLinkOpen", () => {
  it("fetches when there is no link yet or the server can show the existing one", () => {
    expect(planCalendarLinkOpen({ active: false }, null)).toBe("fetch");
    expect(planCalendarLinkOpen({ active: true, link_available: true }, null)).toBe("fetch");
  });

  it("never posts to a server that cannot show its link again, since that would replace it", () => {
    expect(planCalendarLinkOpen({ active: true }, "https://a/feed/x")).toBe("stored");
    expect(planCalendarLinkOpen({ active: true, link_available: false }, null)).toBe("needsReset");
  });
});

function fakeClient(status: CalendarFeedStatus) {
  const calls: Array<{ rotate?: boolean }> = [];
  return {
    calls,
    client: {
      getCalendarFeed: async () => status,
      createCalendarFeed: async (options: { rotate?: boolean } = {}) => {
        calls.push(options);
        return { url: options.rotate ? "https://a/feed/new" : "https://a/feed/existing", token: "t", created_at: "2026-10-04T00:00:00Z" };
      },
    },
  };
}

describe("openCalendarLink and resetCalendarLink", () => {
  it("shows the existing link with one call and does not rotate it", async () => {
    const { client, calls } = fakeClient({ active: true, link_available: true });
    await expect(openCalendarLink(client, null)).resolves.toEqual({ kind: "link", url: "https://a/feed/existing" });
    expect(calls).toEqual([{}]);
  });

  it("creates the first link without rotating", async () => {
    const { client, calls } = fakeClient({ active: false });
    await openCalendarLink(client, null);
    expect(calls).toEqual([{}]);
  });

  it("leaves an old server's link alone and asks for no POST", async () => {
    const { client, calls } = fakeClient({ active: true });
    await expect(openCalendarLink(client, null)).resolves.toEqual({ kind: "needsReset" });
    await expect(openCalendarLink(client, "https://a/feed/stored")).resolves.toEqual({ kind: "link", url: "https://a/feed/stored" });
    expect(calls).toEqual([]);
  });

  it("rotates only on reset", async () => {
    const { client, calls } = fakeClient({ active: true, link_available: true });
    await expect(resetCalendarLink(client)).resolves.toBe("https://a/feed/new");
    expect(calls).toEqual([{ rotate: true }]);
  });
});
