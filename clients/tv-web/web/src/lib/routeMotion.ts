import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Route transition token for `.app-main[data-route-motion]` (owner ruling, 8 October 2026).
 *
 * `forward` rises into place, `back` is the reverse (it settles downwards). The `a`/`b` suffix flips on every change
 * so the same CSS animation restarts even when React reuses the page element (two routes served by one component).
 * Nothing animates on first paint, inside Settings (its panels swap under a standing list) or around the player.
 */
/** Matches the 220 ms in styles/page-layout.css. */
export const ROUTE_MOTION_MS = 220;

export type RouteMotion = `${"forward" | "back"}-${"a" | "b"}`;

export function routeDirection(
  from: string,
  to: string,
  navigationType: string
): "forward" | "back" {
  if (navigationType === "POP") return "back";
  // Up the tree (a detail page back to its list) is Back even when it is a plain navigate.
  return to !== "/" && from.startsWith(`${to}/`) ? "back" : "forward";
}

export function routeMotionApplies(from: string, to: string): boolean {
  if (from === to) return false;
  const settings = (path: string) => path === "/settings" || path.startsWith("/settings/");
  if (settings(from) && settings(to)) return false;
  const player = (path: string) => path.startsWith("/player/");
  return !player(from) && !player(to);
}

export function useRouteMotion(): RouteMotion | undefined {
  const { pathname, key } = useLocation();
  const [expiredKey, setExpiredKey] = useState<string | null>(null);
  const navigationType = useNavigationType();
  const state = useRef<{ path: string; flip: boolean; motion: RouteMotion | undefined; key: string }>({
    path: pathname,
    flip: false,
    motion: undefined,
    key,
  });
  if (state.current.path !== pathname) {
    const from = state.current.path;
    if (routeMotionApplies(from, pathname)) {
      const flip = !state.current.flip;
      state.current = {
        path: pathname,
        flip,
        motion: `${routeDirection(from, pathname, navigationType)}-${flip ? "a" : "b"}`,
        key,
      };
    } else {
      state.current = { ...state.current, path: pathname };
    }
  }
  // The token only lives for the transition: a later skeleton-to-content swap must not replay it. It is keyed to
  // the navigation that started it, not to the current location: a same-path replace (opening or closing a panel,
  // a filter change) mints a new location key and must not revive an expired token, or the whole page re-animates.
  const motionKey = state.current.key;
  useEffect(() => {
    const timer = window.setTimeout(() => setExpiredKey(motionKey), ROUTE_MOTION_MS + 80);
    return () => window.clearTimeout(timer);
  }, [motionKey]);
  return expiredKey === motionKey ? undefined : state.current.motion;
}
