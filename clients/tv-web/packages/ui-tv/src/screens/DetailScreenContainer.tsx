import type { ApiClient } from "@streamarr-tv/api-client";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { AsyncStateMessage } from "../lib/AsyncStateMessage";
import { DetailScreen } from "./DetailScreen";

export interface DetailScreenContainerProps {
  client: ApiClient;
  workId: string;
  /** Receives a `media_file_id` to hand to `PlayerScreenContainer` / `getPlaybackInfo`. */
  onPlay: (mediaFileId: string) => void;
  onBack?: () => void;
}

/**
 * Fetches a work's full detail tree from the real `GET /api/v1/catalog/{id}`
 * endpoint and hands the `work` half to the presentational `DetailScreen`.
 *
 * KNOWN GAP: `backend/openapi/streamarr.yaml`'s catalog schemas (`Work`,
 * `Episode`, `Track`, the bare `"Movie"` children variant) never expose a
 * `media_file_id` -- only `GET /api/v1/playback/{media_file_id}` takes one,
 * with no documented way to obtain it from the catalog/detail response. Until
 * the backend adds one, this container passes the `Work`'s own id through as
 * the `media_file_id` (movies are effectively 1:1 with a file today); swap
 * this out once the API grows a real per-file id.
 */
export function DetailScreenContainer({ client, workId, onPlay, onBack }: DetailScreenContainerProps) {
  const state = useWorkDetail(client, workId);

  if (state.status === "loading" || state.status === "idle") {
    return <AsyncStateMessage kind="loading" />;
  }
  if (state.status === "error") {
    return <AsyncStateMessage kind="error" message={`Could not load this title (${state.message}).`} />;
  }
  if (state.status === "empty") {
    return <AsyncStateMessage kind="empty" message="This title has no details available." />;
  }

  const { work } = state.data;
  return <DetailScreen work={work} onPlay={() => onPlay(work.id)} onBack={onBack} />;
}
