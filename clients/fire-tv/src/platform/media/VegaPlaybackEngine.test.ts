/**
 * Exercises `VegaPlaybackEngine` entirely against injected fakes -- a
 * `VegaVideoPlayerLike` and a `ShakaNamespace`/`ShakaPlayerLike` pair, both
 * hand-rolled here rather than the real `@amazon-devices/react-native-
 * w3cmedia`/Shaka runtime, which this environment does not have (see
 * `VegaPlaybackEngine.ts`'s own `createRealVideoPlayer` comment and
 * `shakaAdapter.ts`'s top comment for why). Mirrors
 * `player-avplay`'s own test posture: real `PlaybackEngine` state-machine
 * behaviour is fully testable this way, only the native/Shaka runtime
 * itself is out of reach under Jest.
 */
import type {PlaybackSource} from '@playarr-tv/player-core';
import {VegaPlaybackEngine, type VegaVideoPlayerLike} from './VegaPlaybackEngine';
import type {ShakaNamespace, ShakaPlayerLike, ShakaTrack} from './shakaAdapter';

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeVideoPlayer extends FakeEventTarget implements VegaVideoPlayerLike {
  src = '';
  currentTime = 0;
  duration = 0;
  volume = 1;
  muted = false;
  paused = true;
  buffered = {length: 0, end: () => 0, start: () => 0};
  error = null as unknown as VegaVideoPlayerLike['error'];
  audioTracks = new FakeEventTarget() as unknown as VegaVideoPlayerLike['audioTracks'];
  textTracks = new FakeEventTarget() as unknown as VegaVideoPlayerLike['textTracks'];
  deinitializeCalls = 0;
  initializeCalls = 0;

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }

  async deinitialize(): Promise<void> {
    this.deinitializeCalls += 1;
  }

  addTextTrack = jest.fn(
    (_kind: string, _label?: string, _language?: string, _uri?: string, _mimeType?: string) =>
      ({id: 'native-text-1'}) as ReturnType<VegaVideoPlayerLike['addTextTrack']>
  );

  async play(): Promise<void> {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

function fakeShakaTrack(overrides: Partial<ShakaTrack> = {}): ShakaTrack {
  return {id: 1, active: true, label: 'English', language: 'en', roles: [], ...overrides};
}

class FakeShakaPlayer extends FakeEventTarget implements ShakaPlayerLike {
  attachedTo: unknown = null;
  loadedUri: string | undefined;
  loadedStartTime: number | null | undefined;
  destroyCalls = 0;
  audioTracks: ShakaTrack[] = [fakeShakaTrack()];
  textTracks: ShakaTrack[] = [];
  textTrackVisible = false;
  requestFilter: ((type: number, request: {uris: string[]; headers: Record<string, string>}) => void | Promise<void>) | undefined;

  async attach(mediaElement: unknown): Promise<void> {
    this.attachedTo = mediaElement;
  }

  configure(): boolean {
    return true;
  }

  async load(uri: string, startTime?: number | null): Promise<void> {
    this.loadedUri = uri;
    this.loadedStartTime = startTime;
  }

  async unload(): Promise<void> {}

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }

  getNetworkingEngine() {
    return {
      registerRequestFilter: (filter: typeof this.requestFilter) => {
        this.requestFilter = filter;
      },
    };
  }

  getAudioTracks(): ShakaTrack[] {
    return this.audioTracks;
  }

  getTextTracks(): ShakaTrack[] {
    return this.textTracks;
  }

  selectAudioTrack(track: ShakaTrack): void {
    this.audioTracks = this.audioTracks.map((candidate) => ({...candidate, active: candidate.id === track.id}));
  }

  selectTextTrack(track: ShakaTrack): void {
    this.textTracks = this.textTracks.map((candidate) => ({...candidate, active: candidate.id === track.id}));
  }

  setTextTrackVisibility(visible: boolean): void {
    this.textTrackVisible = visible;
  }

  isTextTrackVisible(): boolean {
    return this.textTrackVisible;
  }

  async addTextTrackAsync(uri: string, language: string, _kind: string, _mimeType: string, _codec?: string, label?: string, forced?: boolean): Promise<ShakaTrack> {
    const track = fakeShakaTrack({id: this.textTracks.length + 100, language, label: label ?? null, forced, active: false});
    this.textTracks = [...this.textTracks, track];
    return track;
  }

  seekRange() {
    return {start: 0, end: this.loadedStartTime ?? 0};
  }
}

