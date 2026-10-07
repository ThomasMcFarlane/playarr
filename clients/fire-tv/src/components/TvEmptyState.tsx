/**
 * The shared, borderless empty/error state every screen with a collection
 * that might legitimately have nothing in it uses -- design doc §7's
 * closing paragraph names this component with "8 SVG variants: home/
 * movies/series/music/search/playlist/move/details", ported verbatim from
 * `clients/tv-web/web/src/components/tv/TvEmptyState.tsx`'s own
 * `EmptyStateGraphic` path data (every `<path d="...">` below is copied
 * character-for-character from that file), redrawn as
 * `@amazon-devices/react-native-svg` elements instead of DOM `<svg>`.
 *
 * One necessary substitution: the web version's paths use
 * `stroke="currentColor"` so the glyph inherits whatever text colour its
 * CSS class cascade applies (`tone-error` vs the default). RN's SVG has no
 * CSS cascade at all, so `stroke`/`fill` are resolved to a real colour value
 * up front from the `tone` prop instead -- `colour.danger` for `tone=
 * "error"`, `colour.inkMuted` otherwise (matching the web version's default
 * text colour for an empty-state icon).
 */
import React from 'react';
import {StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Circle, Path, Rect} from '@amazon-devices/react-native-svg';
import {colour} from '../theme/tokens';
import {text as textStyle} from '../theme/styles';
import {sw} from '../theme/scale';

export type TvEmptyStateVariant = 'page' | 'rail' | 'track' | 'compact';
export type TvEmptyStateTone = 'empty' | 'error';
export type TvEmptyStateGraphic =
  | 'home'
  | 'movies'
  | 'series'
  | 'music'
  | 'search'
  | 'playlist'
  | 'move'
  | 'details';

export interface TvEmptyStateProps {
  title: string;
  description?: string;
  graphic?: TvEmptyStateGraphic;
  tone?: TvEmptyStateTone;
  variant?: TvEmptyStateVariant;
  style?: StyleProp<ViewStyle>;
}

/** Icon canvas size in design-canvas pixels, scaled via `sw()` like every other measurement in this app. `page`/`rail` get a larger glyph than `track`/`compact`, mirroring the web version's own per-variant `.tv-empty-state-art` sizing. */
const GRAPHIC_SIZE: Record<TvEmptyStateVariant, number> = {
  page: 96,
  rail: 72,
  track: 56,
  compact: 40,
};

const SHARED_PATH_PROPS = {
  fill: 'none' as const,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/**
 * Ported element-for-element from `TvEmptyState.tsx`'s `EmptyStateGraphic`
 * in `clients/tv-web/web/src/components/tv/TvEmptyState.tsx` -- the `48x32`
 * viewBox, every `<path>`'s `d` attribute, and every `<circle>`/`<rect>`'s
 * geometry below are unchanged from that file, using
 * `@amazon-devices/react-native-svg`'s real `Circle`/`Rect` elements rather
 * than approximating a circle as a `Path` arc.
 */
function EmptyStateGraphic({graphic, colourValue}: {graphic: TvEmptyStateGraphic; colourValue: string}) {
  switch (graphic) {
    case 'home':
      return (
        <>
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="m8 16 16-11 16 11" />
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="M12 14v13h24V14M20 27v-8h8v8" />
        </>
      );
    case 'movies':
      return (
        <>
          <Rect {...SHARED_PATH_PROPS} stroke={colourValue} x={6} y={7} width={36} height={20} rx={3} />
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="M13 7v20M35 7v20M6 13h7M6 21h7M35 13h7M35 21h7" />
          <Path stroke="none" fill={colourValue} d="m21 13 8 4-8 4z" />
        </>
      );
    case 'series':
      return (
        <>
          <Rect {...SHARED_PATH_PROPS} stroke={colourValue} x={7} y={8} width={34} height={20} rx={3} />
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="m18 3 6 5 6-5M13 14h16M13 20h12M35 14v8" />
        </>
      );
    case 'music':
      return (
        <>
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="M19 25V8l20-4v16" />
          <Circle {...SHARED_PATH_PROPS} stroke={colourValue} cx={13} cy={25} r={6} />
          <Circle {...SHARED_PATH_PROPS} stroke={colourValue} cx={33} cy={20} r={6} />
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="M19 14l20-4" />
        </>
      );
    case 'search':
      return (
        <>
          <Circle {...SHARED_PATH_PROPS} stroke={colourValue} cx={21} cy={14} r={9} />
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="m28 21 9 8M17 14h8" />
        </>
      );
    case 'move':
      return (
        <>
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="M7 8h23M7 16h19M7 24h23" />
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="m34 12 7 4-7 4M38 8v16" />
        </>
      );
    case 'details':
      return (
        <>
          <Rect {...SHARED_PATH_PROPS} stroke={colourValue} x={7} y={5} width={34} height={22} rx={3} />
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="M13 12h14M13 17h20M13 22h12" />
          <Circle stroke="none" fill={colourValue} cx={35} cy={11} r={2} />
        </>
      );
    case 'playlist':
    default:
      return (
        <>
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="M8 8h25M8 16h20M8 24h25" />
          <Path {...SHARED_PATH_PROPS} stroke={colourValue} d="M38 13v12M32 19h12" />
        </>
      );
  }
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: sw(32),
    paddingHorizontal: sw(24),
  },
  copy: {
    marginTop: sw(16),
    alignItems: 'center',
  },
  title: {
    ...textStyle.bodyEmphasis,
    textAlign: 'center',
  },
  description: {
    ...textStyle.caption,
    color: colour.inkMuted,
    textAlign: 'center',
    marginTop: sw(6),
  },
});

/**
 * Shared, borderless TV empty state for a valid collection with no content
 * (or, with `tone="error"`, a collection that failed to load). `variant`
 * controls sizing only -- `page` for a whole empty screen, `rail`/`track`
 * for an empty `TvMediaTrack`, `compact` for a tight inline spot (e.g. an
 * empty settings sub-list).
 */
export function TvEmptyState(props: TvEmptyStateProps): React.ReactElement {
  const {title, description, graphic = 'details', tone = 'empty', variant = 'rail', style} = props;
  const size = GRAPHIC_SIZE[variant];
  const colourValue = tone === 'error' ? colour.danger : colour.inkMuted;

  return (
    <View
      style={[styles.root, style]}
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLabel={description ? `${title}. ${description}` : title}
    >
      <Svg width={sw(size)} height={sw(size) * (32 / 48)} viewBox="0 0 48 32">
        <EmptyStateGraphic graphic={graphic} colourValue={colourValue} />
      </Svg>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
    </View>
  );
}
