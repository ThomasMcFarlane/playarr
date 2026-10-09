import { useState } from "react";
import { describeApiError, type RequestView } from "@playarr-tv/api-client";
import { useAsyncData } from "@playarr-tv/api-client/react";
import { EmptyState, ErrorState, PageLayout, ScrollArea, SkeletonState } from "../components/shell";
import { TvRailSurface } from "../components/tv/TvStage";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLiveSubscription } from "../lib/liveEvents";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

type State =
  | { status: "loading" }
  | { status: "ready"; items: RequestView[] }
  | { status: "error"; message: string };

/** Stored first paint for Back and revisits; a catalogue or request change drops it (`catalog` tag). */
export const REQUESTS_CACHE_KEY = "requests:list";
export const REQUESTS_QUERY_TAGS = ["catalog"] as const;

/**
 * The signed-in user's requests (administrators see everyone's) with their
 * status, whichever system took them.
 * The list paints from the query cache at once and refreshes in place when a
 * live library change arrives or the fallback poll fires.
 */
export function RequestsPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.requests.title"));
  const client = useApiClient();
  const [attempt, setAttempt] = useState(0);
  const liveRequests = useLiveSubscription({ areas: ["catalog", "account"] });
  const asyncState = useAsyncData<RequestView[]>(
    () =>
      client.listRequests().catch((error: unknown) => {
        throw new Error(describeApiError(error));
      }),
    [client],
    {
      subscribe: liveRequests,
      retryKey: attempt,
      cache: { store: client.queries, key: REQUESTS_CACHE_KEY, tags: REQUESTS_QUERY_TAGS },
    }
  );
  const state: State =
    asyncState.status === "ready"
      ? { status: "ready", items: asyncState.data }
      : asyncState.status === "error"
        ? { status: "error", message: asyncState.message }
        : asyncState.status === "empty"
          ? { status: "ready", items: [] }
          : { status: "loading" };

  return (
    <PageLayout
      pageId="requests"
      className="tv-library tv-downloads tv-watchlist"
      ariaLabel={t("pages.requests.title")}
      header={{ title: t("pages.requests.title"), back: { label: t("pages.requests.backToHome"), to: "/" } }}
    >
      <TvRailSurface
        className="tv-rail-panel tv-library-grid-panel tv-downloads-panel"
        mode="content"
        ariaLabel={t("pages.requests.title")}
      >
        <ScrollArea
          axis="vertical"
          scrollKey="requests:list"
          className="tv-downloads-content"
          refreshKey={state.status === "ready" ? state.items.length : state.status}
        >
          {state.status === "loading" ? (
            <SkeletonState kind="rows" label={t("pages.requests.loading")} />
          ) : state.status === "error" ? (
            <ErrorState
              graphic="details"
              title={t("pages.requests.errorTitle")}
              description={state.message}
              onRetry={() => setAttempt((value) => value + 1)}
              retryLabel={t("components.states.retry")}
            />
          ) : state.items.length === 0 ? (
            <EmptyState
              graphic="details"
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
        </ScrollArea>
      </TvRailSurface>
    </PageLayout>
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
    // Focusable so the D-pad can step down a long list (the row has no action of its own).
    <li
      className="media-card media-card-row tv-download-row tv-watchlist-row"
      tabIndex={0}
      data-navigation-focus-key={`requests:${request.id}`}
    >
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
