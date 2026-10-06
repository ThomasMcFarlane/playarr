/**
 * `@playarr-tv/player-core`'s `PlaybackEngine` implemented over
 * `@amazon-devices/react-native-w3cmedia`'s `VideoPlayer` -- the same
 * pattern `player-avplay`'s `TizenAvplayEngine` follows for Samsung AVPlay
 * and `player-shaka`'s `ShakaPlaybackEngine` follows for a browser `<video>`
 * element (design doc §6.3: "No new player abstraction is invented").
 *
 * Two behavioural facts drive almost everything below, both stated directly
 * in design doc §6.3:
 *
 *  1. "Vega's `VideoPlayer` is NOT ready on construction the way a DOM
 *     `<video>` is -- `initialize()` must be awaited before any src/MSE
 *     work." Every `load()` therefore constructs a fresh `VideoPlayer`,
 *     awaits `initialize()`, and only then touches `src`/hands it to Shaka.
 *  2. "The first Vega Fire TV allows ONE secure video decoder instance...
 *     `destroy()` must fully resolve before a second `load()` of protected
 *     content." `teardownPromise` below is a promise CHAIN, not a flag, so
 *     that a `load()` arriving while a previous teardown is still in flight
 *     queues behind it rather than racing it -- see `load()`'s own comment.
 *
 * `lib/playbackCapabilities.ts` steers every real request toward
 * `mode: "hls"`, so the Shaka path (`loadViaShaka`) is what actually runs in
 * practice; the direct/native `src=` path exists for interface completeness
 * and design doc §6.2's Contingency C, not because a real response is
 * expected to select it (see `load()`'s own comment on
 * `CAPABILITIES.directPlaybackHeaders`).
 */
import {
  BasePlaybackEngine,
  type ExternalSubtitleTrack,
  type PlaybackAudioTrack,
  type PlaybackEngine,
  type PlaybackSource,
  type PlaybackSubtitleTrack,
} from '@playarr-tv/player-core';
import type {
  AudioTrackList,
  MediaError,
  TextTrack,
  TextTrackList,
  TimeRanges,
  TrackEvent,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';
import {CAPABILITIES} from '../capabilities';
import {
  configureShakaForHls,
  createShakaPlayer,
  registerAuthRequestFilter,
  resolveShakaNamespace,
  type ShakaNamespace,
  type ShakaPlayerLike,
  type ShakaTrack,
} from './shakaAdapter';
import {downloadSubtitleToLocalFile} from './subtitles';

/**
 * The exact slice of `VideoPlayer` (and its `MediaPlayer`/`HTMLMediaElement`
 * ancestors) this engine calls, hand-narrowed the same way
 * `player-avplay`'s `TizenAvplayApi` narrows `webapis.avplay` -- lets this
 * file's own tests inject a trivial fake with zero native module involved,
 * and documents precisely which of the SDK's large surface this engine
 * actually depends on.
 */
export interface VegaVideoPlayerLike {
  initialize(): Promise<void>;
  deinitialize(): Promise<void>;
  src: string;
  currentTime: number;
  readonly duration: number;
  volume: number;
  muted: boolean;
  readonly paused: boolean;
  readonly buffered: TimeRanges;
  readonly error: MediaError;
  readonly audioTracks: AudioTrackList;
  readonly textTracks: TextTrackList;
  addTextTrack(kind: string, label?: string, language?: string, uri?: string, mimeType?: string): TextTrack;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
}

export interface VegaPlaybackEngineOptions {
  /** Injectable for tests; defaults to constructing a real `VideoPlayer`. */
  createVideoPlayer?: () => VegaVideoPlayerLike;
  /** Injectable for tests; defaults to `resolveShakaNamespace` (reads `globalThis.shaka`). */
  resolveShaka?: () => ShakaNamespace | undefined;
  /** Injectable for tests; defaults to the real `downloadSubtitleToLocalFile`. */
  downloadSubtitle?: typeof downloadSubtitleToLocalFile;
}

/**
 * Constructs a real `@amazon-devices/react-native-w3cmedia` `VideoPlayer`
 * via a deferred `require()`, not a static top-of-file `import` -- confirmed
 * by actually running this file's tests against a static import first, that
 * package's own barrel (`dist/index.js`) registers a native view config at
 * MODULE-LOAD time (`KeplerCaptionsViewSpec`'s `registerGeneratedViewConfig`
 * call), which throws under Jest with no Vega/Kepler host to register
 * against -- long before this factory would ever run. Deferring it here
 * means importing `VegaPlaybackEngine.ts` itself is safe under Jest;
 * `VegaPlaybackEngine.test.ts` always injects `createVideoPlayer` and never
 * reaches this function at all, the same "tests never touch the real native
 * module" split `subtitles.ts`'s `loadRealFileSystem` uses for the same
 * reason -- see that file's own comment.
 */
function createRealVideoPlayer(): VegaVideoPlayerLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {VideoPlayer: RealVideoPlayer} = require('@amazon-devices/react-native-w3cmedia') as {
    VideoPlayer: new () => VideoPlayer;
  };
  return new RealVideoPlayer();
}

function isHlsMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().includes('mpegurl');
}

function trackLabel(label: string | null | undefined, language: string | undefined, fallback: string): string {
  return (label && label.trim()) || (language && language !== 'und' ? language : '') || fallback;
}

/** `PlaybackEngine` adapter over Vega's `VideoPlayer`, HLS playback mediated by Shaka. */
export class VegaPlaybackEngine extends BasePlaybackEngine implements PlaybackEngine {
  private readonly createVideoPlayer: () => VegaVideoPlayerLike;
  private readonly resolveShaka: () => ShakaNamespace | undefined;
  private readonly downloadSubtitle: typeof downloadSubtitleToLocalFile;

  private videoPlayer: VegaVideoPlayerLike | null = null;
  private shakaPlayer: ShakaPlayerLike | null = null;
  private usingShaka = false;
  private authHeaderProvider: (() => string | undefined | Promise<string | undefined>) | null = null;
  private sessionId: string | null = null;
  private loadGeneration = 0;
  private teardownPromise: Promise<void> = Promise.resolve();
  private destroyed = false;
  private activeCleanup: Array<() => void> = [];

  // Native (in-band, direct-mode) track bookkeeping -- see `load()`'s own
  // comment on why this path is essentially unreachable in v1, kept only
  // for interface completeness.
  private nativeAudioTracks: PlaybackAudioTrack[] = [];
  private nativeSubtitleTracks: PlaybackSubtitleTrack[] = [];

  // Sidecar (`addExternalSubtitleTracks`) bookkeeping, keyed by OUR own
  // `ExternalSubtitleTrack.id` throughout -- never the underlying Shaka
  // numeric id or native `TextTrack` object's own id -- exactly the
  // decoupling `TizenAvplayEngine.externalSubtitleSources`/
  // `resolvedExternalSubtitlePaths` already establish for the same reason:
  // callers of `selectSubtitleTrack` only ever know the id this engine
  // handed back out of `getState().subtitleTracks`.
  private readonly externalSubtitleSources = new Map<string, ExternalSubtitleTrack>();
  private readonly externalSubtitleShakaTrackIds = new Map<string, number>();
  private readonly externalSubtitleNativeTracks = new Map<string, TextTrack>();

  constructor(options: VegaPlaybackEngineOptions = {}) {
    super();
    this.createVideoPlayer = options.createVideoPlayer ?? createRealVideoPlayer;
    this.resolveShaka = options.resolveShaka ?? resolveShakaNamespace;
    this.downloadSubtitle = options.downloadSubtitle ?? downloadSubtitleToLocalFile;
  }

  /**
   * Wires the token the Shaka request filter and sidecar-subtitle downloads
   * authenticate with -- mirrors `ShakaPlaybackEngine.setAuthHeaderProvider`
   * (`@playarr-tv/player-shaka`) by name, for consistency across the whole
   * player-* family. Safe to call before or after `load()`: both read
   * `authHeaderProvider` fresh on every request rather than a snapshot.
   */
  setAuthHeaderProvider(provider: () => string | undefined | Promise<string | undefined>): void {
    this.authHeaderProvider = provider;
  }

