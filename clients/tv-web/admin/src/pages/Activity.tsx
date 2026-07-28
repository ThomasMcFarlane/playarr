import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  describeApiError,
  type ActiveSessionView,
  type PlayMethod,
  type SessionHistoryView,
  type SessionHistoryParams,
  type StopReason,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/** How often to silently re-poll the "live" section while this page is mounted, in ms. */
const POLL_INTERVAL_MS = 5000;

/** Badge modifier class for a play method -- direct play/stream reads as a plain success state, transcode as the same "in-progress work" color Tasks/SourceInstances use for a running sync. */
function playMethodBadgeClass(method: PlayMethod): string {
  switch (method) {
    case "direct_play":
    case "direct_stream":
      return "badge badge-success badge-pill";
    case "transcode":
      return "badge badge-queue badge-pill";
    default:
      return "badge badge-neutral badge-pill";
  }
}

function playMethodLabel(method: PlayMethod): string {
  switch (method) {
    case "direct_play":
      return "Direct play";
    case "direct_stream":
      return "Direct stream";
    case "transcode":
      return "Transcode";
    default:
      return method;
  }
}

/** Locale-formatted timestamp, or a fallback if the given ISO string is missing/unparseable. */
function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

/** Human-readable byte count -- no existing shared helper for this in the codebase. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

/** Human-readable stop reason -- `StopReason` is a string enum, except its one `Other(String)` variant which arrives as `{ other: "..." }`. */
function formatStopReason(reason: StopReason | null | undefined): string {
  if (!reason) return "--";
  if (typeof reason === "string") return reason.replace(/_/g, " ");
  return reason.other;
}

/** Human-readable duration from milliseconds, e.g. "1m 32s". */
function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

interface LinkedSessionContext {
  user_id: string;
  user_display_name?: string | null;
  media_file_id: string;
  work_id?: string | null;
  media_title?: string | null;
}

function UserLink({ session }: { session: LinkedSessionContext }) {
  return (
    <Link className="activity-link" to={`/users/${session.user_id}`}>
      {session.user_display_name ?? session.user_id}
    </Link>
  );
}

