import type { ReactNode } from "react";

/** Shared content chrome rendered beneath the settings shell heading (the heading carries the section title). */
export function SettingsSectionLayout({ children }: { children: ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-content">{children}</div>
    </div>
  );
}
