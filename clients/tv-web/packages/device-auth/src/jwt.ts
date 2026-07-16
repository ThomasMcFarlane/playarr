/**
 * Best-effort, unverified decode of a JWT access token's `sub` claim (the
 * signed-in user's id -- see `streamarr_auth::jwt::AccessTokenClaims::sub`
 * on the backend). Purely a client-side UX hint (e.g. "is this admin about
 * to edit their own account?") -- the signature is never checked here, only
 * the payload is read. That's fine: the server independently re-verifies
 * the token's signature on every protected request, so nothing security-
 * relevant depends on this being tamper-proof. Returns `undefined` for
 * anything that doesn't parse as a three-segment JWT with a string `sub`.
 */
export function decodeAccessTokenUserId(accessToken: string): string | undefined {
  return decodeAccessTokenStringClaim(accessToken, "sub");
}

/**
 * Best-effort device id for persisting a device-flow refresh session. The
 * backend remains the security boundary; this is only used to send the same
 * device id back when rotating the opaque refresh token.
 */
export function decodeAccessTokenDeviceId(accessToken: string): string | undefined {
  return decodeAccessTokenStringClaim(accessToken, "device_id");
}

function decodeAccessTokenStringClaim(
  accessToken: string,
  claim: "sub" | "device_id"
): string | undefined {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return undefined;
  const payloadSegment = parts[1];
  if (!payloadSegment) return undefined;
  try {
    const payload: unknown = JSON.parse(base64UrlDecode(payloadSegment));
    const value = (payload as Record<string, unknown> | null)?.[claim];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  if (typeof atob === "function") return atob(padded);
  // Fallback for runtimes with no global `atob` (older Node test runners).
  return Buffer.from(padded, "base64").toString("utf-8");
}
