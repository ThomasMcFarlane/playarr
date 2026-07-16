import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeApiError, type PlaylistResponse, type UserResponse } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { Modal } from "../components/Modal";

/**
 * Sorts playlists into display order: every top-level playlist
 * (alphabetical), each immediately followed by its own children
 * (alphabetical) -- a flat, indented tree rather than a real nested
 * component, since `parent_playlist_id` nesting is expected to stay
 * shallow (see `streamarr_model::playlist`'s doc comment).
 */
function sortForDisplay(playlists: PlaylistResponse[]): Array<{ playlist: PlaylistResponse; depth: number }> {
  const byParent = new Map<string | null, PlaylistResponse[]>();
  for (const playlist of playlists) {
    const key = playlist.parent_playlist_id ?? null;
    const siblings = byParent.get(key) ?? [];
    siblings.push(playlist);
    byParent.set(key, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name));
  }

  const ordered: Array<{ playlist: PlaylistResponse; depth: number }> = [];
  function visit(parentId: string | null, depth: number) {
    for (const playlist of byParent.get(parentId) ?? []) {
      ordered.push({ playlist, depth });
      visit(playlist.id, depth + 1);
    }
  }
  visit(null, 0);
  return ordered;
}

/**
 * Admin view of every playlist -- System (admin-managed, e.g. "Staff
 * Picks") and every user's personal ones. Only System playlists are
 * creatable/editable/deletable here (backed by `POST/PUT/DELETE
 * /api/v1/playlists*`, which the backend restricts to admin for a System
 * playlist); personal playlists are shown read-only, owner labeled, purely
 * for admin visibility (backed by the admin-only `GET
 * /api/v1/admin/playlists`) -- see `streamarr_api::playlists`'s module doc
 * comment for the full ownership/access-control split this mirrors. A
 * user's own personal playlists remain theirs to create/edit/delete in
 * Playarr, not here.
 */
export function PlaylistsPage() {
  useDocumentTitle("Playlists");
  const client = useApiClient();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<PlaylistResponse[] | null>(null);
  const [users, setUsers] = useState<Record<string, UserResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function refresh() {
    setError(null);
    client
      .listAdminPlaylists()
      .then(setPlaylists)
      .catch((err: unknown) => setError(describeApiError(err)));
    client
      .listUsers()
      .then((all) => setUsers(Object.fromEntries(all.map((u) => [u.id, u]))))
      .catch(() => setUsers({}));
  }

  useEffect(refresh, [client]);

  const systemPlaylists = playlists?.filter((p) => p.is_system) ?? [];

  function openCreateModal() {
    setName("");
    setParentId("");
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await client.createPlaylist({
        name,
        is_system: true,
        parent_playlist_id: parentId || undefined,
      });
      setCreateOpen(false);
      refresh();
    } catch (err) {
      setCreateError(describeApiError(err));
    } finally {
      setCreating(false);
    }
  }

  function ownerLabel(playlist: PlaylistResponse): string {
    if (playlist.is_system) return "System";
    const owner = playlist.owner_user_id ? users[playlist.owner_user_id] : undefined;
    return owner ? owner.display_name : "Personal";
  }

  const rows = playlists ? sortForDisplay(playlists) : [];

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Playlists
        </h1>
        <button type="button" className="btn btn-primary" onClick={openCreateModal}>
          + New playlist
        </button>
      </div>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        Every playlist -- System (admin-managed, visible to every user, e.g. "Staff Picks") and every
        user's own personal ones, shown here for visibility only. Only System playlists can be
        created, renamed, moved, or deleted from this screen; a personal playlist stays that user's
        own to manage in Playarr.
      </p>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      {playlists !== null && playlists.length === 0 && <p className="muted">No playlists yet.</p>}

      {playlists !== null && playlists.length > 0 && (
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ playlist, depth }) => (
              <tr
                key={playlist.id}
                onClick={() => navigate(`/playlists/${playlist.id}`)}
                style={{ cursor: "pointer" }}
              >
                <td style={{ paddingLeft: `${8 + depth * 24}px` }}>
                  {depth > 0 && <span className="muted">↳ </span>}
                  {playlist.name}
                </td>
                <td>
                  <span className={`badge badge-pill ${playlist.is_system ? "badge-success" : "badge-neutral"}`}>
                    {ownerLabel(playlist)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {createOpen && (
        <Modal
          title="New playlist"
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <div className="modal-footer-left" />
              <div className="modal-footer-right">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" form="playlist-create-form" className="btn btn-primary" disabled={creating}>
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </>
          }
        >
          {createError && (
            <p className="error-text hint" style={{ margin: 0 }}>
              {createError}
            </p>
          )}
          <form
            id="playlist-create-form"
            onSubmit={(e) => void handleCreateSubmit(e)}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div className="modal-field">
              <label className="form-label" htmlFor="playlist-name">
                Name
              </label>
              <input
                id="playlist-name"
                className="input"
                style={{ width: "100%" }}
                placeholder="e.g. Staff Picks"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="modal-field">
              <label className="form-label" htmlFor="playlist-parent">
                Parent (optional)
              </label>
              <select
                id="playlist-parent"
                className="input"
                style={{ width: "100%" }}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">None -- top-level playlist</option>
                {systemPlaylists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
