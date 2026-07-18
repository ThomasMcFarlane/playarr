import { Link } from "react-router-dom";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useNavigationLayer } from "../../lib/navigationLayer";
import { useLanguage } from "../../lib/i18n/LanguageProvider";

interface SettingsSection {
  to: string;
  number: string;
  title: string;
  description: string;
  wide?: boolean;
}

type TFunction = ReturnType<typeof useLanguage>["t"];

function buildSettingsSections(t: TFunction): readonly SettingsSection[] {
  return [
    {
      to: "/settings/appearance",
      number: "01",
      title: t("settings.index.appearance.title"),
      description: t("settings.index.appearance.description"),
    },
    {
      to: "/settings/language",
      number: "02",
      title: t("settings.index.language.title"),
      description: t("settings.index.language.description"),
    },
    {
      to: "/settings/player",
      number: "03",
      title: t("settings.index.player.title"),
      description: t("settings.index.player.description"),
    },
    {
      to: "/settings/server",
      number: "04",
      title: t("settings.index.server.title"),
      description: t("settings.index.server.description"),
      wide: true,
    },
    {
      to: "/settings/profile-lock",
      number: "05",
      title: t("settings.index.profileLock.title"),
      description: t("settings.index.profileLock.description"),
    },
    {
      to: "/settings/invite",
      number: "06",
      title: t("settings.index.invite.title"),
      description: t("settings.index.invite.description"),
    },
    {
      to: "/settings/account",
      number: "07",
      title: t("settings.index.account.title"),
      description: t("settings.index.account.description"),
    },
  ] as const;
}

/**
 * Settings hub -- a menu of the sections that used to be stacked as one long
 * scroll (see git history for the previous single-page `pages/Settings.tsx`).
 * Split so a remote's Down arrow moves through a handful of focusable items
 * per screen instead of every control on every section at once; each card
 * links to its own route under `pages/settings/`, reached exactly the way
 * `Profiles.tsx`'s gear icon already reached `/settings` before this split.
 */
export function SettingsIndexPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.index.documentTitle"));
  const navigationLayer = useNavigationLayer("settings:index");
  const settingsSections = buildSettingsSections(t);

  return (
    <div className="page settings-page">
      <div className="page-intro">
        <p className="page-kicker">{t("settings.index.kicker")}</p>
        <h1 className="page-title">{t("settings.index.title")}</h1>
        <p className="page-description">{t("settings.index.description")}</p>
      </div>

      <nav className="settings-grid" aria-label={t("settings.index.sectionsAriaLabel")}>
        {settingsSections.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className={`settings-card settings-nav-card${section.wide ? " settings-card-wide" : ""}`}
            state={{ backTo: "/settings", navigationOrigin: navigationLayer.origin }}
            onClick={navigationLayer.captureLink}
            data-navigation-focus-key={`settings:${section.number}`}
          >
            <div className="settings-card-heading">
              <span className="settings-card-number">{section.number}</span>
              <div>
                <h2 className="section-title">{section.title}</h2>
                <p className="muted">{section.description}</p>
              </div>
            </div>
            <span className="settings-nav-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
