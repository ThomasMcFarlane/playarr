/**
 * The single async bootstrap step `src/App.tsx` awaits before its first
 * render. Kept as its own file, separate from the synchronous
 * `polyfills.ts`, for a reason that matters even though it currently only
 * does one thing: `polyfills.ts` is pure side-effect-on-import (it must run
 * before anything else, including this file, so App.tsx imports it first
 * and never calls it as a function -- see its own doc comment), while
 * hydration is genuinely asynchronous and must be awaited, not merely
 * imported, before a screen that reads `localStorage` can safely render.
 * Should another genuinely-async prerequisite ever join it (a remote
 * feature-flag fetch, say), it joins the `Promise.all` below rather than
 * becoming a second top-level `await` App.tsx has to remember to add.
 */
import {hydrateStorage} from '../platform';

export async function hydrate(): Promise<void> {
  await Promise.all([hydrateStorage()]);
}
