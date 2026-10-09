import { useCallback, useEffect, useState } from "react";
import {
  describeApiError,
  type AdminFolderRoot,
  type SourceInstanceResponse,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

function scanLabel(root: AdminFolderRoot): string {
  switch (root.scan_status) {
    case "scanning":
      return "Scanning";
    case "ready":
      return root.last_scanned_at ? `Scanned ${new Date(root.last_scanned_at).toLocaleString()}` : "Scanned";
    case "failed":
      return `Failed${root.scan_error ? `: ${root.scan_error}` : ""}`;
    default:
      return "Not scanned yet";
  }
}

/** One root folder: whether it is scanned and offered to viewers, where it lives on this server, and its scan state. */
export function FolderRootRow({
  root,
  busy,
  onToggle,
  onSavePath,
  onScan,
  onDelete,
}: {
  root: AdminFolderRoot;
  busy: boolean;
  onToggle: (root: AdminFolderRoot, enabled: boolean) => void;
  onSavePath: (root: AdminFolderRoot, path: string) => void;
  onScan: (root: AdminFolderRoot) => void;
  onDelete: (root: AdminFolderRoot) => void;
}) {
  const [path, setPath] = useState(root.local_path ?? "");
  useEffect(() => setPath(root.local_path ?? ""), [root.local_path]);
  return (
    <li className="backup-row" data-folder-root={root.id}>
      <div className="backup-row-head">
        <label>
          <input
            type="checkbox"
            checked={root.scan_enabled}
            disabled={busy || !root.active}
            onChange={(event) => onToggle(root, event.target.checked)}
          />{" "}
          <strong>{root.name}</strong>
        </label>
        <span className="muted">
          {root.source_name} · {root.library_kind} · {root.item_count.toLocaleString()} files
          {root.manual ? " · added by hand" : ""}
          {root.active ? "" : " · no longer reported by its source"}
        </span>
      </div>
      <dl className="backup-guidance">
        <dt>Reported path</dt>
        <dd>
          <code>{root.reported_path}</code>
        </dd>
        <dt>Scanned on this server</dt>
        <dd>
          <code>{root.effective_path}</code>{" "}
          <span className="muted">{root.path_available ? "(readable)" : "(not available here)"}</span>
        </dd>
        <dt>Local path override</dt>
        <dd>
          <input
            type="text"
            className="input"
            value={path}
            placeholder="/srv/media/folder"
            aria-label={`Local path for ${root.name}`}
            onChange={(event) => setPath(event.target.value)}
          />{" "}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy || path.trim() === (root.local_path ?? "")}
            onClick={() => onSavePath(root, path.trim())}
          >
            Save path
          </button>
        </dd>
        <dt>Status</dt>
        <dd role="status">{scanLabel(root)}</dd>
      </dl>
      <div className="backup-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || !root.scan_enabled || root.scan_status === "scanning"}
          onClick={() => onScan(root)}
        >
          Scan now
        </button>
        {root.manual && (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => onDelete(root)}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Administrator control of unsorted folders: which root folders (reported by
 * the source applications or added by hand) are scanned for media they do not
 * manage and offered to viewers. Nothing is scanned until it is enabled.
 */
export function FoldersPage() {
  useDocumentTitle("Folders");
  const client = useApiClient();
  const [roots, setRoots] = useState<AdminFolderRoot[] | null>(null);
  const [sources, setSources] = useState<SourceInstanceResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newSource, setNewSource] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");

  const load = useCallback(() => {
    void client
      .listAdminFolderRoots()
      .then((result) => {
        setRoots(result.roots);
        setError(null);
      })
      .catch((err: unknown) => setError(describeApiError(err)));
  }, [client]);

  useEffect(() => {
    load();
    void client
      .listSourceInstances()
      .then((all) => setSources(all.filter((source) => source.kind !== "bazarr" && source.kind !== "prowlarr" && source.kind !== "dubarr")))
      .catch(() => setSources([]));
    // Scans run in the background: keep the states fresh while the page is open.
    const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, [client, load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Folders</h1>
      <p className="muted" style={{ maxWidth: 680, marginBottom: "1rem" }}>
        Choose which folders are scanned for media that your library sources
        do not manage. Enabled folders appear as Folders in the apps for people with
        access to the folder&apos;s library. Nothing is scanned until you enable it.
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="muted" role="status">{notice}</p>}

      <div style={{ display: "flex", gap: "0.75rem", margin: "1rem 0", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void run(() => client.discoverFolderRoots(), "Root folders re-read from the sources.")}
        >
          Find folders from sources
        </button>
      </div>

      {roots === null && !error && <p className="muted">Loading...</p>}
      {roots !== null && roots.length === 0 && (
        <p className="muted">No folders yet. Find them from your sources or add one by hand below.</p>
      )}
      {roots !== null && roots.length > 0 && (
        <ul className="backup-list">
          {roots.map((root) => (
            <FolderRootRow
              key={root.id}
              root={root}
              busy={busy}
              onToggle={(r, enabled) => void run(() => client.updateFolderRoot(r.id, { scan_enabled: enabled }))}
              onSavePath={(r, path) => void run(() => client.updateFolderRoot(r.id, { local_path: path }))}
              onScan={(r) => void run(() => client.scanFolderRoot(r.id), `Scan of ${r.name} finished.`)}
              onDelete={(r) => {
                if (window.confirm(`Remove ${r.name} and forget its scanned files? Nothing on disk is deleted.`)) {
                  void run(() => client.deleteFolderRoot(r.id));
                }
              }}
            />
          ))}
        </ul>
      )}

      <section className="backup-setup">
        <h2 className="section-title">Add a folder by hand</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await client.createFolderRoot({
                source_instance_id: newSource,
                path: newPath.trim(),
                name: newName.trim() || undefined,
              });
              setNewPath("");
              setNewName("");
            }, "Folder added and scanning.");
          }}
        >
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label>
              Library (source)
              <br />
              <select value={newSource} onChange={(event) => setNewSource(event.target.value)} required>
                <option value="">Choose…</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Folder on this server
              <br />
              <input
                type="text"
                className="input"
                value={newPath}
                placeholder="/srv/media/unsorted"
                onChange={(event) => setNewPath(event.target.value)}
                required
              />
            </label>
            <label>
              Name (optional)
              <br />
              <input type="text" className="input" value={newName} onChange={(event) => setNewName(event.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy || !newSource || !newPath.trim()}>
              Add folder
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
