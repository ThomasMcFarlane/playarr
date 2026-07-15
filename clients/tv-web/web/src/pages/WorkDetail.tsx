import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { describeApiError, type Availability } from "@streamarr-tv/api-client";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { pickImage } from "../lib/images";

type RequestUiStatus = "idle" | "submitting" | "submitted" | "error";

/**
 * A single title's detail page, backed by the real `GET /api/v1/catalog/{id}` endpoint.
 *
 * "Play" links to `/player/${media_file_id}`, using the real, resolved
 * `WorkDetailSchema.media_file_id` (nullable) rather than the Work's own id
 * -- only ever non-null for the `Movie`-leaf case; series/artist/author
 * works carry their playable leaves on their children instead, so Play
 * stays hidden for those kinds pending a per-episode/track/book picker
 * (out of this pass's scope). Whenever the work isn't fully `available`,
 * a "Request" action (`POST /api/v1/requests`) is offered instead.
 *
 * Round E wired real auth middleware into the backend: `requested_by` is no
 * longer a client-supplied field (the removed Round D workaround asked for
 * a real user id and persisted it locally) -- the server now derives it from
 * the verified access token's `sub` claim, obtained transparently by the
 * `ApiClient` this page uses (see `ApiClientProvider`) via `POST /api/v1/auth/login`.
 */
export function WorkDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const client = useApiClient();
  const state = useWorkDetail(client, workId);
  const navigate = useNavigate();

  const [requestStatus, setRequestStatus] = useState<RequestUiStatus>("idle");
  const [requestError, setRequestError] = useState<string | null>(null);

  // Reset request UI state when navigating between titles.
  useEffect(() => {
    setRequestStatus("idle");
    setRequestError(null);
  }, [workId]);

  async function submitRequest(kind: "movie" | "series" | "artist" | "author", targetWorkId: string) {
    setRequestStatus("submitting");
    setRequestError(null);
    try {
      await client.submitRequest({
        kind,
        target: { target_kind: "existing_work", work_id: targetWorkId },
      });
      setRequestStatus("submitted");
    } catch (err) {
      setRequestStatus("error");
      setRequestError(describeApiError(err));
    }
  }

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
        const showRequest = work.availability !== "available";

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

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "1.25rem" }}>
              {canPlay && (
                <Link to={`/player/${mediaFileId}`} className="btn btn-primary">
                  Play
                </Link>
              )}

              {showRequest && (
                <button
                  type="button"
                  disabled={requestStatus === "submitting" || requestStatus === "submitted"}
                  onClick={() => void submitRequest(work.kind, work.id)}
                  className={`btn ${canPlay ? "btn-secondary" : "btn-primary"}`}
                >
                  {requestStatusLabel(requestStatus)}
                </button>
              )}
            </div>

            {showRequest && (
              <div style={{ marginTop: "0.75rem", maxWidth: 360 }}>
                {requestStatus === "submitted" && (
                  <p className="success-text">Requested -- an admin can review it from the Admin page.</p>
                )}
                {requestStatus === "error" && requestError && (
                  <p className="error-text">Could not submit this request ({requestError}).</p>
                )}
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

function requestStatusLabel(status: RequestUiStatus): string {
  switch (status) {
    case "idle":
      return "Request";
    case "submitting":
      return "Requesting...";
    case "submitted":
      return "Requested";
    case "error":
      return "Retry request";
  }
}
