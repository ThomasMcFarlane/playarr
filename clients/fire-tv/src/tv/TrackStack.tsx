/**
 * The vertical stack of tracks on the right of a detail-style page (the web's `tv-rail-surface.is-vertical-tracks`): each
 * track is a heading, a count and a row of cards. The focused track sits at FOCUS_Y; each track scrolls through its own
 * left offset, so the focus engine measures real frames and UP and DOWN stay geometric.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Pressable, View} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import type {WatchProgress} from '@playarr-tv/api-client';
import {ArtworkImage} from '../components/ArtworkImage';
import {focusNode} from '../platform';
import {useTheme} from '../theme/ThemeProvider';
import {EdgeFade, TRACK_GUTTER} from './EdgeFade';
import {Box, T, u} from './kit';
import {MediaFocus} from './mediaFocus';
import {WatchState} from './WatchState';

const TRACK_X = 881.6;
const TRACK_VIEW_X = 729.6;
const TRACK_VIEW_W = 1920 - TRACK_VIEW_X;
const CARD_W = 268;
const CARD_H = 150.8;
const CARD_PITCH = 293;
const TRACK_PITCH = 314.8;
/** Where the focused track's heading sits. */
// Web: the focused track's heading sits at 358 px (series page, Season 1 with an episode focused).
const FOCUS_Y = 358;

export interface TrackItem {
  id: string;
  /** Artwork address, if any. */
  art?: string;
  /** Text drawn on the artwork's corner (the episode or chapter number). */
  badge?: string;
  /** The first caption run (muted, small): the episode code, a time or a kind. */
  small?: string;
  title: string;
  /** People tracks put the role under the name instead of before it. */
  stacked?: boolean;
  initials?: string;
  progress?: WatchProgress;
  unseenDot?: boolean;
  onPress?: () => void;
  onFocus?: () => void;
}

export interface Track {
  id: string;
  title: string;
  meta: string;
  items: TrackItem[];
}

export interface TrackStackProps {
  tracks: Track[];
  token: string | undefined;
  restY: number;
  focus: {track: number; item: number} | null;
  onFocus: (focus: {track: number; item: number}) => void;
  initial: {track: number; item: number} | null;
}

export function TrackStack(props: TrackStackProps): React.ReactElement {
  const {colour} = useTheme();
  const {tracks, restY, focus} = props;
  // Vertical position of the stack: the focused track's heading sits at FOCUS_Y; with no focus in the stack it rests.
  const shiftTarget = focus ? FOCUS_Y - (restY + focus.track * TRACK_PITCH) : 0;
  const shift = useRef(new Animated.Value(shiftTarget)).current;
  useEffect(() => {
    Animated.timing(shift, {toValue: shiftTarget, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false}).start();
  }, [shiftTarget, shift]);

  // Each track scrolls through its own left offset, so the focus engine sees real frames (UP and DOWN stay geometric).
  const scrolls = useRef<Record<string, Animated.Value>>({});
  const scrollTargets = useRef<Record<string, number>>({});
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const leftValue = (id: string): Animated.Value => {
    if (!scrolls.current[id]) scrolls.current[id] = new Animated.Value(u(TRACK_X - TRACK_VIEW_X));
    return scrolls.current[id]!;
  };
  const focusItem = (trackIndex: number, itemIndex: number): void => {
    const track = tracks[trackIndex];
    if (!track) return;
    props.onFocus({track: trackIndex, item: itemIndex});
    const visible = 1920 - TRACK_X;
    const left = itemIndex * CARD_PITCH;
    let target = scrollTargets.current[track.id] ?? 0;
    if (left + CARD_W + 46 > target + visible) target = left + CARD_W + 46 - visible;
    if (left < target + 8) target = Math.max(0, left - 8);
    scrollTargets.current[track.id] = target;
    setOffsets((current) => ({...current, [track.id]: target}));
    Animated.timing(leftValue(track.id), {toValue: u(TRACK_X - TRACK_VIEW_X) - u(target), duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false}).start();
  };

  return (
      <Box x={TRACK_VIEW_X} y={0} w={TRACK_VIEW_W} h={1080} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: 0, top: shift, width: u(TRACK_VIEW_W), height: u(1080)}} pointerEvents="box-none">
          {tracks.map((track, trackIndex) => {
            const y = restY + trackIndex * TRACK_PITCH;
            const offset = offsets[track.id] ?? 0;
            const first = Math.max(0, Math.floor(offset / CARD_PITCH) - 1);
            const last = Math.min(track.items.length, Math.ceil((offset + 1038) / CARD_PITCH) + 1);
            const active = focus?.track === trackIndex;
            return (
              <View key={track.id} pointerEvents="box-none">
                <View style={{position: 'absolute', left: u(TRACK_X - TRACK_VIEW_X), top: u(y)}}>
                  <T size={17.664} weight={610} ls={-0.53} lh={26.5} color={colour.ink}>
                    {track.title}
                  </T>
                  <View style={{marginTop: u(4)}}>
                    <T size={9.984} weight={400} color={colour.inkMuted}>
                      {track.meta}
                    </T>
                  </View>
                </View>
                <Animated.View style={{position: 'absolute', left: leftValue(track.id), top: u(y + 80.7), flexDirection: 'row'}} pointerEvents="box-none">
                  {track.items.slice(first, last).map((item, relative) => {
                    const itemIndex = first + relative;
                    return (
                      <TrackCard
                        key={item.id}
                        item={item}
                        x={itemIndex * CARD_PITCH}
                        token={props.token}
                        selected={active && focus?.item === itemIndex}
                        preferred={props.initial?.track === trackIndex && props.initial.item === itemIndex}
                        onFocus={() => {
                          focusItem(trackIndex, itemIndex);
                          item.onFocus?.();
                        }}
                      />
                    );
                  })}
                </Animated.View>
                <EdgeFade kind="gutter" tint side="left" active={offset > 0} x={0} y={y + 60} w={TRACK_VIEW_W} h={230} size={TRACK_GUTTER} />
                <EdgeFade side="right" active={track.items.length * CARD_PITCH - offset > 1920 - TRACK_X + 8} x={0} y={y + 60} w={TRACK_VIEW_W} h={230} />
              </View>
            );
          })}
        </Animated.View>
      </Box>
  );
}

