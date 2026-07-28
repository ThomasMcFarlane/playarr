/**
 * Continue-watching selection for the Home rail.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * See the implementation brief section 4.12 ("Playback session reporting",
 * the durable `WatchProgress` channel) and section 9, Slice 2's acceptance
 * criteria: "Continue-watching ordering, dedupe and cap."
 *
 * An empty result is a legitimate outcome, not a bug: restricted libraries
 * silently drop rows server-side, so an empty Continue Watching list is a
 * policy outcome (brief 4.12).
 */

import { WatchProgress } from "./Types/Playback";

function updatedAtMillis(updatedAt: string | null): number {
  if (updatedAt === null) {
    return 0;
  }
  const parsed: number = new Date(updatedAt).getTime();
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

/**
 * Select the Continue Watching rail:
 * 1. Filter to `state === "part_watched"`.
 * 2. Sort by `updated_at` descending (most recently watched first).
 * 3. Dedupe by `work_id`, keeping the first occurrence in that sorted order
 *    -- i.e. the most recent row per work.
 * 4. Cap at `maxCount` entries.
 */
export function selectContinueWatching(items: WatchProgress[], maxCount: number): WatchProgress[] {
  if (maxCount <= 0) {
    return [];
  }

  const inProgress: WatchProgress[] = items.filter(
    (item: WatchProgress): boolean => item.state === "part_watched"
  );

  const sorted: WatchProgress[] = inProgress.slice().sort(
    (a: WatchProgress, b: WatchProgress): number => updatedAtMillis(b.updated_at) - updatedAtMillis(a.updated_at)
  );

  const seenWorkIds: Map<string, boolean> = new Map<string, boolean>();
  const deduped: WatchProgress[] = [];
  for (const item of sorted) {
    if (seenWorkIds.has(item.work_id)) {
      continue;
    }
    seenWorkIds.set(item.work_id, true);
    deduped.push(item);
  }

  return deduped.slice(0, maxCount);
}
