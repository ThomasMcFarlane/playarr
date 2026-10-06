/**
 * The persistent bottom nav pill -- design doc §2's file-purpose comment:
 * "the grouped bottom nav pill, gated on `/catalog/kinds`". Ported from
 * `clients/tv-web/web/src/App.tsx`'s own `<nav className="app-nav">` block
 * (icon + expanding label per `NavLink`, grouped into `search`/`library`/
 * `playlists` pill clusters), with the actual grouping/gating logic living
 * in `navGroups.ts` (kept dependency-free there specifically so it can be
 * unit-tested -- see that file's own doc comment).
 *
 * Icon glyphs are copied path-for-path from
 * `clients/tv-web/web/src/components/NavIcons.tsx`'s `HomeIcon`/
 * `SearchIcon`/`SeriesIcon`/`MoviesIcon`/`SitesIcon`/`MusicIcon`/
 * `PlaylistsIcon`, redrawn with `@amazon-devices/react-native-svg` in place
 * of the web version's DOM `<svg>`/`stroke="currentColor"` (RN's SVG has no
 * CSS cascade -- see `TvEmptyState.tsx`'s own doc comment for the same
 * substitution and reasoning).
 *
 * Each item is a `Pressable` rather than a `TouchableOpacity`/`<Button>`:
 * design doc §4.4 is explicit that only those latter two get "free" focus
 * feedback on Vega, and a nav pill's expand-on-focus treatment (label width
 * animating in, matching `.app-nav-link`'s own `min-width`/`gap`/`width`
 * transitions in global.css) is bespoke enough that this component drives
 * it itself via `onFocus`/`onBlur`, the same policy `PosterCard.tsx`
 * follows.
 */
import React, {useState} from 'react';
import {Animated, Pressable, StyleSheet, Text, View, type GestureResponderEvent} from 'react-native';
import Svg, {Circle, Path} from '@amazon-devices/react-native-svg';
import {colour} from '../theme/tokens';
import {text as textStyle} from '../theme/styles';
import {sw} from '../theme/scale';
import type {WorkKind} from '@playarr-tv/api-client';
import type {RouteName} from '../navigation/routes';
import {NAV_GROUPS, visibleNavGroups, type NavIconName, type NavItem} from './navGroups';

const ICON_SHARED = {
  fill: 'none' as const,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Path data copied character-for-character from `NavIcons.tsx` -- see this file's top doc comment. */
function NavIcon({name, colourValue}: {name: NavIconName; colourValue: string}) {
  switch (name) {
    case 'home':
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Path {...ICON_SHARED} stroke={colourValue} d="M3 11.5 12 4l9 7.5" />
          <Path {...ICON_SHARED} stroke={colourValue} d="M5.5 9.5V20h13V9.5" />
          <Path {...ICON_SHARED} stroke={colourValue} d="M10 20v-6h4v6" />
        </Svg>
      );
    case 'search':
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Circle {...ICON_SHARED} stroke={colourValue} cx={10.5} cy={10.5} r={6.5} />
          <Path {...ICON_SHARED} stroke={colourValue} d="m15.5 15.5 4.5 4.5" />
        </Svg>
      );
    case 'movies':
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Path {...ICON_SHARED} stroke={colourValue} d="M3 5h18v14H3z" />
          <Path {...ICON_SHARED} stroke={colourValue} d="m7 5 2-3M13 5l2-3M19 5l2-3" />
          <Path stroke="none" fill={colourValue} d="m10 10 5 2.5-5 2.5z" />
        </Svg>
      );
    case 'series':
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Path {...ICON_SHARED} stroke={colourValue} d="M4 4h16v16H4z" />
          <Path {...ICON_SHARED} stroke={colourValue} d="M8 9h8M8 13h8M8 17h5" />
          <Path {...ICON_SHARED} stroke={colourValue} d="m10 1 2 3 2-3" />
        </Svg>
      );
    case 'sites':
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Circle {...ICON_SHARED} stroke={colourValue} cx={12} cy={12} r={8.5} />
          <Path
            {...ICON_SHARED}
            stroke={colourValue}
            d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"
          />
        </Svg>
      );
    case 'music':
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Path {...ICON_SHARED} stroke={colourValue} d="M9 18V6l10-2v12" />
          <Circle {...ICON_SHARED} stroke={colourValue} cx={6.5} cy={18.5} r={2.5} />
          <Circle {...ICON_SHARED} stroke={colourValue} cx={16.5} cy={16.5} r={2.5} />
          <Path {...ICON_SHARED} stroke={colourValue} d="M9 10l10-2" />
        </Svg>
      );
    case 'playlists':
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Path {...ICON_SHARED} stroke={colourValue} d="M5 6h10M5 10h10M5 14h6" />
          <Path {...ICON_SHARED} stroke={colourValue} d="M17 13.5v6" />
          <Path {...ICON_SHARED} stroke={colourValue} d="m17 13.5 4-1.5v5.5" />
          <Circle {...ICON_SHARED} stroke={colourValue} cx={15.5} cy={19.5} r={1.5} />
          <Circle {...ICON_SHARED} stroke={colourValue} cx={19.5} cy={17.5} r={1.5} />
        </Svg>
      );
  }
}

