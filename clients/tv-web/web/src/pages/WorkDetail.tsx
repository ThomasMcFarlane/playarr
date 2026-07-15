import { Link, useNavigate, useParams } from "react-router-dom";
import { type Availability } from "@streamarr-tv/api-client";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { pickImage } from "../lib/images";

/**
 * A single title's detail page, backed by the real `GET /api/v1/catalog/{id}` endpoint.
 *
 * "Play" links to `/player/${media_file_id}`, using the real, resolved
 * `WorkDetailSchema.media_file_id` (nullable) rather than the Work's own id
 * -- only ever non-null for the `Movie`-leaf case; series/artist/author
 * works carry their playable leaves on their children instead, so Play
 * stays hidden for those kinds pending a per-episode/track/book picker
 * (out of this pass's scope).
 */
export function WorkDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const client = useApiClient();
  const state = useWorkDetail(client, workId);
  const navigate = useNavigate();

  return (
    <div className="page">
      <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: "1rem" }}>
        &larr; Back
      </button>

      {(state.status === "loading" || state.status === "idle") && <p className="muted">Loading...</p>}

      {state.status === "error" && <p className="error-text">Could not load this title ({state.message}).</p>}

      {state.status === "empty" && <p className="muted">This title has no details available.</p>}

      {state.status === "ready" && (() => {
        const { work, media_file_id: mediaFileId } = state.data;
        const backdropUrl = pickImage(work.images, "backdrop") ?? pickImage(work.images, "poster");
        const canPlay = mediaFileId != null;

        return (
          <>
            {backdropUrl && (
              <img
                src={backdropUrl}
                alt=""
                style={{ width: "100%", maxWidth: 960, borderRadius: 8, marginBottom: "1.5rem" }}
              />
            )}
            <h1 style={{ marginBottom: "0.25rem", fontSize: "1.75rem", fontWeight: 700 }}>{work.title}</h1>
            <p className="hint" style={{ textTransform: "capitalize", marginBottom: "0.75rem" }}>
              {work.kind} &middot; {availabilityLabel(work.availability)}
            </p>
            <p className="muted" style={{ maxWidth: 640 }}>
              {work.overview ?? "No synopsis available."}
            </p>

            {canPlay && (
              <div style={{ marginTop: "1.25rem" }}>
                <Link to={`/player/${mediaFileId}`} className="btn btn-primary">
                  Play
                </Link>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

function availabilityLabel(availability: Availability): string {
  return availability.replace(/_/g, " ");
}
