import { ApiError } from "@playarr-tv/api-client";

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
export function loadStoredCalendarLink(storage: Pick<Storage, "getItem"> = window.localStorage): string | null {
  const key = scope(storage);
  return key ? (readAll(storage)[key] ?? null) : null;
}

export function storeCalendarLink(url: string | null, storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage): void {
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
