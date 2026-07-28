/**
 * The ordered list of known Playarr server addresses, the active-index
 * pointer into that list, and the peer failover address book used when a
 * token refresh needs to retry against another route to the same node
 * (brief sections 3.2 and 4.5).
 *
 * Backed by `auth/SettingsStore.ets` for the two pieces of DURABLE state
 * (`server_urls`, `active_server_index`) -- this file never touches
 * `preferences` directly, and never touches `@kit.AssetStoreKit` at all
 * (the server list is not a secret). `initialize()` must be called once,
 * during bootstrap, to hydrate the in-memory cache from `SettingsStore`
 * BEFORE this instance is handed to a `PlayarrClient` as its
 * `ActiveServerProvider` -- `getActiveBaseUrl()` is a SYNCHRONOUS method
 * (required by that interface) and only ever reads the in-memory cache.
 *
 * The peer failover address book (brief section 4.5's `PeerAddressBundle`)
 * is a different kind of state: it is populated from an already-decoded,
 * already-validated bundle (`core/ServerBundle.ts#decodePeerAddressBundle`)
 * handed in by whichever caller just received one -- `auth/SessionManager.ets`
 * after a successful login/refresh, `auth/DeviceAuthService.ets` after the
 * initial device-code response's `servers=` parameter. It is kept
 * IN MEMORY ONLY, deliberately never written to `SettingsStore` -- see
 * `setPeerAddressBundle`'s own doc comment for why.
 *
 * `getFailoverCandidates` narrows that address book down to the entries
 * that are actually safe to retry a refresh against for a given access
 * token, via `core/RefreshPolicy.ts#selectFailoverCandidates` keyed off the
 * token's `iss` claim (`core/Jwt.ts`) -- refresh tokens are node-scoped, so
 * an address for any other peer is never a valid failover target.
 */

import { ActiveServerProvider } from '../net/PlayarrClient';

import { normaliseServerUrl } from '../core/Url.ts';
import { PeerAddress, PeerAddressBundle } from '../core/Types/Auth.ts';
import { selectFailoverCandidates } from '../core/RefreshPolicy.ts';
import { decodeAccessTokenClaims } from '../core/Jwt.ts';

import { getServerUrls, setServerUrls, getActiveServerIndex, setActiveServerIndex } from './SettingsStore';

export class ServerDirectory implements ActiveServerProvider {
  private urls: string[] = [];
  private activeIndex: number = 0;
  private peerAddresses: PeerAddress[] = [];

  /**
   * Hydrates the in-memory server list and active index from
   * `SettingsStore`. Call exactly once, during bootstrap, before this
   * instance is read by anything else (in particular before it is handed
   * to a `PlayarrClient`). Safe to call again later to re-sync from
   * persisted state, though nothing in this client does so today.
   */
  public async initialize(): Promise<void> {
    this.urls = await getServerUrls();
    this.activeIndex = await getActiveServerIndex();
  }

  /** The full ordered server address list, as currently cached in memory. */
  public listServers(): string[] {
    const copy: string[] = [];
    for (const url of this.urls) {
      copy.push(url);
    }
    return copy;
  }

  /** The index into `listServers()` that is currently active. */
  public getActiveIndex(): number {
    return this.activeIndex;
  }

  /**
   * Implements `ActiveServerProvider`: the base URL `PlayarrClient`
   * should currently be talking to, or `null` if no server has ever been
   * added. Synchronous -- reads only the in-memory cache populated by
   * `initialize()`. An out-of-range cached index (should never happen, but
   * defensively guarded) falls back to index 0 rather than failing the
   * whole request path.
   */
  public getActiveBaseUrl(): string | null {
    if (this.urls.length === 0) {
      return null;
    }
    let index = this.activeIndex;
    if (index < 0 || index >= this.urls.length) {
      index = 0;
    }
    return this.urls[index];
  }

  /**
   * Normalises `rawUrl` (via `core/Url.ts#normaliseServerUrl`) and appends
   * it to the server list, persisting the updated list via `SettingsStore`.
   * A no-op (but still a success) if the normalised address is already
   * present. Returns the normalised URL, or `null` if `rawUrl` does not
   * normalise to a valid `http://`/`https://` address.
   */
  public async addServer(rawUrl: string): Promise<string | null> {
    const normalised = normaliseServerUrl(rawUrl);
    if (normalised === null) {
      return null;
    }
    if (this.urls.indexOf(normalised) === -1) {
      this.urls.push(normalised);
      await setServerUrls(this.urls);
    }
    return normalised;
  }

  /**
   * Selects `index` as the active server and persists it via
   * `SettingsStore`. Returns `false` (leaving the active index unchanged)
   * if `index` is out of range for the current server list.
   */
  public async selectServer(index: number): Promise<boolean> {
    if (index < 0 || index >= this.urls.length) {
      return false;
    }
    this.activeIndex = index;
    await setActiveServerIndex(index);
    return true;
  }

  /**
   * Replaces the peer failover address book with `bundle.addresses` (or
   * clears it, for `null`). Pass only an already-decoded, already-validated
   * `PeerAddressBundle` -- see `core/ServerBundle.ts#decodePeerAddressBundle`
   * -- never a raw, unvalidated wire value.
   *
   * Kept IN MEMORY ONLY, never written to `SettingsStore`: this bundle is
   * re-supplied on every successful login/refresh/device-pairing response,
   * comfortably within the access token's 15-minute lifetime, so a stale
   * on-disk copy describing a group topology that has since changed would
   * only ever be a liability, never a benefit.
   */
  public setPeerAddressBundle(bundle: PeerAddressBundle | null): void {
    if (bundle === null) {
      this.peerAddresses = [];
      return;
    }
    const addresses: PeerAddress[] = [];
    for (const address of bundle.addresses) {
      addresses.push(address);
    }
    this.peerAddresses = addresses;
  }

  /** The current peer failover address book, in server-given priority order. */
  public getPeerAddresses(): PeerAddress[] {
    const copy: PeerAddress[] = [];
    for (const address of this.peerAddresses) {
      copy.push(address);
    }
    return copy;
  }

  /**
   * Narrows the peer failover address book down to the addresses that are
   * actually safe to retry a refresh against for `accessToken`: those
   * attributed to the SAME `peer_node_id` that issued it (brief section
   * 4.5 / `core/RefreshPolicy.ts`). Decodes `accessToken`'s `iss` claim via
   * `core/Jwt.ts`; an undecodable token yields no candidates rather than
   * guessing which peer it came from.
   */
  public getFailoverCandidates(accessToken: string): PeerAddress[] {
    const claims = decodeAccessTokenClaims(accessToken);
    if (claims === null) {
      return [];
    }
    return selectFailoverCandidates(this.peerAddresses, claims.iss);
  }
}
