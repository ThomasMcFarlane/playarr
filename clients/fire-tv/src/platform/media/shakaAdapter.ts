/**
 * Shaka Player initialisation plus the request filter that injects
 * `Authorization: Bearer <token>` onto `MANIFEST`/`SEGMENT`/`LICENSE`
 * requests -- design doc §6.2's Plan A, code sample reproduced almost
 * verbatim in `registerAuthRequestFilter` below.
 *
 * The one thing this file cannot do like `player-shaka`'s web adapter
 * (`clients/tv-web/packages/player-shaka/src/index.ts`, `import shaka from
 * "shaka-player"`) is `import` Shaka at all: design doc §3.3 confirms Shaka
 * Player for Vega is distributed as a downloaded tarball plus `./setup.sh`,
 * landing in `src/w3cmedia/shakaplayer/` once run, NOT an npm package with a
 * specifier this project can depend on. That setup script has never run in
 * this environment (design doc §3.3's own contingency: "if the tarball
 * isn't obtainable without a developer account, fall back to `mode:
 * direct`") -- so everything below is written against Shaka's documented,
 * already-verified-elsewhere-in-this-repo API shape (the exact surface
 * `player-shaka/src/index.ts` exercises against the real upstream package,
 * since Amazon's Vega fork is described as source-compatible with it), but
 * is UNVERIFIED against a real install. `ShakaNamespace` below is
 * deliberately a hand-written subset type for exactly that reason, the same
 * posture `player-avplay/src/index.ts` takes for `TizenAvplayApi`.
 *
 * Because there is no module to import, this adapter resolves the runtime
 * Shaka object from `globalThis.shaka` (`resolveShakaNamespace`) -- the
 * conventional place a UMD/global Shaka build attaches itself when not
 * loaded through a module system, and the one integration point a later
 * pass can swap for a real `import` statement the moment
 * `src/w3cmedia/shakaplayer/`'s actual export shape is known, without
 * touching any of this file's calling code in `VegaPlaybackEngine.ts`.
 */
import {attachAuth} from './authTransport';

// --- Shaka's documented API shape, narrowed to exactly what this app uses ---

/** Shaka's own `shaka.extern.Request` shape, narrowed to the one field this app ever touches. Real requests carry several more fields (method, body, retryParameters, allowCrossSiteCredentials, ...) that `attachAuth` never needs. */
export interface ShakaRequest {
  uris: string[];
  headers: Record<string, string>;
}

export interface ShakaNetworkingEngine {
  registerRequestFilter(filter: (type: number, request: ShakaRequest) => void | Promise<void>): void;
  registerResponseFilter?(
    filter: (type: number, response: {data: ArrayBuffer; fromCache?: boolean}) => void
  ): void;
}

/** A single audio or text track as Shaka's `getAudioTracks()`/`getTextTracks()` report it. Shaka identifies tracks by a player-assigned numeric `id`, unlike `@amazon-devices/react-native-w3cmedia`'s string-`id` `AudioTrack`/`TextTrack`. */
export interface ShakaTrack {
  id: number;
  active: boolean;
  label: string | null;
  language: string;
  roles: string[];
  forced?: boolean;
  channelsCount?: number | null;
}

export interface ShakaPlayerLike {
  attach(mediaElement: unknown, initializeMediaSource?: boolean): Promise<void>;
  configure(config: Record<string, unknown>): boolean;
  load(uri: string, startTime?: number | null, mimeType?: string): Promise<void>;
  unload(): Promise<void>;
  destroy(): Promise<void>;
  getNetworkingEngine(): ShakaNetworkingEngine | null;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  getAudioTracks(): ShakaTrack[];
  getTextTracks(): ShakaTrack[];
  selectAudioTrack(track: ShakaTrack, safeMarginSeconds?: number): void;
  selectTextTrack(track: ShakaTrack): void;
  setTextTrackVisibility(visible: boolean): void;
  isTextTrackVisible(): boolean;
  addTextTrackAsync(
    uri: string,
    language: string,
    kind: string,
    mimeType: string,
    codec?: string,
    label?: string,
    forced?: boolean
  ): Promise<ShakaTrack>;
  seekRange(): {start: number; end: number};
}

