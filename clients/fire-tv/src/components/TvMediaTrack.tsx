/**
 * A horizontal, focusable rail with a heading and edge-fade -- the shared
 * building block every "row of posters" screen (Home's genre rails,
 * WorkDetail's similar-titles rail, a season's episode rail, a search
 * result group) is built from. Ported from
 * `clients/tv-web/web/src/components/tv/TvStage.tsx`'s own `TvMediaTrack`,
 * with `FlashList` (`@amazon-devices/shopify__flash-list`) standing in for
 * the web version's plain scrollable `<div>` -- design doc §3.1 names this
 * package specifically for "horizontal rails and the library grid", and
 * §4.4's focus-model table maps `data-tv-scroll-container`/
 * `data-tv-scroll-axis="horizontal"` onto exactly this component owning a
 * real `FlashList` rather than a DOM scroll container the web version's own
 * `useTvNavigation.ts` has to manage by hand.
 *
 * The edge-fade itself (`scrollEdges.ts`'s `computeScrollEdges`) is a direct
 * port of the web version's `useScrollEdges` hook, reduced to pure
 * arithmetic over the three numbers `FlashList`'s own `onScroll` event
 * already reports natively -- see that module's doc comment for the full
 * DOM-vs-native comparison.
 *
 * Generic over `TItem` exactly like `FlashListProps<T>` itself, so this
 * component carries no opinion at all about what a "poster" is --
 * `PosterCard.tsx` is one obvious `renderItem`, but nothing here requires
 * it (a settings screen's horizontal option list is an equally valid use).
 */
import React, {useCallback, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {FlashList, type ListRenderItem} from '@amazon-devices/shopify__flash-list';
import {LinearGradient} from '@amazon-devices/react-linear-gradient';
import {colour, spacing} from '../theme/tokens';
import {text as textStyle} from '../theme/styles';
import {sw} from '../theme/scale';
import {computeScrollEdges} from './scrollEdges';

const EDGE_FADE_WIDTH = 48;

export interface TvMediaTrackProps<TItem> {
  title: string;
  meta?: string;
  /**
   * Whether this is the rail currently receiving spatial-nav focus, on a
   * screen with more than one rail stacked vertically. Threaded straight
   * through to each rendered item as `PosterCard`'s own `activeRailFactor`
   * would expect -- this component does not itself apply any visual change
   * for `active`; it exists purely so a screen can pass it down without
   * needing to track focus state twice.
   */
  active?: boolean;
  data: ReadonlyArray<TItem> | null | undefined;
  renderItem: ListRenderItem<TItem>;
  keyExtractor: (item: TItem, index: number) => string;
  /** `FlashList`'s own required performance hint -- the average/median item width along the scroll axis. See `@amazon-devices/shopify__flash-list`'s own docs on `estimatedItemSize`; there is no safe universal default, callers must measure their own item. */
  estimatedItemSize: number;
  /** Rendered in place of the list when `data` is empty (or `null`/`undefined`) -- typically a `<TvEmptyState variant="track">`. */
  emptyState?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const styles = StyleSheet.create({
  root: {
    marginBottom: sw(spacing.xl),
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: sw(12),
  },
  title: {
    ...textStyle.title,
  },
  meta: {
    ...textStyle.caption,
    color: colour.inkMuted,
  },
  window: {
    position: 'relative',
  },
  edgeFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: EDGE_FADE_WIDTH,
    zIndex: 1,
  },
  edgeFadeLeft: {
    left: 0,
  },
  edgeFadeRight: {
    right: 0,
  },
});

export function TvMediaTrack<TItem>(props: TvMediaTrackProps<TItem>): React.ReactElement {
  const {
    title,
    meta,
    data,
    renderItem,
    keyExtractor,
    estimatedItemSize,
    emptyState,
    style,
    accessibilityLabel,
  } = props;

  const [edges, setEdges] = useState({start: false, end: false});

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {contentOffset, layoutMeasurement, contentSize} = event.nativeEvent;
    setEdges(computeScrollEdges(contentOffset.x, layoutMeasurement.width, contentSize.width));
  }, []);

  const isEmpty = !data || data.length === 0;

  return (
    <View style={[styles.root, style]} accessibilityLabel={accessibilityLabel}>
      <View style={styles.heading}>
        <Text style={styles.title}>{title}</Text>
        {meta !== undefined ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>

      {isEmpty ? (
        emptyState
      ) : (
        <View style={styles.window}>
          <FlashList
            horizontal
            data={data}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            estimatedItemSize={estimatedItemSize}
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={32}
          />
          {edges.start ? (
            <LinearGradient
              pointerEvents="none"
              style={[styles.edgeFade, styles.edgeFadeLeft]}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              colors={[colour.bg, 'transparent']}
            />
          ) : null}
          {edges.end ? (
            <LinearGradient
              pointerEvents="none"
              style={[styles.edgeFade, styles.edgeFadeRight]}
              start={{x: 1, y: 0}}
              end={{x: 0, y: 0}}
              colors={[colour.bg, 'transparent']}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
