import type { RailPreferences, RailPreferencesRequest } from "@playarr-tv/api-client";

export type RailPreferenceEntry = RailPreferences["rails"][number];

/** Moves a rail one place up (-1) or down (+1); no-op at the ends. */
export function moveRail(
  entries: RailPreferenceEntry[],
  id: string,
  direction: -1 | 1
): RailPreferenceEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= entries.length) return entries;
  const next = [...entries];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function toggleRail(entries: RailPreferenceEntry[], id: string): RailPreferenceEntry[] {
  return entries.map((entry) =>
    entry.id === id ? { ...entry, hidden: !entry.hidden } : entry
  );
}

/** The full order plus the hidden set, as the preferences endpoint expects. */
export function toPreferencesRequest(entries: RailPreferenceEntry[]): RailPreferencesRequest {
  return {
    order: entries.map((entry) => entry.id),
    hidden: entries.filter((entry) => entry.hidden).map((entry) => entry.id),
  };
}
