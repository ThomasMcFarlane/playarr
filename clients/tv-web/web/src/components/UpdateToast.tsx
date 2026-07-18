import type { AppUpdateState } from "../lib/appUpdate";
import { useLanguage } from "../lib/i18n/LanguageProvider";

export interface UpdateToastProps {
  state: AppUpdateState;
}

/**
 * The dismissible "Update available" toast for the Web app's OTA flow (see
 * `lib/appUpdate.ts`). Renders nothing once dismissed or when there is
 * nothing to report. The forced-reload case (`state.mustReload`) doesn't
 * need its own UI here -- `useAppUpdate` triggers that reload itself as
 * soon as it's detected, so by the time this would render, the page is
 * already on its way to a fresh reload.
 */
export function UpdateToast({ state }: UpdateToastProps) {
  const { t } = useLanguage();

  if (!state.updateAvailable) return null;

  return (
    <div role="status" className="update-toast">
      <span>{t("components.updateToast.updateAvailable")}</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={state.reloadNow}>
        {t("components.updateToast.reload")}
      </button>
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
