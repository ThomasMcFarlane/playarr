import type { HomeRailDefinition, SeasonalRule } from "@playarr-tv/api-client";

export const LIBRARY_ORDER = ["movie", "series", "artist"] as const;

export const LIBRARY_LABELS: Record<string, string> = {
  movie: "Movies",
  series: "Series",
  artist: "Music",
  other: "All libraries",
};

export const KIND_LABELS: Record<string, string> = {
  recently_added: "Recently added",
  recently_released: "Recently released",
  top_unwatched: "Top unwatched",
  rediscover: "Rediscover",
  seasonal: "Seasonal",
  custom: "Custom",
};

export interface RailGroup {
  library: string;
  rails: HomeRailDefinition[];
}

/** Groups definitions by library, keeping each group's rails in display order. */
export function groupByLibrary(rails: readonly HomeRailDefinition[]): RailGroup[] {
  const groups = new Map<string, HomeRailDefinition[]>();
  for (const rail of rails) {
    const key = rail.library ?? "other";
    groups.set(key, [...(groups.get(key) ?? []), rail]);
  }
  const known: string[] = [...LIBRARY_ORDER];
  const keys = [
    ...known.filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !known.includes(k)),
  ];
  return keys.map((library) => ({ library, rails: groups.get(library) ?? [] }));
}

/**
 * The full id order after moving `id` one step up or down *within its
 * library group*: the two neighbours swap places in the global list.
 * Returns `null` when the rail is already at that edge.
 */
export function moveWithinGroup(
  rails: readonly HomeRailDefinition[],
  id: string,
  direction: -1 | 1
): string[] | null {
  const current = rails.find((r) => r.id === id);
  if (!current) return null;
  const peers = rails.filter((r) => (r.library ?? "other") === (current.library ?? "other"));
  const at = peers.findIndex((r) => r.id === id);
  const neighbour = peers[at + direction];
  if (!neighbour) return null;
  const ids = rails.map((r) => r.id);
  const a = ids.indexOf(id);
  const b = ids.indexOf(neighbour.id);
  [ids[a], ids[b]] = [ids[b] as string, ids[a] as string];
  return ids;
}

export function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinList(list: readonly string[] | undefined): string {
  return (list ?? []).join(", ");
}

/** A blank seasonal rule with a fixed window. */
export function newSeasonalRule(): SeasonalRule {
  return { key: "", start: "12-01", end: "12-31", keywords: [], genres: [], tags: [] };
}

export function isEasterRule(rule: SeasonalRule): boolean {
  return rule.easter_before_days != null || rule.easter_after_days != null;
}

/** Switches a rule between a fixed MM-DD window and an Easter-relative one. */
export function setRuleWindow(rule: SeasonalRule, mode: "fixed" | "easter"): SeasonalRule {
  return mode === "easter"
    ? { ...rule, start: null, end: null, easter_before_days: 14, easter_after_days: 1 }
    : {
        ...rule,
        start: rule.start ?? "01-01",
        end: rule.end ?? "01-31",
        easter_before_days: null,
        easter_after_days: null,
      };
}

/** Parses a positive-integer text field; empty means unset. */
export function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}
