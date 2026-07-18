import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

export function SettingsAccountPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.account.documentTitle"));
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <SettingsSectionLayout
      kicker={t("settings.account.kicker")}
      title={t("settings.account.title")}
      description={t("settings.account.description")}
    >
      <section className="card settings-card settings-card-wide">
        <button type="button" className="btn btn-danger" onClick={handleSignOut}>
          {t("settings.account.signOut")}
        </button>
      </section>
    </SettingsSectionLayout>
  );
}
