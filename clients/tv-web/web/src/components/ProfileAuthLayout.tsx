import type { ReactNode } from "react";

interface ProfilePageHeaderProps {
  backLabel?: string;
  onBack?: () => void;
}

export function ProfilePageHeader({ backLabel, onBack }: ProfilePageHeaderProps) {
  return (
    <header className="profile-page-header">
      <span className="profile-page-logo" aria-hidden="true">
        <img className="app-logo-icon" src="/playarr-icon.svg" alt="" />
      </span>
      {backLabel && onBack ? (
        <button
          type="button"
          className="tv-back profile-page-back"
          aria-label={backLabel}
          onClick={onBack}
        >
          ←
        </button>
      ) : null}
    </header>
  );
}

interface ProfileAuthLayoutProps extends ProfilePageHeaderProps {
  children: ReactNode;
  className?: string;
  transitionFromProfiles?: boolean;
}

export function ProfileAuthLayout({
  backLabel,
  children,
  className = "",
  onBack,
  transitionFromProfiles = false,
}: ProfileAuthLayoutProps) {
  return (
    <div
      className={`profiles-page profile-auth-page${
        transitionFromProfiles ? " is-profile-transition" : ""
      }${className ? ` ${className}` : ""}`}
    >
      <ProfilePageHeader backLabel={backLabel} onBack={onBack} />
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
