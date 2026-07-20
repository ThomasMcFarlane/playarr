import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { DownloadKeepUntilPolicy } from "../lib/downloadsDb";
import {
  KeepUntilPicker,
  keepUntilPolicyFromState,
  keepUntilStateFromPolicy,
  type KeepUntilState,
} from "./KeepUntilPicker";

/**
 * Lightweight edit-only counterpart to `DownloadQualityDrawer` -- reuses its
 * `KeepUntilPicker` section and dialog chrome, but skips the quality picker
 * entirely since an existing download's quality can't be changed after the
 * fact (only its retention policy can).
 */
export function EditKeepUntilDrawer({
  title,
  keepUntil,
  onClose,
  onConfirm,
  busy = false,
}: {
  title: string;
  keepUntil: DownloadKeepUntilPolicy;
  onClose: () => void;
  onConfirm: (keepUntil: DownloadKeepUntilPolicy) => void;
  busy?: boolean;
}) {
  const { t } = useLanguage();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<KeepUntilState>(() => keepUntilStateFromPolicy(keepUntil));

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

  return (
    <aside
      className="tv-filter-drawer tv-playback-settings-drawer download-quality-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={t("pages.downloads.editKeepUntilDialogLabel", { title })}
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

      <KeepUntilPicker state={state} onChange={setState} />

      <div className="tv-playback-settings-actions">
        <button type="button" onClick={onClose} disabled={busy}>
          {t("components.downloadQualityDrawer.cancel")}
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={busy}
          onClick={() => onConfirm(keepUntilPolicyFromState(state))}
        >
          {t("pages.downloads.save")}
        </button>
      </div>
    </aside>
  );
}
