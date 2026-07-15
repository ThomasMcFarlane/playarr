/**
 * Locally-persisted "who is requesting this" identity for the web app's
 * "Request" action (`POST /api/v1/requests`'s `SubmitRequestBody.requested_by`).
 *
 * Same gap, same workaround shape as `Admin.tsx`'s `decided_by` field (see
 * that file's doc comment): the backend has no auth middleware yet to
 * derive a real caller id from a verified token
 * (`SubmitRequestBody.requested_by`'s own TODO in the spec), so there is no
 * verified "current user" to source this from. Unlike the TV shells (see
 * `@streamarr-tv/ui-tv`'s `getOrCreateDeviceUserId`), the web app *does*
 * have a keyboard, so this asks for a real id once (distinct from the
 * admin-decision id -- a viewer requesting something and an admin deciding
 * on it are different people) and persists it, rather than auto-generating one.
 */
const REQUESTER_USER_ID_STORAGE_KEY = "streamarr:userId";

export function getStoredRequesterId(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(REQUESTER_USER_ID_STORAGE_KEY) ?? "";
}

export function setStoredRequesterId(value: string): void {
  if (typeof localStorage === "undefined") return;
  if (value) {
    localStorage.setItem(REQUESTER_USER_ID_STORAGE_KEY, value);
  } else {
    localStorage.removeItem(REQUESTER_USER_ID_STORAGE_KEY);
  }
}
