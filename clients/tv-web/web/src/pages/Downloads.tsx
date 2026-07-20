import { Link } from "react-router-dom";
import type { DownloadRecord } from "../lib/downloadsDb";
import { useDownloads } from "../lib/DownloadsProvider";
import { formatBytes } from "../lib/formatBytes";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import { TvRailSurface, TvStageShell } from "../components/tv/TvStage";

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string;

function statusLabel(record: DownloadRecord, t: TFunc): string {
  switch (record.status) {
    case "queued":
      return t("pages.downloads.statusQueued");
    case "processing":
      return t("pages.downloads.statusProcessing");
    case "downloading":
      return t("pages.downloads.statusDownloading");
    case "paused":
      return t("pages.downloads.statusPaused");
    case "ready":
      return t("pages.downloads.statusReady");
    case "failed":
      return t("pages.downloads.statusFailed");
    case "canceled":
      return t("pages.downloads.statusCanceled");
    case "expired":
      return t("pages.downloads.statusExpired");
    default:
      return record.status;
  }
}

function keepUntilLabel(record: DownloadRecord, t: TFunc): string {
  const policy = record.keepUntil;
  if (policy.type === "forever") return t("pages.downloads.keepForever");
  if (policy.type === "date") {
    return t("pages.downloads.keepUntilDate", {
      date: new Date(policy.date).toLocaleDateString(),
    });
  }
  return policy.unit === "weeks"
    ? t("pages.downloads.keepUntilAfterWatchedWeeks", { count: policy.amount })
    : t("pages.downloads.keepUntilAfterWatchedDays", { count: policy.amount });
}

