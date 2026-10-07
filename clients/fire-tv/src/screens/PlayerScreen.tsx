/**
 * The real Player screen (design doc §7: "`/player/:id` -> `Player.tsx`
 * (584) -> `PlayerScreen.tsx`"), built on `VegaPlaybackEngine`/
 * `VegaVideoSurface` from `platform/media/`.
 *
 * ============================ MOUNTING CONTRACT ============================
 * Design doc §4.2/§4.3: `PlayerScreen` is SHELL-MOUNTED, not routed -- there
 * is no `ROUTES.player` and this file must never be registered against one.
 * A later stage mounts exactly one `<PlayerScreen ref={...} />` inside
 * `App.tsx`'s render tree (sibling to, not inside, `<AppShellNavigator>`'s
 * content stack), so it survives every navigation the same way tv-web's own
 * `<Player>` does at its `App.tsx:~470-540`. That later stage drives this
 * component entirely through the imperative handle below -- it never passes
 * a `mediaFileId` prop, because there is no `mediaFileId` to pass until
 * something (`WorkDetailScreen`'s `onPlay`, `MusicDetailScreen`'s inline
 * player, a resumed session) actually calls `show()`:
 *
 *   const playerRef = useRef<PlayerScreenHandle>(null);
 *   ...
 *   <PlayerScreen ref={playerRef} userId={currentProfile?.id} onClose={...} />
 *   ...
 *   <WorkDetailScreen onPlay={(mediaFileId) => playerRef.current?.show(mediaFileId)} />
 *
 * `show()`/`hide()`/`stop()`/`isVisible()` are the whole contract:
 *
 *  - `show(mediaFileId, options?)` negotiates playback and starts it. Safe
 *    to call again with a different `mediaFileId` while something is
 *    already playing -- the previous session is closed out cleanly first
 *    (`VegaPlaybackEngine.load()`'s own single-decoder teardown handles the
 *    native side; this file closes the previous analytics session before
 *    that).
 *  - `hide()` stops RENDERING the visual surface only -- playback continues
 *    underneath. This is deliberate, not a bug: design doc §4.2's whole
 *    reason `PlayerScreen` is shell-mounted rather than routed is "so a
 *    minimised music player survives navigation". A shell wiring a music
 *    detail screen's inline mini-player calls `hide()`, not `stop()`.
 *  - `stop()` pauses playback, closes the current analytics session,
 *    flushes final watch progress, and hides the surface -- the real "stop
 *    and go back" action. This screen's own Back-button handling calls
 *    `hide()`, not `stop()` (matching tv-web's own Back-vs-Stop distinction
 *    in `pages/Player.tsx`: Back minimises, a dedicated Stop control -- the
 *    transport bar's Stop button below -- actually stops); a shell that
 *    knows it is playing VIDEO (as opposed to `MusicDetailScreen`'s
 *    inline-music case) rather than this component should decide whether
 *    its own Back handling should call `stop()` instead, since this
 *    component has no way to know which kind of content it is showing.
 *  - `isVisible()` lets the shell avoid remounting or re-showing a player
 *    that is already visible for the same title.
 * =============================================================================
 *
 * Deliberately narrowed scope, stated explicitly (this repo's own
 * established pattern -- see `WorkDetailScreen.tsx`/`ApiClientProvider.tsx`
 * for the same posture): quality-tier selection
 * (`settings/PlayerSettingsScreen.tsx`'s own "later, not-yet-built step"
 * comment), mid-session audio-track switching (tv-web's own
 * `usePlaybackEngine.ts` re-negotiates an entirely new on-demand HLS
 * session for this, real complexity this pass does not attempt), and a
 * playlist/next-episode queue are all left for a later pass. What genuinely
 * works end to end: negotiation, HLS playback via `VegaPlaybackEngine`,
 * sidecar subtitle tracks, play/pause/seek transport control (remote keys
 * and an on-screen bar), watch-progress persistence, and playback-session
 * analytics events.
 */
