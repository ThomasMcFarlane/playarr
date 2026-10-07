/**
 * The player's controls, drawn at the web TV player's measurements (`player-controls` and `player-quality-menu` in
 * scripts/parity/screens.json): the close button at the top right, the scrubber, the transport row and, on the right, the
 * subtitles and quality buttons. The bottom scrim rises from the bottom edge and recedes downwards, as the spec requires.
 *
 * This file only draws and reports focus; PlayerScreen owns playback, the key handling and Back (docs: PLAYER-SPEC).
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Pressable, StyleSheet, View} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import {Icon, type IconName} from '../shell/icons';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {FocusRing} from '../tv/FocusRing';
import {T, u} from '../tv/kit';

export type ChromeControl = 'close' | 'scrubber' | 'play' | 'subtitles' | 'quality';

export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export interface PlayerChromeProps {
  visible: boolean;
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  bufferedSeconds: number;
  /** While the viewer steps the scrubber: where the seek will land. */
  seekTargetSeconds: number | null;
  qualityLabel: string;
  hasSubtitles: boolean;
  subtitlesOn: boolean;
  /** The control that had focus when the chrome last hid: it gets focus back when the chrome shows. */
  focused: ChromeControl | null;
  onFocusControl: (control: ChromeControl) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  onOpenQuality: () => void;
  onOpenSubtitles: () => void;
  qualityRef?: React.RefObject<View>;
  playRef?: React.RefObject<View>;
  subtitlesRef?: React.RefObject<View>;
}

const SCRUB_X = 70;
const SCRUB_W = 1780;
const SCRUB_Y = 936;

export function PlayerChrome(props: PlayerChromeProps): React.ReactElement {
  const {colour} = useTheme();
  const rise = useRef(new Animated.Value(props.visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(rise, {toValue: props.visible ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  }, [props.visible, rise]);
  const scrimShift = rise.interpolate({inputRange: [0, 1], outputRange: [u(340), 0]});
  const topFade = rise;
  const duration = props.durationSeconds > 0 ? props.durationSeconds : 0;
  const shown = props.seekTargetSeconds ?? props.positionSeconds;
  const played = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const buffered = duration > 0 ? Math.min(1, Math.max(played, props.bufferedSeconds / duration)) : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={props.visible ? 'box-none' : 'none'}>
      {/* Scrim: rises from the bottom, recedes downwards. */}
      <Animated.View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: u(420), transform: [{translateY: scrimShift}]}}>
        <LinearGradient style={StyleSheet.absoluteFill} start={{x: 0, y: 0}} end={{x: 0, y: 1}} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.86)']} locations={[0, 0.55, 1]} />
      </Animated.View>
      {/* The top gradient fades separately. */}
      <Animated.View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: 0, height: u(200), opacity: topFade}}>
        <LinearGradient style={StyleSheet.absoluteFill} start={{x: 0, y: 0}} end={{x: 0, y: 1}} colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} />
      </Animated.View>

      <Animated.View style={{...StyleSheet.absoluteFillObject, opacity: rise}} pointerEvents={props.visible ? 'box-none' : 'none'}>
        <RoundButton icon="close" label="Close" size={46} x={1815} y={39} control="close" {...props} onPress={props.onClose} />

        <Scrubber {...props} played={played} buffered={buffered} targetShown={props.seekTargetSeconds !== null} shownSeconds={shown} />

        <RoundButton icon={props.playing ? 'pause' : 'play'} label={props.playing ? 'Pause' : 'Play'} size={64} x={148} y={958} iconSize={20} control="play" {...props} nodeRef={props.playRef} onPress={props.onTogglePlay} filled />
        <View style={{position: 'absolute', left: u(303), top: u(978), flexDirection: 'row'}} pointerEvents="none">
          <T size={11.136} weight={600} color={colour.ink} lh={22}>
            {formatTime(shown)}
          </T>
          <View style={{marginHorizontal: u(8)}}>
            <T size={11.136} weight={400} color={colour.inkMuted} lh={22}>
              /
            </T>
          </View>
          <T size={11.136} weight={600} color={colour.ink} lh={22}>
            {formatTime(duration)}
          </T>
        </View>

        {props.hasSubtitles ? (
          <RoundButton icon="subtitles" label="Subtitles" size={46} x={1389} y={967} iconSize={22} control="subtitles" {...props} nodeRef={props.subtitlesRef} onPress={props.onOpenSubtitles} dim={!props.subtitlesOn} />
        ) : null}
        <QualityPill {...props} />
      </Animated.View>
    </View>
  );
}

