/**
 * App-lifecycle and back-navigation adapters.
 *
 * `useBackHandler` exists to solve one very concrete problem (design doc
 * §4.3): a single physical press of the remote's Back button is delivered
 * to this app TWICE, through two entirely independent subscription
 * mechanisms -- `BackHandler.addEventListener('hardwareBackPress', …)`
 * (React Native core) AND Kepler's own TV event stream reporting
 * `eventType: 'back'` (`useTVEventHandler`, the same hook `remote.ts`
 * wraps). A screen that naively subscribed to both would run its back
 * handler twice per press -- popping two levels of navigation instead of
 * one, or double-firing a "confirm discard changes?" prompt. Screens
 * subscribe through this hook instead and see exactly one call per
 * physical press, regardless of which of the two paths happens to deliver
 * it that time.
 *
 * The two paths are not interchangeable, which is *why* both are
 * subscribed rather than picking the "better" one: `BackHandler` goes
 * completely silent while a `<Modal>` is open (a documented Vega quirk,
 * design doc §4.3), so a modal's own dismiss-on-Back behaviour only ever
 * arrives via the Kepler TV-event path. Dropping the `BackHandler`
 * subscription entirely would break every screen's non-modal back
 * navigation the moment Vega ships a build where the reverse becomes true
 * (nothing documents this as permanent, only as currently-observed) --
 * keeping both, deduplicated, is the version of this that survives either
 * platform quirk changing out from under it.
 *
 * `useAppForeground` backs the "release the single secure decoder when
 * backgrounded" certification requirement design doc §6.3 describes --
 * PlayerScreen (a later step) is the one real caller, but the hook itself
 * has nothing PlayerScreen-specific in it and belongs here, not there.
 */
import {useEffect, useRef, useState} from 'react';
import {BackHandler} from 'react-native';
import {useKeplerAppStateManager, useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';

const BACK_DEDUPE_WINDOW_MS = 50;

/**
 * Subscribes `onBack` to the remote's Back button exactly once per physical
 * press. Return `false` from `onBack` to let the OS's own default back
 * behaviour proceed (e.g. exiting the app from the root screen); any other
 * return value (including `void`) marks the press as handled.
 */
export function useBackHandler(onBack: () => boolean | void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const lastHandledAtRef = useRef(0);

  function handleBack(): boolean {
    const now = Date.now();
    if (now - lastHandledAtRef.current < BACK_DEDUPE_WINDOW_MS) {
      // The other path already handled this same physical press.
      return true;
    }
    lastHandledAtRef.current = now;
    return onBackRef.current() !== false;
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => subscription.remove();
    // handleBack intentionally excluded: it is a stable-enough closure that
    // only ever reads through refs, and re-subscribing every render would
    // mean briefly having zero listener attached between the old cleanup
    // and the new effect running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTVEventHandler((event: HWEvent) => {
    if (event.eventType === 'back') handleBack();
  });
}

/**
 * `true` while the app is in the foreground, `false` once Vega has
 * backgrounded it (the user pressed Home, launched another app, or the
 * device went to sleep). Built on `useKeplerAppStateManager`, NOT a plain
 * `KeplerAppState` module-level object -- an earlier draft of this file
 * assumed the latter (mirroring React Native core's own `AppState` shape)
 * before a real `tsc` run against the installed package's `.d.ts` showed
 * Vega's actual primitive is hook-based: `useKeplerAppStateManager()`
 * returns a manager scoped to this component's own instance
 * (`getCurrentState`/`addAppStateListener`/`addEventListener`), not a
 * single app-wide singleton. `'change'` fires with a
 * `KeplerAppStateChangeData`, which is either the simple status string this
 * hook cares about or one of two other event shapes
 * (`KeplerReconfigureReasonData`/a display-connect status) it deliberately
 * ignores -- the `typeof status === 'string'` guard below is what tells
 * those apart.
 */
export function useAppForeground(): boolean {
  const appStateManager = useKeplerAppStateManager();
  const [foreground, setForeground] = useState(() => appStateManager.getCurrentState() === 'active');

  useEffect(() => {
    const subscription = appStateManager.addAppStateListener('change', (status) => {
      if (typeof status === 'string') setForeground(status === 'active');
    });
    return () => subscription.remove();
  }, [appStateManager]);

  return foreground;
}
