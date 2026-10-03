import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UserDataExportJob, UserDataImportPreview } from "@playarr-tv/api-client";
import { LanguageProvider, useLanguage } from "../../lib/i18n/LanguageProvider";
import { YourDataView, type YourDataViewProps } from "./YourData";

const noop = () => undefined;

function job(status: UserDataExportJob["status"]): UserDataExportJob {
  return {
    id: "abc",
    status,
    created_at: "2026-10-03T12:00:00Z",
    expires_at: "2026-10-03T12:30:00Z",
    progress: { stage: "watch_progress", done: 1, total: 2 },
    counts: { watch_progress: 4, playback_preferences: 0, playlists: 2, playlist_items: 5, skipped: 0 },
    size_bytes: 2048,
    download_url: status === "ready" ? "/api/v1/users/me/data-exports/abc/download" : null,
    error: null,
  };
}

const PREVIEW: UserDataImportPreview = {
  package_sha256: "f00",
  schema_version: 1,
  generated_at: "2026-10-03T12:00:00Z",
  source_instance_name: "Elsewhere",
  summary: {
    watch_progress: {
      total: 5,
      will_add: 3,
      will_update: 1,
      already_present: 0,
      conflicts_kept: 0,
      unmatched: 1,
      ambiguous: 0,
    },
    playlists: { total: 1, new: 1, existing: 0, items_total: 2, items_to_add: 2, items_already_present: 0, items_unmatched: 0 },
    preferred_audio_language_change: null,
    playback_preferences_not_applied: 2,
    unmatched_total: 1,
  },
  samples: [{ section: "watch_progress", title: "<b>Evil</b>", outcome: "no_match", playlist: null, candidates: [] }],
  warnings: [],
};

function View(overrides: Partial<YourDataViewProps>) {
  const { t } = useLanguage();
  return (
    <YourDataView
      t={t}
      fileTransferAvailable
      exportJob={null}
      exportBusy={false}
      exportError={null}
      onStartExport={noop}
      onDownloadExport={noop}
      file={null}
      onChooseFile={noop}
      includePreferences={false}
      onIncludePreferences={noop}
      conflicts="newest"
      onConflicts={noop}
      preview={null}
      result={null}
      importBusy={false}
      importError={null}
      onPreview={noop}
      onApply={noop}
      onDownloadUnmatched={noop}
      {...overrides}
    />
  );
}

function render(overrides: Partial<YourDataViewProps> = {}) {
  return renderToStaticMarkup(
    <LanguageProvider>
      <View {...overrides} />
    </LanguageProvider>
  );
}

describe("YourDataView", () => {
  it("states the scope of an export and offers no download before it is ready", () => {
    const markup = render();
    expect(markup).toContain("only this profile");
    expect(markup).toContain("Prepare my data");
    expect(markup).not.toContain(">Download");
  });

  it("offers the download once the export is ready and says when it expires", () => {
    const markup = render({ exportJob: job("ready") });
    expect(markup).toContain("Download");
    expect(markup).toContain("4 watch records and 2 playlists");
    expect(markup).toContain("stops working");
  });

  it("reports an expired export instead of a download", () => {
    const markup = render({ exportJob: job("expired") });
    expect(markup).toContain("expired");
    expect(markup).not.toContain("Download (");
  });

  it("shows the preview, requires an explicit apply step and escapes imported text", () => {
    const markup = render({ preview: PREVIEW });
    expect(markup).toContain("What this import would do");
    expect(markup).toContain("3 new, 1 updated");
    expect(markup).toContain("Apply import");
    expect(markup).toContain("will not be applied");
    expect(markup).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(markup).not.toContain("<b>Evil</b>");
  });

  it("offers the unmatched download after an import", () => {
    const markup = render({
      preview: PREVIEW,
      result: {
        completed: true,
        progress_added: 3,
        progress_updated: 1,
        progress_unchanged: 0,
        progress_conflicts_kept: 0,
        playlists_created: 1,
        playlist_items_added: 2,
        playlist_items_already_present: 0,
        preferred_audio_language_updated: false,
        unmatched_total: 1,
        failure: null,
        sections_not_attempted: [],
      },
    });
    expect(markup).toContain("Import finished");
    expect(markup).toContain("Download 1 unmatched records");
  });

  it("degrades honestly where there is no file picker", () => {
    const markup = render({ fileTransferAvailable: false });
    expect(markup).toContain("needs a file picker");
    expect(markup).not.toContain("Prepare my data");
  });
});
