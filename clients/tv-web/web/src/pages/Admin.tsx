import { useEffect, useState } from "react";
import {
  describeApiError,
  type SourceInstanceRequest,
  type SourceInstanceResponse,
  type SourceKind,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";

const SOURCE_KINDS: SourceKind[] = ["sonarr", "radarr", "lidarr", "bazarr", "prowlarr", "readarr"];

const EMPTY_FORM: SourceInstanceRequest = {
  kind: "sonarr",
  name: "",
  base_url: "",
  api_key: "",
  priority: 0,
  enabled_for_requests: true,
  best_effort: false,
};

/**
 * Registers/lists/removes the *arr apps Streamarr talks to -- the web UI
 * for `POST/GET/DELETE /api/v1/admin/source-instances`
 * (backend/crates/streamarr-api/src/admin.rs). Every other *arr app ships
 * this as a first-class settings screen; this is that screen for
 * Streamarr, not a curl-only feature.
 */
function SourceInstancesSection() {
  const client = useApiClient();
  const [instances, setInstances] = useState<SourceInstanceResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<SourceInstanceRequest>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<Record<string, string>>({});

  function refresh() {
    setError(null);
    client
      .listSourceInstances()
      .then(setInstances)
      .catch((err: unknown) => setError(describeApiError(err)));
  }

  useEffect(refresh, [client]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await client.createSourceInstance(form);
      setForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      // Most commonly a 502 -- base_url/api_key rejected, or the instance
      // couldn't be reached. The server confirms connectivity before
      // accepting a registration, so this is a real, actionable failure,
      // not a validation nitpick.
      setError(describeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await client.deleteSourceInstance(id);
      setInstances((current) => current?.filter((i) => i.id !== id) ?? current);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSync(id: string) {
    setSyncingId(id);
    setSyncStatus((current) => ({ ...current, [id]: "" }));
    try {
      await client.syncSourceInstance(id);
      setSyncStatus((current) => ({ ...current, [id]: "Sync requested" }));
    } catch (err) {
      // Most commonly a 503 -- registered less than ~10s ago, its poller
      // hasn't spawned yet. Not a real failure, just "try again shortly".
      setSyncStatus((current) => ({ ...current, [id]: describeApiError(err) }));
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <section className="section">
      <h2 className="section-title">Source instances</h2>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        The Sonarr/Radarr/Lidarr/Bazarr/Prowlarr/Readarr instances Streamarr treats as a source of
        catalog/download truth. Registering one confirms it's actually reachable before accepting it.
      </p>

      <div className="card">
        {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

        {instances !== null && instances.length > 0 && (
          <table className="table" style={{ marginBottom: "1.5rem" }}>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Base URL</th>
                <th>Requests</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => (
                <tr key={instance.id}>
                  <td style={{ textTransform: "capitalize" }}>{instance.kind}</td>
                  <td>{instance.name}</td>
                  <td className="muted">{instance.base_url}</td>
                  <td>
                    <span className={`badge ${instance.enabled_for_requests ? "badge-success" : "badge-neutral"}`}>
                      {instance.enabled_for_requests ? "enabled" : "disabled"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={syncingId === instance.id}
                        onClick={() => void handleSync(instance.id)}
                      >
                        {syncingId === instance.id ? "Syncing..." : "Sync now"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={deletingId === instance.id}
                        onClick={() => void handleDelete(instance.id)}
                      >
                        Remove
                      </button>
                    </div>
                    {syncStatus[instance.id] && (
                      <p className="hint" style={{ marginTop: "0.35rem" }}>
                        {syncStatus[instance.id]}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {instances !== null && instances.length === 0 && (
          <p className="muted" style={{ marginBottom: "1.5rem" }}>
            No source instances registered yet.
          </p>
        )}

        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
        >
          <select
            className="input"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as SourceKind }))}
          >
            {SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Name (e.g. My Radarr)"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Base URL (e.g. http://192.168.1.10:7878)"
            value={form.base_url}
            onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
            required
            style={{ minWidth: 260 }}
          />
          <input
            type="password"
            className="input"
            placeholder="API key"
            value={form.api_key}
            onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
            required
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.enabled_for_requests}
              onChange={(e) => setForm((f) => ({ ...f, enabled_for_requests: e.target.checked }))}
            />
            Enabled for requests
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Testing connection..." : "Add & test connection"}
          </button>
        </form>
      </div>
    </section>
  );
}

/**
 * Admin: registering *arr source instances (the only admin surface
 * Streamarr has -- see `SourceInstancesSection` above). Streamarr has no
 * request-management feature; that's Overseerr/Jellyseerr's job, not
 * this app's.
 */
export function AdminPage() {
  return (
    <div className="page">
      <h1 className="page-title">Admin</h1>
      <SourceInstancesSection />
    </div>
  );
}
