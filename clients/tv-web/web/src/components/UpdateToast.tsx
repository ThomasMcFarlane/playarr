import type { AppUpdateState } from "../lib/appUpdate";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { Button } from "./ui";

export interface UpdateToastProps {
  state: AppUpdateState;
}

/**
 * The dismissible "Update available" toast for the Web app's OTA flow (see
 * `lib/appUpdate.ts`). Renders nothing once dismissed or when there is
 * nothing to report. Hosted Web builds force-reload when their compatibility
 * floor requires it; immutable webOS/Tizen packages instead get a persistent
 * reinstall notice because reloading cannot change their bundled version.
 */
export function UpdateToast({ state }: UpdateToastProps) {
  const { t } = useLanguage();

  if (state.packageUpdateRequired) {
    return (
      <div role="alert" className="update-toast">
        <span>{t("components.updateToast.packageUpdateRequired")}</span>
      </div>
    );
  }

  if (!state.updateAvailable) return null;

  return (
    <div role="status" className="update-toast">
      <span>{t("components.updateToast.updateAvailable")}</span>
      <Button type="button" variant="primary" size="sm" onClick={state.reloadNow}>
        {t("components.updateToast.reload")}
      </Button>
      <button
        type="button"
        className="update-toast-dismiss"
        onClick={state.dismiss}
        aria-label={t("components.updateToast.dismiss")}
      >
        &times;
      </button>
    </div>
  );
}
