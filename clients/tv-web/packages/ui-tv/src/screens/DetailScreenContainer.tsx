import { useState } from "react";
import type { ApiClient } from "@streamarr-tv/api-client";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { AsyncStateMessage } from "../lib/AsyncStateMessage";
import { getOrCreateDeviceUserId } from "../lib/deviceUser";
import { DetailScreen, type RequestActionStatus } from "./DetailScreen";

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
 * nullable) through to `onPlay`, plus a lightweight "Request" action
 * (`POST /api/v1/requests`) for anything not yet fully available.
 *
 * `media_file_id` is only ever non-null on `WorkDetail` itself for the
 * `Movie`-leaf case (`LeafRef::Work`, per the spec's doc comment on that
 * field) -- series/artist/author works carry their playable leaves on their
 * children instead (`EpisodeDetailSchema`/`TrackDetailSchema`/`BookDetailSchema`,
 * each with their own sibling `media_file_id`). A per-episode/track/book
 * picker is out of this pass's scope, so Play stays hidden for those kinds
 * and Request is offered instead whenever the work isn't `available`.
 */
export function DetailScreenContainer({ client, workId, onPlay, onBack }: DetailScreenContainerProps) {
  const state = useWorkDetail(client, workId);
  const [requestStatus, setRequestStatus] = useState<RequestActionStatus>("idle");
  const [requestError, setRequestError] = useState<string | undefined>(undefined);

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
  const showRequest = work.availability !== "available";

  async function submitRequest() {
    setRequestStatus("submitting");
    setRequestError(undefined);
    try {
      await client.submitRequest({
        kind: work.kind,
        requested_by: getOrCreateDeviceUserId(),
        target: { target_kind: "existing_work", work_id: work.id },
      });
      setRequestStatus("submitted");
    } catch (err) {
      setRequestStatus("error");
      setRequestError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <DetailScreen
      work={work}
      canPlay={canPlay}
      onPlay={() => {
        if (mediaFileId) onPlay(mediaFileId);
      }}
      onBack={onBack}
      request={
        showRequest
          ? { status: requestStatus, errorMessage: requestError, onSubmit: () => void submitRequest() }
          : undefined
      }
    />
  );
}
