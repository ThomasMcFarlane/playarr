import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  describeApiError,
  type PlaylistItemResponse,
  type PlaylistResponse,
  type UserResponse,
  type Work,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/**
 * Rename/move/delete + item management, but only for a **System**
 * playlist -- the counterpart to `ViewEditPage.tsx` for playlists. A
 * personal playlist renders read-only (name, owner, its titles) purely
 * for admin visibility: the backend would technically allow an admin
 * write there too (support/moderation), but this UI deliberately doesn't
 * expose that -- a personal playlist stays that user's own to manage in
 * Playarr. See `PlaylistsPage.tsx`'s doc comment for the full rationale.
 *
 * Item ordering is append-only here (drag-reorder is a
 * `PlaylistRepo::reorder_items`-backed follow-up, not built yet); an
 * admin can add a title (via catalog search) or remove one from a System
 * playlist.
 */
export function PlaylistEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const client = useApiClient();

  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null);
  const [owner, setOwner] = useState<UserResponse | null>(null);
  const [allSystemPlaylists, setAllSystemPlaylists] = useState<PlaylistResponse[]>([]);
  const [items, setItems] = useState<PlaylistItemResponse[] | null>(null);
  const [works, setWorks] = useState<Record<string, Work>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Work[]>([]);
  const [searching, setSearching] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useDocumentTitle(playlist?.name ?? "Playlist");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    Promise.all([client.getPlaylist(id), client.listPlaylistItems(id), client.listAdminPlaylists()])
      .then(([playlistResult, itemsResult, allResult]) => {
        setPlaylist(playlistResult);
        setName(playlistResult.name);
        setParentId(playlistResult.parent_playlist_id ?? "");
        setItems(itemsResult);
        setAllSystemPlaylists(
          allResult.filter(
            (p) =>
              p.is_system &&
              p.id !== id &&
              p.media_type === playlistResult.media_type
          )
        );
        if (!playlistResult.is_system && playlistResult.owner_user_id) {
          client
            .listUsers()
            .then((users) => setOwner(users.find((u) => u.id === playlistResult.owner_user_id) ?? null))
            .catch(() => setOwner(null));
        }
      })
      .catch((err: unknown) => setError(describeApiError(err)))
      .finally(() => setLoading(false));
  }, [client, id]);

  useEffect(() => {
    if (!items) return;
    const missing = items.map((i) => i.work_id).filter((workId) => !(workId in works));
    if (missing.length === 0) return;
    Promise.all(
      missing.map((workId) =>
        client
          .getWork(workId)
          .then((detail) => [workId, detail.work] as const)
          .catch(() => null)
      )
    ).then((resolved) => {
      setWorks((current) => {
        const next = { ...current };
        for (const entry of resolved) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await client.updatePlaylist(id, {
        name,
        parent_playlist_id: parentId || undefined,
      });
      setPlaylist(updated);
    } catch (err) {
      setSaveError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await client.deletePlaylist(id);
      navigate("/playlists");
    } catch (err) {
      setSaveError(describeApiError(err));
      setDeleting(false);
    }
  }

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setAddError(null);
    try {
      const found = await client.searchCatalog(query, 10);
      setResults(
        found.filter(
          (work) =>
            work.kind === "movie" ||
            work.kind === "series" ||
            work.kind === "site"
        )
      );
    } catch (err) {
      setAddError(describeApiError(err));
    } finally {
      setSearching(false);
    }
  }

  async function handleAddItem(work: Work) {
    if (!id) return;
    setAddError(null);
    try {
      const item = await client.addPlaylistItem(id, { work_id: work.id });
      setItems((current) => [...(current ?? []), item]);
      setWorks((current) => ({ ...current, [work.id]: work }));
    } catch (err) {
      setAddError(describeApiError(err));
    }
  }

  async function handleRemoveItem(item: PlaylistItemResponse) {
    if (!id) return;
    try {
      await client.removePlaylistItem(id, item.id);
      setItems((current) => current?.filter((i) => i.id !== item.id) ?? current);
    } catch (err) {
      setError(describeApiError(err));
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="page">
        <p className="error-text">{error ?? "Not found."}</p>
      </div>
    );
  }

  if (!playlist.is_system) {
    return (
      <div className="page">
        <h1 className="page-title">{playlist.name}</h1>
        <p className="muted" style={{ marginBottom: "1.5rem" }}>
          Personal playlist owned by {owner ? owner.display_name : "a user"} -- view only. This user
          manages it in Playarr.
        </p>

        <h2 className="work-detail-section-title">Titles</h2>
        {items !== null && items.length === 0 && <p className="muted">No titles yet.</p>}
        {items !== null && items.length > 0 && (
          <table className="table" style={{ width: "100%", maxWidth: 640, marginBottom: "1.5rem" }}>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{works[item.work_id]?.title ?? item.work_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button type="button" className="btn btn-secondary" onClick={() => navigate("/playlists")}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">{playlist.name}</h1>
      <p className="muted">
        {playlist.media_type === "audio" ? "Audio playlist" : "Video playlist"}
      </p>

      {saveError && <p className="error-text hint" style={{ marginBottom: "1rem" }}>{saveError}</p>}

      <form
        onSubmit={(e) => void handleSave(e)}
        style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 480, marginBottom: "2rem" }}
      >
        <div className="modal-field">
          <label className="form-label" htmlFor="playlist-edit-name">
            Name
          </label>
          <input
            id="playlist-edit-name"
            className="input"
            style={{ width: "100%" }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="modal-field">
          <label className="form-label" htmlFor="playlist-edit-parent">
            Parent (optional)
          </label>
          <select
            id="playlist-edit-parent"
            className="input"
            style={{ width: "100%" }}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">None -- top-level playlist</option>
            {allSystemPlaylists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between" }}>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void handleDelete()}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete playlist"}
          </button>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate("/playlists")}>
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>

      <h2 className="work-detail-section-title">Titles</h2>

      {items !== null && items.length === 0 && <p className="muted">No titles yet.</p>}

      {items !== null && items.length > 0 && (
        <table className="table" style={{ width: "100%", maxWidth: 640, marginBottom: "1.5rem" }}>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{works[item.work_id]?.title ?? item.work_id}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleRemoveItem(item)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {playlist.media_type === "video" ? (
        <form
          onSubmit={(e) => void handleSearch(e)}
          style={{ display: "flex", gap: "0.75rem", maxWidth: 480, marginBottom: "1rem" }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Search titles to add..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary" disabled={searching}>
            {searching ? "Searching..." : "Search"}
          </button>
        </form>
      ) : (
        <p className="muted">
          Add individual tracks from their hold menu in Playarr.
        </p>
      )}

      {addError && <p className="error-text hint">{addError}</p>}

      {playlist.media_type === "video" && results.length > 0 && (
        <table className="table" style={{ width: "100%", maxWidth: 640 }}>
          <tbody>
            {results.map((work) => (
              <tr key={work.id}>
                <td>{work.title}</td>
                <td className="muted">{work.kind}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={items?.some((i) => i.work_id === work.id)}
                    onClick={() => void handleAddItem(work)}
                  >
                    {items?.some((i) => i.work_id === work.id) ? "Added" : "Add"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
