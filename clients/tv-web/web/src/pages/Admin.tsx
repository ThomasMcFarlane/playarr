import { useEffect, useState } from "react";
import {
  describeApiError,
  type ExternalProvider,
  type MediaRequest,
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

  const inputStyle: React.CSSProperties = {
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    color: "#ffffff",
    padding: "0.4rem 0.6rem",
    borderRadius: 4,
  };

  return (
    <section style={{ marginBottom: "3rem" }}>
      <h2>Source instances</h2>
      <p style={{ color: "#a0a0a0", maxWidth: 640 }}>
        The Sonarr/Radarr/Lidarr/Bazarr/Prowlarr/Readarr instances Streamarr treats as a source of
        catalog/download truth. Registering one confirms it's actually reachable before accepting it.
      </p>

      {error && <p style={{ color: "#e74c3c", marginTop: "1rem" }}>{error}</p>}

      {instances !== null && instances.length > 0 && (
        <table style={{ width: "100%", marginTop: "1rem", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #2a2a2a" }}>
              <th style={{ padding: "0.5rem" }}>Kind</th>
              <th style={{ padding: "0.5rem" }}>Name</th>
              <th style={{ padding: "0.5rem" }}>Base URL</th>
              <th style={{ padding: "0.5rem" }}>Requests</th>
              <th style={{ padding: "0.5rem" }} />
            </tr>
          </thead>
          <tbody>
            {instances.map((instance) => (
              <tr key={instance.id} style={{ borderBottom: "1px solid #1a1a1a" }}>
                <td style={{ padding: "0.5rem" }}>{instance.kind}</td>
                <td style={{ padding: "0.5rem" }}>{instance.name}</td>
                <td style={{ padding: "0.5rem" }}>{instance.base_url}</td>
                <td style={{ padding: "0.5rem" }}>{instance.enabled_for_requests ? "enabled" : "disabled"}</td>
                <td style={{ padding: "0.5rem" }}>
                  <button
                    type="button"
                    disabled={deletingId === instance.id}
                    onClick={() => void handleDelete(instance.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {instances !== null && instances.length === 0 && (
        <p style={{ color: "#a0a0a0", marginTop: "1rem" }}>No source instances registered yet.</p>
      )}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
      >
        <select
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as SourceKind }))}
          style={inputStyle}
        >
          {SOURCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        <input
          placeholder="Name (e.g. My Radarr)"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          style={inputStyle}
        />
        <input
          placeholder="Base URL (e.g. http://192.168.1.10:7878)"
          value={form.base_url}
          onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
          required
          style={{ ...inputStyle, minWidth: 260 }}
        />
        <input
          type="password"
          placeholder="API key"
          value={form.api_key}
          onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
          required
          style={inputStyle}
        />
        <label style={{ color: "#a0a0a0", display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={form.enabled_for_requests}
            onChange={(e) => setForm((f) => ({ ...f, enabled_for_requests: e.target.checked }))}
          />
          Enabled for requests
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "Testing connection..." : "Add & test connection"}
        </button>
      </form>
    </section>
  );
}

/** `ExternalProvider` is a closed set of string variants plus an `{other: string}` escape hatch. */
function providerLabel(provider: ExternalProvider): string {
  return typeof provider === "string" ? provider : `other:${provider.other}`;
}

function targetLabel(request: MediaRequest, workTitles: Record<string, string>): string {
  if (request.target.target_kind === "existing_work") {
    return workTitles[request.target.work_id] ?? `Work ${request.target.work_id}`;
  }
  const { provider, external_id: externalId } = request.target.external_ref;
  return `${providerLabel(provider)}:${externalId}`;
}

/**
 * Request management: approve/reject user-submitted `MediaRequest`s, backed
 * by the real `GET/POST /api/v1/requests`, `POST /api/v1/requests/{id}/approve`,
 * and `POST /api/v1/requests/{id}/reject` endpoints.
 *
 * Round E wired real auth middleware into the backend: `decided_by` is no
 * longer a client-supplied field (the removed Round D workaround asked an
 * operator to type in a real admin user id and persist it locally) -- the
 * server now derives it from the verified access token's `sub` claim, and
 * rejects (403) any caller that token doesn't identify as an admin. The
 * `ApiClient` this page uses (see `ApiClientProvider`) obtains that token
 * transparently via `POST /api/v1/auth/login`.
 */
export function AdminPage() {
  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Admin</h1>
      <SourceInstancesSection />
      <RequestsSection />
    </div>
  );
}

function RequestsSection() {
  const client = useApiClient();
  const [requests, setRequests] = useState<MediaRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workTitles, setWorkTitles] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .listRequests()
      .then((result) => {
        if (!cancelled) setRequests(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Resolve titles for "existing_work" targets lazily (the request list only carries the work id).
  useEffect(() => {
    if (!requests) return;
    const missingIds = Array.from(
      new Set(
        requests
          .filter((r) => r.target.target_kind === "existing_work" && !(r.target.work_id in workTitles))
          .map((r) => (r.target as { work_id: string }).work_id)
      )
    );
    if (missingIds.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missingIds.map((id) =>
        client
          .getWork(id)
          .then((detail) => [id, detail.work.title] as const)
          .catch(() => [id, id] as const)
      )
    ).then((entries) => {
      if (cancelled) return;
      setWorkTitles((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [requests, workTitles, client]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const updated =
        decision === "approve" ? await client.approveRequest(id, {}) : await client.rejectRequest(id, {});
      setRequests((current) => current?.map((r) => (r.id === id ? updated : r)) ?? current);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h2>Requests</h2>
      <p style={{ color: "#a0a0a0", maxWidth: 560 }}>
        Review and approve/reject pending <code>MediaRequest</code>s.
      </p>

      {error && <p style={{ color: "#e74c3c", marginTop: "1rem" }}>{error}</p>}
      {requests === null && !error && <p style={{ color: "#a0a0a0", marginTop: "1rem" }}>Loading...</p>}
      {requests !== null && requests.length === 0 && (
        <p style={{ color: "#a0a0a0", marginTop: "1rem" }}>No pending requests.</p>
      )}

      {requests !== null && requests.length > 0 && (
        <table style={{ width: "100%", marginTop: "1.5rem", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #2a2a2a" }}>
              <th style={{ padding: "0.5rem" }}>Target</th>
              <th style={{ padding: "0.5rem" }}>Kind</th>
              <th style={{ padding: "0.5rem" }}>Status</th>
              <th style={{ padding: "0.5rem" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} style={{ borderBottom: "1px solid #1a1a1a" }}>
                <td style={{ padding: "0.5rem" }}>{targetLabel(request, workTitles)}</td>
                <td style={{ padding: "0.5rem" }}>{request.kind}</td>
                <td style={{ padding: "0.5rem" }}>{request.status}</td>
                <td style={{ padding: "0.5rem", display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    disabled={request.status !== "pending" || busyId === request.id}
                    onClick={() => void decide(request.id, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={request.status !== "pending" || busyId === request.id}
                    onClick={() => void decide(request.id, "reject")}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
