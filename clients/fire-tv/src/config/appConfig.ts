/**
 * The one file naming this app's `ClientPlatform` identity. Every other
 * file that needs to know what platform this is (the API client's
 * `X-Streamarr-Client-Platform`/`X-Streamarr-Client-Version` headers, the
 * hosted device-link request body, `EnsureAccessTokenIdentity`) imports
 * `APP_CONFIG` from here rather than hard-coding `'tv-fire'` a second time
 * somewhere else -- the Roku (`Config.brs`) and Apple TV precedent this
 * follows exactly.
 *
 * DEVIATION FROM THE REVIEWED DESIGN DOC, stated explicitly per this task's
 * own instructions: design doc §5.2 has this file send `'android-tv'`,
 * reasoning at length about a closed `ClientPlatform` enum with no
 * fire-tv/vega variant and a worker allow-list that would silently clamp
 * an unknown value to `android-tv` anyway. That reasoning was correct when
 * written, but is now factually superseded on this branch, verified
 * directly rather than assumed:
 *
 *   - `backend/crates/streamarr-model/src/platform.rs` -- `ClientPlatform`
 *     now has a real `TvFire` variant, `wire_name() == "tv-fire"`, fully
 *     covered by that file's own exhaustiveness guard and round-trip test.
 *   - `backend/config/client-compatibility.toml` -- has a `[tv-fire]`
 *     section already, `latestVersion`/`minSupported` both `"0.1.0"`
 *     (matching this file's own `clientVersion` below, and
 *     `manifest.toml`'s `[package] version`, and `package.json`'s
 *     `"version"` -- all four are meant to move together).
 *   - `clients/tv-web/web/worker.js`'s `LINK_CLIENT_PLATFORMS` allow-list
 *     already includes `"tv-fire"` (no clamp-to-`android-tv` would even
 *     apply to it).
 *   - `clients/tv-web/web/src/lib/hostedDeviceLink.ts`'s
 *     `requestHostedDeviceLink` platform union already includes
 *     `"tv-fire"` -- the one-line widening design doc §5.2 called out as a
 *     prerequisite commit has already landed.
 *
 * In short: the `tv-fire`-enum-gap this file's whole reasoning was built on
 * no longer exists on this branch. Sending the honest value is strictly
 * better than a compatibility workaround for a problem that has already
 * been fixed elsewhere, so this sends `'tv-fire'`. If a future rebase ever
 * reverts the backend/worker/hostedDeviceLink changes above, restoring the
 * `'android-tv'` compromise here (and re-narrowing
 * `requestHostedDeviceLink`'s accepted union) is the one place that would
 * need to change back.
 */
export const APP_CONFIG = {
  /** Human-readable product name, for anywhere it's shown rather than sent on the wire. */
  clientName: 'Playarr for Fire TV',
  /**
   * Kept in lockstep by hand with `package.json`'s `"version"`,
   * `manifest.toml`'s `[package] version`, and
   * `backend/config/client-compatibility.toml`'s `[tv-fire]` section --
   * `scripts/prepare-package.mjs` gates the first two against each other on
   * every build; the third lives in a different repo area entirely and is
   * not machine-checked, so bumping this value means also bumping that
   * TOML section by hand.
   */
  clientVersion: '0.1.0',
  /** Sent as `EnsureAccessTokenIdentity.deviceName` and shown as this install's name if the server ever lists connected devices. */
  deviceName: 'Playarr for Fire TV',
  /** See this file's top comment -- a real, first-class `ClientPlatform` variant, not a compatibility stand-in. */
  clientPlatform: 'tv-fire',
  /** Where the hosted (no-server-known-yet) device-linking flow lives -- see design doc §5.1. */
  hostedLinkOrigin: 'https://playarr.app',
} as const;

export type AppConfig = typeof APP_CONFIG;
