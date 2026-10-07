/**
 * A thin wrapper around `@amazon-devices/react-native-w3cmedia`'s
 * `KeplerVideoView`, plus the `setMediaControlFocus` wiring design doc §6.3
 * names explicitly: "`player.setMediaControlFocus(useComponentInstance())`
 * gives remote play/pause/seek AND Alexa transport control for free."
 *
 * `KeplerVideoView` itself already renders video frames, captions and
 * (optionally) Vega's own media-controls UI given nothing more than a
 * `videoPlayer` prop (confirmed against the real `.d.ts`, not guessed) --
 * this component's only real job beyond forwarding that prop through is
 * calling `setMediaControlFocus` once this component (specifically, the
 * `IComponentInstance` `useComponentInstance()` resolves for it) is mounted,
 * so the physical remote's play/pause/skip keys and Alexa's own transport
 * intents route to `videoPlayer` rather than nothing.
 *
 * This is the ONE component `VegaPlaybackEngine`'s decoder is ever
 * rendered through. Design doc §4.2/§6.3: because the engine (and its
 * underlying `VideoPlayer`) is a shell-mounted singleton independent of this
 * component's own React lifecycle, mounting/unmounting `VegaVideoSurface`
 * (e.g. hiding the player's visual surface while a minimised music track
 * keeps playing) does NOT start or stop playback -- it only shows or hides
 * the rendered frame. `PlayerScreen.tsx` relies on exactly this: it renders
 * this component only while `visible`, and leaves it out of the tree
 * entirely otherwise, with the engine continuing to play regardless.
 *
 * `videoPlayer` below is typed as `VegaVideoPlayerLike`
 * (`VegaPlaybackEngine.ts`'s own hand-narrowed interface, exactly what
 * `VegaPlaybackEngine.getVideoPlayer()` returns), NOT the real
 * `@amazon-devices/react-native-w3cmedia` `VideoPlayer` class -- that class
 * carries private fields, which TypeScript treats as a nominal brand no
 * structurally-equivalent object literal or narrower interface can satisfy,
 * confirmed directly by a real `tsc` run against the concrete type. Casting
 * at the one call site inside this file (never at `PlayerScreen.tsx`, which
 * must not import `@amazon-devices/*` types at all -- this app's isolation
 * principle, design doc §1.3) is what keeps that real-vs-narrowed distinction
 * from leaking into the one file that is deliberately not allowed to know
 * the real type exists.
 */
import React, {useEffect} from 'react';
import type {StyleProp, ViewStyle} from 'react-native';
import {KeplerVideoView} from '@amazon-devices/react-native-w3cmedia';
import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {useComponentInstance} from '@amazon-devices/react-native-kepler';
import type {VegaVideoPlayerLike} from './VegaPlaybackEngine';

export interface VegaVideoSurfaceProps {
  /** `VegaPlaybackEngine.getVideoPlayer()`'s return value. `KeplerVideoView` renders nothing meaningful for a `null` player, so callers should not mount this component until a source has actually loaded. */
  videoPlayer: VegaVideoPlayerLike;
  style?: StyleProp<ViewStyle>;
  /** Renders Vega's own built-in media-controls UI. Defaults to `false` -- `PlayerScreen.tsx` draws its own transport-control bar (design doc §7's Player screen), the same choice `player-shaka`'s web adapter makes by not using the browser's native `<video controls>` UI either. */
  showControls?: boolean;
  /** Renders captions/subtitles baked into `KeplerVideoView`'s own overlay. Defaults to `true` -- there is no separate custom subtitle renderer in this app, unlike the controls bar above. */
  showCaptions?: boolean;
  /**
   * Routes the remote's transport keys (and, as a side effect, its directional keys) to the platform media controls. The
   * player draws its own controls and moves focus itself, so it turns this off: with it on, LEFT and RIGHT seek natively
   * and the D-pad never reaches the app's focus engine. Defaults to `true`.
   */
  mediaControlFocus?: boolean;
}

/**
 * `VegaVideoSurface` is a MOUNTING CONTRACT, not a route: it renders
 * whatever `videoPlayer` it is given and nothing more -- no negotiation, no
 * shell chrome, no back handling. `PlayerScreen.tsx` (this component's one
 * real caller) owns all of that; this file exists purely to keep every
 * `@amazon-devices/react-native-w3cmedia`/`@amazon-devices/react-native-
 * kepler` import contained to `src/platform/media/`, per this app's
 * isolation principle (design doc §1.3's closing paragraph).
 */
export function VegaVideoSurface(props: VegaVideoSurfaceProps): React.ReactElement {
  const {videoPlayer, style, showControls = false, showCaptions = true, mediaControlFocus = true} = props;
  const componentInstance = useComponentInstance();

  // The one cast this file exists to contain -- see this file's own top
  // comment for why `VegaVideoPlayerLike` (a hand-narrowed interface) can
  // never structurally satisfy the real `VideoPlayer` class, and why that
  // cast belongs here rather than at `PlayerScreen.tsx`'s call site.
  const realVideoPlayer = videoPlayer as unknown as VideoPlayer;

  // Synchronising `videoPlayer`'s remote/Alexa transport-control focus with
  // this component's own Kepler component instance -- an external system
  // (Vega's media-control routing), not something derivable from props or
  // driven by a user action, so this repo's own React rule reserves
  // `useEffect` for exactly this.
  useEffect(() => {
    if (!mediaControlFocus) return undefined;
    let cancelled = false;
    realVideoPlayer.setMediaControlFocus(componentInstance).catch((error: unknown) => {
      if (!cancelled) {
        console.warn('[VegaVideoSurface] setMediaControlFocus failed -- remote/Alexa transport controls may not reach this player', error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [realVideoPlayer, componentInstance, mediaControlFocus]);

  return (
    <KeplerVideoView
      videoPlayer={realVideoPlayer}
      style={style}
      showControls={showControls}
      showCaptions={showCaptions}
      scalingmode="fit"
    />
  );
}
