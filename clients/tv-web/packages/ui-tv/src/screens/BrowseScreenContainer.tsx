import { useMemo } from "react";
import type { ApiClient, Work } from "@playarr-tv/api-client";
import { useCatalogBrowse } from "@playarr-tv/api-client/react";
import { AsyncStateMessage } from "../lib/AsyncStateMessage";
import { BrowseScreen, type BrowseRow } from "./BrowseScreen";

const ROW_ORDER: Array<{ kind: Work["kind"]; title: string }> = [
  { kind: "movie", title: "Movies" },
  { kind: "series", title: "Series" },
  { kind: "artist", title: "Music" },
  { kind: "author", title: "Books" },
];

export interface BrowseScreenContainerProps {
  client: ApiClient;
  onSelectWork: (work: Work) => void;
}

/**
 * Fetches the default catalog page from the real `GET /api/v1/catalog`
 * endpoint and groups it into shelves by `Work.kind`, then hands the result
 * to the presentational `BrowseScreen`. Handles the loading/empty/error
 * states shared with every other screen container and with the web app's
 * Library/Home pages (same `useCatalogBrowse` hook).
 */
export function BrowseScreenContainer({ client, onSelectWork }: BrowseScreenContainerProps) {
  const state = useCatalogBrowse(client, { sort: "title" });

  const rows = useMemo<BrowseRow[]>(() => {
    if (state.status !== "ready") return [];
    return ROW_ORDER.map(({ kind, title }) => ({
      id: kind,
      title,
      works: state.data.items.filter((work) => work.kind === kind),
    })).filter((row) => row.works.length > 0);
  }, [state]);

  if (state.status === "loading" || state.status === "idle") {
    return <AsyncStateMessage kind="loading" message="Loading your library..." />;
  }
  if (state.status === "error") {
    return <AsyncStateMessage kind="error" message={`Could not load the library (${state.message}).`} />;
  }
  if (state.status === "empty" || rows.length === 0) {
    return <AsyncStateMessage kind="empty" message="Your library is empty. Add some media to get started." />;
  }

  return <BrowseScreen rows={rows} onSelectWork={onSelectWork} />;
}
