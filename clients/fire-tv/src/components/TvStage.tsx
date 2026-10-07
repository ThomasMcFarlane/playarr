/**
 * The shared hero-stage layout every full-bleed screen (Home's feature
 * panel, WorkDetail, MusicDetail) builds on -- design doc §4.7/§7: key art
 * layer, a dark wash over it, an absolutely-positioned title panel, and an
 * optional absolutely-positioned rail panel, entering with the staggered
 * fade-and-slide `tvStageGeometry.ts`'s `TV_STAGE_ENTRANCE` names.
 *
 * Ported from `clients/tv-web/web/src/components/tv/TvStage.tsx`'s
 * `TvStageShell` (the key-art/wash/children composition) with the
 * proportions themselves sourced from that file's CSS counterpart
 * (`.tv-key-art`/`.tv-stage-wash`/`.tv-title-panel`/`.tv-rail-panel` in
 * `global.css`), NOT from `TvStageShell`'s own React structure -- the web
 * version is a plain semantic `<section>` whose actual box geometry lives
 * entirely in CSS; this file has no CSS engine at all, so `tvStageGeometry
 * .ts`'s `computeTvStageGeometry()` stands in for what `clamp()`/`vw` would
 * otherwise do (see that module's own doc comment for the full reasoning).
 *
 * Two DELIBERATE simplifications versus the web version, stated honestly
 * rather than silently dropped:
 *
 *  1. No `object-position` equivalent for the key art image. CSS's
 *     `object-position: center 20%` lets the browser crop-and-pan a cover-
 *     fit image so its focal point sits 20% down from the top; RN's
 *     `<Image resizeMode="cover">` has no positioning knob at all (this is
 *     a real, structural RN limitation, not a Vega-specific one -- no
 *     assumption in design doc §1.3 covers it because it isn't uncertain,
 *     it's simply absent). This component anchors the key-art container
 *     itself with a small negative top offset instead, which approximates
 *     the same "slightly above centre" framing for a typical 16:9 backdrop
 *     without pretending to reproduce the exact CSS crop. Callers supplying
 *     artwork with an unusual aspect ratio may see a different crop than
 *     the web app's -- an acceptable, visible-not-silent trade-off.
 *  2. No CSS `mask-image` edge-fade on the key art's own right edge (the
 *     `.tv-key-art img`'s `mask-image: linear-gradient(...)` in global.css).
 *     RN/Fabric has no CSS mask primitive and `@amazon-devices/react-native-
 *     svg`'s `<Mask>` element would need the key art rendered as an SVG
 *     `<Image>` child rather than a plain RN `<Image>`, a much larger change
 *     for a purely decorative fade this component's `tvStageWash` gradient
 *     layers already substantially reproduce the visual effect of (they
 *     fade the SAME two edges, just via an overlay rather than a mask).
 *
 * Every screen using this component owns its own key art / title copy /
 * rail content -- `TvStage` itself renders no Streamarr-domain data at all,
 * matching `TvStageShell`'s own "dumb shell" role in the web app.
 */
