import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, type Availability } from "@streamarr-tv/api-client";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { pickImage } from "../lib/images";
import { getStoredRequesterId, setStoredRequesterId } from "../lib/requesterIdentity";
import { isValidUuid } from "../lib/uuid";

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
 */
export function WorkDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const client = useApiClient();
  const state = useWorkDetail(client, workId);
  const navigate = useNavigate();

  const [requesterId, setRequesterId] = useState(() => getStoredRequesterId());
  const [requestStatus, setRequestStatus] = useState<RequestUiStatus>("idle");
  const [requestError, setRequestError] = useState<string | null>(null);

  // Reset request UI state when navigating between titles.
  useEffect(() => {
    setRequestStatus("idle");
    setRequestError(null);
  }, [workId]);

  function handleRequesterIdChange(value: string) {
    setRequesterId(value);
    setStoredRequesterId(value);
  }

  async function submitRequest(kind: "movie" | "series" | "artist" | "author", targetWorkId: string) {
    setRequestStatus("submitting");
    setRequestError(null);
    try {
      await client.submitRequest({
        kind,
        requested_by: requesterId,
        target: { target_kind: "existing_work", work_id: targetWorkId },
      });
      setRequestStatus("submitted");
    } catch (err) {
      setRequestStatus("error");
      setRequestError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{ background: "none", border: "none", color: "#a0a0a0", cursor: "pointer", padding: 0, marginBottom: "1rem" }}
      >
        &larr; Back
      </button>

      {(state.status === "loading" || state.status === "idle") && <p style={{ color: "#a0a0a0" }}>Loading...</p>}

      {state.status === "error" && (
        <p style={{ color: "#e74c3c" }}>Could not load this title ({state.message}).</p>
      )}

      {state.status === "empty" && <p style={{ color: "#a0a0a0" }}>This title has no details available.</p>}

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
            <h1 style={{ marginBottom: "0.25rem" }}>{work.title}</h1>
            <p style={{ color: "#5c5c5c", fontSize: "0.875rem", textTransform: "capitalize" }}>
              {work.kind} &middot; {availabilityLabel(work.availability)}
            </p>
            <p style={{ color: "#a0a0a0", maxWidth: 640 }}>{work.overview ?? "No synopsis available."}</p>

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "1rem" }}>
              {canPlay && (
                <Link
                  to={`/player/${mediaFileId}`}
                  style={{
                    display: "inline-block",
                    padding: "0.5rem 1.5rem",
                    borderRadius: 6,
                    backgroundColor: "#e50914",
                    color: "#ffffff",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  Play
                </Link>
              )}

              {showRequest && (
                <button
                  type="button"
                  disabled={
                    !isValidUuid(requesterId) || requestStatus === "submitting" || requestStatus === "submitted"
                  }
                  onClick={() => void submitRequest(work.kind, work.id)}
                  style={{
                    padding: "0.5rem 1.5rem",
                    borderRadius: 6,
                    border: "1px solid #2a2a2a",
                    background: canPlay ? "transparent" : "#e50914",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor:
                      !isValidUuid(requesterId) || requestStatus === "submitting" || requestStatus === "submitted"
                        ? "default"
                        : "pointer",
                    opacity:
                      !isValidUuid(requesterId) || requestStatus === "submitting" || requestStatus === "submitted"
                        ? 0.7
                        : 1,
                  }}
                >
                  {requestStatusLabel(requestStatus)}
                </button>
              )}
            </div>

            {showRequest && (
              <div style={{ marginTop: "0.75rem", maxWidth: 360 }}>
                <label style={{ display: "block", color: "#a0a0a0", fontSize: "0.875rem" }}>
                  Your user id (uuid, used as <code>requested_by</code> -- there is no sign-in yet, see{" "}
                  <code>SubmitRequestBody</code>'s TODO)
                  <input
                    type="text"
                    value={requesterId}
                    onChange={(event) => handleRequesterIdChange(event.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    style={{
                      display: "block",
                      marginTop: "0.25rem",
                      width: "100%",
                      padding: "0.4rem 0.6rem",
                      borderRadius: 6,
                      border: "1px solid #2a2a2a",
                      background: "#121212",
                      color: "#ffffff",
                    }}
                  />
                </label>
                {requestStatus === "submitted" && (
                  <p style={{ color: "#2ecc71", marginTop: "0.5rem" }}>
                    Requested -- an admin can review it from the Admin page.
                  </p>
                )}
                {requestStatus === "error" && requestError && (
                  <p style={{ color: "#e74c3c", marginTop: "0.5rem" }}>
                    Could not submit this request ({requestError}).
                  </p>
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
