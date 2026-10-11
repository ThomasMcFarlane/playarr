/**
 * The shell chrome every signed-in screen sits in, drawn at the web TV layout's measurements (1920x1080 CSS px, from the
 * web client's DOM): the logo, the clock, the three-group left rail and the profile chip with the app version.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {focusDefaultTarget, focusNode, getFocusedTag, TvFocusScope, useRemoteKey} from '../platform';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {WorkKind} from '@playarr-tv/api-client';
import {ProfileAvatar} from '../components/ProfileAvatar';
import {mix} from '../theme/color';
import {textRun} from '../theme/fonts';
import {sw} from '../theme/scale';
import {useTheme} from '../theme/ThemeProvider';
import {appNow, formatClockDate, formatClockTime} from './clock';
import {Icon, type IconName} from './icons';
import {PlayarrLogo} from './Logo';

export type RailTarget = 'downloads' | 'search' | 'home' | 'series' | 'movies' | 'sites' | 'music' | 'playlists' | 'watchlist' | 'requests' | 'calendar';

interface RailItem {
  target: RailTarget;
  label: string;
  icon: IconName;
  /** Shown only when the server has this kind of work (the web filters its rail the same way). */
  workKind?: WorkKind;
}

interface RailGroup {
  id: string;
  items: readonly RailItem[];
}

const RAIL_GROUPS: readonly RailGroup[] = [
  {
    id: 'search',
    items: [
      {target: 'downloads', label: 'Downloads', icon: 'downloads'},
      {target: 'search', label: 'Search', icon: 'search'},
    ],
  },
  {
    id: 'library',
    items: [
      {target: 'home', label: 'Home', icon: 'home'},
      {target: 'series', label: 'Series', icon: 'series', workKind: 'series'},
      {target: 'movies', label: 'Movies', icon: 'movies', workKind: 'movie'},
      {target: 'sites', label: 'Sites', icon: 'sites', workKind: 'site'},
      {target: 'music', label: 'Music', icon: 'music', workKind: 'artist'},
    ],
  },
  {
    id: 'playlists',
    items: [
      {target: 'playlists', label: 'Playlists', icon: 'playlists'},
      {target: 'watchlist', label: 'Watchlist', icon: 'watchlist'},
      {target: 'requests', label: 'Requests', icon: 'watchlist'},
      {target: 'calendar', label: 'Calendar', icon: 'calendar'},
    ],
  },
];

/** Rail order, top to bottom (the capture driver walks it with the D-pad). */
/** The groups a server offers: items for a kind of work it lacks are dropped, and so are groups left empty. */
export function visibleRailGroups(kinds: ReadonlySet<WorkKind> | null): readonly RailGroup[] {
  if (kinds === null) return [];
  return RAIL_GROUPS.map((group) => ({...group, items: group.items.filter((item) => !item.workKind || kinds.has(item.workKind))})).filter(
    (group) => group.items.length > 0
  );
}

export const RAIL_ORDER: readonly RailTarget[] = RAIL_GROUPS.flatMap((group) => group.items.map((item) => item.target));

// Measured from the web TV rail (1920x1080): 67 px links, 78 px wide groups, 14 px between groups, top-anchored at 119 px.
const ITEM = 67;
const GROUP_PAD_X = 4.5;
const GROUP_PAD_Y = 5;
const GROUP_GAP = 6.5;
const GROUP_BORDER = 1;
const BETWEEN_GROUPS = 14;
const GROUP_X = 42;
const RAIL_TOP = 119;
/** The profile group sits at the rail's foot (bottom 1031 px), with the version label under it. */
const PROFILE_TOP = 952;

function groupHeight(count: number): number {
  return 2 * GROUP_BORDER + 2 * GROUP_PAD_Y + count * ITEM + (count - 1) * GROUP_GAP;
}