  /** The active `PlaybackSession` id (`PlaybackInfoResponse.session_id`), needed only by `authTransport.ts`'s session-cookie fallback strategy. `PlayerScreen` sets this once per negotiated source, before `load()`. */
  setPlaybackSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  /** The underlying native player instance, for `VegaVideoSurface` to render -- `null` until the first `load()` call has constructed and initialized one. Not part of the shared `PlaybackEngine` interface; every player-* adapter adds a few platform-specific members like this one. */
  getVideoPlayer(): VegaVideoPlayerLike | null {
    return this.videoPlayer;
  }

  private getAccessToken(): string | undefined | Promise<string | undefined> {
    return this.authHeaderProvider?.();
  }

  private reportFatalError(code: string, error: unknown): Error {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.setState({state: 'error', error: {code, message: normalized.message, fatal: true}});
    return normalized;
  }

  private readDuration(player: VegaVideoPlayerLike): number {
    return Number.isFinite(player.duration) && player.duration > 0 ? player.duration : this.state.durationSeconds;
  }

  private readBufferedEnd(player: VegaVideoPlayerLike): number {
    const {buffered} = player;
    return buffered.length > 0 ? buffered.end(buffered.length - 1) : this.state.bufferedSeconds;
  }

  private teardownCurrentPlayer(): Promise<void> {
    const player = this.videoPlayer;
    const shaka = this.shakaPlayer;
    this.videoPlayer = null;
    this.shakaPlayer = null;
    this.usingShaka = false;
    this.nativeAudioTracks = [];
    this.nativeSubtitleTracks = [];
    for (const cleanup of this.activeCleanup) cleanup();
    this.activeCleanup = [];

    if (!player) return Promise.resolve();

    return (async () => {
      try {
        if (shaka) await shaka.destroy();
      } catch {
        // Best-effort: an already-torn-down Shaka instance rejecting
        // destroy() must not block releasing the decoder underneath it.
      }
      try {
        await player.deinitialize();
      } catch {
        // Same posture as TizenAvplayEngine.closeCurrentPlayer(): a failed
        // teardown call still needs the caller (a fresh load(), or
        // destroy()) to proceed rather than getting stuck forever.
      }
    })();
  }

  private attachPlayerListeners(player: VegaVideoPlayerLike, generation: number): void {
    const current = () => generation === this.loadGeneration && !this.destroyed;

    const handleLoadedMetadata = () => {
      if (current()) this.setState({durationSeconds: this.readDuration(player)});
    };
    const handleTimeUpdate = () => {
      if (!current()) return;
      this.setState({
        currentTimeSeconds: player.currentTime,
        durationSeconds: this.readDuration(player),
        bufferedSeconds: this.readBufferedEnd(player),
      });
    };
    const handleWaiting = () => {
      if (current()) this.setState({state: 'buffering'});
    };
    const handleSeeking = () => {
      if (current()) this.setState({state: 'buffering'});
    };
    const handleSeeked = () => {
      if (current()) this.setState({currentTimeSeconds: player.currentTime, state: player.paused ? 'paused' : 'playing'});
    };
    const handlePlaying = () => {
      if (current()) this.setState({state: 'playing'});
    };
    const handlePause = () => {
      if (current() && this.state.state !== 'ended') this.setState({state: 'paused'});
    };
    const handleEnded = () => {
      if (current()) this.setState({state: 'ended', currentTimeSeconds: this.readDuration(player)});
    };
    const handleError = () => {
      if (!current()) return;
      const mediaError = player.error;
      this.reportFatalError(
        'VEGA_MEDIA_ERROR',
        mediaError ? new Error(mediaError.message || `MediaError ${mediaError.code}`) : new Error('Unknown Vega media error')
      );
    };
    const handleVolumeChange = () => {
      if (current()) this.setState({volume: player.volume, muted: player.muted});
    };

    player.addEventListener('loadedmetadata', handleLoadedMetadata);
    player.addEventListener('durationchange', handleLoadedMetadata);
    player.addEventListener('timeupdate', handleTimeUpdate);
    player.addEventListener('waiting', handleWaiting);
    player.addEventListener('seeking', handleSeeking);
    player.addEventListener('seeked', handleSeeked);
    player.addEventListener('playing', handlePlaying);
    player.addEventListener('pause', handlePause);
    player.addEventListener('ended', handleEnded);
    player.addEventListener('error', handleError);
    player.addEventListener('volumechange', handleVolumeChange);

    this.activeCleanup.push(() => {
      player.removeEventListener('loadedmetadata', handleLoadedMetadata);
      player.removeEventListener('durationchange', handleLoadedMetadata);
      player.removeEventListener('timeupdate', handleTimeUpdate);
      player.removeEventListener('waiting', handleWaiting);
      player.removeEventListener('seeking', handleSeeking);
      player.removeEventListener('seeked', handleSeeked);
      player.removeEventListener('playing', handlePlaying);
      player.removeEventListener('pause', handlePause);
      player.removeEventListener('ended', handleEnded);
      player.removeEventListener('error', handleError);
      player.removeEventListener('volumechange', handleVolumeChange);
    });

    this.attachNativeTrackListeners(player, generation);
  }

