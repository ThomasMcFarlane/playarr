import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeApiError, type LibraryViewResponse } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { KIND_LABELS } from "../components/PosterCard";

/**
 * Builds a short, human-readable summary of a view's `criteria` for the
 * list table -- e.g. "Movies · Radarr (4K) · Action" or "All titles" when
 * every field is unset. Purely a display helper; the real filter logic
 * lives server-side in `CatalogService::resolve_view`.
 */
function summarizeCriteria(view: LibraryViewResponse): string {
  const parts: string[] = [];
  if (view.criteria.kind) {
    parts.push(KIND_LABELS[view.criteria.kind]);
  }
  if (view.criteria.genre) parts.push(view.criteria.genre);
  if (view.criteria.tag) parts.push(`tag:${view.criteria.tag}`);
  if (view.criteria.available_only) parts.push("Available only");
  if (view.criteria.release_window_days) {
    parts.push(`last ${view.criteria.release_window_days}d`);
  }
  return parts.length > 0 ? parts.join(" · ") : "All titles";
}

const SORT_LABELS: Record<string, string> = {
  title: "Title (A–Z)",
  recent: "Recently added",
  released: "Recently released",
  last_played: "Last played (per viewer)",
};

/** `sort` is ordered, most-significant first -- joins every key's label, comma-separated. */
function summarizeSort(sort: string[]): string {
  if (sort.length === 0) return SORT_LABELS.title ?? "title";
  return sort.map((key) => SORT_LABELS[key] ?? key).join(", ");
}

/**
 * Lists every saved "View" (named filter+sort preset over the catalog) --
 * the admin surface for `GET/POST/PUT/DELETE /api/v1/admin/views`
 * (backend/crates/streamarr-api/src/views.rs). Views are global/admin-
 * managed (not per-user, see `streamarr_model::LibraryView`'s doc comment)
 * and are the data source for Playarr's Home screen shelves beyond the
 * single hardcoded "recently added" one -- see
 * clients/tv-web/PLAYARR_HANDOVER.md's "New backend feature: Views" section.
 */
export function ViewsPage() {
  useDocumentTitle("Views");
  const client = useApiClient();
  const navigate = useNavigate();
  const [views, setViews] = useState<LibraryViewResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    client
      .listAdminViews()
      .then(setViews)
      .catch((err: unknown) => setError(describeApiError(err)));
  }, [client]);

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Views
        </h1>
        <button type="button" className="btn btn-primary" onClick={() => navigate("/views/new")}>
          + New view
        </button>
      </div>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        Named, saved filter+sort presets over the catalog -- surfaced to Playarr as Home screen
        shelves. "Newly Added" and "Newly Released" are seeded defaults; add your own (e.g. "Action
        Movies") to give Playarr more shelves to render.
      </p>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      {views !== null && views.length === 0 && <p className="muted">No views yet.</p>}

      {views !== null && views.length > 0 && (
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Filter</th>
              <th style={{ textAlign: "left" }}>Sort</th>
              <th style={{ textAlign: "left" }}></th>
            </tr>
          </thead>
          <tbody>
            {views.map((view) => (
              <tr
                key={view.id}
                onClick={() => navigate(`/views/${view.id}`)}
                style={{ cursor: "pointer" }}
              >
                <td>{view.name}</td>
                <td className="muted">{summarizeCriteria(view)}</td>
                <td className="muted">{summarizeSort(view.sort)}</td>
                <td>
                  <span className={`badge badge-pill ${view.is_default ? "badge-neutral" : "badge-success"}`}>
                    {view.is_default ? "Default" : "Custom"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
