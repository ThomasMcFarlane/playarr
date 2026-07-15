import { Link, useNavigate, useParams } from "react-router-dom";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { pickImage } from "../lib/images";

/**
 * A single title's detail page, backed by the real `GET /api/v1/catalog/{id}` endpoint.
 *
 * KNOWN GAP: `backend/openapi/streamarr.yaml`'s catalog schemas never expose a
 * `media_file_id` (only `GET /api/v1/playback/{media_file_id}` takes one, with no
 * documented way to obtain it from the catalog/detail response). Until the backend
 * grows a real per-file id, "Play" links to `/player/${work.id}`, using the Work's own
 * id as a placeholder `media_file_id` (movies are effectively 1:1 with a file today).
 */
export function WorkDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const client = useApiClient();
  const state = useWorkDetail(client, workId);
  const navigate = useNavigate();

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
        const { work } = state.data;
        const backdropUrl = pickImage(work.images, "backdrop") ?? pickImage(work.images, "poster");
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
              {work.kind} &middot; {work.availability.replace(/_/g, " ")}
            </p>
            <p style={{ color: "#a0a0a0", maxWidth: 640 }}>{work.overview ?? "No synopsis available."}</p>
            <Link
              to={`/player/${work.id}`}
              style={{
                display: "inline-block",
                marginTop: "1rem",
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
          </>
        );
      })()}
    </div>
  );
}