  /**
   * `AudioTrackList`/`TextTrackList` (confirmed against the real
   * `.d.ts`, not assumed) expose only `length` and `getTrackById(id)` --
   * there is no index-based enumeration at all. The W3C-idiomatic way to
   * discover every track is therefore to listen for `addtrack`/`removetrack`
   * on the list itself and accumulate, which is exactly what this does.
   * Only feeds engine state while NOT using Shaka (`this.usingShaka` false)
   * -- the Shaka path derives track state from `shaka.Player.getAudioTracks
   * ()`/`getTextTracks()` instead (`syncShakaTrackState`), and this native
   * accumulation would otherwise silently race it.
   */
  private attachNativeTrackListeners(player: VegaVideoPlayerLike, generation: number): void {
    const current = () => generation === this.loadGeneration && !this.destroyed && !this.usingShaka;

    const handleAudioAddTrack = (event?: unknown) => {
      if (!current()) return;
      const audioTrack = (event as TrackEvent | undefined)?.track as
        | {id: string; label: string; language: string; enabled: boolean}
        | undefined;
      if (!audioTrack) return;
      this.nativeAudioTracks = [
        ...this.nativeAudioTracks.filter((existing) => existing.id !== audioTrack.id),
        {
          id: audioTrack.id,
          label: trackLabel(audioTrack.label, audioTrack.language, `Audio ${this.nativeAudioTracks.length + 1}`),
          language: audioTrack.language || undefined,
          roles: [],
          selected: audioTrack.enabled,
        },
      ];
      this.setState({
        audioTracks: this.nativeAudioTracks,
        selectedAudioTrackId: this.nativeAudioTracks.find((t) => t.selected)?.id ?? null,
      });
    };
    const handleAudioRemoveTrack = (event?: unknown) => {
      if (!current()) return;
      const track = (event as TrackEvent | undefined)?.track as {id: string} | undefined;
      if (!track) return;
      this.nativeAudioTracks = this.nativeAudioTracks.filter((existing) => existing.id !== track.id);
      this.setState({audioTracks: this.nativeAudioTracks});
    };
    const handleTextAddTrack = (event?: unknown) => {
      if (!current()) return;
      const track = (event as TrackEvent | undefined)?.track as {id: string; label: string; language: string} | undefined;
      if (!track) return;
      this.nativeSubtitleTracks = [
        ...this.nativeSubtitleTracks.filter((existing) => existing.id !== track.id),
        {
          id: track.id,
          label: trackLabel(track.label, track.language, `Subtitles ${this.nativeSubtitleTracks.length + 1}`),
          language: track.language || undefined,
          roles: [],
          forced: false,
          selected: false,
        },
      ];
      this.setState({subtitleTracks: [...this.nativeSubtitleTracks, ...this.externalSubtitleTrackStates()]});
    };
    const handleTextRemoveTrack = (event?: unknown) => {
      if (!current()) return;
      const track = (event as TrackEvent | undefined)?.track as {id: string} | undefined;
      if (!track) return;
      this.nativeSubtitleTracks = this.nativeSubtitleTracks.filter((existing) => existing.id !== track.id);
      this.setState({subtitleTracks: [...this.nativeSubtitleTracks, ...this.externalSubtitleTrackStates()]});
    };

    player.audioTracks.addEventListener('addtrack', handleAudioAddTrack);
    player.audioTracks.addEventListener('removetrack', handleAudioRemoveTrack);
    player.textTracks.addEventListener('addtrack', handleTextAddTrack);
    player.textTracks.addEventListener('removetrack', handleTextRemoveTrack);

    this.activeCleanup.push(() => {
      player.audioTracks.removeEventListener('addtrack', handleAudioAddTrack);
      player.audioTracks.removeEventListener('removetrack', handleAudioRemoveTrack);
      player.textTracks.removeEventListener('addtrack', handleTextAddTrack);
      player.textTracks.removeEventListener('removetrack', handleTextRemoveTrack);
    });
  }

