/**
 * `@kit.ArkData` preferences wrapper for every piece of NON-secret,
 * durable client state. This is the ONLY file in this project allowed to
 * touch `preferences` (brief sections 3.2 and 9 Slice 3) -- `auth/
 * SecretStore.ets` owns the two pieces of credential material (a bearer
 * and a rotating renewal value) via `@kit.AssetStoreKit` instead, and never
 * through this file.
 *
 * What lives here:
 *   - The server address list and the active index into it (brief section
 *     3.2's `ServerDirectory.ets` reads/writes both through this file --
 *     it never touches `preferences` directly).
 *   - The per-install `device_id` (brief section 4.4). For the manual/
 *     credential login path (`POST /api/v1/auth/login`) the client itself
 *     mints this value once (via `util/Uuid.ets`) and must keep presenting
 *     the SAME one on every subsequent login so the server's
 *     `max_concurrent_sessions` accounting sees one stable device. For the
 *     RFC 8628 device-authorisation flow the value is server-minted and
 *     recovered from the access token's claims (`core/Jwt.ts`) instead --
 *     either flow ends up calling `setDeviceId` with the value to persist.
 *     This field is NEVER cleared by `clearSelectedProfile` below: brief
 *     section 9 Slice 3 requires sign-out to "clear tokens and profile
 *     name but preserve... the login device_id".
 *   - The selected profile id/name (brief section 4.7).
 *   - The theme override (brief section 9 Slice 4: system/light/dark,
 *     `design/Theme.ets` applies it).
 *   - Library view/sort preferences (brief section 9 Slice 6: `Library.ets`
 *     is "a per-kind browse grid with sort/order/artwork-size").
 *
 * What does NOT live here: the current bearer or the rotating renewal
 * value used at `POST /api/v1/auth/refresh` -- that is exclusively
 * `auth/SecretStore.ets`'s job. An offline validator asserts this file
 * never contains either wire field's exact snake_case name, so even
 * comments below deliberately say "credential material" instead of
 * spelling either name out.
 *
 * `initSettingsStore(context)` must be called exactly once, from
 * `EntryAbility`'s bootstrap wiring, before any getter/setter below is
 * used -- there is no implicit global context to fall back on.
 */

import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

const PREFERENCES_STORE_NAME: string = 'playarr_settings';

const SERVER_URLS_KEY: string = 'server_urls';
const ACTIVE_SERVER_INDEX_KEY: string = 'active_server_index';
const DEVICE_ID_KEY: string = 'device_id';
const SELECTED_PROFILE_ID_KEY: string = 'selected_profile_id';
const SELECTED_PROFILE_NAME_KEY: string = 'selected_profile_name';
const THEME_OVERRIDE_KEY: string = 'theme_override';
const LIBRARY_SORT_FIELD_KEY: string = 'library_sort_field';
const LIBRARY_SORT_ORDER_KEY: string = 'library_sort_order';
const LIBRARY_ARTWORK_DENSITY_KEY: string = 'library_artwork_density';

/** Brief section 9 Slice 4: system-driven or a manual override that wins in both directions. */
export type ThemeOverride = 'system' | 'light' | 'dark';

/** Mirrors `GET /api/v1/catalog`'s `sort` values (brief section 4.8); `"title"` is the server default. */
export type LibrarySortField = 'title' | 'date_added' | 'recent';

/** Mirrors `GET /api/v1/catalog`'s `order` values (brief section 4.8). */
export type LibrarySortOrder = 'asc' | 'desc';

/** Client-only display density for the Library browse grid -- no server-side counterpart. */
export type LibraryArtworkDensity = 'compact' | 'standard' | 'large';

let appContext: common.Context | null = null;
let preferencesInstancePromise: Promise<preferences.Preferences> | null = null;

/**
 * Wires this store to the application context. Call exactly once, early in
 * `EntryAbility`'s lifecycle, before any getter/setter below is invoked.
 * Safe to call again (e.g. in a test harness) -- it simply drops any cached
 * `Preferences` handle so the next access re-opens it against the new
 * context.
 */