function TrackCard({item, x, token, selected, preferred, onFocus}: {item: TrackItem; x: number; token: string | undefined; selected: boolean; preferred: boolean; onFocus: () => void}): React.ReactElement {
  const {colour} = useTheme();
  // hasTVPreferredFocus only wins while nothing else holds focus; the detail page mounts its buttons first, so the
  // next-up episode takes focus explicitly once it exists (owner rule: a series page opens on the next item to play).
  const ref = useRef<View>(null);
  useEffect(() => {
    if (preferred) focusNode(ref);
  }, [preferred]);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      hasTVPreferredFocus={preferred}
      onFocus={onFocus}
      onPress={item.onPress}
      style={{position: 'absolute', left: u(x), top: 0, width: u(CARD_W)}}
    >
      <MediaFocus focused={selected} width={CARD_W} height={CARD_H} radius={13.44}>
        <View style={{width: '100%', height: '100%', backgroundColor: colour.surfaceSoft, alignItems: 'center', justifyContent: 'center'}}>
          {item.art ? (
            <ArtworkImage uri={item.art} accessToken={token} style={{position: 'absolute', left: 0, top: 0, width: '100%', height: '100%'}} resizeMode="cover" />
          ) : item.initials ? (
            <T size={28} weight={600} color={colour.inkMuted}>
              {item.initials}
            </T>
          ) : null}
        </View>
        {item.badge ? (
          <>
            <LinearGradient
              pointerEvents="none"
              style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: u(60)}}
              start={{x: 0, y: 0}}
              end={{x: 0, y: 1}}
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']}
            />
            <View style={{position: 'absolute', right: u(11.6), bottom: u(8.9)}}>
              <T size={19.2} weight={560} lh={28.8} color="#ffffff">
                {item.badge}
              </T>
            </View>
          </>
        ) : null}
        <WatchState progress={item.progress} showUnwatched={item.unseenDot === true} dot={13} inset={10.5} />
      </MediaFocus>
      <View style={{marginTop: u(11.4)}}>
        {item.stacked ? (
          <>
            <T size={11.52} weight={610} ls={-0.1728} lh={17.3} color={colour.ink} lines={1}>
              {item.title}
            </T>
            {item.small ? (
              <View style={{marginTop: u(3.8)}}>
                <T size={8.832} weight={700} lh={13.2} color={colour.inkMuted} lines={1}>
                  {item.small}
                </T>
              </View>
            ) : null}
          </>
        ) : (
          <View style={{flexDirection: 'row', alignItems: 'center', width: u(CARD_W)}}>
            {item.small ? (
              <View style={{marginRight: u(8)}}>
                <T size={8.832} weight={700} lh={13.2} color={colour.inkMuted}>
                  {item.small}
                </T>
              </View>
            ) : null}
            <View style={{flex: 1}}>
              <T size={11.52} weight={610} ls={-0.1728} lh={17.3} color={colour.ink} lines={1}>
                {item.title}
              </T>
            </View>
          </View>
        )}
      </View>
    </Pressable>
  );
}