import React, {useEffect, useRef} from 'react';
import {Animated, Dimensions, Easing, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import {colour} from '../theme/tokens';
import {
  TV_STAGE_EASING,
  TV_STAGE_ENTRANCE,
  TV_STAGE_KEY_ART,
  TV_STAGE_WASH,
  computeTvStageGeometry,
} from './tvStageGeometry';

/** `color-mix(in srgb, var(--surface) X%, transparent)`'s RN equivalent -- `colour.surface` is always a `#rrggbb` hex literal in this app (see `theme/tokens.ts`), so mixing it towards transparent is exactly "keep the RGB, scale the alpha", expressed here as an `rgba()` string RN's `ColorValue` accepts directly. */
function surfaceAtOpacity(mixPercent: number): string {
  const hex = colour.surface.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${mixPercent / 100})`;
}

export interface TvStageProps {
  /** The full-bleed backdrop layer -- typically an `<ArtworkImage>` filling its container, or `null`/`undefined` to render bare wash over `colour.surface`. */
  keyArt?: React.ReactNode;
  /** The kicker/title/meta copy block, absolutely positioned per `computeTvStageGeometry().titlePanel`. */
  titlePanel: React.ReactNode;
  /** The floating-glass rail panel (e.g. WorkDetail's season/episode rail), absolutely positioned per `computeTvStageGeometry().railPanel`. Omitted entirely (not just empty) on screens with no such panel -- Home's feature stage, for one, has none. */
  railPanel?: React.ReactNode;
  /** Anything that should render above every other layer (e.g. a primary play-action button) -- mirrors `TvStageShell`'s own trailing `children`. */
  children?: React.ReactNode;
  /**
   * Plays the entrance stagger once on mount. Defaults to `true`; screens
   * that re-mount `TvStage` on every focus change (rather than once per
   * navigation) should pass `false` to avoid replaying the animation on
   * every return visit, matching the web version's own `animation: ... both`
   * (CSS `animation` fires once per element mount, not per focus).
   */
  animateEntrance?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colour.surface,
  },
  keyArtLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  keyArtInner: {
    position: 'absolute',
    // Approximates `object-position: center 20%` by biasing the container
    // upward rather than centring it -- see this file's top doc comment,
    // simplification (1).
    top: `-${TV_STAGE_KEY_ART.objectPositionYPercent}%`,
    left: 0,
    width: `${TV_STAGE_KEY_ART.widthPercent}%`,
    height: `${TV_STAGE_KEY_ART.heightPercent}%`,
  },
  washLayer: {
    ...StyleSheet.absoluteFillObject,
  },
});

export function TvStage(props: TvStageProps): React.ReactElement {
  const {keyArt, titlePanel, railPanel, children, animateEntrance = true, style, accessibilityLabel} = props;

  // A geometry snapshot taken once per mount from the REAL viewport width
  // (`Dimensions.get('window').width`, not a baked 1920 baseline -- design
  // doc §4.7 is explicit that these clamp()/vw formulas must be evaluated
  // against the actual panel, precisely so a 4K panel and a 1080p Stick
  // both get the correct, un-scaled title-panel geometry), rather than
  // tracked reactively via `useWindowDimensions()`: re-computing (and
  // re-laying-out) on every dimension change would fight the entrance
  // animation below for no real benefit on a TV, whose display does not
  // resize mid-session outside the Vega virtual device's own dev-only
  // resize gesture.
  const geometryRef = useRef(computeTvStageGeometry(Dimensions.get('window').width));

  const keyArtAnim = useRef(new Animated.Value(animateEntrance ? 0 : 1)).current;
  const titleAnim = useRef(new Animated.Value(animateEntrance ? 0 : 1)).current;
  const railAnim = useRef(new Animated.Value(animateEntrance ? 0 : 1)).current;

  useEffect(() => {
    if (!animateEntrance) return;
    const easing = Easing.bezier(...TV_STAGE_EASING);
    const animation = Animated.parallel([
      Animated.timing(keyArtAnim, {
        toValue: 1,
        duration: TV_STAGE_ENTRANCE.keyArt.durationMs,
        delay: TV_STAGE_ENTRANCE.keyArt.delayMs,
        easing,
        useNativeDriver: true,
      }),
      Animated.timing(titleAnim, {
        toValue: 1,
        duration: TV_STAGE_ENTRANCE.titlePanel.durationMs,
        delay: TV_STAGE_ENTRANCE.titlePanel.delayMs,
        easing,
        useNativeDriver: true,
      }),
      Animated.timing(railAnim, {
        toValue: 1,
        duration: TV_STAGE_ENTRANCE.railPanel.durationMs,
        delay: TV_STAGE_ENTRANCE.railPanel.delayMs,
        easing,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    // Stop (rather than let dangling callbacks fire) if the stage unmounts
    // mid-entrance -- e.g. Back pressed the instant a detail screen opens.
    return () => animation.stop();
    // Deliberately runs once per mount only: animateEntrance/the three
    // Animated.Value refs are stable for the lifetime of one TvStage
    // instance, and re-triggering this effect on every re-render would
    // replay the entrance on every parent state update, not just on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const geometry = geometryRef.current;

  return (
    <View style={[styles.root, style]} accessibilityLabel={accessibilityLabel}>
      {keyArt !== undefined ? (
        <Animated.View
          style={[
            styles.keyArtLayer,
            {
              opacity: keyArtAnim,
              transform: [
                {
                  translateX: keyArtAnim.interpolate({inputRange: [0, 1], outputRange: [-24, 0]}),
                },
                {
                  scale: keyArtAnim.interpolate({inputRange: [0, 1], outputRange: [1.06, 1]}),
                },
              ],
            },
          ]}
        >
          <View style={styles.keyArtInner}>{keyArt}</View>
        </Animated.View>
      ) : null}

      <View style={styles.washLayer} pointerEvents="none">
        <LinearGradient
          style={StyleSheet.absoluteFillObject}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 0}}
          colors={[surfaceAtOpacity(TV_STAGE_WASH.left.surfaceMixPercent), 'transparent']}
          locations={[0, TV_STAGE_WASH.left.stopPercent / 100]}
        />
        <LinearGradient
          style={StyleSheet.absoluteFillObject}
          start={{x: 1, y: 0}}
          end={{x: 0, y: 0}}
          colors={[surfaceAtOpacity(TV_STAGE_WASH.right.surfaceMixPercent), 'transparent']}
          locations={[0, TV_STAGE_WASH.right.stopPercent / 100]}
        />
      </View>

      <Animated.View
        style={{
          position: 'absolute',
          top: `${geometry.titlePanel.topPercent}%`,
          left: geometry.titlePanel.left,
          width: geometry.titlePanel.width,
          opacity: titleAnim,
          transform: [
            {translateX: titleAnim.interpolate({inputRange: [0, 1], outputRange: [-34, 0]})},
          ],
        }}
      >
        {titlePanel}
      </Animated.View>

      {railPanel !== undefined ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: `${geometry.railPanel.topPercent}%`,
            right: `${geometry.railPanel.rightPercent}%`,
            width: `${geometry.railPanel.widthPercent}%`,
            minHeight: `${geometry.railPanel.minHeightPercent}%`,
            opacity: railAnim,
            transform: [
              {translateX: railAnim.interpolate({inputRange: [0, 1], outputRange: [60, 0]})},
            ],
          }}
        >
          {railPanel}
        </Animated.View>
      ) : null}

      {children}
    </View>
  );
}
