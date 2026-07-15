import { useState } from "react";
import type { MediaRequest } from "@streamarr-tv/domain";

// Placeholder data until `packages/api-client` has a real `/admin/requests`
// endpoint to call. Kept here (rather than mocked away) so the shape of
// the eventual `ApiClient.get<PaginatedResult<MediaRequest>>(...)` call is
// obvious at the call site below.
const PLACEHOLDER_REQUESTS: MediaRequest[] = [
  {
    id: "req_1",
    requestedByUserId: "user_1",
    title: "Voyage",
    kind: "movie",
    releaseYear: 2016,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

/**
 * Admin hosts the future request-management UI per the plan: reviewing and
 * approving/rejecting `MediaRequest`s submitted by users. This is a
 * structural placeholder -- approve/reject currently only update local
 * state, not a real backend.
 */
export function AdminPage() {
  const [requests, setRequests] = useState<MediaRequest[]>(PLACEHOLDER_REQUESTS);

  function updateStatus(id: string, status: MediaRequest["status"]) {
    setRequests((current) =>
      current.map((request) =>
        request.id === id ? { ...request, status, updatedAt: new Date().toISOString() } : request
      )
    );
  }

  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Admin</h1>
      <p style={{ color: "#a0a0a0", maxWidth: 560 }}>
        Request management: approve or reject user-submitted{" "}
        <code>MediaRequest</code>s. Not yet wired to a real API -- state
        changes here are local only.
      </p>
      <table style={{ width: "100%", marginTop: "1.5rem", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #2a2a2a" }}>
            <th style={{ padding: "0.5rem" }}>Title</th>
            <th style={{ padding: "0.5rem" }}>Kind</th>
            <th style={{ padding: "0.5rem" }}>Status</th>
            <th style={{ padding: "0.5rem" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} style={{ borderBottom: "1px solid #1a1a1a" }}>
              <td style={{ padding: "0.5rem" }}>
                {request.title} {request.releaseYear ? `(${request.releaseYear})` : ""}
              </td>
              <td style={{ padding: "0.5rem" }}>{request.kind}</td>
              <td style={{ padding: "0.5rem" }}>{request.status}</td>
              <td style={{ padding: "0.5rem", display: "flex", gap: "0.5rem" }}>
                <button type="button" onClick={() => updateStatus(request.id, "approved")}>
                  Approve
                </button>
                <button type="button" onClick={() => updateStatus(request.id, "rejected")}>
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
