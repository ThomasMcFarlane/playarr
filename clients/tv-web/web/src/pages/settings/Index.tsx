import { Link } from "react-router-dom";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useNavigationLayer } from "../../lib/navigationLayer";

interface SettingsSection {
  to: string;
  number: string;
  title: string;
  description: string;
  wide?: boolean;
}

const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    to: "/settings/appearance",
    number: "01",
    title: "Appearance",
    description: "Follow this device or keep a theme fixed.",
  },
  {
    to: "/settings/player",
    number: "02",
    title: "Player",
    description: "Choose the audio language Playarr should prioritise.",
  },
  {
    to: "/settings/server",
    number: "03",
    title: "Server connection",
    description: "Combine libraries from multiple servers in one Playarr interface.",
    wide: true,
  },
  {
    to: "/settings/profile-lock",
    number: "04",
    title: "Profile lock",
    description: "Require a four-digit PIN before switching profiles.",
  },
  {
    to: "/settings/invite",
    number: "05",
    title: "Invite a friend",
    description: "Ask your Streamarr admin for one friend-invite QR code.",
  },
  {
    to: "/settings/account",
    number: "06",
    title: "Account",
    description: "End this browser session and return to sign in.",
  },
] as const;

/**
 * Settings hub -- a menu of the sections that used to be stacked as one long
 * scroll (see git history for the previous single-page `pages/Settings.tsx`).
 * Split so a remote's Down arrow moves through a handful of focusable items
 * per screen instead of every control on every section at once; each card
 * links to its own route under `pages/settings/`, reached exactly the way
 * `Profiles.tsx`'s gear icon already reached `/settings` before this split.
 */
export function SettingsIndexPage() {
  useDocumentTitle("Settings");
  const navigationLayer = useNavigationLayer("settings:index");

  return (
    <div className="page settings-page">
      <div className="page-intro">
        <p className="page-kicker">Make it yours</p>
        <h1 className="page-title">Preferences</h1>
        <p className="page-description">Choose how Playarr looks and where it connects.</p>
      </div>

      <nav className="settings-grid" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((section) => (
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