export interface NavRailProps {
  /** `GET /api/v1/catalog/kinds`'s resolved result, or `null` before it has resolved -- passed straight through to `visibleNavGroups`; see that function's own doc comment for why `null` hides the whole rail rather than rendering a partial guess. */
  availableWorkKinds: ReadonlySet<WorkKind> | null;
  activeRoute: RouteName;
  onNavigate: (route: RouteName) => void;
  /** Overrides `NAV_GROUPS` -- exists for tests and Storybook-style previews, never needed by a real screen. */
  groups?: typeof NAV_GROUPS;
}

const EXPANDED_LABEL_WIDTH = 74;

function NavLink({
  item,
  isActive,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate: (route: RouteName) => void;
}) {
  const [focused, setFocused] = useState(false);
  const expanded = focused || isActive;
  const labelWidth = useState(() => new Animated.Value(isActive ? EXPANDED_LABEL_WIDTH : 0))[0];

  const handleFocus = () => {
    setFocused(true);
    Animated.timing(labelWidth, {
      toValue: EXPANDED_LABEL_WIDTH,
      duration: 220,
      useNativeDriver: false,
    }).start();
  };

  const handleBlur = () => {
    setFocused(false);
    if (isActive) return;
    Animated.timing(labelWidth, {toValue: 0, duration: 220, useNativeDriver: false}).start();
  };

  const handlePress = (_event: GestureResponderEvent) => onNavigate(item.route);

  const iconColour = expanded ? colour.bg : colour.inkMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{selected: isActive}}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={handlePress}
      style={[styles.link, expanded ? styles.linkExpanded : null, focused ? styles.linkFocusRing : null]}
    >
      <View style={styles.icon}>
        <NavIcon name={item.icon} colourValue={iconColour} />
      </View>
      <Animated.View style={{width: labelWidth, overflow: 'hidden'}}>
        <Text style={[styles.label, {color: iconColour}]} numberOfLines={1}>
          {item.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: sw(24),
    flexDirection: 'row',
    alignSelf: 'center',
    gap: sw(6),
    padding: sw(6),
    borderRadius: 999,
    backgroundColor: colour.surfaceStrong,
  },
  group: {
    flexDirection: 'row',
    gap: sw(4),
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: sw(44),
    height: sw(44),
    paddingHorizontal: sw(12),
    borderRadius: 999,
  },
  linkExpanded: {
    backgroundColor: colour.ink,
  },
  linkFocusRing: {
    borderWidth: 2,
    borderColor: colour.focusRing,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...textStyle.caption,
    marginLeft: sw(8),
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

/**
 * Renders `NAV_GROUPS` (or an injected override), filtered through
 * `visibleNavGroups(availableWorkKinds)`. Renders nothing at all (not even
 * an empty pill) while `availableWorkKinds` is `null` -- matching the web
 * app's own `availableWorkKinds !== null` guard.
 */
export function NavRail(props: NavRailProps): React.ReactElement | null {
  const {availableWorkKinds, activeRoute, onNavigate, groups = NAV_GROUPS} = props;
  const visible = visibleNavGroups(availableWorkKinds, groups);
  if (visible.length === 0) return null;

  return (
    <View style={styles.root} accessibilityRole="tablist">
      {visible.map((group) => (
        <View key={group.id} style={styles.group}>
          {group.items.map((item) => (
            <NavLink
              key={item.route}
              item={item}
              isActive={item.route === activeRoute}
              onNavigate={onNavigate}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