function RoundButton(props: PlayerChromeProps & {nodeRef?: React.RefObject<View>; icon: IconName; label: string; size: number; x: number; y: number; iconSize?: number; control: ChromeControl; onPress: () => void; filled?: boolean; dim?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const focused = props.focused === props.control;
  return (
    <Pressable
      ref={props.nodeRef}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hasTVPreferredFocus={props.control === 'play'}
      onFocus={() => props.onFocusControl(props.control)}
      onPress={props.onPress}
      style={{
        position: 'absolute',
        left: u(props.x),
        top: u(props.y),
        width: u(props.size),
        height: u(props.size),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: props.filled ? 'rgba(255,255,255,0.16)' : mix('#000000', 0.42),
      }}
    >
      <Icon name={props.icon} size={u(props.iconSize ?? 16)} color={props.dim ? colour.inkMuted : '#ffffff'} strokeWidth={2} />
      {focused ? <FocusRing /> : null}
    </Pressable>
  );
}

function Scrubber(props: PlayerChromeProps & {played: number; buffered: number; targetShown: boolean; shownSeconds: number}): React.ReactElement {
  const focused = props.focused === 'scrubber';
  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      onFocus={() => props.onFocusControl('scrubber')}
      onPress={props.onTogglePlay}
      style={{position: 'absolute', left: u(SCRUB_X - 12), top: u(SCRUB_Y - 17), width: u(SCRUB_W + 24), height: u(40), justifyContent: 'center', paddingHorizontal: u(12)}}
    >
      <View style={{height: u(focused ? 8 : 6), borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden'}}>
        <View style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${props.buffered * 100}%`, backgroundColor: 'rgba(255,255,255,0.38)'}} />
        <View style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${props.played * 100}%`, backgroundColor: '#cf3157'}} />
      </View>
      {focused ? (
        <>
          <View
            style={{position: 'absolute', left: u(12) + props.played * u(SCRUB_W) - u(11), top: u(9), width: u(22), height: u(22), borderRadius: 999, backgroundColor: '#ffffff', borderWidth: u(2), borderColor: '#cf3157'}}
          />
          {props.targetShown ? (
            <View style={{position: 'absolute', left: u(12) + props.played * u(SCRUB_W) - u(36), top: u(-34), width: u(72), alignItems: 'center'}}>
              <T size={12} weight={700} color="#ffffff" lh={20}>
                {formatTime(props.shownSeconds)}
              </T>
            </View>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

function QualityPill(props: PlayerChromeProps): React.ReactElement {
  const focused = props.focused === 'quality';
  const [pressed, setPressed] = useState(false);
  void pressed;
  return (
    <Pressable
      ref={props.qualityRef}
      accessibilityRole="button"
      accessibilityLabel={`Quality: ${props.qualityLabel}`}
      onFocus={() => props.onFocusControl('quality')}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={props.onOpenQuality}
      style={{
        position: 'absolute',
        left: u(1528),
        top: u(960),
        width: u(173),
        height: u(60),
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(255,255,255,0.14)' : 'transparent',
      }}
    >
      <Icon name="hd" size={u(18)} color="#ffffff" strokeWidth={1.8} />
      <View style={{marginLeft: u(12)}}>
        <T size={11.136} weight={600} color="#ffffff" lh={20} lines={1}>
          {props.qualityLabel}
        </T>
      </View>
      {focused ? <FocusRing /> : null}
    </Pressable>
  );
}
