import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useTheme, type ThemePreference } from "../../lib/theme";
import { useToast } from "../../lib/toast";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark"];

export function SettingsAppearancePage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.appearance.documentTitle"));
  const { preference, setPreference } = useTheme();
  const { showToast } = useToast();

  return (
    <SettingsSectionLayout
      kicker={t("settings.appearance.kicker")}
      title={t("settings.appearance.title")}
      description={t("settings.appearance.description")}
    >
      <section className="card settings-card settings-card-wide">
        <div className="theme-choice" role="group" aria-label={t("settings.appearance.colourThemeLabel")}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`theme-choice-button${preference === option ? " is-active" : ""}`}
              onClick={() => {
                if (option === preference) return;
                setPreference(option);
                showToast(t("settings.appearance.themeSaved"));
              }}
              aria-pressed={preference === option}
            >
              {option}
            </button>
          ))}
        </div>
      </section>
    </SettingsSectionLayout>
  );
}
