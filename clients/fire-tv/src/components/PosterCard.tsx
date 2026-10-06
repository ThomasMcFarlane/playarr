/**
 * The focusable poster tile every `TvMediaTrack`/library grid renders --
 * design doc §2's file-purpose comment: "focusable card, focusScale 1.08 /
 * 150ms". Ported from `clients/tv-web/web/src/styles/global.css`'s
 * `.poster-card`/`.poster-art`/`.poster-title` rules, structurally (2:3
 * poster aspect ratio, title below the art), but with the FOCUS treatment
 * taken from design doc §4.4's own governing numbers
 * (`focusMotion.focusScale`/`focusMotion.transitionMs` -- 1.08/150ms) rather
 * than that CSS file's own `:focus-visible` rule (`scale(1.045)`/`260ms`):
 * design doc §4.4 is explicit that `focusMotion` is the shared TV-focus
 * contract every custom focusable in THIS app follows, and calls out
 * `PosterCard` by name as one of them -- the web app's own poster hover/
 * focus numbers were authored before that shared token existed and were
 * never reconciled with it, so following `focusMotion` here is intentional
 * divergence FROM the web CSS, not an oversight.
 *
 * `Pressable`, not `TouchableOpacity`/`<Button>`: design doc §4.4 again --
 * only those two get "free" focus feedback on Vega, so a custom focusable
 * like this one renders its own ring via `onFocus`/`onBlur`
 * (`posterFocusMotion.ts`'s `effectiveFocusScale`, including the
 * `activeRailFactor` knob that module's own doc comment explains in full).
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {colour, focusMotion} from '../theme/tokens';
import {text as textStyle} from '../theme/styles';
import {sw} from '../theme/scale';
import {effectiveFocusScale} from './posterFocusMotion';

export interface PosterCardProps {
  title: string;
  /** A secondary line under the title (e.g. year, episode count) -- omitted entirely (not rendered as an empty line) when absent. */
  meta?: string;
  /** The poster art itself -- typically an `<ArtworkImage>` filling this card's fixed 2:3 art box; `undefined` renders a plain tinted placeholder box instead. */
  art?: React.ReactNode;
  onPress: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** See `posterFocusMotion.ts`'s doc comment: `1` (the default) for a card on the currently-active rail, `0` to fully suppress the focus-grow treatment while a modal has taken input focus elsewhere. */
  activeRailFactor?: number;
  width?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const ART_ASPECT_RATIO = 2 / 3;
const DEFAULT_WIDTH = 180;

const styles = StyleSheet.create({
  root: {
    width: DEFAULT_WIDTH,
  },
  art: {
    width: '100%',
    aspectRatio: ART_ASPECT_RATIO,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: colour.surfaceSoft,
  },
  focusRing: {
    borderWidth: 3,
    borderColor: colour.focusRing,
  },
  placeholder: {
    width: '100%',
    height: '100%',
  },
  title: {
    ...textStyle.body,
    marginTop: sw(10),
  },
  meta: {
    ...textStyle.caption,
    color: colour.inkMuted,
    marginTop: sw(2),
  },
});

export function PosterCard(props: PosterCardProps): React.ReactElement {
  const {
    title,
    meta,
    art,
    onPress,
    onFocus,
    onBlur,
    activeRailFactor = 1,
    width = DEFAULT_WIDTH,
    style,
    accessibilityLabel,
  } = props;

  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(effectiveFocusScale(false, activeRailFactor))).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: effectiveFocusScale(focused, activeRailFactor),
      duration: focusMotion.transitionMs,
      useNativeDriver: true,
    }).start();
  }, [focused, activeRailFactor, scale]);

  const handleFocus = () => {
    setFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setFocused(false);
    onBlur?.();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={onPress}
      style={[styles.root, {width}, style]}
    >
      <Animated.View style={[styles.art, focused ? styles.focusRing : null, {transform: [{scale}]}]}>
        {art ?? <View style={styles.placeholder} />}
      </Animated.View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {meta !== undefined ? (
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}
