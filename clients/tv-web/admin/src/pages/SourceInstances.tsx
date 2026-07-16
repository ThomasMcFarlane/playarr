import { useEffect, useState } from "react";
import {
  describeApiError,
  type SourceInstanceRequest,
  type SourceInstanceResponse,
  type SourceInstanceSyncStatus,
  type SourceKind,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { Modal } from "../components/Modal";

const SOURCE_KINDS: SourceKind[] = [
  "sonarr",
  "radarr",
  "lidarr",
  "bazarr",
  "prowlarr",
  "readarr",
  "whisparr",
];

const EMPTY_FORM: SourceInstanceRequest = {
  kind: "sonarr",
  name: "",
  base_url: "",
  api_key: "",
  priority: 0,
  best_effort: false,
};

const SYNC_STATUS_POLL_INTERVAL_MS = 5000;

type SyncRequestState =
  | { phase: "requesting"; requestedAt: number }
  | { phase: "queued"; requestedAt: number }
  | { phase: "failed"; requestedAt: number; message: string };

function syncStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "running":
      return "badge badge-queue badge-pill";
    case "succeeded":
      return "badge badge-success badge-pill";
    case "failed":
      return "badge badge-danger badge-pill";
    default:
      return "badge badge-neutral badge-pill";
  }
}

function syncStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "running":
      return "Syncing";
    case "succeeded":
      return "Synced";
    case "failed":
      return "Sync failed";
    default:
      return "Not synced";
  }
}

function formatSyncTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

/** "+" glyph for the grid's dedicated add tile -- purely decorative. */
function PlusIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Which modal (if any) is open, and what it needs to render itself. */
type ModalState = { mode: "create" } | { mode: "details"; instance: SourceInstanceResponse } | null;

/**
 * Registers/lists/removes the *arr apps Streamarr talks to -- the web UI
 * for `POST/GET/DELETE /api/v1/admin/source-instances`
 * (backend/crates/streamarr-api/src/admin.rs). Every other *arr app ships
 * this as a first-class settings screen; this is that screen for
 * Streamarr, not a curl-only feature.
 *
 * Laid out to match the real Radarr "Settings > Download Clients" pattern
 * (see DESIGN.md Sec 4.1/4.2/4.3): a card grid where each card at rest
 * shows only the instance's name and a status pill (its `kind` -- a
 * `SourceInstanceResponse` has no enabled/disabled-style health field
 * today, so `kind` is the one piece of at-rest info that's actually
 * available), a dedicated "+" tile as the grid's last item that opens the
 * create form in a modal, and clicking an existing card opens a details
 * modal (base_url/kind/priority/best_effort, plus Sync now/Delete) instead
 * of always-visible inline icon buttons. This is purely a layout/
 * interaction redesign -- list/create+test-connection/sync now/delete all
 * still go through the same four `useApiClient()` methods as before.
 *
 * Moved here from clients/tv-web/web (Playarr Web) -- this is Streamarr's
 * own admin surface, not part of the consumer streaming client.
 */
