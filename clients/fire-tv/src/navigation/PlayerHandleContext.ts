/**
 * The mechanism `App.tsx`'s own top comment named as the missing piece for
 * wiring `WorkDetailScreen`/`MusicDetailScreen`'s injected `onPlay` prop
 * through to the shell-mounted `<PlayerScreen>`: a small context exposing
 * `PlayerScreenHandle`, so a screen several navigator layers below `App.tsx`
 * can reach `playerRef.current?.show(...)` without that ref being threaded
 * down as a prop through every intermediate navigator and wrapper.
 *
 * The context value is the REF OBJECT itself (`React.RefObject<
 * PlayerScreenHandle>`), not `playerRef.current` read once and passed down.
 * That distinction matters for a concrete reason: `App.tsx` creates
 * `playerRef` and renders `<PlayerScreen ref={playerRef} />` as a sibling of
 * the navigator tree in the SAME render pass that also provides this
 * context -- React only attaches a ref during commit, after render, so
 * `playerRef.current` is still `null` at the moment `App.tsx` itself is
 * rendering. `App.tsx` never re-renders once hydration finishes (nothing
 * about a navigation change touches its own state), so a context value
 * computed once from `playerRef.current` at render time would stay `null`
 * forever and every consumer's `onPlay` would silently no-op. Providing the
 * stable ref object instead sidesteps the whole problem: `.current` is read
 * lazily, inside the `onPlay` callback, well after `<PlayerScreen>` has
 * mounted and called `useImperativeHandle` for real.
 *
 * Defaults to `null` (rather than throwing, the way a `useApiClient()`-style
 * "provider required" context does elsewhere in this app) because a missing
 * provider here is a genuinely recoverable state, not a programming error a
 * screen should crash over: `WorkDetailScreen`/`MusicDetailScreen` already
 * treat an absent `onPlay` as "render the Play button disabled" rather than
 * assuming it exists, and every unit test for those two screens (deliberately
 * predating this wiring step) constructs them directly with no provider at
 * all in scope.
 */
import {createContext, type RefObject} from 'react';
import type {PlayerScreenHandle} from '../screens/PlayerScreen';

export const PlayerHandleContext = createContext<RefObject<PlayerScreenHandle> | null>(null);