export interface ShakaRequestTypeEnum {
  MANIFEST: number;
  SEGMENT: number;
  LICENSE: number;
}

export interface ShakaNamespace {
  Player: new () => ShakaPlayerLike;
  net: {NetworkingEngine: {RequestType: ShakaRequestTypeEnum}};
  polyfill?: {installAll: () => void};
}

/**
 * Reads the runtime Shaka namespace off `globalThis`, or `undefined` if the
 * Shaka-for-Vega tarball's `setup.sh` has never run in this environment (the
 * case throughout this whole worktree -- see this file's top comment).
 * `VegaPlaybackEngine.load()` treats `undefined` as a real, reportable
 * playback error rather than crashing.
 */
export function resolveShakaNamespace(): ShakaNamespace | undefined {
  return (globalThis as {shaka?: ShakaNamespace}).shaka;
}

/** `new shaka.Player()`, pulled out to its own one-line function purely so `VegaPlaybackEngine.ts` never spells out `new shaka.Player()` itself -- every other Shaka call in this app goes through a named function in this file for the same reason: one place to update if the real Vega fork's construction sequence ever turns out to differ (e.g. requiring an options object). */
export function createShakaPlayer(shaka: ShakaNamespace): ShakaPlayerLike {
  return new shaka.Player();
}

/**
 * `manifest.hls.sequenceMode` is required for MPEG2-TS segments per design
 * doc §6.2's own code sample. `streaming`/`manifest` retry parameters are
 * widened past Shaka's defaults for the same reason
 * `player-shaka/src/index.ts`'s `attach()` widens them (see that file's own
 * long comment): a freshly-created on-demand HLS session's `playlist.m3u8`
 * does not exist on disk until `ffmpeg` starts writing it, several real
 * seconds away for a 4K source -- Shaka's default retry budget exhausts in
 * under two seconds and fires a fatal error with no obvious cause. Streamarr
 * is the same backend regardless of which client is asking, so the same
 * cold-start race applies here.
 */
export function configureShakaForHls(player: ShakaPlayerLike): void {
  const transcodeAwareRetry = {
    timeout: 30_000,
    maxAttempts: 15,
    baseDelay: 1_000,
    backoffFactor: 1.3,
    fuzzFactor: 0.5,
  };
  player.configure({
    manifest: {
      hls: {sequenceMode: true},
      retryParameters: transcodeAwareRetry,
    },
    streaming: {retryParameters: transcodeAwareRetry},
  });
}

/**
 * Registers the ONE request filter this app installs on a Shaka `Player`
 * instance -- design doc §6.2's code sample, with the actual bearer-vs-
 * cookie decision delegated to `authTransport.ts`'s `attachAuth` rather than
 * hard-coded here, so `shakaAdapter.ts` stays "how the credential gets
 * attached" and `authTransport.ts` stays "which credential, and why" (this
 * file's own top comment; `authTransport.ts`'s own top comment states the
 * same split from its side).
 *
 * A no-op if `player.getNetworkingEngine()` returns `null` -- Shaka only
 * has one once a media source is attached; calling this before `attach()`
 * would otherwise throw for a reason that has nothing to do with auth.
 */
export function registerAuthRequestFilter(
  player: ShakaPlayerLike,
  shaka: ShakaNamespace,
  getAccessToken: () => string | undefined | Promise<string | undefined>,
  getSessionId: () => string | null
): void {
  const networkingEngine = player.getNetworkingEngine();
  if (!networkingEngine) return;

  const {MANIFEST, SEGMENT, LICENSE} = shaka.net.NetworkingEngine.RequestType;
  const authedRequestTypes = new Set<number>([MANIFEST, SEGMENT, LICENSE]);

  networkingEngine.registerRequestFilter(async (type, request) => {
    if (!authedRequestTypes.has(type)) return;
    const kind = type === MANIFEST ? 'manifest' : type === SEGMENT ? 'segment' : 'license';
    await attachAuth(request.headers, {kind, getAccessToken, sessionId: getSessionId()});
  });
}