function RailLink({
  item,
  active,
  onSelect,
  onActiveNode,
}: {
  item: RailItem;
  active: boolean;
  onSelect: (target: RailTarget) => void;
  onActiveNode: (node: unknown) => void;
}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = active || focused;
  // A stable callback: an inline ref function is detached and re-attached on every commit, and its setState then
  // re-rendered the rail without end (the JS thread froze and the remote went dead).
  const activeRefCallback = useCallback(
    (node: unknown) => {
      if (active && node) onActiveNode(node);
    },
    [active, onActiveNode],
  );
  const ink = lit ? colour.ink : colour.inkMuted;
  return (
    <Pressable
      ref={activeRefCallback}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{selected: active}}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item.target)}
      style={{
        width: sw(ITEM),
        height: sw(ITEM),
        borderRadius: sw(16),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? mix(colour.ink, 0.14) : active ? mix(colour.ink, 0.09) : 'transparent',
        transform: [{scale: focused ? 1.1 : active ? 1.05 : 1}],
      }}
    >
      <Icon name={item.icon} size={sw(20)} color={ink} />
      <Text
        style={[
          textRun(8.832, 680, {letterSpacing: 0.309, lineHeight: 8.832}),
          {color: ink, marginTop: sw(4.8), fontSize: sw(8.832)},
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

function Rail({
  active,
  onSelect,
  groups,
  children,
}: {
  active: RailTarget | null;
  onSelect: (target: RailTarget) => void;
  groups: readonly RailGroup[];
  /** The profile group: inside the rail's focus scope, so LEFT from low content still lands on the page's own item. */
  children?: React.ReactNode;
}): React.ReactElement {
  const {colour} = useTheme();
  let y = RAIL_TOP;
  // Entering the rail from the content (LEFT) lands on the page's own item, and UP/DOWN stay inside it, like the web.
  // Held in state, not a ref: the focus guide reads its destination at render, and a ref is still empty on the first render,
  // so LEFT from the content found no rail item until something else re-rendered the rail.
  const [activeNode, setActiveNode] = useState<unknown>(null);
  const activeRef = useMemo(() => ({current: activeNode}), [activeNode]);
  // Vega drops focus when the focused view unmounts (a list re-rendered by late data), and then the D-pad does nothing.
  // The web never loses focus, so a direction key with nothing focused lands on the page default or the rail's item.
  useRemoteKey((key, raw) => {
    if (raw.eventKeyAction !== 0 || !['up', 'down', 'left', 'right'].includes(key)) return;
    // The page's own default first (web data-tv-focus-default), else the rail's item.
    if (!getFocusedTag() && !focusDefaultTarget()) focusNode(activeRef);
  });
  return (
    <TvFocusScope trap={['up', 'down']} destinations={[activeRef]} style={{position: 'absolute', left: 0, top: 0, width: sw(128), height: sw(1080)}}>
      {groups.map((group) => {
        const height = groupHeight(group.items.length);
        const groupTop = y;
        y += height + BETWEEN_GROUPS;
        return (
          <View
            key={group.id}
            style={{
              position: 'absolute',
              left: sw(GROUP_X),
              top: sw(groupTop),
              width: sw(2 * GROUP_BORDER + 2 * GROUP_PAD_X + ITEM),
              height: sw(height),
              borderRadius: sw(22),
              borderWidth: GROUP_BORDER,
              borderColor: mix(colour.line, 0.48),
              backgroundColor: mix(colour.surfaceStrong, 0.56),
              paddingHorizontal: sw(GROUP_PAD_X),
              paddingVertical: sw(GROUP_PAD_Y),
            }}
          >
            {group.items.map((item, index) => (
              <View key={item.target} style={{marginTop: index === 0 ? 0 : sw(GROUP_GAP)}}>
                <RailLink item={item} active={active === item.target} onSelect={onSelect} onActiveNode={setActiveNode} />
              </View>
            ))}
          </View>
        );
      })}
      {children}
    </TvFocusScope>
  );
}

/** The clock; `x` is its right edge in CSS px (the web right-aligns it to a fixed column). */
export function ShellClock({right}: {right: number}): React.ReactElement {
  const {colour} = useTheme();
  const [now, setNow] = useState(appNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(appNow()), 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={{position: 'absolute', top: sw(60.2), right: sw(1920 - right), height: sw(42), flexDirection: 'row', alignItems: 'center'}}>
      <Text style={[textRun(17.28, 760, {letterSpacing: -0.5184}), {color: colour.ink, fontSize: sw(17.28)}]}>{formatClockTime(now)}</Text>
      <Text
        style={[
          textRun(11.136, 640, {letterSpacing: 0.4454}),
          {color: colour.inkMuted, marginLeft: sw(11.2), textTransform: 'uppercase', fontSize: sw(11.136)},
        ]}
      >
        {formatClockDate(now)}
      </Text>
    </View>
  );
}

export interface ProfileChipProps {
  profileId: string | undefined;
  name: string;
  version: string;
  onPress: () => void;
}

function ProfileChip({profileId, name, version, onPress}: ProfileChipProps): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const ink = focused ? colour.ink : colour.inkMuted;
  // The web's rail profile group: one rail link holding the 20 px avatar and the first word of the name (shortProfileName).
  const shortName = name.trim().split(/\s+/)[0] || name;
  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: sw(GROUP_X),
          top: sw(PROFILE_TOP),
          width: sw(2 * GROUP_BORDER + 2 * GROUP_PAD_X + ITEM),
          height: sw(groupHeight(1)),
          borderRadius: sw(22),
          borderWidth: GROUP_BORDER,
          borderColor: mix(colour.line, 0.48),
          backgroundColor: mix(colour.surfaceStrong, 0.56),
          paddingHorizontal: sw(GROUP_PAD_X),
          paddingVertical: sw(GROUP_PAD_Y),
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Profile ${name}`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPress={onPress}
          style={{
            width: sw(ITEM),
            height: sw(ITEM),
            borderRadius: sw(16),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: focused ? mix(colour.ink, 0.14) : 'transparent',
            transform: [{scale: focused ? 1.1 : 1}],
          }}
        >
          <View style={{width: sw(20), height: sw(20)}}>
            {profileId ? <ProfileAvatar profileId={profileId} size={sw(20)} /> : null}
          </View>
          <Text
            numberOfLines={1}
            style={[
              textRun(8.832, 680, {letterSpacing: 0.309, lineHeight: 8.832}),
              {color: ink, marginTop: sw(4.8), maxWidth: sw(58), fontSize: sw(8.832)},
            ]}
          >
            {shortName}
          </Text>
        </Pressable>
      </View>
      <Text
        style={[
          textRun(8, 700, {letterSpacing: 0.32, mono: true}),
          {position: 'absolute', left: sw(GROUP_X), width: sw(78), textAlign: 'center', top: sw(1038), color: colour.ink, fontSize: sw(8)},
        ]}
      >
        {`v${version}`}
      </Text>
    </>
  );
}

export interface ShellChromeProps {
  active: RailTarget | null;
  profileId: string | undefined;
  profileName: string;
  version: string;
  onSelect: (target: RailTarget) => void;
  onOpenProfiles: () => void;
  /** Hide the clock when the page draws its own header (the library and detail pages place it themselves). */
  clockRight?: number | null;
  /** The kinds of work the server has; null until known (the rail is not drawn until then, like the web). */
  availableWorkKinds: ReadonlySet<WorkKind> | null;
}

export function ShellChrome(props: ShellChromeProps): React.ReactElement {
  const {active, profileId, profileName, version, onSelect, onOpenProfiles, clockRight = 633.6, availableWorkKinds} = props;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={{position: 'absolute', left: sw(60.6), top: sw(60.2), width: sw(42), height: sw(42)}}>
        <PlayarrLogo size={sw(42)} />
      </View>
      {clockRight === null ? null : <ShellClock right={clockRight} />}
      <Rail active={active} onSelect={onSelect} groups={visibleRailGroups(availableWorkKinds)}>
        <ProfileChip profileId={profileId} name={profileName} version={version} onPress={onOpenProfiles} />
      </Rail>
    </View>
  );
}
