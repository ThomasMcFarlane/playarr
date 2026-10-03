import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  describeApiError,
  type UserDataExportJob,
  type UserDataImportPreview,
  type UserDataImportResult,
  type UserDataProgressConflicts,
} from "@playarr-tv/api-client";
import { PLAYARR_CLIENT_PLATFORM } from "../../lib/clientPlatform";
import { usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { usesTenFootChrome } from "../../lib/productSurfaces";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

type TFunction = ReturnType<typeof useLanguage>["t"];

export interface YourDataViewProps {
  t: TFunction;
  /** Ten-foot platforms have no file picker; the page says so honestly. */
  fileTransferAvailable: boolean;
  exportJob: UserDataExportJob | null;
  exportBusy: boolean;
  exportError: string | null;
  onStartExport: () => void;
  onDownloadExport: () => void;
  file: File | null;
  onChooseFile: (file: File | null) => void;
  includePreferences: boolean;
  onIncludePreferences: (value: boolean) => void;
  conflicts: UserDataProgressConflicts;
  onConflicts: (value: UserDataProgressConflicts) => void;
  preview: UserDataImportPreview | null;
  result: UserDataImportResult | null;
  importBusy: boolean;
  importError: string | null;
  onPreview: () => void;
  onApply: () => void;
  onDownloadUnmatched: () => void;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pure presentation of the "Your data" panel; all behaviour lives in the container. */
export function YourDataView(props: YourDataViewProps) {
  const { t } = props;
  if (!props.fileTransferAvailable) {
    return (
      <section className="card settings-card settings-card-wide">
        <p className="muted">{t("settings.yourData.unavailableOnThisDevice")}</p>
      </section>
    );
  }
  const job = props.exportJob;
  const running = job?.status === "queued" || job?.status === "running";
  const summary = props.preview?.summary;
  return (
    <>
      <section className="card settings-card settings-card-wide" aria-labelledby="your-data-export">
        <h3 id="your-data-export">{t("settings.yourData.exportTitle")}</h3>
        <p className="muted">{t("settings.yourData.exportDescription")}</p>
        <p className="hint">{t("settings.yourData.scopeNote")}</p>
        <div className="connection-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={props.exportBusy || running}
            onClick={props.onStartExport}
          >
            {running ? t("settings.yourData.exportPreparing") : t("settings.yourData.exportStart")}
          </button>
          {job?.status === "ready" ? (
            <button type="button" className="btn btn-secondary" onClick={props.onDownloadExport}>
              {t("settings.yourData.exportDownload")} ({formatBytes(job.size_bytes)})
            </button>
          ) : null}
        </div>
        {job ? (
          <p className="muted" aria-live="polite" data-testid="export-status">
            {job.status === "ready"
              ? t("settings.yourData.exportReady", {
                  watch: String(job.counts.watch_progress),
                  playlists: String(job.counts.playlists),
                })
              : job.status === "failed"
                ? t("settings.yourData.exportFailed")
                : job.status === "expired"
                  ? t("settings.yourData.exportExpired")
                  : t("settings.yourData.exportProgress", { stage: job.progress.stage })}
          </p>
        ) : null}
        {job?.status === "ready" && job.expires_at ? (
          <p className="hint">
            {t("settings.yourData.exportExpires", {
              time: new Date(job.expires_at).toLocaleTimeString(),
            })}
          </p>
        ) : null}
        {props.exportError ? (
          <p className="error-text" role="alert">
            {props.exportError}
          </p>
        ) : null}
      </section>

      <section className="card settings-card settings-card-wide" aria-labelledby="your-data-import">
        <h3 id="your-data-import">{t("settings.yourData.importTitle")}</h3>
        <p className="muted">{t("settings.yourData.importDescription")}</p>
        <label className="form-label" htmlFor="your-data-file">
          {t("settings.yourData.importFileLabel")}
          <input
            id="your-data-file"
            className="input"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => props.onChooseFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="form-label" htmlFor="your-data-conflicts">
          {t("settings.yourData.conflictsLabel")}
          <select
            id="your-data-conflicts"
            className="input"
            value={props.conflicts}
            onChange={(event) => props.onConflicts(event.target.value as UserDataProgressConflicts)}
          >
            <option value="newest">{t("settings.yourData.conflictsNewest")}</option>
            <option value="keep_existing">{t("settings.yourData.conflictsKeep")}</option>
          </select>
        </label>
        <label className="form-label">
          <input
            type="checkbox"
            checked={props.includePreferences}
            onChange={(event) => props.onIncludePreferences(event.target.checked)}
          />{" "}
          {t("settings.yourData.includePreferences")}
        </label>
        <div className="connection-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!props.file || props.importBusy}
            onClick={props.onPreview}
          >
            {t("settings.yourData.previewButton")}
          </button>
        </div>
        {props.importError ? (
          <p className="error-text" role="alert">
            {props.importError}
          </p>
        ) : null}

        {props.preview && summary ? (
          <div data-testid="import-preview" aria-live="polite">
            <h4>{t("settings.yourData.previewTitle")}</h4>
            {props.preview.warnings.map((warning) => (
              <p className="hint" key={warning}>
                {warning}
              </p>
            ))}
            <ul>
              <li>
                {t("settings.yourData.previewProgress", {
                  add: String(summary.watch_progress.will_add),
                  update: String(summary.watch_progress.will_update),
                  same: String(summary.watch_progress.already_present),
                  kept: String(summary.watch_progress.conflicts_kept),
                })}
              </li>
              <li>
                {t("settings.yourData.previewPlaylists", {
                  created: String(summary.playlists.new),
                  items: String(summary.playlists.items_to_add),
                  present: String(summary.playlists.items_already_present),
                })}
              </li>
              <li>
                {t("settings.yourData.previewUnmatched", {
                  unmatched: String(summary.unmatched_total),
                  ambiguous: String(summary.watch_progress.ambiguous),
                })}
              </li>
              {summary.preferred_audio_language_change ? (
                <li>
                  {t("settings.yourData.previewLanguage", {
                    language: summary.preferred_audio_language_change,
                  })}
                </li>
              ) : null}
              {summary.playback_preferences_not_applied > 0 ? (
                <li>
                  {t("settings.yourData.previewPlaybackChoices", {
                    count: String(summary.playback_preferences_not_applied),
                  })}
                </li>
              ) : null}
            </ul>
            {props.preview.samples.length > 0 ? (
              <details>
                <summary>{t("settings.yourData.previewSamples")}</summary>
                <ul>
                  {props.preview.samples.map((sample, index) => (
                    <li key={`${sample.section}-${index}`}>
                      {sample.title} - {sample.outcome}
                      {sample.playlist ? ` (${sample.playlist})` : ""}
                      {sample.candidates.length > 0 ? `: ${sample.candidates.join("; ")}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="hint">{t("settings.yourData.confirmNote")}</p>
            <div className="connection-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={props.importBusy || props.result !== null}
                onClick={props.onApply}
              >
                {t("settings.yourData.applyButton")}
              </button>
            </div>
          </div>
        ) : null}

        {props.result ? (
          <div data-testid="import-result" aria-live="polite">
            <p className={props.result.completed ? "muted" : "error-text"} role="status">
              {props.result.completed
                ? t("settings.yourData.resultDone", {
                    added: String(props.result.progress_added + props.result.progress_updated),
                    items: String(props.result.playlist_items_added),
                  })
                : t("settings.yourData.resultFailed", {
                    failure: props.result.failure ?? "",
                  })}
            </p>
            {props.result.unmatched_total > 0 ? (
              <div className="connection-actions">
                <button type="button" className="btn btn-secondary" onClick={props.onDownloadUnmatched}>
                  {t("settings.yourData.downloadUnmatched", {
                    count: String(props.result.unmatched_total),
                  })}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function errorText(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? describeApiError(error) : String(error);
}

export function SettingsYourDataPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.yourData.documentTitle"));
  const client = usePrimaryApiClient();
  const { showToast } = useToast();
  const [exportJob, setExportJob] = useState<UserDataExportJob | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [includePreferences, setIncludePreferences] = useState(false);
  const [conflicts, setConflicts] = useState<UserDataProgressConflicts>("newest");
  const [preview, setPreview] = useState<UserDataImportPreview | null>(null);
  const [result, setResult] = useState<UserDataImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const pollRef = useRef(0);
  const fileTransferAvailable =
    !usesTenFootChrome(PLAYARR_CLIENT_PLATFORM) && typeof File !== "undefined";

  useEffect(() => () => void (pollRef.current += 1), []);

  const poll = useCallback(
    async (id: string, ticket: number) => {
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
        if (pollRef.current !== ticket) return;
        try {
          const job = await client.getUserDataExport(id);
          if (pollRef.current !== ticket) return;
          setExportJob(job);
          if (job.status !== "queued" && job.status !== "running") return;
        } catch (error) {
          if (pollRef.current === ticket) setExportError(errorText(error));
          return;
        }
      }
    },
    [client]
  );

  async function startExport() {
    const ticket = ++pollRef.current;
    setExportBusy(true);
    setExportError(null);
    try {
      const job = await client.startUserDataExport();
      setExportJob(job);
      if (job.status === "queued" || job.status === "running") void poll(job.id, ticket);
    } catch (error) {
      setExportError(errorText(error));
    } finally {
      setExportBusy(false);
    }
  }

  async function downloadExport() {
    if (!exportJob) return;
    try {
      const blob = await client.downloadUserDataExport(exportJob.id);
      saveBlob(blob, `playarr-user-data-${new Date().toISOString().slice(0, 10)}.zip`);
      showToast(t("settings.yourData.toastDownloaded"));
    } catch (error) {
      setExportError(errorText(error));
    }
  }

  function chooseFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setResult(null);
    setImportError(null);
  }

  async function runPreview() {
    if (!file) return;
    setImportBusy(true);
    setImportError(null);
    setResult(null);
    try {
      setPreview(await client.previewUserDataImport(file, { includePreferences, progressConflicts: conflicts }));
    } catch (error) {
      setPreview(null);
      setImportError(errorText(error));
    } finally {
      setImportBusy(false);
    }
  }

  async function applyImport() {
    if (!file || !preview) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const applied = await client.applyUserDataImport(file, preview.package_sha256, {
        includePreferences,
        progressConflicts: conflicts,
      });
      setResult(applied);
      if (applied.completed) showToast(t("settings.yourData.toastImported"));
    } catch (error) {
      setImportError(errorText(error));
    } finally {
      setImportBusy(false);
    }
  }

  async function downloadUnmatched() {
    if (!file) return;
    try {
      const blob = await client.downloadUnmatchedUserData(file, { progressConflicts: conflicts });
      saveBlob(blob, "playarr-unmatched.zip");
    } catch (error) {
      setImportError(errorText(error));
    }
  }

  return (
    <SettingsSectionLayout
      kicker={t("settings.yourData.kicker")}
      title={t("settings.yourData.title")}
      description={t("settings.yourData.description")}
    >
      <YourDataView
        t={t}
        fileTransferAvailable={fileTransferAvailable}
        exportJob={exportJob}
        exportBusy={exportBusy}
        exportError={exportError}
        onStartExport={() => void startExport()}
        onDownloadExport={() => void downloadExport()}
        file={file}
        onChooseFile={chooseFile}
        includePreferences={includePreferences}
        onIncludePreferences={(value) => {
          setIncludePreferences(value);
          setPreview(null);
          setResult(null);
        }}
        conflicts={conflicts}
        onConflicts={(value) => {
          setConflicts(value);
          setPreview(null);
          setResult(null);
        }}
        preview={preview}
        result={result}
        importBusy={importBusy}
        importError={importError}
        onPreview={() => void runPreview()}
        onApply={() => void applyImport()}
        onDownloadUnmatched={() => void downloadUnmatched()}
      />
    </SettingsSectionLayout>
  );
}
