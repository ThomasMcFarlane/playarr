import {
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import {
  formControlDescriptor,
  shouldNavigateFromFormControl,
  type FormControlDescriptor,
} from "../../lib/arrowNavigationPolicy";
import {
  navigationOriginFromState,
  useNavigationLayer,
} from "../../lib/navigationLayer";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../../lib/i18n/translations";
import { PRODUCT_SETTINGS_SECTIONS } from "../../lib/productSurfaces";
import { PageHeader } from "../../components/shell";
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

/** Settings hierarchy from productSurfaces (shared with tv-vidaa parity tests). */
function buildSettingsSections(t: TFunction): readonly SettingsSection[] {
  return PRODUCT_SETTINGS_SECTIONS.map((section) => ({
    to: section.to,
    number: section.number,
    title: t(section.titleKey as TranslationKey),
    description: t(section.descriptionKey as TranslationKey),
  }));
}

export function shouldReturnSettingsFocusToList(
  key: string,
  formControl: FormControlDescriptor | null,
  hasControlToLeft: boolean
): boolean {
  return (
    key === "ArrowLeft" &&
    !hasControlToLeft &&
    (formControl === null || shouldNavigateFromFormControl(key, formControl))
  );
}

export function adjacentSettingsIndex(
  key: string,
  currentIndex: number,
  sectionCount: number
): number | null {
  if (key !== "ArrowUp" && key !== "ArrowDown") return null;
  const nextIndex = currentIndex + (key === "ArrowDown" ? 1 : -1);
  return nextIndex >= 0 && nextIndex < sectionCount ? nextIndex : null;
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
 * Persistent settings master/detail shell. Appearance is the index route,
 * so both panes are always present; Left and Right move focus between them
 * while selecting another list item replaces the detail route in place.
 */
export function SettingsIndexPage() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationLayer = useNavigationLayer("settings:index");
  const settingsSections = buildSettingsSections(t);
  const isSettingsIndex = location.pathname === "/settings";
  const activeSection =
    settingsSections.find((section) => section.to === location.pathname) ??
    settingsSections[0]!;
  const detailOrigin = navigationOriginFromState(location.state);
  const requestedBackTo = (location.state as { backTo?: unknown } | null)?.backTo;
  const pageBackTo = typeof requestedBackTo === "string" ? requestedBackTo : "/";
  const detailPanelRef = useRef<HTMLElement>(null);
  useDocumentTitle(t("settings.index.documentTitle"), false);

  function leaveSettings() {
    if (
      !isSettingsIndex &&
      typeof window !== "undefined" &&
      window.matchMedia(
        "(max-width: 760px), (max-width: 920px) and (max-height: 500px) and (pointer: coarse)"
      ).matches
    ) {
      navigate("/settings", {
        replace: true,
        state: { backTo: pageBackTo },
      });
      return;
    }
    if (detailOrigin && detailOrigin.route !== "/settings") {
      navigate(-1);
    } else {
      navigate(pageBackTo);
    }
  }

  function openSection(
    section: SettingsSection,
    target: HTMLElement,
    moveToDetail = false
  ) {
    const navigationOrigin =
      detailOrigin ?? navigationLayer.capture(target);
    navigate(section.to, {
      replace: true,
      state: { backTo: "/settings", navigationOrigin },
    });
    if (moveToDetail) window.requestAnimationFrame(focusDetail);
  }

  function focusDetail() {
    detailPanelRef.current
      ?.querySelector<HTMLElement>(DETAIL_FOCUSABLE_SELECTOR)
      ?.focus({ preventScroll: true });
  }

  function handleOptionKeyDown(
    event: ReactKeyboardEvent<HTMLAnchorElement>,
    section: SettingsSection
  ) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const currentIndex = settingsSections.findIndex((item) => item.to === section.to);
      const nextIndex = adjacentSettingsIndex(
        event.key,
        currentIndex,
        settingsSections.length
      );
      const nextSection = nextIndex === null ? undefined : settingsSections[nextIndex];
      if (!nextSection) return;
      event.preventDefault();
      event.stopPropagation();
      openSection(nextSection, event.currentTarget);
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-navigation-focus-key="settings:${nextSection.number}"]`
          )
          ?.focus({ preventScroll: true });
      });
      return;
    }

    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    if (!isSettingsIndex && section.to === activeSection.to) focusDetail();
    else openSection(section, event.currentTarget, true);
  }

  function handleOptionClick(
    event: ReactMouseEvent<HTMLAnchorElement>,
    section: SettingsSection
  ) {
    event.preventDefault();
    if (!detailOrigin) navigationLayer.capture(event.currentTarget);
    if (!isSettingsIndex && section.to === activeSection.to) focusDetail();
    else openSection(section, event.currentTarget, true);
  }

  function handleDetailKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const hasControlToLeft = Boolean(
      event.target instanceof HTMLElement &&
      detailPanelRef.current &&
      hasFocusableControlToLeft(detailPanelRef.current, event.target)
    );
    if (
      !shouldReturnSettingsFocusToList(
        event.key,
        formControlDescriptor(event.target),
        hasControlToLeft
      )
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    document
      .querySelector<HTMLElement>("#settings-active-option")
      ?.focus({ preventScroll: true });
  }

  return (
    <TvStageShell
      className={`tv-library tv-directory settings-page settings-workspace-page ${
        isSettingsIndex ? "settings-index-route" : "settings-detail-route"
      }`}
      ariaLabel={t("settings.index.sectionsAriaLabel")}
    >
      <PageHeader
        title={t("settings.index.title")}
        backLabel={t("settings.sectionLayout.backLink")}
        onBack={leaveSettings}
        backProps={{ "data-tv-focus-default": true }}
        detailClassName="settings-heading-detail"
        detail={
          <>
            <strong>{activeSection.title}</strong>
            <small>{activeSection.description}</small>
          </>
        }
      />

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
                      replace
                      className={`settings-option${isActive ? " is-active" : ""}`}
                      state={{
                        backTo: "/settings",
                        navigationOrigin: detailOrigin ?? navigationLayer.origin,
                      }}
                      aria-current={isActive ? "page" : undefined}
                      onClick={(event) => handleOptionClick(event, section)}
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
            className="tv-rail-panel tv-library-grid-panel settings-detail-panel"
            aria-label={activeSection?.title}
            onKeyDownCapture={handleDetailKeyDown}
          >
            <div
              className="settings-detail-scroll"
              data-tv-scroll-container
              data-tv-scroll-axis="vertical"
              data-navigation-scroll-key={`settings:detail:${activeSection.number}`}
            >
              <Outlet />
            </div>
          </section>
        </div>
      </div>
    </TvStageShell>
  );
}
