import type { LiveChangeEvent } from "@playarr-tv/api-client";

/**
 * What a consumer shows, not what the server called the event. Consumers
 * register for areas; `mapChangeToInvalidations` translates a `change` frame
 * (docs/architecture/live-events.md, "Event types") into the areas to refetch.
 */
export type LiveArea =
  /** Watch progress, watched badges, Continue Watching, Up Next, series season/episode state. */
  | "progress"
  /** Catalogue-derived views: work detail, seasons/episodes, library lists, Home rails, search. */
  | "catalog"
  | "calendar"
  | "playlists"
  | "watchlist"
  | "downloads"
  | "household"
  | "account"
  /** The read-only server group list (Settings → Server). */
  | "serverGroup"
  | "admin";

export interface Invalidation {
  area: LiveArea;
  /**
   * The entity that moved (work id, playlist id, ...). Undefined means the whole
   * area (bulk change, resync): every consumer of the area refetches.
   */
  key?: string;
}

export function mapChangeToInvalidations(event: Pick<LiveChangeEvent, "type" | "entity" | "id" | "changed">): Invalidation[] {
  const wildcard = event.entity === "*" || event.id == null || event.id === "" || event.changed.includes("bulk");
  const key = wildcard ? undefined : (event.id ?? undefined);
  switch (event.type) {
    case "watch":
      return [{ area: "progress", key }];
    case "library":
      return [{ area: "catalog", key }];
    case "calendar":
      return [{ area: "calendar", key }];
    case "playlist":
      return [{ area: "playlists", key }];
    case "watchlist":
      return [{ area: "watchlist", key }];
    case "download":
      return [{ area: "downloads", key }];
    case "household":
      return [{ area: "household", key }];
    case "account":
      // A member joined, left or changed its client address: only the group list shows it.
      if (event.entity === "server_group") return [{ area: "serverGroup" }];
      // Policy and library-access changes alter what the catalogue returns.
      return [{ area: "account" }, { area: "household" }, { area: "catalog" }];
    case "admin":
      return [{ area: "admin", key }];
    default:
      return [];
  }
}