import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import type {PlaybackEventKind} from '@playarr-tv/api-client';
import {usePlaybackInfo} from '@playarr-tv/api-client/react';
import {TokenStore} from '@playarr-tv/device-auth';
import type {PlaybackEngineState} from '@playarr-tv/player-core';
import {useApiClient} from '../api/ApiClientProvider';
import {ensureFireTvAccessToken} from '../auth/session';
import {useAppForeground, useBackHandler, useRemoteKey} from '../platform';
import {getSharedVegaPlaybackEngine} from '../platform/media/VegaPlaybackEngine';
import {VegaVideoSurface} from '../platform/media/VegaVideoSurface';
import {VEGA_PLAYBACK_CAPABILITIES} from '../lib/playbackCapabilities';
import {clearActivePlayerSession, readActivePlayerSession, writeActivePlayerSession} from '../lib/playerSession';
import {colour} from '../theme/tokens';
import {sh, sw} from '../theme/scale';

export interface PlayerLaunchOptions {
  /** Absolute source timestamp to resume at, in seconds. `undefined` falls back to a persisted `lib/playerSession.ts` resume position for this `mediaFileId` (if any), then to the beginning. */
  startPositionSeconds?: number;
  /** Shown in the transport bar while real work metadata is unavailable (there is none here -- the caller usually already has the title from whatever screen launched playback). */
  title?: string;
}

export interface PlayerScreenHandle {
  show(mediaFileId: string, options?: PlayerLaunchOptions): void;
  hide(): void;
  stop(): void;
  isVisible(): boolean;
}

export interface PlayerScreenProps {
  /** The signed-in profile's id, purely to scope `lib/playerSession.ts`'s persisted resume bookkeeping per profile. `undefined` before a profile is selected. */
  userId?: string;
  /** Called when the user backs out of a visible player. NOT called for a programmatic `hide()`/`stop()` -- see this file's own top comment for the Back-vs-Stop distinction. */
  onClose?: () => void;
}

function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

interface ActiveSession {
  sessionId: string;
  mediaFileId: string;
  startedEvent: boolean;
  closed: boolean;
}