function fakeShakaNamespace(player: FakeShakaPlayer): ShakaNamespace {
  return {
    Player: class {
      constructor() {
        return player as unknown as InstanceType<ShakaNamespace['Player']>;
      }
    } as unknown as ShakaNamespace['Player'],
    net: {NetworkingEngine: {RequestType: {MANIFEST: 0, SEGMENT: 1, LICENSE: 2}}},
  };
}

const HLS_SOURCE: PlaybackSource = {url: 'https://example.test/playlist.m3u8', mimeType: 'application/x-mpegURL'};

function createHarness() {
  const videoPlayer = new FakeVideoPlayer();
  const shakaPlayer = new FakeShakaPlayer();
  const shaka = fakeShakaNamespace(shakaPlayer);
  const engine = new VegaPlaybackEngine({
    createVideoPlayer: () => videoPlayer,
    resolveShaka: () => shaka,
  });
  return {videoPlayer, shakaPlayer, shaka, engine};
}

describe('VegaPlaybackEngine', () => {
  it('starts idle', () => {
    const {engine} = createHarness();
    expect(engine.getState().state).toBe('idle');
  });

  it('loads an HLS source via Shaka: initializes the player before touching it, attaches Shaka, and reaches "ready"', async () => {
    const {videoPlayer, shakaPlayer, engine} = createHarness();

    await engine.load(HLS_SOURCE);

    expect(videoPlayer.initializeCalls).toBe(1);
    expect(shakaPlayer.attachedTo).toBe(videoPlayer);
    expect(shakaPlayer.loadedUri).toBe(HLS_SOURCE.url);
    expect(engine.getState().state).toBe('ready');
    expect(engine.getVideoPlayer()).toBe(videoPlayer);
  });

  it('plays HLS through the direct/native src path when the mime type is not HLS', async () => {
    const {videoPlayer, shakaPlayer, engine} = createHarness();

    await engine.load({url: 'https://example.test/movie.mp4', mimeType: 'video/mp4'});

    expect(videoPlayer.src).toBe('https://example.test/movie.mp4');
    expect(shakaPlayer.attachedTo).toBeNull();
    expect(engine.getState().state).toBe('ready');
  });

  it('registers a request filter that attaches the current bearer token to manifest/segment/license requests', async () => {
    const {shakaPlayer, engine} = createHarness();
    engine.setAuthHeaderProvider(() => 'token-abc');

    await engine.load(HLS_SOURCE);

    const request = {uris: [HLS_SOURCE.url], headers: {}};
    await shakaPlayer.requestFilter?.(0, request);
    expect(request.headers).toEqual({Authorization: 'Bearer token-abc'});
  });

  it('reports a fatal error and does not reach "ready" when Shaka is unavailable', async () => {
    const videoPlayer = new FakeVideoPlayer();
    const engine = new VegaPlaybackEngine({
      createVideoPlayer: () => videoPlayer,
      resolveShaka: () => undefined,
    });

    await expect(engine.load(HLS_SOURCE)).rejects.toThrow(/Shaka/);
    expect(engine.getState().state).toBe('error');
    expect(engine.getState().error?.fatal).toBe(true);
  });

  it('enforces single-decoder discipline: a second load() fully tears down the first player first', async () => {
    const shakaPlayerA = new FakeShakaPlayer();
    const shakaPlayerB = new FakeShakaPlayer();
    const videoPlayerA = new FakeVideoPlayer();
    const videoPlayerB = new FakeVideoPlayer();
    let callCount = 0;
    const engine = new VegaPlaybackEngine({
      createVideoPlayer: () => (callCount++ === 0 ? videoPlayerA : videoPlayerB),
      resolveShaka: () => fakeShakaNamespace(callCount <= 1 ? shakaPlayerA : shakaPlayerB),
    });

    await engine.load(HLS_SOURCE);
    expect(videoPlayerA.deinitializeCalls).toBe(0);

    await engine.load({...HLS_SOURCE, url: 'https://example.test/other.m3u8'});

    expect(videoPlayerA.deinitializeCalls).toBe(1);
    expect(shakaPlayerA.destroyCalls).toBe(1);
    expect(engine.getVideoPlayer()).toBe(videoPlayerB);
  });

  it('play()/pause() delegate to the underlying player and update state', async () => {
    const {videoPlayer, engine} = createHarness();
    await engine.load(HLS_SOURCE);

    await engine.play();
    expect(videoPlayer.paused).toBe(false);
    expect(engine.getState().state).toBe('playing');

    await engine.pause();
    expect(videoPlayer.paused).toBe(true);
    expect(engine.getState().state).toBe('paused');
  });

  it('seek() clamps to [0, duration] and sets currentTime on the underlying player', async () => {
    const {videoPlayer, engine} = createHarness();
    await engine.load(HLS_SOURCE);
    videoPlayer.duration = 100;
    videoPlayer.emit('loadedmetadata');

    await engine.seek(-5);
    expect(videoPlayer.currentTime).toBe(0);

    await engine.seek(500);
    expect(videoPlayer.currentTime).toBe(100);

    await engine.seek(42);
    expect(videoPlayer.currentTime).toBe(42);
    expect(engine.getState().currentTimeSeconds).toBe(42);
  });

  it('setVolume()/setMuted() clamp and forward to the underlying player', async () => {
    const {videoPlayer, engine} = createHarness();
    await engine.load(HLS_SOURCE);

    engine.setVolume(1.5);
    expect(videoPlayer.volume).toBe(1);
    expect(engine.getState().volume).toBe(1);

    engine.setMuted(true);
    expect(videoPlayer.muted).toBe(true);
    expect(engine.getState().muted).toBe(true);
  });

  it('adds an external subtitle track via Shaka and can select/deselect it', async () => {
    const {shakaPlayer, engine} = createHarness();
    await engine.load(HLS_SOURCE);

    await engine.addExternalSubtitleTracks([
      {id: 'sub-en', url: 'https://example.test/en.vtt', label: 'English', language: 'en'},
    ]);

    expect(shakaPlayer.textTracks).toHaveLength(1);
    const state = engine.getState();
    expect(state.subtitleTracks.map((track) => track.id)).toEqual(['sub-en']);

    await engine.selectSubtitleTrack('sub-en');
    expect(shakaPlayer.textTrackVisible).toBe(true);
    expect(engine.getState().selectedSubtitleTrackId).toBe('sub-en');

    await engine.selectSubtitleTrack(null);
    expect(shakaPlayer.textTrackVisible).toBe(false);
    expect(engine.getState().selectedSubtitleTrackId).toBeNull();
  });

  it('selectAudioTrack() switches the active Shaka audio track', async () => {
    const {shakaPlayer, engine} = createHarness();
    shakaPlayer.audioTracks = [fakeShakaTrack({id: 1, active: true}), fakeShakaTrack({id: 2, active: false, language: 'fr'})];
    await engine.load(HLS_SOURCE);

    await engine.selectAudioTrack('2');

    expect(engine.getState().selectedAudioTrackId).toBe('2');
  });

  it('destroy() tears down the player, is idempotent, and rejects a subsequent load()', async () => {
    const {videoPlayer, shakaPlayer, engine} = createHarness();
    await engine.load(HLS_SOURCE);

    await engine.destroy();
    expect(videoPlayer.deinitializeCalls).toBe(1);
    expect(shakaPlayer.destroyCalls).toBe(1);
    expect(engine.getState().state).toBe('idle');

    await expect(engine.destroy()).resolves.toBeUndefined();
    expect(videoPlayer.deinitializeCalls).toBe(1);

    await expect(engine.load(HLS_SOURCE)).rejects.toThrow(/destroyed/);
  });

  it('maps a native "error" event on the video player into a fatal engine error', async () => {
    const {videoPlayer, engine} = createHarness();
    await engine.load(HLS_SOURCE);

    videoPlayer.error = {code: 2, message: 'network error'} as unknown as VegaVideoPlayerLike['error'];
    videoPlayer.emit('error');

    const state = engine.getState();
    expect(state.state).toBe('error');
    expect(state.error?.message).toBe('network error');
    expect(state.error?.fatal).toBe(true);
  });
});