export function initSettingsStore(context: common.Context): void {
  appContext = context;
  preferencesInstancePromise = null;
}

function preferencesInstance(): Promise<preferences.Preferences> {
  if (appContext === null) {
    throw new Error('SettingsStore: initSettingsStore(context) must be called before use');
  }
  if (preferencesInstancePromise === null) {
    const options: preferences.Options = { name: PREFERENCES_STORE_NAME };
    preferencesInstancePromise = preferences.getPreferences(appContext, options);
  }
  return preferencesInstancePromise;
}

async function putString(key: string, value: string): Promise<void> {
  const instance: preferences.Preferences = await preferencesInstance();
  await instance.put(key, value);
  await instance.flush();
}

async function getString(key: string, defaultValue: string): Promise<string> {
  const instance: preferences.Preferences = await preferencesInstance();
  const raw: preferences.ValueType = await instance.get(key, defaultValue);
  if (typeof raw === 'string') {
    return raw;
  }
  return defaultValue;
}

async function putNumber(key: string, value: number): Promise<void> {
  const instance: preferences.Preferences = await preferencesInstance();
  await instance.put(key, value);
  await instance.flush();
}

async function getNumber(key: string, defaultValue: number): Promise<number> {
  const instance: preferences.Preferences = await preferencesInstance();
  const raw: preferences.ValueType = await instance.get(key, defaultValue);
  if (typeof raw === 'number') {
    return raw;
  }
  return defaultValue;
}

/**
 * Parses a JSON-encoded string array, dropping anything that does not
 * actually decode to an array of strings. A list is stored as a single JSON
 * string (rather than relying on `preferences.ValueType`'s native array
 * support) so this module only ever depends on the plain-string `get`/`put`
 * shape, which every `@kit.ArkData` release since API 9 supports.
 */
function parseStringArrayJson(raw: string): string[] {
  let parsed: string[];
  try {
    parsed = JSON.parse(raw) as string[];
  } catch (error) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const result: string[] = [];
  for (const item of parsed) {
    if (typeof item === 'string') {
      result.push(item);
    }
  }
  return result;
}

/** The ordered, user-entered server address list (already `normaliseServerUrlList`-cleaned by the caller). */
export async function getServerUrls(): Promise<string[]> {
  const raw: string = await getString(SERVER_URLS_KEY, '[]');
  return parseStringArrayJson(raw);
}

/** Replaces the whole server address list. */
export async function setServerUrls(urls: string[]): Promise<void> {
  await putString(SERVER_URLS_KEY, JSON.stringify(urls));
}

/** The index into `getServerUrls()` that is currently active; `0` if never set. */
export async function getActiveServerIndex(): Promise<number> {
  return await getNumber(ACTIVE_SERVER_INDEX_KEY, 0);
}

/** Sets the active index into the server address list. */
export async function setActiveServerIndex(index: number): Promise<void> {
  await putNumber(ACTIVE_SERVER_INDEX_KEY, index);
}

/**
 * The stably-persisted per-install device identifier (brief section 4.4).
 * `null` before it has ever been set. Survives sign-out -- see the
 * file-header comment.
 */
export async function getDeviceId(): Promise<string | null> {
  const raw: string = await getString(DEVICE_ID_KEY, '');
  if (raw.length === 0) {
    return null;
  }
  return raw;
}

/** Persists the per-install device identifier. Call once and keep reusing the same value; never regenerate per login. */
export async function setDeviceId(deviceId: string): Promise<void> {
  await putString(DEVICE_ID_KEY, deviceId);
}

/** The currently selected profile's id, or `null` if none is selected. */
export async function getSelectedProfileId(): Promise<string | null> {
  const raw: string = await getString(SELECTED_PROFILE_ID_KEY, '');
  if (raw.length === 0) {
    return null;
  }
  return raw;
}