  private externalSubtitleTrackStates(): PlaybackSubtitleTrack[] {
    return Array.from(this.externalSubtitleSources.values(), (track) => ({
      id: track.id,
      label: track.label,
      language: track.language,
      roles: [],
      forced: track.forced ?? false,
      selected: this.state.selectedSubtitleTrackId === track.id,
    }));
  }

  private attachShakaListeners(shakaPlayer: ShakaPlayerLike, generation: number): void {
    const current = () => generation === this.loadGeneration && !this.destroyed && this.usingShaka;

    const handleError = (event: unknown) => {
      if (!current()) return;
      const detail = (event as {detail?: {message?: string; code?: number}} | undefined)?.detail;
      this.reportFatalError('VEGA_SHAKA_ERROR', new Error(detail?.message ?? `Shaka error ${detail?.code ?? 'unknown'}`));
    };
    const handleTracksChanged = () => {
      if (current()) this.syncShakaTrackState(shakaPlayer);
    };

    shakaPlayer.addEventListener('error', handleError);
    shakaPlayer.addEventListener('trackschanged', handleTracksChanged);
    shakaPlayer.addEventListener('variantchanged', handleTracksChanged);
    shakaPlayer.addEventListener('textchanged', handleTracksChanged);
    shakaPlayer.addEventListener('texttrackvisibility', handleTracksChanged);

    this.activeCleanup.push(() => {
      shakaPlayer.removeEventListener('error', handleError);
      shakaPlayer.removeEventListener('trackschanged', handleTracksChanged);
      shakaPlayer.removeEventListener('variantchanged', handleTracksChanged);
      shakaPlayer.removeEventListener('textchanged', handleTracksChanged);
      shakaPlayer.removeEventListener('texttrackvisibility', handleTracksChanged);
    });
  }

  private syncShakaTrackState(shakaPlayer: ShakaPlayerLike): void {
    const audioTracks: PlaybackAudioTrack[] = shakaPlayer.getAudioTracks().map((track: ShakaTrack, index) => ({
      id: String(track.id),
      label: trackLabel(track.label, track.language, `Audio ${index + 1}`),
      language: track.language && track.language !== 'und' ? track.language : undefined,
      roles: [...track.roles],
      channelsCount: track.channelsCount ?? undefined,
      selected: track.active,
    }));

    const subtitlesVisible = shakaPlayer.isTextTrackVisible();
    const shakaIdToOwnId = new Map<number, string>(
      [...this.externalSubtitleShakaTrackIds.entries()].map(([ownId, shakaId]) => [shakaId, ownId])
    );
    const sourceSubtitleTracks: PlaybackSubtitleTrack[] = shakaPlayer.getTextTracks().map((track: ShakaTrack, index) => ({
      id: shakaIdToOwnId.get(track.id) ?? String(track.id),
      label: trackLabel(track.label, track.language, `Subtitles ${index + 1}`),
      language: track.language && track.language !== 'und' ? track.language : undefined,
      roles: [...track.roles],
      forced: track.forced ?? false,
      selected: subtitlesVisible && track.active,
    }));

    this.setState({
      audioTracks,
      subtitleTracks: sourceSubtitleTracks,
      selectedAudioTrackId: audioTracks.find((track) => track.selected)?.id ?? null,
      selectedSubtitleTrackId: sourceSubtitleTracks.find((track) => track.selected)?.id ?? null,
    });
  }

