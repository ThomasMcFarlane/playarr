import type { FolderEntry, FolderEntryFilter, FolderOrder, FolderSort, WorkKind } from "@playarr-tv/api-client";

/**
 * Folders view state and its URL (query string) representation:
 * `/folders?root=<id>&path=Season%20A&view=list&size=large&sort=modified&order=desc&q=clip&type=media`.
 *
 * The URL is the source of truth, so refresh, back/forward and deep links
 * restore the exact directory and view. The parameter names match the native
 * Android route state. Unknown or malformed values are ignored.
 */
export type FolderViewMode = "list" | "cover";
export type FolderSize = "small" | "medium" | "large";
export type FolderKind = Extract<WorkKind, "movie" | "series" | "site" | "artist" | "author">;

export interface FolderUrlState {
  root: string | null;
  /** Root-relative directory, `a/b/c`; empty is the root itself. */
  path: string;
  kind: FolderKind | null;
  view: FolderViewMode;
  size: FolderSize;
  sort: FolderSort;
  order: FolderOrder;
  q: string;
  type: FolderEntryFilter;
}

export const FOLDER_DEFAULTS: FolderUrlState = {
  root: null,
  path: "",
  kind: null,
  view: "cover",
  size: "medium",
  sort: "name",
  order: "asc",
  q: "",
  type: "all",
};

const VIEWS: readonly FolderViewMode[] = ["list", "cover"];
const SIZES: readonly FolderSize[] = ["small", "medium", "large"];
const SORTS: readonly FolderSort[] = ["name", "modified", "size", "duration"];
const ORDERS: readonly FolderOrder[] = ["asc", "desc"];
const TYPES: readonly FolderEntryFilter[] = ["all", "directories", "media"];
const KINDS: readonly FolderKind[] = ["movie", "series", "site", "artist", "author"];

function pick<T extends string>(allowed: readonly T[], raw: string | null): T | undefined {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** A root-relative path with no empty, `.` or `..` parts and no backslashes. */
export function normaliseFolderPath(raw: string | null | undefined): string {
  if (!raw || raw.includes("\\") || raw.includes("\0")) return "";
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return "";
    parts.push(part);
  }
  return parts.join("/");
}

export function parseFolderUrl(params: URLSearchParams): FolderUrlState {
  const root = params.get("root");
  return {
    root: root && /^[0-9a-fA-F-]{32,40}$/.test(root) ? root : null,
    path: normaliseFolderPath(params.get("path")),
    kind: pick(KINDS, params.get("kind")) ?? null,
    view: pick(VIEWS, params.get("view")) ?? FOLDER_DEFAULTS.view,
    size: pick(SIZES, params.get("size")) ?? FOLDER_DEFAULTS.size,
    sort: pick(SORTS, params.get("sort")) ?? FOLDER_DEFAULTS.sort,
    order: pick(ORDERS, params.get("order")) ?? FOLDER_DEFAULTS.order,
    q: (params.get("q") ?? "").trim(),
    type: pick(TYPES, params.get("type")) ?? FOLDER_DEFAULTS.type,
  };
}

/**
 * A copy of `current` with `patch` applied. Navigation fields (`root`, `path`,
 * `kind`, `q`, `type`) are dropped at their default; view fields (`view`,
 * `size`, `sort`, `order`) are written explicitly. Other params (`panel`) are
 * left alone. Changing `root` resets `path`, and changing `path` clears the
 * search so a new directory never opens pre-filtered.
 */
export function applyFolderUrl(current: URLSearchParams, patch: Partial<FolderUrlState>): URLSearchParams {
  const out = new URLSearchParams(current);
  const before = parseFolderUrl(current);
  const next: Partial<FolderUrlState> = { ...patch };
  if (patch.root !== undefined && patch.root !== before.root && patch.path === undefined) next.path = "";
  if (patch.path !== undefined && patch.path !== before.path && patch.q === undefined) next.q = "";
  const setOrDelete = (name: string, value: string | null | undefined, empty: string | null) => {
    if (value === undefined) return;
    if (value === null || value === empty || value === "") out.delete(name);
    else out.set(name, value);
  };
  setOrDelete("root", next.root, null);
  setOrDelete("path", next.path === undefined ? undefined : normaliseFolderPath(next.path), "");
  setOrDelete("kind", next.kind, null);
  setOrDelete("q", next.q === undefined ? undefined : next.q.trim(), "");
  setOrDelete("type", next.type, FOLDER_DEFAULTS.type);
  for (const field of ["view", "size", "sort", "order"] as const) {
    const value = next[field];
    if (value !== undefined) out.set(field, value);
  }
  return out;
}

/** Number of filters that narrow the listing (shown as the Filters badge). */
export function activeFolderFilterCount(state: FolderUrlState): number {
  return (state.q ? 1 : 0) + (state.type !== FOLDER_DEFAULTS.type ? 1 : 0);
}

/** Ancestor paths of `path`, outermost first, ending with `path` itself. */
export function folderAncestors(path: string): string[] {
  const parts = normaliseFolderPath(path).split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** The parent directory of `path` (empty for a top-level directory or the root). */
export function parentFolderPath(path: string): string {
  const parts = normaliseFolderPath(path).split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

/** Playable entries of a listing, in order, as the player's queue. */
export function folderPlaybackQueue(entries: readonly FolderEntry[]): { mediaFileId: string; title: string; subtitle?: string }[] {
  return entries
    .filter((entry) => entry.entry_type === "media" && entry.media_file_id)
    .map((entry) => ({
      mediaFileId: entry.media_file_id as string,
      title: entry.title || entry.name,
      subtitle: entry.artist || undefined,
    }));
}

export function formatFolderDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return "";
  const total = Math.round(durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** Fraction watched (0-1) for a part-watched entry, else 0. */
export function folderProgress(entry: FolderEntry): number {
  if (entry.watch_state !== "part_watched" || !entry.position_ms || !entry.duration_ms) return 0;
  return Math.min(1, Math.max(0, entry.position_ms / entry.duration_ms));
}
