import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DownloadKeepUntilPolicy, DownloadRecord } from "../lib/downloadsDb";
import { useDownloads } from "../lib/DownloadsProvider";
import { formatBytes } from "../lib/formatBytes";
import { useApiClient } from "../lib/ApiClientProvider";
import { CachedArtworkImage } from "../lib/artwork";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { EditKeepUntilDrawer } from "../components/EditKeepUntilDrawer";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import { TvRailSurface, TvStageShell } from "../components/tv/TvStage";
import { NotFoundPage } from "./NotFound";
import type { Work, WorkDetail } from "@streamarr-tv/api-client";

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface FocusedEpisodeInfo {
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string | null;
  episodeOverview: string | null;
}

interface FocusedPreview {
  detail: WorkDetail | null;
  episode: FocusedEpisodeInfo | null;
}

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

function recordTypeLabel(record: DownloadRecord, t: TFunc): string | null {
  switch (record.workKind) {
    case "movie":
      return t("pages.downloads.typeMovie");
    case "series":
      return t("pages.downloads.typeEpisode");
    case "site":
      return t("pages.downloads.typeVideo");
    case "artist":
      return t("pages.downloads.typeTrack");
    default:
      return null;
  }
}

/** `/music/:id` for a track (its `workId` is the artist work); `/library/:id` (the generic detail route) for everything else. */
function recordDetailRoute(record: DownloadRecord): string {
  return record.workKind === "artist" ? `/music/${record.workId}` : `/library/${record.workId}`;
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

/** Genre/kind kicker fallback for the preview panel, mirroring `WorkDetail.tsx`'s local `workKindLabel` (reused translation keys -- see that file's `pages.workDetail.kind*` strings). */
function workDetailKindLabel(work: Work, t: TFunc): string {
  switch (work.kind) {
    case "site":
      return t("pages.workDetail.kindSite");
    case "series":
      return t("pages.workDetail.kindSeries");
    case "movie":
      return t("pages.workDetail.kindMovie");
    default:
      return work.kind;
  }
}

function workReleaseYear(work: Work): string | null {
  const source = work.release_date ?? work.added_at;
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : String(date.getUTCFullYear());
}

/** Resolves which episode (if any) a download's `mediaFileId` plays within a fetched `WorkDetail` -- `null` for movies/sites-without-a-match, or while the detail is still an in-flight/failed fetch. */
function findFocusedEpisode(detail: WorkDetail, mediaFileId: string): FocusedEpisodeInfo | null {
  if (typeof detail.children !== "object" || detail.children === null || !("Series" in detail.children)) {
    return null;
  }
  for (const season of detail.children.Series) {
    const match = season.episodes.find((candidate) => candidate.media_file_id === mediaFileId);
    if (match) {
      return {
        seasonNumber: season.season.season_number,
        episodeNumber: match.episode.episode_number,
        episodeTitle: match.episode.title ?? null,
        episodeOverview: match.episode.overview ?? null,
      };
    }
  }
  return null;
}

function DownloadRow({
  record,
  t,
  onRetry,
  onRemove,
  onEdit,
  onFocusRow,
}: {
  record: DownloadRecord;
  t: TFunc;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (record: DownloadRecord) => void;
  onFocusRow: (id: string) => void;
}) {
  const isActive =
    record.status === "queued" || record.status === "processing" || record.status === "downloading";
  const canRetry = record.status === "failed" || record.status === "canceled" || record.status === "expired";
  const typeLabel = recordTypeLabel(record, t);
  const progressPercent =
    record.totalBytes && record.totalBytes > 0
      ? Math.min(100, Math.round((record.bytesDownloaded / record.totalBytes) * 100))
      : null;

  return (
    <li
      className="tv-download-row"
      data-navigation-focus-key={`downloads:${record.id}`}
      onFocus={() => onFocusRow(record.id)}
    >
      <Link to={recordDetailRoute(record)} className="tv-download-row-copy">
        <strong>{record.title}</strong>
        {record.subtitle ? <small>{record.subtitle}</small> : null}
        <span className="tv-download-row-meta">
          {typeLabel ? (
            <>
              <span>{typeLabel}</span>
              <i aria-hidden="true" />
            </>
          ) : null}
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
      </Link>
      <div className="tv-download-row-actions">
        <button type="button" onClick={() => onEdit(record)}>
          {t("pages.downloads.edit")}
        </button>
        {canRetry ? (
          <button type="button" onClick={() => onRetry(record.id)}>
            {t("pages.downloads.retry")}
          </button>
        ) : null}
        <button type="button" className="tv-download-row-remove" onClick={() => onRemove(record.id)}>
          {isActive ? t("pages.downloads.cancel") : t("pages.downloads.delete")}
        </button>
      </div>
    </li>
  );
}

/**
 * The `/downloads` nav destination: this profile's offline downloads,
 * grouped into Active/Needs-attention/Downloaded sections, with a right-hand
 * preview panel (matching every other library-style page's list+preview
 * layout) showing the currently-focused row's richer detail plus this
 * device's storage usage. Unlike most of the app, this page is explicitly
 * *not* offline-soft-gated -- browsing and playing already-downloaded titles
 * is the entire point of being offline, so this page (and the player, for a
 * downloaded item) keeps working with no network at all: the preview panel
 * falls back to the download record's own flat title/subtitle whenever
 * there's no connection (or the enrichment fetch hasn't resolved yet)
 * instead of blocking or erroring.
 */
export function DownloadsPage() {
  const { t } = useLanguage();
  const online = useOnlineStatus();
  const client = useApiClient();
  const { downloads, storageUsage, storageSupported, retry, remove, updateKeepUntil, canDownload } =
    useDownloads();
  useDocumentTitle(t("pages.downloads.title"));

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusedDetail, setFocusedDetail] = useState<WorkDetail | null>(null);
  const [editingRecord, setEditingRecord] = useState<DownloadRecord | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);

  const confirmEditKeepUntil = (keepUntil: DownloadKeepUntilPolicy) => {
    if (!editingRecord) return;
    setEditingBusy(true);
    void updateKeepUntil(editingRecord.id, keepUntil).finally(() => {
      setEditingBusy(false);
      setEditingRecord(null);
    });
  };

  const active = downloads.filter(
    (record) =>
      record.status === "queued" || record.status === "processing" || record.status === "downloading"
  );
  const needsAttention = downloads.filter(
    (record) => record.status === "failed" || record.status === "canceled" || record.status === "expired"
  );
  const completed = downloads.filter((record) => record.status === "ready");
  const orderedDownloads = [...active, ...needsAttention, ...completed];

  const focused =
    orderedDownloads.find((record) => record.id === focusedId) ?? orderedDownloads[0] ?? null;
  const focusedWorkId = focused?.workId ?? null;

  const storagePercent =
    storageUsage && storageUsage.quotaBytes > 0
      ? Math.min(100, Math.round((storageUsage.usageBytes / storageUsage.quotaBytes) * 100))
      : null;

  // Enriches the focused row with its full catalog `WorkDetail` (genre/year/
  // overview/artwork, and -- for a series/site episode -- its season/episode
  // context) whenever it's reachable. Deliberately skipped while offline;
  // the render below falls back to the download record's own flat fields
  // rather than erroring, per this page's offline-exempt design above.
  useEffect(() => {
    if (!focusedWorkId || !online) {
      setFocusedDetail(null);
      return;
    }
    let cancelled = false;
    setFocusedDetail(null);
    client
      .getWork(focusedWorkId)
      .then((detail) => {
        if (!cancelled) setFocusedDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setFocusedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, focusedWorkId, online]);

  const focusedPreview: FocusedPreview | null = focused
    ? (() => {
        const detail =
          focusedDetail && focusedDetail.work.id === focused.workId ? focusedDetail : null;
        const episode = detail ? findFocusedEpisode(detail, focused.mediaFileId) : null;
        return { detail, episode };
      })()
    : null;

  // `null` (not yet resolved) is a genuinely distinct state from `false`
  // (confirmed no access): show a loading state, not the 404, while it's
  // still in flight -- mirrors the exact tv-compact-loading pattern
  // Home.tsx/Library.tsx/Playlists.tsx already use for their own initial
  // loads. Never the real content during this window either.
  if (canDownload === null) {
    return (
      <div
        className="tv-library tv-compact-loading"
        aria-label={t("pages.downloads.loadingLabel")}
        role="status"
      >
        <div className="tv-orbit-loader" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <p>{t("pages.downloads.preparingLabel")}</p>
      </div>
    );
  }

  // Defense in depth: the nav item is already hidden without this grant,
  // but a direct navigation (bookmark, typed URL) should still land on the
  // same 404 an address that never existed would -- not a redirect (which
  // would confirm "this route exists, you're just not allowed").
  if (canDownload === false) {
    return <NotFoundPage />;
  }

  return (
    <TvStageShell
      className="tv-library tv-downloads"
      ariaLabel={t("pages.downloads.title")}
      artworkKey={focused?.id}
      artwork={
        focusedPreview?.detail ? (
          <CachedArtworkImage
            work={focusedPreview.detail.work}
            kinds={["backdrop", "poster"]}
            alt=""
            fallback={<span>{focusedPreview.detail.work.title}</span>}
          />
        ) : undefined
      }
    >
      <header className="tv-library-heading">
        <Link to="/" className="tv-page-back" aria-label={t("pages.downloads.backToHome")}>
          <span aria-hidden="true">←</span>
        </Link>
        <h1>{t("pages.downloads.title")}</h1>
        {storageSupported && storageUsage ? (
          <span>
            {t("pages.downloads.storageUsed", {
              used: formatBytes(storageUsage.usageBytes),
              quota: formatBytes(storageUsage.quotaBytes),
            })}
          </span>
        ) : null}
        {!online ? <span className="tv-downloads-offline-badge">{t("pages.downloads.offline")}</span> : null}
      </header>

      {focused ? (
        <aside className="tv-library-preview tv-downloads-preview" key={`preview-${focused.id}`}>
          {focusedPreview?.detail ? (
            <>
              <p className="tv-provider">
                {focusedPreview.episode
                  ? focusedPreview.detail.work.title
                  : focusedPreview.detail.work.genres[0] ??
                    workDetailKindLabel(focusedPreview.detail.work, t)}
              </p>
              <h2>
                {focusedPreview.episode
                  ? focusedPreview.episode.episodeTitle ??
                    t("pages.workDetail.episodeNumber", {
                      number: focusedPreview.episode.episodeNumber,
                    })
                  : focusedPreview.detail.work.title}
              </h2>
              <p className="tv-preview-meta">
                {focusedPreview.episode ? (
                  <span>
                    {`S${String(focusedPreview.episode.seasonNumber).padStart(2, "0")} · E${String(
                      focusedPreview.episode.episodeNumber
                    ).padStart(2, "0")}`}
                  </span>
                ) : null}
                {workReleaseYear(focusedPreview.detail.work) ? (
                  <span>{workReleaseYear(focusedPreview.detail.work)}</span>
                ) : null}
                <span>
                  {focusedPreview.detail.work.genres.slice(0, 2).join(" · ") ||
                    workDetailKindLabel(focusedPreview.detail.work, t)}
                </span>
              </p>
              <p className="tv-preview-overview">
                {(focusedPreview.episode?.episodeOverview ?? focusedPreview.detail.work.overview) ??
                  t("pages.library.noSynopsis")}
              </p>
            </>
          ) : (
            <>
              <p className="tv-provider">{focused.qualityLabel}</p>
              <h2>{focused.title}</h2>
              {focused.subtitle ? (
                <p className="tv-preview-meta">
                  <span>{focused.subtitle}</span>
                </p>
              ) : null}
            </>
          )}
        </aside>
      ) : null}

      <TvRailSurface className="tv-rail-panel tv-downloads-panel" mode="content" ariaLabel={t("pages.downloads.title")}>
        {storageSupported && storageUsage ? (
          <div className="tv-downloads-storage-panel">
            <span>
              {t("pages.downloads.storageUsed", {
                used: formatBytes(storageUsage.usageBytes),
                quota: formatBytes(storageUsage.quotaBytes),
              })}
            </span>
            {storagePercent !== null ? (
              <div
                className="tv-download-progress tv-downloads-storage-bar"
                role="progressbar"
                aria-valuenow={storagePercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span className="tv-download-progress-fill" style={{ width: `${storagePercent}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}
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
                      <DownloadRow
                        key={record.id}
                        record={record}
                        t={t}
                        onRetry={retry}
                        onRemove={remove}
                        onEdit={setEditingRecord}
                        onFocusRow={setFocusedId}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {needsAttention.length > 0 ? (
                <section className="tv-downloads-section">
                  <h2>{t("pages.downloads.needsAttentionHeading")}</h2>
                  <ul>
                    {needsAttention.map((record) => (
                      <DownloadRow
                        key={record.id}
                        record={record}
                        t={t}
                        onRetry={retry}
                        onRemove={remove}
                        onEdit={setEditingRecord}
                        onFocusRow={setFocusedId}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="tv-downloads-section">
                <h2>{t("pages.downloads.completedHeading")}</h2>
                {completed.length > 0 ? (
                  <ul>
                    {completed.map((record) => (
                      <DownloadRow
                        key={record.id}
                        record={record}
                        t={t}
                        onRetry={retry}
                        onRemove={remove}
                        onEdit={setEditingRecord}
                        onFocusRow={setFocusedId}
                      />
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

      {editingRecord ? (
        <EditKeepUntilDrawer
          title={editingRecord.title}
          keepUntil={editingRecord.keepUntil}
          busy={editingBusy}
          onClose={() => setEditingRecord(null)}
          onConfirm={confirmEditKeepUntil}
        />
      ) : null}
    </TvStageShell>
  );
}
