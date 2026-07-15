import { type ApiClient } from "@streamarr-tv/api-client";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { AsyncStateMessage } from "../lib/AsyncStateMessage";
import { DetailScreen } from "./DetailScreen";

export interface DetailScreenContainerProps {
  client: ApiClient;
  workId: string;
  /** Receives the resolved `media_file_id` to hand to `PlayerScreenContainer` / `getPlaybackInfo`. */
  onPlay: (mediaFileId: string) => void;
  onBack?: () => void;
}

/**
 * Fetches a work's full detail tree from the real `GET /api/v1/catalog/{id}`
 * endpoint and hands the real, resolved `media_file_id` (`WorkDetailSchema.media_file_id`,
 * nullable) through to `onPlay`.
 *
 * `media_file_id` is only ever non-null on `WorkDetail` itself for the
 * `Movie`-leaf case (`LeafRef::Work`, per the spec's doc comment on that
 * field) -- series/artist/author works carry their playable leaves on their
 * children instead (`EpisodeDetailSchema`/`TrackDetailSchema`/`BookDetailSchema`,
 * each with their own sibling `media_file_id`). A per-episode/track/book
 * picker is out of this pass's scope, so Play stays hidden for those kinds.
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

  const { work, media_file_id: mediaFileId } = state.data;
  const canPlay = mediaFileId != null;

  return (
    <DetailScreen
      work={work}
      canPlay={canPlay}
      onPlay={() => {
        if (mediaFileId) onPlay(mediaFileId);
      }}
      onBack={onBack}
    />
  );
}
