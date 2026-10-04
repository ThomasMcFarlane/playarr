import { Drawer } from "./shell";
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
  const [state, setState] = useState<KeepUntilState>(() => keepUntilStateFromPolicy(keepUntil));

  return (
    <Drawer
      className="tv-playback-settings-drawer download-quality-drawer"
      ariaLabel={t("pages.downloads.editKeepUntilDialogLabel", { title })}
      kicker={t("components.downloadQualityDrawer.kicker")}
      title={title}
      closeLabel={t("components.downloadQualityDrawer.close")}
      onClose={onClose}
    >

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
    </Drawer>
  );
}
