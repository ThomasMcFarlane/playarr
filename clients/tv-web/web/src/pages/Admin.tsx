import { useEffect, useState } from "react";
import { ApiError, type ExternalProvider, type MediaRequest } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";

const ADMIN_USER_ID_STORAGE_KEY = "streamarr:adminUserId";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * `DecideRequestBody.decided_by` is a real admin user id -- the backend has
 * no auth middleware wired up yet (see the spec's own TODO on
 * `SubmitRequestBody.requested_by`), so there is no verified "current user"
 * to source it from. This page asks for it once and persists it locally.
 */
export function AdminPage() {
  const client = useApiClient();
  const [requests, setRequests] = useState<MediaRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workTitles, setWorkTitles] = useState<Record<string, string>>({});
  const [adminUserId, setAdminUserId] = useState(
    () => localStorage.getItem(ADMIN_USER_ID_STORAGE_KEY) ?? ""
  );
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
        setError(err instanceof ApiError ? err.message : String(err));
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

  function handleAdminUserIdChange(value: string) {
    setAdminUserId(value);
    localStorage.setItem(ADMIN_USER_ID_STORAGE_KEY, value);
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    try {
      const updated =
        decision === "approve"
          ? await client.approveRequest(id, { decided_by: adminUserId })
          : await client.rejectRequest(id, { decided_by: adminUserId });
      setRequests((current) => current?.map((r) => (r.id === id ? updated : r)) ?? current);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const isValidAdminId = UUID_PATTERN.test(adminUserId);

  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Admin</h1>
      <p style={{ color: "#a0a0a0", maxWidth: 560 }}>
        Review and approve/reject pending <code>MediaRequest</code>s.
      </p>

      <label style={{ display: "block", marginTop: "1rem", color: "#a0a0a0", fontSize: "0.875rem" }}>
        Admin user id (uuid, used as <code>decided_by</code>)
        <input
          type="text"
          value={adminUserId}
          onChange={(event) => handleAdminUserIdChange(event.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          style={{
            display: "block",
            marginTop: "0.25rem",
            width: "100%",
            maxWidth: 360,
            padding: "0.4rem 0.6rem",
            borderRadius: 6,
            border: "1px solid #2a2a2a",
            background: "#121212",
            color: "#ffffff",
          }}
        />
      </label>

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
                    disabled={request.status !== "pending" || busyId === request.id || !isValidAdminId}
                    onClick={() => void decide(request.id, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={request.status !== "pending" || busyId === request.id || !isValidAdminId}
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
