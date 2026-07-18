import type { ReactNode } from "react";

/** Shared heading and content chrome rendered inside the settings detail panel. */
export function SettingsSectionLayout({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-section">
      <div className="page-intro settings-section-intro">
        <p className="page-kicker">{kicker}</p>
        <h2 className="page-title">{title}</h2>
        <p className="page-description">{description}</p>
      </div>

      <div className="settings-section-content">{children}</div>
    </div>
  );
}
