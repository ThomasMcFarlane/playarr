import { ApiError } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import { classifyCalendarLinkError, loadStoredCalendarLink, storeCalendarLink } from "./calendarLink";

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