function DownloadRow({
  record,
  t,
  onCancel,
  onRetry,
  onRemove,
}: {
  record: DownloadRecord;
  t: TFunc;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const isActive =
    record.status === "queued" || record.status === "processing" || record.status === "downloading";
  const canRetry = record.status === "failed" || record.status === "canceled" || record.status === "expired";
  const progressPercent =
    record.totalBytes && record.totalBytes > 0
      ? Math.min(100, Math.round((record.bytesDownloaded / record.totalBytes) * 100))
      : null;

  return (
    <li className="tv-download-row" data-navigation-focus-key={`downloads:${record.id}`}>
      <div className="tv-download-row-copy">
        <strong>{record.title}</strong>
        {record.subtitle ? <small>{record.subtitle}</small> : null}
        <span className="tv-download-row-meta">
          <span>{record.qualityLabel}</span>
          <i aria-hidden="true" />
          <span>{statusLabel(record, t)}</span>
          <i aria-hidden="true" />
          <span>{keepUntilLabel(record, t)}</span>
        </span>
        {isActive ? (
          <div
            className="tv-download-progress"
            role="progressbar"
            aria-valuenow={progressPercent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("pages.downloads.progressAriaLabel", { title: record.title })}
          >
            <span
              className="tv-download-progress-fill"
              style={progressPercent !== null ? { width: `${progressPercent}%` } : undefined}
              data-indeterminate={progressPercent === null ? "true" : undefined}
            />
          </div>
        ) : null}
        <span className="tv-download-row-size">
          {isActive
            ? t("pages.downloads.bytesOfTotal", {
                downloaded: formatBytes(record.bytesDownloaded),
                total: record.totalBytes !== null ? formatBytes(record.totalBytes) : t("pages.downloads.unknownSize"),
              })
            : formatBytes(record.totalBytes ?? record.bytesDownloaded)}
        </span>
        {record.status === "failed" && record.errorMessage ? (
          <span className="tv-download-row-error" role="alert">
            {record.errorMessage}
          </span>
        ) : null}
      </div>
      <div className="tv-download-row-actions">
        {isActive ? (
          <button type="button" onClick={() => onCancel(record.id)}>
            {t("pages.downloads.cancel")}
          </button>
        ) : null}
        {canRetry ? (
          <button type="button" onClick={() => onRetry(record.id)}>
            {t("pages.downloads.retry")}
          </button>
        ) : null}
        <button type="button" className="tv-download-row-remove" onClick={() => onRemove(record.id)}>
          {t("pages.downloads.delete")}
        </button>
      </div>
    </li>
  );
}

/**
 * The `/downloads` nav destination: this profile's offline downloads,
 * grouped into Active/Needs-attention/Downloaded sections, with a storage-
 * usage footer. Unlike most of the app, this page is explicitly *not*
 * offline-soft-gated -- browsing and playing already-downloaded titles is
 * the entire point of being offline, so this page (and the player, for a
 * downloaded item) keeps working with no network at all.
 */
export function DownloadsPage() {
  const { t } = useLanguage();
  const online = useOnlineStatus();
  const { downloads, storageUsage, storageSupported, cancel, retry, remove } = useDownloads();
  useDocumentTitle(t("pages.downloads.title"));

  const active = downloads.filter(
    (record) =>
      record.status === "queued" || record.status === "processing" || record.status === "downloading"
  );
  const needsAttention = downloads.filter(
    (record) => record.status === "failed" || record.status === "canceled" || record.status === "expired"
  );
  const completed = downloads.filter((record) => record.status === "ready");

  const storagePercent =
    storageUsage && storageUsage.quotaBytes > 0
      ? Math.min(100, Math.round((storageUsage.usageBytes / storageUsage.quotaBytes) * 100))
      : null;

  return (
    <TvStageShell className="tv-library tv-downloads" ariaLabel={t("pages.downloads.title")}>
      <header className="tv-library-heading">
        <Link to="/" className="tv-page-back" aria-label={t("pages.downloads.backToHome")}>
          <span aria-hidden="true">←</span>
        </Link>
        <h1>{t("pages.downloads.title")}</h1>
        {!online ? <span className="tv-downloads-offline-badge">{t("pages.downloads.offline")}</span> : null}
      </header>

      <TvRailSurface className="tv-rail-panel tv-downloads-panel" mode="content" ariaLabel={t("pages.downloads.title")}>
        <div className="tv-downloads-content" data-tv-scroll-container data-tv-scroll-axis="vertical" data-navigation-scroll-key="downloads:list">
          {downloads.length === 0 ? (
            <TvEmptyState
              graphic="details"
              variant="page"
              title={t("pages.downloads.emptyTitle")}
              description={t("pages.downloads.emptyDescription")}
            />
          ) : (
            <>
              {active.length > 0 ? (
                <section className="tv-downloads-section">
                  <h2>{t("pages.downloads.activeHeading")}</h2>
                  <ul>
                    {active.map((record) => (
                      <DownloadRow key={record.id} record={record} t={t} onCancel={cancel} onRetry={retry} onRemove={remove} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {needsAttention.length > 0 ? (
                <section className="tv-downloads-section">
                  <h2>{t("pages.downloads.needsAttentionHeading")}</h2>
                  <ul>
                    {needsAttention.map((record) => (
                      <DownloadRow key={record.id} record={record} t={t} onCancel={cancel} onRetry={retry} onRemove={remove} />
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="tv-downloads-section">
                <h2>{t("pages.downloads.completedHeading")}</h2>
                {completed.length > 0 ? (
                  <ul>
                    {completed.map((record) => (
                      <DownloadRow key={record.id} record={record} t={t} onCancel={cancel} onRetry={retry} onRemove={remove} />
                    ))}
                  </ul>
                ) : (
                  <p className="tv-downloads-section-empty">{t("pages.downloads.noCompletedYet")}</p>
                )}
              </section>
            </>
          )}
        </div>
      </TvRailSurface>

      {storageSupported && storageUsage ? (
        <footer className="tv-downloads-storage-footer">
          <span>
            {t("pages.downloads.storageUsed", {
              used: formatBytes(storageUsage.usageBytes),
              quota: formatBytes(storageUsage.quotaBytes),
            })}
          </span>
          {storagePercent !== null ? (
            <div className="tv-download-progress tv-downloads-storage-bar" role="progressbar" aria-valuenow={storagePercent} aria-valuemin={0} aria-valuemax={100}>
              <span className="tv-download-progress-fill" style={{ width: `${storagePercent}%` }} />
            </div>
          ) : null}
        </footer>
      ) : null}
    </TvStageShell>
  );
}
