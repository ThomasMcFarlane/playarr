/**
 * Device-local stand-in "requester identity" for submitting `MediaRequest`s
 * from the TV app shells (`POST /api/v1/requests`'s `SubmitRequestBody.requested_by`).
 *
 * There is no real signed-in user concept the TV shells can source this
 * from yet: the RFC 8628 device-pairing flow (`@streamarr-tv/device-auth`)
 * only ever hands back an access/refresh token pair, no user id (see
 * `TokenResponseSchema` -- no `sub`/user-id claim is exposed to the client),
 * and per `SubmitRequestBody.requested_by`'s own doc comment in the spec,
 * there is no auth middleware yet to derive it from a verified token either.
 *
 * The Web app's Admin page works around the same gap by asking an operator
 * to type in a real user id once and persisting it (see `web/src/pages/Admin.tsx`).
 * That doesn't translate to a keyboard-less TV remote, so the TV shells
 * instead generate one random id per device/install and persist it locally
 * -- every request submitted from this TV is attributed to that one
 * device-local pseudo-identity. This is a deliberate simplification
 * documented here rather than a real multi-user TV login; swap it out once
 * the pairing flow's token carries (or the backend exposes another way to
 * obtain) a real user id.
 */
const DEVICE_USER_ID_STORAGE_KEY = "streamarr:deviceUserId";

/** Generates a UUID v4 without requiring `crypto.randomUUID()` (not available on every legacy TV WebKit runtime). */
function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // RFC 4122 §4.4 fallback: fill with Math.random-derived bytes, mask in the version/variant bits.
  const bytes = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  const b = bytes as number[];
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = b.map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex
    .slice(8, 10)
    .join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * Returns this device's persisted pseudo-user id, generating and storing
 * one on first call if none exists yet. Falls back to generating a
 * (non-persisted) id for the lifetime of the call when `localStorage` is
 * unavailable, rather than throwing.
 */
export function getOrCreateDeviceUserId(): string {
  if (typeof localStorage === "undefined") {
    return generateUuid();
  }

  const existing = localStorage.getItem(DEVICE_USER_ID_STORAGE_KEY);
  if (existing) return existing;

  const created = generateUuid();
  localStorage.setItem(DEVICE_USER_ID_STORAGE_KEY, created);
  return created;
}
