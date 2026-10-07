/**
 * Building blocks for the web-parity screens. Every measurement is the web TV layout's CSS pixel at 1920x1080, scaled by
 * `u()` so a panel of another resolution keeps the proportions. Text always goes through `T`, which picks the static
 * Nunito Sans instance for the weight (Vega ignores `fontWeight` for variable fonts).
 */
import React from 'react';
import {StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle} from 'react-native';
import {Dimensions, PixelRatio} from 'react-native';
import {textRun} from '../theme/fonts';
import {useTheme} from '../theme/ThemeProvider';

/** One web CSS pixel in device pixels. */
export function u(value: number): number {
  const scale = Dimensions.get('window').width / 1920;
  return PixelRatio.roundToNearestPixel(value * scale);
}

export interface BoxProps {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  bg?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}

/** An absolutely positioned box in web pixels. */
export function Box({x = 0, y = 0, w, h, r, bg, style, children, pointerEvents}: BoxProps): React.ReactElement {
  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        {
          position: 'absolute',
          left: u(x),
          top: u(y),
          width: w === undefined ? undefined : u(w),
          height: h === undefined ? undefined : u(h),
          borderRadius: r === undefined ? undefined : u(r),
          backgroundColor: bg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface TProps {
  /** CSS font size in px. */
  size: number;
  /** CSS font weight. */
  weight?: number;
  /** Letter spacing in px. */
  ls?: number;
  /** Line height in px. */
  lh?: number;
  color: string;
  upper?: boolean;
  mono?: boolean;
  lines?: number;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

/**
 * Where a browser puts the glyphs inside a line box: the extra line height splits evenly above and below the font's
 * content area (Nunito Sans: 1.364 em). Vega places the first line at the top of the box, so text is moved down by that
 * half-leading. When the line height is smaller than the content area (the big titles) the correction is smaller.
 * Calibrated on the device against the web's text positions.
 */
export function halfLeading(size: number, lh: number | undefined): number {
  if (lh === undefined) return 0;
  const content = 1.364 * size;
  return lh >= content ? (lh - content) / 2 : (content - lh) * 0.18;
}

export function T({size, weight = 400, ls, lh, color, upper, mono, lines, style, children}: TProps): React.ReactElement {
  const run = textRun(u(size), weight, {letterSpacing: ls === undefined ? undefined : u(ls), lineHeight: lh === undefined ? undefined : u(lh), mono});
  return (
    <Text
      numberOfLines={lines}
      allowFontScaling={false}
      style={[run, {color, includeFontPadding: false, position: 'relative', top: u(halfLeading(size, lh))}, upper ? {textTransform: 'uppercase'} : null, style]}
    >
      {children}
    </Text>
  );
}

export function Fill({style, children}: {style?: StyleProp<ViewStyle>; children?: React.ReactNode}): React.ReactElement {
  return <View style={[StyleSheet.absoluteFill, style]}>{children}</View>;
}

export function useColours(): ReturnType<typeof useTheme> {
  return useTheme();
}
