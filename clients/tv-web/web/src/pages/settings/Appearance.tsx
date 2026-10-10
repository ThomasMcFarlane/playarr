import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useTheme, type ThemePreference } from "../../lib/theme";
import { useToast } from "../../lib/toast";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { useHomeView, type HomeViewPreference } from "../../lib/homeView";
import { ARTWORK_SIZES, useArtworkSize } from "../../lib/artworkSize";
import { SegmentedControl } from "../../components/ui";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark"];
const HOME_VIEW_OPTIONS: HomeViewPreference[] = ["thumbnail", "cover"];

export function SettingsAppearancePage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.appearance.documentTitle"));
  const { preference, setPreference } = useTheme();
  const { preference: homeView, setPreference: setHomeView } = useHomeView();
  const { size: artworkSize, setSize: setArtworkSize } = useArtworkSize();
  const { showToast } = useToast();

  return (
    <SettingsSectionLayout>
      <section className="card settings-card settings-card-wide">
        <div className="appearance-setting">
          <div className="appearance-setting-heading">
            <h3>{t("settings.appearance.colourThemeLabel")}</h3>
          </div>
          <SegmentedControl
            ariaLabel={t("settings.appearance.colourThemeLabel")}
            value={preference}
            options={THEME_OPTIONS.map((option) => ({ value: option, label: option }))}
            onChange={(option) => {
              if (option === preference) return;
              setPreference(option);
              showToast(t("settings.appearance.themeSaved"));
            }}
          />
        </div>

        <div className="appearance-setting">
          <div className="appearance-setting-heading">
            <h3>{t("settings.appearance.homeViewTitle")}</h3>
            <p>{t("settings.appearance.homeViewDescription")}</p>
          </div>
          <SegmentedControl
            ariaLabel={t("settings.appearance.homeViewAriaLabel")}
            value={homeView}
            options={HOME_VIEW_OPTIONS.map((option) => ({
              value: option,
              label:
                option === "cover"
                  ? t("settings.appearance.homeViewCover")
                  : t("settings.appearance.homeViewThumbnail"),
            }))}
            onChange={(option) => {
              if (option === homeView) return;
              setHomeView(option);
              showToast(t("settings.appearance.homeViewSaved"));
            }}
          />
        </div>

        <div className="appearance-setting">
          <div className="appearance-setting-heading">
            <h3>{t("settings.appearance.artworkSizeTitle")}</h3>
            <p>{t("settings.appearance.artworkSizeDescription")}</p>
          </div>
          <SegmentedControl
            className="artwork-size-choice"
            ariaLabel={t("settings.appearance.artworkSizeAriaLabel")}
            value={artworkSize}
            options={ARTWORK_SIZES.map((option) => ({
              value: option,
              label:
                option === "small"
                  ? t("pages.library.sizeSmall")
                  : option === "large"
                    ? t("pages.library.sizeLarge")
                    : t("pages.library.sizeMedium"),
            }))}
            onChange={(option) => {
              if (option === artworkSize) return;
              setArtworkSize(option);
              showToast(t("settings.appearance.artworkSizeSaved"));
            }}
          />
        </div>
      </section>
    </SettingsSectionLayout>
  );
}
