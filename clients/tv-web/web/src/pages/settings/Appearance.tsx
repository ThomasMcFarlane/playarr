import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useTheme, type ThemePreference } from "../../lib/theme";
import { useToast } from "../../lib/toast";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { useHomeView, type HomeViewPreference } from "../../lib/homeView";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark"];
const HOME_VIEW_OPTIONS: HomeViewPreference[] = ["thumbnail", "cover"];

export function SettingsAppearancePage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.appearance.documentTitle"));
  const { preference, setPreference } = useTheme();
  const { preference: homeView, setPreference: setHomeView } = useHomeView();
  const { showToast } = useToast();

  return (
    <SettingsSectionLayout>
      <section className="card settings-card settings-card-wide">
        <div className="appearance-setting">
          <div className="appearance-setting-heading">
            <h3>{t("settings.appearance.colourThemeLabel")}</h3>
          </div>
          <div
            className="theme-choice"
            role="group"
            aria-label={t("settings.appearance.colourThemeLabel")}
          >
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
        </div>

        <div className="appearance-setting">
          <div className="appearance-setting-heading">
            <h3>{t("settings.appearance.homeViewTitle")}</h3>
            <p>{t("settings.appearance.homeViewDescription")}</p>
          </div>
          <div
            className="theme-choice home-view-choice"
            role="group"
            aria-label={t("settings.appearance.homeViewAriaLabel")}
          >
            {HOME_VIEW_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`theme-choice-button${homeView === option ? " is-active" : ""}`}
                onClick={() => {
                  if (option === homeView) return;
                  setHomeView(option);
                  showToast(t("settings.appearance.homeViewSaved"));
                }}
                aria-pressed={homeView === option}
              >
                {option === "cover"
                  ? t("settings.appearance.homeViewCover")
                  : t("settings.appearance.homeViewThumbnail")}
              </button>
            ))}
          </div>
        </div>
      </section>
    </SettingsSectionLayout>
  );
}
