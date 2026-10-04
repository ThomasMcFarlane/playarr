import { useCallback, useEffect, useState } from "react";
import { describeApiError, type RequestView } from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export function RequestsPage() {
  useDocumentTitle("Requests");
  const client = useApiClient();
  const [rows, setRows] = useState<RequestView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await client.listRequests(false));
    } catch (err) {
      setError(describeApiError(err));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Requests</h1>
      {error && <p className="error-text" role="alert">{error}</p>}
      {rows.length === 0 && <p className="muted">No requests yet.</p>}
      <div data-tv-scroll-container data-tv-scroll-axis="x" style={{ overflowX: "auto" }}>
        {rows.length > 0 && (
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr><th>Title</th><th>Requested by</th><th>Status</th><th>Origin</th><th>Systems</th><th>Requested</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}{r.year ? ` (${r.year})` : ""} <span className="muted">{r.kind}</span></td>
                  <td>{r.requested_by ?? "-"}</td>
                  <td>{r.status}{r.status_note ? ` - ${r.status_note}` : ""}</td>
                  <td>{r.origin}</td>
                  <td>{r.systems.join(", ")}</td>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.status === "pending" && (
                      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void act(() => client.decideRequest(r.id, "approve"))}>Approve</button>
                    )}{" "}
                    {(r.status === "pending" || r.status === "approved") && (
                      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { const reason = window.prompt("Reason (optional)") ?? undefined; void act(() => client.decideRequest(r.id, "decline", reason || undefined)); }}>Decline</button>
                    )}{" "}
                    <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => { if (window.confirm(`Remove request for ${r.title}?`)) void act(() => client.removeRequest(r.id)); }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
