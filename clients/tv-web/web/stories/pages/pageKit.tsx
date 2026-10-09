import type { ReactNode } from "react";
import type { Meta } from "@storybook/react-vite";
import { PageLayout, ShellActionColumnProvider, SkeletonState, type PageAction, type PageLayoutState, type SkeletonKind } from "../../src/components/shell";
import type { PageId } from "../../src/lib/pageRegistry";
import { Art, FIXTURE_TITLES } from "../fixtures";

/** Shared scaffolding for page composition stories. Fixtures only: no network and no real titles. */
export type Mode = "default" | "loading" | "empty" | "error";

export const MODE_ARGTYPES = {
  mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"], description: "Page state" },
} satisfies Meta["argTypes"];

const noop = () => undefined;

export function stateFor(mode: Mode, skeleton: SkeletonKind, emptyTitle: string, errorTitle: string): PageLayoutState | undefined {
  if (mode === "loading") return { kind: "loading", skeleton, label: "Loading" };
  if (mode === "empty") return { kind: "empty", props: { title: emptyTitle, description: "Nothing to show yet." } };
  if (mode === "error") return { kind: "error", props: { title: errorTitle, description: "Check the connection and try again.", onRetry: noop, retryLabel: "Try again" } };
  return undefined;
}

export interface PageStageProps {
  pageId: PageId;
  title: string;
  detail?: string;
  mode: Mode;
  skeleton?: SkeletonKind;
  className?: string;
  body?: "panel" | "bleed";
  actions?: PageAction[];
  emptyTitle?: string;
  errorTitle?: string;
  children?: ReactNode;
}

/** The real page frame (header, Back, states) around fixture content. */
export function PageStage({ pageId, title, detail, mode, skeleton = "rows", className, body, actions, emptyTitle = "Nothing here yet", errorTitle = "This page could not be loaded", children }: PageStageProps) {
  return (
    <ShellActionColumnProvider>
      <PageLayout
        pageId={pageId}
        body={body}
        header={{ title, detail, back: { label: "Back", to: "/" }, actions }}
        state={stateFor(mode, skeleton, emptyTitle, errorTitle)}
        ariaLabel={title}
        className={className}
      >
        {children}
      </PageLayout>
    </ShellActionColumnProvider>
  );
}

/** A title row as used by Watchlist, Requests and Downloads. */
export function FixtureRows({ count = 6, action = "Play", meta = "2020" }: { count?: number; action?: string; meta?: string }) {
  return (
    <div className="tv-rail-panel tv-library-grid-panel tv-downloads-panel">
      <div className="tv-downloads-content">
        <ul className="tv-watchlist-list">
          {Array.from({ length: count }, (_, i) => (
            <li className="media-card media-card-row tv-download-row tv-watchlist-row" key={i}>
              <div className="tv-download-row-copy">
                <a href="#fixture">
                  <strong>{FIXTURE_TITLES[i % FIXTURE_TITLES.length]}</strong>
                </a>
                <span className="tv-download-row-meta">
                  <span>{meta}</span>
                  <span>Library</span>
                </span>
              </div>
              <div className="tv-download-row-actions">
                <a href="#fixture" className="tv-watchlist-primary">
                  {action}
                </a>
                <button type="button">Remove</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** A grid of title cards (Search, Playlists, Folders). */
export function FixtureGrid({ count = 12, offset = 0 }: { count?: number; offset?: number }) {
  return (
    <div className="tv-rail-panel tv-library-grid-panel">
      <div className="tv-title-grid">
        <div className="tv-title-grid-content">
          {Array.from({ length: count }, (_, i) => (
            <a href="#fixture" className="tv-title-card" key={i} aria-label={`Open ${FIXTURE_TITLES[(i + offset) % FIXTURE_TITLES.length]}`}>
              <span className="tv-title-card-art">
                <Art index={i + offset} />
              </span>
              <span className="tv-title-card-copy">
                <strong>{FIXTURE_TITLES[(i + offset) % FIXTURE_TITLES.length]}</strong>
                <span className="tv-list-card-meta">Drama · 2020</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export const SETTINGS_SECTIONS = [
  ["Appearance", "Theme and Home view"],
  ["Language", "Interface language"],
  ["Player", "Quality and subtitles"],
  ["Home", "Rails on Home"],
  ["Profile avatar", "Choose a picture"],
  ["Profile lock", "PIN for this profile"],
  ["Remote", "Control another device"],
  ["Server", "Connection details"],
  ["Invite", "Invite someone"],
  ["Request latency", "Source response times"],
  ["Your data", "Export and delete"],
] as const;

/** The real settings workspace (options list plus detail panel) around fixture section content. */
export function SettingsFrame({ active, mode = "default", children }: { active: string; mode?: Mode; children?: ReactNode }) {
  const current = SETTINGS_SECTIONS.find(([title]) => title === active) ?? SETTINGS_SECTIONS[0];
  return (
    <ShellActionColumnProvider>
      <PageLayout
        pageId="settings"
        className="tv-library tv-directory settings-page settings-workspace-page settings-detail-route"
        ariaLabel="Settings sections"
        header={{ title: "Settings", back: { label: "Back", to: "/" }, detail: current[0], mobileShow: "detail" }}
      >
        <div className="settings-workspace">
          <div className="settings-workspace-track">
            <nav className="settings-options-panel" aria-label="Settings sections">
              <ol className="settings-options-list">
                {SETTINGS_SECTIONS.map(([title, description], i) => (
                  <li key={title}>
                    <a href="#fixture" className={`settings-option${title === current[0] ? " is-active" : ""}`} aria-current={title === current[0] ? "page" : undefined}>
                      <span className="settings-option-number">{String(i + 1).padStart(2, "0")}</span>
                      <span className="settings-option-copy">
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </span>
                      <span className="settings-option-arrow" aria-hidden="true">
                        →
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <section className="tv-rail-panel tv-library-grid-panel settings-detail-panel" aria-label={current[0]}>
              <div className="settings-detail-scroll">
                {mode === "loading" ? (
                  <SkeletonSettingsBlock />
                ) : mode === "error" ? (
                  <p className="error-text" role="alert">
                    This section could not be loaded.
                  </p>
                ) : mode === "empty" ? (
                  <p className="muted">Nothing to configure yet.</p>
                ) : (
                  children
                )}
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    </ShellActionColumnProvider>
  );
}

function SkeletonSettingsBlock() {
  return <SkeletonState kind="settings" label="Loading" />;
}
