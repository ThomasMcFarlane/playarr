import { ApiError, type CalendarFeedCreated, type CalendarFeedStatus } from "@playarr-tv/api-client";

/** Why the calendar link could not be loaded or changed, in terms a viewer can act on. */
export type CalendarLinkFailure = "unreachable" | "unsupported" | "signin" | "other";

export function classifyCalendarLinkError(error: unknown): CalendarLinkFailure {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 405 || error.status === 501) return "unsupported";
    if (error.status === 401 || error.status === 403) return "signin";
    return "other";
  }
  // fetch() rejects with a TypeError ("Failed to fetch") for DNS, TLS, CORS, mixed-content and offline failures.
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message))) {
    return "unreachable";
  }
  return "other";
}

const STORAGE_KEY = "playarr.calendarLink.v1";

interface ActiveProfile {
  apiBaseUrl?: string;
  userId?: string;
}

function scope(storage: Pick<Storage, "getItem">): string | null {
  try {
    const marker = JSON.parse(storage.getItem("playarr.activeProfile.v1") ?? "null") as ActiveProfile | null;
    return marker?.apiBaseUrl && marker.userId ? `${marker.apiBaseUrl}|${marker.userId}` : null;
  } catch {
    return null;
  }
}

function readAll(storage: Pick<Storage, "getItem">): Record<string, string> {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * The server only returns a link's secret URL when it is created (it stores a
 * hash), so this device remembers the URL for the signed-in profile and server
 * to show it again on later visits. Scoped per server and user.
 */
export function loadStoredCalendarLink(storage: Pick<Storage, "getItem"> = globalThis.localStorage): string | null {
  const key = scope(storage);
  return key ? (readAll(storage)[key] ?? null) : null;
}

export function storeCalendarLink(url: string | null, storage: Pick<Storage, "getItem" | "setItem"> = globalThis.localStorage): void {
  const key = scope(storage);
  if (!key) return;
  const all = readAll(storage);
  if (url) all[key] = url;
  else delete all[key];
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage may be unavailable (private mode); the link then shows once per visit.
  }
}

export type CalendarLinkOpenPlan = "fetch" | "stored" | "needsReset";

/**
 * What opening the link panel should do, given the server's status.
 *
 * `POST /api/v1/calendar/feed` returns the existing link unchanged only when
 * the server says `link_available` (or when there is no link yet, so it simply
 * creates one). A server that predates re-showable links reports no such field
 * and a POST would replace the link, so then the device's stored copy is shown,
 * and when there is none the viewer is left to press Reset on purpose.
 */
export function planCalendarLinkOpen(
  status: Pick<CalendarFeedStatus, "active" | "link_available">,
  storedUrl: string | null,
): CalendarLinkOpenPlan {
  if (!status.active || status.link_available === true) return "fetch";
  return storedUrl ? "stored" : "needsReset";
}

type CalendarLinkClient = {
  getCalendarFeed(): Promise<CalendarFeedStatus>;
  createCalendarFeed(options?: { rotate?: boolean }): Promise<CalendarFeedCreated>;
};

export type CalendarLinkState = { kind: "link"; url: string } | { kind: "needsReset" };

/** Shows the viewer's link: one status call, then at most one POST that never replaces an existing link. */
export async function openCalendarLink(client: CalendarLinkClient, storedUrl: string | null): Promise<CalendarLinkState> {
  const plan = planCalendarLinkOpen(await client.getCalendarFeed(), storedUrl);
  if (plan === "fetch") return { kind: "link", url: (await client.createCalendarFeed()).url };
  if (plan === "stored" && storedUrl) return { kind: "link", url: storedUrl };
  return { kind: "needsReset" };
}

/** Replaces the link (the old URL stops working). Only the Reset action calls this. */
export async function resetCalendarLink(client: CalendarLinkClient): Promise<string> {
  return (await client.createCalendarFeed({ rotate: true })).url;
}
