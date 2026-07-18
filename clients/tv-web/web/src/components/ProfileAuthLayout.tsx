import type { ReactNode } from "react";
import { useTvDirectionalNavigation } from "../lib/useTvNavigation";
import { TvStageChrome } from "./tv/TvStage";

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

  return (
    <div
      className={`profiles-page profile-auth-page${
        transitionFromProfiles ? " is-profile-transition" : ""
      }${className ? ` ${className}` : ""}`}
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
