import { Drawer } from "./shell";
import { useEffect, useRef, useState } from "react";
import { describeApiError, type DownloadOptionsResponse } from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { formatBytes, formatEstimatedBytes } from "../lib/formatBytes";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { DownloadKeepUntilPolicy } from "../lib/downloadsDb";
import { SegmentedControl, Select } from "./ui";
import { TvEmptyState } from "./tv/TvEmptyState";
import type { PlayableLeaf } from "../lib/playableLeaves";
import {
  defaultKeepUntilDate,
  KeepUntilPicker,
  keepUntilPolicyFromState,
  type KeepUntilState,
} from "./KeepUntilPicker";

type OptionsState =
  | { status: "loading" }
  | { status: "ready"; options: DownloadOptionsResponse }
  | { status: "error"; message: string };

export interface DownloadQualitySelection {
  qualityId: string;
  qualityLabel: string;
  keepUntil: DownloadKeepUntilPolicy;
  /** The leaves of the chosen scope (this episode, the season). */
  leaves: PlayableLeaf[];
}

/** One answer to "what should be downloaded?" -- shown as a segmented control when there is more than one. */
export interface DownloadScope {
  id: "episode" | "season";
  leaves: PlayableLeaf[];
}

/**
 * Quality + keep-until picker for a download, shared by
 * `MediaContextMenu`'s "Download" action and `WorkDetail`'s detail-action
 * Download button. Visually modelled on `WorkDetail.tsx`'s
 * `MoviePlaybackSettingsDrawer` (`tv-filter-drawer`/`tv-filter-choice-grid`)
 * -- same dialog chrome, same Escape/back-key handling.
 *
 * `leaves.length > 1` (a container fan-out -- a season, series, artist,
 * album, playlist...) fetches quality *options* from just the first leaf
 * (transcode profiles are global server config, not per-file, so the
 * available ids/labels are the same for every leaf) but shows a per-item
 * size instead of fetching + summing every leaf's real number -- an
 * N-file container would otherwise mean an N-request drawer open. The
 * `~` estimate marker already applies to every non-original option, so a
 * "per item" aggregate stays honest about what's known versus estimated.
 */
export function DownloadQualityDrawer({
  title,
  leaves: defaultLeaves,
  scopes,
  onClose,
  onConfirm,
  confirmLabel,
  busy = false,
}: {
  title: string;
  leaves: PlayableLeaf[];
  /** Optional wider scopes for an episode; the first is the default. When omitted `leaves` is the only scope. */
  scopes?: DownloadScope[];
  onClose: () => void;
  onConfirm: (selection: DownloadQualitySelection) => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const { t } = useLanguage();
  const client = useApiClient();
  const [state, setState] = useState<OptionsState>({ status: "loading" });
  const [qualityId, setQualityId] = useState("original");
  const [keepUntil, setKeepUntil] = useState<KeepUntilState>({
    kind: "forever",
    date: defaultKeepUntilDate(),
    amount: 30,
    unit: "days",
  });

  const [scopeId, setScopeId] = useState<DownloadScope["id"]>(scopes?.[0]?.id ?? "episode");
  const leaves = scopes?.find((scope) => scope.id === scopeId)?.leaves ?? defaultLeaves;
  const firstLeaf = defaultLeaves[0];

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    if (!firstLeaf) {
      setState({ status: "error", message: t("components.downloadQualityDrawer.noPlayableMedia") });
      return;
    }
    client
      .getDownloadOptions(firstLeaf.mediaFileId)
      .then((options) => {
        if (cancelled) return;
        setState({ status: "ready", options });
        setQualityId(options.options[0]?.id ?? "original");
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: describeApiError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, firstLeaf, t]);

  const options = state.status === "ready" ? state.options.options : [];
  const selectedOption = options.find((option) => option.id === qualityId);
  const isBatch = leaves.length > 1;

  function confirm() {
    if (!selectedOption) return;
    onConfirm({
      qualityId: selectedOption.id,
      qualityLabel: selectedOption.label,
      keepUntil: keepUntilPolicyFromState(keepUntil),
      leaves,
    });
  }

  return (
    <Drawer
      className="tv-playback-settings-drawer download-quality-drawer"
      ariaLabel={t("components.downloadQualityDrawer.dialogLabel", { title })}
      kicker={t("components.downloadQualityDrawer.kicker")}
      title={title}
      closeLabel={t("components.downloadQualityDrawer.close")}
      onClose={onClose}
    >

      {state.status === "loading" ? (
        <div className="tv-playback-settings-status" role="status">
          <span className="tv-mini-loader" aria-hidden="true" />
          <p>{t("components.downloadQualityDrawer.loadingOptions")}</p>
        </div>
      ) : state.status === "error" ? (
        <TvEmptyState
          graphic="details"
          tone="error"
          variant="compact"
          title={t("components.downloadQualityDrawer.loadError")}
          description={state.message}
        />
      ) : (
        <>
          {scopes && scopes.length > 1 ? (
            <section>
              <h3>{t("components.downloadQualityDrawer.scopeHeading")}</h3>
              <SegmentedControl
                ariaLabel={t("components.downloadQualityDrawer.scopeHeading")}
                value={scopeId}
                onChange={setScopeId}
                options={scopes.map((scope) => ({
                  value: scope.id,
                  label: t(`components.downloadQualityDrawer.scope.${scope.id}`, { count: scope.leaves.length }),
                }))}
              />
            </section>
          ) : null}

          <section>
            <h3>{t("components.downloadQualityDrawer.qualityHeading")}</h3>
            <Select
              ariaLabel={t("components.downloadQualityDrawer.qualityHeading")}
              value={qualityId}
              onChange={setQualityId}
              options={options.map((option) => {
                const sizeLabel = option.size_is_estimate
                  ? formatEstimatedBytes(option.estimated_size_bytes)
                  : formatBytes(option.estimated_size_bytes);
                return {
                  value: option.id,
                  label: option.label,
                  hint: isBatch
                    ? t("components.downloadQualityDrawer.perItemSize", { size: sizeLabel, count: leaves.length })
                    : sizeLabel,
                };
              })}
            />
          </section>

          <KeepUntilPicker state={keepUntil} onChange={setKeepUntil} />

          <div className="tv-playback-settings-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              {t("components.downloadQualityDrawer.cancel")}
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={busy || !selectedOption}
              onClick={confirm}
            >
              {busy
                ? t("components.downloadQualityDrawer.downloading")
                : isBatch && scopes
                  ? t("components.mediaContextMenu.downloadCount", { count: leaves.length })
                  : (confirmLabel ?? t("components.downloadQualityDrawer.download"))}
            </button>
          </div>
        </>
      )}
    </Drawer>
  );
}
