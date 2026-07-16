import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  describeApiError,
  type LibraryViewRequest,
  type LibraryViewResponse,
  type SourceInstanceResponse,
  type Work,
  type WorkKind,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const EMPTY_FORM: LibraryViewRequest = {
  name: "",
  criteria: {
    kind: undefined,
    source_instance_id: undefined,
    genre: undefined,
    tag: undefined,
    available_only: false,
    release_window_days: undefined,
  },
  sort: ["title"],
};

const KIND_OPTIONS: { value: WorkKind | ""; label: string }[] = [
  { value: "", label: "Any" },
  { value: "movie", label: "Movie" },
  { value: "series", label: "Series" },
  { value: "site", label: "Site" },
  { value: "artist", label: "Artist" },
  { value: "author", label: "Author" },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "title", label: "Title (A–Z)" },
  { value: "recent", label: "Recently added" },
  { value: "released", label: "Recently released" },
  { value: "last_played", label: "Last played (per viewer)" },
];

/**
 * Create/edit page for a single "View" -- `POST /api/v1/admin/views`
 * (create, no `:id` param) or `PUT /api/v1/admin/views/{id}` (edit). A
 * dedicated route rather than a modal (unlike `SourceInstancesPage`): the
 * filter builder needs more room, and it benefits from a live result-count
 * preview beneath the form -- see the debounced `browseCatalog` preview
 * below.
 */
export function ViewEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;
  useDocumentTitle(isNew ? "New view" : "Edit view");
  const client = useApiClient();
  const navigate = useNavigate();

  const [form, setForm] = useState<LibraryViewRequest>(EMPTY_FORM);
  const [existing, setExisting] = useState<LibraryViewResponse | null>(null);
  const [sourceInstances, setSourceInstances] = useState<SourceInstanceResponse[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live preview state.
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewTitles, setPreviewTitles] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    client.listSourceInstances().then(setSourceInstances).catch(() => setSourceInstances([]));
  }, [client]);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    client
      .listAdminViews()
      .then((views) => {
        const found = views.find((v) => v.id === id);
        if (!found) {
          setError("View not found.");
          return;
        }
        setExisting(found);
        setForm({ name: found.name, criteria: found.criteria, sort: found.sort });
      })
      .catch((err: unknown) => setError(describeApiError(err)))
      .finally(() => setLoading(false));
  }, [client, id, isNew]);

  // Debounced (~400ms) client-side preview via the same `browseCatalog`
  // call `LibraryPage` already makes -- deliberately not the `resolve`
  // endpoint (a not-yet-saved view has no id), and deliberately not
  // Playarr's `WorkCard` (a different app/package). Just enough feedback
  // to catch an obviously-wrong filter before saving.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewError(null);
      const formSort = form.sort?.[0] ?? "title";
      client
        .browseCatalog({
          kind: form.criteria.kind || undefined,
          source_instance_id: form.criteria.source_instance_id || undefined,
          genre: form.criteria.genre || undefined,
          available_only: form.criteria.available_only,
          // Closest available preview proxy: `browseCatalog` has no
          // "released" sort, so a release-date-sorted view previews with
          // "recent" instead -- see the note rendered below the preview list.
          sort: formSort === "released" ? "recent" : formSort,
          limit: 5,
          offset: 0,
        })
        .then((page) => {
          setPreviewCount(page.total ?? page.items.length);
          setPreviewTitles(page.items.map((w: Work) => w.title));
        })
        .catch((err: unknown) => setPreviewError(describeApiError(err)));
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    client,
    form.criteria.kind,
    form.criteria.source_instance_id,
    form.criteria.genre,
    form.criteria.available_only,
    form.sort?.[0],
  ]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await client.createView(form);
      } else if (id) {
        await client.updateView(id, form);
      }
      navigate("/views");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    setError(null);
    try {
      await client.deleteView(id);
      navigate("/views");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">{isNew ? "New view" : "Edit view"}</h1>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 480 }}
      >
        <div className="modal-field">
          <label className="form-label" htmlFor="view-name">
            Name
          </label>
          <input
            id="view-name"
            className="input"
            style={{ width: "100%" }}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </div>

        <div className="modal-field">
          <label className="form-label" htmlFor="view-kind">
            Kind
          </label>
          <select
            id="view-kind"
            className="input"
            style={{ width: "100%" }}
            value={form.criteria.kind ?? ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                criteria: { ...f.criteria, kind: (e.target.value || undefined) as WorkKind | undefined },
              }))
            }
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-field">
          <label className="form-label" htmlFor="view-library">
            Library
          </label>
          <select
            id="view-library"
            className="input"
            style={{ width: "100%" }}
            value={form.criteria.source_instance_id ?? ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                criteria: { ...f.criteria, source_instance_id: e.target.value || undefined },
              }))
            }
          >
            <option value="">Any library</option>
            {sourceInstances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-field">
          <label className="form-label" htmlFor="view-genre">
            Genre
          </label>
          <input
            id="view-genre"
            className="input"
            style={{ width: "100%" }}
            placeholder="e.g. Action"
            value={form.criteria.genre ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, criteria: { ...f.criteria, genre: e.target.value || undefined } }))
            }
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={form.criteria.available_only}
            onChange={(e) =>
              setForm((f) => ({ ...f, criteria: { ...f.criteria, available_only: e.target.checked } }))
            }
          />
          Available only
        </label>

        <div className="modal-field">
          <label className="form-label" htmlFor="view-sort">
            Sort
          </label>
          <select
            id="view-sort"
            className="input"
            style={{ width: "100%" }}
            value={form.sort?.[0] ?? "title"}
            onChange={(e) => setForm((f) => ({ ...f, sort: [e.target.value] }))}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-field">
          <label className="form-label" htmlFor="view-release-window">
            Only show titles released in the last N days
          </label>
          <input
            id="view-release-window"
            type="number"
            min={1}
            className="input"
            style={{ width: "100%" }}
            placeholder="e.g. 30 (leave blank for no limit)"
            value={form.criteria.release_window_days ?? ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                criteria: {
                  ...f.criteria,
                  release_window_days: e.target.value ? Number(e.target.value) : undefined,
                },
              }))
            }
          />
        </div>

        <div className="card" style={{ padding: "0.75rem 1rem" }}>
          {previewError && <p className="error-text hint">{previewError}</p>}
          {!previewError && previewCount !== null && (
            <>
              <p className="muted hint" style={{ margin: 0 }}>
                {previewCount} matching title{previewCount === 1 ? "" : "s"}
                {form.sort?.[0] === "released" &&
                  " (preview sorted by recently-added; release-date sort isn't previewable client-side)"}
              </p>
              {previewTitles.length > 0 && (
                <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                  {previewTitles.map((title, i) => (
                    <li key={i} className="muted">
                      {title}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between" }}>
          <div>
            {!isNew && (
              <>
                {existing?.is_default ? (
                  <span className="muted hint">Default views can't be deleted.</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                )}
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate("/views")}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
