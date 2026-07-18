import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { LANGUAGE_NAMES } from "../../lib/i18n/languages";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { LanguageDropdown } from "../../components/LanguageDropdown";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

export function SettingsLanguagePage() {
  const { detectedLanguage, t } = useLanguage();
  useDocumentTitle(t("settings.language.title"));
  const { showToast } = useToast();

  return (
    <SettingsSectionLayout
      kicker={t("settings.language.kicker")}
      title={t("settings.language.title")}
      description={t("settings.language.description")}
    >
      <section className="card settings-card settings-card-wide">
        <LanguageDropdown onSelect={() => showToast(t("settings.language.savedToast"))} />
        <p className="hint">
          {t("settings.language.autoHint", { language: LANGUAGE_NAMES[detectedLanguage] })}
        </p>
      </section>
    </SettingsSectionLayout>
  );
}
