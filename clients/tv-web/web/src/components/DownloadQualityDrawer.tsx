import { useEffect, useRef, useState } from "react";
import { describeApiError, type DownloadOptionsResponse } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { formatBytes, formatEstimatedBytes } from "../lib/formatBytes";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { DownloadKeepUntilPolicy } from "../lib/downloadsDb";
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
  leaves,
  onClose,
  onConfirm,
  confirmLabel,
  busy = false,
}: {
  title: string;
  leaves: PlayableLeaf[];
  onClose: () => void;
  onConfirm: (selection: DownloadQualitySelection) => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const { t } = useLanguage();
  const client = useApiClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<OptionsState>({ status: "loading" });
  const [qualityId, setQualityId] = useState("original");
  const [keepUntil, setKeepUntil] = useState<KeepUntilState>({
    kind: "forever",
    date: defaultKeepUntilDate(),
    amount: 30,
    unit: "days",
  });

  const firstLeaf = leaves[0];

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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const handleBack = (event: KeyboardEvent) => {
      const isBack =
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.key === "GoBack" ||
        event.keyCode === 10009 ||
        event.keyCode === 461;
      if (!isBack) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleBack, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleBack, true);
    };
  }, [onClose]);

  const options = state.status === "ready" ? state.options.options : [];
  const selectedOption = options.find((option) => option.id === qualityId);
  const isBatch = leaves.length > 1;

  function confirm() {
    if (!selectedOption) return;
    onConfirm({
      qualityId: selectedOption.id,
      qualityLabel: selectedOption.label,
      keepUntil: keepUntilPolicyFromState(keepUntil),
    });
  }

  return (
    <aside
      className="tv-filter-drawer tv-playback-settings-drawer download-quality-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={t("components.downloadQualityDrawer.dialogLabel", { title })}
    >
      <header>
        <div>
          <p>{t("components.downloadQualityDrawer.kicker")}</p>
          <h2>{title}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("components.downloadQualityDrawer.close")}
        >
          ×
        </button>
      </header>

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
          <section>
            <h3>{t("components.downloadQualityDrawer.qualityHeading")}</h3>
            <div className="tv-filter-choice-grid tv-playback-settings-options">
              {options.map((option) => {
                const selected = option.id === qualityId;
                const sizeLabel = option.size_is_estimate
                  ? formatEstimatedBytes(option.estimated_size_bytes)
                  : formatBytes(option.estimated_size_bytes);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? "is-active" : ""}
                    onClick={() => setQualityId(option.id)}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>
                        {isBatch
                          ? t("components.downloadQualityDrawer.perItemSize", {
                              size: sizeLabel,
                              count: leaves.length,
                            })
                          : sizeLabel}
                      </small>
                    </span>
                    <i aria-hidden="true">{selected ? "✓" : ""}</i>
                  </button>
                );
              })}
            </div>
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
                : (confirmLabel ?? t("components.downloadQualityDrawer.download"))}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
