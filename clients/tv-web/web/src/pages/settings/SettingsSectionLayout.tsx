import type { ReactNode } from "react";

/** Shared content chrome rendered beneath the settings shell heading. */
export function SettingsSectionLayout({
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-section">
      <div className="settings-section-content">{children}</div>
    </div>
  );
}
