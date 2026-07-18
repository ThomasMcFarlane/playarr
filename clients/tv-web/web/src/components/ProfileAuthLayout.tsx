import type { KeyboardEvent, ReactNode } from "react";
import { useTvDirectionalNavigation } from "../lib/useTvNavigation";
import { TvStageChrome } from "./tv/TvStage";

type AuthFocusRegion = "language" | "first-field" | "other";

export function authFocusBridgeDestination(
  key: string,
  region: AuthFocusRegion,
  languageExpanded: boolean
): Exclude<AuthFocusRegion, "other"> | null {
  if (key === "ArrowUp" && region === "first-field") return "language";
  if (key === "ArrowDown" && region === "language" && !languageExpanded) {
    return "first-field";
  }
  return null;
}

interface ProfileAuthLayoutProps {
  backLabel?: string;
  children: ReactNode;
  className?: string;
  onBack?: () => void;
  transitionFromProfiles?: boolean;
}

export function ProfileAuthLayout({
  backLabel,
  children,
  className = "",
  onBack,
  transitionFromProfiles = false,
}: ProfileAuthLayoutProps) {
  useTvDirectionalNavigation();

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const languageTrigger = event.currentTarget.querySelector<HTMLButtonElement>(
      ".tv-stage-chrome-language .language-dropdown-trigger"
    );
    const firstField = event.currentTarget.querySelector<HTMLInputElement>(
      '.profile-auth-panel input:not(:disabled):not([tabindex="-1"])'
    );
    if (!languageTrigger || !firstField) return;

    const region: AuthFocusRegion =
      event.target === languageTrigger
        ? "language"
        : event.target === firstField
          ? "first-field"
          : "other";
    const destination = authFocusBridgeDestination(
      event.key,
      region,
      languageTrigger.getAttribute("aria-expanded") === "true"
    );
    if (!destination) return;

    event.preventDefault();
    event.stopPropagation();
    (destination === "language" ? languageTrigger : firstField).focus({
      preventScroll: true,
    });
  }

  return (
    <div
      className={`profiles-page profile-auth-page${
        transitionFromProfiles ? " is-profile-transition" : ""
      }${className ? ` ${className}` : ""}`}
      onKeyDownCapture={handleKeyDown}
    >
      <TvStageChrome backLabel={backLabel} onBack={onBack} />
      <main
        className="profile-auth-scroll"
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key="auth:fields"
      >
        <section className="profile-auth-panel">{children}</section>
      </main>
    </div>
  );
}