  async load(source: PlaybackSource): Promise<void> {
    if (this.destroyed) throw new Error('VegaPlaybackEngine has been destroyed');

    // Single-decoder discipline (design doc §6.3): `teardownPromise` is a
    // CHAIN, not a flag, precisely so a `load()` arriving while a previous
    // teardown is still in flight queues fully behind it rather than racing
    // it -- `destroy()`'s own teardown and this one can never overlap.
    this.teardownPromise = this.teardownPromise.then(() => this.teardownCurrentPlayer());
    await this.teardownPromise;
    if (this.destroyed) return;

    const generation = ++this.loadGeneration;
    this.externalSubtitleSources.clear();
    this.externalSubtitleShakaTrackIds.clear();
    this.externalSubtitleNativeTracks.clear();
    this.setState({
      state: 'loading',
      currentTimeSeconds: source.startPositionSeconds ?? 0,
      durationSeconds: 0,
      bufferedSeconds: 0,
      audioTracks: [],
      subtitleTracks: [],
      selectedAudioTrackId: null,
      selectedSubtitleTrackId: null,
      error: undefined,
    });

    let player: VegaVideoPlayerLike;
    try {
      player = this.createVideoPlayer();
      // Vega's VideoPlayer is not ready on construction the way a DOM
      // <video> is -- initialize() must resolve before any src/MSE work
      // (design doc §6.3's single biggest behavioural difference from
      // player-shaka's web adapter).
      await player.initialize();
      if (generation !== this.loadGeneration || this.destroyed) {
        await player.deinitialize().catch(() => undefined);
        return;
      }
      this.videoPlayer = player;
      this.attachPlayerListeners(player, generation);

      if (isHlsMimeType(source.mimeType)) {
        // Shaka's own `load(uri, startTime, mimeType)` (called inside
        // `loadViaShaka`) already seeks to `source.startPositionSeconds`
        // internally as part of loading -- unlike the direct/native branch
        // below, there is no separate `player.currentTime = ...` step here;
        // setting it again afterwards would issue a second, redundant native
        // seek through the underlying `VideoPlayer` directly, bypassing
        // Shaka's own seek bookkeeping entirely (the same reason
        // `player-shaka`'s web adapter never does this either).
        await this.loadViaShaka(player, source, generation);
      } else {
        // Direct/progressive playback. `CAPABILITIES.directPlaybackHeaders`
        // is `false` (assumption A2, design doc §1.3): `VideoPlayer.src` has
        // no documented header hook, so this path never attaches
        // `Authorization` -- read here purely so the one place that
        // assumption would need flipping stays this file's own comment, not
        // a silent behavioural difference nobody notices.
        // `lib/playbackCapabilities.ts` advertises an empty container/codec
        // set specifically so the server never actually selects this path
        // for protected content (design doc §6.2) -- reachable in v1 only
        // via a future Contingency C change, not exercised today.
        void CAPABILITIES.directPlaybackHeaders;
        player.src = source.url;
        this.usingShaka = false;
        // `VideoPlayer.src` has no start-time parameter of its own (unlike
        // Shaka's `load()` above), so this is the only way to honour
        // `startPositionSeconds` on this path -- the same pattern
        // `TizenAvplayEngine.load()` uses for its own non-MSE native path.
        if (generation === this.loadGeneration && !this.destroyed && source.startPositionSeconds && source.startPositionSeconds > 0) {
          player.currentTime = source.startPositionSeconds;
        }
      }

      if (generation !== this.loadGeneration || this.destroyed) return;

      this.setState({state: 'ready', durationSeconds: this.readDuration(player)});
    } catch (error) {
      if (generation !== this.loadGeneration || this.destroyed) return;
      throw this.reportFatalError('VEGA_LOAD', error);
    }
  }

