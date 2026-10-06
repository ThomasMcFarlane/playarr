/**
 * Remote-control input, wired to Kepler's own TV event stream. This is real
 * device input, not a focus-navigation concept (that's focus.tsx, one file
 * over) -- this file is what lets a screen react to `playpause` from the
 * physical remote to toggle PlayerScreen's transport state, for example,
 * independently of whatever currently has focus.
 *
 * Requires the manifest's `[[wants.service]] id =
 * "com.amazon.inputd.service"` entry (manifest.toml, already present) --
 * without it Kepler has nothing to source these events from, and
 * `useTVEventHandler`'s callback simply never fires, silently rather than
 * with an error.
 */
import {useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {normalizeRemoteKey, type RemoteKey} from './remoteKeyMap';

export type {RemoteKey};

/**
 * Kepler's own raw hardware-event shape, re-exported under this app's own
 * name rather than redefined -- an earlier draft of this file hand-rolled a
 * narrower interface for it (guessing at `eventKeyAction`/`tag` fields
 * before this project's `npm install` had actually run), which is exactly
 * the kind of "looks plausible, doesn't match the real .d.ts" mistake a
 * verified `tsc` run against the installed package exists to catch. The
 * real type's `eventType` is a large union of every physical key Kepler can
 * report (`up`/`down`/.../`f5`) widened with `| string`, not just the
 * handful `remoteKeyMap.ts` actually maps -- see that file for which of
 * these this app acts on.
 */
export type RemoteHardwareEvent = HWEvent;

/**
 * Subscribes `onKey` to every remote-control press this screen is mounted
 * for, already normalised to Playarr's `RemoteKey` vocabulary (see
 * `remoteKeyMap.ts`) and with anything this app does not act on already
 * filtered out. Not unit tested directly -- doing so would require a
 * working `useTVEventHandler` under Jest, i.e. a real (or faithfully
 * mocked) Vega/Kepler host, which is unavailable in this environment; see
 * design doc §8.2. `remoteKeyMap.test.ts` covers every real branch of the
 * normalisation this hook delegates to, so the only untested surface here
 * is the one-line pass-through to Kepler's own hook.
 */
export function useRemoteKey(onKey: (key: RemoteKey, raw: RemoteHardwareEvent) => void): void {
  useTVEventHandler((event: RemoteHardwareEvent) => {
    const key = normalizeRemoteKey(event.eventType);
    if (key !== undefined) onKey(key, event);
  });
}
