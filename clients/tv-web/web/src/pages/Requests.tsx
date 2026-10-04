import { useEffect, useState } from "react";
import { describeApiError, type RequestView } from "@playarr-tv/api-client";
import { PageHeader } from "../components/shell";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import { TvRailSurface, TvStageShell } from "../components/tv/TvStage";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

type State =
  | { status: "loading" }
  | { status: "ready"; items: RequestView[] }
  | { status: "error"; message: string };

/**
 * The signed-in user's requests (administrators see everyone's) with their
 * status, whichever system took them: Radarr/Sonarr direct, Ombi or Seerr.
 */
export function RequestsPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.requests.title"));
  const client = useApiClient();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void client
      .listRequests()
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: describeApiError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <TvStageShell className="tv-library tv-downloads tv-watchlist" ariaLabel={t("pages.requests.title")}>
      <PageHeader title={t("pages.requests.title")} backLabel={t("pages.requests.backToHome")} />
      <TvRailSurface
        className="tv-rail-panel tv-library-grid-panel tv-downloads-panel"
        mode="content"
        ariaLabel={t("pages.requests.title")}
      >
        <div
          className="tv-downloads-content"
          data-tv-scroll-container
          data-tv-scroll-axis="vertical"
          data-navigation-scroll-key="requests:list"
        >
          {state.status === "loading" ? (
            <p className="tv-discovery-note" role="status">
              {t("pages.requests.loading")}
            </p>
          ) : state.status === "error" ? (
            <TvEmptyState
              graphic="details"
              variant="page"
              tone="error"
              title={t("pages.requests.errorTitle")}
              description={state.message}
            />
          ) : state.items.length === 0 ? (
            <TvEmptyState
              graphic="details"
              variant="page"
              title={t("pages.requests.emptyTitle")}
              description={t("pages.requests.emptyDescription")}
            />
          ) : (
            <ul className="tv-watchlist-list">
              {state.items.map((request) => (
                <RequestRow key={request.id} request={request} />
              ))}
            </ul>
          )}
        </div>
      </TvRailSurface>
    </TvStageShell>
  );
}

const STATUS_KEYS = {
  pending: "pages.requests.status.pending",
  approved: "pages.requests.status.approved",
  declined: "pages.requests.status.declined",
  available: "pages.requests.status.available",
  failed: "pages.requests.status.failed",
} as const;

export function requestStatusKey(status: RequestView["status"]) {
  return STATUS_KEYS[status];
}

export function RequestRow({ request }: { request: RequestView }) {
  const { t } = useLanguage();
  return (
    <li className="tv-download-row tv-watchlist-row" data-navigation-focus-key={`requests:${request.id}`}>
      <div className="tv-download-row-copy">
        <strong>{request.title}</strong>
        <span className="tv-download-row-meta">
          {request.year ? <span>{request.year}</span> : null}
          <span>{t(requestStatusKey(request.status))}</span>
          {request.requested_by ? (
            <span>{request.mine ? t("pages.requests.byYou") : t("pages.requests.by", { name: request.requested_by })}</span>
          ) : null}
        </span>
        {request.status_note ? <small className="tv-watchlist-reason">{request.status_note}</small> : null}
      </div>
    </li>
  );
}
