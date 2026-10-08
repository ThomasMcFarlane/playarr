import { useCallback, useEffect, useState } from "react";
import { describeApiError } from "@playarr-tv/api-client";
import { ErrorState, SkeletonState } from "../../components/shell";
import { Button } from "../../components/ui";
import { useApiClient } from "../../lib/ApiClientProvider";
import {
  moveRail,
  toggleRail,
  toPreferencesRequest,
  type RailPreferenceEntry,
} from "../../lib/homeRailPrefs";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

type State =
  | { status: "loading" }
  | { status: "ready"; rails: RailPreferenceEntry[] }
  | { status: "error"; message: string };

/** Per-user Home rail visibility and order, as a settings section (/settings/home); saved on every change. */
export function SettingsHomePage() {
  const { t, language } = useLanguage();
  useDocumentTitle(t("pages.home.customise.title"));
  const client = useApiClient();
  const [state, setState] = useState<State>({ status: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
  }, [client, language, attempt]);

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
    <SettingsSectionLayout>
      <section className="card settings-card settings-card-wide">
        {state.status === "loading" ? (
          <SkeletonState kind="rows" compact label={t("pages.home.customise.loading")} />
        ) : state.status === "error" ? (
          <ErrorState
            variant="compact"
            title={t("pages.home.error.title")}
            description={state.message}
            onRetry={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
            retryLabel={t("components.states.retry")}
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
                    {rail.hidden ? t("pages.home.customise.show") : t("pages.home.customise.hide")}
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
            <div className="tv-home-customise-actions">
              <Button onClick={reset}>{t("pages.home.customise.reset")}</Button>
            </div>
          </>
        )}
        {saveError ? <ErrorState variant="compact" title={t("pages.home.error.title")} description={saveError} /> : null}
      </section>
    </SettingsSectionLayout>
  );
}
