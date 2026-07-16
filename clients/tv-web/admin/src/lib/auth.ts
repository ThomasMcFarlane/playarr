import { TokenStore } from "@streamarr-tv/device-auth";

/**
 * Clears the stored session and hard-navigates to `/login` -- extracted out
 * of `App.tsx` (where this used to be a private module function) so
 * `UserMenu`'s "Sign out" item can reuse the exact same logic instead of a
 * second, drifting implementation.
 */
export function handleLogout(): void {
  new TokenStore().clear();
  window.location.href = "/login";
}