export const PlayerScreen = forwardRef<PlayerScreenHandle, PlayerScreenProps>(function PlayerScreen(
  {userId, onClose},
  ref
): JSX.Element | null {
  const client = useApiClient();
  // One VegaPlaybackEngine for the app's whole lifetime (design doc §6.3's
  // single-decoder discipline) -- see getSharedVegaPlaybackEngine's own
  // comment. `new TokenStore()` here matches the established precedent
  // `ApiClientProvider.tsx`'s own doc comment states explicitly: multiple
  // independent TokenStore() instances all read/write the same underlying
  // storage, so there is nothing to share by threading one through props.
  const engine = useMemo(() => getSharedVegaPlaybackEngine(), []);
  const tokenStore = useMemo(() => new TokenStore(), []);
  const foreground = useAppForeground();

  const [mediaFileId, setMediaFileId] = useState<string | null>(null);
  const [launchOptions, setLaunchOptions] = useState<PlayerLaunchOptions>({});
  const [visible, setVisible] = useState(false);
  const [engineState, setEngineState] = useState<PlaybackEngineState>(() => engine.getState());

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const negotiation = usePlaybackInfo(client, mediaFileId ?? undefined, VEGA_PLAYBACK_CAPABILITIES);

  const loadedSessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<ActiveSession | null>(null);
  const latestPlaybackRef = useRef({positionMs: 0, durationMs: 0});
  latestPlaybackRef.current = {
    positionMs: Math.max(0, Math.round(engineState.currentTimeSeconds * 1000)),
    durationMs: Math.max(0, Math.round(engineState.durationSeconds * 1000)),
  };

  // Mirrors `ApiClientProvider.tsx`'s `getAccessToken` seam, but through
  // `ensureFireTvAccessToken` rather than a raw stored token: playback can
  // run for hours, comfortably longer than a short-lived access token's
  // lifetime, and `player-shaka`'s `setAuthHeaderProvider` contract (which
  // `VegaPlaybackEngine` mirrors by name) is called on every single Shaka
  // request specifically so a mid-session refresh is transparent to
  // in-flight playback. A rejected refresh resolves to `undefined` here
  // rather than throwing -- `attachAuth` (`platform/media/authTransport.ts`)
  // already treats a missing token as "send the request unauthenticated",
  // a real, visible 401 rather than an unhandled rejection inside Shaka's
  // own request pipeline.
  useEffect(() => {
    engine.setAuthHeaderProvider(() =>
      ensureFireTvAccessToken(client, tokenStore).catch(() => undefined)
    );
  }, [client, engine, tokenStore]);

  useEffect(() => engine.onStateChange(setEngineState), [engine]);

  const flushProgress = useCallback(
    (completed: boolean) => {
      if (!mediaFileId) return;
      const {positionMs, durationMs} = latestPlaybackRef.current;
      if (positionMs <= 0 && !completed) return;
      void client.updateWatchProgress(mediaFileId, {positionMs, durationMs, completed}).catch(() => {
        // Progress must never interrupt playback -- the next heartbeat or
        // state transition retries with the latest position.
      });
    },
    [client, mediaFileId]
  );

  const closeSession = useCallback(
    (event: PlaybackEventKind, completed: boolean) => {
      const session = sessionRef.current;
      if (!session || session.closed) return;
      session.closed = true;
      flushProgress(completed);
      void client.recordPlaybackEvent(session.sessionId, event).catch(() => {
        // Teardown stays best-effort: closing the player must not be
        // blocked by a network call that may never resolve.
      });
    },
    [client, flushProgress]
  );

  const recordEvent = useCallback(
    (event: PlaybackEventKind) => {
      const session = sessionRef.current;
      if (!session || session.closed) return;
      void client.recordPlaybackEvent(session.sessionId, event).catch(() => undefined);
    },
    [client]
  );

  // Negotiates and loads whenever `show()` sets a fresh `mediaFileId` and
  // negotiation resolves -- guarded by `loadedSessionIdRef` so an unrelated
  // re-render (e.g. `engineState` ticking on every `timeupdate`) never
  // re-triggers this. A brand-new `session_id` always means a genuinely new
  // negotiation happened (a fresh `show()` call, or a retried negotiation
  // after a transient failure), which is exactly when a reload is correct.
  useEffect(() => {
    if (negotiation.status !== 'ready' || !mediaFileId) return;
    const info = negotiation.data;
    if (loadedSessionIdRef.current === info.session_id) return;
    loadedSessionIdRef.current = info.session_id;

    // Close out whatever session was previously open (e.g. the user picked
    // a different title while one was already playing) before starting the
    // new one -- VegaPlaybackEngine.load() itself handles tearing down the
    // previous native player; this is the analytics-session half of that.
    closeSession({kind: 'stop', position_ms: latestPlaybackRef.current.positionMs, reason: 'user_stopped'}, false);

    engine.setPlaybackSessionId(info.session_id);
    sessionRef.current = {sessionId: info.session_id, mediaFileId, startedEvent: false, closed: false};

    const persisted = readActivePlayerSession(userId);
    const startPositionSeconds =
      launchOptions.startPositionSeconds ??
      (persisted?.mediaFileId === mediaFileId ? persisted.startPositionSeconds : undefined);

    writeActivePlayerSession(userId, {mediaFileId, startPositionSeconds, title: launchOptions.title});

    void engine
      .load({url: client.resolveUrl(info.url), mimeType: info.mime_type, startPositionSeconds})
      .then(async () => {
        if (info.subtitle_tracks.length === 0) return;
        await engine.addExternalSubtitleTracks(
          info.subtitle_tracks.map((track) => ({
            id: track.id,
            url: client.resolveUrl(track.url),
            label: track.label,
            language: track.language ?? undefined,
            forced: track.forced,
          }))
        );
        await engine.selectSubtitleTrack(info.selected_subtitle_track_id ?? null);
      })
      .then(() => engine.play())
      .catch(() => {
        // A rejected load()/play() already lands in engine.getState().error
        // via VegaPlaybackEngine's own reportFatalError -- this catch
        // exists only so it does not ALSO surface as an unhandled
        // rejection here.
      });
  }, [negotiation, mediaFileId, client, engine, launchOptions, userId, closeSession]);

  // Drives session-lifecycle events off real engine state transitions,
  // rather than off the actions (play()/pause()/seek()) that caused them --
  // this also correctly reports state changes the engine makes on its own
  // (e.g. buffering resolving back to "playing" needs no event; ending
  // naturally does).
  const previousEngineStateRef = useRef(engineState.state);
  useEffect(() => {
    const previous = previousEngineStateRef.current;
    previousEngineStateRef.current = engineState.state;
    const session = sessionRef.current;
    if (!session || session.mediaFileId !== mediaFileId || session.closed) return;

    if (engineState.state === 'ready' && !session.startedEvent) {
      session.startedEvent = true;
      recordEvent({kind: 'start'});
    } else if (engineState.state === 'playing' && previous === 'paused') {
      recordEvent({kind: 'resume', position_ms: latestPlaybackRef.current.positionMs});
    } else if (engineState.state === 'paused' && previous === 'playing') {
      recordEvent({kind: 'pause', position_ms: latestPlaybackRef.current.positionMs});
      flushProgress(false);
    } else if (engineState.state === 'ended') {
      closeSession({kind: 'stop', position_ms: latestPlaybackRef.current.positionMs, reason: 'completed'}, true);
      clearActivePlayerSession();
    } else if (engineState.state === 'error' && engineState.error) {
      closeSession({kind: 'error', message: engineState.error.message}, false);
    }
  }, [engineState.state, engineState.error, mediaFileId, recordEvent, flushProgress, closeSession]);

  // A lightweight heartbeat while genuinely playing -- ten seconds matches
  // tv-web's own `usePlaybackEngine.ts` cadence, frequent enough for a
  // useful resume position without hammering the backend.
  useEffect(() => {
    if (engineState.state !== 'playing') return;
    const interval = setInterval(() => {
      recordEvent({kind: 'heartbeat', position_ms: latestPlaybackRef.current.positionMs});
      flushProgress(false);
    }, 10_000);
    return () => clearInterval(interval);
  }, [engineState.state, recordEvent, flushProgress]);

  // Design doc §6.3's certification requirement: release/pause when the app
  // backgrounds. A full `engine.destroy()` (rather than just pausing) on
  // every background transition is deliberately NOT attempted here -- doing
  // that safely (re-negotiating and reloading the exact same position on
  // return to foreground, without a visible stutter or a lost resume point)
  // is real additional complexity this pass does not take on; pausing
  // already stops active decode/render work, which is the part a Fire TV
  // Stick's constrained resources actually care about moment to moment.
  const wasForegroundRef = useRef(foreground);
  useEffect(() => {
    if (wasForegroundRef.current && !foreground && engineState.state === 'playing') {
      void engine.pause();
    }
    wasForegroundRef.current = foreground;
  }, [foreground, engine, engineState.state]);

  const stop = useCallback(() => {
    void engine.pause();
    closeSession({kind: 'stop', position_ms: latestPlaybackRef.current.positionMs, reason: 'user_stopped'}, false);
    clearActivePlayerSession();
    setVisible(false);
    // Clearing `mediaFileId` (rather than leaving it set) is what makes a
    // later `show()` call for the SAME title negotiate a genuinely fresh
    // session instead of silently reusing the one `closeSession` just
    // closed: `usePlaybackInfo`'s own `enabled` gate is `Boolean(mediaFileId)`,
    // so `null -> mediaFileId` is a real dependency change even when the id
    // itself is unchanged, which re-runs negotiation and produces a new
    // `session_id` the loading effect above will treat as fresh.
    setMediaFileId(null);
    loadedSessionIdRef.current = null;
  }, [engine, closeSession]);

  const show = useCallback((id: string, options?: PlayerLaunchOptions) => {
    setMediaFileId(id);
    setLaunchOptions(options ?? {});
    setVisible(true);
  }, []);

  const hide = useCallback(() => setVisible(false), []);

  const isVisible = useCallback(() => visibleRef.current, []);

  useImperativeHandle(ref, () => ({show, hide, stop, isVisible}), [show, hide, stop, isVisible]);

  useBackHandler(() => {
    if (!visible) return false;
    hide();
    onClose?.();
    return true;
  });

  useRemoteKey((key) => {
    if (!visible) return;
    if (key === 'playPause') {
      void (engineState.state === 'playing' ? engine.pause() : engine.play());
    } else if (key === 'skipForward') {
      void engine.seek(engineState.currentTimeSeconds + 10);
    } else if (key === 'skipBackward') {
      void engine.seek(Math.max(0, engineState.currentTimeSeconds - 10));
    }
  });

  const cycleSubtitles = useCallback(() => {
    const tracks = engineState.subtitleTracks;
    if (tracks.length === 0) return;
    const currentIndex = tracks.findIndex((track) => track.id === engineState.selectedSubtitleTrackId);
    const nextTrack = currentIndex + 1 < tracks.length ? tracks[currentIndex + 1] : undefined;
    void engine.selectSubtitleTrack(nextTrack?.id ?? null);
  }, [engine, engineState.subtitleTracks, engineState.selectedSubtitleTrackId]);

  if (!visible) return null;

  const videoPlayer = engine.getVideoPlayer();
  const isNegotiating = negotiation.status === 'loading' || negotiation.status === 'idle';
  const isBuffering = engineState.state === 'loading' || engineState.state === 'buffering';
  const negotiationFailed = negotiation.status === 'error';
  const hasFatalError = engineState.state === 'error' && Boolean(engineState.error?.fatal);

  return (
    <View style={styles.root}>
      {videoPlayer ? <VegaVideoSurface videoPlayer={videoPlayer} style={styles.surface} /> : null}

      {(isNegotiating || isBuffering) && !negotiationFailed && !hasFatalError ? (
        <View style={styles.centeredOverlay}>
          <ActivityIndicator color={colour.focusRing} size="large" />
        </View>
      ) : null}

      {negotiationFailed || hasFatalError ? (
        <View style={styles.centeredOverlay}>
          <Text style={styles.errorTitle}>Playback unavailable</Text>
          <Text style={styles.errorMessage}>
            {negotiationFailed && negotiation.status === 'error' ? negotiation.message : engineState.error?.message}
          </Text>
          <Pressable accessibilityRole="button" style={styles.backButton} onPress={stop}>
            <Text style={styles.backButtonLabel}>Back</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.transportBar}>
        <Text style={styles.title} numberOfLines={1}>
          {launchOptions.title ?? 'Now playing'}
        </Text>
        <View style={styles.transportRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={engineState.state === 'playing' ? 'Pause' : 'Play'}
            style={styles.transportButton}
            onPress={() => void (engineState.state === 'playing' ? engine.pause() : engine.play())}
          >
            <Text style={styles.transportButtonLabel}>{engineState.state === 'playing' ? 'Pause' : 'Play'}</Text>
          </Pressable>
          {engineState.subtitleTracks.length > 0 ? (
            <Pressable accessibilityRole="button" style={styles.transportButton} onPress={cycleSubtitles}>
              <Text style={styles.transportButtonLabel}>
                {engineState.selectedSubtitleTrackId
                  ? engineState.subtitleTracks.find((track) => track.id === engineState.selectedSubtitleTrackId)?.label ?? 'Subtitles'
                  : 'Subtitles off'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" style={styles.transportButton} onPress={stop}>
            <Text style={styles.transportButtonLabel}>Stop</Text>
          </Pressable>
          <Text style={styles.clock}>
            {formatClock(engineState.currentTimeSeconds)} / {formatClock(engineState.durationSeconds)}
          </Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colour.bg,
  },
  surface: {
    ...StyleSheet.absoluteFillObject,
  },
  centeredOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sw(80),
  },
  errorTitle: {
    color: colour.ink,
    fontSize: sh(28),
    fontWeight: '700',
    marginBottom: sh(8),
  },
  errorMessage: {
    color: colour.inkSoft,
    fontSize: sh(18),
    textAlign: 'center',
    marginBottom: sh(24),
  },
  backButton: {
    paddingVertical: sh(10),
    paddingHorizontal: sw(24),
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
  },
  backButtonLabel: {
    color: colour.ink,
  },
  transportBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: sw(56),
    paddingVertical: sh(28),
    backgroundColor: 'rgba(21, 19, 21, 0.72)',
  },
  title: {
    color: colour.ink,
    fontSize: sh(20),
    fontWeight: '600',
    marginBottom: sh(12),
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transportButton: {
    paddingVertical: sh(10),
    paddingHorizontal: sw(18),
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
    marginRight: sw(12),
  },
  transportButtonLabel: {
    color: colour.ink,
  },
  clock: {
    color: colour.inkSoft,
    marginLeft: 'auto',
  },
});