export function SourceInstancesPage() {
  useDocumentTitle("Source instances");
  const client = useApiClient();
  const [instances, setInstances] = useState<SourceInstanceResponse[] | null>(null);
  const [syncStatuses, setSyncStatuses] = useState<SourceInstanceSyncStatus[]>([]);
  const [syncRequests, setSyncRequests] = useState<Record<string, SyncRequestState>>({});
  const [error, setError] = useState<string | null>(null);
  const [syncStatusError, setSyncStatusError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  // Create-modal state.
  const [form, setForm] = useState<SourceInstanceRequest>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Details-modal state.
  const [deleting, setDeleting] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  function refresh() {
    setError(null);
    client
      .listSourceInstances()
      .then(setInstances)
      .catch((err: unknown) => setError(describeApiError(err)));
  }

  function refreshSyncStatuses() {
    return client
      .sourceInstanceSyncStatuses()
      .then((rows) => {
        setSyncStatuses(rows);
        setSyncStatusError(null);
        setSyncRequests((current) => {
          let changed = false;
          const next = { ...current };

          for (const row of rows) {
            const request = next[row.source_instance_id];
            if (!request || request.phase !== "queued") continue;

            const startedAt = row.started_at ? new Date(row.started_at).getTime() : Number.NaN;
            const finishedAt = row.finished_at
              ? new Date(row.finished_at).getTime()
              : Number.NaN;
            const requestHasStarted =
              row.status === "running" ||
              (!Number.isNaN(startedAt) &&
                startedAt >= request.requestedAt - 1000) ||
              (!Number.isNaN(finishedAt) &&
                finishedAt >= request.requestedAt - 1000);
            if (requestHasStarted) {
              delete next[row.source_instance_id];
              changed = true;
            }
          }

          return changed ? next : current;
        });
      })
      .catch((err: unknown) => setSyncStatusError(describeApiError(err)));
  }

  useEffect(() => {
    refresh();
    void refreshSyncStatuses();
    const interval = window.setInterval(() => void refreshSyncStatuses(), SYNC_STATUS_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [client]);

  function openCreateModal() {
    setForm(EMPTY_FORM);
    setCreateError(null);
    setModal({ mode: "create" });
  }

  function openDetailsModal(instance: SourceInstanceResponse) {
    setDetailsError(null);
    setModal({ mode: "details", instance });
  }

  function closeModal() {
    setModal(null);
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await client.createSourceInstance(form);
      setForm(EMPTY_FORM);
      setModal(null);
      refresh();
      void refreshSyncStatuses();
    } catch (err) {
      // Most commonly a 502 -- base_url/api_key rejected, or the instance
      // couldn't be reached. The server confirms connectivity before
      // accepting a registration, so this is a real, actionable failure,
      // not a validation nitpick.
      setCreateError(describeApiError(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(instance: SourceInstanceResponse) {
    setDeleting(true);
    setDetailsError(null);
    try {
      await client.deleteSourceInstance(instance.id);
      setInstances((current) => current?.filter((i) => i.id !== instance.id) ?? current);
      setSyncStatuses((current) => current.filter((row) => row.source_instance_id !== instance.id));
      setSyncRequests((current) => {
        if (!current[instance.id]) return current;
        const next = { ...current };
        delete next[instance.id];
        return next;
      });
      setModal(null);
    } catch (err) {
      setDetailsError(describeApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  async function handleSync(instance: SourceInstanceResponse) {
    const requestedAt = Date.now();
    setSyncRequests((current) => ({
      ...current,
      [instance.id]: { phase: "requesting", requestedAt },
    }));
    try {
      await client.syncSourceInstance(instance.id);
      setSyncRequests((current) => ({
        ...current,
        [instance.id]: { phase: "queued", requestedAt },
      }));
      window.setTimeout(() => void refreshSyncStatuses(), 500);
    } catch (err) {
      // Most commonly a 503 -- registered less than ~10s ago, its poller
      // hasn't spawned yet. Not a real failure, just "try again shortly".
      setSyncRequests((current) => ({
        ...current,
        [instance.id]: {
          phase: "failed",
          requestedAt,
          message: describeApiError(err),
        },
      }));
    }
  }

  const syncStatusById = new Map(syncStatuses.map((row) => [row.source_instance_id, row]));

  function effectiveSyncStatus(instanceId: string): string | null | undefined {
    const request = syncRequests[instanceId];
    if (request?.phase === "requesting" || request?.phase === "queued") return "running";
    if (request?.phase === "failed") return "failed";
    return syncStatusById.get(instanceId)?.status;
  }

  function syncDetail(instanceId: string): string | null {
    const request = syncRequests[instanceId];
    if (request?.phase === "requesting") return "Requesting sync...";
    if (request?.phase === "queued") return "Sync requested";
    if (request?.phase === "failed") return request.message;

    const status = syncStatusById.get(instanceId);
    if (!status) return null;
    if (status.status === "running") return status.detail ?? "Sync in progress";
    if (status.status === "failed") return status.error ?? "Unknown sync error";

    const finishedAt = formatSyncTimestamp(status.finished_at);
    return finishedAt ? `Last synced ${finishedAt}` : null;
  }

  function isSyncing(instanceId: string): boolean {
    return effectiveSyncStatus(instanceId) === "running";
  }

  return (
    <div className="page">
      <h1 className="page-title">Source instances</h1>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        The Sonarr/Radarr/Lidarr/Bazarr/Prowlarr/Readarr/Whisparr instances Streamarr treats as a source of
        catalog/download truth. Registering one confirms it's actually reachable before accepting it.
      </p>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}
      {syncStatusError && (
        <p className="error-text" style={{ marginBottom: "1rem" }}>
          Sync statuses could not be loaded: {syncStatusError}
        </p>
      )}

      {instances !== null && instances.length === 0 && (
        <p className="muted" style={{ marginBottom: "1rem" }}>
          No source instances registered yet -- use the "+" tile below to add one.
        </p>
      )}

      {instances !== null && (
        <div className="provider-grid">
          {instances.map((instance) => {
            const status = effectiveSyncStatus(instance.id);
            const detail = syncDetail(instance.id);
            const syncing = isSyncing(instance.id);

            return (
              <div key={instance.id} className="provider-card provider-card-instance">
                <button
                  type="button"
                  className="provider-card-main provider-card-clickable"
                  onClick={() => openDetailsModal(instance)}
                >
                  <div className="provider-card-name">{instance.name}</div>
                  <div className="provider-card-tags">
                    <span className="badge badge-neutral badge-pill">{instance.kind}</span>
                    <span className={syncStatusBadgeClass(status)}>{syncStatusLabel(status)}</span>
                  </div>
                  {detail && (
                    <div className={status === "failed" ? "provider-card-status error-text" : "provider-card-status muted"}>
                      {detail}
                    </div>
                  )}
                </button>
                <div className="provider-card-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handleSync(instance)}
                    disabled={syncing}
                  >
                    {syncing ? "Syncing..." : "Sync now"}
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="provider-card provider-card-add"
            onClick={openCreateModal}
            aria-label="Add source instance"
            title="Add source instance"
          >
            <PlusIcon />
          </button>
        </div>
      )}

      {modal?.mode === "create" && (
        <Modal
          title="Add source instance"
          onClose={closeModal}
          footer={
            <>
              <div className="modal-footer-left" />
              <div className="modal-footer-right">
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={creating}>
                  Cancel
                </button>
                <button
                  type="submit"
                  form="source-instance-create-form"
                  className="btn btn-primary"
                  disabled={creating}
                >
                  {creating ? "Testing connection..." : "Add & test connection"}
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
          {/*
            `autoComplete="off"` on the form plus non-credential-shaped
            field names/types below -- a bare `type="password"` input right
            after a couple of plain text inputs is exactly the pattern
            Chrome's (and most password managers') heuristics flag as a
            login form, which was erroneously autofilling this instance's
            name/base-URL with the browser's own saved username/password.
            Switching the API key field to `type="text"` (it isn't actually
            a password -- it's a bearer credential meant to be visible and
            copyable, same as every *arr app's own Settings > General >
            API Key field shows it) removes the single strongest trigger
            for that heuristic.
          */}
          <form
            id="source-instance-create-form"
            onSubmit={(e) => void handleCreateSubmit(e)}
            autoComplete="off"
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div className="modal-field">
              <label className="form-label" htmlFor="source-instance-kind">
                Kind
              </label>
              <select
                id="source-instance-kind"
                className="input"
                style={{ width: "100%" }}
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as SourceKind }))}
              >
                {SOURCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-field">
              <label className="form-label" htmlFor="source-instance-name">
                Name
              </label>
              <input
                id="source-instance-name"
                name="source-instance-name"
                className="input"
                style={{ width: "100%" }}
                placeholder="e.g. My Radarr"
                autoComplete="off"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="modal-field">
              <label className="form-label" htmlFor="source-instance-base-url">
                Base URL
              </label>
              <input
                id="source-instance-base-url"
                name="source-instance-base-url"
                type="url"
                className="input"
                style={{ width: "100%" }}
                placeholder="e.g. http://192.168.1.10:7878"
                autoComplete="off"
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                required
              />
            </div>
            <div className="modal-field">
              <label className="form-label" htmlFor="source-instance-api-key">
                API key
              </label>
              <input
                id="source-instance-api-key"
                name="source-instance-api-key"
                type="text"
                className="input"
                style={{ width: "100%" }}
                placeholder="API key"
                autoComplete="off"
                spellCheck={false}
                value={form.api_key}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                required
              />
            </div>
          </form>
        </Modal>
      )}

      {modal?.mode === "details" && (
        <Modal
          title={modal.instance.name}
          onClose={closeModal}
          footer={
            <>
              <div className="modal-footer-left">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleDelete(modal.instance)}
                  disabled={deleting}
                >
                  {deleting ? "Removing..." : "Delete"}
                </button>
              </div>
              <div className="modal-footer-right">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleSync(modal.instance)}
                  disabled={isSyncing(modal.instance.id)}
                >
                  {isSyncing(modal.instance.id) ? "Syncing..." : "Sync now"}
                </button>
                <button type="button" className="btn btn-primary" onClick={closeModal}>
                  Close
                </button>
              </div>
            </>
          }
        >
          {detailsError && (
            <p className="error-text hint" style={{ margin: 0 }}>
              {detailsError}
            </p>
          )}
          <div className="modal-detail-row">
            <span className="muted">Kind</span>
            <span>{modal.instance.kind}</span>
          </div>
          <div className="modal-detail-row">
            <span className="muted">Base URL</span>
            <span>{modal.instance.base_url}</span>
          </div>
          <div className="modal-detail-row">
            <span className="muted">Priority</span>
            <span>{modal.instance.priority}</span>
          </div>
          <div className="modal-detail-row">
            <span className="muted">Best effort</span>
            <span>{modal.instance.best_effort ? "yes" : "no"}</span>
          </div>
          <div className="modal-detail-row">
            <span className="muted">Sync status</span>
            <span className={syncStatusBadgeClass(effectiveSyncStatus(modal.instance.id))}>
              {syncStatusLabel(effectiveSyncStatus(modal.instance.id))}
            </span>
          </div>
          {syncDetail(modal.instance.id) && (
            <p className={effectiveSyncStatus(modal.instance.id) === "failed" ? "error-text hint" : "hint"}>
              {syncDetail(modal.instance.id)}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