  private async loadViaShaka(player: VegaVideoPlayerLike, source: PlaybackSource, generation: number): Promise<void> {
    const shaka = this.resolveShaka();
    if (!shaka) {
      throw new Error(
        'Shaka Player for Vega is unavailable (globalThis.shaka is not set) -- see shakaAdapter.ts for why'
      );
    }

    const shakaPlayer = createShakaPlayer(shaka);
    await shakaPlayer.attach(player);
    if (generation !== this.loadGeneration || this.destroyed) {
      await shakaPlayer.destroy().catch(() => undefined);
      return;
    }

    configureShakaForHls(shakaPlayer);
    registerAuthRequestFilter(
      shakaPlayer,
      shaka,
      () => this.getAccessToken(),
      () => this.sessionId
    );

    this.shakaPlayer = shakaPlayer;
    this.usingShaka = true;
    this.attachShakaListeners(shakaPlayer, generation);

    await shakaPlayer.load(source.url, source.startPositionSeconds ?? null, source.mimeType);
    if (generation !== this.loadGeneration || this.destroyed) return;

    this.syncShakaTrackState(shakaPlayer);
  }

  async play(): Promise<void> {
    if (this.destroyed || !this.videoPlayer) return;
    try {
      await this.videoPlayer.play();
      this.setState({state: 'playing', error: undefined});
    } catch (error) {
      throw this.reportFatalError('VEGA_PLAY', error);
    }
  }

  async pause(): Promise<void> {
    if (this.destroyed || !this.videoPlayer) return;
    this.videoPlayer.pause();
    this.setState({state: 'paused'});
  }

  async seek(positionSeconds: number): Promise<void> {
    if (this.destroyed || !this.videoPlayer || !Number.isFinite(positionSeconds)) return;
    const duration = this.state.durationSeconds;
    const bounded = duration > 0 ? Math.min(duration, Math.max(0, positionSeconds)) : Math.max(0, positionSeconds);
    this.videoPlayer.currentTime = bounded;
    this.setState({currentTimeSeconds: bounded});
  }

  setVolume(volume: number): void {
    const bounded = Math.max(0, Math.min(1, volume));
    if (this.videoPlayer) this.videoPlayer.volume = bounded;
    this.setState({volume: bounded});
  }

  setMuted(muted: boolean): void {
    if (this.videoPlayer) this.videoPlayer.muted = muted;
    this.setState({muted});
  }

  async selectAudioTrack(trackId: string): Promise<void> {
    if (this.destroyed) return;
    if (this.usingShaka && this.shakaPlayer) {
      const track = this.shakaPlayer.getAudioTracks().find((candidate) => String(candidate.id) === trackId);
      if (!track) return;
      this.shakaPlayer.selectAudioTrack(track, 0);
      this.syncShakaTrackState(this.shakaPlayer);
      return;
    }
    // Native in-band audio track selection has no documented API on
    // VideoPlayer/MediaPlayer beyond the read-only AudioTrackList this
    // engine already listens to -- direct-mode playback is not reachable in
    // v1 (see load()'s own comment), so this is a documented no-op rather
    // than a half-finished native code path against an unverified API.
  }

  async addExternalSubtitleTracks(tracks: ExternalSubtitleTrack[]): Promise<void> {
    if (this.destroyed) return;
    for (const track of tracks) this.externalSubtitleSources.set(track.id, track);

    if (this.usingShaka && this.shakaPlayer) {
      for (const track of tracks) {
        if (this.externalSubtitleShakaTrackIds.has(track.id)) continue;
        const added = await this.shakaPlayer.addTextTrackAsync(
          track.url,
          track.language ?? 'und',
          'subtitles',
          'text/vtt',
          undefined,
          track.label,
          track.forced ?? false
        );
        this.externalSubtitleShakaTrackIds.set(track.id, added.id);
      }
      this.shakaPlayer.setTextTrackVisibility(false);
      this.syncShakaTrackState(this.shakaPlayer);
      return;
    }

    // Direct/native path: `addTextTrack`'s `uri` is fetched by the native
    // pipeline, which cannot attach `Authorization` -- `subtitles.ts`
    // downloads the VTT via an authed JS fetch() first (see that file's own
    // doc comment). Only attempted at all while
    // `CAPABILITIES.fileUriSubtitleTracks` is still assumed true; if a real
    // device proves that wrong, sidecar subtitles degrade to "temporarily
    // unavailable" here rather than throwing, exactly as that flag's own
    // comment in platform/capabilities.ts describes.
    if (!this.videoPlayer || !CAPABILITIES.fileUriSubtitleTracks) return;
    for (const track of tracks) {
      if (this.externalSubtitleNativeTracks.has(track.id)) continue;
      try {
        const localPath = await this.downloadSubtitle(track, {getAccessToken: () => this.getAccessToken()});
        const nativeTrack = this.videoPlayer.addTextTrack('subtitles', track.label, track.language ?? 'und', localPath, 'text/vtt');
        this.externalSubtitleNativeTracks.set(track.id, nativeTrack);
      } catch (error) {
        console.warn(`[VegaPlaybackEngine] failed to add external subtitle "${track.id}"`, error);
      }
    }
    this.setState({subtitleTracks: [...this.nativeSubtitleTracks, ...this.externalSubtitleTrackStates()]});
  }

