import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import {
  navigationOriginFromState,
  useNavigationLayer,
} from "../../lib/navigationLayer";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { TvStageShell } from "../../components/tv/TvStage";

interface SettingsSection {
  to: string;
  number: string;
  title: string;
  description: string;
}

type TFunction = ReturnType<typeof useLanguage>["t"];
const DETAIL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "summary",
].join(",");

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

function keepsHorizontalArrows(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

export function shouldCloseSettingsDetailOnLeft(
  key: string,
  keepsNativeArrow: boolean,
  hasControlToLeft: boolean
): boolean {
  return key === "ArrowLeft" && !keepsNativeArrow && !hasControlToLeft;
}

function hasFocusableControlToLeft(
  panel: HTMLElement,
  current: HTMLElement
): boolean {
  const currentRect = current.getBoundingClientRect();
  const currentCentreX = currentRect.left + currentRect.width / 2;

  return Array.from(
    panel.querySelectorAll<HTMLElement>(DETAIL_FOCUSABLE_SELECTOR)
  ).some((candidate) => {
    if (candidate === current) return false;
    const style = window.getComputedStyle(candidate);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = candidate.getBoundingClientRect();
    const verticalOverlap = Math.max(
      0,
      Math.min(currentRect.bottom, rect.bottom) -
        Math.max(currentRect.top, rect.top)
    );
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left + rect.width / 2 < currentCentreX - 2 &&
      verticalOverlap >= Math.min(currentRect.height, rect.height) * 0.4
    );
  });
}

/**
 * Persistent settings master/detail shell. The route outlet changes inside
 * the right panel while the option list remains mounted, allowing the track
 * to slide left and focus to return to the exact option that opened it.
 */
export function SettingsIndexPage() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationLayer = useNavigationLayer("settings:index");
  const settingsSections = buildSettingsSections(t);
  const activeSection = settingsSections.find(
    (section) => section.to === location.pathname
  );
  const detailOrigin = navigationOriginFromState(location.state);
  const requestedBackTo = (location.state as { backTo?: unknown } | null)?.backTo;
  const pageBackTo = typeof requestedBackTo === "string" ? requestedBackTo : "/";
  const detailPanelRef = useRef<HTMLElement>(null);
  useDocumentTitle(t("settings.index.documentTitle"), !activeSection);

  function closeDetail() {
    if (detailOrigin?.route === "/settings") {
      navigate(-1);
    } else {
      navigate("/settings");
    }
  }

  function leaveSettings() {
    if (activeSection) {
      closeDetail();
    } else if (detailOrigin) {
      navigate(-1);
    } else {
      navigate(pageBackTo);
    }
  }

  function openSection(
    section: SettingsSection,
    target: HTMLElement,
    replace: boolean
  ) {
    const navigationOrigin = activeSection
      ? detailOrigin ?? undefined
      : navigationLayer.capture(target);
    navigate(section.to, {
      replace,
      state: { backTo: "/settings", navigationOrigin },
    });
  }

  function handleOptionKeyDown(
    event: ReactKeyboardEvent<HTMLAnchorElement>,
    section: SettingsSection
  ) {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    openSection(section, event.currentTarget, Boolean(activeSection));
  }

  function handleOptionClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (!activeSection) navigationLayer.capture(event.currentTarget);
  }

  function handleDetailKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const hasControlToLeft = Boolean(
      event.target instanceof HTMLElement &&
      detailPanelRef.current &&
      hasFocusableControlToLeft(detailPanelRef.current, event.target)
    );
    if (
      !shouldCloseSettingsDetailOnLeft(
        event.key,
        keepsHorizontalArrows(event.target),
        hasControlToLeft
      )
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeDetail();
  }

  useEffect(() => {
    if (!activeSection) return;
    const frame = window.requestAnimationFrame(() => {
      detailPanelRef.current
        ?.querySelector<HTMLElement>(DETAIL_FOCUSABLE_SELECTOR)
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection?.to]);

  return (
    <TvStageShell
      className={`tv-library tv-directory settings-page settings-workspace-page${
        activeSection ? " is-detail-open" : ""
      }`}
      ariaLabel={t("settings.index.sectionsAriaLabel")}
    >
      <header className="tv-library-heading">
        <button
          type="button"
          className="tv-page-back"
          aria-label={t("settings.sectionLayout.backLink")}
          onClick={leaveSettings}
          data-tv-focus-default
        >
          <span aria-hidden="true">←</span>
        </button>
        <h1>{t("settings.index.title")}</h1>
      </header>

      <div className="settings-workspace">
        <div className="settings-workspace-track">
          <nav
            className="settings-options-panel"
            aria-label={t("settings.index.sectionsAriaLabel")}
            data-tv-scroll-container
            data-tv-scroll-axis="vertical"
            data-navigation-scroll-key="settings:options"
          >
            <ol className="settings-options-list">
              {settingsSections.map((section) => {
                const isActive = section.to === activeSection?.to;
                return (
                  <li key={section.to}>
                    <Link
                      id={isActive ? "settings-active-option" : undefined}
                      to={section.to}
                      replace={Boolean(activeSection)}
                      className={`settings-option${isActive ? " is-active" : ""}`}
                      state={{
                        backTo: "/settings",
                        navigationOrigin: activeSection
                          ? detailOrigin ?? undefined
                          : navigationLayer.origin,
                      }}
                      aria-current={isActive ? "page" : undefined}
                      onClick={handleOptionClick}
                      onKeyDown={(event) => handleOptionKeyDown(event, section)}
                      data-navigation-focus-key={`settings:${section.number}`}
                    >
                      <span className="settings-option-number">{section.number}</span>
                      <span className="settings-option-copy">
                        <strong>{section.title}</strong>
                        <small>{section.description}</small>
                      </span>
                      <span className="settings-option-arrow" aria-hidden="true">
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section
            ref={detailPanelRef}
            className="settings-detail-panel"
            aria-label={activeSection?.title}
            aria-hidden={activeSection ? undefined : true}
            onKeyDownCapture={handleDetailKeyDown}
          >
            {activeSection && (
              <div
                className="settings-detail-scroll"
                data-tv-scroll-container
                data-tv-scroll-axis="vertical"
                data-navigation-scroll-key={`settings:detail:${activeSection.number}`}
              >
                <Outlet />
              </div>
            )}
          </section>
        </div>
      </div>
    </TvStageShell>
  );
}
