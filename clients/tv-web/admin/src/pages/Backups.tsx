import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeApiError,
  type BackupFailure,
  type BackupInventoryItem,
  type BackupOverview,
  type BackupRunStatus,
  type BackupSummary,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  backupBadge,
  describePhase,
  downloadName,
  formatBytes,
  scheduleSummary,
} from "../lib/backups";

function InventoryList({ title, items }: { title: string; items: readonly BackupInventoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <dt>{title}</dt>
      <dd>
        <ul className="backup-inventory">
          {items.map((item) => (
            <li key={`${item.class}-${item.detail}`}>
              <strong>{item.class}</strong>: {item.detail}
            </li>
          ))}
        </ul>
      </dd>
    </>
  );
}

/** One backup with what it contains, what it does not, and what it depends on. */
export function BackupRow({
  backup,
  busy,
  onDownload,
  onVerify,
  onDelete,
  verifyResult,
}: {
  backup: BackupSummary;
  busy: boolean;
  onDownload: (backup: BackupSummary) => void;
  onVerify: (backup: BackupSummary) => void;
  onDelete: (backup: BackupSummary) => void;
  verifyResult?: string;
}) {
  const badge = backupBadge(backup);
  return (
    <li className={`backup-row${backup.complete ? "" : " backup-row--incomplete"}`} data-backup={backup.id}>
      <div className="backup-row-head">
        <span className="backup-when">{new Date(backup.created_at).toLocaleString()}</span>
        <span className={badge.className}>{badge.label}</span>
        <span className="muted">
          {formatBytes(backup.size_bytes)} · {backup.engine} · schema {backup.schema_version}
        </span>
      </div>
      <div className="backup-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || !backup.complete}
          onClick={() => onDownload(backup)}
        >
          Download
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => onVerify(backup)}
        >
          Verify checksum
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={busy}
          onClick={() => onDelete(backup)}
        >
          Delete
        </button>
        {verifyResult && <span className="muted" role="status">{verifyResult}</span>}
      </div>
      <details className="backup-details">
        <summary>What this backup contains</summary>
        <dl className="backup-guidance">
          <dt>Database</dt>
          <dd>
            {backup.tables} tables, {backup.rows.toLocaleString()} rows, taken by server{" "}
            {backup.server_version}.
          </dd>
          <InventoryList title="Included" items={backup.included} />
          <InventoryList title="Not included" items={backup.excluded} />
          <InventoryList title="Unavailable" items={backup.unavailable} />
          {backup.library_roots.length > 0 && (
            <>
              <dt>Libraries needed on restore</dt>
              <dd>
                <ul className="backup-inventory">
                  {backup.library_roots.map((root) => (
                    <li key={root}>{root}</li>
                  ))}
                </ul>
                <span className="muted">
                  Media files are not copied. The replacement server must provide these paths, or
                  restore with a path remap.
                </span>
              </dd>
            </>
          )}
          <dt>Secrets to supply</dt>
          <dd>{backup.required_secrets.join("; ")}</dd>
        </dl>
      </details>
    </li>
  );
}

export function BackupRunBanner({ run }: { run: BackupRunStatus }) {
  return (
    <section className="backup-run" role="status" aria-label="Backup in progress">
      <strong>Backup running</strong> ({run.trigger}, started{" "}
      {new Date(run.started_at).toLocaleTimeString()}): {describePhase(run)}
    </section>
  );
}

export function BackupFailures({ failures }: { failures: readonly BackupFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <section className="backup-failures" aria-label="Recent backup failures">
      <h2 className="section-title">Recent failures</h2>
      <ul className="backup-failure-list">
        {failures.map((failure) => (
          <li key={failure.id}>
            <strong>{new Date(failure.at).toLocaleString()}</strong> during {failure.phase}:{" "}
            {failure.error}
          </li>
        ))}
      </ul>
      <p className="muted">A failed run publishes nothing and never removes an older backup.</p>
    </section>
  );
}

export function BackupSetup({ restoreCommand }: { restoreCommand: string }) {
  return (
    <section className="backup-setup">
      <h2 className="section-title">Backups are not enabled on this server</h2>
      <ol>
        <li>
          On a trusted machine run <code>playarr-server backup keygen --out recovery.key</code>.
          Keep that file offline, away from this server. It is the only way to read a backup.
        </li>
        <li>
          Set <code>PLAYARR_BACKUP_RECIPIENTS</code> to the printed public key and{" "}
          <code>PLAYARR_BACKUP_DIR</code> to a directory with enough free space (ideally on a
          different disk or share), then restart the server.
        </li>
        <li>
          Optional: <code>PLAYARR_BACKUP_INTERVAL_HOURS</code>, <code>PLAYARR_BACKUP_KEEP_LAST</code>,{" "}
          <code>PLAYARR_BACKUP_KEEP_DAYS</code>, <code>PLAYARR_BACKUP_MODE</code> (
          <code>full</code> or <code>database</code>).
        </li>
      </ol>
      <p className="muted">
        Restore on a replacement server with: <code>{restoreCommand}</code>
      </p>
    </section>
  );
}