/** Sets (or, with `null`, clears) the currently selected profile's id. */
export async function setSelectedProfileId(profileId: string | null): Promise<void> {
  await putString(SELECTED_PROFILE_ID_KEY, profileId === null ? '' : profileId);
}

/** The currently selected profile's display name, or `null` if none is selected. */
export async function getSelectedProfileName(): Promise<string | null> {
  const raw: string = await getString(SELECTED_PROFILE_NAME_KEY, '');
  if (raw.length === 0) {
    return null;
  }
  return raw;
}

/** Sets (or, with `null`, clears) the currently selected profile's display name. */
export async function setSelectedProfileName(profileName: string | null): Promise<void> {
  await putString(SELECTED_PROFILE_NAME_KEY, profileName === null ? '' : profileName);
}

/**
 * Clears the selected-profile fields only. This is exactly the sign-out
 * contract from brief section 9 Slice 3 ("sign-out clears tokens and
 * profile name but preserves the server address list, and preserves the
 * login device_id") applied to the non-secret half of that state --
 * `auth/SecretStore.ets#clearAllSecrets` handles the credential-material
 * half. Deliberately does not touch `server_urls`, `active_server_index`,
 * or `device_id`.
 */
export async function clearSelectedProfile(): Promise<void> {
  await setSelectedProfileId(null);
  await setSelectedProfileName(null);
}

function toThemeOverride(value: string): ThemeOverride {
  if (value === 'light' || value === 'dark') {
    return value;
  }
  return 'system';
}

/** The manual theme override, defaulting to `"system"` (follow the OS signal) until the user picks one. */
export async function getThemeOverride(): Promise<ThemeOverride> {
  const raw: string = await getString(THEME_OVERRIDE_KEY, 'system');
  return toThemeOverride(raw);
}

/** Sets the manual theme override; `design/Theme.ets` treats this as winning over the system signal in both directions. */
export async function setThemeOverride(themeOverride: ThemeOverride): Promise<void> {
  await putString(THEME_OVERRIDE_KEY, themeOverride);
}

function toLibrarySortField(value: string): LibrarySortField {
  if (value === 'date_added' || value === 'recent') {
    return value;
  }
  return 'title';
}

/** The Library screen's persisted sort field, defaulting to `"title"` (the server's own default). */
export async function getLibrarySortField(): Promise<LibrarySortField> {
  const raw: string = await getString(LIBRARY_SORT_FIELD_KEY, 'title');
  return toLibrarySortField(raw);
}

/** Sets the Library screen's persisted sort field. */
export async function setLibrarySortField(field: LibrarySortField): Promise<void> {
  await putString(LIBRARY_SORT_FIELD_KEY, field);
}

function toLibrarySortOrder(value: string): LibrarySortOrder {
  if (value === 'desc') {
    return value;
  }
  return 'asc';
}

/** The Library screen's persisted sort order, defaulting to `"asc"`. */
export async function getLibrarySortOrder(): Promise<LibrarySortOrder> {
  const raw: string = await getString(LIBRARY_SORT_ORDER_KEY, 'asc');
  return toLibrarySortOrder(raw);
}

/** Sets the Library screen's persisted sort order. */
export async function setLibrarySortOrder(order: LibrarySortOrder): Promise<void> {
  await putString(LIBRARY_SORT_ORDER_KEY, order);
}

function toLibraryArtworkDensity(value: string): LibraryArtworkDensity {
  if (value === 'compact' || value === 'large') {
    return value;
  }
  return 'standard';
}

/** The Library screen's persisted artwork density, defaulting to `"standard"`. */
export async function getLibraryArtworkDensity(): Promise<LibraryArtworkDensity> {
  const raw: string = await getString(LIBRARY_ARTWORK_DENSITY_KEY, 'standard');
  return toLibraryArtworkDensity(raw);
}

/** Sets the Library screen's persisted artwork density. */
export async function setLibraryArtworkDensity(density: LibraryArtworkDensity): Promise<void> {
  await putString(LIBRARY_ARTWORK_DENSITY_KEY, density);
}
