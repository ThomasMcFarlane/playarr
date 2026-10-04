import { useCallback, useEffect, useState } from "react";
import { describeApiError } from "@playarr-tv/api-client";
import { PageHeader } from "../components/shell";
import { Button } from "../components/ui";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import { TvRailSurface, TvStageShell } from "../components/tv/TvStage";
import { useApiClient } from "../lib/ApiClientProvider";
import {
  moveRail,
  toggleRail,
  toPreferencesRequest,
  type RailPreferenceEntry,
} from "../lib/homeRailPrefs";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

type State =
  | { status: "loading" }
  | { status: "ready"; rails: RailPreferenceEntry[] }
  | { status: "error"; message: string };

/** Per-user Home rail visibility and order; saved on every change. */
export function HomeCustomisePage() {
  const { t, language } = useLanguage();
  useDocumentTitle(t("pages.home.customise.title"));
  const client = useApiClient();
  const [state, setState] = useState<State>({ status: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .getRailPreferences(language)
      .then((prefs) => {
        if (!cancelled) setState({ status: "ready", rails: prefs.rails });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: describeApiError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, language]);

  const save = useCallback(
    (next: RailPreferenceEntry[]) => {
      setState({ status: "ready", rails: next });
      setSaveError(null);
      client.saveRailPreferences(toPreferencesRequest(next)).catch((error: unknown) => {
        setSaveError(describeApiError(error));
      });
    },
    [client]
  );

  const reset = useCallback(() => {
    setSaveError(null);
    client
      .resetRailPreferences()
      .then(() => client.getRailPreferences(language))
      .then((prefs) => setState({ status: "ready", rails: prefs.rails }))
      .catch((error: unknown) => setSaveError(describeApiError(error)));
  }, [client, language]);

  return (
    <TvStageShell
      className="tv-library tv-downloads tv-home-customise-page"
      ariaLabel={t("pages.home.customise.title")}
    >
      <PageHeader
        title={t("pages.home.customise.title")}
        backLabel={t("pages.watchlist.backToHome")}
      />
      <TvRailSurface
        className="tv-rail-panel tv-library-grid-panel tv-downloads-panel"
        mode="content"
        ariaLabel={t("pages.home.customise.title")}
      >
        <div
          className="tv-downloads-content"
          data-tv-scroll-container
          data-tv-scroll-axis="vertical"
          data-navigation-scroll-key="home:customise"
        >
          {state.status === "loading" ? (
            <p className="tv-discovery-note" role="status">
              {t("pages.home.customise.loading")}
            </p>
          ) : state.status === "error" ? (
            <TvEmptyState
              graphic="home"
              variant="page"
              tone="error"
              title={t("pages.home.error.title")}
              description={state.message}
            />
          ) : (
            <>
              <p className="tv-discovery-note">{t("pages.home.customise.hint")}</p>
              <ul className="tv-home-customise-list">
                {state.rails.map((rail, index) => (
                  <li key={rail.id} className={rail.hidden ? "is-hidden" : undefined}>
                    <span className="tv-home-customise-title">{rail.title}</span>
                    <Button
                      size="sm"
                      onClick={() => save(toggleRail(state.rails, rail.id))}
                      aria-pressed={!rail.hidden}
                    >
                      {rail.hidden
                        ? t("pages.home.customise.show")
                        : t("pages.home.customise.hide")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={index === 0}
                      onClick={() => save(moveRail(state.rails, rail.id, -1))}
                      aria-label={t("pages.home.customise.moveUp", { title: rail.title })}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      disabled={index === state.rails.length - 1}
                      onClick={() => save(moveRail(state.rails, rail.id, 1))}
                      aria-label={t("pages.home.customise.moveDown", { title: rail.title })}
                    >
                      ↓
                    </Button>
                  </li>
                ))}
              </ul>
              <Button onClick={reset}>
                {t("pages.home.customise.reset")}
              </Button>
            </>
          )}
          {saveError ? (
            <p className="tv-watchlist-error" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
      </TvRailSurface>
    </TvStageShell>
  );
}
