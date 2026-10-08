/**
 * Scrolls a column or row of focusable items so the focused one stays visible, the way the web's `scrollIntoView` does for
 * the calendar and the drawers. The position is an animated offset (not a transform), so the focus engine measures real frames.
 *
 * `reveal(start, size)` takes the item's extent along the axis in web pixels, measured from the start of the content.
 */
import {useCallback, useRef, useState} from 'react';
import {Animated, Easing} from 'react-native';
import {u} from './kit';

export interface ScrollReveal {
  /** The animated offset to apply as `top` (vertical) or `left` (horizontal). */
  offset: Animated.Value;
  /** The current scroll position in web pixels. */
  scrolled: number;
  /** The furthest the content can scroll, in web pixels. */
  max: number;
  reveal: (start: number, size: number) => void;
  scrollTo: (position: number) => void;
}

export function useScrollReveal({viewport, content, margin = 40, snap}: {viewport: number; content: number; margin?: number; snap?: number}): ScrollReveal {
  const offset = useRef(new Animated.Value(0)).current;
  const current = useRef(0);
  const [scrolled, setScrolled] = useState(0);
  const max = Math.max(0, content - viewport);
  const maxRef = useRef(max);
  maxRef.current = max;

  const scrollTo = useCallback(
    (position: number) => {
      const target = Math.min(maxRef.current, Math.max(0, position));
      if (target === current.current) return;
      current.current = target;
      setScrolled(target);
      Animated.timing(offset, {toValue: -u(target), duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false}).start();
    },
    [offset],
  );

  const reveal = useCallback(
    (start: number, size: number) => {
      let target = current.current;
      if (snap !== undefined) {
        // Snap to a column: the focused item's start becomes the viewport start when it is outside.
        if (start < target || start + size > target + viewport) target = start - snap;
      } else {
        if (start + size + margin > target + viewport) target = start + size + margin - viewport;
        if (start - margin < target) target = start - margin;
      }
      scrollTo(target);
    },
    [margin, scrollTo, snap, viewport],
  );

  return {offset, scrolled, max, reveal, scrollTo};
}
