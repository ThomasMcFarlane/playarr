/**
 * The focus state of a media card (owner ruling 2026-10-08): a soft shadow plus an animated lift, with no ring and no
 * fill. Controls (buttons, pills, Back) keep the focus ring; only content cards use this.
 *
 * Values are the web's pinned card-focus numbers (docs/design/page-layout.md section 5 item 1a, reference commit
 * de371253), in web px at 1920x1080:
 *  - card lift: translateY(-7px); library grid -5px with scale 1.015; Home -6px; search results -6px with scale 1.015;
 *  - art: scale 1.025;
 *  - focused art shadow: 0 24px 48px rgba(56,38,33,.30) + 0 10px 20px rgba(56,38,33,.20) (Home 0 26px 52px .32 + 0 11px
 *    22px .22; search 0 22px 52px rgba(31,14,20,.28)); at rest: 0 10px 20px .14 + 0 3px 8px .10.
 * The lift is a transform, so it never changes the layout frames Vega's focus engine measures (UP and DOWN stay
 * geometric). Vega has no blur, so a CSS shadow is drawn as concentric translucent rounded rectangles whose spread
 * follows the blur radius.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, View, type StyleProp, type ViewStyle} from 'react-native';
import {u} from './kit';

export type MediaFocusVariant = 'default' | 'library' | 'home' | 'search';

interface Shadow {
  y: number;
  blur: number;
  alpha: number;
  /** `r, g, b` of the shadow colour. */
  rgb: string;
}

const WARM = '56,38,33';
const DEEP = '31,14,20';

export const MEDIA_FOCUS = {
  variants: {
    default: {lift: 7, scale: 1, shadow: [{y: 24, blur: 48, alpha: 0.3, rgb: WARM}, {y: 10, blur: 20, alpha: 0.2, rgb: WARM}] as Shadow[]},
    library: {lift: 5, scale: 1.015, shadow: [{y: 24, blur: 48, alpha: 0.3, rgb: WARM}, {y: 10, blur: 20, alpha: 0.2, rgb: WARM}] as Shadow[]},
    home: {lift: 6, scale: 1, shadow: [{y: 26, blur: 52, alpha: 0.32, rgb: WARM}, {y: 11, blur: 22, alpha: 0.22, rgb: WARM}] as Shadow[]},
    search: {lift: 6, scale: 1.015, shadow: [{y: 22, blur: 52, alpha: 0.28, rgb: DEEP}] as Shadow[]},
  },
  rest: [{y: 10, blur: 20, alpha: 0.14, rgb: WARM}, {y: 3, blur: 8, alpha: 0.1, rgb: WARM}] as Shadow[],
  artScale: 1.025,
  /** `transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)`. */
  durationMs: 260,
  easing: Easing.bezier(0.2, 0.8, 0.2, 1),
} as const;

/** A CSS box-shadow as concentric rounded rectangles; `scale` grows the layers as the focused shadow fades in. */
function ShadowLayers({shadows, radius, steps = [0.5, 0.34, 0.18]}: {shadows: readonly Shadow[]; radius: number; steps?: number[]}): React.ReactElement {
  return (
    <>
      {shadows.flatMap((shadow) =>
        steps.map((step) => {
          const spread = shadow.blur * step;
          return (
            <View
              key={`${shadow.y}-${shadow.blur}-${step}`}
              style={{
                position: 'absolute',
                left: -u(spread),
                right: -u(spread),
                top: -u(spread) + u(shadow.y),
                bottom: -u(spread) - u(shadow.y),
                borderRadius: u(radius + spread),
                backgroundColor: `rgba(${shadow.rgb},${(shadow.alpha / steps.length).toFixed(3)})`,
              }}
            />
          );
        }),
      )}
    </>
  );
}

export interface MediaFocusProps {
  focused: boolean;
  width: number;
  height: number;
  radius: number;
  variant?: MediaFocusVariant;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/** Wraps the artwork of a card: lifts and enlarges it and cross-fades its shadow from the rest shadow to the focused one. */
export function MediaFocus({focused, width, height, radius, variant = 'default', style, children}: MediaFocusProps): React.ReactElement {
  const spec = MEDIA_FOCUS.variants[variant];
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  // The focused shadow is only mounted while it is visible or fading: a Home or library page holds dozens of cards.
  const [shadowMounted, setShadowMounted] = useState(focused);
  useEffect(() => {
    if (focused) setShadowMounted(true);
    Animated.timing(progress, {toValue: focused ? 1 : 0, duration: MEDIA_FOCUS.durationMs, easing: MEDIA_FOCUS.easing, useNativeDriver: true}).start(({finished}) => {
      if (finished && !focused) setShadowMounted(false);
    });
  }, [focused, progress]);
  const lift = progress.interpolate({inputRange: [0, 1], outputRange: [0, -u(spec.lift)]});
  const scale = progress.interpolate({inputRange: [0, 1], outputRange: [1, spec.scale * MEDIA_FOCUS.artScale]});
  const restOpacity = progress.interpolate({inputRange: [0, 1], outputRange: [1, 0]});
  return (
    <Animated.View style={[{width: u(width), height: u(height), transform: [{translateY: lift}, {scale}]}, style]}>
      <Animated.View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: restOpacity}}>
        <ShadowLayers shadows={MEDIA_FOCUS.rest} radius={radius} steps={[0.4]} />
      </Animated.View>
      {shadowMounted ? (
        <Animated.View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: progress}}>
          <ShadowLayers shadows={spec.shadow} radius={radius} />
        </Animated.View>
      ) : null}
      <View style={{width: u(width), height: u(height), borderRadius: u(radius), overflow: 'hidden'}}>{children}</View>
    </Animated.View>
  );
}
