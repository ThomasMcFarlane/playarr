import { useEffect, useState } from "react";
import {
  describeApiError,
  type TdarrConnectionRequest,
  type TdarrConnectionResponse,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const EMPTY_FORM: TdarrConnectionRequest = {
  base_url: "",
  api_key: "",
  tdarr_db_id: "streamarr",
  default_profile: "h264-720p-4mbps",
  worker_process: "transcodecpu",
  default_worker_limit: 2,
  throttled_worker_limit: 0,
  active_session_threshold: 2,
  throttle_check_interval_secs: 30,
};

function formFromConnection(connection: TdarrConnectionResponse): TdarrConnectionRequest {
  return {
    base_url: connection.base_url,
    // Write-only -- the server never echoes it back. Left blank; the
    // admin only needs to re-enter it when actually rotating the key
    // (see the field's own hint text below).
    api_key: "",
    tdarr_db_id: connection.tdarr_db_id,
    default_profile: connection.default_profile,
    worker_process: connection.worker_process,
    default_worker_limit: connection.default_worker_limit,
    throttled_worker_limit: connection.throttled_worker_limit,
    active_session_threshold: connection.active_session_threshold,
    throttle_check_interval_secs: connection.throttle_check_interval_secs,
  };
}

/**
 * Registers/updates/removes Streamarr's single Tdarr connection -- the
 * web UI for `POST/GET/DELETE /api/v1/admin/tdarr`
 * (backend/crates/streamarr-api/src/tdarr.rs). A plain settings form, not
 * the `SourceInstancesPage` card-grid pattern: unlike `*arr` apps, there
 * is only ever one Tdarr connection (see `streamarr_model::tdarr`'s doc
 * comment for why), so there's nothing to list/pick between.
 *
 * Registering (or removing) here takes effect without a backend restart
 * -- see `main.rs`'s `boot_worker` doc comment -- except for *editing* an
 * already-running connection's settings (worker limits, profile, etc),
 * which still needs a restart to take effect, same as the rest of this
 * form's own hint text says.
 */
export function TdarrPage() {
  useDocumentTitle("Tdarr");
  const client = useApiClient();
  const [connection, setConnection] = useState<TdarrConnectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<TdarrConnectionRequest>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function refresh() {
    setLoading(true);
    setLoadError(null);
    client
      .getTdarrConnection()
      .then((existing) => {
        if (existing) {
          setConnection(existing);
          setForm(formFromConnection(existing));
        } else {
          setConnection(null);
          setForm(EMPTY_FORM);
        }
      })
      .catch((err: unknown) => setLoadError(describeApiError(err)))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [client]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await client.createTdarrConnection(form);
      setConnection(saved);
      setForm(formFromConnection(saved));
    } catch (err) {
      // Most commonly a 502 -- base_url/api_key rejected, or Tdarr
      // couldn't be reached. The server confirms connectivity (a real
      // `get-nodes` call) before accepting, so this is a real, actionable
      // failure, not a validation nitpick.
      setSaveError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setSaveError(null);
    try {
      await client.deleteTdarrConnection();
      setConnection(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setSaveError(describeApiError(err));
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
      <h1 className="page-title">Tdarr</h1>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        Streamarr's connection to a{" "}
        <a href="https://docs.tdarr.io/" target="_blank" rel="noreferrer">
          Tdarr
        </a>{" "}
        instance -- the background transcode pipeline that proactively produces renditions ahead
        of playback, and is throttled automatically while live on-demand sessions need headroom.
        There is only ever one connection. Registering confirms Tdarr is actually reachable before
        accepting it, and starts the background dispatch loop within about 10 seconds -- no
        restart needed. Changing settings on an already-registered connection (worker limits,
        profile, etc) does need a restart to take effect.
      </p>

      {loadError && <p className="error-text" style={{ marginBottom: "1rem" }}>{loadError}</p>}
      {saveError && <p className="error-text hint" style={{ marginBottom: "1rem" }}>{saveError}</p>}

      {connection && (
        <p className="muted hint" style={{ marginBottom: "1rem" }}>
          Registered against {connection.base_url}.
        </p>
      )}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        autoComplete="off"
        style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 480 }}
      >
        <div className="modal-field">
          <label className="form-label" htmlFor="tdarr-base-url">
            Base URL
          </label>
          <input
            id="tdarr-base-url"
            type="url"
            className="input"
            style={{ width: "100%" }}
            placeholder="e.g. http://192.168.1.10:8265"
            autoComplete="off"
            value={form.base_url}
            onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
            required
          />
        </div>
        <div className="modal-field">
          <label className="form-label" htmlFor="tdarr-api-key">
            API key
          </label>
          <input
            id="tdarr-api-key"
            type="text"
            className="input"
            style={{ width: "100%" }}
            placeholder={connection ? "Leave blank to keep the current key" : "API key"}
            autoComplete="off"
            spellCheck={false}
            value={form.api_key}
            onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
            required={!connection}
          />
        </div>
        <div className="modal-field">
          <label className="form-label" htmlFor="tdarr-db-id">
            Tdarr library database id
          </label>
          <input
            id="tdarr-db-id"
            className="input"
            style={{ width: "100%" }}
            value={form.tdarr_db_id}
            onChange={(e) => setForm((f) => ({ ...f, tdarr_db_id: e.target.value }))}
            required
          />
        </div>
        <div className="modal-field">
          <label className="form-label" htmlFor="tdarr-profile">
            Default transcode profile
          </label>
          <input
            id="tdarr-profile"
            className="input"
            style={{ width: "100%" }}
            value={form.default_profile}
            onChange={(e) => setForm((f) => ({ ...f, default_profile: e.target.value }))}
            required
          />
        </div>
        <div className="modal-field">
          <label className="form-label" htmlFor="tdarr-worker-process">
            Worker process
          </label>
          <input
            id="tdarr-worker-process"
            className="input"
            style={{ width: "100%" }}
            value={form.worker_process}
            onChange={(e) => setForm((f) => ({ ...f, worker_process: e.target.value }))}
            required
          />
        </div>
        <div style={{ display: "flex", gap: "1rem" }}>
          <div className="modal-field" style={{ flex: 1 }}>
            <label className="form-label" htmlFor="tdarr-default-worker-limit">
              Default worker limit
            </label>
            <input
              id="tdarr-default-worker-limit"
              type="number"
              min={0}
              className="input"
              style={{ width: "100%" }}
              value={form.default_worker_limit}
              onChange={(e) =>
                setForm((f) => ({ ...f, default_worker_limit: Number(e.target.value) }))
              }
              required
            />
          </div>
          <div className="modal-field" style={{ flex: 1 }}>
            <label className="form-label" htmlFor="tdarr-throttled-worker-limit">
              Throttled worker limit
            </label>
            <input
              id="tdarr-throttled-worker-limit"
              type="number"
              min={0}
              className="input"
              style={{ width: "100%" }}
              value={form.throttled_worker_limit}
              onChange={(e) =>
                setForm((f) => ({ ...f, throttled_worker_limit: Number(e.target.value) }))
              }
              required
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: "1rem" }}>
          <div className="modal-field" style={{ flex: 1 }}>
            <label className="form-label" htmlFor="tdarr-active-session-threshold">
              Active session threshold
            </label>
            <input
              id="tdarr-active-session-threshold"
              type="number"
              min={0}
              className="input"
              style={{ width: "100%" }}
              value={form.active_session_threshold}
              onChange={(e) =>
                setForm((f) => ({ ...f, active_session_threshold: Number(e.target.value) }))
              }
              required
            />
          </div>
          <div className="modal-field" style={{ flex: 1 }}>
            <label className="form-label" htmlFor="tdarr-throttle-check-interval">
              Throttle check interval (seconds)
            </label>
            <input
              id="tdarr-throttle-check-interval"
              type="number"
              min={1}
              className="input"
              style={{ width: "100%" }}
              value={form.throttle_check_interval_secs}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  throttle_check_interval_secs: Number(e.target.value),
                }))
              }
              required
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between" }}>
          <div>
            {connection && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? "Removing..." : "Remove connection"}
              </button>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving
              ? "Testing connection..."
              : connection
                ? "Save"
                : "Add & test connection"}
          </button>
        </div>
      </form>
    </div>
  );
}
