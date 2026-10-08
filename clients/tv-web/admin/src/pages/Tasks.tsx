import { useEffect, useRef, useState } from "react";
import {
  describeApiError,
  type ActiveSessionView,
  type SourceInstanceSyncStatus,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/** How often to silently re-poll while this page is mounted, in ms. */
const POLL_INTERVAL_MS = 5000;

/** Badge modifier class for a given sync status -- mirrors the real *arr "System > Tasks"/Activity screens. */
function statusBadgeClass(status: string | null | undefined): string {
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

function statusLabel(status: string | null | undefined): string {
  return status ?? "unknown";
}

/** Locale-formatted timestamp, or a fallback if the given ISO string is missing. */
function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

/** Calendar data freshness for one source (admin diagnostics; users never see it). */
function calendarLabel(row: SourceInstanceSyncStatus): string {
  const synced = formatTimestamp(row.calendar_last_success_at);
  const base = synced ? `Synced ${synced}` : "Not synced yet";
  return row.calendar_error ? `${base} (last refresh failed: ${row.calendar_error})` : base;
}

function lastRunLabel(row: SourceInstanceSyncStatus): string {
  const finished = formatTimestamp(row.finished_at);
  if (finished) return finished;
  if (row.status === "running") {
    const started = formatTimestamp(row.started_at);
    if (started) return started;
  }
  return "Never";
}

/**
 * In-progress transcodes -- the subset of `client.activeSessions()` whose
 * `play_method` is `"transcode"`. Direct-play/direct-stream sessions are
 * real live playback too, but "what item it is for, and let me stop it" is
 * specifically about the expensive, cancellable case (an ffmpeg process
 * actually running on this node) -- the admin Activity page already covers
 * every session kind for general monitoring; this table is Tasks' own
 * narrower "is a transcode job hogging CPU right now" view.
 */
function TranscodingJobsSection() {
  const client = useApiClient();
  const [sessions, setSessions] = useState<ActiveSessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  function refresh() {
    client
      .activeSessions()
      .then((rows) => {
        setSessions(rows.filter((row) => row.play_method === "transcode"));
        setError(null);
      })
      .catch((err: unknown) => setError(describeApiError(err)));
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [client]);

  function stop(sessionId: string) {
    setStoppingId(sessionId);
    client
      .stopSession(sessionId)
      .then(() => {
        setSessions((current) => current?.filter((row) => row.session_id !== sessionId) ?? null);
      })
      .catch((err: unknown) => setError(describeApiError(err)))
      .finally(() => setStoppingId(null));
  }

  return (
    <div style={{ marginBottom: "2rem" }}>
      <h2 className="section-title" style={{ marginBottom: "0.5rem" }}>
        In-progress transcodes
      </h2>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        On-demand ffmpeg jobs currently running on this node. Updates automatically every few
        seconds.
      </p>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      {sessions !== null && sessions.length === 0 && !error && (
        <p className="muted">No transcodes running right now.</p>
      )}

      {sessions !== null && sessions.length > 0 && (
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Item</th>
              <th style={{ textAlign: "left" }}>User</th>
              <th style={{ textAlign: "left" }}>Target</th>
              <th style={{ textAlign: "left" }}>Started</th>
              <th style={{ textAlign: "left" }}></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((row) => (
              <tr key={row.session_id}>
                <td>{row.media_title ?? row.media_file_id}</td>
                <td className="muted">{row.user_display_name ?? row.user_id}</td>
                <td className="muted">
                  {row.target_container} &middot; {row.target_codec}
                </td>
                <td className="muted">{formatTimestamp(row.started_at) ?? "Unknown"}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={stoppingId === row.session_id}
                    onClick={() => stop(row.session_id)}
                  >
                    {stoppingId === row.session_id ? "Stopping..." : "Stop"}
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

/**
 * Every registered source instance's last-known sync status, plus
 * in-progress transcodes -- the admin equivalent of Sonarr/Radarr's own
 * "System > Tasks"/Activity screens. Sync status is backed by `GET
 * /api/v1/admin/source-instances/sync-status` (`client.sourceInstanceSyncStatuses()`),
 * purely in-memory server-side state -- see that method's own doc comment.
 * Both sections poll every `POLL_INTERVAL_MS` so a running sync/transcode's
 * status updates without a manual reload, in addition to the explicit
 * "Refresh" button.
 */
export function TasksPage() {
  useDocumentTitle("Tasks");
  const client = useApiClient();
  const [statuses, setStatuses] = useState<SourceInstanceSyncStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(() => new Set());
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const syncRequestedAtRef = useRef(new Map<string, number>());

  function refresh() {
    client
      .sourceInstanceSyncStatuses()
      .then((rows) => {
        setStatuses(rows);
        setError(null);
        const completedRequests = new Set<string>();
        for (const row of rows) {
          const requestedAt = syncRequestedAtRef.current.get(row.source_instance_id);
          if (requestedAt === undefined) continue;
          const startedAt = row.started_at
            ? new Date(row.started_at).getTime()
            : Number.NaN;
          const finishedAt = row.finished_at
            ? new Date(row.finished_at).getTime()
            : Number.NaN;
          if (
            row.status === "running" ||
            (!Number.isNaN(startedAt) && startedAt >= requestedAt - 1000) ||
            (!Number.isNaN(finishedAt) && finishedAt >= requestedAt - 1000)
          ) {
            syncRequestedAtRef.current.delete(row.source_instance_id);
            completedRequests.add(row.source_instance_id);
          }
        }
        if (completedRequests.size > 0) {
          setSyncingIds((current) => {
            const next = new Set(current);
            for (const id of completedRequests) next.delete(id);
            return next;
          });
        }
      })
      .catch((err: unknown) => setError(describeApiError(err)));
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [client]);

  function syncInstance(row: SourceInstanceSyncStatus) {
    const id = row.source_instance_id;
    syncRequestedAtRef.current.set(id, Date.now());
    setSyncingIds((current) => new Set(current).add(id));
    setSyncErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });

    client
      .syncSourceInstance(id)
      .then(() => {
        window.setTimeout(refresh, 500);
      })
      .catch((err: unknown) => {
        syncRequestedAtRef.current.delete(id);
        setSyncErrors((current) => ({ ...current, [id]: describeApiError(err) }));
        setSyncingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      });
  }

  return (
    <div className="page">
      <h1 className="page-title">Tasks</h1>

      <TranscodingJobsSection />

      <h2 className="section-title" style={{ marginBottom: "0.5rem" }}>
        Source sync
      </h2>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        Every registered source instance's last-known sync outcome. Updates automatically every
        few seconds while a sync is running.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
        <button type="button" className="btn btn-secondary" onClick={refresh}>
          Refresh
        </button>
      </div>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      {statuses !== null && statuses.length === 0 && (
        <p className="muted">No source instances registered yet -- see Source instances.</p>
      )}

      {statuses !== null && statuses.length > 0 && (
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Source</th>
              <th style={{ textAlign: "left" }}>Kind</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th style={{ textAlign: "left" }}>Last run</th>
              <th style={{ textAlign: "left" }}>Calendar data</th>
              <th style={{ textAlign: "left" }}>Error</th>
              <th style={{ textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((row) => (
              <tr key={row.source_instance_id}>
                <td>{row.name}</td>
                <td style={{ textTransform: "capitalize" }}>{row.kind}</td>
                <td>
                  <span className={statusBadgeClass(syncingIds.has(row.source_instance_id) ? "running" : row.status)}>
                    {syncingIds.has(row.source_instance_id) ? "syncing" : statusLabel(row.status)}
                  </span>
                  {row.status === "running" && row.detail && (
                    <p className="muted" style={{ fontSize: "var(--font-size-caption)", margin: "0.25rem 0 0" }}>
                      {row.detail}
                    </p>
                  )}
                </td>
                <td className="muted">{lastRunLabel(row)}</td>
                <td className={row.calendar_error ? "error-text" : "muted"}>{calendarLabel(row)}</td>
                <td className="error-text">
                  {syncErrors[row.source_instance_id] ??
                    (row.status === "failed" ? row.error ?? "Unknown error" : "")}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={syncingIds.has(row.source_instance_id) || row.status === "running"}
                    onClick={() => syncInstance(row)}
                  >
                    {syncingIds.has(row.source_instance_id) || row.status === "running"
                      ? "Syncing..."
                      : "Sync now"}
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