const POLL_MS = 2000;

/**
 * Admin "Backups": configuration, progress, history, download and verify for
 * encrypted server backups (`/api/v1/admin/backups`). Restore is a CLI action
 * on the replacement server because the database cannot be replaced under a
 * running one; the command is shown below the history.
 */
export function BackupsPage() {
  useDocumentTitle("Backups");
  const client = useApiClient();
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyResults, setVerifyResults] = useState<Record<string, string>>({});
  const timer = useRef<number | null>(null);

  const load = useCallback(() => {
    client
      .getBackups()
      .then((response) => {
        setOverview(response);
        setError(null);
      })
      .catch((err: unknown) => setError(describeApiError(err)));
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while a run is active so progress and the finished backup appear.
  const running = overview?.current != null;
  useEffect(() => {
    if (!running) return undefined;
    timer.current = window.setInterval(load, POLL_MS);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [running, load]);

  async function startBackup() {
    setBusy(true);
    try {
      await client.startBackup();
      load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function download(backup: BackupSummary) {
    setBusy(true);
    try {
      const blob = await client.downloadBackup(backup.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(backup);
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(backup: BackupSummary) {
    setBusy(true);
    try {
      const result = await client.verifyBackup(backup.id);
      setVerifyResults((previous) => ({
        ...previous,
        [backup.id]: result.ok
          ? "Stored archive matches its recorded checksum."
          : "Checksum mismatch or archive missing: do not rely on this backup.",
      }));
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(backup: BackupSummary) {
    if (!window.confirm(`Delete the backup from ${new Date(backup.created_at).toLocaleString()}?`)) {
      return;
    }
    setBusy(true);
    try {
      await client.deleteBackup(backup.id);
      load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Backups</h1>
      <p className="muted" style={{ maxWidth: 680, marginBottom: "1rem" }}>
        Encrypted, consistent backups of this server&apos;s library catalogue, users and
        permissions, history, playlists and settings. Media files stay where they are and are never
        copied. Backups can only be read with the recovery key, which this server does not hold.
      </p>

      {error && <p className="error-text" role="alert">{error}</p>}
      {overview === null && !error && <p className="muted">Loading...</p>}

      {overview && !overview.enabled && <BackupSetup restoreCommand={overview.restore_command} />}

      {overview?.enabled && (
        <>
          <dl className="backup-config">
            <dt>Destination</dt>
            <dd>{overview.destination}</dd>
            <dt>Contents</dt>
            <dd>
              {overview.mode === "full"
                ? "Full (database and server-managed assets)"
                : "Database only (partial: artwork is re-fetched after restore)"}
            </dd>
            <dt>Schedule</dt>
            <dd>{scheduleSummary(overview.schedule_hours)}</dd>
            <dt>Retention</dt>
            <dd>
              Newest {overview.keep_last}, and anything within {overview.keep_days} days. The last
              good backup is never removed.
            </dd>
            <dt>Recovery key</dt>
            <dd>
              {overview.recipient_fingerprints.length} key
              {overview.recipient_fingerprints.length === 1 ? "" : "s"}:{" "}
              {overview.recipient_fingerprints.map((fingerprint) => (
                <code key={fingerprint} className="backup-fingerprint">{fingerprint}</code>
              ))}
            </dd>
          </dl>

          <div style={{ display: "flex", gap: "0.75rem", margin: "1rem 0", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || overview.current != null}
              onClick={startBackup}
            >
              {overview.current ? "Backup running..." : "Back up now"}
            </button>
          </div>

          {overview.current && <BackupRunBanner run={overview.current} />}
          <BackupFailures failures={overview.failures} />

          <h2 className="section-title">Backups</h2>
          {overview.backups.length === 0 ? (
            <p className="muted">No backups yet.</p>
          ) : (
            <ul className="backup-list">
              {overview.backups.map((backup) => (
                <BackupRow
                  key={backup.id}
                  backup={backup}
                  busy={busy}
                  onDownload={download}
                  onVerify={verify}
                  onDelete={remove}
                  verifyResult={verifyResults[backup.id]}
                />
              ))}
            </ul>
          )}

          <section className="backup-setup">
            <h2 className="section-title">Restoring</h2>
            <p>
              Restore runs on the replacement server with the server stopped. It validates and
              stages first, keeps the existing data aside and refuses to continue when a check
              fails:
            </p>
            <p>
              <code>{overview.restore_command}</code>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
