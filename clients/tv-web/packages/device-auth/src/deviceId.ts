/**
 * Client-generated, stable-per-install device id `LoginRequest.device_id`
 * needs (see its own doc comment in the spec: the same id should be resent
 * on every login/refresh from this install so `Policy::device_allow`/
 * `max_concurrent_sessions` reason about one `Device`, not a fresh one per
 * login). Only relevant to `ensureAccessToken`'s login path -- the RFC 8628
 * device-pairing flow's `DeviceCodeRequest` carries no such field.
 *
 * Same generation/persistence shape the Round D TV workaround
 * (`getOrCreateDeviceUserId`, now removed) used for its device-local
 * pseudo-identity, moved here since this is the one place a device id is
 * still genuinely needed post-Round-E.
 */
const DEVICE_ID_STORAGE_KEY = "playarr:deviceId";

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
 * Returns this install's persisted device id, generating and storing one on
 * first call if none exists yet. Falls back to generating a (non-persisted)
 * id for the lifetime of the call when `localStorage` is unavailable,
 * rather than throwing.
 */
export function getOrCreateDeviceId(): string {
  if (typeof localStorage === "undefined") {
    return generateUuid();
  }

  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;

  const created = generateUuid();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
}
