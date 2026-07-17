export interface SignupInvite {
  serverUrl: string;
  inviteToken: string;
}

/**
 * Parses the two values carried by an administrator-generated QR link.
 * Only absolute HTTP(S) server addresses are accepted so the sign-up client
 * cannot be pointed at an unexpected browser scheme.
 */
export function parseSignupInvite(search: string): SignupInvite | null {
  const params = new URLSearchParams(search);
  const serverUrl = params.get("server")?.trim();
  const inviteToken = params.get("invite")?.trim();
  if (!serverUrl || !inviteToken) return null;

  try {
    const parsed = new URL(serverUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return { serverUrl: parsed.toString().replace(/\/$/, ""), inviteToken };
  } catch {
    return null;
  }
}
