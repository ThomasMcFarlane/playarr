import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useLocation } from "react-router-dom";

const SNAPSHOT_PREFIX = "playarr.navigationLayer.";
const SNAPSHOT_INDEX_KEY = `${SNAPSHOT_PREFIX}index`;
const MAX_SNAPSHOTS = 32;

export interface NavigationOrigin {
  route: string;
  entryKey: string;
}

interface ScrollPosition {
  top: number;
  left: number;
}

interface NavigationSnapshot {
  route: string;
  focusKey: string | null;
  scroll: Record<string, ScrollPosition>;
  capturedAt: number;
}

export function navigationOriginFromState(state: unknown): NavigationOrigin | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { navigationOrigin?: unknown }).navigationOrigin;
  if (!candidate || typeof candidate !== "object") return null;
  const route = (candidate as { route?: unknown }).route;
  const entryKey = (candidate as { entryKey?: unknown }).entryKey;
  return typeof route === "string" && typeof entryKey === "string"
    ? { route, entryKey }
    : null;
}

function storageKey(entryKey: string): string {
  return `${SNAPSHOT_PREFIX}${entryKey}`;
}

function readSnapshot(entryKey: string): NavigationSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(entryKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavigationSnapshot;
    return parsed &&
      typeof parsed === "object" &&
      typeof parsed.route === "string" &&
      typeof parsed.scroll === "object"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function persistSnapshot(entryKey: string, snapshot: NavigationSnapshot): void {
  try {
    window.sessionStorage.setItem(storageKey(entryKey), JSON.stringify(snapshot));
    const previous = JSON.parse(
      window.sessionStorage.getItem(SNAPSHOT_INDEX_KEY) ?? "[]"
    ) as unknown;
    const keys = Array.isArray(previous)
      ? previous.filter((key): key is string => typeof key === "string")
      : [];
    const next = [entryKey, ...keys.filter((key) => key !== entryKey)];
    for (const staleKey of next.slice(MAX_SNAPSHOTS)) {
      window.sessionStorage.removeItem(storageKey(staleKey));
    }
    window.sessionStorage.setItem(
      SNAPSHOT_INDEX_KEY,
      JSON.stringify(next.slice(0, MAX_SNAPSHOTS))
    );
  } catch {
    // Navigation still works when storage is disabled; only restoration is lost.
  }
}

function removeSnapshot(entryKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(entryKey));
  } catch {
    // Storage may be disabled; local hook state still prevents another attempt.
  }
}

function navigationFocusKey(target?: HTMLElement | null): string | null {
  const candidate =
    target?.closest<HTMLElement>("[data-navigation-focus-key]") ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-navigation-focus-key]")
      : null);
  return candidate?.dataset.navigationFocusKey ?? null;
}

export function captureNavigationLayer(
  route: string,
  entryKey: string,
  target?: HTMLElement | null
): NavigationOrigin {
  const scroll: Record<string, ScrollPosition> = {};
  for (const container of document.querySelectorAll<HTMLElement>(
    "[data-navigation-scroll-key]"
  )) {
    const key = container.dataset.navigationScrollKey;
    if (!key) continue;
    scroll[key] = {
      top: container.scrollTop,
      left: container.scrollLeft,
    };
  }
  persistSnapshot(entryKey, {
    route,
    focusKey: navigationFocusKey(target),
    scroll,
    capturedAt: Date.now(),
  });
  return { route, entryKey };
}

let restoringNavigationLayer = false;

export function isNavigationLayerRestoring(): boolean {
  return restoringNavigationLayer;
}

function restoreSnapshot(snapshot: NavigationSnapshot): boolean {
  const focusTarget = snapshot.focusKey
    ? document.querySelector<HTMLElement>(
        `[data-navigation-focus-key="${CSS.escape(snapshot.focusKey)}"]`
      )
    : null;
  if (snapshot.focusKey && !focusTarget) return false;

  const applyScroll = () => {
    for (const [key, position] of Object.entries(snapshot.scroll)) {
      const container = document.querySelector<HTMLElement>(
        `[data-navigation-scroll-key="${CSS.escape(key)}"]`
      );
      if (!container) continue;
      container.scrollTop = position.top;
      container.scrollLeft = position.left;
    }
  };

  applyScroll();
  if (focusTarget) {
    restoringNavigationLayer = true;
    focusTarget.focus({ preventScroll: true });
    restoringNavigationLayer = false;
  }
  // Focus handlers update the selected item synchronously and may queue
  // their own rail-centering animation. Reasserting the captured positions
  // on the next frame keeps restoration exact and cancels that stale motion.
  window.requestAnimationFrame(applyScroll);
  return true;
}

export function useNavigationLayer(
  restoreKey: string,
  discardMissingWhenReady = false,
  restoreEnabled = true
) {
  const location = useLocation();
  const restoredEntryRef = useRef<string | null>(null);
  const [ignoredEntryKey, setIgnoredEntryKey] = useState<string | null>(null);
  const snapshot = useMemo(
    () => readSnapshot(location.key),
    [location.key, restoreKey]
  );
  const hasSnapshot =
    snapshot?.route === location.pathname && ignoredEntryKey !== location.key;
  const origin = useMemo<NavigationOrigin>(
    () => ({ route: location.pathname, entryKey: location.key }),
    [location.key, location.pathname]
  );

  const capture = useCallback(
    (target?: HTMLElement | null) =>
      captureNavigationLayer(location.pathname, location.key, target),
    [location.key, location.pathname]
  );
  const captureLink = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      capture(event.currentTarget);
    },
    [capture]
  );

  useEffect(() => {
    if (
      !restoreEnabled ||
      !hasSnapshot ||
      !snapshot ||
      restoredEntryRef.current === location.key
    ) {
      return;
    }
    let cancelled = false;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        if (restoreSnapshot(snapshot)) {
          restoredEntryRef.current = location.key;
        } else if (discardMissingWhenReady) {
          removeSnapshot(location.key);
          setIgnoredEntryKey(location.key);
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    discardMissingWhenReady,
    hasSnapshot,
    location.key,
    restoreEnabled,
    restoreKey,
    snapshot,
  ]);

  return {
    capture,
    captureLink,
    hasSnapshot,
    focusKey: hasSnapshot ? snapshot?.focusKey ?? null : null,
    origin,
  };
}
