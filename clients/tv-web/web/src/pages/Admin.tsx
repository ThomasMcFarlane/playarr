import { useEffect, useState } from "react";
import { describeApiError, type ExternalProvider, type MediaRequest } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";

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
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Admin</h1>
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
    </div>
  );
}
