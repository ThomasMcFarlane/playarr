/**
 * Pure raw-Kepler-event-name -> Playarr-vocabulary mapping, deliberately
 * kept in its own dependency-free file rather than folded into remote.ts.
 * ES module imports execute a file's entire top level on first load,
 * including `remote.ts`'s `import {useTVEventHandler} from
 * '@amazon-devices/react-native-kepler'` -- so testing this mapping from
 * inside remote.ts would mean every test run first requires that native
 * module to load cleanly under Jest, which is exactly the kind of
 * Vega-only dependency design doc §8.2 keeps out of the typecheck/test
 * path entirely. Splitting the pure lookup out here means
 * remoteKeyMap.test.ts covers the real mapping with zero native module in
 * its import graph, while remote.ts (one file over) still owns the actual
 * `useTVEventHandler` wiring as the single real, non-stub implementation
 * design doc §2 asks for.
 */

/**
 * Playarr's own remote-key vocabulary, shared by every screen's focus/
 * transport-control handling. camelCase rather than the raw event names
 * below so call sites read like the rest of this (otherwise entirely
 * TypeScript/camelCase) codebase.
 */
export type RemoteKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'select'
  | 'back'
  | 'menu'
  | 'playPause'
  | 'skipBackward'
  | 'skipForward';

/**
 * Raw `eventType` strings `useTVEventHandler` reports, verified against
 * Amazon's own documentation (design doc §1.1) -- lowercase, snake_case for
 * the two-word transport keys, exactly as Kepler emits them.
 */
const REMOTE_KEY_EVENT_MAP: Readonly<Record<string, RemoteKey>> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  select: 'select',
  back: 'back',
  menu: 'menu',
  playpause: 'playPause',
  skip_backward: 'skipBackward',
  skip_forward: 'skipForward',
};

/**
 * Maps a raw Kepler `eventType` to Playarr's `RemoteKey` vocabulary, or
 * `undefined` for anything this app does not act on (Kepler reports several
 * event types -- e.g. long-press variants -- no screen currently handles;
 * silently ignoring an unmapped one is the correct behaviour, not a bug to
 * fix here).
 */
export function normalizeRemoteKey(eventType: string): RemoteKey | undefined {
  return REMOTE_KEY_EVENT_MAP[eventType];
}
