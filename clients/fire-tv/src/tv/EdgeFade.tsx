/**
 * The shared scroll-edge fade (owner rule: every scrollable area fades on each side where content continues).
 *
 * Sizes and tokens are the web's: Home and library tracks fade scrolled-past content over a 152 px gutter to the LEFT of
 * the track's start line (the web masks the track; Vega has no masks, so the gutter is covered with the page colour at
 * full opacity fading to clear, and a card at rest sits on the start line, clear). Every other edge is the 54 px shade:
 * the ink glow `rgba(31,14,20)` at 0.58 of 0.42 in light, and the page-background scrim in dark, where an ink shade would
 * be invisible. Opacity animates over 180 ms like the web's transition.
 */
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import {blend, mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {u} from './kit';

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

export const TRACK_GUTTER = 152;
export const EDGE_SIZE = 54;

export interface EdgeFadeProps {
  side: EdgeSide;
  /** True while content continues beyond this edge. */
  active: boolean;
  /** The scrolling viewport the fade sits inside, in web pixels; the fade hugs its `side` edge. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Thickness; defaults to the 152 px track gutter for `left` on a track, 54 px otherwise. */
  size?: number;
  /** `gutter` covers with the page colour (track mask); `shade` is the glow. */
  kind?: 'gutter' | 'shade';
  /** The gutter lies over the Home frost panel: blend towards it so no box shows. */
  tint?: boolean;
}

export function EdgeFade({side, active, x, y, w, h, size, kind = 'shade', tint}: EdgeFadeProps): React.ReactElement {
  const {colour, scheme} = useTheme();
  const opacity = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(opacity, {toValue: active ? 1 : 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true}).start();
  }, [active, opacity]);

  const horizontal = side === 'left' || side === 'right';
  const thickness = size ?? (kind === 'gutter' ? TRACK_GUTTER : EDGE_SIZE);
  const base = kind === 'gutter' ? colour.surface : scheme === 'dark' ? colour.surface : 'rgba(31, 14, 20, 1)';
  const strength = kind === 'gutter' ? 1 : scheme === 'dark' ? 0.92 : 0.3;
  // Colour at the screen edge first, clear last.
  const edge = mix(base, strength);
  const clear = mix(base, 0);
  // The gutter sits over the Home frost, whose alpha ramps 0 -> 0.72 (0.68 light) across it: match the page colour there.
  const frost = blend(colour.surfaceSoft, colour.surfaceStrong, scheme === 'dark' ? 0.44 : 0.48);
  const frostAlpha = scheme === 'dark' ? 0.72 : 0.68;
  const stops =
    kind === 'gutter' && tint
      ? [colour.surface, mix(blend(frost, colour.surface, frostAlpha * 0.35), 0.62), mix(blend(frost, colour.surface, frostAlpha * 0.7), 0.22), mix(blend(frost, colour.surface, frostAlpha), 0)]
      : [edge, mix(base, strength * 0.35), clear];
  const locations = stops.length === 4 ? [0, 0.35, 0.7, 1] : [0, 0.45, 1];
  const forward = side === 'left' || side === 'top';
  const start = horizontal ? {x: forward ? 0 : 1, y: 0} : {x: 0, y: forward ? 0 : 1};
  const end = horizontal ? {x: forward ? 1 : 0, y: 0} : {x: 0, y: forward ? 1 : 0};
  const left = side === 'right' ? x + w - thickness : x;
  const top = side === 'bottom' ? y + h - thickness : y;
  return (
    <Animated.View
      pointerEvents="none"
      style={{position: 'absolute', left: u(left), top: u(top), width: u(horizontal ? thickness : w), height: u(horizontal ? h : thickness), opacity}}
    >
      <LinearGradient style={StyleSheet.absoluteFill} start={start} end={end} colors={stops} locations={locations} />
    </Animated.View>
  );
}