  async selectSubtitleTrack(trackId: string | null): Promise<void> {
    if (this.destroyed) return;

    if (trackId === null) {
      if (this.usingShaka && this.shakaPlayer) {
        this.shakaPlayer.setTextTrackVisibility(false);
        this.syncShakaTrackState(this.shakaPlayer);
      } else {
        for (const nativeTrack of this.externalSubtitleNativeTracks.values()) nativeTrack.mode = 'disabled';
        this.setState({
          subtitleTracks: this.state.subtitleTracks.map((track) => ({...track, selected: false})),
          selectedSubtitleTrackId: null,
        });
      }
      return;
    }

    if (this.usingShaka && this.shakaPlayer) {
      const shakaId = this.externalSubtitleShakaTrackIds.get(trackId);
      const track = this.shakaPlayer
        .getTextTracks()
        .find((candidate) => (shakaId !== undefined ? candidate.id === shakaId : String(candidate.id) === trackId));
      if (!track) return;
      this.shakaPlayer.selectTextTrack(track);
      this.shakaPlayer.setTextTrackVisibility(true);
      this.syncShakaTrackState(this.shakaPlayer);
      return;
    }

    const nativeTrack = this.externalSubtitleNativeTracks.get(trackId);
    if (!nativeTrack) return;
    for (const [id, track] of this.externalSubtitleNativeTracks) track.mode = id === trackId ? 'showing' : 'disabled';
    this.setState({
      subtitleTracks: this.state.subtitleTracks.map((candidate) => ({...candidate, selected: candidate.id === trackId})),
      selectedSubtitleTrackId: trackId,
    });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadGeneration += 1;
    this.teardownPromise = this.teardownPromise.then(() => this.teardownCurrentPlayer());
    await this.teardownPromise;
    this.externalSubtitleSources.clear();
    this.externalSubtitleShakaTrackIds.clear();
    this.externalSubtitleNativeTracks.clear();
    this.setState({state: 'idle', error: undefined});
  }
}

let sharedEngine: VegaPlaybackEngine | null = null;

/**
 * The one `VegaPlaybackEngine` instance this app ever constructs in
 * production. Design doc §6.3's single-decoder discipline means a second
 * concurrently-live `VideoPlayer` is not just wasteful but something the
 * first-generation Vega Fire TV outright cannot support --
 * `PlayerScreen.tsx` (shell-mounted, design doc §4.2) calls this once on its
 * own first mount rather than `new VegaPlaybackEngine()` directly, so even
 * an accidental second mount (Fast Refresh, a future refactor) reuses the
 * same engine instead of standing up a second decoder underneath it.
 * Tests should construct `new VegaPlaybackEngine({...})` directly with
 * injected fakes instead of going through this singleton.
 */
export function getSharedVegaPlaybackEngine(): VegaPlaybackEngine {
  if (!sharedEngine) sharedEngine = new VegaPlaybackEngine();
  return sharedEngine;
}

/** Test-only escape hatch, mirroring `localStorageShim.ts`'s `resetLocalStorageShimForTests` -- never called from application code. */
export function resetSharedVegaPlaybackEngineForTests(): void {
  sharedEngine = null;
}