function MediaLink({ session }: { session: LinkedSessionContext }) {
  const label = session.media_title ?? session.media_file_id;
  return session.work_id ? (
    <Link className="activity-link" to={`/library/${session.work_id}`}>
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

/**
 * The "who's watching now" live table -- polls
 * `GET /api/v1/admin/playback/sessions/active` (`client.activeSessions()`)
 * every `POLL_INTERVAL_MS`, same shape as `TasksPage`'s own poll loop.
 */
function LiveSessionsSection() {
  const client = useApiClient();
  const [sessions, setSessions] = useState<ActiveSessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    client
      .activeSessions()
      .then((rows) => {
        setSessions(rows);
        setError(null);
      })
      .catch((err: unknown) => setError(describeApiError(err)));
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [client]);

  return (
    <section style={{ marginBottom: "2rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Live sessions</h2>
        <button type="button" className="btn btn-secondary" onClick={refresh}>
          Refresh
        </button>
      </div>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      {sessions !== null && sessions.length === 0 && (
        <p className="muted">Nobody is watching anything right now.</p>
      )}

      {sessions !== null && sessions.length > 0 && (
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Device / platform</th>
              <th>Title</th>
              <th>Method</th>
              <th>Started</th>
              <th>Buffering</th>
              <th>Bytes streamed</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.session_id}>
                <td><UserLink session={session} /></td>
                <td className="muted">{session.client_platform}</td>
                <td><MediaLink session={session} /></td>
                <td>
                  <span className={playMethodBadgeClass(session.play_method)}>
                    {playMethodLabel(session.play_method)}
                  </span>
                  <p className="muted" style={{ fontSize: "var(--font-size-caption)", margin: "0.25rem 0 0" }}>
                    {session.target_codec} / {session.target_container}
                  </p>
                </td>
                <td className="muted">{formatTimestamp(session.started_at)}</td>
                <td className="muted">
                  {session.buffering_events > 0
                    ? `${session.buffering_events} (${formatDurationMs(session.buffering_ms_total)})`
                    : "--"}
                </td>
                <td className="muted">{formatBytes(session.bytes_streamed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const EMPTY_FILTERS: SessionHistoryParams = { userId: "", from: "", to: "" };

/** Converts a `<input type="datetime-local">` value (no timezone, e.g. "2024-01-01T10:00") to a full RFC 3339 string the backend's `DateTime<Utc>` query param can actually parse. Empty/unparseable input passes through as `undefined`. */
function toRfc3339(localValue: string | undefined): string | undefined {
  if (!localValue) return undefined;
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * Filtered, paginated raw session history -- fetched only on mount or an
 * explicit filter change/"Search" click, never on the live section's 5s
 * poll (history doesn't change fast enough to justify polling cost).
 */
function SessionHistorySection() {
  const client = useApiClient();
  const [filters, setFilters] = useState<SessionHistoryParams>(EMPTY_FILTERS);
  const [sessions, setSessions] = useState<SessionHistoryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function search(params: SessionHistoryParams) {
    setLoading(true);
    setError(null);
    client
      .sessionHistory({
        userId: params.userId?.trim() || undefined,
        from: toRfc3339(params.from),
        to: toRfc3339(params.to),
      })
      .then((rows) => {
        setSessions(rows);
      })
      .catch((err: unknown) => setError(describeApiError(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    search(EMPTY_FILTERS);
    // Only on mount -- filter changes are applied via the explicit "Search" button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    search(filters);
  }

  return (
    <section>
      <h2 style={{ marginBottom: "0.75rem" }}>History</h2>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "1rem" }}
      >
        <div>
          <label className="form-label" htmlFor="activity-history-user-id">
            User id
          </label>
          <input
            id="activity-history-user-id"
            className="input"
            placeholder="Any user"
            value={filters.userId}
            onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="activity-history-from">
            From
          </label>
          <input
            id="activity-history-from"
            type="datetime-local"
            className="input"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="activity-history-to">
            To
          </label>
          <input
            id="activity-history-to"
            type="datetime-local"
            className="input"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}

      {sessions !== null && sessions.length === 0 && (
        <p className="muted">No sessions match these filters.</p>
      )}

      {sessions !== null && sessions.length > 0 && (
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Title</th>
              <th>Method</th>
              <th>Started</th>
              <th>Ended</th>
              <th>Stop reason</th>
              <th>Bytes streamed</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td><UserLink session={session} /></td>
                <td><MediaLink session={session} /></td>
                <td>
                  <span className={playMethodBadgeClass(session.play_method)}>
                    {playMethodLabel(session.play_method)}
                  </span>
                </td>
                <td className="muted">{formatTimestamp(session.started_at)}</td>
                <td className="muted">{formatTimestamp(session.ended_at)}</td>
                <td className="muted">{formatStopReason(session.stop_reason)}</td>
                <td className="muted">{formatBytes(session.bytes_streamed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Live + historical playback-session activity -- the admin equivalent of
 * Plex/Jellyfin's own "Now playing"/activity dashboards. Backed by
 * `GET /api/v1/admin/playback/sessions/active` (5s-polled "who's watching
 * now") and `GET /api/v1/admin/playback/sessions/history` (filtered,
 * fetched on demand, per `client.activeSessions()`/`client.sessionHistory()`'s
 * own doc comments).
 */
export function ActivityPage() {
  useDocumentTitle("Activity");

  return (
    <div className="page">
      <h1 className="page-title">Activity</h1>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1.5rem" }}>
        Live and historical Playarr playback sessions -- who's watching what, right now and over
        time.
      </p>

      <LiveSessionsSection />
      <SessionHistorySection />
    </div>
  );
}
