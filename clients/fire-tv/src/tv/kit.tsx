/**
 * Building blocks for the web-parity screens. Every measurement is the web TV layout's CSS pixel at 1920x1080, scaled by
 * `u()` so a panel of another resolution keeps the proportions. Text always goes through `T`, which picks the static
 * Nunito Sans instance for the weight (Vega ignores `fontWeight` for variable fonts).
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View, type NativeSyntheticEvent, type StyleProp, type TextLayoutEventData, type TextStyle, type ViewStyle} from 'react-native';
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
  onTextLayout?: (event: NativeSyntheticEvent<TextLayoutEventData>) => void;
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

export function T({size, weight = 400, ls, lh, color, upper, mono, lines, style, onTextLayout, children}: TProps): React.ReactElement {
  const run = textRun(u(size), weight, {letterSpacing: ls === undefined ? undefined : u(ls), lineHeight: lh === undefined ? undefined : u(lh), mono});
  return (
    <Text
      numberOfLines={lines}
      onTextLayout={onTextLayout}
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

/**
 * Text that wraps the way CSS `text-wrap: balance` does: the same number of lines as the plain wrap, at the narrowest width
 * that keeps that number (the web balances its big titles, so "2 Fast 2 Furious" breaks as "2 Fast / 2 Furious").
 * Vega has no balancing, so the width is searched by re-laying the text out, which settles within a few frames.
 */
export function BalancedT({width, children, ...text}: Omit<TProps, 'onTextLayout'> & {width: number}): React.ReactElement {
  const [state, setState] = useState<{w: number; lines: number | null; done: boolean}>({w: width, lines: null, done: false});
  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>): void => {
    if (state.done) return;
    const found = event.nativeEvent.lines;
    const unit = Dimensions.get('window').width / 1920;
    const widest = Math.max(...found.map((line) => line.width)) / unit;
    setState((current) => {
      if (current.done) return current;
      if (current.lines === null) {
        // First layout at the full width: remember the line count; one line needs no balancing.
        return found.length <= 1 ? {w: width, lines: found.length, done: true} : {w: Math.max(1, widest - 1), lines: found.length, done: false};
      }
      if (found.length > current.lines || widest <= 4) return {...current, w: Math.min(width, current.w + 2), done: true};
      return {...current, w: Math.max(1, widest - 1)};
    });
  };
  return (
    <View style={{width: u(state.w)}}>
      <T {...text} onTextLayout={onTextLayout}>
        {children}
      </T>
    </View>
  );
}
