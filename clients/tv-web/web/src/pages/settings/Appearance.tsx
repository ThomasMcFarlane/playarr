import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useTheme, type ThemePreference } from "../../lib/theme";
import { useToast } from "../../lib/toast";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark"];

export function SettingsAppearancePage() {
  useDocumentTitle("Appearance — Settings");
  const { preference, setPreference } = useTheme();
  const { showToast } = useToast();

  return (
    <SettingsSectionLayout
      kicker="Make it yours"
      title="Appearance"
      description="Follow this device or keep a theme fixed."
    >
      <section className="card settings-card settings-card-wide">
        <div className="theme-choice" role="group" aria-label="Colour theme">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`theme-choice-button${preference === option ? " is-active" : ""}`}
              onClick={() => {
                if (option === preference) return;
                setPreference(option);
                showToast("Theme preference saved.");
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
